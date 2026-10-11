# Multi-tenancy core — design

Produced 2026-10-11. Revision 2, after an adversarial review: six lenses checked revision 1 against the
code and the installed Prisma 7 / Next 16 sources. 56 findings were confirmed (1 blocker) and 6 refuted;
all confirmed findings are folded in below.

Inputs: a read-only context sweep of this codebase (data model, auth, every database access site
re-enumerated by two independent methods, demo/reset/tests, AI limits, docs), plus fact-checked research
on tenancy patterns for Prisma 7 + libSQL, hosting terms and billing providers.

The user made the product decisions in §2 one at a time, then delegated the rest: "you can decide on
whats the best course of action so this can be automated". Decisions marked **(delegated)** are mine,
each with its reason, and can be overruled. This is spec 1 of 3 (§12).

## 1. Goal

Nexus can host many independent workspaces in one database, and no workspace can read or change
another's data. The public demo and self-hosting keep working as today, **except** for the Settings
changes in §5.6.

**Done means:**
- In `multi` mode, two sign-ups each get a private workspace, and neither can see or touch the other's
  data through any page, action, search, AI feature or link.
- In `single` mode, a fresh self-host install, a seeded install and the public demo work as today:
  sign-in, the seeded data, and registrants joining the one workspace.
- The cross-tenant suite (§9.1) is green. It fails when a new server action or page loader has no
  cross-tenant case.
- Phase A (§10) is live on the demo deployment and verified. Phase B (M2) is a separate, later PR.

## 2. Decisions

| Decision | Choice | By |
|---|---|---|
| Business model | Open-core: self-host stays free and MIT; a hosted cloud plan is sold | user |
| Pricing shape | Free plan + one paid plan | user |
| Demo placement | The demo keeps **its own deployment and database** (single mode). The paid cloud is a separate deployment and database | user |
| Isolation | Shared database, `workspaceId` on every tenant row, layered guards (§5) | user |
| Memberships | One workspace per person in v1 | user |
| Free-plan limits | Team members, AI usage and record counts | user |
| Cloud AI | Groq free tier, then rule-based, "for now … maybe we can scale" | user |
| Data model | §4, as presented | user (approved) |
| Workspace resolution | From the user's single membership; no "active workspace" field until multi-membership | delegated |
| Deployment modes | `WORKSPACE_MODE=single\|multi`, explicit in production (§6) | delegated |
| Limit numbers | §7 defaults, in one config module | delegated |
| `User.role` | Kept as an unused, deprecated column in spec 1. Dropping it is cosmetic, and dropping it is what made revision 1's M2 able to break every sign-in | delegated |
| Split into 3 specs | §12 | delegated |

## 3. Why one shared database

- **Database-per-workspace was rejected.** Turso's Multi-DB Schemas is deprecated and Prisma Migrate
  doesn't support Turso, so every migration would loop over every database by hand. Users would need
  a central database, which breaks `ownerId → User`, and free sign-ups would burn database slots.
- **Deployment-per-customer was rejected.** It rules out self-serve sign-up and the free plan.
- **The shared database works on any host** (Turso, or SQLite on a volume) and for self-hosters. Its
  known weakness is a missed filter, which is what §5 closes.

## 4. Data model

### New tables (M1)

```prisma
model Workspace {
  id        String   @id @default(cuid())
  name      String
  slug      String   @unique
  isDemo    Boolean  @default(false)  // permission bit for the demo reset ONLY; the app never branches on it (§8)
  plan      String   @default("FREE") // "FREE" | "PAID"; only spec 3's billing webhook writes PAID
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Membership {
  id          String   @id @default(cuid())
  workspaceId String
  userId      String   @unique   // one workspace per person in v1; drop @unique to allow several
  role        String             // "OWNER" | "ADMIN" | "MEMBER"
  createdAt   DateTime @default(now())
  @@unique([workspaceId, userId])
  @@index([workspaceId])
}

model AiUsage {
  id           String   @id @default(cuid())
  workspaceId  String
  userId       String?
  action       String   // "score" | "summary" | "draft"
  outcome      String   // "pending" | "answered" | "rejected" | "fallback" | "capacity" | "denied"
  provider     String?  // the provider that answered, else null
  inputTokens  Int?
  outputTokens Int?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  @@index([workspaceId, createdAt])
  @@index([createdAt])             // the deployment-wide daily ceiling (§7)
}
```

`Membership.userId → User` and `Membership/AiUsage.workspaceId → Workspace` may carry foreign keys,
because they are new tables. `Invitation` moves to spec 3.

**Fixed identifiers**, exported as constants from `src/lib/workspace-bootstrap.ts`:
`DEFAULT_WORKSPACE_ID`, slug `"default"`, name `"Default workspace"`. The name is neutral because
self-hosters' installs run the same migration and their data is real.

