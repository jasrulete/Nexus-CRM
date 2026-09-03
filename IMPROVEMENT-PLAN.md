# Nexus CRM — improvement plan (2026-08-21)

Fourth pass. Unlike the first three, this one started from the **outside**: a web
sweep of the 2026 AI-CRM landscape, open-source CRM architecture, hiring-manager
signal, and the current Next 16 / Prisma 7 / OWASP-LLM security picture — then a
seven-dimension audit of this repo, with every asserted defect handed to an
independent agent whose job was to *refute* it.

92 raw findings → 69 adversarially verified → **58 confirmed, 11 refuted**.
23 low/nit findings passed through unverified. A completeness critic then found
what all seven dimensions missed, including the most serious item in the pass.

Everything below cites a file. Nothing here is a style preference.

---

## 0. The headline

**The audit was source-complete and deployment-blind.** Seven dimensions produced
a thorough map of the repository and an empty map of the running system. The worst
finding is not in `src/` at all — it is in how the deployed environments are wired.

Three of the highest-value findings were only visible from build output and
platform configuration: the `/monitoring` relay exists in
`.next/routes-manifest.json` and nowhere in the source; the 1 MB Server Action
ceiling lives in `node_modules` and is an *absence* in `next.config.ts`; the
preview-vs-production database split turns on Vercel's env-var scoping defaults,
not on any line of application code.

---

## 1. Do this first — this week

### 1.1 🔴 Preview deployments and production share a database, with the delete-lock off

`src/lib/db-adapter.ts:18`

```ts
const remoteAllowed = Boolean(process.env.VERCEL) || process.env.ALLOW_REMOTE_DB === "true";
```

`VERCEL` is `"1"` on **Preview and Development deployments too**, not just
Production. Meanwhile `DEMO_MODE=true` is scoped to Production only (SAAS-READINESS
§4), so `isLockedDemoAccount()` returns `false` everywhere else. There are 10 live
remote feature branches, each producing a preview deployment, and the demo
credentials are published in the README.

So one of two things is true right now, and both are bad:

