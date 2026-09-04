import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CalendarCheck2,
  CalendarClock,
  CalendarDays,
  CircleDollarSign,
  NotebookPen,
  Target,
  User,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { isLockedDemoAccount } from "@/lib/demo-guard";
import { cn, formatDate, formatDateOnly, fullName, isOverdueDateOnly } from "@/lib/utils";
import { formatDealAmount } from "@/lib/money";
import { deleteDeal } from "@/server/actions/deals";
import { Card, CardHeader } from "@/components/ui/card";
import { StageBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ActivityFeed } from "@/components/activity-feed";
import { ActivityComposer } from "@/components/activity-composer";
import { DealEditButton } from "@/components/deal-edit-button";
import { DeleteButton } from "@/components/delete-button";
import { QuickTaskForm } from "@/components/quick-task-form";
import { TaskList, type TaskItem } from "@/components/task-list";

// The document title is the first thing a screen reader announces after the
// board's Enter/click navigation; a static "Deal" was one letter away from
// "Deals", the page the user had just left.
export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const deal = await prisma.deal.findUnique({ where: { id }, select: { title: true } });
  return { title: deal?.title ?? "Deal" };
}

/**
 * Where a deal's relations come together. Until this page existed, deals were
 * kanban cards and an edit dialog: the seed attached activities to deals that
 * no screen could show, and a task "for" a deal was reachable only from its
 * contact. The board now opens this page on click; editing lives here.
 */
export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const demoLocked = isLockedDemoAccount((await getCurrentUser()) ?? { email: "" });

  const [deal, contacts, companies] = await Promise.all([
    prisma.deal.findUnique({
      where: { id },
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        company: { select: { id: true, name: true } },
        owner: { select: { name: true } },
        tasks: {
          where: { done: false },
          orderBy: [{ dueDate: "asc" }],
          take: 5,
          include: {
            contact: { select: { id: true, firstName: true, lastName: true } },
          },
        },
        activities: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            user: { select: { name: true } },
            contact: { select: { id: true, firstName: true, lastName: true } },
            deal: { select: { id: true, title: true } },
          },
        },
      },
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

  if (!deal) notFound();

  const overdue =
    isOverdueDateOnly(deal.expectedCloseDate?.toISOString() ?? null) &&
    !["WON", "LOST"].includes(deal.stage);

  const taskItems: TaskItem[] = deal.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    done: t.done,
    dueDate: t.dueDate?.toISOString() ?? null,
    contact: t.contact,
  }));

  const details: { icon: typeof User; label: string; value: React.ReactNode }[] = [
    { icon: CircleDollarSign, label: "Amount", value: formatDealAmount(deal) },
    { icon: Target, label: "Stage", value: <StageBadge stage={deal.stage} /> },
    {
      icon: User,
      label: "Contact",
      value: deal.contact ? (
        <Link href={`/contacts/${deal.contact.id}`} className="text-accent hover:underline">
          {fullName(deal.contact)}
        </Link>
      ) : (
        "—"
      ),
    },
    {
      icon: Building2,
      label: "Company",
      value: deal.company ? (
        <Link href={`/companies/${deal.company.id}`} className="text-accent hover:underline">
          {deal.company.name}
        </Link>
      ) : (
        "—"
      ),
    },
    {
      icon: CalendarDays,
      label: "Expected",
      // Said in words, not only in colour: the card turns the date red, and a
      // page that is now the deal's canonical view has to carry the same fact.
      value: deal.expectedCloseDate ? (
        <span className={cn(overdue && "font-medium text-danger")}>
          {formatDateOnly(deal.expectedCloseDate.toISOString())}
          {overdue ? " · overdue" : ""}
        </span>
      ) : (
        "—"
      ),
    },
    {
      icon: CalendarCheck2,
      label: "Closed",
      value: deal.closedAt ? formatDate(deal.closedAt) : "—",
    },
    { icon: CalendarClock, label: "Created", value: formatDate(deal.createdAt) },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/deals"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-faint transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Deals
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-xl font-semibold tracking-tight text-ink">{deal.title}</h1>
            <StageBadge stage={deal.stage} />
          </div>
          <p className="mt-0.5 text-sm text-ink-faint">
            <span className="font-semibold tabular-nums text-ink">{formatDealAmount(deal)}</span>
            {" · "}Owned by {deal.owner.name}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DealEditButton
            deal={{
              id: deal.id,
              updatedAt: deal.updatedAt.toISOString(),
              title: deal.title,
              value: deal.value,
              currency: deal.currency,
              stage: deal.stage,
              expectedCloseDate: deal.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
              contactId: deal.contactId,
              companyId: deal.companyId,
            }}
            contacts={contacts.map((c) => ({ id: c.id, name: fullName(c) }))}
            companies={companies}
          />
          <DeleteButton
            label="Delete"
            description={`This permanently removes "${deal.title}" and its activities and tasks.`}
            onConfirm={deleteDeal.bind(null, deal.id)}
            disabledReason={
              demoLocked
                ? "Deleting is turned off in the shared demo, so the data stays intact for everyone."
                : undefined
            }
          />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[340px_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Details" />
            <dl className="space-y-3 px-5 pb-5">
              {details.map((d) => (
                <div key={d.label} className="flex items-center gap-3">
                  <d.icon className="h-4 w-4 shrink-0 text-ink-faint" />
                  <dt className="w-16 shrink-0 text-[13px] text-ink-faint">{d.label}</dt>
                  <dd className="min-w-0 truncate text-[13px] text-ink">{d.value}</dd>
                </div>
              ))}
            </dl>
          </Card>

          <Card>
            <CardHeader title="Open tasks" />
            <TaskList tasks={taskItems} />
            <div className={taskItems.length > 0 ? "border-t border-edge/60" : ""}>
              <QuickTaskForm dealId={deal.id} contactId={deal.contactId ?? undefined} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Log activity" />
            <ActivityComposer dealId={deal.id} contactId={deal.contactId ?? undefined} />
          </Card>

          <Card>
            <CardHeader title="Timeline" subtitle="Most recent first" />
            {deal.activities.length === 0 ? (
              <EmptyState
                icon={NotebookPen}
                title="No activity yet"
                hint="Log your first note, call or meeting above."
              />
            ) : (
              <ActivityFeed items={deal.activities} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
