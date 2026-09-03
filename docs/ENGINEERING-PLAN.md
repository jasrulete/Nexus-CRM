# Nexus CRM — engineering plan

**Owner:** Jeric Rulete (sole developer)
**Branch this was written against:** `fix/deployment-hardening`, 13 commits ahead of `main`, clean tree
**Date:** 2026-08-23

This is the forward-looking execution plan. It picks up where `IMPROVEMENT-PLAN.md`
left off: Weeks 1 and 2 of that document's §9 sequencing are shipped, and this
plan covers everything after them.

Read alongside:

| Document | What it is |
|---|---|
| `IMPROVEMENT-PLAN.md` | The 2026-08-21 audit. 58 verified findings, with file citations. The source of most of the work below. |
| `SAAS-READINESS.md` | The running log of what was fixed, in which pass, and why. §5 is the list of gaps accepted on purpose. |
| `SECURITY.md` | The security design and its stated trade-offs. |
| `README.md` | The public-facing claims. Every one of them is something this plan must keep true. |

One hard constraint runs through the whole document: **there is no budget.**
Every item below is executable on GitHub Actions, Vercel Hobby, the Turso free
tier, the Gemini/Groq free tiers, and free open-source tooling. Where a
tempting solution costs money, it is named and marked out of budget, and a free
alternative is given instead.

---

## 1. Where the project stands

### Verified, measured on 2026-08-23

| Gate | Result |
|---|---|
| `npm run typecheck` | pass |
| `npm run lint` | pass |
| `npm test` (vitest) | 117 tests across 13 files, pass |
| `npm run build` | pass |
| `npm run test:e2e` (Playwright, against the Docker standalone artifact) | 20 tests, pass |
| `npm audit` | 3 high, 0 critical |

All three advisories are in the `prisma` CLI chain. `prisma` is a
**devDependency** — it does not ship to production. npm's only offered "fix" is
a downgrade to Prisma 6, which is a semver-major regression and is rejected.
The plan is to track the next Prisma 7 patch, not to downgrade. This is recorded
in `SAAS-READINESS.md` §5 so nobody re-raises it as an unaddressed high.

### Shipped on this branch (do not re-plan)

Thirteen commits, one concern each, every one with its documentation updated in
the same commit:

| Commit | What changed | Why it mattered |
|---|---|---|
| `d273b76` | `src/lib/db-adapter.ts` gates on `VERCEL_ENV === "production"`, not `Boolean(VERCEL)` | Preview deployments were a fully-privileged console onto the production database with `DEMO_MODE` inert |
| `a5c357d` | try/catch in `generateText` (`src/lib/ai/provider.ts`) with an explicit `Sentry.captureException` | A provider timeout rejected out of `fetch` and blanked the whole contact page instead of reaching the heuristic fallback that exists for exactly that case |
| `f1d1444` | `tunnelRoute` in `next.config.ts` set only when `NEXT_PUBLIC_SENTRY_DSN` exists | `/monitoring` was an open, unauthenticated, unrate-limited relay into a caller-supplied Sentry ingest host |
| `8103d60` | Email addresses on `/settings` gated to admins and the viewer's own row | Open registration + an ungated `user.findMany` meant a throwaway account read the whole roster |
| `8b4bb85` | Turso write token scoped to two steps; `npm ci --ignore-scripts`; all five actions pinned to SHAs | The nightly reset put a production write token in scope for `postinstall` over a 921-package tree |
| `2c1afed` | `next@16.2.11` → `16.3.1` | Direct high-severity advisory; advisories went 13 → 3 |
| `38d05af` | `canMutate()` in `src/lib/authz.ts`, applied to the update actions and `moveDeal` | All six ownership checks were on delete paths; a MEMBER could overwrite every field of any record but not delete it |
| `9d9f82e` | `auditPruneWhere()` — prune on a 30-day window instead of `deleteMany()` | The nightly reset gave the "full audit trail" a maximum retention of 24 hours, including real users' entries |
| `404378a` | Implemented `findMissingRelation`; corrected the inline-script and raw-SQL claims | `SECURITY.md` asserted two controls that did not exist |
| `334bbae` | MIT `LICENSE`, `"license": "MIT"` in `package.json` | A public repo inviting cloning with no licence permits none of it |
| `2f9a58c` | Search, size filters and `prisma.company.count()` on `/companies` | The README promised search on companies; the page took no `searchParams` |
| `f622834` | `STAGE_PROBABILITY` + `weightedValue()` in `src/lib/constants.ts`, a dashboard StatCard and a per-column kanban figure | The landing page promised forecasts and the product had none |

**Known, deliberate consequence.** Preview deployments now fail at *build* time
rather than silently reaching production (`src/lib/db.ts` builds the adapter at
module scope). Until a Preview-scoped database exists, a preview PR check goes
red on purpose. Fixing that is workstream **W1** below and it is free — the
Turso free tier allows more than one database.

---

## 2. How the remaining work is sequenced, and why

Ordering here is by **dependency**, not by how interesting the work is. The
reasoning:

1. **Land the branch first.** Thirteen commits sitting off `main` means every
   later change is built on an unreviewed base, and the live demo is running
   code that predates the security fixes. Nothing else should start until this
   merges.

2. **Diagnostics before decisions.** `PRAGMA foreign_keys` on the production
   Turso database is one query, and its answer changes what other work is
   safe. Turso documents FK enforcement as off by default; `better-sqlite3`
   compiles it on. If production is not enforcing them, every `onDelete:
   Cascade` / `SetNull` rule in `prisma/schema.prisma` is dev-only fiction and
   the deal/contact deletion paths are silently orphaning rows. Run the query
   before planning around the schema.

3. **Migration atomicity gates every later schema change.** `scripts/db-push-turso.ts`
   and `scripts/docker-entrypoint.mjs` both run `executeMultiple(sql)` and then
   a separate ledger `INSERT`. Interrupt either and the schema objects exist
   while the ledger stays empty — after which Turso *baselines* the missing
   migration as applied and Docker replays it forever. Every workstream below
   that needs a migration (money, indexes, CHECK constraints, optimistic
   concurrency) rides on this. Fix it before you push the next migration, not
   after it wedges production.

4. **Test infrastructure gates the tests that would prove the fixes.**
   `vitest.config.ts` sets `include: ["src/**/*.test.ts"]` — the glob never
   matches `.tsx`, and there is no jsdom or `@testing-library/*` in
   `devDependencies`. Any component test written today is a file vitest
   silently never collects, with no error. That is why the kanban has no test
   at any level. Fix the config before the accessibility work, or the
   "prove the test fails first" rule cannot be honoured there.