| If `TURSO_*` is scoped to… | What happens |
|---|---|
| All environments (Vercel's default for a newly added variable) | Any preview URL is a fully-privileged, unguarded console onto the **production** database. Delete cascades hit live data; the nightly reset also truncates `AuditLog`, so there is no record afterwards. |
| Production only | Every preview deployment throws `TURSO_DATABASE_URL is required on Vercel` at boot. Previews are simply broken. |

The code has no third path. **Check the Vercel env-var scoping before anything
else in this document.**

Fix:

```ts
const remoteAllowed =
  process.env.VERCEL_ENV === "production" || process.env.ALLOW_REMOTE_DB === "true";
```

The discriminating variable is already used correctly elsewhere —
`src/lib/sentry-options.ts:26` reads `process.env.VERCEL_ENV ?? process.env.NODE_ENV`.
Then set `DEMO_MODE=true` in Preview as well, and add a `db-adapter.test.ts` case
asserting `VERCEL_ENV="preview"` does not select the remote adapter.

### 1.2 🔴 Upgrade to `next@16.3.1` (deadline: 26 Aug 2026)

`next` is a **direct, high-severity** advisory at the pinned 16.2.11, and the
August security release covers 16.3 and 15.5 — it does not name 16.2.

`npm audit` reports 13 advisories (12 high). Correcting the stale rationale in
SAAS-READINESS §5 ("not fixable without downgrading to next@9"):

- `npm audit fix` clears **7 of 12**: `next` → 16.3.1 (non-semver-major), which
  also clears `postcss` and `sharp`, plus `brace-expansion`, `fast-uri`,
  `js-yaml`, `nanoid`.
- The remaining 5 (`prisma`, `@prisma/config`, `@prisma/dev`, `deepmerge-ts`,
  `find-my-way`) only "fix" by **downgrading to Prisma 6.12** — a semver-major
  regression. Wait for a Prisma 7 patch and say so in the doc.

The e2e-against-the-standalone-artifact harness is exactly what makes this
upgrade cheap. Run it.

### 1.3 🟠 `/monitoring` is an open, unauthenticated relay — and no DSN is even configured

`next.config.ts:44` installs `tunnelRoute` unconditionally, and `src/proxy.ts:22`
waives auth for it. The current build's `routes-manifest.json` proves the rewrite
is live, forwarding to `https://o:orgid.ingest.sentry.io/api/:projectid/envelope/`
with **caller-supplied** org and project ids.

It is the only unauthenticated non-GET surface in the app and the only one with no
rate limit. Anyone can POST arbitrary bodies through your origin into a third
party's Sentry quota, burning your function invocations and egress.

```ts
tunnelRoute: process.env.NEXT_PUBLIC_SENTRY_DSN ? SENTRY_TUNNEL_ROUTE : undefined,
```

Then rate-limit the path in `proxy.ts` once it is genuinely enabled.

### 1.4 🟠 The nightly reset hands your production DB token to every install script

`.github/workflows/reset-demo.yml:31` declares `TURSO_AUTH_TOKEN` and
`ALLOW_REMOTE_DB: "true"` at **job** level, so they are in scope for
`npm ci` — and `package.json` declares `"postinstall": "prisma generate"` over a
921-package tree. One typosquatted transitive dependency exfiltrates a
production write token. The actions are also pinned to mutable tags (`@v4`).

Move the `env:` block onto the reset step only, run `npm ci --ignore-scripts`
followed by an explicit `npx prisma generate`, and pin actions to commit SHAs.

### 1.5 🟠 Any member can read every registered user's email address

`src/app/(app)/settings/page.tsx:35` — `prisma.user.findMany` selecting `email`
with **no `isAdmin` condition**, three lines above an `auditLog` query that *is*
gated. Registration is open. Register a throwaway account on the live demo and
read the entire roster.

Gate it the same way the audit log is gated, and add a Playwright assertion that a
MEMBER session cannot see another account's email.

### 1.6 🟠 A provider timeout takes down the whole page instead of falling back

`src/lib/ai/provider.ts:32` — `!res.ok` only covers a provider that *answered*.
A 30s timeout or a connection reset rejects out of `fetch`, escapes
`scoreContact`/`draftFollowUp`/`summarizeContact`, and the nearest error boundary
replaces the entire contact page.

The deterministic heuristic fallback — which exists precisely for provider
failure — never runs for the single most likely production failure mode. Wrap
`gemini()` and `groq()` in try/catch returning `null`. One test with a rejecting
fetch stub proves it. **Effort: minutes.**

---

## 2. Make the claims true

A portfolio piece is judged on whether its documentation survives inspection.
Four claims currently do not.

| Claim | Where | Reality |
|---|---|---|
| "server-side authorization on every mutation" | `README.md`, `settings/page.tsx:20` | All 6 ownership checks are on **delete** paths. `updateContact`, `updateCompany`, `updateDeal` and `moveDeal` have none. |
| "Full audit trail of logins, changes and AI usage" | `settings/page.tsx` | `scripts/reset-demo.ts:47` runs `prisma.auditLog.deleteMany()` nightly. Max retention: 24 hours, including real users' entries. |
| "the only `dangerouslySetInnerHTML` is a static theme-init script" | `SECURITY.md:38` | There is no `dangerouslySetInnerHTML` anywhere. `git log -S` finds it only in the commit that added SECURITY.md. The theme script ships as `<Script src="/theme-init.js">`. |
| "Relation IDs from forms are verified to exist server-side" | `SECURITY.md:41` | True for deals and contacts. `createActivity` and `createTask` write `contactId` straight from `formData` with no lookup. |
| "watch forecasts update instantly" | `landing/feature-grid.tsx:12`, `(auth)/layout.tsx:8` | There is no forecasting of any kind. Falsifiable in 20 seconds by the first reviewer who clicks Deals. |
| "Contacts **& companies** with search and status filters" | `README.md` | `companies/page.tsx` takes no `searchParams` and renders a bare table. |

**Fix the code where it's cheap, fix the doc where it isn't.**

1. Add the owner-or-ADMIN guard to the three update actions and `moveDeal`, then
   extract the repeated predicate into one `canMutate(record, user)` helper so the
   next action added cannot forget it. *(minutes)*
2. Scope the audit-log wipe to demo-owned rows, or exclude `AuditLog` from the
   reset and add a retention window instead. *(minutes)*
3. Delete the `dangerouslySetInnerHTML` sentence. Either implement the relation
   check in `createActivity`/`createTask` (copy `deals.ts`) or strike the claim.
4. Add a `probability` per stage in `constants.ts` and a **Weighted forecast**
   StatCard — ~2h, and the forecast claim becomes true rather than reworded.
5. Copy the ~40-line search/filter block from `contacts/page.tsx` into
   `companies/page.tsx`. *(~45 min)*

Also: **add a LICENSE.** `package.json` is `"private": true` with no `license` and
no `repository`, on a public repo whose README invites cloning, Docker
self-hosting and Vercel deploys. Default copyright means none of that is legally
permitted. MIT + `"license": "MIT"` is a five-minute fix with disproportionate
effect on how the repo reads.

---

## 3. Correctness and data integrity

Ranked by whether the bug can produce a wrong number a human would act on.

### 3.1 Verify foreign keys are actually enforced in production

Turso documents FK enforcement as **off by default**; `better-sqlite3` compiles it
**on**. Dev and CI enforce your `onDelete: Cascade`/`SetNull` rules and production
may silently not. Run `PRAGMA foreign_keys` against production. If it returns 0,
either enable it per connection or set `relationMode = "prisma"`.

One query to diagnose a silent, production-only orphaning bug. Do this early.

### 3.2 Money is a trapdoor

`Deal.currency` is written per row and **read nowhere** — `formatCurrency`
hard-codes USD across the dashboard, the deals header, both charts, kanban column
footers and the company detail page. It is safe today only because every row
happens to be `'USD'`. The moment an import or a currency dropdown writes
anything else, €62,000 is added to $48,000 and rendered as "$110,000".

Decide, and make it explicit: either drop the column and add a workspace-level
currency setting, or group every aggregate by currency and refuse to sum across
them. Do not leave a per-row currency no reader honours.

Related: rename `value` → `amountMinor` storing integer **minor units** while the
table is small. Cents are currently unrepresentable, and minor-unit exponents are
not universally 2 (JPY 0, KWD 3).

### 3.3 Overdue is a day early for every negative-UTC-offset user

`src/components/kanban/deal-card.tsx:36` and the task list compare a date-only
field stored at UTC midnight against `new Date()` — an *instant*. A task due
2026-08-22 renders in `text-danger` from 19:00 on the 21st in `America/New_York`,
while the label still reads "Aug 22, 2026". The UI says due-tomorrow and overdue
simultaneously.

`src/lib/utils.test.ts` only asserts the formatter, never the comparison — which is
why it survived. Extract `isOverdueDateOnly()` comparing at UTC day granularity and
unit-test it with a fixed clock in two timezones.

### 3.4 Deal ordering drifts and collides

Three separate defects in one column:

- `createDeal` (`deals.ts:46`) reads `last.position` then writes `+1` **outside a
  transaction**. Two concurrent creates both write the same position.
- `updateDeal` (`deals.ts:91`) changes stage without resequencing at all —
  producing duplicate positions in the target column and a gap in the vacated one.
  Card order then depends on SQLite rowid and shuffles between page loads.
- `moveDeal` reads the column **outside** the `$transaction` it then writes inside
   — a textbook lost update on concurrent drags. It also resequences every other
   owner's deals and audits only stage changes, so a reorder that shuffles ten
   other people's cards leaves no record.

The transaction wrapper is the tactical fix. The strategic one is a fractional /
lexorank position key: a move becomes one write instead of N, and rebalancing comes
free. Reorder correctness is the first thing a reviewer probes in a drag-and-drop
implementation.

### 3.5 Every edit is a blind full-field overwrite

No optimistic-concurrency guard anywhere. Two reps open the same contact; A saves a
new phone; B saves a note from a stale form and reverts A's phone with no conflict,
no warning, and an audit entry recording only `contact.update` with no diff.

Add a hidden `updatedAt` to each edit form and make the update
`where: { id, updatedAt: submitted }`. Prisma throws `P2025` on zero matches —
catch it and return "This record changed while you were editing it." through the
existing `ActionState` channel. Record before/after in the audit metadata so a
clobber is at least reconstructible.

### 3.6 The audit log cannot be trusted to be complete

`src/lib/audit.ts:25` writes **after and outside** the transaction it describes,
and swallows its own failures into `console.error` — which Sentry does not capture.
A deal can commit as WON with nothing in the log. Since the Settings page sells the
audit log as a compliance story, absence of an entry currently proves nothing.

Pass a transaction client into `audit()` for state-changing actions. At minimum,
`Sentry.captureException` on the swallow so a gap is visible.

### 3.7 Migrations are non-atomic — in two files

`scripts/db-push-turso.ts:59` and `scripts/docker-entrypoint.mjs:37` both run the
migration SQL and the ledger `INSERT` as separate operations. Interrupt either
one and the schema objects exist while the ledger stays empty:

- **Turso:** the next run sees `applied.size === 0`, finds a `User` table, and
  *baselines* migration #1 as applied — so the missing tables are never created.
- **Docker:** every subsequent boot replays the migration, `CREATE TABLE "User"`
  fails, and the container never starts again, on a volume users are told survives
  rebuilds.

SQLite DDL is transactional. Wrap each migration and its ledger row in one
`BEGIN`/`COMMIT`. This is the exact bug class that already broke production once,
and it is still untested and outside CI.

### 3.8 Smaller, cheap

- Enum-like columns have no DB constraint; seed/reset/add-member all bypass zod. A
  typo like `"PROPOSL"` renders in the kanban's LEAD column *and* is excluded from
  the dashboard's `stage IN (...)` total, so the two numbers disagree with no
  explanation. Add CHECK constraints in a hand-written migration; as an interim,
  type the seed literals against the constants so a typo fails typecheck.
- Missing sort indexes: `Activity.createdAt`, `Contact.updatedAt`,
  `Company.updatedAt`; widen `Activity_contactId_idx` to `[contactId, createdAt]`.
  Every dashboard load currently full-scans `Activity` to return 8 rows. *(one
  migration)*
- Expired `Session` rows are never collected, and the nightly reset explicitly
  preserves them. Each is a live 30-day credential for a full-ADMIN account with no
  way to revoke it. Add `deleteMany({ where: { expiresAt: { lt: new Date() } } })`
  to the reset that already runs nightly.
- Sliding renewal extends the DB row but **never the cookie**, so sessions do not
  actually slide — the effective policy is a fixed 30-day absolute expiry, and the
  extended row outlives its cookie as unreachable garbage. Either drop the renewal
  and document the real policy, or move it somewhere allowed to write cookies.
- `member@nexuscrm.dev` has a README-published password and is **not** covered by
  the demo delete-lock (`demo-guard.ts:14` hard-codes a single address). Make it a
  set, or key it on a `User.isDemo` column.
- `registerSchema` allows 128-character passwords; bcrypt silently truncates at 72
  bytes, so two passwords sharing a 72-byte prefix authenticate interchangeably.
  Cap at 72 with an honest message, or SHA-256 pre-hash.

---

## 4. Make the AI layer read as engineered

Research finding, stated bluntly: **an AI feature no longer differentiates a
portfolio — an AI feature with evals, guardrails, cost control and observability
does.** The gap between "thin wrapper" and "engineered" is the single most-cited
signal in 2026 hiring writeups. This layer is currently closer to the wrapper end
than its documentation suggests.

What's genuinely good already: no tools on the model (which is what caps injection
impact), keys strictly server-side, plain-text rendering with zero
`dangerouslySetInnerHTML`, a forced self-recipient on email, and a deterministic
unit-tested fallback that is honestly labelled. Keep all of it.

