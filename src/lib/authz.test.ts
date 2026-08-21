import { describe, expect, it } from "vitest";

import { canMutate } from "./authz";

const owner = { id: "user_owner", role: "MEMBER" };
const other = { id: "user_other", role: "MEMBER" };
const admin = { id: "user_admin", role: "ADMIN" };

describe("canMutate", () => {
  it("allows the owner", () => {
    expect(canMutate(owner.id, owner)).toBe(true);
  });

  it("allows an admin who does not own the record", () => {
    expect(canMutate(owner.id, admin)).toBe(true);
  });

  it("refuses another member", () => {
    // The gap this closes: reads are workspace-wide by design, so any member
    // could copy a cuid out of a detail-page URL and call updateContact on it.
    expect(canMutate(owner.id, other)).toBe(false);
  });

  it("refuses a role that merely looks privileged", () => {
    // Role is a free-text column (SQLite has no enums), so only the exact
    // literal the rest of the app writes may pass.
    expect(canMutate(owner.id, { id: other.id, role: "admin" })).toBe(false);
    expect(canMutate(owner.id, { id: other.id, role: "OWNER" })).toBe(false);
    expect(canMutate(owner.id, { id: other.id, role: "" })).toBe(false);
  });
});
