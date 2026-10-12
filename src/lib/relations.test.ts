/**
 * The relation resolvers turn a form's contact, company or deal id into a link.
 * They take the caller's scoped client as a required first argument, so another
 * workspace's id is "not found" by construction (spec §5.4).
 *
 * Review Focus 3: a form submitted with another workspace's id (a tampered
 * request, or a stale tab after a reset) must read as "that record no longer
 * exists", so no cross-workspace link can be written.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createTestDatabase, truncateAll } from "@/test/action-harness";
import { twoWorkspaces, type TenantFixture } from "@/test/cross-tenant";
import { scopeToWorkspace } from "@/lib/tenancy";
import {
  findMissingRelation,
  missingRelationMessage,
  resolveCompanyId,
  resolveRelation,
} from "./relations";

const { prisma, destroy } = createTestDatabase();

let a: TenantFixture;
let b: TenantFixture;

beforeAll(async () => {
  await prisma.$connect();
});
afterAll(async () => {
  await destroy();
});
beforeEach(async () => {
  await truncateAll(prisma);
  ({ a, b } = await twoWorkspaces(prisma));
});

const scopedTo = (fixture: TenantFixture) => scopeToWorkspace(prisma, fixture.workspaceId);

describe("findMissingRelation", () => {
  it("finds the caller's own records", async () => {
    expect(
      await findMissingRelation(scopedTo(a), {
        contactId: a.contactId,
        dealId: a.dealId,
        companyId: a.companyId,
      }),
    ).toBeNull();
  });

  it("reports another workspace's contact, deal or company as missing", async () => {
    const db = scopedTo(a);
    expect(await findMissingRelation(db, { contactId: b.contactId })).toBe("contact");
    expect(await findMissingRelation(db, { dealId: b.dealId })).toBe("deal");
    expect(await findMissingRelation(db, { companyId: b.companyId })).toBe("company");
  });

  it("checks every id it is given, so an own contact cannot carry a foreign deal through", async () => {
    expect(
      await findMissingRelation(scopedTo(a), { contactId: a.contactId, dealId: b.dealId }),
    ).toBe("deal");
  });

  it("still reports a record deleted under a stale tab", async () => {
    await prisma.contact.delete({ where: { id: a.contactId } });
    expect(await findMissingRelation(scopedTo(a), { contactId: a.contactId })).toBe("contact");
  });

  it("does not check ids that were not supplied", async () => {
    expect(
      await findMissingRelation(scopedTo(a), { contactId: null, dealId: undefined }),
    ).toBeNull();
  });

  it("phrases a miss for the form that renders it", () => {
    expect(missingRelationMessage("company")).toBe(
      "That company no longer exists — refresh the page and try again.",
    );
  });
});

describe("resolveRelation and resolveCompanyId", () => {
  it("return the id of the caller's own record", async () => {
    const db = scopedTo(a);
    expect(await resolveRelation(db, "contact", a.contactId)).toBe(a.contactId);
    expect(await resolveRelation(db, "company", a.companyId)).toBe(a.companyId);
    expect(await resolveCompanyId(db, a.companyId)).toBe(a.companyId);
  });

  it("resolve another workspace's id to null, so the link is dropped rather than written", async () => {
    const db = scopedTo(a);
    expect(await resolveRelation(db, "contact", b.contactId)).toBeNull();
    expect(await resolveRelation(db, "company", b.companyId)).toBeNull();
    expect(await resolveCompanyId(db, b.companyId)).toBeNull();
  });

  it("resolve an absent id to null", async () => {
    const db = scopedTo(a);
    expect(await resolveRelation(db, "contact", null)).toBeNull();
    expect(await resolveRelation(db, "company", undefined)).toBeNull();
    expect(await resolveCompanyId(db, "")).toBeNull();
  });

  it("hold in both directions: B's scope cannot see A's records either", async () => {
    const db = scopedTo(b);
    expect(await resolveRelation(db, "contact", a.contactId)).toBeNull();
    expect(await findMissingRelation(db, { companyId: a.companyId })).toBe("company");
  });
});
