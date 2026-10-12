"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { audit, auditTx } from "@/lib/audit";
import { assertNotLockedDemoAccount } from "@/lib/demo-guard";
import { canMutate } from "@/lib/authz";
import { findMissingRelation, missingRelationMessage } from "@/lib/relations";
import { activitySchema, fieldErrors, idSchema } from "@/lib/validation";
import { actorOf, requireWorkspace } from "@/lib/workspace-context";

export async function createActivity(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireWorkspace();
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

  // Without this, a stale tab whose contact was just deleted throws Prisma P2003
  // out of the create, and the user gets the error boundary instead of a
  // message, losing what they typed. Through the scoped client, another
  // workspace's id gets the same "no longer exists" (spec §5.4).
  const missing = await findMissingRelation(ctx.db, { contactId, dealId, companyId });
  if (missing) return { message: missingRelationMessage(missing) };

  const activity = await ctx.db.activity.create({
    data: {
      ...data,
      contactId: contactId || null,
      dealId: dealId || null,
      companyId: companyId || null,
      userId: ctx.user.id,
      workspaceId: ctx.workspaceId,
    },
  });

  await audit(ctx.db, {
    action: "activity.create",
    entityType: "activity",
    entityId: activity.id,
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    metadata: { type: data.type },
  });

  if (contactId) revalidatePath(`/contacts/${contactId}`);
  if (companyId) revalidatePath(`/companies/${companyId}`);
  if (dealId) revalidatePath(`/deals/${dealId}`);
  revalidatePath("/deals");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteActivity(activityId: string): Promise<void> {
  const ctx = await requireWorkspace();
  assertNotLockedDemoAccount(ctx.user);
  const id = idSchema.parse(activityId);

  const activity = await ctx.db.activity.findUnique({ where: { id } });
  if (!activity) return;
  if (!canMutate(activity.userId, actorOf(ctx))) {
    throw new Error("FORBIDDEN: only the author or an admin can delete");
  }

  // A delete and its record commit together: afterwards the entry is the only
  // evidence the row existed at all.
  await ctx.db.$transaction(async (tx) => {
    await tx.activity.delete({ where: { id } });
    await auditTx(tx, {
      action: "activity.delete",
      entityType: "activity",
      entityId: id,
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
    });
  });

  if (activity.contactId) revalidatePath(`/contacts/${activity.contactId}`);
  if (activity.companyId) revalidatePath(`/companies/${activity.companyId}`);
  if (activity.dealId) revalidatePath(`/deals/${activity.dealId}`);
  revalidatePath("/deals");
  revalidatePath("/dashboard");
}
