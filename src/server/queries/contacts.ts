import "server-only";
import type { WorkspaceContext } from "@/lib/workspace-context";

/**
 * Loaders for /contacts and /contacts/[id].
 *
 * Every read goes through ctx.db, the workspace-scoped client, so another
 * workspace's rows don't exist here: its ids read as "not found" and its rows
 * never reach a list. The pages parse their params and render; these own the
 * queries, so the cross-tenant suite can call them directly (spec §9.1).
 */

export async function loadContactsPage(
  ctx: WorkspaceContext,
  filters: { query?: string; status?: string },
) {
  const { query, status } = filters;
  const [contacts, companies] = await Promise.all([
    ctx.db.contact.findMany({
      where: {
        ...(status ? { status } : {}),
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
    ctx.db.company.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return { contacts, companies };
}

/** Null when the id is not a contact in this workspace; the page answers 404. */
export async function loadContactDetail(ctx: WorkspaceContext, id: string) {
  const [contact, companies] = await Promise.all([
    ctx.db.contact.findUnique({
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
    ctx.db.company.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return contact ? { contact, companies } : null;
}
