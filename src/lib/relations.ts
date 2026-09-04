import "server-only";
import { prisma } from "./db";

export type RelationName = "contact" | "deal" | "company";

/**
 * Confirms the relation ids a form supplied still point at rows that exist.
 *
 * `createActivity` and `createTask` wrote `contactId: contactId || null`
 * straight from the FormData — validation only checked the string's length —
 * so a stale open tab whose contact was deleted a moment earlier threw Prisma
 * P2003 out of an unguarded create. The user got the generic error boundary
 * instead of a field message, and lost whatever they had typed.
 *
 * Returns the first relation that is missing, or null when everything given
 * resolves. Ids that were not supplied are not checked — they are optional.
 */
export async function findMissingRelation(ids: {
  contactId?: string | null;
  dealId?: string | null;
  companyId?: string | null;
}): Promise<RelationName | null> {
  const select = { id: true };

  if (
    ids.contactId &&
    !(await prisma.contact.findUnique({ where: { id: ids.contactId }, select }))
  ) {
    return "contact";
  }
  if (
    ids.dealId &&
    !(await prisma.deal.findUnique({ where: { id: ids.dealId }, select }))
  ) {
    return "deal";
  }
  if (
    ids.companyId &&
    !(await prisma.company.findUnique({ where: { id: ids.companyId }, select }))
  ) {
    return "company";
  }
  return null;
}

/** Phrased for a form, where this is rendered. */
export function missingRelationMessage(relation: RelationName): string {
  return `That ${relation} no longer exists — refresh the page and try again.`;
}
