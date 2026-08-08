import { afterEach, describe, expect, it, vi } from "vitest";

import { emailConfigured, sendEmail, splitDraft } from "./email";

const saved = { ...process.env };

afterEach(() => {
  process.env = { ...saved };
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function configure() {
  process.env.RESEND_API_KEY = "re_test";
  process.env.EMAIL_FROM = "demo@example.com";
}

describe("emailConfigured", () => {
  it("needs both the key and the from address", () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    expect(emailConfigured()).toBe(false);

    process.env.RESEND_API_KEY = "re_test";
    expect(emailConfigured()).toBe(false);

    process.env.EMAIL_FROM = "demo@example.com";
    expect(emailConfigured()).toBe(true);
  });
});

describe("sendEmail", () => {
  it("does not call the API when unconfigured", async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    // A clone with no Resend account must still run, not throw.
    expect(await sendEmail({ to: "a@b.co", subject: "s", text: "t" })).toEqual({
      sent: false,
      reason: "not-configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the expected payload to Resend", async () => {
    configure();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    expect(
      await sendEmail({ to: "me@example.com", subject: "Hi", text: "Body" }),
    ).toEqual({ sent: true });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test");
    expect(JSON.parse(init.body)).toEqual({
      from: "demo@example.com",
      to: ["me@example.com"],
      subject: "Hi",
      text: "Body",
    });
  });

  it("surfaces the provider's refusal instead of throwing", async () => {
    configure();
    // Resend rejects unverified domains and the free tier's non-owner
    // recipients this way; the caller needs the reason, not a crash.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, text: async () => "domain not verified" }),
    );

    const r = await sendEmail({ to: "a@b.co", subject: "s", text: "t" });
    expect(r).toEqual({ sent: false, reason: "failed", detail: "domain not verified" });
  });

  it("treats a network error as a failure, not an exception", async () => {
    configure();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));

    const r = await sendEmail({ to: "a@b.co", subject: "s", text: "t" });
    expect(r.sent).toBe(false);
  });
});

describe("splitDraft", () => {
  it("splits the Subject line from the body", () => {
    expect(splitDraft("Subject: Catching up\n\nHi Maya,\nHope you are well.")).toEqual({
      subject: "Catching up",
      body: "Hi Maya,\nHope you are well.",
    });
  });

  it("falls back when the model omits a subject", () => {
    // The heuristic fallback and a stray model response both hit this path.
    expect(splitDraft("Hi Maya, just checking in.")).toEqual({
      subject: "Following up",
      body: "Hi Maya, just checking in.",
    });
  });
});