5. **The money decision constrains everything downstream.** `Deal.currency` is
   written per row and read nowhere; `formatCurrency` in `src/lib/utils.ts`
   defaults to `"USD"` and every caller takes the default. Every new aggregate
   surface — a stalled-deal digest, CSV export, ask-your-CRM — adds another
   reader that would have to be revisited. Decide before adding readers.

6. **Correctness before product surface.** A wrong number a human acts on is
   worse than a missing feature. Dates, deal ordering, concurrent edits and
   audit completeness all produce wrong numbers or lost work today.

7. **The AI layer before the product features that lean on it.** Ask-your-CRM
   is worth building only on a provider layer that fails over and returns a
   discriminated result. The failover half is done — `generateText()` now tries
   every configured provider in order, so an exhausted Gemini free tier (20
   requests/day, observed) hands off to Groq instead of silently degrading every
   AI feature for the rest of the day. The discriminated result is still open.

8. **Packaging last, but not optional.** The audience is a hiring manager who
   spends minutes, not hours. Packaging converts finished engineering into
   something legible; it is worthless before the engineering exists and
   under-valued after.

---

## 3. Workstreams

Sizes are one-developer estimates: **S** = under 2 hours, **M** = 2–5 hours,
**L** = 1–2 days, **XL** = more than 2 days. They are estimates, not
measurements.

### Phase 0 — Unblock

#### W1 · Land `fix/deployment-hardening` and un-red the previews

