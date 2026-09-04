import { afterEach, describe, expect, it, vi } from "vitest";

const created = vi.hoisted(() => ({ calls: [] as unknown[], fail: false }));

vi.mock("@/lib/db", () => ({
  prisma: {
    auditLog: {
      create: async (args: unknown) => {
        if (created.fail) throw new Error("database is gone");
        created.calls.push(args);
      },
    },
  },
}));

const captureException = vi.hoisted(() => vi.fn());
vi.mock("@sentry/nextjs", () => ({ captureException }));

const { audit } = await import("./audit");

afterEach(() => {
  created.calls = [];
  created.fail = false;
  captureException.mockClear();
  vi.restoreAllMocks();
});

const entry = {
  action: "contact.update",
  entityType: "contact",
  entityId: "c1",
  userId: "u1",
  metadata: { statusFrom: "LEAD", statusTo: "CUSTOMER" },
};

describe("audit without a transaction client", () => {
  it("serialises metadata to JSON and normalises a missing userId to null", async () => {
    await audit({ action: "auth.login_failed", entityType: "user", entityId: "a@b.c" });

    expect(created.calls[0]).toEqual({
      data: {
        action: "auth.login_failed",
        entityType: "user",
        entityId: "a@b.c",
        userId: null,
        metadata: null,
      },
    });
  });

  it("writes metadata as a JSON string", async () => {
    await audit(entry);

    const data = (created.calls[0] as { data: { metadata: string } }).data;
    expect(JSON.parse(data.metadata)).toEqual({
      statusFrom: "LEAD",
      statusTo: "CUSTOMER",
    });
  });

  it("never throws — the action it records has already committed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    created.fail = true;

    await expect(audit(entry)).resolves.toBeUndefined();
  });

  it("reports a swallowed failure to Sentry", async () => {
    // The regression: failures went to console.error only, which
    // `onRequestError` never sees — so a gap in the log was invisible and
    // absence of an entry proved nothing.
    vi.spyOn(console, "error").mockImplementation(() => {});
    created.fail = true;

    await audit(entry);

    expect(captureException).toHaveBeenCalledTimes(1);
    const [, context] = captureException.mock.calls[0];
    expect(context.tags.subsystem).toBe("audit");
    expect(context.extra.action).toBe("contact.update");
  });
});

describe("audit with a transaction client", () => {
  it("writes through the client it was given, not the global one", async () => {
    const tx = { auditLog: { create: vi.fn(async () => undefined) } };

    await audit(entry, tx);

    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(created.calls).toHaveLength(0);
  });

  it("propagates a failure so the caller's transaction rolls back", async () => {
    // The whole point of the transactional mode: a state change that committed
    // without its entry would make the log quietly incomplete, and the Settings
    // page presents that log as the record of what happened.
    const tx = {
      auditLog: {
        create: vi.fn(async () => {
          throw new Error("constraint violation");
        }),
      },
    };

    await expect(audit(entry, tx)).rejects.toThrow(/constraint violation/);
    expect(captureException).not.toHaveBeenCalled();
  });
});
