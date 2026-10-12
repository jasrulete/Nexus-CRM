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
  The switch's own output is discarded, so a failed switch is silent: every block that switches then runs
  its `gh` (and `git push`) commands only if `gh api user --jq .login` prints `jasrulete`, and otherwise
  prints `STOP: …` and runs nothing.
- **Shell.** PowerShell 7 at the repo root. `.env` holds the production `TURSO_DATABASE_URL` and
  `TURSO_AUTH_TOKEN`. A variable set with `$env:` wins over `.env` (dotenv never overrides), so every step
  that sets one unsets it again. An unset variable is not an empty one: dotenv fills it from `.env`, which
  means production. That is why a failed `turso` command must never be allowed to fall through to the next
  line (next rule). This runbook unsets with `$env:NAME = $null` (the same as `Remove-Item Env:NAME`) and
  deletes a file with `[System.IO.File]::Delete((Join-Path $PWD '<file>'))` (the same as
  `Remove-Item <file>`), because some shells block `Remove-Item`. Use whichever form your shell allows.
- **Node 24 first.** This machine's default `node` is v22, which cannot load better-sqlite3, so
  `scripts/verify-m1.ts` would crash after `db:push:turso` has already applied M1 to production. The session
  block below puts Node 24 first on `PATH` (`$env:Path = "C:\Program Files\nodejs;" + $env:Path`) and checks
  that `node -v` starts with `v24`, or prints `STOP:`; `Assert-Target` checks it again before every remote
  command and refuses under any other version.
- **Gate every remote command on its target.** The scripts print only `local` or `remote` as their target
  (`scripts/mark-demo-workspace.ts`, `scripts/backfill-workspace.ts` and `npm run demo:reset` do), so a run
  against a Turso branch reads exactly like a run against production, and a printed hostname does not stop
  the command that follows it. So each command that reaches Turso (steps 0, 2, 3, 4, 5, 8 and 9) runs
  inside an `if` that checks the exact expected hostname, by hostname only and never the token, and
  otherwise prints `STOP: …` and runs nothing; step 7's merge runs only if
  `gh pr checks --required` exits 0. Start every PowerShell session with this block, before any other block
  of this runbook (the PATH change and the functions last only as long as the session; run it again in a
  new one):

  ```powershell
  $env:Path = "C:\Program Files\nodejs;" + $env:Path
  if (-not ((node -v) -like 'v24*')) { "STOP: node -v is $(node -v), not v24. Fix PATH before anything else." }
  function Get-HostOf($url) {
    if ($url) { try { ([uri]"$url".Trim()).Host } catch { } }
  }
  # The host the remote scripts will use: the shell's value, else the one in .env. dotenv keeps
  # the last of repeated lines, so this reads the last one too.
  function Get-TargetHost {
    $url = $env:TURSO_DATABASE_URL
    if (-not $url) {
      $line = Select-String -Path .env -Pattern '^\s*TURSO_DATABASE_URL\s*=' -ErrorAction SilentlyContinue | Select-Object -Last 1
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
  # Also refuses unless node is v24 (see "Node 24 first").
  function Assert-Target {
    param([string]$Expect, [switch]$NeedToken)
    $actual = Get-TargetHost
    Write-Host "this step reaches: $actual"
    Write-Host "expected:          $Expect"
    $ok = [bool]$actual -and [bool]$Expect -and ($actual -like $Expect)
    if ($ok -and $NeedToken -and -not $env:TURSO_AUTH_TOKEN) { $ok = $false; Write-Host "TURSO_AUTH_TOKEN is empty." }
    if ($ok -and -not ((node -v) -like 'v24*')) { $ok = $false; Write-Host "node -v is not v24." }
    if (-not $ok) { Write-Host "STOP: this is not the expected database. Nothing was run; tell the owner." }
    return $ok
  }
  # $true only if this checkout is the PR's head commit and prisma/migrations holds exactly the
  # four directories phase A ships, unmodified. db-push-turso applies every local directory the
  # remote ledger lacks, so a stray directory here would reach the database.
  function Assert-Checkout {
    $expected = '20260715164036_init', '20260725150849_add_deal_task_fk_indexes',
      '20260823151943_add_deal_base_value_and_fx_rate', '20261011180555_workspaces_expand'
    $dirs = @((Get-ChildItem prisma/migrations -Directory).Name | Sort-Object)
    $head = git rev-parse HEAD
    $prHead = ((git ls-remote origin refs/heads/feat/multi-tenancy-core) -split '\s+')[0]
    $dirty = git status --porcelain -- prisma/migrations
    Write-Host "HEAD:       $head"
    Write-Host "PR head:    $prHead"
    Write-Host "migrations: $($dirs -join ', ')"
    $ok = (($dirs -join ',') -ceq ($expected -join ',')) -and [bool]$head -and ($head -eq $prHead) -and -not $dirty
    if (-not $ok) { Write-Host "STOP: the checkout is not the PR head with exactly the four phase-A migrations. Nothing was pushed; tell the owner." }
    return $ok
  }
  ```

  Production steps (0, 2, 4, 5, 8, 9) compare against `$prodHost = Get-ProdHost`, taken before the remote
  command. Step 3 compares against the rehearsal branch's name. An empty `$prodHost` (Turso not signed in)
  fails the check, so nothing runs. Steps 3 and 4 also run `Assert-Checkout` before the push: the PR head
  (read from the pushed branch) is the commit that was reviewed.