**Scope.** Open the PR, self-review the diff commit by commit, merge to `main`.
Then give Preview its own Turso database — free tier, a second database — and
scope `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `ALLOW_REMOTE_DB=true` and
`DEMO_MODE=true` to the Preview environment only. Verify the production env-var
scoping while you are in there. Update `SAAS-READINESS.md` §4 with the Preview
row.

**Acceptance.** `main` carries all 13 commits. A preview deployment builds,
serves, and connects to the preview database — proven by creating a record in a
preview and confirming it is absent from production. Delete attempts in preview
are blocked by `DEMO_MODE`.

**Risk.** Low, but this is the only step where a mis-scoped variable puts a
preview back onto production data. Verify by writing, not by reading the
dashboard.

**Size.** S (1–2h). **Depends on:** nothing.

#### W2 · Prove foreign keys are enforced in production

**Scope.** Run `PRAGMA foreign_keys` against the production Turso database via
`turso db shell`. Record the answer in `SAAS-READINESS.md`. If it returns 0,
either enable it per connection in `src/lib/db-adapter.ts` or switch to
`relationMode = "prisma"` in `prisma/schema.prisma` and accept application-level
referential integrity.

**Acceptance.** The answer is written down with the date it was checked. If
enforcement was off, a test proves that deleting a `Company` with contacts
behaves identically on `better-sqlite3` and libSQL.

**Risk.** Low to run, potentially high to discover — a "0" means production has
been silently orphaning rows on every delete cascade the schema declares.

**Size.** S (30 min to diagnose; up to M if it needs fixing). **Depends on:** W1.

#### W3 · ~~Make both migration appliers atomic~~ Make an interrupted migration impossible to miss — shipped

**What shipped.** Not the transaction this workstream first proposed. Prisma's
table-rebuild migrations toggle `PRAGMA foreign_keys`, which SQLite treats as a
no-op inside a transaction, so wrapping the SQL and its ledger `INSERT` in one
`BEGIN`/`COMMIT` would have silently left foreign keys enforced during the
rebuild and broken exactly the migrations that need it. Instead each runner
writes the ledger row *before* the SQL with an empty `applied_at` and stamps it
afterwards; an unstamped row on the next run means "interrupted", and the runner
stops and says so rather than baselining over it. The decision logic is
`planMigrations()` in `src/lib/migration-ledger.ts` — pure, unit tested in
`migration-ledger.test.ts`, called by `db-push-turso.ts`; `docker-entrypoint.mjs`
cannot import the TypeScript module and carries the same rule inline.

**Acceptance.** ✅ The planner's interrupted and already-applied cases are unit
tested. Still open: neither script is exercised end-to-end by CI (`ci.yml` runs
`prisma migrate deploy`), so the inline copy in the Docker entrypoint can drift
unnoticed.

**Risk.** Was medium — the bug class that already broke production once
(`SAAS-READINESS.md` §1). Residual: the hand-duplicated rule in
`docker-entrypoint.mjs`.

**Size.** M (3–4h). **Depends on:** W1.

#### W4 · Let vitest see `.tsx`

**Scope.** Change `include` in `vitest.config.ts` to `["src/**/*.test.{ts,tsx}"]`,
add `jsdom` and `@testing-library/react` + `@testing-library/user-event` (all
free, MIT) as devDependencies, and configure an `environmentMatchGlobs` (or a
second project) so `.ts` tests keep running in `node` and only component tests
pay for jsdom. Write one throwaway component test to prove collection works,
then delete it or keep it as the first real one.

**Acceptance.** A `.tsx` test file is collected and can fail. The existing 117
node tests still pass and are not slowed down by jsdom.

**Risk.** Low. Watch the install size — three new devDependencies on a tree that
already has 921 packages. They do not ship to production.

**Size.** S (1–2h). **Depends on:** W1.

### Phase 1 — Correctness

#### W5 · Decide what money means — shipped, as option B

**What shipped.** Option **B**, not the A this plan recommended, once the
question was put to the owner: per-row currency kept and honoured. `Deal.value`
stays the amount *as entered* in `Deal.currency`; two new columns, `baseValue`
(converted into the workspace currency) and `fxRate` (the rate used, frozen when
the amount is set), carry the number that is safe to add. Every aggregate —
dashboard, `weightedValue`, both charts, kanban footers, company and contact
pages, the AI prompt and heuristics — sums `baseValue` and nothing else, and
`formatDealAmount` renders `$72,534 (EUR 62,000)`. Rates come from Frankfurter
(`src/lib/fx.ts`, free, no key); an unavailable rate refuses the write rather
than assuming 1:1. The migration hand-backfills `baseValue` from `value` so
historical deals were not zeroed out of every total. Design and reasoning:
`docs/DATA-MODEL.md` → Money. Still open: the `value` → `amountMinor` rename.

**Original scope, for the record.** This was a decision, then an implementation. Two honest options:

| Option | What it costs | What it buys |
|---|---|---|
| **A — single workspace currency** | Drop `Deal.currency` (a migration), add a currency setting, thread it through `formatCurrency` | Simplest thing that is true. Fits a single-tenant app with one shared workspace. |
| **B — per-row currency, honoured** | Every aggregate groups by currency and refuses to sum across them: dashboard StatCards, `weightedValue`, both charts, kanban footers, company detail | Correct multi-currency. Substantially more surface, for a feature nobody has asked for. |

Recommendation: **A**, and say so in a comment where the column used to be.
Separately, and while the table is small, rename `Deal.value` → `amountMinor`
storing integer minor units — cents are currently unrepresentable and minor-unit
exponents are not universally 2 (JPY 0, KWD 3).

**Acceptance.** ✅ No column exists that no reader honours.
`deals-currency.test.ts` covers a non-USD deal's conversion, the rate staying
frozen through unrelated edits, and refusal when the rate provider is down.

**Risk.** Was medium. The frozen rate was initially *not* frozen — `updateDeal`
re-resolved on every save, so a title edit re-priced a closed deal — and it was
caught by the pre-merge review rather than a test. The test exists now.

**Size.** M for A (3–5h), L for B. **Depends on:** W3.

#### W6 · Fix date-only comparisons — shipped

**What shipped.** `isOverdueDateOnly()` next to `formatDateOnly()` in
`src/lib/utils.ts`, comparing whole UTC days — the same frame the formatter
renders in — and used by both `deal-card.tsx` and `task-list.tsx`. Before it,
both compared a date-only field stored at UTC midnight against `new Date()`, an
instant, so a task due 2026-08-22 rendered red from 19:00 on the 21st in
`America/New_York` while the label still read "Aug 22, 2026".

**Acceptance.** ✅ `src/lib/utils.test.ts` walks all 24 hours of a due date and
asserts the label and the styling never disagree; it failed against the old
comparison. That file used to assert only the formatter — which is why this
survived three audits.

**Risk.** Low.

**Size.** S (1–2h). **Depends on:** nothing (but W4 if you also want a component
test).

#### W7 · Make deal ordering correct — tactical half shipped

**What shipped.** The three defects in `src/server/actions/deals.ts`, fixed
together: `createDeal` read `last.position` and wrote `+1` outside a transaction
(five concurrent creates all landed at 0 in the reproduction) — it now reads and
inserts in one `$transaction`; `updateDeal` changed stage without touching
`position`, leaving a duplicate in the target column and an order that fell back
to SQLite rowid — it now appends the card at `max(position) + 1` in its new
column, inside the transaction, and resequences nothing (the vacated column
keeps a gap, harmless because only duplicates make order ambiguous); `moveDeal`
read the column *outside* the `$transaction` it wrote inside — the read is now
inside, and the audit entry is written through the same client.

**Deliberately unchanged.** `moveDeal` still resequences other owners' deals in
the column (one column has one order) and audits only stage changes, so a pure
reorder leaves no record. **Still open:** the strategic fix — a fractional
position key so a move is one write instead of N — which at this table size is
not needed.

**Acceptance.** ✅ `deals-ordering.test.ts` drives concurrent creates and
concurrent drags and asserts the column stays `0..n-1`; it failed against the
old code. Not done: an audit entry for a pure reorder.

**Risk.** Medium. Reorder correctness is the first thing a reviewer probes in a
drag-and-drop implementation, so it is worth getting right rather than
patching. Fractional positions need a rebalance path when precision runs out.

**Size.** M (3–5h) tactical, L with fractional keys. **Depends on:** W3 if the
position column type changes.

#### W8 · Add optimistic concurrency to edits — shipped

**What shipped.** Each edit form carries the row's `updatedAt` as a hidden
field (`VERSION_FIELD` in `src/lib/concurrency.ts`), and the update is
`updateMany({ where: { id, updatedAt: submitted } })`; a count of zero returns
`STALE_RECORD` — "This record changed while you were editing it." — through the
existing `ActionState` channel. **Not the `P2025` catch this plan proposed:**
Prisma's `update` requires a unique `where` and `updatedAt` is not unique, so
`updateMany` plus a count check is the mechanism — do not "fix" it back. A
submit with no version is refused rather than treated as last-write-wins, so a
form that forgets the field fails loudly instead of silently clobbering.

**Acceptance.** ✅ `src/server/actions/concurrency.test.ts` covers a stale
version, an absent one and an unparseable one, and asserts nothing is written.
Not done: before/after in the audit metadata.

**Risk.** Was low-medium. The shared helper the plan suggested exists
(`concurrency.ts`), for the reason `canMutate()` was extracted.

**Size.** M (4–5h). **Depends on:** W7 (both edit `deals.ts`; sequence them so
the diffs do not fight).

#### W9 · Make the audit log trustworthy — shipped for state changes

**What shipped.** `audit(entry, tx?)` accepts the caller's transaction client
and writes through it; every delete, and the deal update and move, pass it, so
a change and its entry commit or roll back together — a deal can no longer
commit as WON with nothing in the log. Callers with no transaction to join
(logins, AI usage) keep the never-throws contract, but a failed write is now
reported with `Sentry.captureException` instead of swallowed into
`console.error`.

**Acceptance.** ✅ Met by construction: the entry is written through the same
client as the mutation, so a failed transaction cannot leave a row and a
successful one cannot omit it. Sentry receives an event when a best-effort
write fails.

**Risk.** Low. Keep the "never throws" contract for non-transactional callers
(login failures, for instance, must still log when the surrounding request is
failing).

**Size.** M (3–4h). **Depends on:** W7, W8 (the transactions must exist first).

### Phase 2 — Make the AI layer read as engineered

The framing from `IMPROVEMENT-PLAN.md` §4 stands: an AI feature no longer
differentiates a portfolio; an AI feature with evals, guardrails, cost control
and observability does. What is already good — no tools on the model, keys
strictly server-side, plain-text rendering, a forced self-recipient on email, a
unit-tested deterministic fallback that is honestly labelled — stays.

#### W10 · Make the provider abstraction actually a fallback chain

**Scope.** `generateText()` in `src/lib/ai/provider.ts` ran
`if (GEMINI_API_KEY) return gemini(); if (GROQ_API_KEY) return groq();` — the
second key read as a fallback and was not one. **Done:** providers are tried in
order on any failure, and `AI_MODEL` applies to the primary only.
**Dropped:** the `Retry-After` retry — Gemini's quota resets daily, so waiting is
pointless and the next provider is the right move. **Still open:** return a
discriminated result (`{ ok: false, reason: 'rate_limited' | 'error' | 'not_configured' }`)
so callers can tell degradation from absence. Also replace the greedy
`extractJson` regex `/\{[\s\S]*\}/` with a real structured-output request —
Gemini's `responseMimeType` + `responseSchema`, Groq's `response_format` — and
zod-parse the result. Today a chatty reply defeats the scan and a heuristic
score is written to the database as if the model had been consulted.

**Acceptance.** ✅ A test where Gemini returns 429 and Groq answers, asserting the
Groq text is used — it failed against the old code (`provider.test.ts`,
"generateText failover"). Still to do: a test that a
non-JSON reply is rejected rather than silently heuristic-scored. The UI can
distinguish "no key configured" from "provider failing".

**Risk.** Low. Both free tiers stay free; retries must not multiply the daily
quota, so cap at one.

**Size.** M (4–5h). **Depends on:** nothing.

#### W11 · Bound AI cost and add a kill switch

**Scope.** Four things:

- `loadContactContext` in `src/server/actions/ai.ts` loads **every** deal with
  no `take`, while notes, activities and file text are all capped. One contact
  with 1,000 deals ships a ~200 KB prompt and breaks the documented cost bound.
  Add `take: 25`.
- `file.name` is interpolated uncapped, defeating the cap it sits beside. Schema
  both inputs.
- `aiRateLimited()` is a per-instance in-memory bucket of 30/user/hour. On
  Vercel it resets per lambda instance, so it is not a real limit. The free
  durable option is **Turso itself** — a small fixed-window table, no new
  vendor, no new bill. (Upstash/Redis is the conventional answer and is out of
  budget as a dependency you would eventually pay for; check Turso's current
  free-tier row-read quota before adding a read to every request.) Add a
  global daily bucket, not only a per-user one.
- An `AI_DISABLED=true` kill switch, plus a spend/quota cap configured on the
  provider key itself — the backstop that an in-memory limiter's failure mode
  cannot cross.

**Acceptance.** A test that the deal cap applies. A test that a long filename is
rejected. The rate limiter survives a simulated instance restart. `AI_DISABLED`
returns heuristics and says so. `SECURITY.md`'s "Quota abuse" bullet is updated
to describe what is actually enforced.

**Risk.** Medium — the durable limiter adds a database round trip to hot paths.
Measure before and after; if it hurts, keep the in-memory bucket as a fast path
and the durable one as the daily ceiling.

**Size.** M (4–5h). **Depends on:** W10.

#### W12 · Ship an eval harness

**Scope.** The highest-signal artifact available, and about a day of work.
10–20 fixture contact records committed to the repo, with property assertions
rather than golden strings: score is an integer in 0–100, a summary mentions the
contact by name, a draft has a subject line. Three prompt-injection payloads
asserted **not** to redirect the output — starting with the parrot test from
`SAAS-READINESS.md` §3, which currently exists as prose in a document rather
than as a test that fails when the mitigation regresses. Plus a pure unit test
on `recordBlock()`.

Fixtures run in CI on every PR with no API key (so they exercise the heuristic
path and the parsing, and cost nothing). Live provider runs go nightly behind a
flag, reusing the scheduling pattern already proven by
`.github/workflows/reset-demo.yml`.

**Acceptance.** `npm run eval` exists and is wired into `ci.yml`. Each injection
payload has a named test. A regression in the fencing turns CI red.

**Risk.** Low technically; the risk is scope creep into a general eval
framework. Keep it a directory of fixtures and a vitest file.

**Size.** L (1 day). **Depends on:** W10 (the discriminated result is what lets
a test distinguish degradation from a wrong answer).

#### W13 · Close the fence and instrument the layer

**Scope.** A note beginning `</record>` closes the block early, putting attacker
text at the same nesting level as the real task — use a per-request random nonce
in the tag name so the delimiter is unforgeable, and strip stray delimiters from
interpolated fields. Then instrumentation: record provider, latency and the
token counts both APIs already return in the audit metadata, so an expired key
is distinguishable from "never configured" from the outside.

Also restate the accepted-risk paragraph in `SAAS-READINESS.md` §3. Its
precondition — "the content is the user's own, with no other user's data in the
prompt" — is already false: the workspace is shared, activities are cross-user
writable, and a steered draft is written to `Activity.content` and re-fed to the
model on every later call for that contact. Lead with the four architectural
facts that still hold (no tools, plain-text output, forced recipient, no
cross-tenant data) and keep the honest note that the fencing was defeated by the
parrot test. That candour is the strongest thing in the section.

**Acceptance.** A test that a note containing the closing tag cannot close the
block. Audit metadata carries provider, latency and token counts. The
accepted-risk text matches what the code actually guarantees.

**Risk.** Low. Do not oversell the nonce — 2026 consensus is that delimiter
defences are heuristics, not solutions, and the document should keep saying so.

**Size.** M (4–5h). **Depends on:** W12 (write the injection tests first, then
make them pass).

### Phase 3 — Product surface

Ordered by impact per hour, which is not the same as by size.

#### W14 · Make the seeded demo show the product working — shipped

**What shipped.** Two edits to `prisma/seed-data.ts`:

- **Nine of the twelve contacts are scored** — not with hand-typed numbers but
  by running the same rule-based scorer `scoreContact` falls back to over the
  rows the seed just wrote, so a seeded score is exactly what the app would
  compute offline and its reason reads "Rule-based score: …". That reason text
  is the provenance label the risk note below asked for; nothing in the UI had
  to change. Three low-signal leads (James, Luna, Marcus) are left null so the
  Score button still has something to do on camera. To make the scorer
  importable from the seed, `heuristicLeadScore` moved to `src/lib/ai/lead-score.ts`
  (no imports, no `server-only`) and is re-exported from `heuristics.ts`.
- **Won revenue is placed by calendar month, not day offset.** The dashboard
  buckets the current month plus the five before it, and the demo is reseeded
  nightly, so "n days ago" drifted across month boundaries and left a bucket
  empty on some runs. Six WON deals now land on the 15th of each past month
  (the 1st for the current one, never in the future) at 3,600 → 7,500 → 12,000
  → 15,000 → 18,000 → 21,000 — a business that is growing.

**Acceptance.** ✅ `src/server/seed-data.test.ts` seeds a real-migrations
database and asserts 8–10 scored contacts with rule-based reasons, that
calling the real `scoreContact` on a seeded contact reproduces the seeded
score and reason exactly, and that every one of the six months has revenue
and each exceeds the last. All three failed against the old seed.

**Risk.** Low. The provenance concern is met by the reason text rather than a
separate label; `aiScoredAt` is set to yesterday and is still read by nothing.

**Size.** S (35 min). **Depends on:** nothing. **Best impact-per-hour in this
document.**

#### W15 · Deal detail page — shipped

**What shipped.** `src/app/(app)/deals/[id]/page.tsx`, the same shape as the
contact and company pages: details (amount converted-first, stage, contact and
company links, expected and actual close), open tasks with the quick-add form,
the activity composer and the timeline. The seed's deal-attached activities are
reachable at last, and `ActivityComposer`/`QuickTaskForm` finally receive the
`dealId` they always accepted. The board opens the page on click and on Enter;
Edit and Delete live on the page (a link nested inside the draggable card would
be an interactive element inside a `role="button"`, which axe flags).
`deleteDeal` redirects to `/deals` afterwards, as the other two deletes do.

**Acceptance.** ✅ Playwright: Enter on a focused card lands on its page; a
click opens the page showing the company link, the contact link, the seeded
"Sent proposal v2" activity, and a note logged from the page; a missing id
renders the branded 404. No relation in the schema is now unreachable from
the product.

**Risk.** Was low. Dead relations in a schema are exactly what a reviewer notices.

**Size.** M (4h). **Depends on:** W17 (the card must be a real focusable control
anyway — do them together).

#### W16 · Global search (⌘K)

**Scope.** The salesperson's most frequent action is "pull up Acme". Today: guess
the entity type, navigate, then search — and only Contacts and (since `2f9a58c`)
Companies have search at all. Notes are unsearchable anywhere. One command
palette over contacts, companies, deals and activity content, server-side,
scoped to the session.

**Acceptance.** Keyboard-reachable, screen-reader-labelled, works without a
mouse. A Playwright test opens it with the keyboard and navigates to a record.
Results are server-filtered, not client-filtered over a full table load.

**Risk.** Medium. Unbounded `contains` queries over `Activity.content` at demo
scale are fine and at real scale are not — bound the result count and say so in
a comment, and note SQLite FTS5 as the free upgrade path if it ever matters.

**Size.** M (3–4h). **Depends on:** W4 if you want a component test.

#### W17 · Give the kanban a keyboard path — shipped

**What shipped.** `src/components/kanban/board.tsx` registers a
`KeyboardSensor` beside the `PointerSensor`, with a board-aware coordinate
getter rather than `sortableKeyboardCoordinates` because the targets are
columns, not one list. Cards are focusable: Space picks up, the arrow keys move
between columns, Space drops, Escape cancels, and Enter opens the deal's page
without starting a drag. Before this the board registered only `PointerSensor` and the
Deals page's entire function was mouse-only (WCAG 2.1.1, 4.1.2).

**Acceptance.** ✅ `e2e/crm.spec.ts` moves a card to a neighbouring column
using only the keyboard and asserts the persisted stage after a reload; a second
test asserts Enter on a focused card opens its page. Not verified: how a move is
announced under a screen reader.

**Risk.** Low. dnd-kit ships the keyboard sensor; the work is mostly making the
card semantically a control.

**Size.** M (3–4h). **Depends on:** W4, W7 (test on correct ordering semantics).

#### W18 · Ask-your-CRM

**Scope.** The one genuine category gap: natural-language query over your own
records is baseline for anything calling itself an AI CRM in 2026, and this app
has none of it. Translate the question to a **known query shape** — never
generated SQL — and always re-apply the session scope server-side. Never trust
the model's filter for authorization. That matches the fencing discipline
already in the codebase.

**Acceptance.** A fixed set of supported query shapes, each unit-tested. A test
that a model-produced filter naming another user's records still returns only
what the session may see. Failure returns "I can't answer that from your
records" rather than a guess.

**Risk.** Medium-high — this is the workstream most likely to produce a
confident wrong answer, which is worse than no feature. Ship the constrained
version or do not ship it.

**Size.** L (1 day). **Depends on:** W10, W11, W12.

#### W19 · Cheap product wins

Each is small and independently shippable. Do them when a larger workstream is
blocked.

| Item | Size | Why |
|---|---|---|
| Stalled-deal digest on the dashboard (no activity in N days, sorted by value) | S (2h) | Pure heuristic, zero AI cost, demonstrates product sense |
| Dashboard Mine/Everyone toggle | S (1–2h) | Signing in as `member@nexuscrm.dev` shows "Good morning, Member" over the admin's entire pipeline |
| Assignee on tasks, owner shown on records | M (3h) | The schema models a team (`Task.assigneeId`, `ownerId` everywhere) and the UI behaves single-player; `canMutate()` already exists |
| Duplicate detection on email/domain | S (1h) | Two half-populated records is how CRM data dies — and the AI score would then compute from a fraction of the history. Detection only; a merge UI is not worth building |
| CSV export | S (1h) | Export is the cheap half. Skip import |

### Phase 4 — CI, operations, and the last honesty gaps

#### W20 · Free CI hardening

**Scope.** `ci.yml` runs lint, typecheck, unit, build and e2e — good, and better
than most portfolio repos. What is missing is entirely free on a public repo:

- **Dependabot** (`.github/dependabot.yml`) for npm and github-actions. Free.
  It also keeps the SHA-pinned actions from `8b4bb85` from going stale.
- **CodeQL default setup.** Free for public repositories, enabled from the
  Security tab, no workflow file to maintain.
- **`npm audit --audit-level=high`** as a CI step, with the three known
  `prisma`-chain advisories explicitly allowed and a comment saying why, so the
  gate fails on something *new* rather than being permanently red.
- **Build and boot the Docker image in CI.** The README leads with
  `docker compose up`, the `Dockerfile` carries non-trivial esbuild and
  entrypoint logic, and CI never builds it. Boot it twice against the same
  volume to cover W3's replay case.

**Acceptance.** A PR with a newly-vulnerable dependency goes red. The Docker
job builds, boots, answers `/api/health`, and boots again cleanly.

**Risk.** Low. Watch the 15-minute job timeout — a Docker build may need its own
job rather than more steps in `ci`.

**Size.** M (3–5h). **Depends on:** W3.

#### W21 · Operations

**Scope.**

- **`RESTORE.md`, rehearsed once.** `SAAS-READINESS.md` §5 lists "no backups
  configured" as an accepted gap on the strength of "Turso has its own
  snapshots" — which is a belief, not a runbook. Two free paths, do both:
  (a) rehearse a Turso point-in-time restore into a *new* database with a new
  URL and token, and write down the steps, the RPO, the RTO and the date you
  tested it; (b) add a nightly GitHub Actions job that dumps the database and
  uploads it as a workflow artifact — free minutes and free artifact storage on
  a public repo — so a restore does not depend on a single vendor's retention.
- **Request ids.** Generate one in `src/proxy.ts`, carry it through
  `AsyncLocalStorage`, emit it in structured logs and tag it onto Sentry events.
  Vercel Hobby retains runtime logs for one hour, so `console.error` is
  effectively write-only without a correlator.
- **Split `/api/health` from `/api/ready`.** The current endpoint runs
  `SELECT 1` and is used as a *liveness* probe by docker-compose and as
  Playwright's readiness URL in CI. A database blip should not restart a healthy
  container.
- **`experimental.serverActions.bodySizeLimit: '6mb'`** in `next.config.ts`.
  Next's 1 MB default rejects the request before `validateUpload` runs, so the
  friendly "File is larger than 5 MB" message is dead code for the whole 1–5 MB
  range — exactly the multi-page proposals the feature exists for.
- **`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`** in `docker-compose.yml`, or every
  self-hosted replica generates its own and inline Server Actions fail
  non-deterministically past one instance.

**Acceptance.** `RESTORE.md` exists, names a real tested date, and
`SAAS-READINESS.md` §5's "no backups" row is replaced by a link to it. A request
id appears in a Sentry event. A 3 MB upload reaches `validateUpload` and gets the
friendly message.

**Risk.** Low. The restore rehearsal is the one item that must actually be
*done*, not written — an untested runbook is a claim, and this project's whole
posture is that claims must survive inspection.

**Size.** M–L (5–8h across the group). **Depends on:** W1.

#### W22 · Session and password honesty

**Scope.** Five small items from `IMPROVEMENT-PLAN.md` §3.8, each of which is
either a real vulnerability or a doc that overstates:

| Item | Fix |
|---|---|
| Expired `Session` rows are never collected, and the nightly reset explicitly preserves them — each is a live 30-day credential for a full-ADMIN account with no revocation path | `deleteMany({ where: { expiresAt: { lt: new Date() } } })` in the reset that already runs nightly |
| Sliding renewal extends the DB row but never the cookie, so sessions do not actually slide — the real policy is a fixed 30-day expiry, and `SECURITY.md` says otherwise | Drop the renewal and document the real policy, or move it where cookies can be written |
| `registerSchema` allows 128-character passwords; bcrypt truncates at 72 bytes, so two passwords sharing a 72-byte prefix authenticate interchangeably | Cap at 72 with an honest message, or SHA-256 pre-hash |
| `demo-guard.ts` hard-codes one address, so `member@nexuscrm.dev` — password published in the README — is not covered by the delete lock | Make it a set, or key on a `User.isDemo` column |
| Enum-like columns have no DB constraint and seed/reset/add-member bypass zod; a typo like `"PROPOSL"` renders in the LEAD column *and* is excluded from the dashboard's `stage IN (...)` total, so two numbers disagree with no explanation | CHECK constraints in a hand-written migration; as an interim, type the seed literals against `src/lib/constants.ts` so a typo fails typecheck |

**Acceptance.** A test per item, each failing first. `SECURITY.md`'s
"Cookies" bullet describes the policy that is actually implemented.

**Risk.** Low individually. The session sweep runs against production data via
the nightly workflow — verify the `where` clause against a local database first,
the same way `auditPruneWhere()` was extracted and unit-tested in `9d9f82e`.

**Size.** M (4–5h for the group). **Depends on:** W3 (the CHECK constraints need
a migration).

### Phase 5 — Packaging

#### W23 · Make the engineering legible

**Scope.** The engineering is stronger than its presentation. Check `docs/`
before starting — if a companion document already carries the decision log,
this workstream shrinks to the pointer from the README.

- **A decision log.** Four to six trade-off stories already buried in
  `SAAS-READINESS.md`: the Turso migration ledger, the forwarded-for rate-limit
  fix, the prompt-injection fencing and the parrot test, the
  no-stored-attachments choice, hand-rolled auth, and now the
  preview-database gate. Three to five sentences each: problem, options, why
  this one, what was given up.
- **An architecture diagram** as a Mermaid block in Markdown — free, renders on
  GitHub, version-controlled, no tool to install. Server Actions → Prisma driver
  adapter switch → better-sqlite3 / libSQL, plus the AI provider chain and its
  heuristic fallback. The driver-adapter switch is unusual enough to be worth
  drawing rather than describing.
- **A 60–90 second narrated demo** near the top of the README, for the reviewer
  who scans for 15 seconds and never clicks the live link. OBS Studio is free;
  an unlisted YouTube link costs nothing.
- **Map `SECURITY.md` to the OWASP LLM Top 10 (2026)** by name. The re-ranking
  flatters this design: LLM03 Excessive Agency (no tools, forced recipient),
  LLM06 Unbounded Consumption (caps and limits, once W11 lands), LLM10 Improper
  Output Handling (plain-text rendering).
- **Put measured numbers in the README.** Cost per lead score. `EXPLAIN QUERY
  PLAN` plus a timed query at some record count, to turn the FK indexes shipped
  in the first pass into a figure. Quantified numbers are rare in reviewed
  portfolios and cheap to produce here.

**Acceptance.** A stranger can understand the system's shape in two minutes
without reading `src/`. Every number cited is one you measured, with the method
stated.

**Risk.** The only real risk is fabricating a number. Do not.

**Size.** M–L (5–8h). **Depends on:** W11 and W12, whose outcomes the OWASP
mapping and the cost figure depend on.

---

## 4. Engineering standards

These are not aspirations — they are what the last 13 commits actually did, and
the bar for what comes next.

### Every change passes five gates before it is committed

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint
npm test            # vitest, 117 tests
npm run build       # next build, catches what dev never does
npm run test:e2e    # playwright, 20 tests
```

