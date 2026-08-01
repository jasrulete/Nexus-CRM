# Nightly demo reset — design

Date: 2026-08-01

## Problem

`/` publicly invites visitors to "Try the live demo". `DEMO_MODE=true` stops
them deleting records, but nothing stops them creating or editing. Junk
accumulates and edits persist, so the demo drifts away from the polished state a
recruiter should see.

## Scope

Delete every CRM row and re-seed the demo dataset. **The `User` table is never
touched.** Production holds three accounts — the demo admin, a member demo
account, and Jeric's personal account — and wiping users would delete a real
login every night.

## Trigger: GitHub Actions, not Vercel Cron

A scheduled workflow runs a script directly against Turso using repository
secrets.

The alternative — Vercel Cron hitting a `CRON_SECRET`-guarded route — is the
more common pattern and was rejected deliberately. It requires publishing a URL
whose purpose is to erase the database; a leaked secret or a flawed guard is a
total data loss. It would also need a proxy bypass, and Hobby function duration
limits are a real risk given the seed writes ~50 rows over the network.

GitHub Actions has no public endpoint at all. It also gives a manual re-run
button, retained logs, and failure notifications. Fork PRs cannot read secrets.

Vercel Hobby is capped at one cron run per day with ±59 min precision anyway, so
nothing is lost on scheduling granularity.

## Code structure

`prisma/seed.ts` currently returns early when the demo user exists, so with
accounts preserved it could never re-create data. Its two halves separate:

| Unit | Responsibility |
|---|---|
| `prisma/seed-data.ts` → `ensureDemoUser(prisma)` | Find or create the demo account |
| `prisma/seed-data.ts` → `seedDemoData(prisma, ownerId)` | Create the companies, contacts, deals, activities and tasks |
| `prisma/seed.ts` | Env guard, then compose both — unchanged skip-if-present behaviour |
| `scripts/reset-demo.ts` | Guard, delete CRM rows, then `seedDemoData` |

`ensureDemoUser` pins the demo account to `ADMIN`. The current code assigns
`ADMIN` only when the user table is empty (`userCount === 0 ? "ADMIN" : "MEMBER"`),
so re-seeding alongside other accounts silently downgrades the demo to `MEMBER`
and changes what the demo can do. Pinning removes that trap.

The demo email is imported from `src/lib/demo-guard.ts` rather than repeated a
third time — the reset has to target exactly the account the guard protects.

## Deletion

Ordered to respect foreign keys: activities, tasks, audit logs, deals, contacts,
companies. Rows are deleted per table; nothing is dropped, and `User`,
`Session` and `_turso_migrations` are never touched. Sessions survive, so
visitors mid-session are not signed out.

## Safety

`resolveResetTarget()` picks the database and **defaults to local even when
Turso credentials are present** — they always are, since `.env` carries them for
`db:push:turso`. Refusing outright instead would have made the script unusable
for development, which is how a safety check gets worked around. Reaching
production requires `ALLOW_REMOTE_DB=true`, the same flag `createDbAdapter()`
already honours, so the target the script reports is the one it actually uses.

Opting in with no `TURSO_DATABASE_URL` throws rather than silently wiping the
local database instead.

The script logs row counts before and after, so a run that deleted more than
expected is visible in the workflow log, and it refuses to report success if the
user table ends up empty.

## Testing

- `resolveResetTarget` is a pure function with unit tests covering all four
  cases: credentials without opt-in (local), with opt-in (remote), a non-`"true"`
  flag value (local), and opt-in with nothing configured (throws).
- Delete ordering and `seedDemoData` idempotency are verified by running the
  reset against the local database: 28 contacts collapse to the seed's 12, every
  other table returns to its seed count, users are untouched, and repeat runs
  leave the counts unchanged.

Full DB-backed unit tests are out of scope: they would need migrations applied to
a throwaway database inside vitest, which the project does not currently set up
for any other test.

## Out of scope

Restoring individual edited fields (a diff-based reset), resetting on any
schedule faster than daily, and any UI showing when the last reset ran.
