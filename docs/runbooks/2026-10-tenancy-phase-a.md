# Runbook — multi-tenancy phase A on the demo deployment

Spec: `docs/superpowers/specs/2026-10-11-multi-tenancy-core-design.md` §10. Takes the public demo — the
Vercel project serving https://nexus-crm-jer2x.vercel.app and the Turso database `nexus-crm` — from the
single-tenant build to the phase-A build: migration M1 (`prisma/migrations/20261011180555_workspaces_expand`),
the `isDemo` mark, `WORKSPACE_MODE=single`, the merge, and the catch-up.

Written 2026-10-12, before any step was run.

## Rules for every step

- **Every step marked GO needs the owner's explicit go, given in chat for that step.** Delegated design
  does not cover production changes. A passing step is not a go for the next one.
- **Stop on anything unexpected.** Any output other than the step's Success text — a script error, a stack
  trace, `undefined` where a number belongs, a `STOP:` line — means stop and report it to the owner. Do not
  retry and do not run the next block, unless the step itself says what to do (step 8's unique-constraint
  re-run).
- **Timing.** The nightly reset really fires at about 21:18–21:35 UTC (05:18–05:35 Manila); GitHub delays
  the 19:00 UTC cron. Keep every step clear of that window, including after step 1 disables the workflow.
- **Order.** Exactly as listed: V, P, then 0 to 9. The M2 migration directory must not exist on `main`
  until phase A is verified live (spec §10, phase B).
- **Identity.** Every `gh` command runs as `jasrulete`, then switches back:
  `gh auth switch --user jasrulete 2>&1 | Out-Null` before, `gh auth switch --user <work-account> 2>&1 | Out-Null` after.
- **Shell.** PowerShell 7 at the repo root. `.env` holds the production `TURSO_DATABASE_URL` and
  `TURSO_AUTH_TOKEN`. A variable set with `$env:` wins over `.env` (dotenv never overrides), so every step
  that sets one unsets it again. An unset variable is not an empty one: dotenv fills it from `.env`, which
  means production. That is why a failed `turso` command must never be allowed to fall through to the next
  line (next rule). This runbook unsets with `$env:NAME = $null` (the same as `Remove-Item Env:NAME`) and
  deletes a file with `[System.IO.File]::Delete((Join-Path $PWD '<file>'))` (the same as
  `Remove-Item <file>`), because some shells block `Remove-Item`. Use whichever form your shell allows.
- **Gate every remote command on its target.** The scripts print only `local` or `remote` as their target
  (`scripts/mark-demo-workspace.ts`, `scripts/backfill-workspace.ts` and `npm run demo:reset` do), so a run
  against a Turso branch reads exactly like a run against production, and a printed hostname does not stop
  the command that follows it. So each command that reaches Turso (steps 0, 2, 3, 4, 5, 8 and 9) runs
  inside an `if` that checks the exact expected hostname, by hostname only and never the token, and
  otherwise prints `STOP: …` and runs nothing; step 7's merge runs only if `gh pr checks` exits 0. Define
  the helpers once per PowerShell session (a function lasts only as long as the session; define them again
  in a new one):

  ```powershell
  function Get-HostOf($url) {
    if ($url) { try { ([uri]"$url".Trim()).Host } catch { } }
  }
  # The host the remote scripts will use: the shell's value, else the one in .env.
  function Get-TargetHost {
    $url = $env:TURSO_DATABASE_URL
    if (-not $url) {
      $line = Select-String -Path .env -Pattern '^\s*TURSO_DATABASE_URL\s*=' -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($line) { $url = ($line.Line -split '=', 2)[1].Trim().Trim('"', "'") }
    }
    Get-HostOf $url
  }
  # The production database's host, from Turso itself. Empty if the turso command fails.
  function Get-ProdHost { Get-HostOf (turso db show nexus-crm --url) }
  function Show-Target {
    Write-Host "this step reaches:      $(Get-TargetHost)"
    Write-Host "production (nexus-crm): $(Get-ProdHost)"
  }
  # $true only if the target host matches -Expect (a -like pattern; an exact host works too).
  # -NeedToken also requires TURSO_AUTH_TOKEN to be set. Prints hosts, never the token.
  function Assert-Target {
    param([string]$Expect, [switch]$NeedToken)
    $actual = Get-TargetHost
    Write-Host "this step reaches: $actual"
    Write-Host "expected:          $Expect"
    $ok = [bool]$actual -and [bool]$Expect -and ($actual -like $Expect)
    if ($ok -and $NeedToken -and -not $env:TURSO_AUTH_TOKEN) { $ok = $false; Write-Host "TURSO_AUTH_TOKEN is empty." }
    if (-not $ok) { Write-Host "STOP: this is not the expected database. Nothing was run; tell the owner." }
    return $ok
  }
  ```

  Production steps (0, 2, 4, 5, 8, 9) compare against `$prodHost = Get-ProdHost`, taken before the remote
  command. Step 3 compares against the rehearsal branch's name. An empty `$prodHost` (Turso not signed in)
  fails the check, so nothing runs.
