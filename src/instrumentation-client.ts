import * as Sentry from "@sentry/nextjs";

import { sentryEnabled, sharedSentryOptions } from "@/lib/sentry-options";

// No Session Replay integration on purpose: it records the DOM, and this app
// renders real contact details. Error reports are worth having; a video of
// someone's CRM is not.
if (sentryEnabled) {
  Sentry.init(sharedSentryOptions);
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