In CI (`.github/workflows/ci.yml`) the e2e run serves
`npm run start:standalone` — the assembled `.next/standalone` bundle the Docker
image actually ships — because `next start` does not work with
`output: "standalone"` and would test a binary nobody deploys. Locally,
`playwright.config.ts` serves `npm run dev` instead and waits on `/` rather than
`/api/health`, because dev compiles on first request. That asymmetry is
deliberate; using one for both makes the first test flaky.

Run all five. `npm test` passing while `npm run build` fails is the most common
way a green local tree lands a red CI.

### One concern per commit

Read `git log --oneline`: `fix(deploy)`, `fix(ai)`, `fix(security)`,
`ci`, `chore(deps)`, `feat(deals)`, `docs`. Conventional-commit prefix, one
sentence, one reason. A commit that fixes a bug *and* renames a variable *and*
updates a dependency cannot be reverted, cannot be reviewed, and cannot be
explained in an interview.

### The doc changes in the same commit as the behaviour

`404378a` is the model: `SECURITY.md` claimed two controls that did not exist,
and the commit **implemented them** rather than deleting the sentence, because
the cheap fix was the code. When the cheap fix is the doc, fix the doc — but in
the same commit, never in a follow-up that does not get written.

Concretely: a change to deploy behaviour updates `SAAS-READINESS.md` §4. A
change to a security control updates `SECURITY.md`. A change to a user-visible
feature updates the README's feature list. A new env var goes in
`.env.example`, the README, and the deploy checklist.

