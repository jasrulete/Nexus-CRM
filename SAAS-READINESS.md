# Nexus CRM — SaaS readiness report

First audit: 2026-07-25 — six parallel audits (security/auth, authorization,
input & secrets, data, frontend, infra/CI/observability), then fixes applied and
verified.

Second pass: 2026-08-01 — shipped the landing page and error tracking, and fixed
three bugs found along the way (§2).

Everything marked "fixed" was verified by typecheck, lint, unit tests, Playwright
e2e tests, and a production build. Current suite: **67 unit tests, 12 e2e tests**.

---

## 1. Fixed in the 2026-07-25 pass

### Security
| Issue | Severity | Fix |
|---|---|---|
| Next.js 16.2.10 carried 4 high advisories, incl. a proxy/middleware bypass matching this app's auth gate | High | Patched to 16.2.11 |
| Login rate limit keyed on client-controlled `x-forwarded-for` — spoof the header, get an unlimited bucket | Medium | Prefer platform-set `x-vercel-forwarded-for`/`x-real-ip`; added a per-account failure bucket that header spoofing cannot reset |
| Successful logins consumed the brute-force budget, so a shared demo account throttled its own visitors (caught by e2e) | Medium | Both buckets now count failed attempts only |
| `toggleTask` had no ownership check, unlike `deleteTask` — any member could flip anyone's task | Medium | Assignee-or-admin check, matching its sibling actions |
| Missing `TURSO_DATABASE_URL` on Vercel silently fell back to a local SQLite file on an ephemeral filesystem | Medium | Fails fast at boot with an explicit message |
| `npm run db:seed` loaded `.env` and targeted **production Turso** — it would have written a publicly-documented ADMIN account there | High | Seeds locally by default; remote requires `SEED_REMOTE=true` |

### Deploy path
- **Turso migrations were a landmine.** The applier replayed every migration with
  no ledger, so the *second* migration would fail on `CREATE TABLE` and never
  apply. Now tracked in `_turso_migrations`, applying only what's missing, and it
  baselines an existing database on first run.
- Health endpoint `GET /api/health` (`SELECT 1`), exempted from the auth proxy —
  for uptime monitors and container healthchecks. Verified: 200 `{"status":"ok"}`
  unauthenticated.
- CI now runs `lint`, plus Playwright e2e against the **production build** with a
  seeded database; added concurrency cancellation, a 15-min timeout, least
  privilege `contents: read`, and failure-report artifacts.

### Resilience & UX
- Added `error.tsx`, `global-error.tsx`, `not-found.tsx` (root + app shell) and a
  shared `loading.tsx` skeleton — previously any server error showed Next's raw
  default screen and every navigation froze on the old page.
- Kanban drags no longer fail silently: a rejected move rolls the board back and
  says so. Task toggle/delete surface errors instead of doing nothing.
- `OpenGraph`/Twitter metadata + a generated OG image, so a shared link renders a
  real preview card.

### Accessibility
- Account menu had no accessible name (icon-only button) — added.
- Dark-mode accent failed WCAG AA in **both** roles (link text 4.18:1, button
  text 4.23:1). Retuned tokens: link text now 6.5:1, button text 5.9:1, badges
  5.6:1 — fixed with token changes only, no component edits. Light mode already
  passed (5.3–7.1:1).

### Data
- Added the missing indexes on `Deal.contactId`, `Deal.companyId`,
  `Task.contactId`, `Task.dealId` — each was a full table scan on contact and
  company detail pages (migration `add_deal_task_fk_indexes`).

---

## 2. Fixed in the 2026-08-01 pass

### Shipped
- **Public landing page at `/`.** It used to redirect straight to `/login`, so
  anyone opening the deployed URL hit an auth wall. Now a single-scroll
  marketing page with real product screenshots, captured by
  `npm run capture:shots` and committed. `/` still prerenders as static.
  Screenshots exist in both themes and are swapped with the `dark:` class
  variant, not `prefers-color-scheme` — the app's source of truth is the
  `.dark` class `theme-init.js` sets from localStorage, which can disagree with
  the OS. The hidden variant is lazy and never fetched (~70 KB of images per
  page load either way).
- **The e2e suite now runs against the Docker artifact.** CI used to serve
  `next start`, which Next warns does not work with `output: "standalone"`, so
  the `.next/standalone/server.js` the image actually ships was never executed
  by a test. `npm run start:standalone` assembles the bundle the way the
  Dockerfile's runner stage does — `next build` leaves out `.next/static` and
  `public/` — and Playwright serves that in CI. It also pins a relative `file:`
  `DATABASE_URL` to an absolute path first, because `server.js` chdirs into its
  own directory and would otherwise open a different, empty database.
- **Error tracking (Sentry).** Wired to the Next 16 instrumentation hooks, so
  server component / route handler / server action errors are reported instead
  of vanishing into `console.error`. Browser events tunnel through `/monitoring`
  on this app's own origin, which keeps the CSP at `connect-src 'self'` rather
  than allow-listing a third-party domain — and it handles Sentry's regional
  ingest hosts automatically. `sendDefaultPii` is off and Session Replay is
  deliberately absent: this app renders real contact records.

