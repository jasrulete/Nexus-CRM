import { describe, expect, it } from "vitest";

import { classify, isUnreachable, signalFailure } from "./outcome";

/**
 * The rule this file pins down: a live evaluation run is red when the *model*
 * answered badly, and not when the *provider* was unreachable. Before this,
 * both landed as the same assertion failure, so a nightly that went red for a
 * Google 503 looked exactly like one that caught a real regression.
 */

const answered = { ok: true, provider: "gemini/gemini-3.6-flash" } as const;
const heuristic = (degraded: string) => ({ ok: true, provider: "heuristic", degraded });

describe("isUnreachable", () => {
  it.each(["error", "rate_limited"])("treats %s as the provider being unreachable", (reason) => {
    expect(isUnreachable(reason)).toBe(true);
  });

  it.each(["malformed", "not_configured", undefined])("does not treat %s as unreachable", (reason) => {
    expect(isUnreachable(reason)).toBe(false);
  });
});

describe("signalFailure", () => {
  const counts = (over: Partial<Parameters<typeof signalFailure>[0]> = {}) => ({
    answered: 18,
    unreachable: 0,
    adversarialAnswered: 9,
    ...over,
  });

  it("passes a healthy run", () => {
    expect(signalFailure(counts())).toBeNull();
  });

  it("passes the keyless run, which makes no live calls at all", () => {
    expect(signalFailure({ answered: 0, unreachable: 0, adversarialAnswered: 0 })).toBeNull();
  });

  it("fails when nothing was answered, so a wall of skips cannot read as success", () => {
    expect(signalFailure(counts({ answered: 0, unreachable: 18, adversarialAnswered: 0 }))).toContain("0 of 18");
  });

  it("fails when barely anything answered, because one datum is not a run", () => {
    // The case that slipped through a bare zero check: 1 of 18 answered left
    // every output-side assertion skipped and the job green.
    expect(signalFailure(counts({ answered: 1, unreachable: 17, adversarialAnswered: 0 }))).toContain("1 of 18");
  });

  it("fails when no adversarial fixture answered, whatever the overall rate", () => {
    // The injection properties are what a live run exists to protect.
    const reason = signalFailure(counts({ answered: 15, unreachable: 3, adversarialAnswered: 0 }));
    expect(reason).toContain("adversarial");
  });

  it("passes when most calls answered and the adversarial fixtures were among them", () => {
    expect(signalFailure(counts({ answered: 14, unreachable: 4, adversarialAnswered: 5 }))).toBeNull();
  });

  it("treats exactly half as enough, and just under as not", () => {
    expect(signalFailure(counts({ answered: 9, unreachable: 9, adversarialAnswered: 3 }))).toBeNull();
    expect(signalFailure(counts({ answered: 8, unreachable: 10, adversarialAnswered: 3 }))).toContain("8 of 18");
  });
});

describe("classify, keyless", () => {
  it("asserts on the heuristic path, which is the whole point of the keyless run", () => {
    expect(classify(heuristic("not_configured"), false)).toEqual({ kind: "assert" });
  });

  it("fails if a real provider answered, because the keys were meant to be blank", () => {
    expect(classify(answered, false)).toMatchObject({ kind: "fail" });
  });

  it("fails on a degraded reason other than not_configured", () => {
    expect(classify(heuristic("error"), false)).toMatchObject({ kind: "fail" });
  });
});

describe("classify, live", () => {
  it("asserts when a provider answered", () => {
    expect(classify(answered, true)).toEqual({ kind: "assert" });
  });

  it("asserts for the fallback provider too", () => {
    expect(classify({ ok: true, provider: "groq/openai/gpt-oss-120b" }, true)).toEqual({ kind: "assert" });
  });

  it.each(["error", "rate_limited"])("skips when the provider was unreachable (%s)", (reason) => {
    const outcome = classify(heuristic(reason), true);
    expect(outcome.kind).toBe("skip");
    expect(outcome.kind === "skip" && outcome.reason).toContain(reason);
  });

  it("fails when the model answered unusably, which is a quality regression", () => {
    const outcome = classify(heuristic("malformed"), true);
    expect(outcome.kind).toBe("fail");
    expect(outcome.kind === "fail" && outcome.reason).toContain("malformed");
  });

  it("fails when a live run found no key, because that is a misconfigured job", () => {
    const outcome = classify(heuristic("not_configured"), true);
    expect(outcome.kind).toBe("fail");
    expect(outcome.kind === "fail" && outcome.reason).toContain("not_configured");
  });

  it("fails when the action itself failed", () => {
    expect(classify({ ok: false, provider: "heuristic", message: "boom" }, true)).toMatchObject({ kind: "fail" });
  });

  it("fails when the heuristic answered without saying why", () => {
    expect(classify({ ok: true, provider: "heuristic" }, true)).toMatchObject({ kind: "fail" });
  });
});