### A test must be proven to fail without the fix

Write the test, watch it go red, then write the fix. This is not ceremony — the
date-only bug (W6) survived three audits precisely because
`src/lib/utils.test.ts` tested the formatter and never the comparison, and the
`toggleTask` ownership gap in `SAAS-READINESS.md` §1 had to be found by hand
because nothing pinned it. A test that has never failed is a test that proves
nothing.

If something genuinely cannot be tested — a Vercel env-var scoping, say — say so
in the commit message and describe the manual verification you performed
instead. `d273b76` did this.

### Comments explain why, not what

The house style is already established and is worth keeping: see the block
comment at the top of `src/lib/authz.ts` (why the predicate was extracted, and
what forgetting it cost), the `STAGE_PROBABILITY` comment in
`src/lib/constants.ts` (why a constant and not a column), and the `tunnelRoute`
comment in `next.config.ts` (what the unconditional version shipped). Anyone
reading the diff a year later gets the reasoning, not a restatement of the code.

### No new dependency without a reason that survives the question "why not fetch?"

`src/lib/email.ts` calls Resend with `fetch`, matching how
`src/lib/ai/provider.ts` talks to Gemini and Groq — no SDK, no new package. The
tree is already 921 packages and one typosquat is a production write token
(which is why `reset-demo.yml` runs `npm ci --ignore-scripts`). A dependency
must be free, maintained, and doing something genuinely hard.

