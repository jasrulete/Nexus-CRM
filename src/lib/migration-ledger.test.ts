import { describe, expect, it } from "vitest";

import { planMigrations } from "./migration-ledger";

const M1 = "20260715164036_init";
const M2 = "20260725150849_add_deal_task_fk_indexes";
const M3 = "20260823151943_add_deal_base_value_and_fx_rate";
const ALL = [M1, M2, M3];

const done = (name: string) => ({ name, applied_at: "2026-08-23T00:00:00.000Z" });
const started = (name: string) => ({ name, applied_at: "" });

describe("a fresh database", () => {
  it("applies every migration in order", () => {
    expect(
      planMigrations({ ledger: [], all: ALL, hasExistingSchema: false }),
    ).toEqual({ kind: "apply", pending: ALL });
  });

  it("has nothing to do when there are no migrations at all", () => {
    expect(
      planMigrations({ ledger: [], all: [], hasExistingSchema: false }),
    ).toEqual({ kind: "apply", pending: [] });
  });
});

describe("a database already up to date", () => {
  it("applies nothing", () => {
    expect(
      planMigrations({
        ledger: ALL.map(done),
        all: ALL,
        hasExistingSchema: true,
      }),
    ).toEqual({ kind: "apply", pending: [] });
  });

  it("applies only what is missing", () => {
    expect(
      planMigrations({
        ledger: [done(M1), done(M2)],
        all: ALL,
        hasExistingSchema: true,
      }),
    ).toEqual({ kind: "apply", pending: [M3] });
  });
});

describe("adopting a database that predates the ledger", () => {
  it("baselines the first migration and applies the rest", () => {
    // The schema is already there, so replaying migration #1 would fail on
    // CREATE TABLE — the original bug this ledger exists to prevent.
    expect(
      planMigrations({ ledger: [], all: ALL, hasExistingSchema: true }),
    ).toEqual({ kind: "baseline", migration: M1, pending: [M2, M3] });
  });

  it("does not baseline an empty database", () => {
    expect(
      planMigrations({ ledger: [], all: ALL, hasExistingSchema: false }),
    ).toEqual({ kind: "apply", pending: ALL });
  });
});

describe("an interrupted migration", () => {
  it("refuses to continue rather than guessing", () => {
    const plan = planMigrations({
      ledger: [done(M1), started(M2)],
      all: ALL,
      hasExistingSchema: true,
    });

    expect(plan.kind).toBe("interrupted");
    expect(plan).toMatchObject({ migration: M2 });
  });

  it("is detected before baselining, which is how the old failure went silent", () => {
    // The exact incident shape: the first migration died partway, leaving some
    // tables created. The old code saw an empty ledger and an existing User
    // table, decided it was adopting a pre-existing database, and baselined —
    // so the tables that were never created never would be.
    const plan = planMigrations({
      ledger: [started(M1)],
      all: ALL,
      hasExistingSchema: true,
    });

    expect(plan.kind).toBe("interrupted");
    expect(plan.kind).not.toBe("baseline");
  });

  it("explains what to do about it", () => {
    const plan = planMigrations({
      ledger: [started(M2)],
      all: ALL,
      hasExistingSchema: true,
    });

    if (plan.kind !== "interrupted") throw new Error("expected interrupted");
    expect(plan.message).toContain(M2);
    expect(plan.message).toMatch(/delete its row from the ledger/);
  });

  it("treats a whitespace-only timestamp as unfinished", () => {
    const plan = planMigrations({
      ledger: [{ name: M1, applied_at: "   " }],
      all: ALL,
      hasExistingSchema: true,
    });

    expect(plan.kind).toBe("interrupted");
  });
});
