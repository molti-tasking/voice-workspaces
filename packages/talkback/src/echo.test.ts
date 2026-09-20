import { describe, expect, it } from "vitest";
import { containment, isEcho, keptIndices, withoutEcho } from "./echo";
import { ANSWER_ACKNOWLEDGEMENTS, SEARCH_WAIT_PHRASES } from "./prompt";

/**
 * The filter that keeps the system's own voice out of what it reads back.
 *
 * Its input is `agent_turn.text` and nothing else, which is why every sentence
 * the container speaks with no completion behind it — the search
 * announcement, the keep-alive while a long turn runs, the acknowledgement
 * when a re-run declines — is written to that table. The tests below are the
 * second half of that contract: recorded is not enough, the phrase also has to
 * be one this filter can actually recognise.
 */

/** Every fixed phrase the container speaks, as a flat list. */
const FIXED_PHRASES = [
  ...Object.values(SEARCH_WAIT_PHRASES).flatMap((phrases) => [...phrases]),
  ...Object.values(ANSWER_ACKNOWLEDGEMENTS),
];

describe("containment", () => {
  it("is asymmetric, which is what makes a fragment of a long reply detectable", () => {
    const reply = "The one in Altenholz is open until six, the Kiel-Wik one until eight.";
    expect(containment("open until six", reply)).toBe(1);
    expect(containment(reply, "open until six")).toBeLessThan(0.5);
  });

  it("ignores words too common to carry signal", () => {
    expect(containment("and so it is the", "nothing in common whatsoever")).toBe(0);
  });
});

describe("the container's own fixed phrases", () => {
  it("are recognised as echo when the microphone picks them up", () => {
    // The keep-alive is spoken aloud while the model composes; the mic hears
    // it through the speaker and Whisper puts it in `utterance`. Unless this
    // holds, the participant's own transcript grows a line saying "Ich suche
    // noch." and recall hands it back to the model as something they said.
    for (const phrase of FIXED_PHRASES) {
      expect(isEcho(phrase, [phrase]), phrase).toBe(true);
    }
  });

  it("survive the mishearing that echo actually looks like", () => {
    // Never a clean copy: the mic catches it through a speaker, across chunk
    // boundaries, with the drive underneath.
    expect(isEcho("uh still looking that up", ["Still looking that up."])).toBe(true);
    expect(isEcho("hab ein bisschen geduld ich suche", ["Hab ein bisschen Geduld, ich suche noch."])).toBe(
      true,
    );
  });

  it("carry enough words for the filter to have an opinion at all", () => {
    // `isEcho` refuses to judge a line under MIN_WORDS, because containment
    // over one or two tokens means nothing. A shorter filler would therefore be
    // unfilterable however faithfully it was recorded — "Still looking." is
    // two words once NOISE is dropped, which is why it is not the phrase.
    for (const phrase of FIXED_PHRASES) {
      expect(isEcho(phrase, [phrase]), `${phrase} is too short to be filtered`).toBe(true);
    }
    expect(isEcho("Still looking.", ["Still looking."])).toBe(false);
  });

  it("are dropped from a transcript while the driver's own words stay", () => {
    const spoken = ["Let me look up the opening hours.", ...SEARCH_WAIT_PHRASES.de!];
    const heard = [
      "Wo kann ich hier in der Nähe Blumen kaufen?",
      "Let me look up the opening hours.",
      "Ich suche noch.",
      "Ja, genau, und dann noch Erde für die Balkonkästen.",
      "Hab ein bisschen Geduld, ich suche noch.",
    ];
    expect(withoutEcho(heard, spoken)).toEqual([
      "Wo kann ich hier in der Nähe Blumen kaufen?",
      "Ja, genau, und dann noch Erde für die Balkonkästen.",
    ]);
  });
});

describe("keptIndices", () => {
  it("returns positions, so a repeated line does not resurrect itself", () => {
    // A caller that filtered by kept TEXT would bring both copies back. That is
    // how the first version shipped.
    const lines = ["the same hallucinated sentence again", "real speech here", "the same hallucinated sentence again"];
    expect(keptIndices(lines, [])).toEqual([0, 1]);
  });
});
