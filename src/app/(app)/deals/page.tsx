import type { Metadata } from "next";
import { OPEN_STAGES } from "@/lib/constants";
import { formatCurrency, fullName } from "@/lib/utils";
import { requireWorkspacePage } from "@/lib/workspace-context";
import { loadDealsBoard } from "@/server/queries/deals";
import { PageHeader } from "@/components/page-header";
import { KanbanBoard } from "@/components/kanban/board";
import type { BoardDeal } from "@/components/kanban/deal-card";

export const metadata: Metadata = { title: "Deals" };

export default async function DealsPage() {
  const ctx = await requireWorkspacePage();
  const { deals, contacts, companies } = await loadDealsBoard(ctx);

  const boardDeals: BoardDeal[] = deals.map((d) => ({
    id: d.id,
    title: d.title,
    updatedAt: d.updatedAt.toISOString(),
    value: d.value,
    currency: d.currency,
    baseValue: d.baseValue,
    stage: d.stage,
    position: d.position,
    expectedCloseDate: d.expectedCloseDate?.toISOString() ?? null,
    contactId: d.contactId,
    contactName: d.contact ? fullName(d.contact) : null,
    companyId: d.companyId,
    companyName: d.company?.name ?? null,
  }));

  const openValue = deals
    .filter((d) => (OPEN_STAGES as string[]).includes(d.stage))
    .reduce((s, d) => s + d.baseValue, 0);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Deals"
        subtitle={`${formatCurrency(openValue)} in open pipeline — drag cards to update stage, open a card for its details`}
      />
      <KanbanBoard
        deals={boardDeals}
        contacts={contacts.map((c) => ({ id: c.id, name: fullName(c) }))}
        companies={companies}
      />
    </div>
  );
}
