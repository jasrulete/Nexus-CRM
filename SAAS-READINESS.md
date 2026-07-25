# Nexus CRM — SaaS readiness report

Audit date: 2026-07-25. Six parallel audits (security/auth, authorization,
input & secrets, data, frontend, infra/CI/observability), then fixes applied and
verified. Everything below marked "fixed" was verified by typecheck, lint, 56
unit tests, 9 Playwright e2e tests, and a production build.

---

## 1. Fixed in this pass

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

## 2. Required before your next deploy

```bash
npm run db:push:turso
```
The new index migration must reach production. The script baselines your
existing database automatically, then applies only the new migration.

---

## 3. Known gaps — accepted, with reasoning

These are **deliberate** for a portfolio demo. Listed so the choice is explicit.

| Gap | Why it's acceptable now | What "real SaaS" needs |
|---|---|---|
| **Public demo account is a full ADMIN** and can permanently delete all demo data | Credentials are intentionally published; damage is limited to demo data | A demo guard (block destructive actions) or a nightly reset job |
| **Open registration into one shared workspace** — anyone can self-register and see all CRM data | It's a single-tenant showcase, not customer data | Invite-only registration, or real multi-tenancy (below) |
| **In-memory rate limiter** resets per deploy and is per-instance | Free-tier single instance | Redis/Upstash-backed limiter |
| **No backups configured** | Turso has its own snapshots | Documented restore procedure, tested |
| **`postcss`/`sharp` advisories** inside Next's bundled deps | Not fixable without downgrading to next@9; not reachable from app code | Track the next Next.js patch |
| No password change / session revocation | No user-management UI exists at all | Account settings + "sign out everywhere" |
| Unbounded list queries (kanban loads all deals, incl. all closed history) | Fine at demo scale | Pagination + date-bounded dashboard aggregates |

---

## 4. What's still missing to be a commercial SaaS

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
4. **Error tracking** (~2 hours). Sentry via `instrumentation.ts`. Right now a
   production error is a `console.error` nobody reads. Cheapest real win here.
5. **Onboarding + landing page** (~2–3 days). `/` redirects straight to login;
   there is no marketing page. For a portfolio this is the highest-visibility
   item — it's what a recruiter sees first.
6. **Legal pages** (~2 hours). Terms + privacy policy, required before taking
   payment or personal data.

**Recommendation:** for a portfolio, do 4 and 5 and stop — they carry almost all
the perceived-quality value. Only start 1–3 when a real user has asked to pay.