### 4.1 Close the cost hole

`aiRateLimited` is a **per-instance, in-memory** bucket of 30/user/hour. On Vercel
it resets per lambda instance. Multiply that by open registration — 5 accounts per
IP per 15 min, each with a fresh 30 calls — and it is ~600 calls/hour/IP, unbounded
across IPs.

Two amplifiers make each call bigger than documented:

- **Deals are uncapped.** Notes (5000), activities (10 × 300), typed context
  (2000) and files (20,000) are all capped; `loadContactContext` loads *every*
  deal. 1,000 deals on one contact ships a ~200 KB prompt. The 20k-char cost
  bound in SAAS-READINESS §3 does not hold. → `take: 25`.
- **`file.name` is injected uncapped**, so a 1 MB filename with no file attached
  defeats the cap it sits beside. → schema both inputs.

Add a global bucket, a rolling daily token budget, an `AI_DISABLED=true` kill
switch, **and a provider-side spend cap on the key itself** — the backstop the
in-memory limiter's failure mode cannot cross.

### 4.2 The fence can be closed by the data inside it

A note beginning `</record>` terminates the block, putting attacker text at the
same nesting level as the real task. Strip or neutralise the delimiters from every
interpolated field, or use a per-request random nonce in the tag name so the
delimiter is unforgeable. Unit-test that a note containing the closing tag cannot
close the block.

