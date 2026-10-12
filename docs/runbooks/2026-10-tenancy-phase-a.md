# Runbook — multi-tenancy phase A on the demo deployment

Spec: `docs/superpowers/specs/2026-10-11-multi-tenancy-core-design.md` §10. Takes the public demo — the
Vercel project serving https://nexus-crm-jer2x.vercel.app and the Turso database `nexus-crm` — from the
single-tenant build to the phase-A build: migration M1 (`prisma/migrations/20261011180555_workspaces_expand`),
the `isDemo` mark, `WORKSPACE_MODE=single`, the merge, and the catch-up.

Written 2026-10-12, before any step was run.

## Rules for every step

- **Every step marked GO needs the owner's explicit go, given in chat for that step.** Delegated design
  does not cover production changes. A passing step is not a go for the next one.
- **Timing.** The nightly reset really fires at about 21:18–21:35 UTC (05:18–05:35 Manila); GitHub delays
  the 19:00 UTC cron. Keep every step clear of that window, including after step 2 disables the workflow.
- **Order.** Exactly as listed: V, P, then 0 to 9. The M2 migration directory must not exist on `main`
  until phase A is verified live (spec §10, phase B).
- **Identity.** Every `gh` command runs as `jasrulete`, then switches back:
  `gh auth switch --user jasrulete 2>&1 | Out-Null` before, `gh auth switch --user <work-account> 2>&1 | Out-Null` after.
- **Shell.** PowerShell 7 at the repo root. `.env` holds the production `TURSO_DATABASE_URL` and
  `TURSO_AUTH_TOKEN`. A variable set with `$env:` wins over `.env` (dotenv never overrides), so every step
  that sets one removes it again.
- **Confirm the database before every remote step (0, 2, 3, 4, 5, 8 and 9).**
  `scripts/mark-demo-workspace.ts`, `scripts/backfill-workspace.ts` and `npm run demo:reset` print only
  `local` or `remote` as their target, so a run against a Turso branch reads exactly like a run against
  production. Until that output says more, the operator checks first, by hostname and never by token. Define
  this once per PowerShell session (a function lasts only as long as the session) and call it at the top of
  each remote step:

  ```powershell
  function Show-Target {
    $url = $env:TURSO_DATABASE_URL
    if (-not $url) {
      $url = ((Select-String -Path .env -Pattern '^\s*TURSO_DATABASE_URL\s*=' | Select-Object -First 1).Line -split '=', 2)[1].Trim().Trim('"', "'")
    }
    "this step reaches:      " + ([uri]$url).Host
    "production (nexus-crm): " + ([uri](turso db show nexus-crm --url)).Host
  }
  ```

  Steps 0, 2, 4, 5, 8 and 9 touch production: the two hostnames must be identical. Step 3 touches the
  rehearsal branch: the first must name `nexus-crm-m1-rehearsal` and differ from the second. Anything else:
  stop, and tell the owner.
- **Record.** After each step, write the UTC time and the evidence into HANDOVER §7s.

## Before step 0 (local only)

- The local `dev.db` is migrated and seeded on the phase-A schema, since the single-mode e2e project signs
  in to it as the demo account. With no Nexus server running:

  ```powershell
  New-Item -ItemType Directory -Force backups | Out-Null
  if (Test-Path dev.db) { Copy-Item dev.db ("backups/dev-db-before-e2e-reset-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".db") }
  Remove-Item -Force -ErrorAction SilentlyContinue dev.db, dev.db-journal
  npx prisma migrate deploy
  $env:WORKSPACE_MODE = "single"; npm run db:seed; Remove-Item Env:WORKSPACE_MODE
  ```

  Success: `All migrations have been successfully applied.`, then `Seeded demo workspace:` with
  `6 companies, 12 contacts, 14 deals`. `Seed data already present` means `dev.db` was still open and not
  deleted: stop the server and repeat.
- `feat/multi-tenancy-core` passes the full gate: `npm run typecheck`, `npm run lint`,
  `npm run test:coverage`, `npm run eval`, `Remove-Item -Recurse -Force .next; npm run build`,
  `$env:DATABASE_URL = "file:./e2e-multi.db"; npx prisma migrate deploy; Remove-Item Env:DATABASE_URL`, and
  `npm run test:e2e` with both projects (`$env:CI = "1"; $env:WORKSPACE_MODE = "single"; npx playwright test`).
