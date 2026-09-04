import { describe, expect, it } from "vitest";

import { auditPruneWhere, resolveResetTarget } from "./reset-guard";

const TURSO = "libsql://example.turso.io";

describe("resolveResetTarget", () => {
  it("stays local when Turso credentials are present but unconfirmed", () => {
    // The regression this prevents: `.env` always carries TURSO_DATABASE_URL
    // for db:push:turso, so a plain `npm run demo:reset` on a laptop must not
    // reach production.
    expect(resolveResetTarget({ TURSO_DATABASE_URL: TURSO })).toBe("local");
  });

  it("targets remote only when explicitly confirmed", () => {
    expect(
      resolveResetTarget({
        TURSO_DATABASE_URL: TURSO,
        ALLOW_REMOTE_DB: "true",
      }),
    ).toBe("remote");
  });

  it("treats any value other than \"true\" as not confirmed", () => {
    expect(
      resolveResetTarget({ TURSO_DATABASE_URL: TURSO, ALLOW_REMOTE_DB: "1" }),
    ).toBe("local");
  });

  it("refuses to guess when the opt-in and the environment disagree", () => {
    expect(() => resolveResetTarget({ ALLOW_REMOTE_DB: "true" })).toThrow(
      /refusing to guess/i,
    );
  });

  it("is local with no database configuration at all", () => {
    expect(resolveResetTarget({})).toBe("local");
  });
});

describe("auditPruneWhere", () => {
  const now = new Date("2026-08-21T19:00:00.000Z");

  it("deletes the demo account's own entries", () => {
    const where = auditPruneWhere({ demoUserId: "user_demo", now });
    expect(where.OR).toContainEqual({ userId: "user_demo" });
  });

  it("ages out everything else on the retention window", () => {
    const where = auditPruneWhere({ demoUserId: "user_demo", now });
    expect(where.OR).toContainEqual({
      createdAt: { lt: new Date("2026-07-22T19:00:00.000Z") },
    });
  });

  it("keeps a real user's recent entries", () => {
    // The regression this prevents: the reset used to run auditLog.deleteMany()
    // with no filter, so a real account's logins and changes had a maximum
    // retention of 24 hours while the UI claimed a full audit trail.
    const where = auditPruneWhere({ demoUserId: "user_demo", now });
    const matchesRealRecentRow = where.OR.some((clause) => {
      const c = clause as { userId?: string; createdAt?: { lt: Date } };
      if (c.userId) return c.userId === "user_real";
      return new Date("2026-08-20T00:00:00.000Z") < c.createdAt!.lt;
    });
    expect(matchesRealRecentRow).toBe(false);
  });

  it("still prunes a real user's entry once it is past the window", () => {
    const where = auditPruneWhere({ demoUserId: "user_demo", now });
    const cutoff = (where.OR[0] as { createdAt: { lt: Date } }).createdAt.lt;
    expect(new Date("2026-06-01T00:00:00.000Z") < cutoff).toBe(true);
  });

  it("omits the demo clause entirely when there is no demo account yet", () => {
    // First run against a fresh database: ensureDemoUser has not run yet, and
    // a stray `{ userId: undefined }` would match every row.
    const where = auditPruneWhere({ demoUserId: null, now });
    expect(where.OR).toHaveLength(1);
    expect(where.OR[0]).toHaveProperty("createdAt");
  });
});
