import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const isProd = process.env.NODE_ENV === "production";

// Next.js dev tooling needs eval/inline; production gets the stricter policy.
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // AI providers are called server-side only, so no external connect-src needed.
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker image; ignored by Vercel.
  output: "standalone",
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

// Browser events are posted to this app's own origin and forwarded server-side,
// so the CSP above can keep `connect-src 'self'` instead of allow-listing a
// Sentry ingest domain. proxy.ts must let the route through unauthenticated.
export const SENTRY_TUNNEL_ROUTE = "/monitoring";

export default withSentryConfig(nextConfig, {
  tunnelRoute: SENTRY_TUNNEL_ROUTE,

  // Source maps are uploaded only when CI supplies a token; a plain
  // `npm run build` (or a fork's build) must not fail for lack of one.
  silent: true,
  sourcemaps: { disable: !process.env.SENTRY_AUTH_TOKEN },

  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
});