- **Record.** After each step, write the UTC time and the evidence into HANDOVER §7s.

## Before step 0 (local only)

- The local `dev.db` is migrated and seeded on the phase-A schema, since the single-mode e2e project signs
  in to it as the demo account. With no Nexus server running:

  ```powershell
  New-Item -ItemType Directory -Force backups | Out-Null
  if (Test-Path dev.db) { Copy-Item dev.db ("backups/dev-db-before-e2e-reset-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".db") }
  [System.IO.File]::Delete((Join-Path $PWD "dev.db"))
  [System.IO.File]::Delete((Join-Path $PWD "dev.db-journal"))
  npx prisma migrate deploy
  $env:WORKSPACE_MODE = "single"; npm run db:seed; $env:WORKSPACE_MODE = $null
  ```

  Success: `All migrations have been successfully applied.`, then `Seeded demo workspace:` with
  `6 companies, 12 contacts, 14 deals`. A delete error, or `Seed data already present`, means `dev.db` was
  still open: stop the server and repeat.
- `feat/multi-tenancy-core` passes the full gate: `npm run typecheck`, `npm run lint`,
  `npm run test:coverage`, `npm run eval`, a fresh build, the second migrated database, and `npm run test:e2e`
  with both projects (`CI=1` turns the multi project on):

  ```powershell
  npm run typecheck
  npm run lint
  npm run test:coverage
  npm run eval
  if (Test-Path .next) { [System.IO.Directory]::Delete((Join-Path $PWD ".next"), $true) }
  npm run build
  $env:DATABASE_URL = "file:./e2e-multi.db"; npx prisma migrate deploy; $env:DATABASE_URL = $null
  $env:CI = "1"; $env:WORKSPACE_MODE = "single"; npx playwright test; $env:CI = $null; $env:WORKSPACE_MODE = $null
  ```
- Tools are signed in: `turso auth whoami`, `gh auth status`, `npx vercel whoami`.
- **The Docker image has not been built or booted.** Docker Desktop's daemon was down when the Dockerfile
  was changed for phase A, so its `WORKSPACE_MODE=single` line was checked by reading only. Phase A does not
  ship the image, but one boot with `SEED_DEMO_DATA=true` is recommended before relying on Docker for
  anything. Use a separate compose project name so that no existing data volume is touched: with no Nexus
  server on port 3000,

  ```powershell
  docker volume ls
  docker compose -p nexus-boot-check up -d --build
  ```

  `docker volume ls` first: a `nexus-data` volume from earlier self-hosting (named `<project>_nexus-data`,
  for example `nexus-crm_nexus-data`) is the owner's data, so never delete it, and if
  `nexus-boot-check_nexus-data` is already listed, pick another project name. The compose file sets
  `SEED_DEMO_DATA`. Success: the container applies the migrations and seeds the demo workspace,
  http://localhost:3000/api/health answers `{"status":"ok"}`, and **Try the demo** signs in. Then
  `docker compose -p nexus-boot-check down -v` deletes only that project's throwaway volume.

