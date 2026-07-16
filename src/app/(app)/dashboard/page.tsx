import type { Metadata } from "next";
import {
  CalendarCheck2,
  CircleDollarSign,
  KanbanSquare,
  ListTodo,
  Trophy,
  UserPlus,
} from "lucide-react";
import { getCurrentUser } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { OPEN_STAGES, STAGE_LABELS } from "@/lib/constants";
import { formatCurrency } from "@/lib/utils";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/stat-card";
import { ActivityFeed } from "@/components/activity-feed";
import { TaskList, type TaskItem } from "@/components/task-list";
import { QuickTaskForm } from "@/components/quick-task-form";
import { PipelineChart } from "@/components/charts/pipeline-chart";
import { RevenueChart } from "@/components/charts/revenue-chart";

export const metadata: Metadata = { title: "Dashboard" };

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Impure date math lives outside the component body (React purity rules).
function timeWindows() {
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000);
  return { sixMonthsAgo, thirtyDaysAgo };
}

export default async function DashboardPage() {
  const user = (await getCurrentUser())!;
  const { sixMonthsAgo, thirtyDaysAgo } = timeWindows();

  const [openDeals, closedDeals, newContacts, tasks, activities] =
    await Promise.all([
      prisma.deal.findMany({
        where: { stage: { in: [...OPEN_STAGES] } },
        select: { stage: true, value: true },
      }),
      prisma.deal.findMany({
        where: { stage: { in: ["WON", "LOST"] } },
        select: { stage: true, value: true, closedAt: true },
      }),
      prisma.contact.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.task.findMany({
        where: { assigneeId: user.id, done: false },
        orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
        take: 7,
        include: {
          contact: { select: { id: true, firstName: true, lastName: true } },
        },
      }),
      prisma.activity.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: {
          user: { select: { name: true } },
          contact: { select: { id: true, firstName: true, lastName: true } },
          deal: { select: { id: true, title: true } },
        },
      }),
    ]);

  const pipelineValue = openDeals.reduce((s, d) => s + d.value, 0);
  const wonDeals = closedDeals.filter((d) => d.stage === "WON");
  const winRate =
    closedDeals.length > 0
      ? Math.round((wonDeals.length / closedDeals.length) * 100)
      : null;

  const pipelineData = OPEN_STAGES.map((stage) => {
    const deals = openDeals.filter((d) => d.stage === stage);
    return {
      stage,
      label: STAGE_LABELS[stage],
      value: deals.reduce((s, d) => s + d.value, 0),
      count: deals.length,
    };
  });

  const months: { month: string; value: number }[] = [];
  const cursor = new Date(sixMonthsAgo);
  for (let i = 0; i < 6; i++) {
    const key = monthKey(cursor);
    const label = cursor.toLocaleDateString("en-US", { month: "short" });
    const value = wonDeals
      .filter((d) => d.closedAt && monthKey(d.closedAt) === key)
      .reduce((s, d) => s + d.value, 0);
    months.push({ month: label, value });
    cursor.setMonth(cursor.getMonth() + 1);
  }

  const taskItems: TaskItem[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    done: t.done,
    dueDate: t.dueDate?.toISOString() ?? null,
    contact: t.contact,
  }));

  const firstName = user.name.split(" ")[0];

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight text-ink">
          Good {greeting()}, {firstName}
        </h1>
        <p className="mt-1 text-sm text-ink-faint">
          Here&apos;s what&apos;s happening across your pipeline.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open pipeline"
          value={formatCurrency(pipelineValue)}
          hint={`${openDeals.length} open deal${openDeals.length === 1 ? "" : "s"}`}
          icon={CircleDollarSign}
        />
        <StatCard
          label="Won (all time)"
          value={formatCurrency(wonDeals.reduce((s, d) => s + d.value, 0))}
          hint={`${wonDeals.length} closed-won deal${wonDeals.length === 1 ? "" : "s"}`}
          icon={Trophy}
        />
        <StatCard
          label="Win rate"
          value={winRate === null ? "—" : `${winRate}%`}
          hint="of all closed deals"
          icon={KanbanSquare}
        />
        <StatCard
          label="New contacts"
          value={String(newContacts)}
          hint="in the last 30 days"
          icon={UserPlus}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Pipeline by stage"
            subtitle="Open deal value in each stage"
          />
          <PipelineChart data={pipelineData} />
        </Card>
        <Card>
          <CardHeader
            title="Revenue won"
            subtitle="Closed-won value per month, last 6 months"
          />
          <RevenueChart data={months} />
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="My tasks" subtitle="Open items assigned to you" />
          <TaskList tasks={taskItems} />
          {taskItems.length === 0 ? (
            <EmptyState
              icon={ListTodo}
              title="All clear"
              hint="No open tasks. Add one below."
            />
          ) : null}
          <div className="border-t border-edge/60">
            <QuickTaskForm />
          </div>
        </Card>
        <Card>
          <CardHeader title="Recent activity" subtitle="Latest touchpoints across the team" />
          {activities.length === 0 ? (
            <EmptyState
              icon={CalendarCheck2}
              title="No activity yet"
              hint="Notes, calls and meetings you log will show up here."
            />
          ) : (
            <ActivityFeed items={activities} />
          )}
        </Card>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 18) return "afternoon";
  return "evening";
}
