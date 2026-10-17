import { describe, expect, it } from "vitest";
import {
  countFillers,
  countHedges,
  countSelfRepairs,
  isSelfRepair,
  stripFillers,
  turnCues,
} from "./speech-cues";

describe("countHedges", () => {
  it("hears the words put in front of a claim nobody is sure of", () => {
    expect(countHedges("Maybe Tuesday, I think, but probably Wednesday.")).toBe(3);
    expect(countHedges("Vielleicht am Dienstag, ich glaube eher Mittwoch.")).toBe(2);
    expect(countHedges("I'm not sure, I don't know yet.")).toBe(2);
    expect(countHedges("Da bin ich mir unsicher.")).toBe(1);
  });

  it("leaves a sure sentence alone, even with the verb in it", () => {
    for (const said of [
      "The deadline is Friday.",
      "Ich schreibe das am Dienstag.",
      "Think about the intro first.",
      "Glaube mir, das trägt.",
      "",
    ]) {
      expect(countHedges(said), said).toBe(0);
    }
  });
});

describe("countFillers and stripFillers", () => {
  it("counts the fillers a transcriber kept", () => {
    expect(countFillers("Um, so the, uh, intro")).toBe(2);
    expect(countFillers("Äh, das ist, ähm, die Einleitung")).toBe(2);
    expect(countFillers("Hmm. Okay.")).toBe(1);
  });

  it("does not take a word that starts like one", () => {
    for (const said of ["Umbrella and humming", "Ähnlich wie Uhr", "Ermittlung", "the herb"]) {
      expect(countFillers(said), said).toBe(0);
    }
  });

  it("shows the turn without them", () => {
    expect(stripFillers("Um, so the, uh, intro")).toBe("so the, intro");
    expect(stripFillers("Äh das ist ähm die Einleitung.")).toBe("das ist die Einleitung.");
    expect(stripFillers("No fillers here.")).toBe("No fillers here.");
  });
});

describe("countSelfRepairs", () => {
  it("counts each marker in a turn, where isSelfRepair only says yes", () => {
    const said = "Tuesday, or rather Wednesday — no wait, Thursday.";
    expect(isSelfRepair(said)).toBe(true);
    expect(countSelfRepairs(said)).toBe(2);
    expect(countSelfRepairs("I need to book the flights before Friday.")).toBe(0);
  });
});

describe("turnCues", () => {
  it("adds the three up for one turn", () => {
    expect(turnCues("Um, maybe the intro, I mean the method.")).toEqual({
      fillers: 1,
      selfRepairs: 1,
      hedges: 1,
    });
  });
});
