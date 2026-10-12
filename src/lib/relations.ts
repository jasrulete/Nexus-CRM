import "server-only";

export type RelationName = "contact" | "deal" | "company";

/**
 * One model that can answer "does a row with this id exist *for this client*".
 *
 * Structural, like audit's AuditWriter, so the scoped client (`ctx.db`), its
 * transaction client and the base client all satisfy it. There is
 * deliberately no module-level client in this file: every resolver takes the
 * caller's client as its first argument, so "resolved through the workspace
 * scope" is enforced by the signature (spec §5.4). Through `ctx.db`, another
 * workspace's id is simply not found, because the scope ANDs the workspace into
 * the lookup.
 */
type FindById = {
  findUnique(args: { where: { id: string }; select: { id: true } }): Promise<unknown>;
};

export type RelationReader = {
  contact: FindById;
  deal: FindById;
  company: FindById;
};

async function exists(model: FindById, id: string): Promise<boolean> {
  return Boolean(await model.findUnique({ where: { id }, select: { id: true } }));
}

/**
 * Confirms that the relation ids a form supplied still point at rows the caller
 * can see.
 *
 * `createActivity` and `createTask` used to write `contactId: contactId || null`
 * straight from the FormData. Validation only checked the string's length, so
 * a stale open tab whose contact had been deleted a moment earlier threw Prisma
 * P2003 out of an unguarded create. The user got the generic error boundary
 * instead of a field message, and lost whatever they had typed.
 *
 * Another workspace's id gets the same answer as a deleted record: "no longer
 * exists". That id may come from a tampered request, or from a tab left open
 * across a reset. Either way nothing is linked, and nothing in the other
 * workspace is touched.
 *
 * Returns the first relation that is missing, or null when everything given
 * resolves. Ids that were not supplied are not checked, because they are
 * optional. Call it before opening a transaction (spec §5.2).
 */
export async function findMissingRelation(
  db: RelationReader,
  ids: {
    contactId?: string | null;
    dealId?: string | null;
    companyId?: string | null;
  },
): Promise<RelationName | null> {
  if (ids.contactId && !(await exists(db.contact, ids.contactId))) return "contact";
  if (ids.dealId && !(await exists(db.deal, ids.dealId))) return "deal";
  if (ids.companyId && !(await exists(db.company, ids.companyId))) return "company";
  return null;
}

/**
 * The optional link on a contact or deal form. Returns the id if the caller can
 * see that record, otherwise null.
 *
 * A missing or foreign id drops the link rather than failing the save. That is
 * what these forms have always done for a record deleted under them. Call it
 * before opening a transaction (spec §5.2).
 */
export async function resolveRelation(
  db: RelationReader,
  model: "contact" | "company",
  relId: string | null | undefined,
): Promise<string | null> {
  if (!relId) return null;
  return (await exists(db[model], relId)) ? relId : null;
}

/** A contact's company link. See resolveRelation. */
export async function resolveCompanyId(
  db: RelationReader,
  companyId: string | null | undefined,
): Promise<string | null> {
  return resolveRelation(db, "company", companyId);
}

/** Phrased for a form, where this is rendered. */
export function missingRelationMessage(relation: RelationName): string {
  return `That ${relation} no longer exists — refresh the page and try again.`;
}
