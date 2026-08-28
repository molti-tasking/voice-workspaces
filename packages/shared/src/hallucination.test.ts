import { describe, expect, it } from "vitest";
import { isLikelyHallucination, withoutHallucinatedSentences } from "./hallucination";

/**
 * From a real drive. Whisper produced "Thank you so much for watching, and I'll
 * see you in the next video." from a participant who said nothing of the sort —
 * on silence it returns a fluent sentence from its training distribution, which
 * is largely YouTube.
 *
 * The ledger is meant to be verbatim, so an unmarked fabrication in it is worse
 * than a gap: it reads as something the participant said.
 */
describe("isLikelyHallucination", () => {
  it("catches the sign-offs Whisper invents on silence", () => {
    expect(isLikelyHallucination("Thank you so much for watching, and I'll see you in the next video.")).toBe(true);
    expect(isLikelyHallucination("Thanks for watching!")).toBe(true);
    expect(isLikelyHallucination("Subtitles by the Amara.org community")).toBe(true);
    expect(isLikelyHallucination("you")).toBe(true);
  });

  it("ignores punctuation and case", () => {
    expect(isLikelyHallucination("THANK YOU FOR WATCHING")).toBe(true);
    expect(isLikelyHallucination("  thanks for watching...  ")).toBe(true);
  });

  it("leaves real speech alone", () => {
    expect(isLikelyHallucination("I keep going back and forth on whether to cut the field study.")).toBe(false);
    expect(isLikelyHallucination("So what should I focus on?")).toBe(false);
  });

  it("only matches a whole line", () => {
    // Someone can genuinely thank a passenger, or talk about a video they made.
    // Marking real speech as fabricated is the worse error, so the match is
    // deliberately narrow.
    expect(isLikelyHallucination("Thank you for watching the recording I sent over, it was useful.")).toBe(false);
    expect(isLikelyHallucination("I said thanks for watching at the end of the video.")).toBe(false);
  });

  it("handles empty input", () => {
    expect(isLikelyHallucination("")).toBe(false);
    expect(isLikelyHallucination("   ")).toBe(false);
  });
});

describe("withoutHallucinatedSentences", () => {
  it("keeps the real question and drops the sign-off glued to it", () => {
    expect(
      withoutHallucinatedSentences(
        "Hey, can you summarize the previous discussions? Thank you for watching the video today.",
      ),
    ).toBe("Hey, can you summarize the previous discussions?");
  });

  it("returns nothing when every sentence is an artefact", () => {
    expect(
      withoutHallucinatedSentences("Thanks for watching! See you in the next video."),
    ).toBe("");
  });

  it("leaves ordinary speech completely alone", () => {
    const said = "I think the deadline moved. We should tell Maria before Friday.";
    expect(withoutHallucinatedSentences(said)).toBe(said);
  });

  it("does not strip 'thank you' used inside a real sentence", () => {
    const said = "Thank you for the notes, they were useful.";
    expect(withoutHallucinatedSentences(said)).toBe(said);
  });

  it("still rejects a single-sentence artefact, matching the line-level rule", () => {
    expect(withoutHallucinatedSentences("Thanks for watching")).toBe("");
  });
});

describe("narrated-video hallucinations", () => {
  it("catches the openings Whisper invents on near-silence", () => {
    // All verbatim from one nine-chunk drive.
    expect(
      isLikelyHallucination(
        "Hello everyone, welcome to my channel. Today I will show you how to make a beautiful and beautiful Christmas tree.",
      ),
    ).toBe(true);
    expect(
      isLikelyHallucination("Today I will show you how to make an easy, easy, and easy cake"),
    ).toBe(true);
  });

  it("strips the narration but keeps real speech in the same row", () => {
    expect(
      withoutHallucinatedSentences(
        "So the deadline is Friday. Hello everyone, welcome to my channel.",
      ),
    ).toBe("So the deadline is Friday.");
  });

  it("does not touch someone genuinely talking about making something", () => {
    const said = "I want to make the argument stronger in section three.";
    expect(isLikelyHallucination(said)).toBe(false);
    expect(withoutHallucinatedSentences(said)).toBe(said);
  });

  it("strips bare narration wedged between real speech", () => {
    // Verbatim from the corpus: the hallucination sits mid-row, with genuine
    // speech on both sides, so only sentence-level filtering recovers it.
    expect(
      withoutHallucinatedSentences(
        "Where did we stop? I will show you how to make a very simple and easy cake. Yes, what is it?",
      ),
    ).toBe("Where did we stop? Yes, what is it?");
  });

  it("does not fire on 'welcome' used normally", () => {
    const said = "Welcome to Aarhus, it is a good place to live.";
    expect(isLikelyHallucination(said)).toBe(false);
  });
});