More important: **the documented precondition for accepting prompt injection is
already false.** SAAS-READINESS §3 accepts it while "the content is the user's own,
feeding their own draft, with no other user's data in the prompt." The workspace is
shared and activities are cross-user writable, so injection is already cross-user;
and the steered draft is written to `Activity.content` and re-fed to the model on
every later call for that contact, so it is already persistent. The "no tools" half
still holds. Restate the criteria to match reality, and flag model-authored
activities so generated text is excluded from later prompts.

2026 consensus is that delimiter defences are fragile heuristics and injection is
unsolved. Lead with the four **architectural** facts — no tools, plain-text output,
forced recipient, no cross-tenant data — and keep the honest note that the fencing
was defeated by the parrot test. That candour is the strongest thing in the section.

### 4.3 Make the provider abstraction actually abstract

`generateText` picks Gemini **or** Groq and never falls back. Gemini's free tier is
aggressively rate-limited, so 429 is the *expected* steady state — and one 429
silently downgrades to rule-based text while a perfectly good `GROQ_API_KEY` sits
unused. The second key reads as a fallback chain but is not one.

**Status:** failover done — providers are tried in order on any failure, and
`AI_MODEL` applies to the primary only. The `Retry-After` retry was dropped on
purpose: the Gemini quota that causes the 429 resets daily, so the next provider
is the right move, not waiting. Still open: return a discriminated result
(`{ ok: false, reason: 'rate_limited' | 'error' }`) so callers can tell
degradation from absence.

