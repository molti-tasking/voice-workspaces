import { describe, expect, it } from "vitest";
import { isDirectiveCandidate } from "./directive";

/**
 * Table-driven over lines shaped like real transcript.
 *
 * The asymmetry under test: recall matters far more than precision here,
 * because a line the gate rejects is never shown to a model and is written
 * `content` for good. Cases marked "false" are therefore the load-bearing ones
 * — each is a line that LOOKS instructional but is narration.
 */
describe("isDirectiveCandidate", () => {
  const directions = [
    "Mark that.",
    "mark that bit about the funding",
    "OK, mark that one.",
    "Um, note that down for later",
    "Remind me to email Niklas about the ethics form",
    "Summarise this drive when I stop",
    "send that to the doc",
    "Make that a thing.",
    "call that the interview problem",
    "Scratch that, I meant the other one.",
    "switch to sceptical",
    "From now on, keep the summaries shorter.",
  ];

  const content = [
    "I think the whole framing is wrong.",
    // "remember" mid-sentence is narration about remembering.
    "I should remember to call him, but that's not for now.",
    "The marketing team wanted a different name.",
    "We noted last year that the numbers did not add up.",
    "I want to send a message about this eventually.",
    "It's a nice day and I'm just thinking out loud.",
    "Thank you.",
    "",
    "   ",
  ];

  for (const line of directions) {
    it(`admits ${JSON.stringify(line)}`, () => {
      expect(isDirectiveCandidate(line)).toBe(true);
    });
  }

  for (const line of content) {
    it(`rejects ${JSON.stringify(line)}`, () => {
      expect(isDirectiveCandidate(line)).toBe(false);
    });
  }

  it("admits a line naming one of the user's own capabilities", () => {
    expect(isDirectiveCandidate("can you diary this one", { capabilityNames: ["diary"] })).toBe(
      true,
    );
  });

  it("does not fire a capability name inside a longer word", () => {
    expect(
      isDirectiveCandidate("the market was closed", { capabilityNames: ["mark"] }),
    ).toBe(false);
  });

  it("ignores capability names too short to be unambiguous", () => {
    expect(isDirectiveCandidate("go on then", { capabilityNames: ["go"] })).toBe(false);
  });
});