### Changed tables

- **Company, Contact, Deal, Activity, Task:**
  - **M1** adds `workspaceId String?` as a **plain indexed scalar with no `@relation`**. M1's generated
    SQL is then `ALTER TABLE … ADD COLUMN` plus `CREATE INDEX`, never a table rebuild. An optional
    `@relation` would make Prisma rebuild all six tables, and a hand-written `REFERENCES` would drift
    from the schema.
  - **M2** makes it required, adds the `Workspace` relation, the parent `UNIQUE(workspaceId, id)` and
    the composite keys (§4.3).
  - Every list index leads with `workspaceId`; the plan derives the exact set from the real queries.
- **AuditLog:** M1 adds an optional `workspaceId`. Workspace events carry it. Platform events
  (`auth.register`, `auth.login`, `auth.login_failed`, `auth.logout`) stay null and are never shown
  to a workspace (§5.6).
- **User.role:** unused from the phase-A code deploy onward. `Membership.role` is authoritative. The
  column stays, marked deprecated in the schema, because dropping it is cosmetic (§2). No code reads
  or writes it after phase A.
- **Ownership deletes in M2:** `Company.ownerId`, `Contact.ownerId`, `Deal.ownerId`,
  `Activity.userId` and `Task.assigneeId` change from `Cascade` to `Restrict`. **`Session.userId`
  stays `Cascade`; `AuditLog.userId` stays `SetNull`.** Today, deleting a user silently deletes every
  record they own. Spec 3's member removal reassigns those records first.
- **Kanban positions** are computed and resequenced within `(workspaceId, stage)`.
- **Currency stays deployment-wide in v1** (`WORKSPACE_CURRENCY`). Making it per workspace means
  threading it through client formatters that read it at module scope, and nothing sold needs it yet.
  **(delegated)**

### 4.3 Same-workspace links (database backstop, M2)

Parents (Company, Contact, Deal) get `UNIQUE(workspaceId, id)`. Each child link gets a composite
`(workspaceId, parentId) → (workspaceId, id)` foreign key with `NO ACTION`, **beside** the existing
single-column `ON DELETE SET NULL` key. SQLite's `SET NULL` would also null a composite key's
`workspaceId`.

**Plan task 1 is a spike** (§10). If the dual key cannot be expressed cleanly in Prisma's schema and
migrations, the backstop is dropped and §5.4's mandatory app-level check stands alone.

**SQLite triggers are ruled out.** A Prisma table rebuild of a parent table drops the table, then fails
on the trigger mid-way, leaving the table missing. This was reproduced in the sweep.

## 5. Request flow and guards

### 5.1 The two database clients

`src/lib/db.ts` stops exporting a raw `prisma`. It exports:

- **`systemDb`**: the unscoped base client.
- **`scopeToWorkspace(base, workspaceId)`**: builds the scoped extension on any base client. The test
  harness uses it.
- **`forWorkspace(workspaceId)`**: `scopeToWorkspace(systemDb, workspaceId)`.

**Model map**, exhaustive over `Prisma.ModelName`:
- **TENANT** = Company, Contact, Deal, Activity, Task, AuditLog, Membership, AiUsage.
- **GLOBAL** = User, Session, Workspace.

A unit test fails on any unclassified model, and asserts that a model is TENANT exactly when its
`ScalarFieldEnum` contains `workspaceId`.

**`scopeToWorkspace` fails closed.** It is one **top-level** `query.$allOperations` callback. A
callback under `$allModels` never sees model-less raw calls.

- **`model` undefined** (`$queryRaw`, `$executeRaw`, `$queryRawUnsafe`, `$executeRawUnsafe`):
  **throw**.
- **GLOBAL model, any operation: throw.** A nested read of a global relation (e.g. a membership's
  `user`) still works, but only for scalar fields (§5.5).
- **TENANT model:** an explicit switch over **every** operation the installed client has, with a
  **default that throws**. A unit test runs every operation name per tenant model, so a Prisma upgrade
  that adds an operation fails the test.

| Operation | Behaviour |
|---|---|
| `findUnique` / `findUniqueOrThrow` / `findFirst` / `findFirstOrThrow` / `findMany` / `count` / `aggregate` / `groupBy` | AND `workspaceId = bound` into `where`. Unique calls use `WhereUniqueInput`'s extra non-unique filters, so a foreign id → "not found" (P2025) |
| `update` / `updateMany` / `updateManyAndReturn` / `delete` / `deleteMany` | Same `where` scoping. **Throw** if `data.workspaceId` is present |
| `upsert` | Scope `where`; verify `create.workspaceId`; throw if `update.workspaceId` is present |
| `create` / `createMany` / `createManyAndReturn` | **Verify** that `data.workspaceId` (each element, for many) equals the bound id; throw if it is missing or different |
| Any write | **Throw** if any key of `data` (or of a `createMany` element, or of `upsert.create`/`update`) is not in `Prisma.<Model>ScalarFieldEnum`. This blocks every nested relation write: connect, create, set, upsert, createMany, update, delete, disconnect |