Ask for JSON directly (Gemini `responseMimeType` + `responseSchema`, Groq
`response_format`) and zod-parse it, instead of a greedy `/\{[\s\S]*\}/` scan that
a chatty reply defeats — silently writing a heuristic score to the DB as if the
model had been consulted.

### 4.4 Ship an eval harness

The highest-signal item in this entire document per the hiring research, and it is
a day of work. 10–20 fixture records with property assertions (score in range,
subject present, name mentioned), 3 injection payloads asserted **not** to redirect
the output, and a pure unit test on `recordBlock`. Fixtures in CI on every PR; live
runs nightly behind a flag, reusing the demo-reset scheduling pattern.

The parrot test from SAAS-READINESS §3 is already your first test case — it exists
as prose in a document rather than as an executable test that fails when the
mitigation regresses.

### 4.5 Instrument it

Provider failures are currently invisible: an expired key degrades every AI feature
to heuristics indefinitely, and from outside you cannot distinguish "never
configured" from "broken since Tuesday" — the UI label is identical. Capture
provider failures to Sentry with status and provider name, and record latency plus
the token counts both APIs already return in the audit metadata.

Then put the number in the README: *"cost per lead score: ~$0.0002."* Quantified
figures are rare in reviewed portfolios and cheap to produce here.

