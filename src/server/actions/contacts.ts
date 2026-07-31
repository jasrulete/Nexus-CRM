"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { assertNotLockedDemoAccount } from "@/lib/demo-guard";
import { contactSchema, fieldErrors, idSchema } from "@/lib/validation";

function parseForm(formData: FormData) {
  return contactSchema.safeParse({
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    title: formData.get("title"),
    status: formData.get("status"),
    source: formData.get("source"),
    notes: formData.get("notes"),
    companyId: formData.get("companyId"),
  });
}

async function resolveCompanyId(companyId: string | null | undefined) {
  if (!companyId) return null;
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  return company ? company.id : null;
}

export async function createContact(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { companyId, ...data } = parsed.data;
  const contact = await prisma.contact.create({
    data: {
      ...data,
      companyId: await resolveCompanyId(companyId),
      ownerId: user.id,
    },
  });

  await audit({
    action: "contact.create",
    entityType: "contact",
    entityId: contact.id,
    userId: user.id,
    metadata: { name: `${contact.firstName} ${contact.lastName}` },
  });
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function updateContact(
  contactId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const id = idSchema.parse(contactId);
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const existing = await prisma.contact.findUnique({ where: { id } });
  if (!existing) return { message: "Contact not found" };

  const { companyId, ...data } = parsed.data;
  await prisma.contact.update({
    where: { id },
    data: { ...data, companyId: await resolveCompanyId(companyId) },
  });

  await audit({
    action: "contact.update",
    entityType: "contact",
    entityId: id,
    userId: user.id,
    metadata:
      existing.status !== parsed.data.status
        ? { statusFrom: existing.status, statusTo: parsed.data.status }
        : undefined,
  });
  revalidatePath("/contacts");
  revalidatePath(`/contacts/${id}`);
  revalidatePath("/dashboard");
  return { success: true };
}

export async function deleteContact(contactId: string): Promise<void> {
  const user = await requireUser();
  assertNotLockedDemoAccount(user);
  const id = idSchema.parse(contactId);

  const contact = await prisma.contact.findUnique({ where: { id } });
  if (!contact) return;
  if (contact.ownerId !== user.id && user.role !== "ADMIN") {
    throw new Error("FORBIDDEN: only the owner or an admin can delete");
  }

  await prisma.contact.delete({ where: { id } });
  await audit({
    action: "contact.delete",
    entityType: "contact",
    entityId: id,
    userId: user.id,
    metadata: { name: `${contact.firstName} ${contact.lastName}` },
  });
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  redirect("/contacts");
}
