"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
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

  await prisma.company.update({ where: { id }, data: parsed.data });

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
  const id = idSchema.parse(companyId);

  const company = await prisma.company.findUnique({ where: { id } });
  if (!company) return;
  if (company.ownerId !== user.id && user.role !== "ADMIN") {
    throw new Error("FORBIDDEN: only the owner or an admin can delete");
  }

  await prisma.company.delete({ where: { id } });
  await audit({
    action: "company.delete",
    entityType: "company",
    entityId: id,
    userId: user.id,
    metadata: { name: company.name },
  });
  revalidatePath("/companies");
  revalidatePath("/contacts");
  redirect("/companies");
}