**Creates pass `workspaceId: ctx.workspaceId` explicitly** as a scalar (unchecked input) from the
phase-A code onward. Query extensions don't change the generated input types, so a stamping approach
stops type-checking once M2 makes the column required. The extension verifies; it never stamps.

**Where `systemDb` may be imported** (an exact file allowlist):
- `src/lib/db.ts`
- `src/lib/auth/session.ts`
- `src/lib/auth/actions.ts`
- `src/lib/auth/platform-audit.ts`
- `src/lib/workspace-context.ts`
- `src/lib/workspace-bootstrap.ts`
- `src/lib/system-queries.ts`
- `src/app/api/health/route.ts`
- `src/app/auth/signout-stale/route.ts`

`auditPlatform` lives in its own `platform-audit.ts`, not in `auth/actions.ts`. That module is
`'use server'`, so every function it exports is callable from the browser as a server action.

A test scans **all of `src/`** (except `src/generated` and `*.test.ts`) for imports of `systemDb`, and
for any value import of `PrismaClient` from the generated client. Only `src/lib/db.ts` and
`src/test/action-harness.ts` may construct a client. Scripts (`scripts/`, `prisma/`) build their own
clients and are covered by §8.

**`src/lib/system-queries.ts`** holds every cross-workspace or raw read as a named function, each with
its own cross-tenant test:
- `aiCallsToday()` returns only a number (§7);
- later, `searchFts(workspaceId, q)` with `workspaceId` bound into the SQL, when FTS lands.

Callers never import `systemDb` themselves.

### 5.2 The transaction rule (production driver)

On PrismaLibSql, every query and every interactive transaction share one adapter-wide lock, held until
commit. So **inside any interactive-transaction callback, every query goes through that callback's
`tx`**. Never use `systemDb`, the outer `forWorkspace` client, or any helper that closes over one; that
includes `audit()` without its `db` argument.

On production such a call waits until the transaction times out. better-sqlite3 runs it silently
inside the transaction, so the existing harness cannot catch it; §9.4 adds a libSQL-driver test.

Consequences:
- Relation ids are resolved **before** a transaction opens. That is the existing `createDeal` pattern.
- `register()` hashes the password **before** its transaction. It creates the session and writes the
  `auth.register` row **after** commit.
- Record-cap checks are a count then a create **without** an interactive transaction (§7).

### 5.3 Workspace context

`src/lib/workspace-context.ts` exports `getWorkspaceContext()`. It is a per-request `cache()` and
returns `{ user, workspaceId, role }`. Every page loader and server action calls it directly.

Under Next 16 partial rendering a layout neither re-runs on navigation nor stops a page from
rendering, so pages stop treating the `(app)` layout as the auth gate. No action takes a
`workspaceId` from client input. The layout passes the client component only the display fields it
renders.

Outcomes:
- **No session:** pages redirect to `/login`; actions throw `UNAUTHORIZED`.
- **Session, but no membership, in `single` mode:** call `ensureMember(db, userId, "MEMBER")` (§8),
  which joins the one workspace, the same rule register follows. A DB write during render is allowed.
- **Session, but no membership, in `multi` mode:** redirect to the proxy-exempt route handler
  `/auth/signout-stale`. It deletes the Session row and the cookie, then redirects to `/login`.
  Cookies can be changed only in a Route Handler or Server Function, so this cannot happen during
  render. This also fixes today's stale-cookie `/login`↔`/dashboard` loop, and that fix moves into
  spec 1.

**Authorization:**
- `isWorkspaceAdmin(role)` is `role ∈ {OWNER, ADMIN}`.
- `canMutate(ownerId, ctx)` is `owner || isWorkspaceAdmin(ctx.role)`.
- **Every** role read uses these two: the Settings admin view, the roster badge and the user-menu
  label.
- `USER_ROLES` and every zod role enum gain `OWNER`.

A global ADMIN's reach therefore ends at their own workspace, and a fresh install's OWNER keeps
today's admin view.

### 5.4 Same-workspace links (app level, mandatory)

`findMissingRelation` (`src/lib/relations.ts`), `resolveCompanyId` (contacts) and `resolveRelation`
(deals) take the **scoped client as a required first parameter**, with no module-level client. So
"resolved through `forWorkspace`" is enforced by the signature: another workspace's id is
"not found". The AI actions' contact lookup goes through `forWorkspace` too.

