import type { Metadata } from "next";
import Link from "next/link";
import { Building2, Plus, Search } from "lucide-react";
import { prisma } from "@/lib/db";
import { COMPANY_SIZES, OPEN_STAGES } from "@/lib/constants";
import { formatCurrency, timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { FilterChip } from "@/components/ui/filter-chip";
import { Input } from "@/components/ui/input";
import { Table, THead, Th, TRow, Td } from "@/components/ui/table";
import { CompanyFormDialog } from "@/components/company-form-dialog";

export const metadata: Metadata = { title: "Companies" };

const PAGE_SIZE = 100;

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; size?: string }>;
}) {
  const { q, size } = await searchParams;
  const query = q?.trim() || undefined;
  const sizeFilter = COMPANY_SIZES.includes(
    size as (typeof COMPANY_SIZES)[number],
  )
    ? size
    : undefined;

  const where = {
    ...(sizeFilter ? { size: sizeFilter } : {}),
    ...(query
      ? {
          OR: [
            { name: { contains: query } },
            { domain: { contains: query } },
            { industry: { contains: query } },
          ],
        }
      : {}),
  };

  const [companies, total] = await Promise.all([
    prisma.company.findMany({
      where,
      include: {
        _count: { select: { contacts: true, deals: true } },
        deals: {
          where: { stage: { in: [...OPEN_STAGES] } },
          select: { baseValue: true },
        },
      },
      orderBy: { updatedAt: "desc" },
      take: PAGE_SIZE,
    }),
    // Counted, not inferred from the page slice: past the cap the subtitle
    // used to state the cap itself as if it were the total.
    prisma.company.count({ where }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Companies"
        subtitle={subtitle(total, companies.length, Boolean(query || sizeFilter))}
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="relative" action="/companies" method="GET">
          {sizeFilter ? (
            <input type="hidden" name="size" value={sizeFilter} />
          ) : null}
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            name="q"
            defaultValue={query ?? ""}
            placeholder="Search name, domain or industry…"
            className="w-72 pl-9"
            aria-label="Search companies"
          />
        </form>
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterChip href={buildHref(query, undefined)} active={!sizeFilter}>
            All sizes
          </FilterChip>
          {COMPANY_SIZES.map((s) => (
            <FilterChip
              key={s}
              href={buildHref(query, s)}
              active={sizeFilter === s}
            >
              {s}
            </FilterChip>
          ))}
        </div>
      </div>

      <Card>
        {companies.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={query || sizeFilter ? "No matches" : "No companies yet"}
            hint={
              query || sizeFilter
                ? "Try a different search or clear the size filter."
                : "Add the organizations your contacts belong to."
            }
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
                    {formatCurrency(c.deals.reduce((s, d) => s + d.baseValue, 0))}
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

function subtitle(total: number, shown: number, filtered: boolean) {
  const noun = `organization${total === 1 ? "" : "s"}`;
  const scope = filtered ? " matching" : "";
  return shown < total
    ? `Showing ${shown} of ${total}${scope} ${noun}`
    : `${total}${scope} ${noun}`;
}

function buildHref(q: string | undefined, size: string | undefined) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (size) params.set("size", size);
  const qs = params.toString();
  return qs ? `/companies?${qs}` : "/companies";
}
