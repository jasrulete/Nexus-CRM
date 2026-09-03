"use server";

import { revalidatePath } from "next/cache";
import type { ActionState } from "@/lib/action-state";
import { audit } from "@/lib/audit";
import { requireUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { assertNotLockedDemoAccount } from "@/lib/demo-guard";
import { canMutate, NOT_YOURS } from "@/lib/authz";
import { parseSubmittedVersion, STALE_RECORD, VERSION_FIELD } from "@/lib/concurrency";
import { getRateToWorkspaceCurrency } from "@/lib/fx";
import { convertAmount } from "@/lib/money";
import { dealMoveSchema, dealSchema, fieldErrors, idSchema } from "@/lib/validation";

const CLOSED_STAGES = new Set(["WON", "LOST"]);

function parseForm(formData: FormData) {
  return dealSchema.safeParse({
    title: formData.get("title"),
    value: formData.get("value"),
    stage: formData.get("stage"),
    currency: formData.get("currency") ?? undefined,
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


/**
 * Resolves an entered amount into the workspace currency.
 *
 * The rate is frozen onto the row here rather than applied at read time, so a
 * closed deal's contribution to last quarter's revenue is the same number next
 * year. A rate that cannot be fetched is refused rather than defaulted to 1 —
 * storing a EUR amount as if it were dollars would corrupt every total the deal
 * appears in, silently and permanently.
 */
async function resolveAmount(value: number, currency: string) {
  const rate = await getRateToWorkspaceCurrency(currency);
  if (!rate.ok) return null;
  return { fxRate: rate.rate, baseValue: convertAmount(value, rate.rate) };
}

const RATE_UNAVAILABLE =
  "Couldn't fetch an exchange rate just now — try again in a moment, or enter the amount in the workspace currency.";

export async function createDeal(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const { contactId, companyId, expectedCloseDate, ...data } = parsed.data;

  const amount = await resolveAmount(data.value, data.currency);
  if (!amount) return { message: RATE_UNAVAILABLE };

  // Relations and the rate are resolved before the transaction opens: both can
  // be slow (the rate is a network call) and neither depends on the position.
  const resolvedContactId = await resolveRelation("contact", contactId);
  const resolvedCompanyId = await resolveRelation("company", companyId);

  // The append position is a read-then-write, so it belongs in one transaction.
  // Outside it, two people adding a deal to the same column at the same moment
  // both read the same last position and both write it.
  const deal = await prisma.$transaction(async (tx) => {
    const last = await tx.deal.findFirst({
      where: { stage: data.stage },
      orderBy: { position: "desc" },
      select: { position: true },
    });

    return tx.deal.create({
      data: {
        ...data,
        ...amount,
        position: (last?.position ?? -1) + 1,
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
        closedAt: CLOSED_STAGES.has(data.stage) ? new Date() : null,
        contactId: resolvedContactId,
        companyId: resolvedCompanyId,
        ownerId: user.id,
      },
    });
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
  // Returned, not thrown: this runs inside a useActionState form.
  if (!canMutate(existing.ownerId, user)) return { message: NOT_YOURS };

  const { contactId, companyId, expectedCloseDate, ...data } = parsed.data;
  const stageChanged = existing.stage !== data.stage;

  // The rate is frozen onto the row when the amount is set, and has to stay put
  // through unrelated edits. This used to call resolveAmount unconditionally, so
  // fixing a typo in the title months later re-priced a closed deal at that
  // day's rate — a March-closed EUR 62,000 deal moved 72,534 -> 69,186 on a
  // title-only edit — quietly rewriting last quarter's revenue. Only an actual
  // change to the amount or its currency earns a new rate.
  const amountChanged =
    data.value !== existing.value || data.currency !== existing.currency;
  const amount = amountChanged
    ? await resolveAmount(data.value, data.currency)
    : { fxRate: existing.fxRate, baseValue: existing.baseValue };
  if (!amount) return { message: RATE_UNAVAILABLE };

  const resolvedContactId = await resolveRelation("contact", contactId);
  const resolvedCompanyId = await resolveRelation("company", companyId);

  const expectedVersion = parseSubmittedVersion(formData.get(VERSION_FIELD));
  if (!expectedVersion) return { message: STALE_RECORD };

  const conflicted = await prisma.$transaction(async (tx) => {
    // Editing the stage through the form moves the card to another column, and
    // it has to be given a position there. Without this it kept its old index
    // and collided with whatever already sat at that index; the board sorts
    // purely on position, so the order of the two became arbitrary and stayed
    // wrong until someone happened to drag a card and moveDeal resequenced.
    // Appended to the end, which is where moveDeal would put an unplaced card.
    let position: number | undefined;
    if (stageChanged) {
      const last = await tx.deal.findFirst({
        where: { stage: data.stage, id: { not: id } },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      position = (last?.position ?? -1) + 1;
    }

    const written = await tx.deal.updateMany({
      where: { id, updatedAt: expectedVersion },
      data: {
        ...data,
        ...amount,
        ...(position === undefined ? {} : { position }),
        expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null,
        closedAt: CLOSED_STAGES.has(data.stage)
          ? (existing.closedAt ?? new Date())
          : null,
        contactId: resolvedContactId,
        companyId: resolvedCompanyId,
      },
    });
    // Nothing else in this transaction wrote, so returning here leaves the
    // database untouched.
    if (written.count === 0) return true;

    // Audited inside the transaction: a change that committed without its entry
    // would make the log — which Settings presents as the record of what
    // happened — quietly incomplete.
    await audit(
      {
        action: stageChanged ? "deal.stage_change" : "deal.update",
        entityType: "deal",
        entityId: id,
        userId: user.id,
        metadata: stageChanged
          ? { from: existing.stage, to: data.stage }
          : undefined,
      },
      tx,
    );
    return false;
  });

  if (conflicted) return { message: STALE_RECORD };
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
  // The board rolls the card back and says so when this returns ok:false.
  if (!canMutate(deal.ownerId, user)) return { ok: false };

  const stageChanged = deal.stage !== stage;

  // The column read has to happen inside the transaction that rewrites it.
  // Reading first and then opening a batch transaction is a lost update: two
  // people dragging cards in the same column at the same time each computed
  // their new sequence from a snapshot taken before the other's writes landed,
  // and the second one silently overwrote the first.
  await prisma.$transaction(async (tx) => {
    const column = await tx.deal.findMany({
      where: { stage, id: { not: dealId } },
      orderBy: { position: "asc" },
      select: { id: true },
    });
    const ids = column.map((d) => d.id);
    ids.splice(Math.min(position, ids.length), 0, dealId);

    for (const [index, id] of ids.entries()) {
      await tx.deal.update({
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
      });
    }

    if (stageChanged) {
      await audit(
        {
          action: "deal.stage_change",
          entityType: "deal",
          entityId: dealId,
          userId: user.id,
          metadata: { from: deal.stage, to: stage, via: "kanban" },
        },
        tx,
      );
    }
  });
  revalidatePath("/deals");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteDeal(dealId: string): Promise<void> {
  const user = await requireUser();
  assertNotLockedDemoAccount(user);
  const id = idSchema.parse(dealId);

  const deal = await prisma.deal.findUnique({ where: { id } });
  if (!deal) return;
  if (!canMutate(deal.ownerId, user)) {
    throw new Error("FORBIDDEN: only the owner or an admin can delete");
  }

  // A delete and its record commit together: afterwards the entry is the only
  // evidence the row existed at all.
  await prisma.$transaction(async (tx) => {
    await tx.deal.delete({ where: { id } });
    await audit(
      {
        action: "deal.delete",
        entityType: "deal",
        entityId: id,
        userId: user.id,
        metadata: { title: deal.title },
      },
      tx,
    );
  });
  revalidatePath("/deals");
  revalidatePath("/dashboard");
}