### Bugs found while building the above
| Issue | Severity | Fix |
|---|---|---|
| **Local development wrote to the production database.** `.env` carried a populated `TURSO_DATABASE_URL` and no `DATABASE_URL`, and `createDbAdapter()` preferred Turso unconditionally — so `next dev`, `next start` and the whole e2e suite connected to production. It had already deposited 9 `Playwright E2E…` contacts there, a third of the contact list | High | Turso is ignored outside Vercel unless `ALLOW_REMOTE_DB=true`. The `db:seed` guard existed but was never extended to the app itself. Docker is unaffected (local file volume). The junk contacts were deleted |
| **Dark mode never applied to signed-out visitors.** The proxy matcher excluded image extensions but not `.js`, so `/theme-init.js` was auth-gated and answered `307 → /login`. A dark-mode visitor got a light landing and login page, then a dark app after signing in | Medium | `theme-init.js` excluded from the matcher explicitly |
| **The e2e suite failed locally on every run** while passing in CI, because dev compiles routes on first request and overran Playwright's 5s assertion and 30s per-test defaults | Low | Headroom for local runs only; CI keeps the defaults |

### Nightly demo reset
A scheduled GitHub Actions workflow rebuilds the demo workspace each night:
every CRM row is deleted and re-seeded, while the `User` table is left alone so
real logins survive. `DEMO_MODE` blocks deletion but not creation or edits, so
without this the demo drifts from the state a recruiter should see.

Deliberately a scheduled workflow rather than a Vercel cron hitting a protected
route — that would mean publishing a URL whose job is to erase the database.
Needs `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` as repository secrets. Run it
on demand from the Actions tab, or locally with `npm run demo:reset` (which
targets the local database unless `ALLOW_REMOTE_DB=true`).

### Demo protection
`DEMO_MODE=true` blocks the shared demo account from deleting records. This
became necessary the moment `/` started publicly inviting visitors to the demo —
the account is a full ADMIN, so one visitor could have wiped it for everyone
after them. Creating and editing stay allowed so the demo still feels live.

---

## 3. Deploy checklist

Both of these are inert without their environment variable, by design — a clone
or self-hosted instance is unaffected.

| Variable | Where | Effect |
|---|---|---|
| `DEMO_MODE=true` | Vercel (Production) | Demo account cannot delete records |
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel (Production) | Errors report to Sentry |

`NEXT_PUBLIC_*` values are inlined at **build** time, so a redeploy that reuses
the build cache will not pick up a changed DSN.

Optional: `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN` upload source maps
so stack traces name real files. Builds succeed without them.

Database migrations reach production with `npm run db:push:turso` — the script
baselines an existing database, then applies only what is missing.

---

## 4. Known gaps — accepted, with reasoning

These are **deliberate** for a portfolio demo. Listed so the choice is explicit.

| Gap | Why it's acceptable now | What "real SaaS" needs |
|---|---|---|
| **Visitors can still create junk** in the shared demo (deleting is blocked, see §2) | Only deliberate additions accumulate, and a scoped cleanup script clears them | A nightly reset job, which would also undo edits |
| **Open registration into one shared workspace** — anyone can self-register and see all CRM data | It's a single-tenant showcase, not customer data | Invite-only registration, or real multi-tenancy (below) |
| **In-memory rate limiter** resets per deploy and is per-instance | Free-tier single instance | Redis/Upstash-backed limiter |
| **No backups configured** | Turso has its own snapshots | Documented restore procedure, tested |
| **`postcss`/`sharp` advisories** inside Next's bundled deps | Not fixable without downgrading to next@9; not reachable from app code | Track the next Next.js patch |
| No password change / session revocation | No user-management UI exists at all | Account settings + "sign out everywhere" |
| Unbounded list queries (kanban loads all deals, incl. all closed history) | Fine at demo scale | Pagination + date-bounded dashboard aggregates |

---

## 5. What's still missing to be a commercial SaaS

Ranked by what would actually block charging money. None of these are bugs —
they're unbuilt product surface.

1. **Multi-tenancy** (~1–2 weeks). There is no `Workspace`/`Organization` model;
   all users share one dataset. This is the single biggest architectural gap and
   the hardest to retrofit — every query needs a workspace scope. Do this *before*
   billing if you ever intend to sell it.
2. **Billing** (~3–5 days). Stripe Checkout + webhook → subscription status on the
   workspace + plan gating. Meaningless without #1.
3. **Transactional email** (~1–2 days). Password reset, invites, verification.
   Resend/Postmark. Password reset is the most-missed feature in any demo.
4. **Legal pages** (~2 hours). Terms + privacy policy, required before taking
   payment or personal data.

~~Error tracking~~ and ~~onboarding + landing page~~ — the two items this report
recommended doing first — shipped on 2026-08-01 (§2).

**Recommendation:** the portfolio-value work is done. Only start 1–3 when a real
user has asked to pay; 4 only matters once you handle real personal data.

---

## 6. Smaller follow-ups

Not blocking anything, listed so they aren't forgotten.

- **Nothing outstanding.** The nightly reset shipped (see §2); the Docker
  artifact is covered by the e2e suite.

Worth knowing if you touch `playwright.config.ts`: the webServer readiness URL
differs by mode on purpose. CI waits on `/api/health` so the first DB-backed
request is warm before sign-in; dev waits on `/` so the app shell is compiled.
Using one for both makes the first test in that mode flaky.
