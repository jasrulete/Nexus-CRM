/**
 * createTestDatabase({ through }) builds a database at an older schema, so a
 * migration's data statements can be tested against fixtures inserted with raw
 * SQL (spec §9.8), and applyRemaining() then runs the later migrations the way
 * every runner runs them.
 */
import { existsSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createTestDatabase } from "./action-harness";

// Chosen to be independent of M1: the migration after it adds Deal.baseValue.
const FK_INDEXES = "20260725150849_add_deal_task_fk_indexes";

const made: Array<ReturnType<typeof createTestDatabase>> = [];
afterEach(async () => {
  for (const db of made.splice(0)) await db.destroy();
});

function track(db: ReturnType<typeof createTestDatabase>) {
  made.push(db);
  return db;
}

function columns(file: string, table: string): string[] {
  const raw = new Database(file, { readonly: true });
  try {
    return (raw.prepare(`PRAGMA table_info("${table}")`).all() as { name: string }[]).map((c) => c.name);
  } finally {
    raw.close();
  }
}

describe("createTestDatabase({ through })", () => {
  it("stops after the named migration, inclusive, and applies the rest on demand", () => {
    const db = track(createTestDatabase({ through: FK_INDEXES }));
    expect(columns(db.file, "Deal")).toContain("value");
    expect(columns(db.file, "Deal")).not.toContain("baseValue");

    db.applyRemaining();

    expect(columns(db.file, "Deal")).toContain("baseValue");
  });

  it("does not re-run anything the second time", () => {
    const db = track(createTestDatabase({ through: FK_INDEXES }));
    db.applyRemaining();
    const raw = new Database(db.file);
    try {
      raw.exec(`
        INSERT INTO "User" ("id", "email", "name", "passwordHash", "updatedAt") VALUES ('u1', 'u1@example.com', 'U', 'x', '2026-01-01T00:00:00.000+00:00');
        INSERT INTO "Deal" ("id", "title", "value", "baseValue", "ownerId", "updatedAt") VALUES ('d1', 'Sentinel', 1, 5, 'u1', '2026-01-01T00:00:00.000+00:00');
      `);
    } finally {
      raw.close();
    }

    // A re-run of the fx migration would rebuild Deal and reset baseValue to value.
    db.applyRemaining();

    const check = new Database(db.file, { readonly: true });
    try {
      expect(check.prepare(`SELECT "baseValue" FROM "Deal" WHERE "id" = 'd1'`).get()).toEqual({ baseValue: 5 });
    } finally {
      check.close();
    }
  });

  it("refuses a migration name that does not exist", () => {
    expect(() => createTestDatabase({ through: "nope" })).toThrow('createTestDatabase: no migration directory named "nope"');
  });

  it("still builds the full schema by default", async () => {
    const db = track(createTestDatabase());
    expect(existsSync(db.file)).toBe(true);
    db.applyRemaining(); // nothing left: re-running the init migration would throw
    expect(await db.prisma.user.count()).toBe(0);
  });
});