### 5.5 Nested reads

The extension's callback fires only for the top-level model, so `include`, `select`, `where`,
`orderBy` and `_count` on relations are checked by walking the args; 14 sites read related rows this
way.
- Nested reads of **tenant** children are safe **because of §5.4 and the ScalarFieldEnum rule**: no
  write can link rows across workspaces or move a row out of one, so a scoped parent can only include
  same-workspace children.
- Nested access through a GLOBAL relation (a record's owner/user/assignee, a membership's workspace)
  is NOT safe by construction: a User's back-relations reach every workspace's rows (review finding,
  2026-10-12). `scopeToWorkspace` walks `select`, `include`, `where` and `orderBy`, and under any
  relation whose target is GLOBAL allows scalar fields only — `true` or a `select` of the target's
  scalars; a relation key, `include`, `_count`, or a nested relation filter under a GLOBAL relation
  throws `TenancyViolation`. The relation-target map is a static table checked against
  `prisma/schema.prisma` by a test.

The cross-tenant suite (§9.1) proves this rather than assuming it.

### 5.6 Named fixes the guards force

- **AI actions.** They loaded a contact by id with no scope, and `sendFollowUp` wrote an Activity onto
  any contact id. Both now go through `forWorkspace`.
- **The deal page's `generateMetadata`** reads the title through `forWorkspace`.
- **Settings roster:** `forWorkspace(ws).membership.findMany({ include: { user: { select: { id: true,
  name: true, email: true } } } })`. Emails show only to `isWorkspaceAdmin` viewers, and **never to
  the locked demo account**.
- **Settings audit card:** `forWorkspace(ws).auditLog.findMany(…)`. The injected filter excludes the
  null platform rows, so IPs from failed logins are never rendered.
  - This matches the separate demo-leak fix; whichever lands second rebases.
  - It deliberately changes PRD L2, J3 and J4 (§11).
- **Audit writes.**
  - Signature: `audit(db, entry)`, with `db` required (a `forWorkspace` client or its `tx`) and no
    module-level fallback. Entries carry `workspaceId`.
  - **`auditPlatform(entry)`** lives in the auth code. It writes through `systemDb` with `workspaceId`
    forced to null and accepts only `auth.*` actions.
  - A test asserts that every non-auth audit row the action suite writes carries the actor's
    workspace.
- **Search** goes through `forWorkspace`. Future FTS goes through `system-queries.searchFts`.
- **Hrana surfaces constraint violations as the generic P2039**, never P2002/P2003, so control flow
  must not depend on those codes. Check first, then write.

## 6. Deployment modes and sign-up (delegated)

**`workspaceMode()`** lives in a module with no `server-only` or `next/*` imports, so the seed, the
reset, `tsx` and the Docker esbuild bundle can all import it.
- It throws on any value other than `single` or `multi`.
- Unset means `single`, **except when `NODE_ENV=production`, where unset fails**. A cloud deployment
  that lost the variable must not silently become single.
- It is called at the top of instrumentation `register()` (before any early return), and by the seed,
  the reset and `add-demo-member`. All three refuse to run in `multi`.
- Boot also fails when `WORKSPACE_MODE=multi` and `DEMO_MODE=true`.
- **In `single` mode, boot and `register()` both refuse if more than one Workspace exists**, or if any
  workspace has plan `PAID`.

| | `single` (self-host, public demo) | `multi` (paid cloud) |
|---|---|---|
| Workspaces | Exactly one: `DEFAULT_WORKSPACE_ID` | One per sign-up |
| Register | `ensureSingleWorkspace` + `ensureMember`. The first member becomes OWNER; later ones become MEMBER | One transaction: User + Workspace (`"<name>'s workspace"`, slug = slugified name + random suffix) + OWNER Membership |
| Plan limits (§7) | Not enforced: self-host is free and unlimited | Enforced |
| AI usage ledger and daily ceiling | Recorded; the ceiling applies when set | Recorded; the ceiling applies when set |
| Copy and `DEMO_MODE` | Unchanged, still per deployment | `DEMO_MODE` must be off |

**Why modes, not "multi everywhere":**
- The demo's sign-ups are meant to join the shared sandbox; the e2e tests and the register copy depend
  on it.
- A self-hoster runs one team.

**Where the variable is set:**
- The Dockerfile's runner stage bakes `ENV WORKSPACE_MODE=single`.
- The demo's Vercel project and CI's e2e job set it explicitly. Setting it on Vercel is a
  production-config step that needs the user's go **before** the phase-A merge (§10).
- README and `.env.example` document it as required in production for non-Docker self-hosters.

Registering in one transaction also fixes today's race, where two concurrent first sign-ups can both
become admins.

## 7. Plans, limits and AI metering (delegated numbers)

