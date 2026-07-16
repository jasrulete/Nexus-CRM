import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { OPEN_STAGES } from "@/lib/constants";
import { formatCurrency, fullName } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { KanbanBoard } from "@/components/kanban/board";
import type { BoardDeal } from "@/components/kanban/deal-card";

export const metadata: Metadata = { title: "Deals" };

export default async function DealsPage() {
  const [deals, contacts, companies] = await Promise.all([
    prisma.deal.findMany({
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { position: "asc" },
    }),
    prisma.contact.findMany({
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
    prisma.company.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const boardDeals: BoardDeal[] = deals.map((d) => ({
    id: d.id,
    title: d.title,
    value: d.value,
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
    .reduce((s, d) => s + d.value, 0);

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader
        title="Deals"
        subtitle={`${formatCurrency(openValue)} in open pipeline — drag cards to update stage`}
      />
      <KanbanBoard
        deals={boardDeals}
        contacts={contacts.map((c) => ({ id: c.id, name: fullName(c) }))}
        companies={companies}
      />
    </div>
  );
}
