import { describe, expect, it } from "vitest";
import { FindingsAnswers, FindingsSubmission, hasAnyAnswer } from "./findings-survey";

describe("FindingsAnswers", () => {
  it("accepts a partly answered document", () => {
    const parsed = FindingsAnswers.safeParse({
      usage: "a_handful",
      silenceMatch: "na",
      handOff: { remember_task: "gladly" },
      umuxEase: 6,
    });
    expect(parsed.success).toBe(true);
  });

  it("refuses values off the scales", () => {
    expect(FindingsAnswers.safeParse({ silenceMatch: 6 }).success).toBe(false);
    expect(FindingsAnswers.safeParse({ umuxCapabilities: 0 }).success).toBe(false);
    expect(FindingsAnswers.safeParse({ handOff: { remember_task: "maybe" } }).success).toBe(false);
    expect(FindingsAnswers.safeParse({ handOff: { fly_the_car: "gladly" } }).success).toBe(false);
  });
});

describe("FindingsSubmission", () => {
  it("needs a browser-made uuid", () => {
    const answers = { usage: "regularly" };
    expect(FindingsSubmission.safeParse({ id: "nope", version: "findings-1", answers }).success).toBe(false);
    expect(
      FindingsSubmission.safeParse({ id: "6f1c2b9e-3d4a-4c5b-8e6f-7a8b9c0d1e2f", version: "findings-1", answers })
        .success,
    ).toBe(true);
  });
});

describe("hasAnyAnswer", () => {
  it("does not count blank text or empty selections", () => {
    expect(hasAnyAnswer({})).toBe(false);
    expect(hasAnyAnswer({ neverDo: "   ", useReasons: [], handOff: {} })).toBe(false);
  });

  it("counts any real answer", () => {
    expect(hasAnyAnswer({ neverDo: "Decide for me." })).toBe(true);
    expect(hasAnyAnswer({ useReasons: ["forgot"] })).toBe(true);
    expect(hasAnyAnswer({ handOff: { sum_up: "myself" } })).toBe(true);
    expect(hasAnyAnswer({ umuxEase: 1 })).toBe(true);
  });
});
