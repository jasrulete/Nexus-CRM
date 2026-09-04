/**
 * The published demo account is a full ADMIN, and the landing page now invites
 * anyone to sign into it. Without this guard, a single visitor deleting records
 * would break the demo for everyone who looks at it afterwards.
 *
 * Only active when DEMO_MODE=true, so a self-hosted instance seeded with the
 * same demo account keeps full control of its own data.
 */

// Duplicated in login-form.tsx rather than shared: that is a client component,
// and importing server-side modules into it would pull them into the bundle.
export const DEMO_EMAIL = "demo@nexuscrm.dev";

/**
 * True when this instance is the shared, publicly-linked demo rather than a
 * private install.
 *
 * DEMO_MODE already means exactly this — it is only ever set on the deployment
 * whose credentials are published in the README — so the same flag now also
 * decides whether the sign-up copy is allowed to promise a private workspace.
 * It cannot: on the shared demo every record is visible to every visitor, the
 * published ADMIN account can edit it, and the nightly reset deletes it.
 */
export function isSharedDemoInstance(): boolean {
  return process.env.DEMO_MODE === "true";
}

export function isLockedDemoAccount(user: { email: string }): boolean {
  return process.env.DEMO_MODE === "true" && user.email === DEMO_EMAIL;
}

export function assertNotLockedDemoAccount(user: { email: string }): void {
  if (isLockedDemoAccount(user)) {
    throw new Error(
      "DEMO_READONLY: the shared demo account cannot delete records",
    );
  }
}
