import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiProviderName, extractJson, generateText } from "./provider";

describe("extractJson", () => {
  it("parses a clean JSON object", () => {
    expect(extractJson('{"score": 82, "reason": "strong pipeline"}')).toEqual({
      score: 82,
      reason: "strong pipeline",
    });
  });

  it("parses JSON wrapped in a markdown code fence", () => {
    const reply = '```json\n{"score": 55, "reason": "ok"}\n```';
    expect(extractJson(reply)).toEqual({ score: 55, reason: "ok" });
  });

  it("parses JSON buried in prose, including nested objects", () => {
    const reply =
      'Sure! Here is the result: {"summary": {"deals": 2}, "score": 70} — hope that helps.';
    expect(extractJson(reply)).toEqual({ summary: { deals: 2 }, score: 70 });
  });

  it("returns null for malformed JSON", () => {
    expect(extractJson("{score: not-valid}")).toBeNull();
  });

  it("returns null when there is no JSON object at all", () => {
    expect(extractJson("I could not produce a score.")).toBeNull();
  });
});

describe("aiProviderName", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("prefers gemini when its key is set", () => {
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "also-set");
    expect(aiProviderName()).toBe("gemini");
  });

  it("falls back to groq when only that key is set", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "test-key");
    expect(aiProviderName()).toBe("groq");
  });

  it("reports no provider when neither key is set", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    expect(aiProviderName()).toBeNull();
  });
});

describe("generateText", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  // A provider that never answers is the likeliest production failure, and it
  // has to reach the heuristic fallback rather than the page error boundary.
  it.each([
    ["a request timeout", Object.assign(new Error("timed out"), { name: "TimeoutError" })],
    ["a network error", new TypeError("fetch failed")],
  ])("returns null when the provider fails with %s", async (_label, error) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(error);

    await expect(generateText("prompt")).resolves.toBeNull();
  });

  it("returns null rather than throwing when the provider answers with an error status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );

    await expect(generateText("prompt")).resolves.toBeNull();
  });

  it("returns null without calling out when no key is configured", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(generateText("prompt")).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// Gemini's free tier is rate-limited per day, so a 429 from it is the expected
// steady state in production — observed live. With both keys set, the second one
// has to actually be tried, or it is a fallback in name only.
describe("generateText failover", () => {
  const GEMINI_HOST = "generativelanguage.googleapis.com";
  const GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile";

  function json(body: unknown) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  const geminiReply = (text: string) =>
    json({ candidates: [{ content: { parts: [{ text }] } }] });
  const groqReply = (text: string) => json({ choices: [{ message: { content: text } }] });

  type Answer = () => Response | Promise<Response>;
  /** Routes fetch by host so each provider can be scripted independently. */
  function routeFetch(handlers: { gemini: Answer; groq: Answer }) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return url.includes(GEMINI_HOST) ? handlers.gemini() : handlers.groq();
    });
  }
  function requestedModel(call: unknown[]): string {
    const init = call[1] as RequestInit;
    return (JSON.parse(String(init.body)) as { model: string }).model;
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("GEMINI_API_KEY", "gemini-key");
    vi.stubEnv("GROQ_API_KEY", "groq-key");
    vi.stubEnv("AI_MODEL", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("tries groq when gemini answers with an error status", async () => {
    const fetchSpy = routeFetch({
      gemini: () => new Response("quota exceeded", { status: 429 }),
      groq: () => groqReply("from groq"),
    });

    await expect(generateText("prompt")).resolves.toEqual({
      text: "from groq",
      provider: `groq/${GROQ_DEFAULT_MODEL}`,
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("tries groq when the gemini request itself fails", async () => {
    routeFetch({
      gemini: () => Promise.reject(new TypeError("fetch failed")),
      groq: () => groqReply("from groq"),
    });

    await expect(generateText("prompt")).resolves.toMatchObject({ text: "from groq" });
  });

  it("tries groq when gemini answers OK but with no text", async () => {
    // What a safety-filtered Gemini response looks like: 200, no candidates.
    routeFetch({
      gemini: () => json({ candidates: [] }),
      groq: () => groqReply("from groq"),
    });

    await expect(generateText("prompt")).resolves.toMatchObject({ text: "from groq" });
  });

  it("returns null only after every configured provider has failed", async () => {
    const fetchSpy = routeFetch({
      gemini: () => new Response("quota exceeded", { status: 429 }),
      groq: () => new Response("rate limited", { status: 429 }),
    });

    await expect(generateText("prompt")).resolves.toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // AI_MODEL is one variable shared by both providers. A Gemini model name sent
  // to Groq is a 404, which would turn a working fallback into a second failure.
  it("applies the AI_MODEL override to the primary provider only", async () => {
    vi.stubEnv("AI_MODEL", "gemini-2.5-pro");
    const fetchSpy = routeFetch({
      gemini: () => new Response("quota exceeded", { status: 429 }),
      groq: () => groqReply("from groq"),
    });

    await expect(generateText("prompt")).resolves.toMatchObject({
      provider: `groq/${GROQ_DEFAULT_MODEL}`,
    });
    const [geminiCall, groqCall] = fetchSpy.mock.calls;
    expect(String(geminiCall[0])).toContain("gemini-2.5-pro");
    expect(requestedModel(groqCall)).toBe(GROQ_DEFAULT_MODEL);
  });

  it("does not call groq when gemini succeeds", async () => {
    const fetchSpy = routeFetch({
      gemini: () => geminiReply("from gemini"),
      groq: () => groqReply("from groq"),
    });

    await expect(generateText("prompt")).resolves.toMatchObject({ text: "from gemini" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
