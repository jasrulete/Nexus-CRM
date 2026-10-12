import "server-only";
import type { WorkspaceContext } from "@/lib/workspace-context";

/** Loaders for /deals and /deals/[id], including the detail page's metadata. Reads go through ctx.db only. */

export async function loadDealsBoard(ctx: WorkspaceContext) {
  const [deals, contacts, companies] = await Promise.all([
    ctx.db.deal.findMany({
      include: {
        contact: { select: { id: true, firstName: true, lastName: true } },
        company: { select: { id: true, name: true } },
      },
      orderBy: { position: "asc" },
    }),
    ctx.db.contact.findMany({
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
    ctx.db.company.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { deals, contacts, companies };
}

/** Null when the id is not a deal in this workspace; the page answers 404. */
export async function loadDealDetail(ctx: WorkspaceContext, id: string) {
  const [deal, contacts, companies] = await Promise.all([
    ctx.db.deal.findUnique({
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
    ctx.db.contact.findMany({
      select: { id: true, firstName: true, lastName: true },
      orderBy: { firstName: "asc" },
    }),
    ctx.db.company.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return deal ? { deal, contacts, companies } : null;
}

/**
 * The document title for /deals/[id]. Read through the same scope as the page,
 * so a foreign deal id gives the generic title, never that deal's name.
 */
export async function loadDealTitle(ctx: WorkspaceContext, id: string): Promise<string | null> {
  const deal = await ctx.db.deal.findUnique({ where: { id }, select: { title: true } });
  return deal?.title ?? null;
}
