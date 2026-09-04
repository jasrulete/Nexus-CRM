/**
 * One place to decide "may this user change this record".
 *
 * The five delete actions each carried their own copy of this predicate while
 * the update actions carried none, so a MEMBER could rewrite any contact,
 * company or deal in the shared workspace but not delete one — and overwriting
 * every field is as destructive as the delete that was blocked. Sharing the
 * predicate is what stops the next action added from forgetting it.
 *
 * The owning field differs by model — `ownerId` on Company/Contact/Deal,
 * `assigneeId` on Task, `userId` on Activity — so the caller names it rather
 * than this guessing from the shape.
 */
export function canMutate(
  ownerId: string,
  user: { id: string; role: string },
): boolean {
  return ownerId === user.id || user.role === "ADMIN";
}

/** Shown in a form, so it is phrased for the person reading it. */
export const NOT_YOURS = "You can only edit records you own.";