---

## 5. Product surface, ranked by impact per hour

The research is unanimous that **NL-query-over-your-own-records is now baseline**
for anything calling itself an AI CRM (Attio, Copper GPT, Twenty's Ask AI, Zoho,
Dynamics all ship it) — and this app has none of it. That's the one genuine
category gap.

**Do these, in this order:**

| # | Item | Time | Why |
|---|---|---|---|
| 1 | **Seed AI scores on 8–10 of 12 contacts** | 20 min | ✅ Done — nine scored by the real rule-based scorer at seed time (reasons say "Rule-based"), three left null for the Score button. The flagship feature had presented as a column of twelve em-dashes on the page a recruiter opens second. |
| 2 | **Fix the revenue chart's seed data** | 15 min | ✅ Done, in a sturdier shape than proposed: six WON deals placed one per calendar month (the 15th; the 1st for the current month) at 3,600→21,000, and the dashboard's window moved into a shared `lastSixMonths()` whose arithmetic cannot overflow February — the old `setMonth`-then-`setDate` version dropped a month on July 29–31. The chart had opened with empty months and a business shrinking 60%. |
| 3 | **Deal detail page** | ~4h | ✅ Done — `/deals/[id]` with details, tasks, composer and timeline; the board opens it on click/Enter and editing moved there. The seeded "Sent proposal v2…" activity on the Northwind deal is reachable at last. |
| 4 | **⌘K global search** | ~3–4h | ✅ Done — one palette over contacts, companies, deals and notes, server-filtered and capped at five per type, keyboard-first (WAI-ARIA combobox, axe-scanned), no new dependency. "Pull up Acme" no longer means guessing the entity type first, and notes are searchable at last. |
| 5 | **Ask-your-CRM (NL → scoped Prisma query)** | ~1 day | Translate to a **known query shape**, never generated SQL, and always re-apply the session scope server-side — never trust the model's filter for authorization. Matches the fencing discipline already in the codebase and closes the category gap. |
| 6 | **Weighted forecast** | ~2h | Makes the landing-page claim true (§2) and adds the one number every sales manager looks for. |
| 7 | **Stalled-deal digest on the dashboard** | ~2h | Pure heuristic, no AI cost: deals with no activity in N days, sorted by value. Mirrors the Pipedrive/Zia pattern and demonstrates product sense. |
| 8 | **Dashboard Mine/Everyone toggle** | ~1–2h | Sign in as `member@nexuscrm.dev` and the dashboard says "Good morning, Member" over the admin's entire pipeline. Makes the second demo account worth logging into. |
| 9 | **Assignee on tasks; owner on records** | ~3h | The product models a team in the database and behaves as single-player in the UI. Permission checks are already written. |
| 10 | **Duplicate detection on email/domain** | ~1h | Two Mayas each with half the history is how CRM data dies — and the AI score would then compute from a fraction of the activity. Detection is what a reviewer checks for; a merge UI is not worth building. |
| 11 | **CSV export** | ~1h | Export is the cheap half. Skip import unless targeting ops-tooling roles. |
| 12 | **Fix the lying row count** | 15 min | At 101 contacts the header says "100 people in your workspace". Use `prisma.contact.count()`. |