All numbers live in `src/lib/plans.ts`. Spec 3's billing only flips `Workspace.plan`.

| Limit (`multi` mode) | FREE | PAID |
|---|---|---|
| Members | 1 | 10 (spec 3's invites) |
| Contacts | 200 | 10,000 |
| Companies | 100 | 5,000 |
| Deals (all stages) | 100 | 5,000 |
| AI actions per calendar month (UTC) | 30 | 600 |

**Why these numbers:**
- They are big enough to evaluate the product properly and run a solo pipeline. That answers the
  research's warning that record caps frustrate evaluators.
- They are small enough that a team outgrows them.
- They are tunable in one file.

**Records.** The create actions count, then create, **without** an interactive transaction (§5.2). A
small overshoot under concurrency is accepted.

**AI actions metered:** `scoreContact` = `score`, `summarizeContact` = `summary`, `draftFollowUp` =
`draft`. `sendFollowUp` and `extractFileText` make no model call and write no `AiUsage`.

**Order of operations for one AI action:**

1. **Monthly allowance (multi only).** Count this UTC month's rows with outcome `pending`, `answered`
   or `rejected`. At the limit: write a `denied` row, return a plain message, make no call.
   - `fallback` (no provider output: 429, error, timeout, no key) and `capacity` rows are **not**
     charged. A workspace never pays for an outage or for another tenant's use.
2. **Daily ceiling (any mode, when `AI_DAILY_CEILING` is set).** `aiCallsToday()` counts rows with
   outcome `pending`, `answered` or `rejected` since 00:00 UTC, across all workspaces, through
   `systemDb`, using the `createdAt` index. At the ceiling: write a `capacity` row and answer with the
   rule-based fallback under a **new degraded reason and label**, "rule-based fallback (daily AI
   capacity reached)", added to `provider.ts` and `label.ts`. Reusing `rate_limited` would wrongly
   blame the provider.
3. **Reserve.** Insert the row as `pending` **before** the provider call, so concurrent requests see
   it and both limits hold. A row left pending by a killed function stays counted, which fails closed.
   Under concurrency the overshoot is bounded by the number of in-flight requests, as for records.
4. **Call.** Then update the row to `answered`, `rejected` (a 200 reply that failed validation, then
   fallback) or `fallback`, with the provider and tokens.

**Token capture needs `provider.ts` changes:**
- Each attempt carries its usage: Groq `usage.prompt_tokens` / `completion_tokens`; Gemini
  `usageMetadata.promptTokenCount` and `candidatesTokenCount + thoughtsTokenCount`.
- `runChain` returns the summed tokens of **all** attempts, including rejected 200 replies, on both
  success and failure.
- `AiUsage.provider` is the provider that answered, or null.

The in-memory per-user rate limit stays, as burst protection only.

**One Groq quota, three consumers.** The demo (Gemini first, Groq after Gemini's 20 free requests a
day), the nightly eval and the cloud all draw on **one Groq organisation quota**, and Groq's terms
forbid opening more organisations.
- The ceiling applies in any mode, so **the demo sets its own `AI_DAILY_CEILING`**.
- The cloud's is sized to what remains: the organisation limit, minus the demo ceiling, minus the
  eval's roughly 12–18 calls a night.
- Size it from **whichever daily limit binds first in the Groq console**: requests per day, or tokens
  per day divided by measured tokens per action (from `AiUsage`). At about 1.5K–7K tokens a call, a
  token limit can bind far below the request limit.
- Default: unset, meaning no ceiling, so self-hosters are unaffected.

**AI providers by deployment.** The chain in `src/lib/ai/provider.ts` is already built from whichever
keys are set (`GEMINI_API_KEY`, then `GROQ_API_KEY`, then rule-based):
- The demo keeps both keys.
- **The cloud sets only `GROQ_API_KEY`.** Gemini's free-tier terms forbid personal information, and
  every cloud workspace holds real contacts.
- **Scaling in spec 1 is deployment-wide.** Adding a paid-project Gemini key puts Gemini first for
  every cloud workspace, at the paid per-token rates, which double on 2027-01-01. Routing by plan
  ("paid workspaces only") belongs to spec 3, when PAID workspaces exist.
- Groq Zero Data Retention is a console setting.
- **W13's nonce fence is a launch blocker for the cloud deployment**. gpt-oss-120b obeyed injections
  in the evals. W13 is tracked separately and is not part of this spec.

## 8. Bootstrap, seeds and the demo reset

**`src/lib/workspace-bootstrap.ts`** has no `server-only` or `next/*` imports and takes the client as
a parameter.
- `ensureSingleWorkspace(db)` inserts `DEFAULT_WORKSPACE_ID` if absent. The primary key makes a second
  default impossible.
