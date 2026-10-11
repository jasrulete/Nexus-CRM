-- DropIndex
DROP INDEX "Contact_status_idx";

-- DropIndex
DROP INDEX "Deal_stage_idx";

-- AlterTable
ALTER TABLE "Activity" ADD COLUMN "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Company" ADD COLUMN "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isDemo" BOOLEAN NOT NULL DEFAULT false,
    "plan" TEXT NOT NULL DEFAULT 'FREE',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiUsage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "provider" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AiUsage_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Workspace_slug_key" ON "Workspace"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_key" ON "Membership"("userId");

-- CreateIndex
CREATE INDEX "Membership_workspaceId_idx" ON "Membership"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_workspaceId_userId_key" ON "Membership"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "AiUsage_workspaceId_createdAt_idx" ON "AiUsage"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

-- CreateIndex
CREATE INDEX "Activity_workspaceId_createdAt_idx" ON "Activity"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_workspaceId_createdAt_idx" ON "AuditLog"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Company_workspaceId_updatedAt_idx" ON "Company"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_updatedAt_idx" ON "Contact"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_status_idx" ON "Contact"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "Contact_workspaceId_createdAt_idx" ON "Contact"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "Deal_workspaceId_stage_position_idx" ON "Deal"("workspaceId", "stage", "position");

-- CreateIndex
CREATE INDEX "Deal_workspaceId_updatedAt_idx" ON "Deal"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "Task_workspaceId_assigneeId_done_idx" ON "Task"("workspaceId", "assigneeId", "done");

-- ---------------------------------------------------------------------------
-- Data (hand-appended to the generated SQL; spec §10, phase A, M1).
-- Plain SQLite only: this file runs unchanged under prisma migrate,
-- scripts/db-push-turso.ts, scripts/docker-entrypoint.mjs and the test
-- harness. 'ws_default' is DEFAULT_WORKSPACE_ID (src/lib/workspace-bootstrap.ts).
-- Timestamps are written the way the Prisma SQLite adapters write them
-- (ISO 8601 with "+00:00"), never as CURRENT_TIMESTAMP's "YYYY-MM-DD HH:MM:SS".
-- ---------------------------------------------------------------------------

-- The default workspace, only when the install already has users. A zero-user
-- database (a fresh install, CI, the test harness) gets none here; the app
-- creates it on the first sign-up or seed.
INSERT INTO "Workspace" ("id", "name", "slug", "createdAt", "updatedAt")
SELECT 'ws_default', 'Default workspace', 'default',
       strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now'),
       strftime('%Y-%m-%dT%H:%M:%f+00:00', 'now')
WHERE EXISTS (SELECT 1 FROM "User");

-- One membership per user, the role copied as is: ADMIN stays ADMIN, MEMBER
-- stays MEMBER, nobody becomes OWNER (on the demo database the earliest admin
-- is the published demo account). createdAt is the user's own, so "member
-- since" and the roster order stay what they are today.
INSERT INTO "Membership" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT 'mem_' || "id", 'ws_default', "id", "role", "createdAt" FROM "User";

-- Every CRM row into the default workspace. The EXISTS guard keeps a row from
-- pointing at a workspace that was never created.
UPDATE "Company" SET "workspaceId" = 'ws_default'
WHERE "workspaceId" IS NULL AND EXISTS (SELECT 1 FROM "Workspace" WHERE "id" = 'ws_default');
UPDATE "Contact" SET "workspaceId" = 'ws_default'
WHERE "workspaceId" IS NULL AND EXISTS (SELECT 1 FROM "Workspace" WHERE "id" = 'ws_default');
UPDATE "Deal" SET "workspaceId" = 'ws_default'
WHERE "workspaceId" IS NULL AND EXISTS (SELECT 1 FROM "Workspace" WHERE "id" = 'ws_default');
UPDATE "Activity" SET "workspaceId" = 'ws_default'
WHERE "workspaceId" IS NULL AND EXISTS (SELECT 1 FROM "Workspace" WHERE "id" = 'ws_default');
UPDATE "Task" SET "workspaceId" = 'ws_default'
WHERE "workspaceId" IS NULL AND EXISTS (SELECT 1 FROM "Workspace" WHERE "id" = 'ws_default');

-- Workspace audit rows too. Platform events (auth.*) stay NULL: they are never
-- shown to a workspace (spec §5.6).
UPDATE "AuditLog" SET "workspaceId" = 'ws_default'
WHERE "workspaceId" IS NULL AND "action" NOT LIKE 'auth.%'
  AND EXISTS (SELECT 1 FROM "Workspace" WHERE "id" = 'ws_default');
