# Landing page — design

Date: 2026-07-28

## Problem

`/` redirects straight to `/login`. A recruiter opening the deployed URL hits an
auth wall and learns nothing about the project. SAAS-READINESS.md ranks this the
highest-visibility gap for a portfolio piece.

## Goal

A public marketing page at `/` that reads as a real product, with the portfolio
context available for anyone who scrolls. Success: an unauthenticated visitor
sees what Nexus CRM is, what it's built with, and can reach the live demo in one
click.

## Decisions

- **Framing:** product-first, with a portfolio attribution footer. Not a case
  study — the page should look like a product a team would use.
- **Hero visual:** real screenshots of the running app, captured with Playwright
  against the seeded demo. Dark theme only; one polished shot beats two
  mediocre ones, and it matches the existing dark auth brand panel.
- **Scope:** single scroll — nav, hero, three feature cards, tech-stack strip,
  footer. Recruiters skim.
- **Voice:** reuses the copy already in `src/app/(auth)/layout.tsx` rather than
  inventing a second brand voice.

## Architecture

Five server components under `src/components/landing/`, composed by
`src/app/page.tsx`:

| Component | Responsibility |
|---|---|
| `landing-nav` | Brand lockup, GitHub link, Sign in / Try demo actions |
| `hero` | Headline, subhead, dual CTA, product screenshot |
| `feature-grid` | Three pillars: pipeline, AI, security |
| `stack-strip` | Technology list — highest-signal element for an engineer |
| `landing-footer` | Portfolio attribution, repo link |

Each takes no props and owns one band of the page, so any one can be rewritten
without touching the others. No client components; the page stays statically
prerendered (`○` in the build output), so it costs nothing to serve.

## Routing

Two changes:

1. `src/proxy.ts` — add `"/"` to `PUBLIC_PATHS`. Today `/` falls through to the
   `!hasSessionCookie` branch and redirects to `/login`, so the page never
   renders for a logged-out visitor.
2. `src/app/page.tsx` — replace `redirect("/dashboard")` with the landing page.

Authenticated behaviour is preserved exactly: the `PUBLIC_PATHS` branch already
redirects signed-in visitors to `/dashboard`. The redirect moves from the page
into the proxy.

## Screenshots

`scripts/capture-marketing-shots.ts` drives Playwright against a running dev
server: signs in via the demo button, forces dark theme by setting
`localStorage.theme`, captures `/dashboard` and `/deals` at 1440×900 @2x into
`public/marketing/`.

Images are committed, so builds and deploys never depend on capture. Rendered
via `next/image` with static imports, which carry intrinsic dimensions and
prevent layout shift. The existing CSP allows `img-src 'self'`, so no config
change is needed.

## Error handling

None required. The page is static: no data fetching, no user input, no network
calls. Stated explicitly so no one invents failure modes for it later.

## Testing

`e2e/marketing.spec.ts`, matching the existing convention that UI is covered by
e2e rather than component unit tests:

1. Unauthenticated `/` renders the hero instead of redirecting to `/login`.
2. The demo CTA reaches `/login`.
3. A signed-in visitor at `/` still lands on `/dashboard` — the regression guard
   for the proxy change.

## Found while implementing

Two pre-existing bugs surfaced building this, both fixed here because the
landing page cannot ship correctly without them:

1. **Dark mode never applied to public pages.** The proxy matcher excluded image
   extensions but not `.js`, so `/theme-init.js` was caught by the auth gate and
   answered `307 → /login` for signed-out visitors. A visitor whose OS is dark
   got a light landing and login page, then a dark app after signing in.
   `theme-init.js` is now excluded explicitly.
2. **Local runs pointed at the production database.** `.env` carried a populated
   `TURSO_DATABASE_URL` and no `DATABASE_URL`, and `createDbAdapter()` preferred
   Turso unconditionally — so `next dev`, `next start` and the e2e suite all
   reached production. Production already held 9 `Playwright E2E…` contacts from
   past runs. `createDbAdapter()` now ignores Turso outside Vercel unless
   `ALLOW_REMOTE_DB=true`, covered by `src/lib/db-adapter.test.ts`.

## Out of scope

`/about`, pricing, FAQ, light-mode screenshots, animation libraries. A second
marketing route would justify a `(marketing)` route group with its own layout;
one page does not.