### Explicitly not doing

- **Multi-tenancy and billing.** SAAS-READINESS §6 already defers these correctly,
  and the hiring research independently warns that unjustified architectural
  complexity is a named red flag. Do them when someone asks to pay.
- **Custom fields / Twenty's metadata-driven schema engine.** Requires a
  metadata ORM layer and per-workspace migrations. Disproportionate.
- **Calendar sync (Google/Outlook OAuth).** Days of plumbing that demos as a
  settings toggle and proves nothing the AI provider abstraction hasn't.
- **Autonomous voice calling, multi-agent orchestration, agent marketplaces.**
  A thin imitation would read as vaporware next to this project's honest
  graceful-degradation ethos.
- **Field-level ACLs / record-rule engines.** Speculative complexity with no
  current caller.
- **Manufactured usage metrics.** The candid accepted-gaps framing is already a
  strength; fabricated numbers would undermine it.

---

## 6. Testing, CI and operations

### The root cause nobody named

`vitest.config.ts:15` — `environment: "node"`, `include: ["src/**/*.test.ts"]`.
The glob matches `.ts` only, **never `.tsx`**, and there is no jsdom or
`@testing-library/*` in `devDependencies`. A contributor who writes
`kanban/board.test.tsx` gets a file vitest silently never collects, with no error.

That is why the kanban reorder has no test at any level and why every a11y finding
below is uncovered. It is a two-line config decision, not an omission of effort.

### Coverage gaps, by risk

- **Zero tests prove the owner-or-admin check on any mutation.** SAAS-READINESS §1
  records that this exact check was once missing on `toggleTask` and had to be
  found by hand. Nothing pins it now.
- **The Turso migration ledger** — the bug class that already broke production —
  is untested and outside CI. At minimum: run `db-push-turso.ts` twice against a
  throwaway libsql file and assert the second run applies zero migrations.
- **The Docker image is never built or run in CI**, despite the README leading with
  it and the Dockerfile carrying non-trivial esbuild/entrypoint logic.
- No dependency, secret, or SAST scanning anywhere. Dependabot + `npm audit
  --audit-level=high` + CodeQL default setup are all free and mostly minutes.

### Accessibility

**Kanban drag has no keyboard path at all** — no `KeyboardSensor`, and cards are
not focusable, so a keyboard-only user cannot move a deal *or open one*. The Deals
page's entire function is mouse-only (WCAG 2.1.1, 4.1.2). Add
`sortableKeyboardCoordinates` and make the card a real button.

### Operations

- **Write `RESTORE.md` and rehearse it once.** Turso PITR restores to a *new*
  database with a new URL and token — steps best discovered before an incident.
  Branch production, restore the branch to a timestamp, verify, delete. Record
  RPO (~24h free-tier) and RTO, and the date you tested it. This converts
  SAAS-READINESS §5's "no backups configured" from an accepted gap into a runbook.
- **Add a request id** in `proxy.ts`, carried through `AsyncLocalStorage`, emitted
  in structured logs and tagged onto Sentry events. Vercel Hobby retains runtime
  logs for one hour, so `console.error` is effectively write-only.
- **Split `/api/health` (liveness) from `/api/ready` (checks the DB).** The current
  endpoint runs `SELECT 1` but is used as a liveness probe by docker-compose.
- **Set `experimental.serverActions.bodySizeLimit: '6mb'`.** Next's default 1 MB
  ceiling rejects the request before `validateUpload` runs, so the friendly "File
  is larger than 5 MB" message is dead code for the entire 1–5 MB range — exactly
  the multi-page proposals the feature exists for. `ai-panel.tsx:54` has a
  `finally` with no `catch`, so the user sees the spinner stop and nothing happen.
