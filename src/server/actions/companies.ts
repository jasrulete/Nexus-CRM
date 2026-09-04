"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { assertNotLockedDemoAccount } from "@/lib/demo-guard";
import { canMutate, NOT_YOURS } from "@/lib/authz";
import { parseSubmittedVersion, STALE_RECORD, VERSION_FIELD } from "@/lib/concurrency";
import { companySchema, fieldErrors, idSchema } from "@/lib/validation";

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
  const user = await requireUser();
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const company = await prisma.company.create({
    data: { ...parsed.data, ownerId: user.id },
  });

  await audit({
    action: "company.create",
    entityType: "company",
    entityId: company.id,
    userId: user.id,
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
  const user = await requireUser();
  const id = idSchema.parse(companyId);
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const existing = await prisma.company.findUnique({ where: { id } });
  if (!existing) return { message: "Company not found" };
  // Returned, not thrown: this runs inside a useActionState form.
  if (!canMutate(existing.ownerId, user)) return { message: NOT_YOURS };

  const expectedVersion = parseSubmittedVersion(formData.get(VERSION_FIELD));
  if (!expectedVersion) return { message: STALE_RECORD };

  const written = await prisma.company.updateMany({
    where: { id, updatedAt: expectedVersion },
    data: parsed.data,
  });
  if (written.count === 0) return { message: STALE_RECORD };

  await audit({
    action: "company.update",
    entityType: "company",
    entityId: id,
    userId: user.id,
  });
  revalidatePath("/companies");
  revalidatePath(`/companies/${id}`);
  return { success: true };
}

export async function deleteCompany(companyId: string): Promise<void> {
  const user = await requireUser();
  assertNotLockedDemoAccount(user);
  const id = idSchema.parse(companyId);

  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) return;
  if (!canMutate(company.ownerId, user)) {
    throw new Error("FORBIDDEN: only the owner or an admin can delete");
  }

  // A delete and its record commit together: afterwards the entry is the only
  // evidence the row existed at all.
  await prisma.$transaction(async (tx) => {
    await tx.company.delete({ where: { id } });
    await audit(
      {
        action: "company.delete",
        entityType: "company",
        entityId: id,
        userId: user.id,
        metadata: { name: company.name },
      },
      tx,
    );
  });
  revalidatePath("/companies");
  revalidatePath("/contacts");
  redirect("/companies");
}