### Before step V — link the Vercel CLI to the demo project (a precondition, not a step)

The checkout has no `.vercel/` folder (it is git-ignored), and every `vercel env` command below needs the
link. It only reads from Vercel and writes that git-ignored folder.

```powershell
npx vercel --version
npx vercel link
Get-Content .vercel/project.json
```

Choose the Vercel project that serves nexus-crm-jer2x.vercel.app (dashboard → the project → Domains lists
it). Success: `projectName` in `.vercel/project.json` is that project's name. If it is any other project,
stop: no `vercel env` command may run until it is right.

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

```powershell
$prodHost = Get-ProdHost
if (Assert-Target -Expect $prodHost) {
  $env:ALLOW_REMOTE_DB = "true"
  npx tsx scripts/read-db-pragmas.ts
  $env:ALLOW_REMOTE_DB = $null
}
```

Success: `Reading pragmas from the remote database (read-only).`, five `foreign_keys read N:` lines, and
the compile options. Record all of it. The research expects every read to be `1` and the options to
include `DEFAULT_FOREIGN_KEYS=1`. If the script prints an error, or any read prints `undefined`, stop and
report it: that is not a `0` or a `1`. If any read is `0` or the reads disagree, stop and tell the owner:
phase A can still go ahead (M1 adds no foreign keys to existing tables), but phase B's design assumes `1`.

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

```powershell
$prodHost = Get-ProdHost
if (Assert-Target -Expect $prodHost) {
  npx tsx scripts/backup-turso.ts pre-m1
}
```

Success: `Backing up libsql://nexus-crm-…`, then the script names the JSON file it wrote under the
git-ignored `backups/` folder (`backups/turso-backup-pre-m1-<stamp>.json`) and prints a row count per table.
Record the file name and the counts; steps 3 and 4 pass this file to `verify-m1 --backup`, and the M2 gate
compares against it too. This file is a verification artifact: there is no script that restores from it
(see "Restoring the database").

### Step 3 (spec step 4, rehearsal) — apply M1 to a Turso branch and verify (GO)

If `turso db create` finds a rehearsal database from an earlier attempt, it fails and the gate below stops
the step: leave that database for the owner to look at, and let the owner decide when to destroy it.

```powershell
$backup = (Get-ChildItem backups -Filter 'turso-backup-pre-m1-*.json' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
"backup: $backup"
$created = $false
if ($backup) {
  turso db create nexus-crm-m1-rehearsal --from-db nexus-crm
  $created = ($LASTEXITCODE -eq 0)
}
$env:TURSO_DATABASE_URL = $null; $env:TURSO_AUTH_TOKEN = $null
if ($created) {
  $env:TURSO_DATABASE_URL = (turso db show nexus-crm-m1-rehearsal --url)
  $env:TURSO_AUTH_TOKEN = (turso db tokens create nexus-crm-m1-rehearsal)
}
$env:ALLOW_REMOTE_DB = "true"
"target: $env:TURSO_DATABASE_URL"
$pushed = $false
if (Assert-Target -Expect 'nexus-crm-m1-rehearsal-*' -NeedToken) {
  npm run db:push:turso
  $pushed = ($LASTEXITCODE -eq 0)
}
if ($pushed -and (Assert-Target -Expect 'nexus-crm-m1-rehearsal-*' -NeedToken)) {
  npx tsx scripts/verify-m1.ts --backup $backup
}
$env:TURSO_DATABASE_URL = $null; $env:TURSO_AUTH_TOKEN = $null; $env:ALLOW_REMOTE_DB = $null
```

Why the gate matters: if `turso db create` or `turso db show` fails, the variables stay unset, and
`npm run db:push:turso` would then load the production URL and token from `.env` and apply M1 to
production under a go that was given for the rehearsal. It has no `ALLOW_REMOTE_DB` check of its own.

