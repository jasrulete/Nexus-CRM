import "server-only";
import { OPEN_STAGES } from "@/lib/constants";
import type { WorkspaceContext } from "@/lib/workspace-context";

/** Loaders for /companies and /companies/[id]. Reads go through ctx.db only. */

const PAGE_SIZE = 100;

export async function loadCompaniesPage(
  ctx: WorkspaceContext,
  filters: { query?: string; size?: string },
) {
  const { query, size } = filters;
  const where = {
    ...(size ? { size } : {}),
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
    ctx.db.company.findMany({
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
    ctx.db.company.count({ where }),
  ]);
  return { companies, total };
}

/** Null when the id is not a company in this workspace; the page answers 404. */
export async function loadCompanyDetail(ctx: WorkspaceContext, id: string) {
  return ctx.db.company.findUnique({
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
}