- `ensureMember(db, userId, role)` upserts the user's membership. In single mode it also refuses when
  more than one workspace exists.

Callers:
- **Single-mode `register()`**: inside its transaction, via `tx`.
- **`prisma/seed.ts`**:
  - `ensureSingleWorkspace`, then the demo account `demo@nexuscrm.dev` gets an **ADMIN** membership,
    as PRD §5.2 says today.
  - `seedDemoData(db, workspaceId)` stamps `workspaceId` on every row, including the `system.seed`
    audit row.
  - `ensureDemoUser` stops writing `User.role`.
- **`prisma/add-demo-member.ts`**: an upserted **MEMBER** membership for `member@nexuscrm.dev`.
- **The reset**: re-upserts the demo account's ADMIN membership and never creates a workspace.
- **The harness's `truncateAll`/`makeUser` and the eval seed**: updated to match.

**`isDemo` is the reset's permission bit and nothing else.** The app's demo signal stays `DEMO_MODE`;
no app code reads `isDemo`.
- **The reset never writes it.** A unit test asserts this.
- **The seed writes it only when `SEED_DEMO_WORKSPACE=true`.** Docker's `SEED_DEMO_DATA` path and CI
  never set it, so a self-hoster's real workspace can never be marked resettable.
- **On the existing demo database**, a one-off script sets it, run with the user's go after M1's
  verify gate (§10). `scripts/mark-demo-workspace.ts` sets `isDemo = 1` only if exactly one workspace
  exists and the demo account is a member of it; otherwise it refuses.

**The reset is two units:**
- `assertResettable(db)` exits non-zero unless exactly one Workspace exists and its `isDemo = 1`.
- `resetDemoWorkspace(db, workspaceId)`:
  - deletes CRM rows where `workspaceId = id` **or `workspaceId IS NULL`**. In single mode the guard
    has already ensured one workspace, so null rows can only be demo rows left by an old build;
  - reseeds;
  - prunes audit with today's rule: the demo account's rows, plus **any** row older than 30 days,
    workspace or platform. PRD L10's retention stays intact.

Each unit is tested separately. The delete-scope test uses two workspaces against
`resetDemoWorkspace` alone.

**The cloud has no reset**, so its audit retention needs another owner. That is on the before-launch
list (§12).

## 9. Testing

1. **Cross-tenant suite.**
   - Page reads move into exported loaders that take the context: `src/server/queries/<page>.ts`.
   - The harness mocks `@/lib/db` as `{ systemDb: harnessClient, scopeToWorkspace, forWorkspace: ws =>
     scopeToWorkspace(harnessClient, ws) }` and fakes **only the session-cookie lookup**, so
     `getWorkspaceContext` resolves memberships for real.
   - It seeds workspaces A and B fully. It calls **every export of every `'use server'` module under
     `src/`** and every loader as A's user, using B's ids, and asserts "not found" or "forbidden" with
     no B row changed.
     - An explicit exemption list covers exports that never touch the database (e.g.
       `extractFileText`, `currentAiProvider`).
     - It includes the roster, the audit card, search, the dashboard aggregates, the AI context
       builder, and multi-mode `register()` (a sign-up never joins an existing workspace).
   - A new export or loader without a case fails the run.
2. **Model map and operations:** the completeness test, plus every operation name per tenant model.
   Unknown operations throw, `forWorkspace(x).user.findMany()` throws, and so do raw calls and
   relation-object writes.
3. **Imports:** no `systemDb` outside the §5.1 allowlist, and no `PrismaClient` construction outside
   `db.ts` and the harness, anywhere in `src/`.
4. **libSQL driver (`PrismaLibSql`, `file:`)**:
   - multi-mode `register()`;
   - `createContact` with a `companyId`, `createCompany` and `createDeal`;
   - a deliberate outer-client call inside a transaction callback, as a negative fixture that must
     time out.
   - This pins §5.2, which the better-sqlite3 harness cannot see.
5. **`register()`** (no unit tests exist today): both modes, atomic creation, the first-member race,
   and refusal on more than one workspace in single mode.
6. **Bootstrap, seed and reset:**
   - `migrate deploy` + `db:seed` on an empty database lets the demo account sign in and see data.
   - `add-demo-member` gives a MEMBER membership.
   - `assertResettable`: refuses on `isDemo = 0`, on two workspaces, and on none.
   - `resetDemoWorkspace` deletes only its workspace's rows and null rows.
   - The reset never writes `isDemo`.
   - The prune rule holds.
7. **Limits and metering:**
   - Record caps.
   - The allowance across a UTC month boundary.
   - Only `pending`, `answered` and `rejected` are charged.
   - N parallel calls at limit−1 overshoot by at most the in-flight count.
   - `denied` and `capacity` rows are written, and the capacity label shows.
   - The ceiling counts across workspaces.
   - Token sums include rejected replies.
