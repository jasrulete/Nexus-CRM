/**
 * Shared Sentry settings for the browser, Node and edge runtimes.
 *
 * The DSN is deliberately optional: with no DSN configured, init() is skipped
 * entirely and the app behaves exactly as it did before. That keeps the repo
 * runnable by anyone who clones it without a Sentry account.
 */
export const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN;

export const sentryEnabled = Boolean(SENTRY_DSN);

export const sharedSentryOptions = {
  dsn: SENTRY_DSN,

  // This is a CRM. Never attach cookies, headers or user identifiers to an
  // event — an error report must not become a customer-data leak.
  sendDefaultPii: false,

  // Free tier is 5k errors/month. Errors are the point here; traces are
  // sampled lightly so a traffic spike cannot exhaust the quota.
  tracesSampleRate: 0.1,

  // Local runs would otherwise burn quota on errors nobody is triaging.
  enabled: process.env.NODE_ENV === "production",

  environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV,
};
