"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { dealMoveSchema, dealSchema, fieldErrors, idSchema } from "@/lib/validation";

const CLOSED_STAGES = new Set(["WON", "LOST"]);

function parseForm(formData: FormData) {
  return dealSchema.safeParse({
    title: formData.get("title"),
    value: formData.get("value"),
    stage: formData.get("stage"),
    expectedCloseDate: formData.get("expectedCloseDate"),
    contactId: formData.get("contactId"),
    companyId: formData.get("companyId"),
  });
}

async function resolveRelation(
  model: "contact" | "company",
  relId: string | null | undefined,
) {
  if (!relId) return null;
  const found =
    model === "contact"
      ? await prisma.contact.findUnique({ where: { id: relId } })
      : await prisma.company.findUnique({ where: { id: relId } });
  return found ? relId : null;
}

export async function createDeal(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { contactId, companyId, expectedCloseDate, ...data } = parsed.data;

  const last = await prisma.deal.findFirst({
    where: { stage: data.stage },
    orderBy: { position: "desc" },
  });

  const deal = await prisma.deal.create({
    data: {
      ...data,
      position: (last?.position ?? -1) + 1,
      expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
      closedAt: CLOSED_STAGES.has(data.stage) ? new Date() : null,
      contactId: await resolveRelation("contact", contactId),
      companyId: await resolveRelation("company", companyId),
      ownerId: user.id,
    },
  });

  await audit({
    action: "deal.create",
    entityType: "deal",
    entityId: deal.id,
    userId: user.id,
    metadata: { title: deal.title, value: deal.value, stage: deal.stage },
  });
  revalidatePath("/deals");
  revalidatePath("/dashboard");
  return { success: true };
}

export async function updateDeal(
  dealId: string,
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const id = idSchema.parse(dealId);
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const existing = await prisma.deal.findUnique({ where: { id } });
  if (!existing) return { message: "Deal not found" };

  const { contactId, companyId, expectedCloseDate, ...data } = parsed.data;
  const stageChanged = existing.stage !== data.stage;

  await prisma.deal.update({
    where: { id },
    data: {
      ...data,
      expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
      closedAt: CLOSED_STAGES.has(data.stage)
        ? (existing.closedAt ?? new Date())
        : null,
      contactId: await resolveRelation("contact", contactId),
      companyId: await resolveRelation("company", companyId),
    },
  });

  await audit({
    action: stageChanged ? "deal.stage_change" : "deal.update",
    entityType: "deal",
    entityId: id,
    userId: user.id,
    metadata: stageChanged
      ? { from: existing.stage, to: data.stage }
      : undefined,
  });
  revalidatePath("/deals");
  revalidatePath("/dashboard");
  return { success: true };
}

/** Kanban drag-and-drop: move a deal to (stage, index) and resequence. */
export async function moveDeal(input: {
  dealId: string;
  stage: string;
  position: number;
}): Promise<{ ok: boolean }> {
  const user = await requireUser();
  const parsed = dealMoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const { dealId, stage, position } = parsed.data;
  const deal = await prisma.deal.findUnique({ where: { id: dealId } });
  if (!deal) return { ok: false };

  const stageChanged = deal.stage !== stage;

  const column = await prisma.deal.findMany({
    where: { stage, id: { not: dealId } },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  const ids = column.map((d) => d.id);
  ids.splice(Math.min(position, ids.length), 0, dealId);

  await prisma.$transaction([
    ...ids.map((id, index) =>
      prisma.deal.update({
        where: { id },
        data:
          id === dealId
            ? {
                stage,
                position: index,
                closedAt: CLOSED_STAGES.has(stage)
                  ? (deal.closedAt ?? new Date())
                  : null,
              }
            : { position: index },
      }),
    ),
  ]);

  if (stageChanged) {
    await audit({
      action: "deal.stage_change",
      entityType: "deal",
      entityId: dealId,
      userId: user.id,
      metadata: { from: deal.stage, to: stage, via: "kanban" },
    });
  }
  revalidatePath("/deals");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteDeal(dealId: string): Promise<void> {
  const user = await requireUser();
  const id = idSchema.parse(dealId);

  const deal = await prisma.deal.findUnique({ where: { id } });
  if (!deal) return;
  if (deal.ownerId !== user.id && user.role !== "ADMIN") {
    throw new Error("FORBIDDEN: only the owner or an admin can delete");
  }

  await prisma.deal.delete({ where: { id } });
  await audit({
    action: "deal.delete",
    entityType: "deal",
    entityId: id,
    userId: user.id,
    metadata: { title: deal.title },
  });
  revalidatePath("/deals");
  revalidatePath("/dashboard");
}
