import { describe, expect, it } from "vitest";
import { collapseRepeats, isDegenerate, repetitionRatio } from "./transcript-repair";

/**
 * Built from a real chunk. Whisper locked onto a fragment of a truncated
 * sentence and repeated it for the rest of the chunk, and because the previous
 * chunk's tail is fed back as a continuity prompt, the next two chunks looped
 * as well.
 */
const LOOP_UNIT = "the Transc. is the first of its kind, and";
const REAL_LOOP =
  "Right before that you'd also asked whether you could talk through all the previous work you'd done, but " +
  `${LOOP_UNIT} `.repeat(28);

describe("collapseRepeats", () => {
  it("repairs the real looping chunk", () => {
    const repaired = collapseRepeats(REAL_LOOP);

    expect(repaired).toContain("Right before that you'd also asked whether you could talk through");
    // One copy of the loop unit survives, not 28.
    expect(repaired.split("first of its kind").length - 1).toBe(1);
    expect(repaired.length).toBeLessThan(REAL_LOOP.length / 5);
  });

  it("collapses a single repeated word", () => {
    expect(collapseRepeats("so so so so what should I focus on")).toBe("so what should I focus on");
  });

  it("collapses a repeated sentence", () => {
    const line = "I'm going to make a video about how to make a real-world computer";
    expect(collapseRepeats(`${line} ${line} ${line}`)).toBe(line);
  });

  it("keeps a phrase said twice", () => {
    // People repeat themselves, and the ledger is meant to hold that. Only an
    // unbroken run of three or more is degenerate.
    const line = "I really mean it";
    expect(collapseRepeats(`${line} ${line}`)).toBe(`${line} ${line}`);
  });

  it("keeps deliberate emphasis", () => {
    // "no, no" is real speech. Three identical words in a row is the boundary,
    // and this sits just under it.
    expect(collapseRepeats("no no I disagree")).toBe("no no I disagree");
  });

  it("leaves ordinary speech untouched", () => {
    const speech =
      "I keep going back and forth on whether to cut the field study, and the scope is the thing that actually worries me.";
    expect(collapseRepeats(speech)).toBe(speech);
  });

  it("repairs a loop that fills the whole chunk", () => {
    expect(collapseRepeats(`${LOOP_UNIT} `.repeat(40).trim())).toBe(LOOP_UNIT);
  });

  it("handles short and empty input", () => {
    expect(collapseRepeats("")).toBe("");
    expect(collapseRepeats("hello")).toBe("hello");
    expect(collapseRepeats("hello there")).toBe("hello there");
  });

  it("keeps real speech that follows a loop", () => {
    // The repair must not swallow whatever the driver actually said next.
    const repaired = collapseRepeats(`${`${LOOP_UNIT} `.repeat(10)}so what should I focus on`);
    expect(repaired).toContain("so what should I focus on");
  });
});

describe("isDegenerate", () => {
  it("flags a chunk that was mostly loop", () => {
    // Such a chunk must not become the next chunk's continuity prompt: feeding
    // the artefact back to Whisper is what makes the loop self-sustaining.
    expect(isDegenerate(REAL_LOOP, collapseRepeats(REAL_LOOP))).toBe(true);
  });

  it("does not flag ordinary speech", () => {
    const speech = "So what should I focus on, given everything we just went through?";
    expect(isDegenerate(speech, collapseRepeats(speech))).toBe(false);
  });

  it("reports how much was repetition", () => {
    expect(repetitionRatio(REAL_LOOP, collapseRepeats(REAL_LOOP))).toBeGreaterThan(0.8);
    expect(repetitionRatio("hello there", "hello there")).toBe(0);
  });
});
