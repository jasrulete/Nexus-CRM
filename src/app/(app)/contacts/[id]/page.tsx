import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Building2,
  CalendarClock,
  Mail,
  NotebookPen,
  Pencil,
  Phone,
  Tag,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { isLockedDemoAccount } from "@/lib/demo-guard";
import { formatCurrency, formatDate, fullName, timeAgo } from "@/lib/utils";
import { deleteContact } from "@/server/actions/contacts";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { ContactStatusBadge, StageBadge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { ActivityFeed } from "@/components/activity-feed";
import { ActivityComposer } from "@/components/activity-composer";
import { AiPanel } from "@/components/ai-panel";
import { ContactFormDialog } from "@/components/contact-form-dialog";
import { DeleteButton } from "@/components/delete-button";
import { QuickTaskForm } from "@/components/quick-task-form";
import { TaskList, type TaskItem } from "@/components/task-list";

export const metadata: Metadata = { title: "Contact" };

export default async function ContactDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const demoLocked = isLockedDemoAccount((await getCurrentUser()) ?? { email: "" });

  const [contact, companies] = await Promise.all([
    prisma.contact.findUnique({
      where: { id },
      include: {
        company: true,
        owner: { select: { name: true } },
        deals: { orderBy: { updatedAt: "desc" } },
        tasks: {
          where: { done: false },
          orderBy: [{ dueDate: "asc" }],
          take: 5,
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
    prisma.company.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!contact) notFound();

  const name = fullName(contact);
  const taskItems: TaskItem[] = contact.tasks.map((t) => ({
    id: t.id,
    title: t.title,
    done: t.done,
    dueDate: t.dueDate?.toISOString() ?? null,
    contact: null,
  }));

  const details: { icon: typeof Mail; label: string; value: React.ReactNode }[] = [
    {
      icon: Mail,
      label: "Email",
      value: contact.email ? (
        <a href={`mailto:${contact.email}`} className="text-accent hover:underline">
          {contact.email}
        </a>
      ) : (
        "—"
      ),
    },
    { icon: Phone, label: "Phone", value: contact.phone ?? "—" },
    {
      icon: Building2,
      label: "Company",
      value: contact.company ? (
        <Link href={`/companies/${contact.company.id}`} className="text-accent hover:underline">
          {contact.company.name}
        </Link>
      ) : (
        "—"
      ),
    },
    { icon: Tag, label: "Source", value: contact.source ?? "—" },
    {
      icon: CalendarClock,
      label: "Added",
      value: formatDate(contact.createdAt),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Link
        href="/contacts"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-ink-faint transition-colors hover:text-ink"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Contacts
      </Link>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Avatar name={name} size="lg" />
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-semibold tracking-tight text-ink">
                {name}
              </h1>
              <ContactStatusBadge status={contact.status} />
            </div>
            <p className="mt-0.5 text-sm text-ink-faint">
              {contact.title ? `${contact.title} · ` : ""}
              Owned by {contact.owner.name}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ContactFormDialog
            companies={companies}
            contact={{
              id: contact.id,
              firstName: contact.firstName,
              lastName: contact.lastName,
              email: contact.email,
              phone: contact.phone,
              title: contact.title,
              status: contact.status,
              source: contact.source,
              notes: contact.notes,
              companyId: contact.companyId,
            }}
            trigger={
              <Button variant="secondary" size="sm">
                <Pencil className="h-3.5 w-3.5" /> Edit
              </Button>
            }
          />
          <DeleteButton
            label="Delete"
            description={`This permanently removes ${name}, plus their activities and tasks.`}
            onConfirm={deleteContact.bind(null, contact.id)}
            disabledReason={demoLocked ? "Deleting is turned off in the shared demo, so the data stays intact for everyone." : undefined}
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
                  <dt className="w-16 shrink-0 text-[13px] text-ink-faint">
                    {d.label}
                  </dt>
                  <dd className="min-w-0 truncate text-[13px] text-ink">
                    {d.value}
                  </dd>
                </div>
              ))}
            </dl>
            {contact.notes ? (
              <div className="border-t border-edge/60 px-5 py-4">
                <p className="mb-1 text-[12px] font-medium uppercase tracking-wide text-ink-faint">
                  Notes
                </p>
                <p className="whitespace-pre-wrap text-[13px] leading-5 text-ink-muted">
                  {contact.notes}
                </p>
              </div>
            ) : null}
          </Card>

          <Card>
            <CardHeader
              title="AI insights"
              subtitle="Score, summarize or draft a follow-up"
            />
            <AiPanel
              contactId={contact.id}
              score={contact.aiScore}
              scoreReason={contact.aiScoreReason}
            />
          </Card>

          <Card>
            <CardHeader title="Open tasks" />
            <TaskList tasks={taskItems} />
            <div className={taskItems.length > 0 ? "border-t border-edge/60" : ""}>
              <QuickTaskForm contactId={contact.id} />
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Log activity" />
            <ActivityComposer contactId={contact.id} />
          </Card>

          {contact.deals.length > 0 ? (
            <Card>
              <CardHeader title="Deals" />
              <ul className="divide-y divide-edge/60">
                {contact.deals.map((d) => (
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
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Timeline" subtitle="Most recent first" />
            {contact.activities.length === 0 ? (
              <EmptyState
                icon={NotebookPen}
                title="No activity yet"
                hint="Log your first note, call or meeting above."
              />
            ) : (
              <ActivityFeed items={contact.activities} />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
