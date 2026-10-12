import * as Sentry from "@sentry/nextjs";

import { sentryEnabled, sharedSentryOptions } from "@/lib/sentry-options";
import { assertBootConfig } from "@/lib/workspace-mode";

export async function register() {
  // First, before any early return (spec §6): a deployment whose mode is
  // missing in production, unknown, or multi with DEMO_MODE on must not boot.
  const mode = assertBootConfig();

  // Single mode also refuses a database that belongs to a multi deployment:
  // more than one workspace, a PAID one, or a lone one single mode did not
  // create, and one whose migrations were not applied. A transient read failure is only logged: a rejection here is
  // cached for the life of the process and would fail every request. Node
  // only — the edge runtime has no database client.
  if (process.env.NEXT_RUNTIME === "nodejs" && mode === "single") {
    const { assertSingleModeBoot } = await import("@/lib/db");
    await assertSingleModeBoot();
  }

  if (!sentryEnabled) return;

  // Both server runtimes take the same options; they are initialised
  // separately because Next loads them as distinct bundles.
  if (
    process.env.NEXT_RUNTIME === "nodejs" ||
    process.env.NEXT_RUNTIME === "edge"
  ) {
    Sentry.init(sharedSentryOptions);
  }
}

// Next calls this for errors thrown in server components, route handlers and
// server actions — the ones that were previously just a console.error.
export const onRequestError = Sentry.captureRequestError;