- **Record.** After each step, write the UTC time and the evidence into HANDOVER §7s.

## Before step 0 (local only)

- The local `dev.db` is migrated and seeded on the phase-A schema, since the single-mode e2e project signs
  in to it as the demo account. In a session started with the session block above, and with no Nexus
  server running:

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
link. Answered as below, it only reads from Vercel and writes that git-ignored folder.

```powershell
npx vercel --version
npx vercel link
Get-Content .vercel/project.json
```

Answer its prompts like this (the wording is Vercel CLI 59.20's; read `npx vercel link --help` first if
yours differs):

- Create a new project, or link an existing one: **link the existing project**. Never create one: steps V
  and 6 would then configure a project that serves nothing.
- Which project: the one that serves nexus-crm-jer2x.vercel.app (dashboard → the project → Domains lists
  it).
- Pull the environment variables into `.env.local`: **No**. That writes the project's variables into the
  checkout, next to the production credentials already in `.env`.

Success: `projectName` in `.vercel/project.json` is that project's name, and its `projectId` equals the
Project ID on the dashboard (the project → Settings → General). If either differs, stop: no `vercel env`
command may run until it is right.

### Step V — set `WORKSPACE_MODE=single` on the demo's Vercel project, Preview and Production (GO; before step P)

The merge in step 7 deploys the phase-A build to Production, and that build refuses to boot under
`NODE_ENV=production` without the variable, so Production needs it before the merge. Preview gets it too,
but not because the step-P preview would fail to boot without it: that preview never boots. It fails at
build, by design, because `src/lib/db-adapter.ts` refuses every non-production Vercel build (README,
"Deploying to Vercel"). Preview gets the variable so that once it has a database of its own
(SAAS-READINESS §4a) its builds boot the way Production's do. The live (old) build ignores the variable, so
setting it now is harmless and needs no redeploy.

Read `npx vercel env add --help` first. Vercel CLI 59.20 takes the value as `--value`, which avoids piping
it (a value piped from PowerShell can carry a trailing newline). If your version has no `--value`, use the
dashboard instead.

```powershell
npx vercel env add --help
npx vercel env add WORKSPACE_MODE production --value single
npx vercel env add WORKSPACE_MODE preview --value single
npx vercel env ls
```

(Or: Vercel → the demo project → Settings → Environment Variables → add `WORKSPACE_MODE` = `single` with
**Production** and **Preview** ticked.) If the CLI asks which Git branch the Preview value is for, leave it
empty: all Preview branches. Success: `npx vercel env ls` lists `WORKSPACE_MODE` for Production and for
Preview.

### Step P — push the branch and open the PR (GO: the repo is public)

```powershell
gh auth switch --user jasrulete 2>&1 | Out-Null
if ((gh api user --jq .login) -eq 'jasrulete') {
  git push -u origin feat/multi-tenancy-core
  gh pr create -R jasrulete/Nexus-CRM --base main --head feat/multi-tenancy-core --title "feat: multi-tenancy core, phase A (M1 and workspace-scoped code)" --body "Phase A of docs/superpowers/specs/2026-10-11-multi-tenancy-core-design.md: migration M1, the fail-closed workspace-scoped client, WORKSPACE_MODE=single|multi, plan limits and AI metering, the cross-tenant suite. Do not merge before runbook step 7 (docs/runbooks/2026-10-tenancy-phase-a.md).

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
  gh pr checks feat/multi-tenancy-core -R jasrulete/Nexus-CRM --watch
} else {
  "STOP: gh is not signed in as jasrulete. Nothing was pushed."
}
gh auth switch --user <work-account> 2>&1 | Out-Null
```

