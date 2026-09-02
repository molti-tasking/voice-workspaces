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
    expect(
      isDirectiveCandidate("I think we should go and see what they have done about it", {
        capabilityNames: ["go"],
      }),
    ).toBe(false);
  });
});

/**
 * The half of the gate contribution 3 depends on.
 *
 * A closed verb list can only ever admit operations somebody already thought
 * of, which makes discovering an invented one impossible by construction. The
 * open rule inverts it: a short line that does not begin like a statement is a
 * candidate, whatever verb it uses.
 */
describe("isDirectiveCandidate, on operations nobody has named", () => {
  const invented = [
    "Chase the invoice when I get in.",
    "Park that one for Thursday.",
    "Ping Niklas about the ethics form.",
    "Stitch those two together.",
    "Can you pull the funding thread out of this?",
  ];

  const narration = [
    "I keep circling back to the Midas touch problem.",
    "The repertoire is the contribution, not the recogniser.",
    "We chased that invoice for weeks and got nowhere.",
    "There is a version of this where the whole thing is much simpler.",
    "Because the alternative is a classifier arms race, and that never converges.",
    "What Niklas said about watertight seals applies here too.",
    "If everything I say is content by default, the failure mode is additive.",
    "Three to six months feels right, any less and nothing lands.",
    // Long enough to be thinking rather than an instruction, whatever it opens with.
    "Chase down every last one of the outstanding questions before the deadline arrives next month.",
  ];

  for (const line of invented) {
    it(`admits ${JSON.stringify(line)}`, () => {
      expect(isDirectiveCandidate(line)).toBe(true);
    });
  }

  for (const line of narration) {
    it(`rejects ${JSON.stringify(line)}`, () => {
      expect(isDirectiveCandidate(line)).toBe(false);
    });
  }

  it("strips stacked filler before looking at the opener", () => {
    expect(isDirectiveCandidate("OK, so, right, chase that invoice.")).toBe(true);
    expect(isDirectiveCandidate("Right, so the thing I keep coming back to is the framing.")).toBe(
      false,
    );
  });

  /**
   * Whisper invents sign-offs on silence, and they are short and
   * imperative-shaped. Blocking them in the gate keeps an artefact from costing
   * a model call on every quiet chunk of a long recording.
   */
  it("does not spend a model call on a transcription artefact", () => {
    for (const line of ["Thank you.", "Thanks for watching!", "Subtitles by the community"]) {
      expect(isDirectiveCandidate(line)).toBe(false);
    }
  });
});
