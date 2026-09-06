# Nexus CRM — Product Requirements Document

**Status:** reverse-engineered from the shipped code on branch `fix/deployment-hardening`.
**Author of the product:** Jeric Rulete (sole developer).
**Primary reader:** the author, who needs to be able to explain this system out loud.
**Secondary reader:** someone evaluating the project who has never seen the code.

This is not a forward-looking spec. Every requirement below was written by reading
what the application actually does, then stating it as a requirement. Where the
built behaviour and the stated intent disagree, that disagreement is recorded in
[§11 Reality vs intent](#11-reality-vs-intent) rather than smoothed over.

---

## 1. What the product is

Nexus CRM is a single-tenant customer relationship manager: contacts, companies,
deals on a drag-and-drop pipeline, an activity timeline, tasks, and an AI layer
that scores leads, summarises relationships and drafts follow-up email. It runs
end to end on free infrastructure — Vercel Hobby plus a Turso free-tier SQLite
database — and can also be self-hosted from a single `docker compose up`.

"Single tenant" is a design decision, not an omission. There is no `Workspace` or
`Organization` model in `prisma/schema.prisma`. Every CRM row carries an
`ownerId` (or `assigneeId`, or `userId`) pointing at a `User`, and every user in
the database shares one dataset. Ownership controls *who may change a record*, not
*who may see it*.

---

## 2. The problem, and who has it

The product solves two problems at once, and they pull in different directions.

**The stated user problem.** A small sales team — or one person doing sales — needs
somewhere to keep who they are talking to, what deal it relates to, what was said
last, and what to do next. Commercial CRMs solve this and charge per seat per
month. The free ones either cap records or bolt AI on as a paid add-on. Nexus CRM
is the version where the whole thing, including the AI, costs nothing to run.

**The real problem being solved.** This is a portfolio artifact whose job is to get
its author hired as a full-stack / AI engineer. That means an evaluator with five
spare minutes must be able to open a URL, be inside a populated product in one
click, see something that is obviously not a CRUD tutorial, and — if they are the
kind of reviewer who looks — find that the code underneath is defensible.

Almost every non-obvious decision in this codebase falls out of the second
problem. The demo account is a full `ADMIN` so nothing is hidden from a visitor,
but `DEMO_MODE` blocks it from deleting (`src/lib/demo-guard.ts`), because a
publicly-linked admin account that anyone can wipe is a demo that works once. The
"Send to yourself" button in `src/server/actions/ai.ts` mails the signed-in user
rather than the contact, because published credentials plus a send-to-anyone
button is a spam relay. Uploaded files are parsed and dropped, never stored
(`src/lib/file-context.ts`), because storage is what makes a public upload box
dangerous. Read those three together and the product's real requirement becomes
visible: *be fully explorable by a stranger without being abusable by one.*

---

## 3. Goals

| # | Goal | How the code expresses it |
|---|---|---|
| G1 | A stranger reaches a populated CRM in one click, with no signup | `/` landing page (`src/app/page.tsx`) → `/login` → **Try the demo** button in `src/app/(auth)/login/login-form.tsx`, which fills the published credentials and submits the normal `login` action |
| G2 | The demo survives being used by strangers | `assertNotLockedDemoAccount` on all five delete actions; nightly rebuild in `.github/workflows/reset-demo.yml` |
| G3 | AI features work with no API key at all | `generateText()` returns `{ ok: false, reason: "not_configured" }` with no key; every caller falls back to `src/lib/ai/heuristics.ts`, carries the reason as `degraded`, and the UI labels the result by that reason |
| G4 | Running cost is exactly zero, permanently | Vercel Hobby + Turso free tier + Gemini/Groq free tiers + GitHub Actions; no paid dependency anywhere in `package.json` |
| G5 | Every mutation is validated, authorised and audited server-side | `requireUser()` → zod schema in `src/lib/validation.ts` → `canMutate()` → `audit()`. The chain is complete in five of the six action files; `ai.ts` authenticates, validates ids and audits but performs **no ownership check** — `scoreContact` writes `aiScore*` onto any contact the caller can name. Tracked as a gap, not a design decision. |
| G6 | Security claims made in the UI are literally true | The Settings "Security" card lists five controls; the 2026-08-21 pass fixed SECURITY.md rather than deleting the claims (see SAAS-READINESS.md §3a) |
| G7 | The thing you can deploy is the thing that was tested | Playwright runs against `.next/standalone` via `npm run start:standalone`, the same bundle the Dockerfile ships |

---

## 4. Non-goals

These are decisions, not backlog items. Each is listed with the reason it was
correct to *not* build.

| Non-goal | Why not |
|---|---|
| Multi-tenancy | Retrofitting a workspace scope touches every query in the app. It only matters if someone pays, and nobody has. Deferring it costs one honest sentence; building it costs one to two weeks that produce no visible product surface. |
| Billing | Meaningless without multi-tenancy. Stripe integration in a portfolio app demonstrates reading Stripe's docs, not judgement. |
| Per-record read scoping | Reads are workspace-wide **by design** — the shared demo has to show a populated pipeline to whoever signs in. A per-user view would show a new visitor an empty product. |
| Email delivery to contacts | Published demo credentials + outbound email = spam relay, burned sending domain, terminated provider account. The recipient is hard-coded to the signed-in user. |
| Persistent file attachments | Uploads are safe here *because nothing is stored*. Persisting them needs blob storage, retention rules, and the nightly reset extended to purge them — a design pass, not an increment (`src/lib/file-context.ts` header comment). |
| Password reset / email verification | Needs a verified sending domain. Resend's free tier only delivers to your own signup address until a domain is verified, and a domain costs money. |
| Any paid dependency | Hard constraint. See §9. |

---

## 5. Personas and roles

The product recognises three kinds of visitor and exactly two database roles.

### 5.1 Anonymous visitor

Sees `/`, `/login`, `/register` and nothing else. `src/proxy.ts` holds
`PUBLIC_PATHS = new Set(["/", "/login", "/register"])` plus two explicit
exemptions — `/api/health` (so uptime monitors work signed out) and `/monitoring`
(the Sentry browser tunnel, which must carry reports from signed-out visitors
too). Everything else redirects to `/login`.

Note the proxy is an *optimistic* gate: it tests only whether the session cookie
exists. Authoritative validation happens in `src/app/(app)/layout.tsx` via
`getCurrentUser()`, which hashes the cookie token and looks it up in the
`Session` table. A forged cookie gets past the proxy and then bounces off the
layout.

### 5.2 Demo visitor (signed in as `demo@nexuscrm.dev`)

An `ADMIN` in every respect except deletion. The role is pinned, not inferred:
`ensureDemoUser()` in `prisma/seed-data.ts` upserts with `update: { role: "ADMIN" }`
because the original seed assigned admin only to the first-created user, and a
re-seed alongside other accounts would have silently downgraded the published demo
to `MEMBER`.

### 5.3 ADMIN

The first account ever registered becomes admin — `register()` in
`src/lib/auth/actions.ts` reads `userCount === 0 ? "ADMIN" : "MEMBER"`. Admins
additionally:

- pass `canMutate()` for **any** record regardless of owner (`src/lib/authz.ts`);
- see every team member's email address on `/settings`;
- see the audit log card on `/settings` (latest 25 events).

There is no UI to promote, demote, invite or remove a user. Role changes require
direct database access.

### 5.4 MEMBER

Every subsequent registration. A member can:

- read every contact, company, deal, activity and task in the workspace;
- create records of any type;
- edit and delete **only records they own** — `canMutate(ownerId, user)` returns
  `ownerId === user.id || user.role === "ADMIN"`;
- see other members' names and roles on `/settings`, but not their email
  addresses, and not the audit log.

The email gating exists because registration is open: without it, anyone could
register a throwaway account on the live demo and read every address that had ever
signed up. There is a Playwright test that registers a fresh member and asserts
`demo@nexuscrm.dev` appears zero times on `/settings` (`e2e/auth.spec.ts`).

**The ownership rule is deliberately narrower than it used to be.** Until this
branch, all six ownership checks lived on delete paths and the four update actions
had none — so a member could rewrite every field of a contact they were forbidden
to delete. `canMutate` now guards both. `e2e/auth.spec.ts` covers it with a
registered outsider who tries to rename a seeded contact and is refused *inside
the form* rather than by an exception, so the dialog stays open with their typed
value intact.

---

## 6. Information model

Eight models in `prisma/schema.prisma`. SQLite has no enum type, so every
enum-like column is a `String` validated by zod at the boundary — the constants
live in `src/lib/constants.ts` and the schemas in `src/lib/validation.ts`.

| Model | Owning field | Notes |
|---|---|---|
| `User` | — | `role` is `"ADMIN"` or `"MEMBER"`; `passwordHash` is bcrypt cost 12 |
| `Session` | `userId` | Stores `tokenHash` (SHA-256 of the cookie token), never the token |
| `Company` | `ownerId` | `size` is one of five buckets |
| `Contact` | `ownerId` | `status` LEAD/QUALIFIED/CUSTOMER/CHURNED; carries `aiScore`, `aiScoreReason`, `aiScoredAt` |
| `Deal` | `ownerId` | `stage` across six values, `position` orders cards within a stage column, `value` is whole currency units |
| `Activity` | `userId` | NOTE/CALL/EMAIL/MEETING; attaches to a contact, deal and/or company |
| `Task` | `assigneeId` | `done` flag, optional `dueDate`, optional contact/deal link |
| `AuditLog` | `userId` (nullable) | `entityId` is a plain string with no foreign key — deliberately, so the log outlives the rows it describes |

Deleting a `Contact` cascades to its activities and tasks. Deleting a `Company`
sets its contacts' and deals' `companyId` to null rather than deleting them — the
confirmation dialog says so: *"Contacts stay but lose the company link."*

---

## 7. Feature set as built

Each feature names the route the user is on, the server action that implements
it, and acceptance criteria written as behaviour you can observe in a browser.

### 7.1 Registration and sign-in

**Routes:** `/register`, `/login`
**Actions:** `register`, `login`, `logout` — all in `src/lib/auth/actions.ts`

| # | Acceptance criterion |
|---|---|
| A1 | Registering with a name ≥2 chars, a valid email and a password ≥8 chars creates the account and lands on `/dashboard`, already signed in |
| A2 | The very first account created in an empty database is `ADMIN`; every later one is `MEMBER` |
| A3 | Registering an email that already exists shows *"This email is already registered"* on the email field |
| A4 | Signing in with a wrong password shows *"Invalid email or password"* and stays on `/login` |
| A5 | An unknown email takes the same measurable time as a known one — `login()` runs bcrypt against a constant `DUMMY_HASH` when no user is found |
| A6 | 11 failed sign-ins from one IP for one email within 15 minutes are refused with a retry countdown; **successful** sign-ins never consume that budget |
| A7 | A second bucket keyed on the account alone (20 failures / 15 min) survives `x-forwarded-for` spoofing, which the IP bucket cannot |
| A8 | Signing out returns to `/login` and `/contacts` then redirects back to `/login` |
| A9 | `auth.login`, `auth.login_failed`, `auth.logout` and `auth.register` all appear in `AuditLog` |

Why A6 is worded that way: charging successful logins against the brute-force
budget meant the shared demo account throttled its own visitors. The e2e suite
caught it.

Sessions last 30 days and renew server-side when fewer than 15 days remain
(`src/lib/auth/session.ts`). Cookies are `httpOnly`, `SameSite=Lax`, and `Secure`
in production.

### 7.2 Landing page

**Route:** `/` — `src/app/page.tsx`, composed of `Hero`, `StackStrip`, `FeatureGrid`, `LandingFooter`

| # | Acceptance criterion |
|---|---|
| B1 | `/` is reachable with no session and renders the h1 *"Every relationship, one intelligent workspace."* |
| B2 | The hero shows a real screenshot of the dashboard, with an alt text describing what is in it |
| B3 | **Try the live demo** navigates to `/login`, where the **Try the demo** button is visible |
| B4 | A signed-in visitor who opens `/` is redirected to `/dashboard` by `src/proxy.ts`, not by the page |
| B5 | Screenshots exist in light and dark variants and swap on the `dark:` class, not `prefers-color-scheme` — the app's source of truth is the class `public/theme-init.js` sets from localStorage, which can disagree with the OS |

`e2e/marketing.spec.ts` has four tests covering B1–B4; **B5 (the theme-matched screenshot swap) is not asserted anywhere**, and one of the four — "the brand lockup links home for signed-out visitors" — maps to no criterion listed here.

### 7.3 Dashboard

**Route:** `/dashboard` — `src/app/(app)/dashboard/page.tsx` (read-only page; the
only mutation on it is the quick-add task form)

Five stat cards, two charts, two lists:

| # | Acceptance criterion |
|---|---|
| C1 | **Open pipeline** sums `value` across deals in LEAD/QUALIFIED/PROPOSAL/NEGOTIATION, workspace-wide |
| C2 | **Weighted forecast** = Σ(value × stage probability) using `STAGE_PROBABILITY` in `src/lib/constants.ts` (0.1 / 0.25 / 0.5 / 0.75), labelled *"Open pipeline × stage probability"* |
| C3 | **Won (all time)** sums closed-won value; **Win rate** is won ÷ (won + lost) as a percentage, or `—` when nothing has closed |
| C4 | **New contacts** counts contacts created in the last 30 days |
| C5 | "Pipeline by stage" charts open value per in-play stage; "Revenue won" charts closed-won value per month for the last six months, bucketed by `closedAt` |
| C6 | **My tasks** shows up to 7 open tasks where `assigneeId` is the signed-in user, soonest due first — the only user-scoped panel on the page |
| C7 | **Recent activity** shows the latest 8 activities across the whole workspace, described as *"Latest touchpoints across the team"* |
| C8 | The greeting reads "Good morning/afternoon/evening, {first name}" based on server clock hour |

C2 exists because both the landing page and the sign-in panel promised *"watch
forecasts update instantly"* while the product had no forecasting of any kind — a
claim falsifiable in twenty seconds by the first reviewer to open Deals. The fix
was to make the claim true, not to soften it.

The stage probabilities are a constant per stage rather than a per-deal column.
The comment in `constants.ts` explains why: a per-deal override is a real feature
with a migration and a form field behind it, and the constant is honest as long as
it is labelled as stage-based rather than as a model's prediction.

### 7.4 Contacts

**Routes:** `/contacts`, `/contacts/[id]`
**Actions:** `createContact`, `updateContact`, `deleteContact` — `src/server/actions/contacts.ts`

| # | Acceptance criterion |
|---|---|
| D1 | The list shows name, company, status badge, AI score pill, owner and relative updated time, newest-updated first, capped at 100 rows |
| D2 | Typing in the search box and pressing Enter navigates to `/contacts?q=…` and filters on first name, last name or email substring |
| D3 | The status chips filter to LEAD / QUALIFIED / CUSTOMER / CHURNED and preserve the current search term in the URL |
| D4 | An unrecognised `?status=` value is ignored rather than producing an empty list — the page validates against `CONTACT_STATUSES` before querying |
| D5 | **New contact** opens a dialog; saving with a blank first or last name shows a field-level message and keeps the dialog open |
| D6 | A `companyId` that no longer exists is stored as `null` rather than throwing — `resolveCompanyId()` looks the company up first |
| D7 | The detail page shows email/phone/company/source/added, notes, an AI panel, open tasks, an activity composer, linked deals and a timeline of the latest 20 activities |
| D8 | **Edit** on a contact owned by someone else returns *"You can only edit records you own."* inside the dialog — returned, not thrown, so the typed value survives |
| D9 | **Delete** opens a confirmation naming the contact and warning that activities and tasks go with it; on success it redirects to `/contacts` |
| D10 | When `DEMO_MODE=true` and the signed-in user is the demo account, the delete dialog explains *"Deleting is turned off in the shared demo…"* and the confirm button is disabled |
| D11 | An unknown contact id renders the branded not-found page, not a crash |

### 7.5 Companies

**Routes:** `/companies`, `/companies/[id]`
**Actions:** `createCompany`, `updateCompany`, `deleteCompany` — `src/server/actions/companies.ts`

| # | Acceptance criterion |
|---|---|
| E1 | The list shows name, domain, industry, size, contact count and open-pipeline value per company |
| E2 | Search matches name, domain or industry; size chips filter to one of the five buckets and preserve the search term |
| E3 | The subtitle reports the true total, not the page slice — when more than 100 match it reads *"Showing 100 of N matching organizations"*. This is a separate `prisma.company.count(where)`, added because the subtitle used to state the 100-row cap as if it were the total |
| E4 | Saving a website that is not an absolute `http(s)` URL shows *"Enter a valid URL (include https://)"* |
| E5 | The detail page shows open pipeline / contacts / deals tiles, the linked people, the linked deals, an activity composer and a timeline of the latest 15 activities |
| E6 | Deleting a company keeps its contacts and deals, clearing their company link, and redirects to `/companies` |

### 7.6 Deals and the pipeline board

**Route:** `/deals` — `src/app/(app)/deals/page.tsx`, board in `src/components/kanban/`
**Actions:** `createDeal`, `updateDeal`, `moveDeal`, `deleteDeal` — `src/server/actions/deals.ts`

| # | Acceptance criterion |
|---|---|
| F1 | Six columns render in stage order: Lead, Qualified, Proposal, Negotiation, Won, Lost |
| F2 | Each column header shows its card count, its total value, and — only for in-play stages — a second, dimmer weighted figure. At 100% it would repeat the total and at 0% it is always zero, so both read as a bug rather than a forecast; `showWeighted` suppresses them |
| F3 | Dragging a card across columns previews the move during the drag and commits it on drop via `moveDeal` |
| F4 | `moveDeal` resequences the entire destination column's `position` values inside one `prisma.$transaction`, so ordering stays dense |
| F5 | Moving a deal into WON or LOST stamps `closedAt` (preserving an existing one); moving it back out clears `closedAt` to null |
| F6 | A cross-stage move writes a `deal.stage_change` audit entry with `{ from, to, via: "kanban" }` |
| F7 | If the server refuses the move — e.g. the deal belongs to someone else — the board snaps back and shows *"Couldn't move that deal — it's been put back."* |
| F8 | Clicking a card (or pressing Enter on a focused one) opens the deal's page at `/deals/[id]`, where editing and deleting live; the board subtitle shows total open pipeline and the instruction *"drag cards to update stage"* |
| F9 | Deal value is validated as a non-negative whole number up to 1,000,000,000 |

### 7.7 Activity timeline

**Where:** contact and company detail pages
**Action:** `createActivity` — `src/server/actions/activities.ts`

| # | Acceptance criterion |
|---|---|
| G1 | Four type buttons (Note, Call, Email, Meeting) change both the submit label and the placeholder text |
| G2 | Submitting empty content shows *"Write something first"*; content is capped at 5,000 characters |
| G3 | An activity attached to no record at all is refused with *"Activity must be attached to a record"* |
| G4 | If the contact/deal/company was deleted in another tab, the composer returns a readable message instead of an error boundary — `findMissingRelation()` checks the ids exist before the insert, which is what stops a Prisma P2003 from throwing away what the user typed |
| G5 | A successful log clears the textarea and the entry appears at the top of the timeline |

### 7.8 Tasks

**Where:** dashboard and contact detail pages
**Actions:** `createTask`, `toggleTask`, `deleteTask` — `src/server/actions/tasks.ts`

| # | Acceptance criterion |
|---|---|
| H1 | The quick-add form takes a title and an optional due date, and clears itself on success |
| H2 | A task created from a contact page is linked to that contact and appears in its "Open tasks" card |
| H3 | Clicking the checkbox toggles done/open and writes `task.complete` or `task.reopen` to the audit log |
| H4 | A past due date renders in the danger colour |
| H5 | Toggling or deleting a task assigned to someone else is refused, and the list shows *"Couldn't update that task — it may be assigned to someone else."* |
| H6 | Due dates are rendered in UTC (`formatDateOnly`), matching how `<input type="date">` stores them, so the day does not shift by timezone |

### 7.9 AI layer

**Where:** the "AI insights" card on `/contacts/[id]` — `src/components/ai-panel.tsx`
**Actions:** `scoreContact`, `summarizeContact`, `draftFollowUp`, `sendFollowUp`, `extractFileText` — `src/server/actions/ai.ts`
**Provider:** `src/lib/ai/provider.ts`; fallbacks in `src/lib/ai/heuristics.ts`

| # | Acceptance criterion |
|---|---|
| I1 | **Score** produces an integer 0–100 plus a one-sentence reason, persists all three of `aiScore` / `aiScoreReason` / `aiScoredAt`, and the pill updates on the list and detail pages |
| I2 | A model reply that does not parse as JSON with a numeric 0–100 score (rounded to an integer) and a string reason is **discarded** in favour of the deterministic heuristic, and the reason is recorded as `malformed` — the score column can never hold garbage a model emitted |
| I3 | **Summarize** returns 3–4 bullets covering current state, open pipeline, engagement trend and the single best next step. It is not persisted |
| I4 | **Draft email** returns a `Subject:` line and a body under ~130 words referencing the most relevant open deal. It is not persisted |
| I5 | With no `GEMINI_API_KEY` and no `GROQ_API_KEY`, all three still work and the panel footer reads *"Generated by rule-based mode (no API key configured)"*; with a key whose provider is failing it reads *"rule-based fallback (AI provider rate-limited)"*, *"(AI provider error)"* or *"(AI reply was not usable)"* |
| I6 | A provider timeout or connection reset also falls back to heuristics — `generateText()` wraps both providers in try/catch and reports the exception to Sentry explicitly |
| I7 | CRM data reaches the model inside `<record>` tags, with a system preamble instructing the model to treat that content strictly as data |
| I8 | Optional typed context (≤2,000 chars) and one attached PDF/`.txt`/`.md` are passed in a separate `<user-context>` block labelled as background, not instructions |
| I9 | Files are capped at 5 MB and 20,000 extracted characters; the character cap is re-applied server-side when the client sends the text back, because the client could have edited it |
| I10 | An unsupported upload is rejected with *"Only PDF, .txt and .md files are supported."*; a scanned PDF with no text layer says OCR is not supported |
| I11 | Nothing about an uploaded file is written anywhere — it is parsed, returned, and dropped |
| I12 | **Send to yourself** mails the draft to the signed-in user's own address, never to the contact. The button copy and the hint under it both say so |
| I13 | An `EMAIL` activity is logged in every case — real send, demo-simulated, or unconfigured — so the flow is visible in the feed even when nothing is delivered |
| I14 | The draft is validated (1–5,000 chars) before it is mailed and logged; this was the last unbounded string reaching the database |
| I15 | All five AI actions share one budget: 30 calls per user per hour, refused with *"AI rate limit reached — try again later."* |

The provider choice is an env var, not a code change: `GEMINI_API_KEY` wins,
`GROQ_API_KEY` is next, neither means heuristics. Both are called over plain
`fetch` with a 30-second `AbortSignal.timeout` — no SDK dependency.

### 7.10 Settings

**Route:** `/settings` — `src/app/(app)/settings/page.tsx` (read-only; no action)

| # | Acceptance criterion |
|---|---|
| J1 | Profile card shows the signed-in user's name, email and role badge |
| J2 | AI provider card names the connected provider, or explains rule-based mode and names the two free keys that would enable a model |
| J3 | Team card lists everyone by name and role. Email addresses render **only** for admins and for the viewer's own row |
| J4 | The audit log card renders only for admins, showing the latest 25 events with action code, actor name, a metadata snippet and relative time |
| J5 | The Security card lists five controls, each of which is true of the code |

There is no profile editing, no password change, no session revocation and no
role management. J3's gating is the only write-adjacent behaviour on the page.

### 7.11 Operational surface

| # | Acceptance criterion |
|---|---|
| K1 | `GET /api/health` answers `200 {"status":"ok"}` with no session, or `503 {"status":"degraded"}` if the `SELECT 1` probe fails |
| K2 | A thrown server error renders `error.tsx` / `global-error.tsx`, not Next's raw default screen |
| K3 | Navigations show `loading.tsx` rather than freezing on the previous page |
| K4 | Errors report to Sentry only when `NEXT_PUBLIC_SENTRY_DSN` is set; the `/monitoring` tunnel route is installed only in that case |
| K5 | The app refuses to start on a Vercel non-production deployment rather than reaching the production database (`src/lib/db-adapter.ts`) |

K5 has a deliberate consequence: preview deployments now fail the build instead of
silently writing to production. Making previews work again means giving them their
own Turso database and scoping `TURSO_DATABASE_URL`, `ALLOW_REMOTE_DB=true` and
`DEMO_MODE=true` to the Preview environment only.

### 7.12 Global search (⌘K)

**Route:** any app route — `src/components/command-palette.tsx` in the header,
`searchRecords` in `src/server/actions/search.ts`.

| # | Acceptance criterion |
|---|---|
| G1 | ⌘K / Ctrl+K anywhere in the app, or the header's Search button, opens the palette with focus in the search box |
| G2 | Searches contact first/last name, email, title and notes (plus "First Last" typed as one phrase), company name, domain, industry and notes, deal titles, and activity content — server-side, two characters minimum |
| G3 | At most five hits per type; when more exist the status line says so and asks the user to keep typing |
| G4 | Arrow keys move the highlight across groups, Enter opens the highlighted record, Escape closes; focus returns to what had it (shortcut) or to the button (click) |
| G5 | The result count is announced through a visible `role="status"` line once a result settles — never while typing |
| G6 | A hit opens its record; an activity opens its deal, else its contact, else its company |
| G7 | A 120-searches-per-minute per-user limit answers with a message in the status line, not an error page |

---

## 8. The demo experience as a first-class requirement

This is the feature the product is *for*. It is treated here as a product
requirement with its own acceptance criteria, not as a deployment detail.

### 8.1 One-click entry

`src/app/(auth)/login/login-form.tsx` holds the published demo credentials and a
**Try the demo** button that fills them in and calls `form.requestSubmit()`. It
deliberately goes through the ordinary `login` server action, so rate limiting,
the audit log and session creation all behave identically to a real sign-in. There
is no back door.

| # | Acceptance criterion |
|---|---|
| L1 | Clicking **Try the demo** on `/login` lands on `/dashboard` with a populated workspace: 6 companies, 12 contacts, deals across every stage, tasks and activity history (`prisma/seed-data.ts`) |
| L2 | The demo account is `ADMIN`, so a visitor sees the audit log and the full team roster — nothing is hidden behind a role they cannot reach |
| L3 | The demo credentials appear in three places that must agree: the README table, `login-form.tsx`, and `prisma/seed-data.ts` |

### 8.2 The delete lock

`DEMO_MODE=true` plus the email `demo@nexuscrm.dev` makes `isLockedDemoAccount()`
true, and `assertNotLockedDemoAccount()` throws `DEMO_READONLY` from all five
delete actions.

| # | Acceptance criterion |
|---|---|
| L4 | With `DEMO_MODE=true`, the demo account cannot delete a contact, company, deal, task or activity |
| L5 | Creating and editing stay allowed, so the demo still feels live rather than frozen |
| L6 | A self-hosted instance seeded with the same demo account keeps full control of its own data — the guard is inert wherever `DEMO_MODE` is unset |
| L7 | On contact and company detail pages the delete dialog explains *why* the button is disabled rather than hiding it |

L7 holds for contacts and companies. It does **not** hold for deals, tasks or
activities — see §11.

### 8.3 Nightly reset

`.github/workflows/reset-demo.yml` runs `scripts/reset-demo.ts` at 19:00 UTC
(03:00 Manila) and on manual dispatch.

| # | Acceptance criterion |
|---|---|
| L8 | Every CRM row is deleted in foreign-key-safe order and re-seeded, so the workspace a visitor sees each morning is the curated one |
| L9 | The `User` and `Session` tables are never touched — production holds real logins alongside the demo account |
| L10 | `AuditLog` is **pruned, not emptied**: the demo account's own entries go (they describe rows being deleted), everything else ages out on a 30-day window (`auditPruneWhere` in `src/lib/reset-guard.ts`) |
| L11 | The script refuses to touch a remote database unless `ALLOW_REMOTE_DB=true`, and throws if that flag is set with no `TURSO_DATABASE_URL` rather than guessing |
| L12 | If the reset somehow leaves zero users, it throws instead of reporting success |

Two design notes worth being able to explain. First, this is a **scheduled
workflow rather than a Vercel cron hitting a protected route**, because the route
version means publishing a URL whose job is to erase the database; here there is no
endpoint at all. Second, L10 exists because the reset used to call
`auditLog.deleteMany()` with no filter — giving the "full audit trail" advertised
on the Settings page a maximum retention of twenty-four hours, including real
users' security events.

The nightly job is also the only workflow holding production credentials, so its
actions are pinned to commit SHAs, it installs with `npm ci --ignore-scripts`, and
the Turso write token is scoped to two steps rather than declared at job level
(where `postinstall` across a ~921-package tree would have had it in scope).

---

## 9. Constraints

### 9.1 Zero budget, permanently

Not "cheap". Not "free trial". Every runtime dependency must be free on an
indefinite free tier:

| Component | Service | Free-tier note |
|---|---|---|
| Hosting | Vercel Hobby | Non-commercial use only — a constraint worth knowing if this were ever sold |
| Database | Turso free tier | SQLite-compatible, so the same Prisma schema serves local and production |
| AI | Google AI Studio (Gemini) or Groq | Free tiers with daily request caps |
| CI + cron | GitHub Actions | Free for public repositories |
| Error tracking | Sentry free tier | Optional; the app runs identically without a DSN |
| Email | Resend free tier | Optional; delivers only to your own signup address until a domain is verified, which is exactly the recipient here |

Everything optional is **inert without its environment variable**, by design, so a
clone or self-host is unaffected by any of it.

### 9.2 Single instance

The rate limiter is an in-memory `Map` (`src/lib/rate-limit.ts`). On Vercel that
means per-instance and reset on every deploy — it raises the cost of casual abuse
but is not a real limit. A durable limiter needs Redis/Upstash; Upstash has a free
tier, so this is a budget-compatible upgrade if it ever matters.

### 9.3 Single tenant, shared workspace

Stated once more because it constrains every feature above: reads are
workspace-wide, writes are owner-gated, and there is no tenant boundary to enforce.
Do not describe this product as multi-tenant.

### 9.4 SQLite dialect

No enums, no native `citext`, and `contains` filters are the SQLite `LIKE`
behaviour rather than a real full-text index. Fine at demo scale; a
tens-of-thousands-of-rows workspace would need something else.

---

## 10. Success metrics

The metric that matters is "did this help get the author hired", which is not
instrumentable. These are the observable proxies, all measurable for free.

| Metric | Target | How to measure today |
|---|---|---|
| Time from landing page to a populated dashboard | ≤ 2 clicks, no form filling | Manually — it is currently **Try the live demo** → **Try the demo** |
| Demo integrity each morning | The seeded workspace, unmodified by yesterday's visitors | The reset workflow's run log prints before/after row counts |
| Build and test health | typecheck, eslint, 331 unit tests (coverage-gated), 44 e2e tests incl. axe scans, production build all green | GitHub Actions badge in the README |
| Deployment-blocking regressions reaching production | Zero | e2e runs against the standalone artifact, the same bundle Docker ships |
| Claims made in the UI that a reviewer can falsify | Zero | Manual audit; the two found so far (forecasting, SECURITY.md) were fixed by building the missing thing |
| Cost to run | $0.00/month | Vercel, Turso, Sentry and GitHub billing pages |
| Production advisories shipping to users | Zero | `npm audit` — currently 3 high, all in the `prisma` CLI devDependency, none in the runtime bundle |

**There is no product analytics in this codebase.** No page-view counter, no funnel
instrumentation, no event tracking. If demo engagement ever needs measuring, Vercel
Web Analytics has a free Hobby tier and is the budget-compatible option; a
self-hosted alternative would need a host, which is not free.

---

## 11. Reality vs intent

Everything in this section is a place where the shipped behaviour and the intended
behaviour do not match. None of it is speculative — each names the file.

### 11.1 ~~Currency is stored and never read~~ — resolved: multi-currency with a frozen rate

A deal now carries the amount as entered (`value`, `currency`) and the same amount
converted to the workspace currency (`baseValue`) at a rate frozen when the amount
was set (`fxRate`). Every total sums `baseValue`; a deal renders as
`$72,534 (EUR 62,000)`. The form field is labelled `Amount` with a currency picker
limited to `SUPPORTED_CURRENCIES`. Rates come from Frankfurter (free, no key) and an
unavailable rate refuses the save rather than assuming 1. Full design in
`docs/DATA-MODEL.md` → Money.

### 11.2 The demo delete lock is inconsistently surfaced

`DeleteButton` (contacts, companies) takes a `disabledReason` and explains itself.
The other delete paths were less careful:

- **Deals** — resolved: the deal page (`/deals/[id]`) uses the standard
  `DeleteButton`, with confirmation and the demo-lock explanation, and the older
  delete button inside `DealFormDialog` (`src/components/deal-form-dialog.tsx`)
  has been removed rather than left as a second, less careful path. That button
  had no confirmation step, no demo
  lock UI, and its `onClick` is `try { … } finally { … }` with no `catch`. On the
  locked demo the `DEMO_READONLY` throw produces an unhandled rejection and the
  user sees nothing happen at all.
- **Tasks** — `TaskList` catches every failure and reports *"it may be assigned to
  someone else"*, which is the wrong explanation when the real cause is
  `DEMO_READONLY`.
- **Activities** — see 11.3.

### 11.3 Two server actions are unreachable from the UI

`deleteActivity` (`src/server/actions/activities.ts`) is fully implemented,
authorised and audited, and nothing imports it. There is no delete control anywhere
in `ActivityFeed`. `currentAiProvider` (`src/server/actions/ai.ts`) is likewise
uncalled — `/settings` reads `aiProviderName()` directly on the server instead.

### 11.4 The contacts list count is not truthful; the companies one is

`/companies` was fixed to run a separate `count()` so its subtitle reports the real
total past the 100-row cap. `/contacts` still renders
`` `${contacts.length} people in your workspace` `` from the page slice, so at 100+
contacts it states the cap as if it were the total — exactly the bug that was fixed
one route over.

### 11.5 ~~"Overdue" is a day early west of UTC~~ — resolved

The task list and the deal card both call `isOverdueDateOnly()`
(`src/lib/utils.ts`), which compares whole UTC days — the same frame
`formatDateOnly` renders in — so the styling and the label can no longer
disagree. A test walks all 24 hours of a due date to prove it.

### 11.6 ~~Concurrent deal writes race~~ — resolved

`createDeal` and `moveDeal` now read the column inside the transaction they
write in, and `updateDeal` appends a stage-changed deal at the end of its new
column (it resequences nothing; the vacated column keeps a harmless gap).
`deals-ordering.test.ts` asserts the target column stays `0..n-1` after a stage
change and under five concurrent creates — which, against the old code, all
landed at position 0.

### 11.7 ~~No optimistic concurrency anywhere~~ — resolved

Each edit form submits the row's `updatedAt`; the update matches on it and a
conflicting save is refused with "This record changed while you were editing it."
No new column was needed. See `src/lib/concurrency.ts`.

### 11.8 ~~Audit writes sit outside their transaction~~ — resolved for state changes

`audit()` accepts the caller's transaction client. Every delete, and the deal
update and move, write their audit entry inside the same transaction as the
mutation, so a change cannot commit without its record. Best-effort entries
(logins, AI usage) stay outside but now report failures to Sentry instead of
swallowing them.

### 11.9 Migration application is non-atomic

`scripts/db-push-turso.ts` and `scripts/docker-entrypoint.mjs` apply migrations
with no surrounding transaction, and cannot use one: Prisma's table rebuilds
toggle `PRAGMA foreign_keys`, which is a no-op inside a transaction. A failure
mid-migration still leaves the schema half-applied, but it is no longer silent —
the ledger row is written before the SQL and stamped after, so the next run sees
the unstamped row, stops, and says which migration was interrupted.

### 11.10 ~~The AI provider never fails over~~ — resolved

`generateText()` tries every configured provider in order and moves to the next
on any failure, so an exhausted Gemini free tier (observed at 20 requests/day)
hands off to Groq instead of degrading every AI feature to heuristics for the
rest of the day. The result is a discriminated `{ ok, reason }`, so the panel
labels a rule-based result by why the model was not used — no key, rate limit,
error, or an unusable reply — and the audit entry records the same reason.

### 11.11 ~~The kanban has no keyboard path~~ — resolved

`KanbanBoard` registers a `KeyboardSensor` beside the `PointerSensor`: Space picks
a card up, the arrow keys move it between stages, Space drops, Escape cancels,
Enter opens the deal's page. A Playwright test moves a card with the keyboard alone
and checks the stage persisted. The edit form's stage `<select>` remains as a
second route.

### 11.12 No component tests exist

Vitest is configured for `.ts` only and cannot collect `.tsx` in this setup, so all
331 unit tests cover library modules and the server actions (against a real
migrations-built SQLite). Component behaviour is covered exclusively by the 44
Playwright tests.

### 11.13 No backup or restore runbook

Turso takes its own snapshots. There is no documented, tested restore procedure,
and no one has ever performed one.

### 11.14 ~~Dead prop paths~~ — resolved

`ActivityComposer` and `QuickTaskForm` both accept a `dealId` prop that nothing
passed, because there was no deal detail page. `/deals/[id]` now passes it: a deal
has its own timeline and task list, and the seeded activities logged against deals
are reachable.

---

## 12. Out of scope, with reasons

Restating §4 as an explicit deferral list, since these are the four a reviewer is
most likely to ask about.

**Multi-tenancy.** The single largest architectural gap and the hardest to
retrofit: every query in the app would need a workspace scope. Correctly deferred
because it delivers no user-visible feature — it is pure infrastructure whose only
payoff is the ability to sell seats to strangers, which is not this project's goal.
Doing it *after* billing would be the mistake; doing it never, until someone offers
money, is the right call.

**Billing.** Meaningless without multi-tenancy, since there is no per-tenant entity
to attach a subscription to. Also: a Stripe integration in a portfolio app
demonstrates that you can follow Stripe's quickstart. The weighted forecast and the
prompt-injection fencing demonstrate more per hour spent.

**Calendar sync.** Google Calendar and Microsoft Graph both require an OAuth
consent screen and, for anything beyond test users, a verification review. That is
a multi-week approval process for a feature whose demo value is a list of meetings
this app can already represent as `MEETING` activities. Correctly deferred: high
integration cost, low demonstrable payoff, and an approval dependency outside the
author's control.

**Voice.** Call transcription and voice notes need either a paid speech API or a
self-hosted model, and self-hosting a model does not fit on any free tier that
would survive a recruiter clicking the button. It also cannot degrade gracefully —
unlike text AI, there is no deterministic heuristic fallback for "transcribe this
audio", so a quota exhaustion would leave a dead feature on the page. That
conflicts directly with G3.

---

## 13. Open product questions

Genuine unknowns. Each needs a product decision, not an implementation.

1. **Should reads be owner-scoped?** Today every signed-in user sees every record.
   That is right for a shared demo and wrong for anything resembling a team tool.
   The two requirements are in real tension and the code currently serves only the
   demo one.
2. **Is `ownerId` a permission or a label?** It gates writes but is displayed as
   "Owned by X". If a real team used this, they would want reassignment — and
   there is no UI for it.
3. **What should happen to visitor-created records before the nightly reset?**
   Up to ~24 hours of a stranger's clutter is visible to the next visitor. A
   shorter cron is free; per-visitor sandboxing is a real feature.
4. **Is one currency the intent, or a stalled feature?** §11.1 has to resolve one
   way. Multi-currency needs a rate source, which is a live dependency, which is a
   cost question.
5. **What is a lead score *for*?** It is computed, stored and displayed, but
   nothing acts on it — no sorting, no filtering, no alerting. A score nobody acts
   on is decoration.
6. **Should scores expire?** `aiScoredAt` is written and never read. A score from
   three months and forty activities ago is shown with the same confidence as one
   from this morning.
7. ~~**Does the product need a deal detail page?**~~ Answered yes: `/deals/[id]`
   gives a deal a timeline, a task list and a permalink, and the board opens it on
   click. Editing moved there from the card; the board keeps "New deal".
8. **Should registration stay open?** It is what makes the demo frictionless and
   also what forced the email-gating fix on `/settings`. An invite flag is cheap;
   the question is whether the demo would be worse for it.
9. **How should quota exhaustion be surfaced?** Answered 2026-09-06: the
   fallback label names the reason — "no API key configured" against "AI
   provider rate-limited" — and the audit entry records it, so a visitor can
   tell the two stories apart. Still open is whether the Settings card should
   show a *live* status rather than the configured one.
10. **Is the audit log a product feature or an engineering artifact?** It is
    admin-only, unfiltered, unsearchable and capped at 25 rows. Either it deserves
    a real UI or it should be described as an operational log rather than a
    feature.

---

## Appendix: route → action map

| Route | Reads | Mutating actions reachable from it |
|---|---|---|
| `/` | none | none |
| `/login` | none | `login` |
| `/register` | none | `register` |
| `/dashboard` | deals, contacts, tasks, activities | `createTask`, `toggleTask`, `deleteTask` |
| `/contacts` | contacts, companies | `createContact` |
| `/contacts/[id]` | contact + company + owner + deals + tasks + activities | `updateContact`, `deleteContact`, `createActivity`, `createTask`, `toggleTask`, `deleteTask`, `scoreContact`, `summarizeContact`, `draftFollowUp`, `sendFollowUp`, `extractFileText` |
| `/companies` | companies (+ counts) | `createCompany` |
| `/companies/[id]` | company + contacts + deals + activities | `updateCompany`, `deleteCompany`, `createActivity` |
| `/deals` | deals, contacts, companies | `createDeal`, `updateDeal`, `moveDeal`, `deleteDeal` |
| `/settings` | users, auditLog (admin only) | none |
| `/api/health` | `SELECT 1` | none |
| any app route | — | `logout` (via the account menu) |
| any app route (⌘K palette) | contacts, companies, deals, activities — capped at 5 per type, via `searchRecords` | none |
