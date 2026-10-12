import "server-only";
import { OPEN_STAGES } from "@/lib/constants";
import type { WorkspaceContext } from "@/lib/workspace-context";

/**
 * The dashboard's aggregates. Every one is scoped to the caller's workspace by
 * ctx.db, including the task list: filtering on the assignee alone would show
 * a task from another workspace that happens to name this user.
 */
export async function loadDashboard(
  ctx: WorkspaceContext,
  opts: { newContactsSince: Date },
) {
  const [openDeals, closedDeals, newContacts, tasks, activities] = await Promise.all([
    ctx.db.deal.findMany({
      where: { stage: { in: [...OPEN_STAGES] } },
      select: { stage: true, baseValue: true },
    }),
    ctx.db.deal.findMany({
      where: { stage: { in: ["WON", "LOST"] } },
      select: { stage: true, baseValue: true, closedAt: true },
    }),
    ctx.db.contact.count({ where: { createdAt: { gte: opts.newContactsSince } } }),
    ctx.db.task.findMany({
      where: { assigneeId: ctx.user.id, done: false },
      orderBy: [{ dueDate: "asc" }, { createdAt: "desc" }],
      take: 7,
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    ctx.db.activity.findMany({
      orderBy: { createdAt: "desc" },
      take: 8,
      include: {
        user: { select: { name: true } },
        contact: { select: { id: true, firstName: true, lastName: true } },
        deal: { select: { id: true, title: true } },
      },
    }),
  ]);
  return { openDeals, closedDeals, newContacts, tasks, activities };
}
