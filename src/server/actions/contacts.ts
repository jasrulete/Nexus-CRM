"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { audit, auditTx } from "@/lib/audit";
import { assertNotLockedDemoAccount } from "@/lib/demo-guard";
import { canMutate, NOT_YOURS } from "@/lib/authz";
import { parseSubmittedVersion, STALE_RECORD, VERSION_FIELD } from "@/lib/concurrency";
import { checkRecordCap } from "@/lib/plans";
import { resolveCompanyId } from "@/lib/relations";
import { contactSchema, fieldErrors, idSchema } from "@/lib/validation";
import { actorOf, requireWorkspace } from "@/lib/workspace-context";

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

export async function createContact(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireWorkspace();
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  // A count, then the create, with no transaction around them (spec §7).
  const capped = await checkRecordCap(ctx, "contacts");
  if (capped) return { message: capped };

  const { companyId, ...data } = parsed.data;
  const contact = await ctx.db.contact.create({
    data: {
      ...data,
      // Resolved through the scoped client: another workspace's company is
      // "not found", so the link is dropped rather than written (spec §5.4).
      companyId: await resolveCompanyId(ctx.db, companyId),
      ownerId: ctx.user.id,
      workspaceId: ctx.workspaceId,
    },
  });

  await audit(ctx.db, {
    action: "contact.create",
    entityType: "contact",
    entityId: contact.id,
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
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
  const ctx = await requireWorkspace();
  const id = idSchema.parse(contactId);
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  // Scoped: another workspace's id is "not found" here, never "not yours".
  const existing = await ctx.db.contact.findUnique({ where: { id } });
  if (!existing) return { message: "Contact not found" };
  // Returned, not thrown: this runs inside a useActionState form, and throwing
  // would trip the error boundary and lose what the user typed.
  if (!canMutate(existing.ownerId, actorOf(ctx))) return { message: NOT_YOURS };

  const expectedVersion = parseSubmittedVersion(formData.get(VERSION_FIELD));
  if (!expectedVersion) return { message: STALE_RECORD };

  const { companyId, ...data } = parsed.data;
  const written = await ctx.db.contact.updateMany({
    where: { id, updatedAt: expectedVersion },
    data: { ...data, companyId: await resolveCompanyId(ctx.db, companyId) },
  });
  // Zero rows matched: someone saved this record between the form rendering
  // and this submit. Refuse rather than overwrite their change.
  if (written.count === 0) return { message: STALE_RECORD };

  await audit(ctx.db, {
    action: "contact.update",
    entityType: "contact",
    entityId: id,
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
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
  const ctx = await requireWorkspace();
  assertNotLockedDemoAccount(ctx.user);
  const id = idSchema.parse(contactId);

  const contact = await ctx.db.contact.findUnique({ where: { id } });
  if (!contact) return;
  if (!canMutate(contact.ownerId, actorOf(ctx))) {
    throw new Error("FORBIDDEN: only the owner or an admin can delete");
  }

  // A delete and its record commit together: afterwards the entry is the only
  // evidence the row existed at all. Every query in the callback goes through
  // `tx` (spec §5.2).
  await ctx.db.$transaction(async (tx) => {
    await tx.contact.delete({ where: { id } });
    await auditTx(tx, {
      action: "contact.delete",
      entityType: "contact",
      entityId: id,
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      metadata: { name: `${contact.firstName} ${contact.lastName}` },
    });
  });
  revalidatePath("/contacts");
  revalidatePath("/dashboard");
  redirect("/contacts");
}
