import { describe, expect, it } from "vitest";

import { resolveResetTarget } from "./reset-guard";

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
