/**
 * The two steerability classifiers, against the things people actually say.
 *
 * The fixtures are German and English together on purpose: the corpus is
 * mixed, Pilot 01 was German, and a classifier that only knew English would
 * report a correction rate of zero for the exact participant it was written
 * for. Half of these cases are NEGATIVES, because the failure that would make
 * the measure useless is not missing a correction — it is calling ordinary
 * thinking aloud a correction, which every sentence containing "nicht" or
 * "not" would be under a looser rule.
 */
import { describe, expect, it } from "vitest";
import { isCorrection, isRepeatRequest, normalise } from "./steerability";

describe("normalise", () => {
  it("strips punctuation and keeps umlauts", () => {
    expect(normalise("Wie BITTE?!")).toBe("wie bitte");
    expect(normalise("  Das   stimmt nicht. ")).toBe("das stimmt nicht");
    expect(normalise("Könnte gehen")).toBe("könnte gehen");
  });
});

describe("isRepeatRequest", () => {
  it("hears a request to say it again, in either language", () => {
    for (const said of [
      "Nochmal bitte?",
      "Kannst du das noch mal sagen?",
      "Wie bitte?",
      "Das habe ich nicht verstanden.",
      "Sorry, say that again?",
      "Can you repeat that?",
      "I didn't catch that.",
      "What did you say?",
    ]) {
      expect(isRepeatRequest(said), said).toBe(true);
    }
  });

  it("does not hear one in ordinary speech", () => {
    for (const said of [
      "Das verstehe ich schon, aber die Reihenfolge stimmt nicht.",
      "Ich weiß nicht, wo ich das hingelegt habe.",
      "I said the deadline was November.",
      "The second participant heard the same thing.",
    ]) {
      expect(isRepeatRequest(said), said).toBe(false);
    }
  });

  it("over-counts where a phrase is ambiguous, and that is the chosen direction", () => {
    // "nochmal" and "repeat that" are matched anywhere in the utterance
    // because that is how somebody asks. The price is that a sentence which
    // merely mentions doing something again reads as a request. Recorded
    // rather than hidden: the measure over-counts repeat requests slightly,
    // and under-counts corrections, which is the safe pairing — neither bias
    // can manufacture the claim that the system is easy to steer.
    expect(isRepeatRequest("Ich mache das nochmal anders, glaube ich.")).toBe(true);
    expect(isRepeatRequest("I need to repeat that experiment with two participants.")).toBe(true);
  });
});

describe("isCorrection", () => {
  it("hears a rejection that opens an utterance", () => {
    for (const said of [
      "Nein, das andere.",
      "Nee, lass das.",
      "Falsch, ich meinte die Einleitung.",
      "Ich meinte den Abschnitt davor.",
      "Eigentlich sollte das in doing.",
      "No, the other one.",
      "Not that one.",
      "Actually, put it in next.",
      "Wrong card.",
    ]) {
      expect(isCorrection(said), said).toBe(true);
    }
  });

  it("hears the phrases that cannot mean anything else", () => {
    for (const said of [
      "Also das stimmt nicht, ich war letzte Woche da.",
      "Hmm, mach das rückgängig.",
      "Yeah, that's wrong — put it back.",
    ]) {
      expect(isCorrection(said), said).toBe(true);
    }
  });

  it("leaves thinking aloud alone", () => {
    for (const said of [
      "Ich weiß nicht, ob das reicht.",
      "Das ist nicht so einfach, weil die Daten fehlen.",
      "Die Frage ist, ob der Vergleich überhaupt trägt.",
      "I'm not sure the comparison holds.",
      "It's not about throughput, it's about whether it comes back.",
      "The deadline is in November, I think.",
    ]) {
      expect(isCorrection(said), said).toBe(false);
    }
  });

  it("says nothing about silence", () => {
    expect(isCorrection("")).toBe(false);
    expect(isRepeatRequest("   ")).toBe(false);
  });
});
