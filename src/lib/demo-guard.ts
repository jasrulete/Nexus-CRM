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
