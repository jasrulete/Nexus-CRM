/**
 * Optimistic concurrency for the edit forms.
 *
 * Every edit used to be a blind full-field overwrite. Two people open the same
 * contact; A changes the phone number and saves; B, whose form still holds the
 * old phone, changes only the notes and saves — and B's submit writes every
 * field, silently reverting A's change with no conflict, no warning, and an
 * audit entry that records only "contact.update" with no diff.
 *
 * The guard is the row's own `updatedAt`, carried into the form as a hidden
 * field and used as part of the WHERE clause. If the row has moved on since the
 * form was rendered, nothing matches and nothing is written.
 *
 * `updateMany` rather than `update`, because Prisma's `update` requires a
 * unique WHERE and `updatedAt` is not unique. `updateMany` reports how many
 * rows it touched, which is exactly the signal needed: zero means someone got
 * there first.
 *
 * Verified against the database that a millisecond-precision timestamp survives
 * the round-trip through an ISO string and still matches — otherwise every save
 * would look like a conflict.
 */

export const STALE_RECORD =
  "This record changed while you were editing it. Reload the page to see the current version, then reapply your change.";

/** The hidden form field carrying the version the form was rendered from. */
export const VERSION_FIELD = "updatedAt";

/**
 * Reads the version out of a submitted form.
 *
 * Returns null for anything unusable — absent, empty, or unparseable. Callers
 * treat that as a conflict rather than skipping the check, so a form that
 * forgets the field fails loudly instead of silently reverting to
 * last-write-wins.
 */
export function parseSubmittedVersion(raw: FormDataEntryValue | null): Date | null {
  if (typeof raw !== "string" || raw === "") return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