- **Set `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`** in docker-compose. Each self-hosted
  instance otherwise generates its own key per build, so any deployment scaled past
  one replica fails inline Server Actions non-deterministically.

---

## 7. Portfolio packaging

The engineering is stronger than its presentation. Three cheap fixes:

1. **`DECISIONS.md`.** Extract 4–6 trade-off stories already buried in
   SAAS-READINESS — the Turso ledger, the forwarded-for rate-limit fix, the
   prompt-injection fencing, the no-stored-attachments choice, hand-rolled auth —
   into 3–5 sentence entries: problem, options, why this one, what was given up.
   Reviewers spend seconds, not minutes; this material is high quality and
   currently packaged as an audit log they have to mine.
2. **An architecture diagram.** Server Actions → Prisma driver-adapter switch →
   SQLite/Turso, plus the AI provider abstraction and its fallback path. The
   structure is unusual enough to be worth drawing rather than describing.
3. **A 60–90 second narrated demo video** near the top of the README. Addresses
   the reviewer who scans for 15 seconds and never clicks the live link.

Optional but strong: cite **OWASP LLM Top 10 (2026)** by name in SECURITY.md and
map each mitigation to an entry. The 2026 re-ranking flatters this design —
LLM03 Excessive Agency (no tools, forced recipient), LLM06 Unbounded Consumption
(caps + limits), LLM10 Improper Output Handling (plain-text rendering). Currency
plus an explicit control mapping is exactly what an AI-engineering interviewer
reads for.

Also worth a line: the Deal/Task FK indexes shipped in the first pass, but the
*measurement* is missing. `EXPLAIN QUERY PLAN` plus a timed query at some record
count costs an hour and gives you a number.

---

## 8. What was refuted

11 of 69 verified claims did not survive. Recorded so they aren't re-raised:

- "The first account to register silently becomes ADMIN" — deliberate, documented,
  and the standard bootstrap pattern.
- "`createActivity`/`createTask` attach to any record with no ownership check" —
  the *behaviour* is intentional in a shared workspace. (The **documentation** of
  it is still wrong — see §2.)
- "Every AI action operates on any contact id" — same reason.
- "Multi-tenancy has no enforcement chokepoint (47 where-clauses)" — accurate as a
  count, but not a defect in a deliberately single-tenant app.
- "No test anywhere exercises an authorization boundary" — overstated; the narrower
  claim about the ownership check specifically **was** confirmed.
- "Production CSP `unsafe-inline` removes essentially all XSS protection" —
  downgraded: real, but with no `dangerouslySetInnerHTML` and no markdown renderer
  anywhere, the reachable sink set is currently empty. Still worth fixing with a
  nonce-based CSP after the 16.3.1 upgrade.

---

## 9. Sequencing

**Week 1 — stop the bleeding.** §1 in full. Check the Vercel scoping first, then
`next@16.3.1`, `/monitoring`, the workflow token scope, the settings leak, the AI
try/catch. Then §3.1 (`PRAGMA foreign_keys`) because it is one query and might
invalidate assumptions elsewhere.

**Week 2 — credibility.** §2 in full: the ownership guards, the audit-log
retention, the SECURITY.md corrections, the LICENSE, companies search. Small,
mostly minutes, and it means every claim in the repo survives inspection.

**Week 3 — correctness.** §3.2–3.7. The money decision first (it constrains
everything downstream), then dates, then deal ordering, then optimistic
concurrency, then the migration atomicity in both files.

**Week 4 — the AI layer.** §4 in full, ending with the eval harness — the single
highest-signal artifact available.

**Week 5+ — product and packaging.** §5 items 1–4 (quick wins first, then deal
detail and ⌘K), §6 test infrastructure, §7 packaging.

Ship each as its own PR against a branch, matching the existing convention. The
repo's habit of one-feature-per-PR with a doc update is already a strength.
