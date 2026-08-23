-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Deal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "baseValue" INTEGER NOT NULL DEFAULT 0,
    "fxRate" REAL NOT NULL DEFAULT 1,
    "stage" TEXT NOT NULL DEFAULT 'LEAD',
    "position" INTEGER NOT NULL DEFAULT 0,
    "expectedCloseDate" DATETIME,
    "closedAt" DATETIME,
    "contactId" TEXT,
    "companyId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Deal_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Deal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Deal_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- Backfill, do not default. Every existing row predates multi-currency and is
-- already in the workspace currency, so its converted amount is its own amount
-- at a rate of 1. Letting baseValue take its DEFAULT 0 would silently zero
-- every historical deal out of every total in the app.
INSERT INTO "new_Deal" ("closedAt", "companyId", "contactId", "createdAt", "currency", "expectedCloseDate", "id", "ownerId", "position", "stage", "title", "updatedAt", "value", "baseValue", "fxRate") SELECT "closedAt", "companyId", "contactId", "createdAt", "currency", "expectedCloseDate", "id", "ownerId", "position", "stage", "title", "updatedAt", "value", "value", 1.0 FROM "Deal";
DROP TABLE "Deal";
ALTER TABLE "new_Deal" RENAME TO "Deal";
CREATE INDEX "Deal_ownerId_idx" ON "Deal"("ownerId");
CREATE INDEX "Deal_stage_idx" ON "Deal"("stage");
CREATE INDEX "Deal_contactId_idx" ON "Deal"("contactId");
CREATE INDEX "Deal_companyId_idx" ON "Deal"("companyId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
