/**
 * The scoped client against a real database built from the migrations.
 *
 * Every operation of the installed client is run against every TENANT model,
 * with one row in workspace A (bound) and one in workspace B, and B's rows are
 * re-read after each call to prove nothing there changed. A Prisma upgrade that
 * adds an operation fails "operation coverage" below until the switch in
 * tenancy.ts handles it.
 */
import { afterAll, beforeEach, describe, expect, expectTypeOf, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { createTestDatabase, truncateAll } from "@/test/action-harness";
import {
  SCOPED_OPERATIONS,
  TenancyViolation,
  scopeToWorkspace,
  type ScopedDb,
  type ScopedOperation,
} from "./tenancy";
import { TENANT_MODELS } from "./tenancy-map";

const { prisma, destroy } = createTestDatabase();

afterAll(async () => {
  await destroy();
});

const A = "ws_a";
const B = "ws_b";

type Row = { id: string; workspaceId: string | null };
// Untyped access, so one table can drive all eight models, and so the
// deliberately invalid calls below reach the extension instead of tsc.
type Delegate = Record<string, (args?: unknown) => Promise<unknown>>;
type Client = Record<string, Delegate>;

function delegateOf(client: unknown, name: string): Delegate {
  return (client as Record<string, Delegate>)[name];
}

const lowerFirst = (model: string) => model[0].toLowerCase() + model.slice(1);

let userSeq = 0;
async function newUser() {
  userSeq += 1;
  return prisma.user.create({
    data: { email: `user${userSeq}@example.com`, name: `User ${userSeq}`, passwordHash: "x" },
  });
}

let owner: { id: string; name: string };

async function resetDatabase() {
  // Membership, AiUsage and Workspace join truncateAll in Task 6.
  await prisma.membership.deleteMany();
  await prisma.aiUsage.deleteMany();
  await truncateAll(prisma);
  await prisma.workspace.deleteMany();
  await prisma.workspace.create({ data: { id: A, name: "A", slug: "a" } });
  await prisma.workspace.create({ data: { id: B, name: "B", slug: "b" } });
  owner = await newUser();
}

type ModelCase = {
  /** Valid create data for a row in `ws`, making any parent rows it needs. */
  data(ws: string): Promise<Record<string, unknown>>;
  /** A plain-column update. */
  patch: Record<string, unknown>;
};

const CASES: Record<string, ModelCase> = {
  Company: {
    data: async (ws) => ({ name: "Co", ownerId: owner.id, workspaceId: ws }),
    patch: { name: "Renamed" },
  },
  Contact: {
    data: async (ws) => ({ firstName: "Cy", lastName: "Lee", ownerId: owner.id, workspaceId: ws }),
    patch: { notes: "patched" },
  },
  Deal: {
    data: async (ws) => ({ title: "Renewal", ownerId: owner.id, workspaceId: ws }),
    patch: { title: "patched" },
  },
  Activity: {
    data: async (ws) => ({ type: "NOTE", content: "n", userId: owner.id, workspaceId: ws }),
    patch: { content: "patched" },
  },
  Task: {
    data: async (ws) => ({ title: "Call", assigneeId: owner.id, workspaceId: ws }),
    patch: { title: "patched" },
  },
  AuditLog: {
    data: async (ws) => ({ action: "contact.create", entityType: "contact", entityId: "c1", workspaceId: ws }),
    patch: { metadata: "{}" },
  },
  Membership: {
    data: async (ws) => ({ userId: (await newUser()).id, role: "MEMBER", workspaceId: ws }),
    patch: { role: "ADMIN" },
  },
  AiUsage: {
    data: async (ws) => ({ action: "score", outcome: "pending", workspaceId: ws }),
    patch: { outcome: "answered" },
  },
};

/** Every tenant row of one workspace, serialised: "did anything in B change?" */
async function rowsOf(ws: string): Promise<string> {
  const tables = await Promise.all(
    TENANT_MODELS.map((m) =>
      delegateOf(prisma, lowerFirst(m)).findMany({ where: { workspaceId: ws }, orderBy: { id: "asc" } }),
    ),
  );
  return JSON.stringify(tables);
}

const ids = (rows: unknown) => (rows as Row[]).map((r) => r.id).sort();

type Check = {
  scoped: Delegate;
  base: Delegate;
  c: ModelCase;
  mine: Row;
  theirs: Row;
};

// Keyed by ScopedOperation, so tsc refuses this table if an operation is missing.
const OPERATION_CHECKS: Record<ScopedOperation, (t: Check) => Promise<void>> = {
  findUnique: async ({ scoped, mine, theirs }) => {
    expect(await scoped.findUnique({ where: { id: mine.id } })).toMatchObject({ id: mine.id });
    expect(await scoped.findUnique({ where: { id: theirs.id } })).toBeNull();
  },
  findUniqueOrThrow: async ({ scoped, mine, theirs }) => {
    await expect(scoped.findUniqueOrThrow({ where: { id: mine.id } })).resolves.toMatchObject({ id: mine.id });
    await expect(scoped.findUniqueOrThrow({ where: { id: theirs.id } })).rejects.toMatchObject({ code: "P2025" });
  },
  findFirst: async ({ scoped, mine, theirs }) => {
    expect(await scoped.findFirst()).toMatchObject({ id: mine.id });
    expect(await scoped.findFirst({ where: { id: theirs.id } })).toBeNull();
  },
  findFirstOrThrow: async ({ scoped, mine, theirs }) => {
    await expect(scoped.findFirstOrThrow()).resolves.toMatchObject({ id: mine.id });
    await expect(scoped.findFirstOrThrow({ where: { id: theirs.id } })).rejects.toMatchObject({ code: "P2025" });
  },
  findMany: async ({ scoped, mine }) => {
    expect(ids(await scoped.findMany())).toEqual([mine.id]);
  },
  count: async ({ scoped, theirs }) => {
    expect(await scoped.count()).toBe(1);
    expect(await scoped.count({ where: { id: theirs.id } })).toBe(0);
  },
  aggregate: async ({ scoped }) => {
    expect(await scoped.aggregate({ _count: { _all: true } })).toEqual({ _count: { _all: 1 } });
  },
  groupBy: async ({ scoped }) => {
    expect(await scoped.groupBy({ by: ["workspaceId"], _count: { _all: true } })).toEqual([
      { workspaceId: A, _count: { _all: 1 } },
    ]);
  },
  create: async ({ scoped, c }) => {
    expect(await scoped.create({ data: await c.data(A) })).toMatchObject({ workspaceId: A });
  },
  createMany: async ({ scoped, base, c }) => {
    expect(await scoped.createMany({ data: [await c.data(A), await c.data(A)] })).toEqual({ count: 2 });
    expect(await base.count({ where: { workspaceId: A } })).toBe(3);
  },
  createManyAndReturn: async ({ scoped, c }) => {
    const rows = (await scoped.createManyAndReturn({ data: [await c.data(A)] })) as Row[];
    expect(rows.map((r) => r.workspaceId)).toEqual([A]);
  },
  update: async ({ scoped, mine, theirs, c }) => {
    await expect(scoped.update({ where: { id: theirs.id }, data: c.patch })).rejects.toMatchObject({ code: "P2025" });
    await expect(scoped.update({ where: { id: mine.id }, data: c.patch })).resolves.toMatchObject(c.patch);
  },
  updateMany: async ({ scoped, c }) => {
    expect(await scoped.updateMany({ data: c.patch })).toEqual({ count: 1 });
  },
  updateManyAndReturn: async ({ scoped, mine, c }) => {
    expect(ids(await scoped.updateManyAndReturn({ data: c.patch }))).toEqual([mine.id]);
  },
  upsert: async ({ scoped, mine, theirs, c }) => {
    // Another workspace's id is "not found", so the upsert creates a new row
    // in the bound workspace instead of touching B's.
    const created = (await scoped.upsert({
      where: { id: theirs.id },
      create: await c.data(A),
      update: c.patch,
    })) as Row;
    expect(created.workspaceId).toBe(A);
    expect(created.id).not.toBe(theirs.id);

    await expect(
      scoped.upsert({ where: { id: mine.id }, create: await c.data(A), update: c.patch }),
    ).resolves.toMatchObject({ id: mine.id, ...c.patch });
  },
  delete: async ({ scoped, base, mine, theirs }) => {
    await expect(scoped.delete({ where: { id: theirs.id } })).rejects.toMatchObject({ code: "P2025" });
    await scoped.delete({ where: { id: mine.id } });
    expect(await base.count({ where: { id: mine.id } })).toBe(0);
  },
  deleteMany: async ({ scoped, base }) => {
    expect(await scoped.deleteMany()).toEqual({ count: 1 });
    expect(await base.count({ where: { workspaceId: A } })).toBe(0);
  },
};

describe("every TENANT model has a test case", () => {
  it("CASES covers TENANT_MODELS exactly", () => {
    expect(Object.keys(CASES).sort()).toEqual([...TENANT_MODELS].sort());
  });
});

describe.each(Object.entries(CASES))("%s through the scoped client", (model, c) => {
  let mine: Row;
  let theirs: Row;
  let theirsBefore: string;

  beforeEach(async () => {
    await resetDatabase();
    const base = delegateOf(prisma, lowerFirst(model));
    mine = (await base.create({ data: await c.data(A) })) as Row;
    theirs = (await base.create({ data: await c.data(B) })) as Row;
    theirsBefore = await rowsOf(B);
  });

  it.each(SCOPED_OPERATIONS)("%s stays inside workspace A and leaves B untouched", async (operation) => {
    await OPERATION_CHECKS[operation]({
      scoped: delegateOf(scopeToWorkspace(prisma, A), lowerFirst(model)),
      base: delegateOf(prisma, lowerFirst(model)),
      c,
      mine,
      theirs,
    });

    expect(await rowsOf(B)).toBe(theirsBefore);
  });
});

describe("operation coverage", () => {
  // Present on every runtime delegate but MongoDB-only; on SQLite they reach
  // the extension's default branch and must be refused there.
  const MONGO_ONLY = ["aggregateRaw", "findRaw"];

  it("handles exactly the operations the generated client types declare", () => {
    expectTypeOf<keyof Prisma.TypeMap["model"]["Company"]["operations"]>().toEqualTypeOf<ScopedOperation>();
  });

  it.each(TENANT_MODELS)("%s: every runtime operation is either handled or refused", async (model) => {
    await resetDatabase();
    const delegate = delegateOf(scopeToWorkspace(prisma, A), lowerFirst(model));
    const runtimeOperations = Object.keys(delegate)
      .filter((key) => typeof delegate[key] === "function")
      .sort();

    expect(runtimeOperations).toEqual([...SCOPED_OPERATIONS, ...MONGO_ONLY].sort());
    for (const operation of MONGO_ONLY) {
      await expect(delegate[operation]({})).rejects.toThrow(TenancyViolation);
    }
  });
});

describe("global models", () => {
  beforeEach(resetDatabase);

  it.each([
    ["user.findMany", (db: ScopedDb) => db.user.findMany()],
    ["user.findUnique", (db: ScopedDb) => db.user.findUnique({ where: { id: owner.id } })],
    ["user.update", (db: ScopedDb) => db.user.update({ where: { id: owner.id }, data: { name: "Hijacked" } })],
    ["session.findMany", (db: ScopedDb) => db.session.findMany()],
    ["session.deleteMany", (db: ScopedDb) => db.session.deleteMany()],
    ["workspace.findMany", (db: ScopedDb) => db.workspace.findMany()],
    ["workspace.update", (db: ScopedDb) => db.workspace.update({ where: { id: B }, data: { plan: "PAID" } })],
    ["workspace.create", (db: ScopedDb) => db.workspace.create({ data: { name: "C", slug: "c" } })],
  ])("%s throws and changes nothing", async (_name, call) => {
    await expect(call(scopeToWorkspace(prisma, A))).rejects.toThrow(TenancyViolation);

    expect((await prisma.user.findUniqueOrThrow({ where: { id: owner.id } })).name).toBe(owner.name);
    expect(await prisma.workspace.findMany({ orderBy: { id: "asc" }, select: { id: true, plan: true } })).toEqual([
      { id: A, plan: "FREE" },
      { id: B, plan: "FREE" },
    ]);
  });
});

describe("raw SQL", () => {
  beforeEach(resetDatabase);

  it.each([
    ["$queryRaw", (db: ScopedDb) => db.$queryRaw`SELECT * FROM "Company"`],
    ["$executeRaw", (db: ScopedDb) => db.$executeRaw`DELETE FROM "Company"`],
    ["$queryRawUnsafe", (db: ScopedDb) => db.$queryRawUnsafe('SELECT * FROM "Company"')],
    ["$executeRawUnsafe", (db: ScopedDb) => db.$executeRawUnsafe('DELETE FROM "Company"')],
  ])("%s throws and runs nothing", async (_name, call) => {
    await prisma.company.create({ data: { name: "B's", ownerId: owner.id, workspaceId: B } });

    await expect(call(scopeToWorkspace(prisma, A))).rejects.toThrow(TenancyViolation);
    expect(await prisma.company.count()).toBe(1);
  });

  it("throws inside an interactive transaction too", async () => {
    const db = scopeToWorkspace(prisma, A);

    await expect(db.$transaction((tx) => tx.$executeRawUnsafe('DELETE FROM "Company"'))).rejects.toThrow(
      TenancyViolation,
    );
  });
});

describe("nested relation writes", () => {
  let mineCompany: { id: string };
  let mineContact: { id: string };
  let theirCompany: { id: string };
  let theirContact: { id: string };
  let before: { a: string; b: string };

  beforeEach(async () => {
    await resetDatabase();
    mineCompany = await prisma.company.create({ data: { name: "A co", ownerId: owner.id, workspaceId: A } });
    mineContact = await prisma.contact.create({
      data: { firstName: "A", lastName: "One", ownerId: owner.id, companyId: mineCompany.id, workspaceId: A },
    });
    theirCompany = await prisma.company.create({ data: { name: "B co", ownerId: owner.id, workspaceId: B } });
    theirContact = await prisma.contact.create({
      data: { firstName: "B", lastName: "One", ownerId: owner.id, companyId: theirCompany.id, workspaceId: B },
    });
    before = { a: await rowsOf(A), b: await rowsOf(B) };
  });

  const contactData = () => ({ firstName: "N", lastName: "New", ownerId: owner.id, workspaceId: A });

  it.each([
    ["create with connect", (db: Client) => db.contact.create({ data: { ...contactData(), company: { connect: { id: theirCompany.id } } } })],
    ["create with nested create", (db: Client) => db.contact.create({ data: { ...contactData(), company: { create: { name: "X", ownerId: owner.id, workspaceId: B } } } })],
    ["create with connectOrCreate", (db: Client) => db.contact.create({ data: { ...contactData(), company: { connectOrCreate: { where: { id: theirCompany.id }, create: { name: "X", ownerId: owner.id } } } } })],
    ["update with connect", (db: Client) => db.company.update({ where: { id: mineCompany.id }, data: { contacts: { connect: { id: theirContact.id } } } })],
    ["update with set", (db: Client) => db.company.update({ where: { id: mineCompany.id }, data: { contacts: { set: [{ id: theirContact.id }] } } })],
    ["update with disconnect", (db: Client) => db.company.update({ where: { id: mineCompany.id }, data: { contacts: { disconnect: { id: mineContact.id } } } })],
    ["update with nested update", (db: Client) => db.company.update({ where: { id: mineCompany.id }, data: { contacts: { update: { where: { id: theirContact.id }, data: { firstName: "Hijacked" } } } } })],
    ["update with nested upsert", (db: Client) => db.company.update({ where: { id: mineCompany.id }, data: { contacts: { upsert: { where: { id: theirContact.id }, create: { firstName: "N", lastName: "N", ownerId: owner.id }, update: { firstName: "Hijacked" } } } } })],
    ["update with nested createMany", (db: Client) => db.company.update({ where: { id: mineCompany.id }, data: { contacts: { createMany: { data: [{ firstName: "N", lastName: "N", ownerId: owner.id, workspaceId: B }] } } } })],
    ["update with nested delete", (db: Client) => db.contact.update({ where: { id: mineContact.id }, data: { company: { delete: true } } })],
    ["update with nested deleteMany", (db: Client) => db.company.update({ where: { id: mineCompany.id }, data: { contacts: { deleteMany: {} } } })],
    ["updateMany with a relation key", (db: Client) => db.contact.updateMany({ data: { company: { disconnect: true } } })],
    ["upsert create with connect", (db: Client) => db.contact.upsert({ where: { id: "missing" }, create: { ...contactData(), company: { connect: { id: theirCompany.id } } }, update: {} })],
    ["upsert update with connect", (db: Client) => db.contact.upsert({ where: { id: mineContact.id }, create: contactData(), update: { company: { connect: { id: theirCompany.id } } } })],
    ["createMany element with connect", (db: Client) => db.contact.createMany({ data: [contactData(), { ...contactData(), company: { connect: { id: theirCompany.id } } }] })],
  ])("%s throws and writes nothing", async (_name, call) => {
    const db = scopeToWorkspace(prisma, A) as unknown as Client;

    await expect(call(db)).rejects.toThrow(TenancyViolation);
    expect(await rowsOf(A)).toBe(before.a);
    expect(await rowsOf(B)).toBe(before.b);
  });
});

describe("workspaceId can never change", () => {
  let mine: { id: string };

  beforeEach(async () => {
    await resetDatabase();
    mine = await prisma.company.create({ data: { name: "A co", ownerId: owner.id, workspaceId: A } });
  });

  it.each([
    ["update to another workspace", (db: Delegate) => db.update({ where: { id: mine.id }, data: { workspaceId: B } })],
    ["update to the same workspace", (db: Delegate) => db.update({ where: { id: mine.id }, data: { workspaceId: A } })],
    ["update to null", (db: Delegate) => db.update({ where: { id: mine.id }, data: { workspaceId: null } })],
    ["updateMany", (db: Delegate) => db.updateMany({ data: { workspaceId: B } })],
    ["updateManyAndReturn", (db: Delegate) => db.updateManyAndReturn({ data: { workspaceId: B } })],
    ["upsert's update", (db: Delegate) => db.upsert({ where: { id: mine.id }, create: { name: "x", ownerId: owner.id, workspaceId: A }, update: { workspaceId: B } })],
  ])("%s throws", async (_name, call) => {
    await expect(call(delegateOf(scopeToWorkspace(prisma, A), "company"))).rejects.toThrow(TenancyViolation);

    expect(await prisma.company.findUniqueOrThrow({ where: { id: mine.id } })).toMatchObject({ workspaceId: A });
  });
});

describe("creates are verified, never stamped", () => {
  beforeEach(resetDatabase);

  const company = (extra: Record<string, unknown>) => ({ name: "New", ownerId: owner.id, ...extra });

  it.each([
    ["create without workspaceId", (db: Delegate) => db.create({ data: company({}) })],
    ["create for another workspace", (db: Delegate) => db.create({ data: company({ workspaceId: B }) })],
    ["create with a null workspaceId", (db: Delegate) => db.create({ data: company({ workspaceId: null }) })],
    ["createMany with one bad element", (db: Delegate) => db.createMany({ data: [company({ workspaceId: A }), company({ workspaceId: B })] })],
    ["createMany with a single object", (db: Delegate) => db.createMany({ data: company({}) })],
    ["createManyAndReturn with one bad element", (db: Delegate) => db.createManyAndReturn({ data: [company({ workspaceId: A }), company({})] })],
    ["upsert's create for another workspace", (db: Delegate) => db.upsert({ where: { id: "missing" }, create: company({ workspaceId: B }), update: {} })],
  ])("%s throws and creates nothing", async (_name, call) => {
    await expect(call(delegateOf(scopeToWorkspace(prisma, A), "company"))).rejects.toThrow(TenancyViolation);

    expect(await prisma.company.count()).toBe(0);
  });

  it("accepts createMany with a single object for the bound workspace", async () => {
    const db = delegateOf(scopeToWorkspace(prisma, A), "company");

    expect(await db.createMany({ data: company({ workspaceId: A }) })).toEqual({ count: 1 });
  });
});

describe("where scoping keeps the caller's filter and cannot be widened", () => {
  let mine: { id: string };
  let theirs: { id: string };

  beforeEach(async () => {
    await resetDatabase();
    mine = await prisma.company.create({ data: { name: "Same", ownerId: owner.id, workspaceId: A } });
    theirs = await prisma.company.create({ data: { name: "Same", ownerId: owner.id, workspaceId: B } });
  });

  it("keeps an AND written as an array or an object", async () => {
    const db = scopeToWorkspace(prisma, A);

    expect(ids(await db.company.findMany({ where: { AND: [{ name: "Same" }] } }))).toEqual([mine.id]);
    expect(ids(await db.company.findMany({ where: { AND: { name: "Same" } } }))).toEqual([mine.id]);
    expect(await db.company.findMany({ where: { AND: { name: "Other" } } })).toEqual([]);
  });

  it("ignores a caller's attempt to name another workspace", async () => {
    const db = scopeToWorkspace(prisma, A);

    expect(await db.company.findMany({ where: { workspaceId: B } })).toEqual([]);
    expect(ids(await db.company.findMany({ where: { OR: [{ id: mine.id }, { id: theirs.id }] } }))).toEqual([mine.id]);
    expect(await db.company.findUnique({ where: { id: theirs.id, workspaceId: B } })).toBeNull();
  });

  it("finds by a composite unique key only inside the bound workspace", async () => {
    const user = await newUser();
    await prisma.membership.create({ data: { workspaceId: B, userId: user.id, role: "MEMBER" } });
    const db = scopeToWorkspace(prisma, A);

    expect(
      await db.membership.findUnique({ where: { workspaceId_userId: { workspaceId: B, userId: user.id } } }),
    ).toBeNull();
    expect(await db.membership.findUnique({ where: { userId: user.id } })).toBeNull();
  });

  it("refuses cursor pagination", async () => {
    const db = scopeToWorkspace(prisma, A);

    await expect(db.company.findMany({ cursor: { id: theirs.id } })).rejects.toThrow(TenancyViolation);
  });
});

describe("nested reads of global rows still work", () => {
  let mine: { id: string };
  let theirs: { id: string };

  beforeEach(async () => {
    await resetDatabase();
    mine = await prisma.company.create({ data: { name: "A co", ownerId: owner.id, workspaceId: A } });
    theirs = await prisma.company.create({ data: { name: "B co", ownerId: owner.id, workspaceId: B } });
    await prisma.membership.create({ data: { workspaceId: A, userId: owner.id, role: "OWNER" } });
  });

  it("includes a record's owner", async () => {
    const rows = await scopeToWorkspace(prisma, A).company.findMany({
      include: { owner: { select: { name: true } } },
    });

    expect(rows.map((r) => [r.id, r.owner.name])).toEqual([[mine.id, owner.name]]);
  });

  it("includes a membership's user (the Settings roster shape)", async () => {
    const rows = await scopeToWorkspace(prisma, A).membership.findMany({
      include: { user: { select: { id: true, name: true, email: true } } },
    });

    expect(rows.map((r) => r.user.id)).toEqual([owner.id]);
  });

  it("follows the fluent API from a scoped parent", async () => {
    const db = scopeToWorkspace(prisma, A);

    expect(await db.company.findUnique({ where: { id: mine.id } }).owner()).toMatchObject({ id: owner.id });
    expect(await db.company.findUnique({ where: { id: theirs.id } }).owner()).toBeNull();
  });

  it("counts related rows with _count", async () => {
    const row = await scopeToWorkspace(prisma, A).company.findUniqueOrThrow({
      where: { id: mine.id },
      select: { _count: { select: { contacts: true } } },
    });

    expect(row._count.contacts).toBe(0);
  });
});

describe("transactions", () => {
  let theirs: { id: string };

  beforeEach(async () => {
    await resetDatabase();
    await prisma.company.create({ data: { name: "A co", ownerId: owner.id, workspaceId: A } });
    theirs = await prisma.company.create({ data: { name: "B co", ownerId: owner.id, workspaceId: B } });
  });

  it("scopes every query made through an interactive transaction's tx", async () => {
    const db = scopeToWorkspace(prisma, A);

    const [count, foreign] = await db.$transaction(async (tx) => [
      await tx.company.count(),
      await tx.company.findUnique({ where: { id: theirs.id } }),
    ]);

    expect(count).toBe(1);
    expect(foreign).toBeNull();
    await expect(db.$transaction((tx) => tx.user.findMany())).rejects.toThrow(TenancyViolation);
  });

  it("scopes a batch transaction", async () => {
    const db = scopeToWorkspace(prisma, A);

    const [count, foreign] = await db.$transaction([
      db.company.count(),
      db.company.findUnique({ where: { id: theirs.id } }),
    ]);

    expect(count).toBe(1);
    expect(foreign).toBeNull();
  });
});

describe("construction", () => {
  it("refuses an empty workspace id", () => {
    expect(() => scopeToWorkspace(prisma, "")).toThrow(TenancyViolation);
  });

  it("names its errors", () => {
    expect(new TenancyViolation("x").name).toBe("TenancyViolation");
  });
});
