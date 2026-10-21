import { describe, expect, it } from "vitest";
import { pickVoices, speechChunks, speechLimitMs } from "./demo-voice";

const voice = (name: string, lang = "en-US") => ({ name, lang });

describe("the simulated conversation's voices", () => {
  it("gives the person and Souffleur different voices, preferring known ones", () => {
    const voices = [voice("Anna", "de-DE"), voice("Fred"), voice("Samantha"), voice("Daniel", "en-GB")];
    const { user, agent } = pickVoices(voices);
    expect(user?.name).toBe("Samantha");
    expect(agent?.name).toBe("Daniel");
  });

  it("falls back to two different English voices, or one for both", () => {
    expect(pickVoices([voice("Fred"), voice("Ralph")])).toEqual({ user: voice("Fred"), agent: voice("Ralph") });
    expect(pickVoices([voice("Fred")])).toEqual({ user: voice("Fred"), agent: voice("Fred") });
    expect(pickVoices([])).toEqual({ user: null, agent: null });
  });

  it("speaks a line a sentence at a time", () => {
    expect(speechChunks("Three good options. Aarhus has ARoS; Skagen is quieter: lovely in autumn!")).toEqual([
      "Three good options.",
      "Aarhus has ARoS;",
      "Skagen is quieter:",
      "lovely in autumn!",
    ]);
    expect(speechChunks("  ")).toEqual([]);
  });

  it("gives every line a time limit that grows with its length", () => {
    expect(speechLimitMs("Hm. Okay.")).toBeLessThan(speechLimitMs("A much longer line with many more words in it"));
    expect(speechLimitMs("")).toBe(2000);
  });
});