---

## 5. Branching and release

### Branching

- `main` is the deployed branch. Vercel builds it on push.
- Work happens on a topic branch named for its intent: `fix/deployment-hardening`,
  `feat/deal-detail`, `chore/deps-*`. One workstream from §3 per branch.
- One PR per branch, self-reviewed commit by commit before merge. The habit of
  one-feature-per-PR-with-a-doc-update is already visible in the history (#6–#9)
  and is a genuine strength — keep it.
- CI runs on every pull request. Merging with a red check is not a thing that
  happens.

### Release

There is no staging environment and there does not need to be one. The path is:

1. Branch green in CI.
2. **If the change includes a migration, apply it to Turso first**:
   `npm run db:push:turso` from a machine with the production credentials. There
   is no migration step in the Vercel deploy, so the schema must lead the code.
   For destructive changes use expand/contract — add the new column, deploy code
   that writes both, backfill, deploy code that reads the new one, drop the old
   one in a later release. A rollback reverts code, never schema.
3. Merge to `main`. Vercel builds and deploys.
4. Verify on the live URL: sign in as the demo account, exercise the changed
   surface, check `/api/health`.
5. If it breaks, use Vercel's instant rollback to the previous deployment (free
   on Hobby). Then fix forward on a branch.

Two deploy gotchas that have bitten before and are recorded in
`SAAS-READINESS.md` §4: `NEXT_PUBLIC_*` values are inlined at **build** time, so
a redeploy reusing the build cache will not pick up a changed DSN; everything
else is read at runtime, so a plain redeploy suffices.

