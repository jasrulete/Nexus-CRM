import * as Sentry from "@sentry/nextjs";

import { sentryEnabled, sharedSentryOptions } from "@/lib/sentry-options";

export async function register() {
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
