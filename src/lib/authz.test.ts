import { describe, expect, it } from "vitest";

import { canMutate, isWorkspaceAdmin } from "./authz";

const owner = { id: "user_owner", role: "MEMBER" };
const other = { id: "user_other", role: "MEMBER" };
const admin = { id: "user_admin", role: "ADMIN" };
const workspaceOwner = { id: "user_ws_owner", role: "OWNER" };

describe("isWorkspaceAdmin", () => {
  it("is true for OWNER and ADMIN only", () => {
    expect(isWorkspaceAdmin("OWNER")).toBe(true);
    expect(isWorkspaceAdmin("ADMIN")).toBe(true);
    expect(isWorkspaceAdmin("MEMBER")).toBe(false);
  });

  it("refuses a role that merely looks privileged", () => {
    // Role is a free-text column (SQLite has no enums), so only the exact
    // literals the app writes may pass.
    expect(isWorkspaceAdmin("admin")).toBe(false);
    expect(isWorkspaceAdmin("owner")).toBe(false);
    expect(isWorkspaceAdmin("")).toBe(false);
  });
});

describe("canMutate", () => {
  it("allows the owner", () => {
    expect(canMutate(owner.id, owner)).toBe(true);
  });

  it("allows an admin who does not own the record", () => {
    expect(canMutate(owner.id, admin)).toBe(true);
  });

  it("allows the workspace OWNER who does not own the record", () => {
    // A fresh install's first registrant is OWNER and keeps today's admin view.
    expect(canMutate(owner.id, workspaceOwner)).toBe(true);
  });

  it("refuses another member", () => {
    // The gap this closes: reads are workspace-wide by design, so any member
    // could copy a cuid out of a detail-page URL and call updateContact on it.
    expect(canMutate(owner.id, other)).toBe(false);
  });

  it("refuses a role that merely looks privileged", () => {
    expect(canMutate(owner.id, { id: other.id, role: "admin" })).toBe(false);
    expect(canMutate(owner.id, { id: other.id, role: "owner" })).toBe(false);
    expect(canMutate(owner.id, { id: other.id, role: "" })).toBe(false);
  });
});