The nightly demo reset (`.github/workflows/reset-demo.yml`, 19:00 UTC) rebuilds
the demo workspace. If a release changes the seed or the schema, run the reset
manually from the Actions tab afterwards rather than waiting for the cron and
discovering it fails at 3am Manila time.

---

## 6. Definition of done

A change is done when all of the following are true. Not most of them.

- [ ] The five gates pass locally: typecheck, lint, unit, build, e2e.
- [ ] A test exists that fails without the change — and you watched it fail. If
      not testable, the commit message says why and what you verified by hand.
- [ ] The commit does one thing, with a conventional-commit subject line.
- [ ] Every doc the change makes stale is updated **in the same commit**:
      README feature list, `SECURITY.md` control, `SAAS-READINESS.md` deploy
      checklist or accepted-gaps table.
- [ ] Any non-obvious decision has a comment saying *why*, in the house style.
- [ ] New env vars are in `.env.example`, the README, and the deploy checklist —
      and the app still works without them (every optional integration in this
      codebase is inert-by-default on purpose, so a clone or self-host is
      unaffected).
- [ ] `npm audit` is no worse than before: 3 high, 0 critical, all in the
      `prisma` devDependency chain.
- [ ] If the schema changed: a migration exists, it has been applied to Turso
      *before* the code merges, and the Docker entrypoint path has been booted
      twice against the same volume.
- [ ] No new claim has been added to any document that the code does not
      support. This is the rule the whole project is built on.
- [ ] CI is green on the PR.

---

## 7. How to decide what not to build

Most of the value in this project so far came from *not* building things. The
rules that produced that, in priority order:

1. **Does it make an existing claim true?** The README, `SECURITY.md` and the
   landing page make specific promises. A feature that converts a promise into a
   fact beats a feature that adds a new promise. The weighted forecast
   (`f622834`) is the model: it was ~2 hours and it made a landing-page
   sentence literally true instead of quietly rewording it.

2. **Can a reviewer falsify it in 20 seconds?** The forecast claim was
   falsifiable by clicking Deals. The companies-search claim was falsifiable by
   opening `/companies`. Anything in that class outranks everything else,
   because a portfolio is judged on whether its documentation survives
   inspection.

