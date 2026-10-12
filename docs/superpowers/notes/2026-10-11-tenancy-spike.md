# Tenancy spike: dual composite keys and the M2 file shape

Plan Task 1 for `docs/superpowers/specs/2026-10-11-multi-tenancy-core-design.md` (§4.3, §10). Generated 2026-10-11T17:45:23.758Z by the throwaway runner `.scratch/tenancy-spike/run.ts` (gitignored) from the results it recorded.

## Questions

1. Can the §4.3 backstop be expressed in Prisma's schema and generated SQL: parent `UNIQUE(workspaceId, id)`, plus a composite `(workspaceId, parentId) → (workspaceId, id)` key with NO ACTION beside each existing single-column key?
2. Does the §10 phase-B M2 file shape run unchanged on all four migration paths, which means none of them already wraps a migration file in a transaction?
3. Does a forced failure in the middle of that file leave the original tables intact on every path?

## Decision

- **§4.3 backstop: keep it in M2.** Prisma expresses the dual key as two named relations on the same `parentId`: the existing one (`SetNull` or `Cascade`), plus `fields: [workspaceId, parentId], references: [workspaceId, id], onDelete: NoAction, onUpdate: NoAction`, with `@@unique([workspaceId, id])` on the parent. Prisma generates both constraints. At runtime, on all four paths, SQLite refused a cross-workspace Contact→Company link (insert and update) and a cross-workspace Deal→Company link (update), accepted a same-workspace link, and left the existing behaviour alone: deleting a company still SET NULLs its contacts' `companyId`, and deleting a deal still cascades to its activities and tasks. The other six links (Deal→Contact, Activity→Contact, Activity→Deal, Activity→Company, Task→Contact, Task→Deal) carry the same composite key in the generated DDL (the 8-key count in the Generated SQL table) and are enforced by the same SQLite mechanism, but were not probed at runtime.
- **M2 file shape: confirmed** on Prisma Migrate, the Docker runner, the harness and the local-driver Turso runner (@libsql/client's `file:` driver). The Hrana/HTTP path that production uses is unproven until Phase B's Turso-branch rehearsal (see Not covered here). In these runs none of the four paths wraps a migration file in a transaction, and a failure mid-file (or in the foreign-key guard) leaves the M1 tables, rows and DDL exactly as they were.
- **M1**, generated the way plan Task 3 generates it and with its data statements, applies on all four paths with no table rebuild and backfills as specified.
- **Recovery after a failed M2:** see "What phase B carries forward" below, per path. In short: Prisma Migrate needs `migrate resolve --rolled-back` before it will deploy again; the Turso runner and the Docker runner each need their one stuck claim row deleted; a harness connection must be rolled back or closed. The runner records only the stuck ledger rows and the open-transaction flag (the ledger table). The refusals and the recovery steps were verified by hand on scratch copies of the `fail-mid` databases and are not recorded by the runner.

## Environment

- Node v24.0.0, prisma 7.9.1, @prisma/client 7.10.0, @libsql/client 0.18.0, better-sqlite3 12.11.1 (SQLite 3.53.2).
- Every database was a throwaway file under `.scratch/tenancy-spike/runs/`. No remote database was contacted: the runner strips Turso credentials and remote flags from every child process.

## Method

- **Schemas.** `m1.prisma` is plan Task 3's schema (M1). `m2.prisma` is a spike-only M2 target: `workspaceId` required with a `Workspace` relation (Restrict), owner relations Restrict, `AuditLog.workspace` optional, and the dual relations. Its relation actions are the spike's choices, not phase B's decisions.
- **M1 SQL.** `prisma migrate diff --from-migrations <the three committed migrations> --to-schema m1.prisma --script`, plus the data statements plan Task 3 appends.
- **M2 SQL.** `prisma migrate diff --from-schema m1.prisma --to-schema m2.prisma --script`. Prisma's own `PRAGMA foreign_keys` and `defer_foreign_keys` lines are removed and the rest is wrapped in the spec shape: `PRAGMA defer_foreign_keys=ON; PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;`, the idempotent catch-up, the rebuilds with `COALESCE("workspaceId", 'ws_default')` in each CRM `INSERT … SELECT`, a foreign-key guard, then `COMMIT; PRAGMA foreign_keys=ON; PRAGMA defer_foreign_keys=OFF;`.
- **The guard** is plain SQL that aborts the file while foreign keys are off: `CREATE TABLE "_m2_fk_guard" ("ok" INTEGER NOT NULL CHECK ("ok" = 1))`, an `INSERT … SELECT CASE WHEN EXISTS (SELECT 1 FROM pragma_foreign_key_check) THEN 0 ELSE 1 END`, then `DROP TABLE`.
- **Paths.** Each scenario folder is laid out like the repo and fed one migration directory at a time (the base three, then M1, then M2). Prisma Migrate: `prisma migrate deploy --config <scenario>/prisma.config.ts`. Turso runner: `scripts/db-push-turso.ts`, unchanged, with the scenario folder as its working directory and `TURSO_DATABASE_URL=file:spike.db` (@libsql/client's local driver). Docker runner: a verbatim copy of `scripts/docker-entrypoint.mjs` (better-sqlite3); its last step, starting the app, always fails here (there is no `server.js`, and on Windows the absolute-path `import()` is rejected first), so success is judged from its ledger. Harness: the `createTestDatabase` loop (better-sqlite3, `foreign_keys = ON`, one `exec` per file).
- **Fixtures** (raw SQL). Before M1: an ADMIN and a MEMBER, two companies, three contacts, two deals, activities, tasks, an `auth.login` and a `contact.create` audit row. Between M1 and M2 (the old-build window): a user with no membership, a contact and a non-auth audit row with a NULL `workspaceId`, and an `auth.register` row.
- **Scenarios.** `ok`: the M2 above. `fail-mid`: the same file with `INSERT INTO "__spike_forced_failure" DEFAULT VALUES;` right after the Contact rebuild's `RENAME`, so tables have already been dropped and renamed when it fails. `fail-guard`: the `ok` file, but the window fixtures also link a default-workspace contact to a company in a second workspace, so the guard must abort after every rebuild.
- **Dual-key probes** (after `ok`, with `foreign_keys = ON`): insert and update cross-workspace links (must fail), a same-workspace link (must work), delete a company (contacts SET NULL, `workspaceId` kept), delete a deal (activities and tasks cascade), delete a user who owns rows (Restrict).

## Results

### Generated SQL

| Topic | Check | Result | Detail |
|---|---|---|---|
| m1 | M1's generated SQL has no table rebuild (no new_*, DROP TABLE or PRAGMA) | PASS |  |
| dual | m2.prisma with the dual relations passes prisma validate | PASS | Prisma schema loaded from .scratch\tenancy-spike\m2.prisma. |
| dual | Contact keeps its single-column SET NULL key beside the composite NO ACTION key | PASS |  |
| dual | all 8 child links get a composite key (Contact 1, Deal 2, Activity 3, Task 2) | PASS | 8 found |
| dual | parents get UNIQUE(workspaceId, id) | PASS | Company, Contact, Deal |
| shape | User and Session are not rebuilt | PASS |  |
| shape | COALESCE(workspaceId, 'ws_default') injected into all five CRM rebuilds | PASS | 5/5 |
| shape | forced failure injected right after the Contact rebuild | PASS |  |

### Per path and scenario

| Path | Scenario | Topic | Check | Result | Detail |
|---|---|---|---|---|---|
| prisma-migrate | ok | m1 | the three committed migrations apply | PASS | Prisma schema loaded from ..\..\m1.prisma. |
| prisma-migrate | ok | m1 | M1 applies | PASS | Prisma schema loaded from ..\..\m1.prisma. |
| prisma-migrate | ok | m1 | M1 backfill: one membership per user with the role copied, CRM and non-auth audit rows in ws_default, auth rows null | PASS | ws_default \| u_admin:ADMIN@ws_default,u_member:MEMBER@ws_default \| null CRM rows 0 \| al_1:null,al_2:ws_default |
| prisma-migrate | ok | shape | M2 applies, so the runner does not wrap the file in a transaction | PASS | Prisma schema loaded from ..\..\m1.prisma. |
| prisma-migrate | ok | shape | no new_* or guard tables left | PASS |  |
| prisma-migrate | ok | shape | workspaceId NOT NULL on the five CRM tables, still nullable on AuditLog | PASS | {"Company":1,"Contact":1,"Deal":1,"Activity":1,"Task":1,"AuditLog":0} |
| prisma-migrate | ok | shape | foreign_key_check is empty | PASS | 0 violation(s) |
| prisma-migrate | ok | shape | row counts unchanged apart from the caught-up membership | PASS | {"User":3,"Session":0,"Workspace":1,"Membership":3,"AiUsage":0,"Company":2,"Contact":4,"Deal":2,"Activity":2,"Task":2,"AuditLog":4} |
| prisma-migrate | ok | shape | foreign keys were really off during the rebuild: no contact lost its company, no activity was cascaded away | PASS |  |
| prisma-migrate | ok | shape | catch-up applied: the late user joined as MEMBER, late rows stamped, auth rows still null | PASS | u_admin:ADMIN@ws_default,u_late:MEMBER@ws_default,u_member:MEMBER@ws_default \| al_1:null,al_2:ws_default,al_late:ws_default,al_late_auth:null |
| prisma-migrate | ok | dual | inserting a contact linked to another workspace's company is refused | PASS | FOREIGN KEY constraint failed |
| prisma-migrate | ok | dual | re-pointing a contact at another workspace's company is refused | PASS | FOREIGN KEY constraint failed |
| prisma-migrate | ok | dual | re-pointing a deal at another workspace's company is refused | PASS | FOREIGN KEY constraint failed |
| prisma-migrate | ok | dual | a same-workspace link still works | PASS | ALLOWED |
| prisma-migrate | ok | dual | deleting a company still SET NULLs its contacts' companyId and keeps their workspaceId | PASS | ALLOWED; ct_2 {"companyId":null,"workspaceId":"ws_default"} |
| prisma-migrate | ok | dual | deleting a deal still cascades to its activities and tasks | PASS | ALLOWED; 0 child row(s) left |
| prisma-migrate | ok | shape | deleting a user who owns records is refused (owner keys Restrict) | PASS | FOREIGN KEY constraint failed |
| prisma-migrate | ok | dual | foreign_key_check is still empty after the probes | PASS | 0 |
| prisma-migrate | fail-mid | m1 | the three committed migrations apply | PASS | Prisma schema loaded from ..\..\m1.prisma. |
| prisma-migrate | fail-mid | m1 | M1 applies | PASS | Prisma schema loaded from ..\..\m1.prisma. |
| prisma-migrate | fail-mid | m1 | M1 backfill: one membership per user with the role copied, CRM and non-auth audit rows in ws_default, auth rows null | PASS | ws_default \| u_admin:ADMIN@ws_default,u_member:MEMBER@ws_default \| null CRM rows 0 \| al_1:null,al_2:ws_default |
| prisma-migrate | fail-mid | shape | M2 stops with the forced error (__spike_forced_failure) | PASS | Database error: |
| prisma-migrate | fail-mid | shape | no new_* or guard tables left | PASS |  |
| prisma-migrate | fail-mid | shape | the Contact table is still M1's (same DDL) | PASS |  |
| prisma-migrate | fail-mid | shape | workspaceId still nullable everywhere | PASS | {"Company":0,"Contact":0,"Deal":0,"Activity":0,"Task":0,"AuditLog":0} |
| prisma-migrate | fail-mid | shape | row counts unchanged | PASS | {"User":3,"Session":0,"Workspace":1,"Membership":2,"AiUsage":0,"Company":2,"Contact":4,"Deal":2,"Activity":2,"Task":2,"AuditLog":4} |
| prisma-migrate | fail-mid | shape | the catch-up was rolled back with everything else | PASS |  |
| prisma-migrate | fail-mid | shape | the ledger does not record M2 as applied | PASS | finished_at=NULL rolled_back_at=NULL logs=NULL |
| prisma-migrate | fail-guard | m1 | the three committed migrations apply | PASS | Prisma schema loaded from ..\..\m1.prisma. |
| prisma-migrate | fail-guard | m1 | M1 applies | PASS | Prisma schema loaded from ..\..\m1.prisma. |
| prisma-migrate | fail-guard | m1 | M1 backfill: one membership per user with the role copied, CRM and non-auth audit rows in ws_default, auth rows null | PASS | ws_default \| u_admin:ADMIN@ws_default,u_member:MEMBER@ws_default \| null CRM rows 0 \| al_1:null,al_2:ws_default |
| prisma-migrate | fail-guard | shape | M2 stops with the forced error (CHECK constraint failed) | PASS | CHECK constraint failed: ok |
| prisma-migrate | fail-guard | shape | no new_* or guard tables left | PASS |  |
| prisma-migrate | fail-guard | shape | the Contact table is still M1's (same DDL) | PASS |  |
| prisma-migrate | fail-guard | shape | workspaceId still nullable everywhere | PASS | {"Company":0,"Contact":0,"Deal":0,"Activity":0,"Task":0,"AuditLog":0} |
| prisma-migrate | fail-guard | shape | row counts unchanged | PASS | {"User":3,"Session":0,"Workspace":2,"Membership":2,"AiUsage":0,"Company":3,"Contact":4,"Deal":2,"Activity":2,"Task":2,"AuditLog":4} |
| prisma-migrate | fail-guard | shape | the catch-up was rolled back with everything else | PASS |  |
| prisma-migrate | fail-guard | shape | the ledger does not record M2 as applied | PASS | finished_at=NULL rolled_back_at=NULL logs=NULL |
| turso-runner | ok | m1 | the three committed migrations apply | PASS | Applied 3 migration(s) to file:spike.db |
| turso-runner | ok | m1 | M1 applies | PASS | Applied 1 migration(s) to file:spike.db |
| turso-runner | ok | m1 | M1 backfill: one membership per user with the role copied, CRM and non-auth audit rows in ws_default, auth rows null | PASS | ws_default \| u_admin:ADMIN@ws_default,u_member:MEMBER@ws_default \| null CRM rows 0 \| al_1:null,al_2:ws_default |
| turso-runner | ok | shape | M2 applies, so the runner does not wrap the file in a transaction | PASS | Applied 1 migration(s) to file:spike.db |
| turso-runner | ok | shape | no new_* or guard tables left | PASS |  |
| turso-runner | ok | shape | workspaceId NOT NULL on the five CRM tables, still nullable on AuditLog | PASS | {"Company":1,"Contact":1,"Deal":1,"Activity":1,"Task":1,"AuditLog":0} |
| turso-runner | ok | shape | foreign_key_check is empty | PASS | 0 violation(s) |
| turso-runner | ok | shape | row counts unchanged apart from the caught-up membership | PASS | {"User":3,"Session":0,"Workspace":1,"Membership":3,"AiUsage":0,"Company":2,"Contact":4,"Deal":2,"Activity":2,"Task":2,"AuditLog":4} |
| turso-runner | ok | shape | foreign keys were really off during the rebuild: no contact lost its company, no activity was cascaded away | PASS |  |
| turso-runner | ok | shape | catch-up applied: the late user joined as MEMBER, late rows stamped, auth rows still null | PASS | u_admin:ADMIN@ws_default,u_late:MEMBER@ws_default,u_member:MEMBER@ws_default \| al_1:null,al_2:ws_default,al_late:ws_default,al_late_auth:null |
| turso-runner | ok | dual | inserting a contact linked to another workspace's company is refused | PASS | FOREIGN KEY constraint failed |
| turso-runner | ok | dual | re-pointing a contact at another workspace's company is refused | PASS | FOREIGN KEY constraint failed |
| turso-runner | ok | dual | re-pointing a deal at another workspace's company is refused | PASS | FOREIGN KEY constraint failed |
| turso-runner | ok | dual | a same-workspace link still works | PASS | ALLOWED |
| turso-runner | ok | dual | deleting a company still SET NULLs its contacts' companyId and keeps their workspaceId | PASS | ALLOWED; ct_2 {"companyId":null,"workspaceId":"ws_default"} |
| turso-runner | ok | dual | deleting a deal still cascades to its activities and tasks | PASS | ALLOWED; 0 child row(s) left |
| turso-runner | ok | shape | deleting a user who owns records is refused (owner keys Restrict) | PASS | FOREIGN KEY constraint failed |
| turso-runner | ok | dual | foreign_key_check is still empty after the probes | PASS | 0 |
| turso-runner | fail-mid | m1 | the three committed migrations apply | PASS | Applied 3 migration(s) to file:spike.db |
| turso-runner | fail-mid | m1 | M1 applies | PASS | Applied 1 migration(s) to file:spike.db |
| turso-runner | fail-mid | m1 | M1 backfill: one membership per user with the role copied, CRM and non-auth audit rows in ws_default, auth rows null | PASS | ws_default \| u_admin:ADMIN@ws_default,u_member:MEMBER@ws_default \| null CRM rows 0 \| al_1:null,al_2:ws_default |
| turso-runner | fail-mid | shape | M2 stops with the forced error (__spike_forced_failure) | PASS | SQLITE_ERROR: no such table: __spike_forced_failure |
| turso-runner | fail-mid | shape | no new_* or guard tables left | PASS |  |
| turso-runner | fail-mid | shape | the Contact table is still M1's (same DDL) | PASS |  |
| turso-runner | fail-mid | shape | workspaceId still nullable everywhere | PASS | {"Company":0,"Contact":0,"Deal":0,"Activity":0,"Task":0,"AuditLog":0} |
| turso-runner | fail-mid | shape | row counts unchanged | PASS | {"User":3,"Session":0,"Workspace":1,"Membership":2,"AiUsage":0,"Company":2,"Contact":4,"Deal":2,"Activity":2,"Task":2,"AuditLog":4} |
| turso-runner | fail-mid | shape | the catch-up was rolled back with everything else | PASS |  |
| turso-runner | fail-mid | shape | the ledger does not record M2 as applied | PASS | _turso_migrations.applied_at='' |
| turso-runner | fail-guard | m1 | the three committed migrations apply | PASS | Applied 3 migration(s) to file:spike.db |
| turso-runner | fail-guard | m1 | M1 applies | PASS | Applied 1 migration(s) to file:spike.db |
| turso-runner | fail-guard | m1 | M1 backfill: one membership per user with the role copied, CRM and non-auth audit rows in ws_default, auth rows null | PASS | ws_default \| u_admin:ADMIN@ws_default,u_member:MEMBER@ws_default \| null CRM rows 0 \| al_1:null,al_2:ws_default |
| turso-runner | fail-guard | shape | M2 stops with the forced error (CHECK constraint failed) | PASS | SQLITE_CONSTRAINT: CHECK constraint failed: ok |
| turso-runner | fail-guard | shape | no new_* or guard tables left | PASS |  |
| turso-runner | fail-guard | shape | the Contact table is still M1's (same DDL) | PASS |  |
| turso-runner | fail-guard | shape | workspaceId still nullable everywhere | PASS | {"Company":0,"Contact":0,"Deal":0,"Activity":0,"Task":0,"AuditLog":0} |
| turso-runner | fail-guard | shape | row counts unchanged | PASS | {"User":3,"Session":0,"Workspace":2,"Membership":2,"AiUsage":0,"Company":3,"Contact":4,"Deal":2,"Activity":2,"Task":2,"AuditLog":4} |
| turso-runner | fail-guard | shape | the catch-up was rolled back with everything else | PASS |  |
| turso-runner | fail-guard | shape | the ledger does not record M2 as applied | PASS | _turso_migrations.applied_at='' |
| docker-runner | ok | m1 | the three committed migrations apply | PASS | migrations applied (the app start that follows fails here by design: no server.js, and on Windows the absolute-path import is rejected first) |
| docker-runner | ok | m1 | M1 applies | PASS | migrations applied (the app start that follows fails here by design: no server.js, and on Windows the absolute-path import is rejected first) |
| docker-runner | ok | m1 | M1 backfill: one membership per user with the role copied, CRM and non-auth audit rows in ws_default, auth rows null | PASS | ws_default \| u_admin:ADMIN@ws_default,u_member:MEMBER@ws_default \| null CRM rows 0 \| al_1:null,al_2:ws_default |
| docker-runner | ok | shape | M2 applies, so the runner does not wrap the file in a transaction | PASS | migrations applied (the app start that follows fails here by design: no server.js, and on Windows the absolute-path import is rejected first) |
| docker-runner | ok | shape | no new_* or guard tables left | PASS |  |
| docker-runner | ok | shape | workspaceId NOT NULL on the five CRM tables, still nullable on AuditLog | PASS | {"Company":1,"Contact":1,"Deal":1,"Activity":1,"Task":1,"AuditLog":0} |
| docker-runner | ok | shape | foreign_key_check is empty | PASS | 0 violation(s) |
| docker-runner | ok | shape | row counts unchanged apart from the caught-up membership | PASS | {"User":3,"Session":0,"Workspace":1,"Membership":3,"AiUsage":0,"Company":2,"Contact":4,"Deal":2,"Activity":2,"Task":2,"AuditLog":4} |
| docker-runner | ok | shape | foreign keys were really off during the rebuild: no contact lost its company, no activity was cascaded away | PASS |  |
| docker-runner | ok | shape | catch-up applied: the late user joined as MEMBER, late rows stamped, auth rows still null | PASS | u_admin:ADMIN@ws_default,u_late:MEMBER@ws_default,u_member:MEMBER@ws_default \| al_1:null,al_2:ws_default,al_late:ws_default,al_late_auth:null |
| docker-runner | ok | dual | inserting a contact linked to another workspace's company is refused | PASS | FOREIGN KEY constraint failed |
| docker-runner | ok | dual | re-pointing a contact at another workspace's company is refused | PASS | FOREIGN KEY constraint failed |
| docker-runner | ok | dual | re-pointing a deal at another workspace's company is refused | PASS | FOREIGN KEY constraint failed |
| docker-runner | ok | dual | a same-workspace link still works | PASS | ALLOWED |
| docker-runner | ok | dual | deleting a company still SET NULLs its contacts' companyId and keeps their workspaceId | PASS | ALLOWED; ct_2 {"companyId":null,"workspaceId":"ws_default"} |
| docker-runner | ok | dual | deleting a deal still cascades to its activities and tasks | PASS | ALLOWED; 0 child row(s) left |
| docker-runner | ok | shape | deleting a user who owns records is refused (owner keys Restrict) | PASS | FOREIGN KEY constraint failed |
| docker-runner | ok | dual | foreign_key_check is still empty after the probes | PASS | 0 |
| docker-runner | fail-mid | m1 | the three committed migrations apply | PASS | migrations applied (the app start that follows fails here by design: no server.js, and on Windows the absolute-path import is rejected first) |
| docker-runner | fail-mid | m1 | M1 applies | PASS | migrations applied (the app start that follows fails here by design: no server.js, and on Windows the absolute-path import is rejected first) |
| docker-runner | fail-mid | m1 | M1 backfill: one membership per user with the role copied, CRM and non-auth audit rows in ws_default, auth rows null | PASS | ws_default \| u_admin:ADMIN@ws_default,u_member:MEMBER@ws_default \| null CRM rows 0 \| al_1:null,al_2:ws_default |
| docker-runner | fail-mid | shape | M2 stops with the forced error (__spike_forced_failure) | PASS | code: 'SQLITE_ERROR' |
| docker-runner | fail-mid | shape | no new_* or guard tables left | PASS |  |
| docker-runner | fail-mid | shape | the Contact table is still M1's (same DDL) | PASS |  |
| docker-runner | fail-mid | shape | workspaceId still nullable everywhere | PASS | {"Company":0,"Contact":0,"Deal":0,"Activity":0,"Task":0,"AuditLog":0} |
| docker-runner | fail-mid | shape | row counts unchanged | PASS | {"User":3,"Session":0,"Workspace":1,"Membership":2,"AiUsage":0,"Company":2,"Contact":4,"Deal":2,"Activity":2,"Task":2,"AuditLog":4} |
| docker-runner | fail-mid | shape | the catch-up was rolled back with everything else | PASS |  |
| docker-runner | fail-mid | shape | the ledger does not record M2 as applied | PASS | _docker_migrations.applied_at='' |
| docker-runner | fail-guard | m1 | the three committed migrations apply | PASS | migrations applied (the app start that follows fails here by design: no server.js, and on Windows the absolute-path import is rejected first) |
| docker-runner | fail-guard | m1 | M1 applies | PASS | migrations applied (the app start that follows fails here by design: no server.js, and on Windows the absolute-path import is rejected first) |
| docker-runner | fail-guard | m1 | M1 backfill: one membership per user with the role copied, CRM and non-auth audit rows in ws_default, auth rows null | PASS | ws_default \| u_admin:ADMIN@ws_default,u_member:MEMBER@ws_default \| null CRM rows 0 \| al_1:null,al_2:ws_default |
| docker-runner | fail-guard | shape | M2 stops with the forced error (CHECK constraint failed) | PASS | code: 'SQLITE_CONSTRAINT_CHECK' |
| docker-runner | fail-guard | shape | no new_* or guard tables left | PASS |  |
| docker-runner | fail-guard | shape | the Contact table is still M1's (same DDL) | PASS |  |
| docker-runner | fail-guard | shape | workspaceId still nullable everywhere | PASS | {"Company":0,"Contact":0,"Deal":0,"Activity":0,"Task":0,"AuditLog":0} |
| docker-runner | fail-guard | shape | row counts unchanged | PASS | {"User":3,"Session":0,"Workspace":2,"Membership":2,"AiUsage":0,"Company":3,"Contact":4,"Deal":2,"Activity":2,"Task":2,"AuditLog":4} |
| docker-runner | fail-guard | shape | the catch-up was rolled back with everything else | PASS |  |
| docker-runner | fail-guard | shape | the ledger does not record M2 as applied | PASS | _docker_migrations.applied_at='' |
| harness | ok | m1 | the three committed migrations apply | PASS |  |
| harness | ok | m1 | M1 applies | PASS |  |
| harness | ok | m1 | M1 backfill: one membership per user with the role copied, CRM and non-auth audit rows in ws_default, auth rows null | PASS | ws_default \| u_admin:ADMIN@ws_default,u_member:MEMBER@ws_default \| null CRM rows 0 \| al_1:null,al_2:ws_default |
| harness | ok | shape | M2 applies, so the runner does not wrap the file in a transaction | PASS |  |
| harness | ok | shape | no new_* or guard tables left | PASS |  |
| harness | ok | shape | workspaceId NOT NULL on the five CRM tables, still nullable on AuditLog | PASS | {"Company":1,"Contact":1,"Deal":1,"Activity":1,"Task":1,"AuditLog":0} |
| harness | ok | shape | foreign_key_check is empty | PASS | 0 violation(s) |
| harness | ok | shape | row counts unchanged apart from the caught-up membership | PASS | {"User":3,"Session":0,"Workspace":1,"Membership":3,"AiUsage":0,"Company":2,"Contact":4,"Deal":2,"Activity":2,"Task":2,"AuditLog":4} |
| harness | ok | shape | foreign keys were really off during the rebuild: no contact lost its company, no activity was cascaded away | PASS |  |
| harness | ok | shape | catch-up applied: the late user joined as MEMBER, late rows stamped, auth rows still null | PASS | u_admin:ADMIN@ws_default,u_late:MEMBER@ws_default,u_member:MEMBER@ws_default \| al_1:null,al_2:ws_default,al_late:ws_default,al_late_auth:null |
| harness | ok | shape | PRAGMA foreign_keys is ON again on the migrating connection | PASS | 1 |
| harness | ok | dual | inserting a contact linked to another workspace's company is refused | PASS | FOREIGN KEY constraint failed |
| harness | ok | dual | re-pointing a contact at another workspace's company is refused | PASS | FOREIGN KEY constraint failed |
| harness | ok | dual | re-pointing a deal at another workspace's company is refused | PASS | FOREIGN KEY constraint failed |
| harness | ok | dual | a same-workspace link still works | PASS | ALLOWED |
| harness | ok | dual | deleting a company still SET NULLs its contacts' companyId and keeps their workspaceId | PASS | ALLOWED; ct_2 {"companyId":null,"workspaceId":"ws_default"} |
| harness | ok | dual | deleting a deal still cascades to its activities and tasks | PASS | ALLOWED; 0 child row(s) left |
| harness | ok | shape | deleting a user who owns records is refused (owner keys Restrict) | PASS | FOREIGN KEY constraint failed |
| harness | ok | dual | foreign_key_check is still empty after the probes | PASS | 0 |
| harness | fail-mid | m1 | the three committed migrations apply | PASS |  |
| harness | fail-mid | m1 | M1 applies | PASS |  |
| harness | fail-mid | m1 | M1 backfill: one membership per user with the role copied, CRM and non-auth audit rows in ws_default, auth rows null | PASS | ws_default \| u_admin:ADMIN@ws_default,u_member:MEMBER@ws_default \| null CRM rows 0 \| al_1:null,al_2:ws_default |
| harness | fail-mid | shape | M2 stops with the forced error (__spike_forced_failure) | PASS | no such table: __spike_forced_failure |
| harness | fail-mid | shape | no new_* or guard tables left | PASS |  |
| harness | fail-mid | shape | the Contact table is still M1's (same DDL) | PASS |  |
| harness | fail-mid | shape | workspaceId still nullable everywhere | PASS | {"Company":0,"Contact":0,"Deal":0,"Activity":0,"Task":0,"AuditLog":0} |
| harness | fail-mid | shape | row counts unchanged | PASS | {"User":3,"Session":0,"Workspace":1,"Membership":2,"AiUsage":0,"Company":2,"Contact":4,"Deal":2,"Activity":2,"Task":2,"AuditLog":4} |
| harness | fail-mid | shape | the catch-up was rolled back with everything else | PASS |  |
| harness | fail-mid | shape | the ledger does not record M2 as applied | PASS | no M2 row |
| harness | fail-guard | m1 | the three committed migrations apply | PASS |  |
| harness | fail-guard | m1 | M1 applies | PASS |  |
| harness | fail-guard | m1 | M1 backfill: one membership per user with the role copied, CRM and non-auth audit rows in ws_default, auth rows null | PASS | ws_default \| u_admin:ADMIN@ws_default,u_member:MEMBER@ws_default \| null CRM rows 0 \| al_1:null,al_2:ws_default |
| harness | fail-guard | shape | M2 stops with the forced error (CHECK constraint failed) | PASS | CHECK constraint failed: ok |
| harness | fail-guard | shape | no new_* or guard tables left | PASS |  |
| harness | fail-guard | shape | the Contact table is still M1's (same DDL) | PASS |  |
| harness | fail-guard | shape | workspaceId still nullable everywhere | PASS | {"Company":0,"Contact":0,"Deal":0,"Activity":0,"Task":0,"AuditLog":0} |
| harness | fail-guard | shape | row counts unchanged | PASS | {"User":3,"Session":0,"Workspace":2,"Membership":2,"AiUsage":0,"Company":3,"Contact":4,"Deal":2,"Activity":2,"Task":2,"AuditLog":4} |
| harness | fail-guard | shape | the catch-up was rolled back with everything else | PASS |  |
| harness | fail-guard | shape | the ledger does not record M2 as applied | PASS | no M2 row |

### Ledger and connection after the forced failures

| Path | Scenario | M2 ledger row | Connection still inside the transaction |
|---|---|---|---|
| prisma-migrate | fail-mid | finished_at=NULL rolled_back_at=NULL logs=NULL | n/a (the process exited) |
| prisma-migrate | fail-guard | finished_at=NULL rolled_back_at=NULL logs=NULL | n/a (the process exited) |
| turso-runner | fail-mid | _turso_migrations.applied_at='' | n/a (the process exited) |
| turso-runner | fail-guard | _turso_migrations.applied_at='' | n/a (the process exited) |
| docker-runner | fail-mid | _docker_migrations.applied_at='' | n/a (the process exited) |
| docker-runner | fail-guard | _docker_migrations.applied_at='' | n/a (the process exited) |
| harness | fail-mid | (the harness keeps no ledger) | true |
| harness | fail-guard | (the harness keeps no ledger) | true |

## Generated dual-key DDL (Contact)

```sql
CREATE TABLE "new_Contact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "title" TEXT,
    "status" TEXT NOT NULL DEFAULT 'LEAD',
    "source" TEXT,
    "notes" TEXT,
    "aiScore" INTEGER,
    "aiScoreReason" TEXT,
    "aiScoredAt" DATETIME,
    "companyId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Contact_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Contact_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Contact_workspaceId_companyId_fkey" FOREIGN KEY ("workspaceId", "companyId") REFERENCES "Company" ("workspaceId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "Contact_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
```

## What phase B carries forward

- If the shape is confirmed: generate M2 with `prisma migrate dev --create-only`, then hand-wrap it exactly as in Method: remove Prisma's PRAGMA lines, add the spec header and footer, prepend the catch-up, add the COALESCE to each CRM rebuild, and append the guard before `COMMIT`.
- **Recovery after a failed M2** (spec §10 phase B step 3). The ledger table above records only the stuck state: the unfinished or empty-`applied_at` M2 row, and whether the connection is still inside the transaction. The refusals and recovery steps below were **verified by hand on scratch copies of the `fail-mid` databases, not recorded by the runner**:
  - Prisma Migrate: the M2 row stays unfinished. A second `migrate deploy` exits 1 with `P3009` ("migrate found failed migrations in the target database") until `npx prisma migrate resolve --rolled-back <M2 directory>` is run; after that, `migrate deploy` applies a corrected M2. Run the resolve only after confirming the M1 shape: no `new_*` tables, `workspaceId` still nullable, row counts equal to the backup.
  - Turso runner and Docker runner: the claim row stays with an empty `applied_at`, and the next run exits 1 with "was started but never recorded as finished ... Refusing to continue" (the Turso runner via `planMigrations` → `interrupted`; the Docker entrypoint has an inline copy of the same check). After the row is deleted (`DELETE FROM _turso_migrations WHERE name = '<M2 directory>'`, or `_docker_migrations`), the next run applies a corrected M2. Delete it only after the same three checks. Never clear it while a `new_*` table exists or a `workspaceId` is already NOT NULL.
  - A runner that keeps its connection after an error (the harness does; this one is recorded in the last column of the ledger table) is still inside the transaction. It must roll back or close that connection before reusing it.
- With foreign keys off, only the guard checks the composite keys before `COMMIT`. Keep it in M2: the `fail-guard` rows show that it turns a pre-existing cross-workspace link into a complete rollback, rather than a committed violation that only the verify gate would find.
- The catch-up assumes the single-mode default workspace, and its membership insert is guarded by `EXISTS (… 'ws_default')`. On a multi-mode database with NULL rows, the COALESCE would point rows at a missing workspace and the guard would abort M2. That is the safe outcome, but phase B should decide the multi-mode case explicitly.

## Not covered here

- **The remote Hrana path.** Production runs the Turso runner over HTTP. @libsql/client sends the whole file as one pipelined stream and closes it in the same request, so an error should end the stream and roll back the open transaction. Only Turso can show that. Phase B's rehearsal on a Turso branch (spec §10 phase B step 2) must also run the `fail-mid` file once on a throwaway branch and repeat the intact-table checks.
- **`pragma_foreign_key_check` as a table-valued function on Turso**, which the guard relies on: same rehearsal.
- **Timing and lock duration** on production-sized data. `BEGIN IMMEDIATE` holds the write lock for the whole file.
- **The real M2's relation actions** (`Workspace` relations are Restrict here) and its final index set. Phase B decides both.

## Reproduce

Recreate `.scratch/tenancy-spike/{run.ts,m1.prisma,m2.prisma}` from plan Task 1, then run `npx tsx .scratch/tenancy-spike/run.ts` from the repo root with Node 24.