Success: the backup line names the `turso-backup-pre-m1-…json` file step 2 wrote; the target line names
`nexus-crm-m1-rehearsal`, and so do the host lines `Assert-Target` prints; `Applied 1 migration(s) to
libsql://nexus-crm-m1-rehearsal-…`; every verify check passes and the last line is `ALL M1 CHECKS PASSED`
(three new tables; a workspace exists if and only if a user does; one membership per user with its role
copied; no null `workspaceId` outside `auth.*` audit rows; no drift; and the CRM row counts — Company,
Contact, Deal, Activity, Task — equal the backup's). If the push or the verify fails, stop: production is
untouched, and the failure goes to the owner with the output. A failure of the row-count check alone usually
means a visitor changed CRM rows on the live demo after step 2: give the owner both sets of counts; the fix
is a fresh step 2 and then this step again.

Only after that success, destroy the rehearsal database. If the rehearsal failed, do not run this: the
failed database stays for the owner to inspect.

```powershell
turso db destroy nexus-crm-m1-rehearsal --yes
```

### Step 4 (spec step 4, production) — apply M1 to production and verify (GO)

Outside the reset window. The old build keeps serving on the new schema: M1 only adds tables, nullable
columns and indexes.

**Precondition: the restore window.** If M1 goes wrong on production, the only way back is a point-in-time
restore of the Turso database (see "Restoring the database"). The JSON backup from step 2 cannot restore
anything. So before the push, confirm that the Turso plan's point-in-time-restore window for `nexus-crm`
covers at least the next hour: the Turso dashboard → `nexus-crm`, and `turso db show nexus-crm`; the window
depends on the plan. If point-in-time restore is not available, STOP: do not run step 4, and tell the owner.

Check (read-only). Read it, and run the next block only if the two hostnames are identical and the restore
window is confirmed:

```powershell
Show-Target
turso db show nexus-crm
```

Run, only after that check. It prints the restore point immediately before the push; record it in HANDOVER
§7s, because the restore needs it:

```powershell
$backup = (Get-ChildItem backups -Filter 'turso-backup-pre-m1-*.json' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
"backup: $backup"
"target from .env (must print nothing here): $env:TURSO_DATABASE_URL"
$prodHost = Get-ProdHost
$pushed = $false
if ($backup -and (Assert-Target -Expect $prodHost)) {
  "RESTORE POINT (UTC), record it: " + [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
  npm run db:push:turso
  $pushed = ($LASTEXITCODE -eq 0)
}
if ($pushed -and (Assert-Target -Expect $prodHost)) {
  $env:ALLOW_REMOTE_DB = "true"; npx tsx scripts/verify-m1.ts --backup $backup; $env:ALLOW_REMOTE_DB = $null
}
```

Success: the backup line names the file step 2 wrote; the two host lines `Assert-Target` prints are
identical; the `RESTORE POINT` line is recorded; `Applied 1 migration(s) to libsql://nexus-crm-…`, then
every verify check passes and the last line is `ALL M1 CHECKS PASSED`, the CRM row counts against that
backup included. Then open the demo, click **Try the demo**, and check the dashboard and the board render
(old build, new schema). If only the row-count check fails, M1 is already applied: do not re-run the push.
Give the owner both sets of counts; a visitor's CRM writes since step 2 are the usual cause, and the owner
decides whether they explain the difference.

If the push stops partway, `_turso_migrations` keeps a row for M1 with an empty `applied_at`, and the next
push refuses to continue. Do not delete that row and do not re-run. Stop and take the backup from step 2,
the push output and the verify output to the owner; the recovery is decided with them (it may be the
restore).

### Step 5 (spec step 5) — mark the demo workspace (GO)

```powershell
$prodHost = Get-ProdHost
if (Assert-Target -Expect $prodHost) {
  $env:ALLOW_REMOTE_DB = "true"; npx tsx scripts/mark-demo-workspace.ts; $env:ALLOW_REMOTE_DB = $null
}
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

The merge runs only if `gh pr checks` exits 0, which it does only when every check has passed (a failing or
pending check gives another exit code; if a check is only pending, wait and run the block again):

```powershell
gh auth switch --user jasrulete 2>&1 | Out-Null
gh pr checks feat/multi-tenancy-core -R jasrulete/Nexus-CRM
if ($LASTEXITCODE -eq 0) {
  gh pr merge feat/multi-tenancy-core --merge -R jasrulete/Nexus-CRM
} else {
  "STOP: not every check has passed. Not merging."
}
gh auth switch --user <work-account> 2>&1 | Out-Null
```

Only if it merged:

```powershell
git fetch origin
$sha = git rev-parse origin/main
$dep = gh api "repos/jasrulete/Nexus-CRM/deployments?sha=$sha&environment=Production" --jq '.[0].id'
gh api "repos/jasrulete/Nexus-CRM/deployments/$dep/statuses" --jq '.[0] | {state, environment_url}'
```

If `$dep` prints empty, Vercel has not created the deployment yet: wait a minute and run the `$dep` line
again. Repeat the last command until `state` is `success`. `failure` or `error` means the new deployment did
not build; the old build keeps serving (`npx vercel inspect <environment_url> --logs` shows why), so stop.
That reassurance holds **only for a build that fails**. A deployment that builds and then refuses to boot at
runtime (for example for want of `WORKSPACE_MODE`) is promoted like any other and is the one serving: if the
site errors, go straight to "Rolling back, after step 7" and promote the previous deployment first. Then
confirm nothing older is serving:

```powershell
npx vercel inspect nexus-crm-jer2x.vercel.app
```

Success: the deployment it names is the one in `environment_url`. Then a browser check: open
https://nexus-crm-jer2x.vercel.app/login → **Try the demo** → the dashboard shows the seeded data;
`/settings` shows the roster by name with no other member's email, and an audit card with no `auth.login`
rows; https://nexus-crm-jer2x.vercel.app/api/health answers `{"status":"ok"}`.

### Step 8 (spec step 8) — run the catch-up (GO)

Covers whatever the old build wrote between step 4 and step 7. Idempotent.

```powershell
$prodHost = Get-ProdHost
if (Assert-Target -Expect $prodHost) {
  $env:ALLOW_REMOTE_DB = "true"
  npx tsx scripts/backfill-workspace.ts
  if ($LASTEXITCODE -eq 0) {
    npx tsx scripts/verify-m1.ts
  }
  $env:ALLOW_REMOTE_DB = $null
}
```

Success: `Backfill complete.` with its counts (often all zero), then every verify check passes and the last
line is `ALL M1 CHECKS PASSED`. A second run of the backfill prints zeros. The verify runs **without**
`--backup` here, on purpose: the live demo has taken traffic since step 2, so its CRM rows no longer match
the pre-M1 backup. Session, User and AuditLog have grown from that traffic too; that growth is expected, and
`verify-m1` never compares those tables.

This step runs while the phase-A deploy is live. Its membership upsert can hit a unique-constraint error
(Prisma `P2002`) if the live app joins the same user at the same moment. If the backfill fails that way, run
the block again: the script is idempotent, so the second run skips whatever the first already wrote. Any
other error: stop.

### Step 9 (spec step 9) — one manual reset, then re-enable the nightly (GO)

The manual run is a real reset of the demo's CRM data, exactly what the nightly does. Outside the window.

```powershell
$prodHost = Get-ProdHost
if (Assert-Target -Expect $prodHost) {
  $env:ALLOW_REMOTE_DB = "true"; npm run demo:reset; $env:ALLOW_REMOTE_DB = $null
}
```

Success: `Resetting the remote demo workspace.`, `workspace: ws_default`, before/after counts, and
`Demo workspace reset.` A `RESET_REFUSED` line means step 5 did not take: stop, and leave the workflow off.
Run the next block only if the one above printed `Demo workspace reset.`:

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
  re-enable the reset (step 9's `gh workflow enable` commands): the old reset works on M1's schema. A later
  phase-A attempt restarts at step 1 (disable the nightly again; it stays off until step 9, spec §10),
  skips whatever of steps 2 to 5 is already done and recorded, then runs steps 6 to 9, step 8's catch-up
  included.
- **After step 7:** the first response to a live deployment that errors or refuses to boot is Vercel's
  instant rollback, before anything else: promote the previous Production deployment (dashboard → the
  project → Deployments → the last good Production deployment → ⋯ → Promote to Production / Instant
  Rollback), or `npx vercel rollback` (read `npx vercel rollback --help` first). The old build runs on M1's
  schema. Only then: disable the reset if step 9 enabled it (the old reset would reseed rows with no
  workspace, which the step-8 backfill then has to catch again before phase A is re-merged), and revert the
  merge through a PR (`gh pr create` from a `git revert -m 1 <merge sha>` branch, as `jasrulete`).
  Memberships and `isDemo` can stay; the old build ignores them. The database itself is a separate
  question: see the next section.

## Restoring the database

The JSON backup from step 2 has no restore script. It is a verification artifact: `verify-m1 --backup` and
the M2 gate compare row counts against it, nothing more. The restore path is Turso's point-in-time restore
into a **new** database, from the restore point step 4 printed before its push. It loses every write made
since that time, including accounts registered since: the owner decides whether that is acceptable, and each
part below needs its own GO.

Part 1 builds the restored copy and checks it. It does not change production. Set `$restoreFrom` to the
recorded time, in the format `turso db create --help` gives for `--timestamp`:

```powershell
$restoreFrom = "<the RESTORE POINT recorded before step 4's push>"
$backup = (Get-ChildItem backups -Filter 'turso-backup-pre-m1-*.json' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
"backup: $backup"
$created = $false
if ($backup -and $restoreFrom -notlike '<*') {
  turso db create nexus-crm-restored --from-db nexus-crm --timestamp $restoreFrom
  $created = ($LASTEXITCODE -eq 0)
}
if ($created) {
  $restoredUrl = (turso db show nexus-crm-restored --url)
  $env:TURSO_AUTH_TOKEN = (turso db tokens create nexus-crm-restored)
  if ($restoredUrl -and $env:TURSO_AUTH_TOKEN) {
    npx tsx scripts/backup-turso.ts restored-check --url $restoredUrl
  } else {
    "STOP: no URL or token for nexus-crm-restored."
  }
  $env:TURSO_AUTH_TOKEN = $null
} else {
  "STOP: the restored database was not created."
}
```

`verify-m1` is no use here: the restored copy is from before M1, so its first check ("new tables") fails
and it stops there, before it reaches the row counts. Compare the counts instead, side by side:

```powershell
$restored = (Get-ChildItem backups -Filter 'turso-backup-restored-check-*.json' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
$a = Get-Content $backup -Raw | ConvertFrom-Json
$b = Get-Content $restored -Raw | ConvertFrom-Json
foreach ($t in 'Company', 'Contact', 'Deal', 'Activity', 'Task') {
  "{0,-9} step 2: {1,5}   restored: {2,5}" -f $t, $a.data.$t.rows.Count, $b.data.$t.rows.Count
}
```

The two columns should be equal, or differ only by what visitors wrote between step 2 and the restore
point. Anything else: stop and tell the owner.

Part 2 points production at the restored copy (its own GO): in the Vercel project, set Production's
`TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the restored database's URL and a token for it
(`turso db tokens create nexus-crm-restored`), then redeploy the current Production deployment (env changes
reach only new deployments; `npx vercel env --help` and `npx vercel redeploy --help` give the CLI forms).
Update the GitHub Actions secrets of the same names too, before step 9 re-enables the nightly, and `.env`
for the local scripts. The restored database is a pre-M1 copy, so step 3 and step 4 are repeated against
it, and the `nexus-crm` name in `Get-ProdHost` and in the step commands must then name the restored
database. Leave the old database in place until the owner says to destroy it.

## Decisions for the owner (not steps)

- **`AI_DAILY_CEILING` for the demo.** Unset means no ceiling. The demo, the nightly eval and the future
  cloud share one Groq organisation quota; size the demo's ceiling from whichever daily limit binds first
  in the Groq console (requests per day, or tokens per day divided by tokens per action from `AiUsage`),
  then set it on Vercel Production like step V.
- **Phase B (M2)** is a separate PR, started only after step 9 and one clean nightly.