3. **Is it free, permanently?** Not free-for-14-days, not free-until-you-scale.
   Every dependency and service in this stack has a permanent free tier, and
   that is itself part of what the project demonstrates. A recommendation that
   costs money is a recommendation for a different project.

4. **Is there a caller?** No abstraction for a single use, no configurability
   nobody asked for, no error handling for impossible states. `canMutate()` was
   extracted because six call sites already existed and four were missing it —
   not speculatively.

5. **Would a thin version be worse than nothing?** Autonomous voice calling,
   multi-agent orchestration, an agent marketplace — a thin imitation reads as
   vaporware next to this project's honest graceful-degradation ethos. So does
   a natural-language query feature that confidently answers wrong (W18's whole
   risk).

6. **Is it expensive to retrofit, and has anyone asked?** Multi-tenancy is the
   textbook expensive retrofit — and nobody has asked to pay, and unjustified
   architectural complexity is a named red flag in hiring reviews. The right
   answer is to keep it single-tenant, say so deliberately, and be able to
   explain what retrofitting would cost. The money model (W5) is the opposite
   case: also expensive to retrofit, but already wrong today, so it gets fixed.

### The standing not-doing list

Still correct, still deliberate:

| Not doing | Why |
|---|---|
| Multi-tenancy (`Workspace` model, per-row scoping) | Single-tenant by design. ~1–2 weeks to retrofit. Do it when someone asks to pay. |
| Billing | Meaningless without multi-tenancy. |
| Custom fields / metadata-driven schema engine | Needs a metadata ORM layer and per-workspace migrations. Disproportionate. |
| Calendar sync (Google/Outlook OAuth) | Days of plumbing that demos as a settings toggle and proves nothing the AI provider abstraction hasn't. |
| Field-level ACLs / record-rule engines | Speculative complexity with no current caller. |
| Persistent file attachments | Uploads are safe in the public demo *because nothing is stored*. Storing them reopens that decision and additionally needs blob storage, retention rules and a purge in the nightly reset. It is a design pass, not an increment. |
| Manufactured usage metrics | The candid accepted-gaps framing is a strength; fabricated numbers would destroy it. |
| CSV import | Export is the cheap half and is where the value is. |

---

## 8. If you only had 10 more hours

Assume the branch is merged (W1) and you get one more working day plus change.
This is the slice with the best ratio of reviewer-visible value to hours, and it
deliberately mixes one flagship artifact, two real bugs, and one thing that
makes a claim true.

| # | Work | Hours | Why this and not something else |
|---|---|---|---|
| 1 | **W14 — seed AI scores and fix the revenue-chart data** | 0.5 | ✅ Shipped. The flagship feature rendered as twelve em-dashes on the page a reviewer opens second; nothing else in this document changed so much for so little. |
| 2 | **W2 — `PRAGMA foreign_keys` on production** | 0.5 | One query. If the answer is 0, it changes what you believe about every delete path in the app, and you would rather know before spending the other nine hours. |
| 3 | **W10 — provider fallback chain + structured output** | 2.0 | Failover half ✅ shipped: an exhausted Gemini free tier now hands off to Groq. Still open: a chatty reply defeats the JSON scan so a heuristic score is written as if the model had answered — *observable in the demo*. |
| 4 | **W12 — minimal eval harness in CI** | 3.0 | The single highest-signal artifact for the stated goal. 10 fixtures with property assertions plus three injection payloads, running with no API key so it costs nothing and runs on every PR. The parrot test stops being a paragraph and becomes a test that goes red. |
| 5 | **W6 — `isOverdueDateOnly()` + fixed-clock tests** | 1.0 | ✅ Shipped. Was a wrong number a human acts on, in the UI: "due Aug 22" rendered in red on Aug 21. The 24-hour test is a good interview story about why the formatter passing was not enough. |
| 6 | **W3 — ~~atomic migrations~~ interrupted-migration detection + tests** | 1.5 | ✅ Shipped, though not as a transaction — see W3 for why that cannot work. This bug class already broke production once; it was the cheapest insurance in the document. |
| 7 | **W23 (partial) — Mermaid architecture diagram + decision log pointer** | 1.5 | Converts nine hours of engineering into something a reviewer can absorb in two minutes. Check `docs/` first — if a companion document already covers the decisions, spend this hour and a half on **W7** (deal-ordering transactions) instead. |

**Total: 10 hours.**

What is deliberately *not* in the ten hours, and why:

- **W5 (money).** Was left out as invisible to a reviewer who only ever sees
  USD — and then shipped anyway, as option B, once the owner chose
  multi-currency. See W5; the deal card now shows `$72,534 (EUR 62,000)`, which
  a reviewer does see.
- **W18 (ask-your-CRM).** A day on its own, and worth building only on top of
  W10, W11 and W12. It is the right *next* day, not this one.
- **W16 (⌘K), W15 (deal detail).** Genuinely valuable product surface, but each
  is three to four hours that buys less reviewer signal than the eval harness.
  (W15 has since shipped; W16 is still open.)
- **W21 (backups runbook).** Should be done — but a rehearsed restore takes real
  elapsed time against a live database, and it does not show up in the demo.

---

## 9. Open questions

Things this plan could not determine and is not guessing about:

- **Is the Vercel Preview environment actually scoped yet?** The code change
  landed in `d273b76`; whether the dashboard variables were set is not visible
  from the repository. Until they are, preview builds fail by design.
- **Does the production Turso database enforce foreign keys?** Unknown until W2
  runs. Turso documents enforcement as off by default; `better-sqlite3` compiles
  it on. Dev and CI may be enforcing rules production ignores.
- **What does the Turso free tier actually retain for point-in-time restore, and
  for how long?** `IMPROVEMENT-PLAN.md` §6 assumes ~24h RPO. Verify before
  writing a number into `RESTORE.md` — an untested runbook with a made-up RPO is
  worse than the current honest "no backups configured".
- **Is the production `_turso_migrations` ledger consistent with the migrations
  directory?** The baselining branch in `scripts/db-push-turso.ts` records only
  the *first* migration when it adopts an existing database. Worth checking
  before W3 changes the applier.
- **Gemini's free-tier limit** (20 requests/day) is an observation from use, not
  a documented figure. Re-check before citing it anywhere public.
- **Whether the companion documents in `docs/` already cover the decision log
  and architecture diagram** in W23 — check before duplicating them.
- **All sizes in §3 are estimates by one developer with no historical velocity
  data.** Treat them as relative ordering, not as commitments.
