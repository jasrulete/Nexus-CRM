import { describe, expect, it } from "vitest";

import { STAGE_PROBABILITY, weightedValue } from "./constants";

describe("weightedValue", () => {
  it("weights each deal by its stage", () => {
    expect(
      weightedValue([
        { stage: "LEAD", baseValue: 10_000 }, // 10% -> 1,000
        { stage: "NEGOTIATION", baseValue: 20_000 }, // 75% -> 15,000
      ]),
    ).toBe(16_000);
  });

  it("counts a won deal in full and a lost deal not at all", () => {
    expect(weightedValue([{ stage: "WON", baseValue: 5_000 }])).toBe(5_000);
    expect(weightedValue([{ stage: "LOST", baseValue: 5_000 }])).toBe(0);
  });

  it("is zero for no deals", () => {
    expect(weightedValue([])).toBe(0);
  });

  it("ignores a stage that is not one of the known six", () => {
    // Stage is a free-text column — SQLite has no enums — so a value written
    // by a seed script or direct SQL must not silently weight as 100%.
    expect(weightedValue([{ stage: "PROPOSL", baseValue: 10_000 }])).toBe(0);
  });

  it("rounds to whole currency units, matching how Deal.value is stored", () => {
    // 3333 * 0.1 = 333.3
    expect(weightedValue([{ stage: "LEAD", baseValue: 3_333 }])).toBe(333);
    expect(Number.isInteger(weightedValue([{ stage: "PROPOSAL", baseValue: 999 }]))).toBe(
      true,
    );
  });

  it("keeps the probabilities ordered as the pipeline advances", () => {
    expect(STAGE_PROBABILITY.LEAD).toBeLessThan(STAGE_PROBABILITY.QUALIFIED);
    expect(STAGE_PROBABILITY.QUALIFIED).toBeLessThan(STAGE_PROBABILITY.PROPOSAL);
    expect(STAGE_PROBABILITY.PROPOSAL).toBeLessThan(
      STAGE_PROBABILITY.NEGOTIATION,
    );
    expect(STAGE_PROBABILITY.NEGOTIATION).toBeLessThan(STAGE_PROBABILITY.WON);
  });
});