- Tools are signed in: `turso auth whoami`, `gh auth status`, `npx vercel whoami`.
- **The Docker image has not been built or booted.** Docker Desktop's daemon was down when the Dockerfile
  was changed for phase A, so its `WORKSPACE_MODE=single` line was checked by reading only. Phase A does not
  ship the image, but one boot with `SEED_DEMO_DATA=true` is recommended before relying on Docker for
  anything. With no Nexus server on port 3000, `docker compose up -d --build` is that boot (the compose file
  sets `SEED_DEMO_DATA`); then `docker compose down -v` deletes its throwaway volume. Success: the container
  applies the migrations and seeds the demo workspace, http://localhost:3000/api/health answers
  `{"status":"ok"}`, and **Try the demo** signs in.

### Step V — set `WORKSPACE_MODE=single` on the demo's Vercel project, Preview and Production (GO; before step P)

Pushing the branch in step P makes Vercel build a preview deployment of it, and the phase-A build refuses to
boot under `NODE_ENV=production` without the variable; the merge in step 7 does the same for Production. So
it is set for both environments before anything is pushed. The live (old) build ignores the variable, so
setting it now is harmless and needs no redeploy.

```powershell
"single" | npx vercel env add WORKSPACE_MODE production
"single" | npx vercel env add WORKSPACE_MODE preview
npx vercel env ls
```

(Or: Vercel → the demo project → Settings → Environment Variables → add `WORKSPACE_MODE` = `single` with
**Production** and **Preview** ticked.) If the CLI asks which Git branch the Preview value is for, leave it
empty: all Preview branches. Success: `npx vercel env ls` lists `WORKSPACE_MODE` for Production and for
Preview.

### Step P — push the branch and open the PR (GO: the repo is public)

```powershell
gh auth switch --user jasrulete 2>&1 | Out-Null
git push -u origin feat/multi-tenancy-core
gh pr create -R jasrulete/Nexus-CRM --base main --head feat/multi-tenancy-core --title "feat: multi-tenancy core, phase A (M1 and workspace-scoped code)" --body "Phase A of docs/superpowers/specs/2026-10-11-multi-tenancy-core-design.md: migration M1, the fail-closed workspace-scoped client, WORKSPACE_MODE=single|multi, plan limits and AI metering, the cross-tenant suite. Do not merge before runbook step 7 (docs/runbooks/2026-10-tenancy-phase-a.md).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks feat/multi-tenancy-core -R jasrulete/Nexus-CRM --watch
gh auth switch --user <work-account> 2>&1 | Out-Null
```

Success: `ci` and `Analyze JavaScript/TypeScript` pass. Do not merge.

### Step 0 — read the production pragmas (GO; read-only)

Run `Show-Target` first (Rules): the two hostnames must be identical.

```powershell
Show-Target
$env:ALLOW_REMOTE_DB = "true"
npx tsx scripts/read-db-pragmas.ts
Remove-Item Env:ALLOW_REMOTE_DB
```

Success: `Reading pragmas from the remote database (read-only).`, five `foreign_keys read N:` lines, and
the compile options. Record all of it. The research expects every read to be `1` and the options to
include `DEFAULT_FOREIGN_KEYS=1`. If any read is `0` or the reads disagree, stop and tell the owner: phase
A can still go ahead (M1 adds no foreign keys to existing tables), but phase B's design assumes `1`.

### Step 1 (spec step 2) — disable the nightly reset (GO)

The reset on `main` is still the old one, and it would reseed demo rows with no `workspaceId`.

```powershell
gh auth switch --user jasrulete 2>&1 | Out-Null
gh workflow disable reset-demo.yml -R jasrulete/Nexus-CRM
gh workflow list --all -R jasrulete/Nexus-CRM
gh auth switch --user <work-account> 2>&1 | Out-Null
```

Success: `Reset demo data` shows `disabled_manually`. It stays disabled until step 9.

### Step 2 (spec step 3) — back up production (GO; read-only)

Run `Show-Target` first (Rules): the two hostnames must be identical.

```powershell
Show-Target
npx tsx scripts/backup-turso.ts pre-m1
```

Success: the script names the JSON file it wrote under the git-ignored `backups/` folder
(`backups/turso-backup-pre-m1-<stamp>.json`) and prints a row count per table. Record the file name and the
counts; steps 3 and 4 pass this file to `verify-m1 --backup`, and the M2 gate compares against it too.

### Step 3 (spec step 4, rehearsal) — apply M1 to a Turso branch and verify (GO)

