"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { assertNotLockedDemoAccount } from "@/lib/demo-guard";
import { activitySchema, fieldErrors, idSchema } from "@/lib/validation";

export async function createActivity(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = activitySchema.safeParse({
    type: formData.get("type"),
    content: formData.get("content"),
    contactId: formData.get("contactId"),
    dealId: formData.get("dealId"),
    companyId: formData.get("companyId"),
  });
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { contactId, dealId, companyId, ...data } = parsed.data;
  if (!contactId && !dealId && !companyId) {
    return { message: "Activity must be attached to a record" };
  }

  const activity = await prisma.activity.create({
    data: {
      ...data,
      contactId: contactId || null,
      dealId: dealId || null,
      companyId: companyId || null,
      userId: user.id,
    },
  });

  await audit({
    action: "activity.create",
    entityType: "activity",
    entityId: activity.id,
    userId: user.id,
    metadata: { type: data.type },
  });

  if (contactId) revalidatePath(`/contacts/${contactId}`);
  if (companyId) revalidatePath(`/companies/${companyId}`);
  revalidatePath("/deals");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteActivity(activityId: string): Promise<void> {
  const user = await requireUser();
  assertNotLockedDemoAccount(user);
  const id = idSchema.parse(activityId);

  const activity = await prisma.activity.findUnique({ where: { id } });
  if (!activity) return;
  if (activity.userId !== user.id && user.role !== "ADMIN") {
    throw new Error("FORBIDDEN: only the author or an admin can delete");
  }

  await prisma.activity.delete({ where: { id } });
  await audit({
    action: "activity.delete",
    entityType: "activity",
    entityId: id,
    userId: user.id,
  });

  if (activity.contactId) revalidatePath(`/contacts/${activity.contactId}`);
  if (activity.companyId) revalidatePath(`/companies/${activity.companyId}`);
  revalidatePath("/deals");
  revalidatePath("/dashboard");
}
