"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/lib/action-state";
import { audit, auditTx } from "@/lib/audit";
import { assertNotLockedDemoAccount } from "@/lib/demo-guard";
import { canMutate, NOT_YOURS } from "@/lib/authz";
import { parseSubmittedVersion, STALE_RECORD, VERSION_FIELD } from "@/lib/concurrency";
import { getRateToWorkspaceCurrency } from "@/lib/fx";
import { convertAmount } from "@/lib/money";
import { checkRecordCap } from "@/lib/plans";
import { resolveRelation } from "@/lib/relations";
import { dealMoveSchema, dealSchema, fieldErrors, idSchema } from "@/lib/validation";
import { actorOf, requireWorkspace } from "@/lib/workspace-context";

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
  const ctx = await requireWorkspace();
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  // A count, then the create, with no transaction around them (spec §7). The
  // position transaction below is a separate concern and stays short.
  const capped = await checkRecordCap(ctx, "deals");
  if (capped) return { message: capped };

  const { contactId, companyId, expectedCloseDate, ...data } = parsed.data;

  const amount = await resolveAmount(data.value, data.currency);
  if (!amount) return { message: RATE_UNAVAILABLE };

  // Relations and the rate are resolved before the transaction opens: both can
  // be slow (the rate is a network call), neither depends on the position, and
  // inside the callback only `tx` may be used (spec §5.2). Through the scoped
  // client, another workspace's id resolves to null.
  const resolvedContactId = await resolveRelation(ctx.db, "contact", contactId);
  const resolvedCompanyId = await resolveRelation(ctx.db, "company", companyId);

  // The append position is a read-then-write, so it belongs in one transaction.
  // Outside it, two people adding a deal to the same column at the same moment
  // both read the same last position and both write it.
  const deal = await ctx.db.$transaction(async (tx) => {
    // A column is (workspaceId, stage). The scope adds the workspace too; it is
    // spelled out because position math is what the board renders.
    const last = await tx.deal.findFirst({
      where: { workspaceId: ctx.workspaceId, stage: data.stage },
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
        ownerId: ctx.user.id,
        workspaceId: ctx.workspaceId,
      },
    });
  });

  await audit(ctx.db, {
    action: "deal.create",
    entityType: "deal",
    entityId: deal.id,
    workspaceId: ctx.workspaceId,
    userId: ctx.user.id,
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
  const ctx = await requireWorkspace();
  const id = idSchema.parse(dealId);
  const parsed = parseForm(formData);
  if (!parsed.success) return { errors: fieldErrors(parsed.error) };

  const existing = await ctx.db.deal.findUnique({ where: { id } });
  if (!existing) return { message: "Deal not found" };
  // Returned, not thrown: this runs inside a useActionState form.
  if (!canMutate(existing.ownerId, actorOf(ctx))) return { message: NOT_YOURS };

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

  // Before the transaction, through the scoped client (spec §5.2, §5.4).
  const resolvedContactId = await resolveRelation(ctx.db, "contact", contactId);
  const resolvedCompanyId = await resolveRelation(ctx.db, "company", companyId);

  const expectedVersion = parseSubmittedVersion(formData.get(VERSION_FIELD));
  if (!expectedVersion) return { message: STALE_RECORD };

  const conflicted = await ctx.db.$transaction(async (tx) => {
    // Editing the stage through the form moves the card to another column, and
    // it has to be given a position there. Without this it kept its old index
    // and collided with whatever already sat at that index; the board sorts
    // purely on position, so the order of the two became arbitrary and stayed
    // wrong until someone happened to drag a card and moveDeal resequenced.
    // Appended to the end of this workspace's column, which is where moveDeal
    // would put an unplaced card.
    let position: number | undefined;
    if (stageChanged) {
      const last = await tx.deal.findFirst({
        where: { workspaceId: ctx.workspaceId, stage: data.stage, id: { not: id } },
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
    await auditTx(tx, {
      action: stageChanged ? "deal.stage_change" : "deal.update",
      entityType: "deal",
      entityId: id,
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      metadata: stageChanged ? { from: existing.stage, to: data.stage } : undefined,
    });
    return false;
  });

  if (conflicted) return { message: STALE_RECORD };
  revalidatePath("/deals");
  revalidatePath(`/deals/${id}`);
  revalidatePath("/dashboard");
  return { success: true };
}

/** Kanban drag-and-drop: move a deal to (stage, index) and resequence. */
export async function moveDeal(input: {
  dealId: string;
  stage: string;
  position: number;
}): Promise<{ ok: boolean }> {
  const ctx = await requireWorkspace();
  const parsed = dealMoveSchema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const { dealId, stage, position } = parsed.data;
  const deal = await ctx.db.deal.findUnique({ where: { id: dealId } });
  if (!deal) return { ok: false };
  // The board rolls the card back and says so when this returns ok:false.
  if (!canMutate(deal.ownerId, actorOf(ctx))) return { ok: false };

  const stageChanged = deal.stage !== stage;

  // The column read has to happen inside the transaction that rewrites it.
  // Reading first and then opening a batch transaction is a lost update: two
  // people dragging cards in the same column at the same time each computed
  // their new sequence from a snapshot taken before the other's writes landed,
  // and the second one silently overwrote the first.
  await ctx.db.$transaction(async (tx) => {
    // This workspace's column only: another workspace's cards in the same
    // stage are never read or renumbered (spec §4).
    const column = await tx.deal.findMany({
      where: { workspaceId: ctx.workspaceId, stage, id: { not: dealId } },
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
      await auditTx(tx, {
        action: "deal.stage_change",
        entityType: "deal",
        entityId: dealId,
        workspaceId: ctx.workspaceId,
        userId: ctx.user.id,
        metadata: { from: deal.stage, to: stage, via: "kanban" },
      });
    }
  });
  revalidatePath("/deals");
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteDeal(dealId: string): Promise<void> {
  const ctx = await requireWorkspace();
  assertNotLockedDemoAccount(ctx.user);
  const id = idSchema.parse(dealId);

  const deal = await ctx.db.deal.findUnique({ where: { id } });
  // Already gone (a stale tab, two people deleting, or another workspace's id):
  // the outcome the user asked for is true, so leave the page rather than
  // staying on a dead record.
  if (!deal) redirect("/deals");
  if (!canMutate(deal.ownerId, actorOf(ctx))) {
    throw new Error("FORBIDDEN: only the owner or an admin can delete");
  }

  // A delete and its record commit together: afterwards the entry is the only
  // evidence the row existed at all.
  await ctx.db.$transaction(async (tx) => {
    await tx.deal.delete({ where: { id } });
    await auditTx(tx, {
      action: "deal.delete",
      entityType: "deal",
      entityId: id,
      workspaceId: ctx.workspaceId,
      userId: ctx.user.id,
      metadata: { title: deal.title },
    });
  });
  revalidatePath("/deals");
  revalidatePath("/dashboard");
  // The deal page calls this; without the redirect it re-renders as a 404.
  redirect("/deals");
}
