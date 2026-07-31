import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  Globe,
  NotebookPen,
  Pencil,
  Users,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { isLockedDemoAccount } from "@/lib/demo-guard";
import { formatCurrency, fullName, timeAgo } from "@/lib/utils";
import { deleteCompany } from "@/server/actions/companies";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ContactStatusBadge, StageBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ActivityFeed } from "@/components/activity-feed";
import { ActivityComposer } from "@/components/activity-composer";
import { CompanyFormDialog } from "@/components/company-form-dialog";
import { DeleteButton } from "@/components/delete-button";

export const metadata: Metadata = { title: "Company" };

export default async function CompanyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const demoLocked = isLockedDemoAccount((await getCurrentUser()) ?? { email: "" });

  const company = await prisma.company.findUnique({
    where: { id },
    include: {
      owner: { select: { name: true } },
      contacts: { orderBy: { updatedAt: "desc" } },
      deals: { orderBy: { updatedAt: "desc" } },
      activities: {
        orderBy: { createdAt: "desc" },
        take: 15,
        include: {
          user: { select: { name: true } },
          contact: { select: { id: true, firstName: true, lastName: true } },
          deal: { select: { id: true, title: true } },
        },
      },
    },
  });

  if (!company) notFound();

  const openValue = company.deals
    .filter((d) => !["WON", "LOST"].includes(d.stage))
    .reduce((s, d) => s + d.value, 0);

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/companies"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-faint transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Companies
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-accent-soft text-accent">
            <Building2 className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">
              {company.name}
            </h1>
            <p className="mt-0.5 flex items-center gap-3 text-sm text-ink-faint">
              {company.industry ?? "Industry unknown"}
              {company.website ? (
                <a
                  href={company.website}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                >
                  <Globe className="h-3.5 w-3.5" />
                  {company.domain ?? "website"}
                </a>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <CompanyFormDialog
            company={{
              id: company.id,
              name: company.name,
              domain: company.domain,
              industry: company.industry,
              size: company.size,
              website: company.website,
              notes: company.notes,
            }}
            trigger={
              <Button variant="secondary" size="sm">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            }
          />
          <DeleteButton
            label="Delete"
            description={`This permanently removes ${company.name}. Contacts stay but lose the company link.`}
            onConfirm={deleteCompany.bind(null, company.id)}
            disabledReason={
              demoLocked
                ? "Deleting is turned off in the shared demo, so the data stays intact for everyone."
                : undefined
            }
          />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card className="p-5">
          <p className="text-[13px] font-medium text-ink-muted">Open pipeline</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-ink">
            {formatCurrency(openValue)}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-[13px] font-medium text-ink-muted">Contacts</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-ink">
            {company.contacts.length}
          </p>
        </Card>
        <Card className="p-5">
          <p className="text-[13px] font-medium text-ink-muted">Deals</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-ink">
            {company.deals.length}
          </p>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card>
            <CardHeader title="People" />
            {company.contacts.length === 0 ? (
              <EmptyState
                icon={Users}
                title="No contacts linked"
                hint="Assign contacts to this company from their profile."
              />
            ) : (
              <ul className="divide-y divide-edge/60">
                {company.contacts.map((c) => (
                  <li key={c.id}>
                    <Link
                      href={`/contacts/${c.id}`}
                      className="group flex items-center gap-3 px-5 py-3 transition-colors hover:bg-surface-2/60"
                    >
                      <Avatar name={fullName(c)} size="sm" />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink group-hover:text-accent">
                          {fullName(c)}
                        </span>
                        <span className="block text-[12px] text-ink-faint">
                          {c.title ?? c.email ?? "—"}
                        </span>
                      </span>
                      <ContactStatusBadge status={c.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardHeader title="Deals" />
            {company.deals.length === 0 ? (
              <EmptyState icon={NotebookPen} title="No deals yet" />
            ) : (
              <ul className="divide-y divide-edge/60">
                {company.deals.map((d) => (
                  <li
                    key={d.id}
                    className="flex items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-ink">
                        {d.title}
                      </p>
                      <p className="text-[12px] text-ink-faint">
                        Updated {timeAgo(d.updatedAt)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums text-ink">
                        {formatCurrency(d.value)}
                      </span>
                      <StageBadge stage={d.stage} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Log activity" />
            <ActivityComposer companyId={company.id} />
          </Card>
          <Card>
            <CardHeader title="Timeline" />
            {company.activities.length === 0 ? (
              <EmptyState
                icon={NotebookPen}
                title="No activity yet"
                hint="Log your first note, call or meeting above."
              />
            ) : (
              <ActivityFeed items={company.activities} />
            )}
          </Card>
          {company.notes ? (
            <Card>
              <CardHeader title="Notes" />
              <p className="whitespace-pre-wrap px-5 pb-5 text-[13px] leading-5 text-ink-muted">
                {company.notes}
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}