```powershell
$backup = (Get-ChildItem backups -Filter 'turso-backup-pre-m1-*.json' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
"backup: $backup"
turso db create nexus-crm-m1-rehearsal --from-db nexus-crm
$env:TURSO_DATABASE_URL = (turso db show nexus-crm-m1-rehearsal --url)
$env:TURSO_AUTH_TOKEN = (turso db tokens create nexus-crm-m1-rehearsal)
$env:ALLOW_REMOTE_DB = "true"
"target: $env:TURSO_DATABASE_URL"
Show-Target
npm run db:push:turso
npx tsx scripts/verify-m1.ts --backup $backup
Remove-Item Env:TURSO_DATABASE_URL, Env:TURSO_AUTH_TOKEN, Env:ALLOW_REMOTE_DB
turso db destroy nexus-crm-m1-rehearsal --yes
```

Success: the backup line names the `turso-backup-pre-m1-…json` file step 2 wrote; the target line names
`nexus-crm-m1-rehearsal`, and so does the first line `Show-Target` prints (the second must differ);
`Applied 1 migration(s) to libsql://nexus-crm-m1-rehearsal-…`; every verify check passes and the last line is
`ALL M1 CHECKS PASSED` (three new tables; a workspace exists if and only if a user does; one membership per
user with its role copied; no null `workspaceId` outside `auth.*` audit rows; no drift; and the CRM row
counts — Company, Contact, Deal, Activity, Task — equal the backup's). If the push or the verify fails, stop:
production is untouched, and the failure goes to the owner with the output. A failure of the row-count check
alone usually means a visitor changed CRM rows on the live demo after step 2: give the owner both sets of
counts; the fix is a fresh step 2 and then this step again.

### Step 4 (spec step 4, production) — apply M1 to production and verify (GO)

Outside the reset window. The old build keeps serving on the new schema: M1 only adds tables, nullable
columns and indexes.

```powershell
$backup = (Get-ChildItem backups -Filter 'turso-backup-pre-m1-*.json' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
"backup: $backup"
"target from .env (must print nothing here): $env:TURSO_DATABASE_URL"
Show-Target
npm run db:push:turso
$env:ALLOW_REMOTE_DB = "true"; npx tsx scripts/verify-m1.ts --backup $backup; Remove-Item Env:ALLOW_REMOTE_DB
```

Success: the backup line names the file step 2 wrote; the two hostnames `Show-Target` prints are
identical; `Applied 1 migration(s) to libsql://nexus-crm-…`, then every verify check passes and the last line
is `ALL M1 CHECKS PASSED`, the CRM row counts against that backup included. Then open the demo, click
**Try the demo**, and check the dashboard and the board render (old build, new schema). If only the row-count
check fails, M1 is already applied: do not re-run the push. Give the owner both sets of counts; a visitor's
CRM writes since step 2 are the usual cause, and the owner decides whether they explain the difference.

If the push stops partway, `_turso_migrations` keeps a row for M1 with an empty `applied_at`, and the next
push refuses to continue. Do not delete that row and do not re-run. Stop and take the backup from step 2,
the push output and the verify output to the owner; the recovery is decided with them.

### Step 5 (spec step 5) — mark the demo workspace (GO)

Run `Show-Target` first (Rules): the two hostnames must be identical.

```powershell
Show-Target
$env:ALLOW_REMOTE_DB = "true"; npx tsx scripts/mark-demo-workspace.ts; Remove-Item Env:ALLOW_REMOTE_DB
```

Success: `Marking the demo workspace on the remote database.` then `Workspace ws_default is now marked isDemo.`
A `MARK_REFUSED` line means the database is not what this runbook assumes: stop.

### Step 6 (spec step 6) — confirm `WORKSPACE_MODE=single` is still set on the demo's Vercel project (GO; read-only; before the merge)

Step V set it for Preview and Production before the push. The merge's production build refuses to boot
without it, so confirm nothing has removed it since:

```powershell
npx vercel env ls production
npx vercel env ls preview
```

Success: `WORKSPACE_MODE` is listed in both. If it is missing from either, add it again exactly as in step V
(that needs its own GO) before step 7.

### Step 7 (spec step 7) — merge, and confirm the new build is the one serving (GO)

```powershell
gh auth switch --user jasrulete 2>&1 | Out-Null
gh pr checks feat/multi-tenancy-core -R jasrulete/Nexus-CRM
gh pr merge feat/multi-tenancy-core --merge -R jasrulete/Nexus-CRM
gh auth switch --user <work-account> 2>&1 | Out-Null
git fetch origin
$sha = git rev-parse origin/main
$dep = gh api "repos/jasrulete/Nexus-CRM/deployments?sha=$sha&environment=Production" --jq '.[0].id'
gh api "repos/jasrulete/Nexus-CRM/deployments/$dep/statuses" --jq '.[0] | {state, environment_url}'
```

If `$dep` prints empty, Vercel has not created the deployment yet: wait a minute and run the `$dep` line
again. Repeat the last command until `state` is `success`; `failure` or `error` means stop (the old build
keeps serving; `npx vercel inspect <environment_url> --logs` shows why). Then confirm nothing older is
serving:

```powershell
npx vercel inspect nexus-crm-jer2x.vercel.app
```

Success: the deployment it names is the one in `environment_url`. Then a browser check: open
https://nexus-crm-jer2x.vercel.app/login → **Try the demo** → the dashboard shows the seeded data;
`/settings` shows the roster by name with no other member's email, and an audit card with no `auth.login`
rows; https://nexus-crm-jer2x.vercel.app/api/health answers `{"status":"ok"}`.

### Step 8 (spec step 8) — run the catch-up (GO)

Covers whatever the old build wrote between step 4 and step 7. Idempotent. Run `Show-Target` first (Rules):
the two hostnames must be identical.

```powershell
Show-Target
$env:ALLOW_REMOTE_DB = "true"
npx tsx scripts/backfill-workspace.ts
npx tsx scripts/verify-m1.ts
Remove-Item Env:ALLOW_REMOTE_DB
```

Success: `Backfill complete.` with its counts (often all zero), then every verify check passes and the last
line is `ALL M1 CHECKS PASSED`. A second run of the backfill prints zeros. The verify runs **without**
`--backup` here, on purpose: the live demo has taken traffic since step 2, so its CRM rows no longer match
the pre-M1 backup. Session, User and AuditLog have grown from that traffic too; that growth is expected, and
`verify-m1` never compares those tables.

This step runs while the phase-A deploy is live. Its membership upsert can hit a unique-constraint error
(Prisma `P2002`) if the live app joins the same user at the same moment. If the backfill fails that way, run
the block again: the script is idempotent, so the second run skips whatever the first already wrote.

### Step 9 (spec step 9) — one manual reset, then re-enable the nightly (GO)

The manual run is a real reset of the demo's CRM data, exactly what the nightly does. Outside the window.
Run `Show-Target` first (Rules): the two hostnames must be identical.

```powershell
Show-Target
$env:ALLOW_REMOTE_DB = "true"; npm run demo:reset; Remove-Item Env:ALLOW_REMOTE_DB
```

Success: `Resetting the remote demo workspace.`, `workspace: ws_default`, before/after counts, and
`Demo workspace reset.` A `RESET_REFUSED` line means step 5 did not take: stop, and leave the workflow off.
Then:

```powershell
gh auth switch --user jasrulete 2>&1 | Out-Null
gh workflow enable reset-demo.yml -R jasrulete/Nexus-CRM
gh workflow list --all -R jasrulete/Nexus-CRM
gh auth switch --user <work-account> 2>&1 | Out-Null
```

Success: `Reset demo data` shows `active`. The next morning, read the nightly run's log: it must print the
workspace line and `Demo workspace reset.`

## Rolling back

- **Before step 7:** nothing in production runs the new code. M1 is additive and the old build ignores it,
  so the schema, the memberships and the `isDemo` mark can all stay. If the owner decides to stop here,
  re-enable the reset (step 9's `gh workflow enable` commands): the old reset works on M1's schema, and a
  later phase-A attempt starts again from step 7 with the step-8 catch-up.
- **After step 7:** revert the merge through a PR (`gh pr create` from a `git revert -m 1 <merge sha>`
  branch, as `jasrulete`). Disable the reset first: the old reset would reseed rows with no workspace,
  which the step-8 backfill then has to catch again before phase A is re-merged. Memberships and
  `isDemo` can stay; the old build ignores them.

## Decisions for the owner (not steps)

- **`AI_DAILY_CEILING` for the demo.** Unset means no ceiling. The demo, the nightly eval and the future
  cloud share one Groq organisation quota; size the demo's ceiling from whichever daily limit binds first
  in the Groq console (requests per day, or tokens per day divided by tokens per action from `AiUsage`),
  then set it on Vercel Production like step 6.
- **Phase B (M2)** is a separate PR, started only after step 9 and one clean nightly.