Success: `ci` and `Analyze JavaScript/TypeScript` pass. The `Vercel` preview check fails, by design:
`src/lib/db-adapter.ts` refuses every non-production Vercel build, so the preview fails while it builds
(README, "Deploying to Vercel"). So `--watch`, like a plain `gh pr checks`, ends with a non-zero exit even
when both of those pass; that alone is not a reason to stop. Do not merge.

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
if ((gh api user --jq .login) -eq 'jasrulete') {
  gh workflow disable reset-demo.yml -R jasrulete/Nexus-CRM
  gh workflow list --all -R jasrulete/Nexus-CRM
} else {
  "STOP: gh is not signed in as jasrulete. Nothing was run."
}
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
$checkout = Assert-Checkout
$created = $false
if ($backup -and $checkout) {
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
if ($checkout -and (Assert-Target -Expect 'nexus-crm-m1-rehearsal-*' -NeedToken)) {
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

Success: the backup line names the `turso-backup-pre-m1-…json` file step 2 wrote; `Assert-Checkout`
prints the same SHA for `HEAD` and the PR head, and exactly the four migration directories; the target
line names `nexus-crm-m1-rehearsal`, and so do the host lines `Assert-Target` prints; `Applied 1 migration(s) to
libsql://nexus-crm-m1-rehearsal-…`; every verify check passes and the last line is `ALL M1 CHECKS PASSED`
(three new tables; a workspace exists if and only if a user does; one membership per user with its role
copied; no null `workspaceId` outside `auth.*` audit rows; no drift; and the CRM row counts — Company,
Contact, Deal, Activity, Task — equal the backup's). If the push or the verify fails, stop: production is
untouched, and the failure goes to the owner with the output. A failure of the row-count check alone usually
means a visitor changed CRM rows on the live demo after step 2: give the owner both sets of counts. The
fix, after the owner destroys the failed rehearsal database (until then `turso db create` refuses the
name and the gate stops this step), is a fresh step 2 and then this step again.

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

Run, only after that check. It prints a restore point just before the push; record it in HANDOVER §7s,
because the restore needs it. The time comes from this machine's clock, which is not authoritative, so the
block subtracts a five-minute safety margin: a clock up to five minutes fast still gives a point before
the push. A restore to it also loses what was written in those five minutes, and the restore section
checks that the copy it builds really is from before M1.

```powershell
$backup = (Get-ChildItem backups -Filter 'turso-backup-pre-m1-*.json' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
"backup: $backup"
"target from .env (must print nothing here): $env:TURSO_DATABASE_URL"
$prodHost = Get-ProdHost
$pushed = $false
if ($backup -and (Assert-Checkout) -and (Assert-Target -Expect $prodHost)) {
  "RESTORE POINT (UTC, this machine's clock minus 5 minutes), record it: " + [DateTime]::UtcNow.AddMinutes(-5).ToString("yyyy-MM-ddTHH:mm:ssZ")
  npm run db:push:turso
  $pushed = ($LASTEXITCODE -eq 0)
}
if ($pushed -and (Assert-Target -Expect $prodHost)) {
  $env:ALLOW_REMOTE_DB = "true"; npx tsx scripts/verify-m1.ts --backup $backup; $env:ALLOW_REMOTE_DB = $null
}
```

Success: the backup line names the file step 2 wrote; `Assert-Checkout` prints the same SHA for `HEAD`
and the PR head, and exactly the four migration directories; the two host lines `Assert-Target` prints are
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

The merge runs only if `gh pr checks --required` exits 0, which it does only when every required check
has passed. Branch protection on `main` requires two: `ci` and `Analyze JavaScript/TypeScript`. The
`Vercel` preview check is not required, and it is red by design: `src/lib/db-adapter.ts` refuses every
non-production Vercel build, so the preview fails while it builds (README, "Deploying to Vercel"). That is
why a plain `gh pr checks`, or `--watch`, exits non-zero even when both required checks pass, and why the
gate reads the required checks only. A failing or pending required check gives another exit code; if one
is only pending, wait and run the block again.

```powershell
gh auth switch --user jasrulete 2>&1 | Out-Null
if ((gh api user --jq .login) -eq 'jasrulete') {
  gh pr checks feat/multi-tenancy-core -R jasrulete/Nexus-CRM --required
  if ($LASTEXITCODE -eq 0) {
    gh pr merge feat/multi-tenancy-core --merge -R jasrulete/Nexus-CRM
  } else {
    "STOP: a required check has not passed. Not merging."
  }
} else {
  "STOP: gh is not signed in as jasrulete. Not merging."
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

This step runs while the phase-A deploy is live. If step 8 fails with a unique-constraint error
(`UNIQUE constraint failed`, `P2002`, or `P2039` on Turso), re-run it; it is idempotent. Any other error:
stop.

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
if ((gh api user --jq .login) -eq 'jasrulete') {
  gh workflow enable reset-demo.yml -R jasrulete/Nexus-CRM
  gh workflow list --all -R jasrulete/Nexus-CRM
} else {
  "STOP: gh is not signed in as jasrulete. Nothing was run."
}
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
  included. If the old nightly ran while phase A was paused, it reseeded the demo's CRM rows with no
  workspace, so after the restart's merge **Try the demo** shows an empty dashboard until step 8 stamps
  them. Step 7's dashboard check may then show an empty demo: that is expected, not a reason to stop. Run
  step 8 straight after the deploy is confirmed, then repeat step 7's browser check.
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
recorded time (it already includes step 4's five-minute margin), in the format `turso db create --help`
gives for `--timestamp`:

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
and it stops there, before it reaches the row counts. Instead, confirm the copy really is from before M1
(a post-M1 copy would pass the count comparison), then compare the counts side by side. The block selects
both files itself, so it also works in a new session:

```powershell
$backup = (Get-ChildItem backups -Filter 'turso-backup-pre-m1-*.json' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
$restored = (Get-ChildItem backups -Filter 'turso-backup-restored-check-*.json' | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
"backup:   $backup"
"restored: $restored"
$a = Get-Content $backup -Raw | ConvertFrom-Json
$b = Get-Content $restored -Raw | ConvertFrom-Json
$tables = $b.data.PSObject.Properties.Name
$m1Rows = @($b.data._turso_migrations.rows | Where-Object { $_.name -eq '20261011180555_workspaces_expand' })
if (($tables -contains 'Workspace') -or ($tables -contains 'Membership') -or ($tables -contains 'AiUsage') -or ($m1Rows.Count -gt 0)) {
  "STOP: the restored copy already has M1 (its tables or its ledger row). It is not from before the push."
} else {
  "pre-M1: no Workspace, Membership or AiUsage table, and no M1 row in _turso_migrations."
}
foreach ($t in 'Company', 'Contact', 'Deal', 'Activity', 'Task') {
  "{0,-9} step 2: {1,5}   restored: {2,5}" -f $t, $a.data.$t.rows.Count, $b.data.$t.rows.Count
}
```

Success: the `pre-M1:` line, then two columns that are equal, or differ only by what visitors wrote between
step 2 and the restore point. A `STOP:` line, or anything else: stop and tell the owner.

Part 2 points production at the restored copy (its own GO).

**Precondition: a pre-phase-A build is serving.** The restored copy is from before M1, and the phase-A
build's boot check refuses a database that lacks M1's tables, so every request would fail. If step 7 ran,
roll it back first ("Rolling back", after step 7: promote the last pre-phase-A Production deployment), and
confirm with `npx vercel inspect nexus-crm-jer2x.vercel.app` that it is the one serving.

Then, in the Vercel project, set Production's `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` to the restored
database's URL and a token for it (`turso db tokens create nexus-crm-restored`), and redeploy that
pre-phase-A deployment (env changes reach only new deployments; `npx vercel env --help` and
`npx vercel redeploy --help` give the CLI forms). After an instant rollback Vercel stops assigning the
production domain to new deployments on its own, so run `npx vercel inspect nexus-crm-jer2x.vercel.app`
again: it must name the redeployment. If it names an older one, promote the redeployment explicitly
(dashboard → Deployments → the redeployment → ⋯ → Promote to Production) and inspect again.

Then confirm production reads the restored database: run `turso db inspect nexus-crm-restored` (read
`turso db inspect --help` first; the Turso dashboard's usage view for the database shows the same), sign in
with **Try the demo** and open a few pages, and run it again. Its rows-read count must have grown. If it
has not, production still reads the old database: stop and tell the owner, and do not destroy anything.

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
