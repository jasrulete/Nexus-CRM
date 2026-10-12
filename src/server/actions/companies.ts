"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { audit, auditTx } from "@/lib/audit";
import { assertNotLockedDemoAccount } from "@/lib/demo-guard";
import { canMutate, NOT_YOURS } from "@/lib/authz";
import { parseSubmittedVersion, STALE_RECORD, VERSION_FIELD } from "@/lib/concurrency";
import { checkRecordCap } from "@/lib/plans";
import { companySchema, fieldErrors, idSchema } from "@/lib/validation";
import { actorOf, requireWorkspace } from "@/lib/workspace-context";

function parseForm(formData: FormData) {
  return companySchema.safeParse({
    name: formData.get("name"),
    domain: formData.get("domain"),
    industry: formData.get("industry"),
    size: formData.get("size"),
    website: formData.get("website"),
    notes: formData.get("notes"),
  });
}

export async function createCompany(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireWorkspace();
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  // A count, then the create, with no transaction around them (spec §7).
  const capped = await checkRecordCap(ctx, "companies");
  if (capped) return { message: capped };

  const company = await ctx.db.company.create({
    data: { ...parsed.data, ownerId: ctx.user.id, workspaceId: ctx.workspaceId },
  });

  await audit(ctx.db, {
    action: "company.create",
    entityType: "company",
    entityId: company.id,
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
    metadata: { name: company.name },
  });
  revalidatePath("/companies");
  return { success: true };
}

export async function updateCompany(
  companyId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const ctx = await requireWorkspace();
  const id = idSchema.parse(companyId);
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const existing = await ctx.db.company.findUnique({ where: { id } });
  if (!existing) return { message: "Company not found" };
  // Returned, not thrown: this runs inside a useActionState form.
  if (!canMutate(existing.ownerId, actorOf(ctx))) return { message: NOT_YOURS };

  const expectedVersion = parseSubmittedVersion(formData.get(VERSION_FIELD));
  if (!expectedVersion) return { message: STALE_RECORD };

  const written = await ctx.db.company.updateMany({
    where: { id, updatedAt: expectedVersion },
    data: parsed.data,
  });
  if (written.count === 0) return { message: STALE_RECORD };

  await audit(ctx.db, {
    action: "company.update",
    entityType: "company",
    entityId: id,
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
  });
  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
  return { success: true };
}

export async function deleteCompany(companyId: string): Promise<void> {
  const ctx = await requireWorkspace();
  assertNotLockedDemoAccount(ctx.user);
  const id = idSchema.parse(companyId);

  const company = await ctx.db.company.findUnique({ where: { id } });
  if (!company) return;
  if (!canMutate(company.ownerId, actorOf(ctx))) {
    throw new Error("FORBIDDEN: only the owner or an admin can delete");
  }

  // A delete and its record commit together: afterwards the entry is the only
  // evidence the row existed at all.
  await ctx.db.$transaction(async (tx) => {
    await tx.company.delete({ where: { id } });
    await auditTx(tx, {
      action: "company.delete",
      entityType: "company",
      entityId: id,
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      metadata: { name: company.name },
    });
  });
  revalidatePath("/companies");
  revalidatePath("/contacts");
  redirect("/companies");
}