8. **Migrations.** The harness gains `createTestDatabase({ through: "<migration dir>" })` plus a way to
   apply the rest, and fixtures at older schemas are inserted with raw SQL.
   - **M1:** start from pre-M1 fixtures (an ADMIN, a MEMBER, `auth.*` and non-auth audit rows, CRM
     rows). Expect one membership per user with the role copied, every CRM row and non-auth audit row
     in the default workspace, and auth rows null. A zero-user database gets no workspace.
   - **M2:** start from window fixtures (null-`workspaceId` CRM rows, a user with no membership, a null
     non-auth audit row). Expect the catch-up applied, an empty `PRAGMA foreign_key_check`, NOT NULL
     in force, and one membership per user.
9. **e2e.**
   - The existing single-mode flows stay green.
   - A **second Playwright project** with its own `webServer` covers multi mode:
     - another port, `WORKSPACE_MODE=multi`, `DEMO_MODE` unset;
     - its own `DATABASE_URL` file, migrated but not seeded;
     - `testMatch: e2e/multi-*.spec.ts`, which the default project ignores;
     - its own in-memory rate limiter, so its sign-ups don't count against the single server's
       5-per-15-minutes register limit.
   - CI prepares that database before `test:e2e`. One build serves both servers, because
     `WORKSPACE_MODE` is read at runtime, never inlined.
10. **CI drift check:** add `prisma migrate diff … --exit-code` against the schema after migrations
    are applied, so a hand-edited migration can't drift. The plan confirms the exact Prisma 7 flags.

## 10. Rollout: two phases, two PRs

Every migration must run unchanged on all four paths: Prisma Migrate (CI and dev), the Turso runner
(`scripts/db-push-turso.ts`), the Docker runner (`scripts/docker-entrypoint.mjs`) and the harness. No
libSQL-only syntax. **Every production step below needs the user's explicit go**, because delegated
design doesn't cover production changes.

### Phase A: M1 + the new code (one PR)

**Plan task 1, the spike.** Prove each of these, or record that it failed:
- the dual composite key (§4.3), in Prisma's schema and generated SQL;
- the M2 file shape below, on all four paths, confirming that none of them already wraps the script in
  a transaction;
- that a forced mid-file failure leaves the original tables intact.

**Plan task 2, tooling.**
- Port `backup-turso.cjs` into `scripts/`. The surviving copy is at
  `CRM\A project\research\migration-scripts\`. It uses a repo-relative path and writes to a gitignored
  folder.
- Write a **migration-specific** verify script. **M1 checks:**
  - three new tables;
  - a workspace exists if and only if a user exists;
  - every user has exactly one membership, with its role copied;
  - no null `workspaceId` outside `auth.*` audit rows;
  - no drift.

**M1** is generated with `prisma migrate dev --create-only`. The plan checks that the output has no
table rebuild. Only data statements are appended:
- insert the default workspace with an explicit `updatedAt`, *only if* a User exists;
- one membership per user, copying `User.role` as is (ADMIN→ADMIN, MEMBER→MEMBER), with id
  `'mem_' || id`;
- the backfill updates. AuditLog is backfilled only where `action NOT LIKE 'auth.%'`.

M1 doesn't promote anyone to OWNER: on the demo database the earliest admin is the published demo
account. OWNER goes only to new creators, and spec 3 can promote.

**Production order for phase A:**
1. **Step 0, read-only:** read `PRAGMA foreign_keys` (several times) and `pragma_compile_options`
   through the production adapter. The research expects 1; it is unverified.
2. **Disable `reset-demo.yml`.** It stays off until step 9. The old reset would reseed demo rows with
   null `workspaceId`.
3. Run the backup.
4. Apply M1 on a Turso branch as a rehearsal, then on production. Run the verify gate.
5. Run `scripts/mark-demo-workspace.ts`.
6. Set `WORKSPACE_MODE=single` on the demo's Vercel project.
7. Merge the phase-A PR. Confirm the production deployment of that commit is live and nothing older
   is serving.
8. **Run the catch-up script** (`scripts/backfill-workspace.ts`, idempotent). It covers anything the
   old build wrote between M1 and the deploy:
   - a MEMBER membership in the default workspace for every user without one;
   - null `workspaceId` CRM rows set to the default;
   - null non-`auth.*` audit rows set to the default.
9. Re-enable the reset after one manual run passes `assertResettable`.

Keep every step clear of the reset's real firing window, about 21:18–21:35 UTC.

### Phase B: M2 (a separate, later PR)

M2's migration directory **must not exist on `main`** before phase A is verified live. Every runner
applies every pending directory, and under migrate-before-merge an early M2 would hit the old code.

**M2 file shape:**
```
PRAGMA defer_foreign_keys=ON; PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;
  <the catch-up statements from step 8, again, idempotent>
  <rebuild Company, Contact, Deal, Activity, Task: workspaceId NOT NULL, COALESCE(workspaceId, '<default id>') in each INSERT…SELECT, the Workspace relation, the parent UNIQUE and composite keys if the spike passed, owner relations Restrict>
  <rebuild AuditLog: the Workspace relation, workspaceId stays optional>
  <recreate every index>
