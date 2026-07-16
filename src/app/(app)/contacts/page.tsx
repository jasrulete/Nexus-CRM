import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search, Users } from "lucide-react";
import { prisma } from "@/lib/db";
import { CONTACT_STATUSES, CONTACT_STATUS_LABELS } from "@/lib/constants";
import { cn, fullName, timeAgo } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ContactStatusBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Table, THead, Th, TRow, Td } from "@/components/ui/table";
import { ContactFormDialog } from "@/components/contact-form-dialog";
import { ScorePill } from "@/components/score-pill";

export const metadata: Metadata = { title: "Contacts" };

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string }>;
}) {
  const { q, status } = await searchParams;
  const query = q?.trim() || undefined;
  const statusFilter = CONTACT_STATUSES.includes(
    status as (typeof CONTACT_STATUSES)[number],
  )
    ? status
    : undefined;

  const [contacts, companies] = await Promise.all([
    prisma.contact.findMany({
      where: {
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(query
          ? {
              OR: [
                { firstName: { contains: query } },
                { lastName: { contains: query } },
                { email: { contains: query } },
              ],
            }
          : {}),
      },
      include: {
        company: { select: { id: true, name: true } },
        owner: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: 100,
    }),
    prisma.company.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title="Contacts"
        subtitle={`${contacts.length} ${contacts.length === 1 ? "person" : "people"} in your workspace`}
        action={
          <ContactFormDialog
            companies={companies}
            trigger={
              <Button>
                <Plus className="h-4 w-4" /> New contact
              </Button>
            }
          />
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form className="relative" action="/contacts" method="GET">
          {statusFilter ? (
            <input type="hidden" name="status" value={statusFilter} />
          ) : null}
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            name="q"
            defaultValue={query ?? ""}
            placeholder="Search name or email…"
            className="w-64 pl-9"
            aria-label="Search contacts"
          />
        </form>
        <div className="flex items-center gap-1.5">
          <FilterChip href={buildHref(query, undefined)} active={!statusFilter}>
            All
          </FilterChip>
          {CONTACT_STATUSES.map((s) => (
            <FilterChip
              key={s}
              href={buildHref(query, s)}
              active={statusFilter === s}
            >
              {CONTACT_STATUS_LABELS[s]}
            </FilterChip>
          ))}
        </div>
      </div>

      <Card>
        {contacts.length === 0 ? (
          <EmptyState
            icon={Users}
            title={query || statusFilter ? "No matches" : "No contacts yet"}
            hint={
              query || statusFilter
                ? "Try a different search or filter."
                : "Add your first contact to start building relationships."
            }
          />
        ) : (
          <Table>
            <THead>
              <Th>Name</Th>
              <Th>Company</Th>
              <Th>Status</Th>
              <Th>AI score</Th>
              <Th>Owner</Th>
              <Th className="text-right">Updated</Th>
            </THead>
            <tbody>
              {contacts.map((c) => (
                <TRow key={c.id}>
                  <Td>
                    <Link
                      href={`/contacts/${c.id}`}
                      className="group flex items-center gap-3"
                    >
                      <Avatar name={fullName(c)} size="sm" />
                      <span>
                        <span className="block text-sm font-medium text-ink group-hover:text-accent">
                          {fullName(c)}
                        </span>
                        <span className="block text-[12px] text-ink-faint">
                          {c.title ?? c.email ?? "—"}
                        </span>
                      </span>
                    </Link>
                  </Td>
                  <Td className="text-ink-muted">
                    {c.company ? (
                      <Link
                        href={`/companies/${c.company.id}`}
                        className="hover:text-accent"
                      >
                        {c.company.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </Td>
                  <Td>
                    <ContactStatusBadge status={c.status} />
                  </Td>
                  <Td>
                    <ScorePill score={c.aiScore} />
                  </Td>
                  <Td className="text-ink-muted">{c.owner.name}</Td>
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

function buildHref(q: string | undefined, status: string | undefined) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (status) params.set("status", status);
  const qs = params.toString();
  return qs ? `/contacts?${qs}` : "/contacts";
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors",
        active
          ? "border-accent/40 bg-accent-soft text-accent"
          : "border-edge-strong/60 bg-surface text-ink-muted hover:bg-surface-2",
      )}
    >
      {children}
    </Link>
  );
}
