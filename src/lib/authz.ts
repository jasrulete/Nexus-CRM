/**
 * One place to decide "may this user change this record", and who counts as a
 * workspace admin.
 *
 * The five delete actions each carried their own copy of this predicate while
 * the update actions carried none, so a MEMBER could rewrite any contact,
 * company or deal in the shared workspace but not delete one — and overwriting
 * every field is as destructive as the delete that was blocked. Sharing the
 * predicate is what stops the next action added from forgetting it.
 *
 * The role is the workspace membership's role (spec §5.3), never the
 * deprecated `User.role`, so an admin's reach ends at their own workspace.
 * Every role check in the app goes through these two functions: the Settings
 * admin view, the roster badge and the user-menu label included.
 *
 * The owning field differs by model — `ownerId` on Company/Contact/Deal,
 * `assigneeId` on Task, `userId` on Activity — so the caller names it rather
 * than this guessing from the shape.
 */
export function isWorkspaceAdmin(role: string): boolean {
  return role === "OWNER" || role === "ADMIN";
}

export function canMutate(
  ownerId: string,
  actor: { id: string; role: string },
): boolean {
  return ownerId === actor.id || isWorkspaceAdmin(actor.role);
}

/** Shown in a form, so it is phrased for the person reading it. */
export const NOT_YOURS = "You can only edit records you own.";