COMMIT; PRAGMA foreign_keys=ON; PRAGMA defer_foreign_keys=OFF;
```
- User and Session are **not** rebuilt, because `User.role` stays.
- M2 keeps the standard **migrate-before-merge** order. Phase A's code already writes `workspaceId`
  on every create and doesn't touch `User.role`, so the live build runs safely on M2's schema.

**Production order for phase B:**
1. Backup.
2. A rehearsal on a Turso branch with real data.
3. A per-failure recovery note, written **before** the production run, covering when to clear an
   unstamped ledger claim.
4. Apply M2 on production.
5. **M2 verify gate:**
   - no leftover `new_*` tables;
   - NOT NULL in force;
   - an empty `foreign_key_check`;
   - row counts equal to the backup;
   - one membership per user.
6. Merge the PR.

Self-hosters who upgrade across both releases get M1 and M2 back to back, which is safe.

## 11. Docs to update in the same PRs

- **PRD.** Amend §1, §4 (multi-tenancy and billing become superseded non-goals, dated, with the
  reason), §5.2/§5.3, A2, J3, J4, L2, L8, L10, and the §9.3 line "Do not describe this product as
  multi-tenant".
- **DATA-MODEL and TECHNICAL-DESIGN:** a new ADR for tenancy and the modes.
- **GLOSSARY:** workspace, membership, modes, plans, `isDemo`.
- **SAAS-READINESS:** §6.
- **README and `.env.example`:** `WORKSPACE_MODE` (required in production), `AI_DAILY_CEILING`,
  `SEED_DEMO_WORKSPACE`, and which AI keys the cloud sets.
- **The landing and brand copy are unchanged.** They belong to the demo deployment, and buyer-facing
  copy comes with the cloud launch.

## 12. Out of scope, and why the split

- **Spec 2, email foundation:** a custom domain, a verified sending domain (Resend), email
  verification and password reset. It needs a domain purchase.
- **Spec 3, billing and team invites.** It needs a vendor account.
  - A provider-neutral billing seam: Paddle first, Polar as runner-up. Stripe does not serve
    Philippines-based sellers, and Paddle's seller eligibility for the Philippines must be confirmed
    with Paddle, because the research is split.
  - Webhooks that flip `plan`.
  - `Invitation`, member management (which reassigns records first), the member cap, per-plan AI
    provider routing, and promoting a workspace OWNER on existing installs.
- **Why this order:** free means one user, so invites only matter on the paid plan, and spec 1 ships
  to the existing deployment with no purchases or accounts.
- **Before the cloud launches** (not in any of the three):
  - creating the cloud deployment and choosing hosting (about $26/month for Vercel Pro + Turso
    Developer, versus about $5–6/month running the Docker image on Fly.io Singapore, Railway or
    DigitalOcean);
  - written confirmation of Turso's terms;
  - W13;
  - cloud audit retention;
  - a two-sign-up isolation smoke test against the deployed cloud.
- **Deferred indefinitely:** multi-workspace membership, URL-based workspace routing, per-workspace
  currency, dropping `User.role`.

## 13. Risks and open items

| Risk | Handling |
|---|---|
| A missed scope leaks data | `scopeToWorkspace` fails closed (raw, global models and unknown operations throw; writes are plain columns only); §9.1 enumerates every action and loader; §9.3 bans raw clients in all of `src/` |
| The cloud boots without `WORKSPACE_MODE` | Unset fails in production; single mode refuses more than one workspace or any PAID workspace |
| The nightly reset wipes customers | A separate demo DB; `isDemo` set only by a human-run script; the reset never writes it and refuses unless the only workspace is `isDemo` |
| The production-driver deadlock | The §5.2 rule plus the §9.4 libSQL tests |
| The old build writes in the expand window | Reset disabled; idempotent catch-up after deploy and again inside M2 |
| The composite-key spike fails | The §5.4 app-level check is mandatory regardless |
| Production FKs are actually off | Step 0 finds out before M1 |
| The shared Groq quota | The demo ceiling, the cloud ceiling sized to what remains, monthly allowances; scale by adding keys |
| Turso's terms ("non-commercial … not for the benefit of any third party") | The user asks Turso in writing before the cloud launch; it doesn't block spec 1 |
