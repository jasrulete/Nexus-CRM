import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { aiProviderName, generateJson, generateText } from "./provider";

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
  // The result says *why* it failed: the panel used to label "no key" and
  // "every provider down" with the same words.
  it.each([
    ["a request timeout", Object.assign(new Error("timed out"), { name: "TimeoutError" })],
    ["a network error", new TypeError("fetch failed")],
  ])("reports an error when the provider fails with %s", async (_label, error) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("GEMINI_API_KEY", "test-key");
    vi.stubEnv("GROQ_API_KEY", "");
    vi.spyOn(globalThis, "fetch").mockRejectedValue(error);

    await expect(generateText("prompt")).resolves.toEqual({ ok: false, reason: "error" });
  });

  it("reports a rate limit rather than throwing when the provider answers 429", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("rate limited", { status: 429 }),
    );

    await expect(generateText("prompt")).resolves.toEqual({ ok: false, reason: "rate_limited" });
  });

  it("reports an error, not a rate limit, on a non-429 error status", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "test-key");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("boom", { status: 500 }));

    await expect(generateText("prompt")).resolves.toEqual({ ok: false, reason: "error" });
  });

  it("reports not_configured without calling out when no key is set", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await expect(generateText("prompt")).resolves.toEqual({ ok: false, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

// Gemini's free tier is rate-limited per day, so a 429 from it is the expected
// steady state in production — observed live. With both keys set, the second one
// has to actually be tried, or it is a fallback in name only.
describe("generateText failover", () => {
  const GEMINI_HOST = "generativelanguage.googleapis.com";
  const GROQ_DEFAULT_MODEL = "openai/gpt-oss-120b";

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
  /**
   * Routes fetch by host so each provider can be scripted independently.
   * Exact hostname, not a substring: CodeQL flags `includes(host)` as an
   * incomplete URL check, and it is right — even in a test.
   */
  function routeFetch(handlers: { gemini: Answer; groq: Answer }) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new URL(url).hostname === GEMINI_HOST ? handlers.gemini() : handlers.groq();
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
      ok: true,
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

    await expect(generateText("prompt")).resolves.toMatchObject({ ok: true, text: "from groq" });
  });

  it("tries groq when gemini answers OK but with no text", async () => {
    // What a safety-filtered Gemini response looks like: 200, no candidates.
    routeFetch({
      gemini: () => json({ candidates: [] }),
      groq: () => groqReply("from groq"),
    });

    await expect(generateText("prompt")).resolves.toMatchObject({ ok: true, text: "from groq" });
  });

  it("reports rate_limited only after every configured provider was rate-limited", async () => {
    const fetchSpy = routeFetch({
      gemini: () => new Response("quota exceeded", { status: 429 }),
      groq: () => new Response("rate limited", { status: 429 }),
    });

    await expect(generateText("prompt")).resolves.toEqual({ ok: false, reason: "rate_limited" });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  // A quota on one provider and an outage on the other is degradation, not a
  // rate limit: the label should not tell the user to wait for a quota reset.
  it("reports error when the failures were mixed", async () => {
    routeFetch({
      gemini: () => new Response("quota exceeded", { status: 429 }),
      groq: () => new Response("boom", { status: 500 }),
    });

    await expect(generateText("prompt")).resolves.toEqual({ ok: false, reason: "error" });
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

  // The rolling "-latest" alias answered 503 "high demand" for hours on
  // 2026-09-06 while the current model name answered every time, and Google's
  // own 404 for retired names points at this one. A pinned current name it is.
  it("uses gemini-3.6-flash when AI_MODEL is unset", async () => {
    const fetchSpy = routeFetch({
      gemini: () => geminiReply("from gemini"),
      groq: () => groqReply("unused"),
    });

    await generateText("prompt");

    expect(String(fetchSpy.mock.calls[0][0])).toContain("/models/gemini-3.6-flash:generateContent");
  });

  it("does not call groq when gemini succeeds", async () => {
    const fetchSpy = routeFetch({
      gemini: () => geminiReply("from gemini"),
      groq: () => groqReply("from groq"),
    });

    await expect(generateText("prompt")).resolves.toMatchObject({ ok: true, text: "from gemini" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  // Free-text features (summary, draft) must not be forced into JSON mode: a
  // vendor asked for JSON returns JSON, and the panel would print braces.
  it("does not ask either vendor for JSON", async () => {
    const fetchSpy = routeFetch({
      gemini: () => new Response("quota exceeded", { status: 429 }),
      groq: () => groqReply("from groq"),
    });

    await generateText("prompt");

    const [geminiCall, groqCall] = fetchSpy.mock.calls;
    const geminiBody = JSON.parse(String((geminiCall[1] as RequestInit).body)) as {
      generationConfig: Record<string, unknown>;
    };
    const groqBody = JSON.parse(String((groqCall[1] as RequestInit).body)) as Record<string, unknown>;
    expect(geminiBody.generationConfig).not.toHaveProperty("responseMimeType");
    expect(geminiBody.generationConfig).not.toHaveProperty("responseJsonSchema");
    expect(groqBody).not.toHaveProperty("response_format");
  });

  // "Every attempt was a 429" is the rule, not "the last one was": a provider
  // outage followed by a quota hit is degradation, and the order must not matter.
  it("reports error when an outage precedes a rate limit", async () => {
    routeFetch({
      gemini: () => new Response("boom", { status: 500 }),
      groq: () => new Response("rate limited", { status: 429 }),
    });

    await expect(generateText("prompt")).resolves.toEqual({ ok: false, reason: "error" });
  });
});

// Lead scoring used to pull the first {...} out of whatever the model said with
// a regex. Both vendors can be asked for JSON natively; the reply is then
// parsed whole and validated, and a reply that fails is a reason of its own.
describe("generateJson", () => {
  const GEMINI_HOST = "generativelanguage.googleapis.com";
  const schema = z.object({
    score: z.number().min(0).max(100).transform(Math.round),
    reason: z.string().transform((r) => r.slice(0, 500)),
  });
  const jsonSchema = {
    type: "object",
    properties: {
      score: { type: "integer", minimum: 0, maximum: 100 },
      reason: { type: "string" },
    },
    required: ["score", "reason"],
  };
  const request = { schema, jsonSchema };

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
  function routeFetch(handlers: { gemini: Answer; groq: Answer }) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new URL(url).hostname === GEMINI_HOST ? handlers.gemini() : handlers.groq();
    });
  }
  function body(call: unknown[]): Record<string, unknown> {
    return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
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

  it("asks gemini for JSON natively, with the schema", async () => {
    const fetchSpy = routeFetch({
      gemini: () => geminiReply('{"score": 82, "reason": "strong pipeline"}'),
      groq: () => groqReply("unused"),
    });

    await generateJson("prompt", request);

    const sent = body(fetchSpy.mock.calls[0]).generationConfig as Record<string, unknown>;
    expect(sent.responseMimeType).toBe("application/json");
    expect(sent.responseJsonSchema).toEqual(jsonSchema);
  });

  it("asks groq for JSON mode", async () => {
    const fetchSpy = routeFetch({
      gemini: () => new Response("quota exceeded", { status: 429 }),
      groq: () => groqReply('{"score": 82, "reason": "strong pipeline"}'),
    });

    await generateJson("prompt", request);

    const groqCall = fetchSpy.mock.calls[1];
    expect(body(groqCall).response_format).toEqual({ type: "json_object" });
  });

  // gpt-oss-120b reasons before it answers, and the reasoning is spent from
  // the same completion budget as the answer. A score, a short summary or a
  // brief email needs none of it: at higher effort a 1024-token cap can be
  // consumed by thinking, leaving `content` empty, which the chain would
  // report as a provider error.
  it("asks groq for low reasoning effort so the answer is not spent on thinking", async () => {
    const fetchSpy = routeFetch({
      gemini: () => new Response("quota exceeded", { status: 429 }),
      groq: () => groqReply('{"score": 82, "reason": "strong pipeline"}'),
    });

    await generateJson("prompt", request);

    expect(body(fetchSpy.mock.calls[1]).reasoning_effort).toBe("low");
  });

  it("parses and validates the reply, applying the schema transforms", async () => {
    routeFetch({
      gemini: () => geminiReply('{"score": 71.6, "reason": "' + "x".repeat(900) + '"}'),
      groq: () => groqReply("unused"),
    });

    const result = await generateJson("prompt", request);

    expect(result).toMatchObject({ ok: true, provider: "gemini/gemini-3.6-flash" });
    if (result.ok) {
      expect(result.data.score).toBe(72);
      expect(result.data.reason).toHaveLength(500);
    }
  });

  it.each([
    ["prose with no JSON at all", "I could not score this contact."],
    // The old regex would have pulled the object out of this one.
    ["prose that merely contains JSON", 'Sure! {"score": 82, "reason": "hot"} — hope this helps.'],
    ["a score above the range", '{"score": 250, "reason": "very hot"}'],
    ["a non-numeric score", '{"score": "eighty", "reason": "hot"}'],
    ["a missing reason", '{"score": 80}'],
  ])("moves to the next provider on %s and reports malformed when every reply was", async (_label, text) => {
    const fetchSpy = routeFetch({
      gemini: () => geminiReply(text),
      groq: () => groqReply(text),
    });

    await expect(generateJson("prompt", request)).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("uses the next provider when the first reply was malformed", async () => {
    routeFetch({
      gemini: () => geminiReply("Sure! I would rate this contact highly."),
      groq: () => groqReply('{"score": 64, "reason": "steady engagement"}'),
    });

    await expect(generateJson("prompt", request)).resolves.toMatchObject({
      ok: true,
      data: { score: 64, reason: "steady engagement" },
      provider: "groq/openai/gpt-oss-120b",
    });
  });

  // The reason is order-independent: an error anywhere is an error, otherwise
  // a reply that arrived but was unusable names the failure, and only a chain
  // where every attempt was a 429 is a rate limit.
  it.each([
    ["malformed then 429 as malformed", "malformed", 429, "malformed"],
    ["429 then malformed as malformed", 429, "malformed", "malformed"],
    ["malformed then 500 as error", "malformed", 500, "error"],
    ["500 then malformed as error", 500, "malformed", "error"],
  ] as const)("reports %s", async (_label, first, second, expected) => {
    const answer = (what: "malformed" | 429 | 500, vendor: "gemini" | "groq") =>
      what === "malformed"
        ? vendor === "gemini"
          ? geminiReply("I would rather not.")
          : groqReply("I would rather not.")
        : new Response("nope", { status: what });
    routeFetch({ gemini: () => answer(first, "gemini"), groq: () => answer(second, "groq") });

    await expect(generateJson("prompt", request)).resolves.toEqual({
      ok: false,
      reason: expected,
    });
  });

  // Groq's JSON mode does not return invalid JSON as a 200: when the model
  // fails to produce an object the API answers 400 json_validate_failed.
  // That is a reply that was not usable, not a provider error.
  it("treats groq's json_validate_failed 400 as a malformed reply", async () => {
    routeFetch({
      gemini: () => new Response("quota exceeded", { status: 429 }),
      groq: () =>
        new Response(
          JSON.stringify({ error: { code: "json_validate_failed", failed_generation: "Sure!" } }),
          { status: 400, headers: { "Content-Type": "application/json" } },
        ),
    });

    await expect(generateJson("prompt", request)).resolves.toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("still distinguishes an all-429 chain from a malformed one", async () => {
    routeFetch({
      gemini: () => new Response("quota exceeded", { status: 429 }),
      groq: () => new Response("rate limited", { status: 429 }),
    });

    await expect(generateJson("prompt", request)).resolves.toEqual({
      ok: false,
      reason: "rate_limited",
    });
  });

  it("reports not_configured with no key", async () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    vi.stubEnv("GROQ_API_KEY", "");

    await expect(generateJson("prompt", request)).resolves.toEqual({
      ok: false,
      reason: "not_configured",
    });
  });
});
