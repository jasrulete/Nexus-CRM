import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Plus } from "lucide-react";
import { prisma } from "@/lib/db";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Table, THead, Th, TRow, Td } from "@/components/ui/table";
import { CompanyFormDialog } from "@/components/company-form-dialog";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage() {
  const companies = await prisma.company.findMany({
    include: {
      _count: { select: { contacts: true, deals: true } },
      deals: {
        where: { stage: { in: ["LEAD", "QUALIFIED", "PROPOSAL", "NEGOTIATION"] } },
        select: { value: true },
      },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Companies"
        subtitle={`${companies.length} organization${companies.length === 1 ? "" : "s"}`}
        action={
          <CompanyFormDialog
            trigger={
              <Button>
                <Plus className="h-4 w-4" /> New company
              </Button>
            }
          />
        }
      />

      <Card>
        {companies.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No companies yet"
            hint="Add the organizations your contacts belong to."
          />
        ) : (
          <Table>
            <THead>
              <Th>Name</Th>
              <Th>Industry</Th>
              <Th>Size</Th>
              <Th>Contacts</Th>
              <Th>Open pipeline</Th>
              <Th className="text-right">Updated</Th>
            </THead>
            <tbody>
              {companies.map((c) => (
                <TRow key={c.id}>
                  <Td>
                    <Link
                      href={`/companies/${c.id}`}
                      className="group flex items-center gap-3"
                    >
                      <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-ink-faint">
                        <Building2 className="h-4 w-4" />
                      </span>
                      <span>
                        <span className="block text-sm font-medium text-ink group-hover:text-accent">
                          {c.name}
                        </span>
                        <span className="block text-[12px] text-ink-faint">
                          {c.domain ?? "—"}
                        </span>
                      </span>
                    </Link>
                  </Td>
                  <Td className="text-ink-muted">{c.industry ?? "—"}</Td>
                  <Td className="text-ink-muted">{c.size ?? "—"}</Td>
                  <Td className="tabular-nums text-ink-muted">
                    {c._count.contacts}
                  </Td>
                  <Td className="font-medium tabular-nums text-ink">
                    {formatCurrency(c.deals.reduce((s, d) => s + d.value, 0))}
                  </Td>
                  <Td className="text-right text-[13px] text-ink-faint">
                    {timeAgo(c.updatedAt)}
                  </Td>
                </TRow>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </div>
  );
}
