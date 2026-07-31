import { describe, expect, it } from "vitest";

import { sharedSentryOptions } from "./sentry-options";

// The promise this module makes is that a clone with no Sentry account runs
// unchanged, and that a CRM's error reports never carry customer data.
describe("sentry options", () => {
  it("never attaches personally identifying data", () => {
    expect(sharedSentryOptions.sendDefaultPii).toBe(false);
  });

  it("samples traces well below the free-tier quota", () => {
    expect(sharedSentryOptions.tracesSampleRate).toBeGreaterThan(0);
    expect(sharedSentryOptions.tracesSampleRate).toBeLessThanOrEqual(0.2);
  });

  it("stays disabled outside production", () => {
    // The suite runs with NODE_ENV=test, so this also documents that local
    // and CI runs cannot spend the error quota.
    expect(sharedSentryOptions.enabled).toBe(false);
  });
});
