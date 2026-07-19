import { afterEach, describe, expect, it, vi } from "vitest";
import { aiProviderName, extractJson } from "./provider";

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
