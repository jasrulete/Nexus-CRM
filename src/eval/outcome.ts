/**
 * What a single evaluated call means for the run's verdict.
 *
 * The evaluation harness answers one question: does the model still behave?
 * A provider that never answered tells us nothing about that. The first live
 * run made the distinction concrete - five of eighteen calls failed, and every
 * one was Google-side (two HTTP 503 "high demand", three over the 30 s
 * timeout), yet they failed identically to a model that had started returning
 * nonsense. A nightly that is red for the weather is a nightly you stop
 * reading, so the two are separated here:
 *
 *   unreachable  the provider errored, timed out or rate-limited us. Reported
 *                and skipped: no evidence either way about the model.
 *   quality      the model answered, and the answer was unusable. Red.
 *   config       a live run with no key, or a keyless run that reached a
 *                provider. The job itself is wrong. Red.
 *
 * Skipping is only honest while *something* answered. The caller is
 * responsible for failing a run in which nothing did - see `zeroSignal`.
 */

export type EvalResult = {
  ok: boolean;
  provider: string;
  degraded?: string;
  message?: string;
};

export type EvalOutcome =
  | { kind: "assert" }
  | { kind: "skip"; reason: string }
  | { kind: "fail"; reason: string };

const UNREACHABLE = new Set(["error", "rate_limited"]);

/** True when the provider never gave us a usable answer to judge. */
export function isUnreachable(degraded: string | undefined): boolean {
  return degraded !== undefined && UNREACHABLE.has(degraded);
}

const LIVE_PROVIDER = /^(gemini|groq)\//;

export function classify(result: EvalResult, live: boolean): EvalOutcome {
  if (!result.ok) {
    return { kind: "fail", reason: `the action failed: ${result.message ?? "no message"}` };
  }

  if (!live) {
    // Keys are blanked in this mode, so the only correct answer is the
    // heuristic saying exactly why it ran. A real provider here means the
    // run is spending quota it was not meant to spend.
    if (result.provider === "heuristic" && result.degraded === "not_configured") {
      return { kind: "assert" };
    }
    return {
      kind: "fail",
      reason: `keyless run expected the heuristic path, got provider "${result.provider}" (degraded: ${result.degraded ?? "none"})`,
    };
  }

  if (LIVE_PROVIDER.test(result.provider) && result.degraded === undefined) {
    return { kind: "assert" };
  }

  if (isUnreachable(result.degraded)) {
    return {
      kind: "skip",
      reason: `provider unreachable (${result.degraded}) - no signal about the model, not a regression`,
    };
  }

  if (result.degraded === "malformed") {
    return { kind: "fail", reason: "the model answered, and the reply was unusable (malformed)" };
  }

  if (result.degraded === "not_configured") {
    return { kind: "fail", reason: "live run found no provider key configured (not_configured)" };
  }

  return {
    kind: "fail",
    reason: `expected a live provider, got "${result.provider}" (degraded: ${result.degraded ?? "none"})`,
  };
}

/**
 * A run in which nothing was answered proves nothing about the model, and a
 * green wall of skips would read as success. That case is red on purpose.
 * A run that made no live calls at all (the keyless suite) is not that case.
 */
export function zeroSignal(counts: { answered: number; unreachable: number }): boolean {
  return counts.answered === 0 && counts.unreachable > 0;
}
