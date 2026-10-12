/**
 * db.ts's exports. Nothing here reaches the database: a scoped call to a global
 * model is refused inside the extension, before the client connects.
 */
import { describe, expect, it } from "vitest";
import { forWorkspace, scopeToWorkspace } from "./db";
import { TenancyViolation, scopeToWorkspace as scopeFromTenancy } from "./tenancy";

describe("db exports", () => {
  it("no longer exports the deprecated prisma alias", async () => {
    const mod = await import("./db");
    expect("prisma" in mod).toBe(false);
  });

  it("re-exports scopeToWorkspace from tenancy.ts", () => {
    expect(scopeToWorkspace).toBe(scopeFromTenancy);
  });

  it("forWorkspace refuses an empty workspace id", () => {
    expect(() => forWorkspace("")).toThrow(TenancyViolation);
  });

  it("forWorkspace returns a scoped client over systemDb", async () => {
    await expect(forWorkspace("ws_any").user.findMany()).rejects.toThrow(TenancyViolation);
    await expect(forWorkspace("ws_any").$queryRawUnsafe("SELECT 1")).rejects.toThrow(TenancyViolation);
  });
});
