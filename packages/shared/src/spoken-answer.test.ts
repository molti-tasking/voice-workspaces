import { describe, expect, it } from "vitest";
import { resolveSpokenAnswer } from "./spoken-answer";

describe("resolveSpokenAnswer", () => {
  it("hears a plain yes, however it is dressed", () => {
    for (const said of ["Yes.", "yeah go ahead", "Sure, send it.", "Yep, do it please", "[Speaker 1] Yes"]) {
      expect(resolveSpokenAnswer(said)).toBe("yes");
    }
  });

  it("hears a plain no", () => {
    for (const said of ["No.", "Nope", "no, don't send that", "Cancel it", "Never mind."]) {
      expect(resolveSpokenAnswer(said)).toBe("no");
    }
  });

  /**
   * The eval's own pending-confirmation line. It opens with "Okay" and is not
   * an answer to anything — a filler that settled it would send the diary
   * entry on the strength of a throat-clearing.
   */
  it("does not take a filler opening a new thought as consent", () => {
    expect(resolveSpokenAnswer("Okay. That's the plan for the intro done, I think.")).toBe("unclear");
    expect(resolveSpokenAnswer("Right, where was I")).toBe("unclear");
  });

  it("takes a bare filler as yes only when it is the whole reply", () => {
    expect(resolveSpokenAnswer("Okay.")).toBe("yes");
    expect(resolveSpokenAnswer("Sounds good")).toBe("yes");
  });

  it("leaves a mixed or deferring answer pending rather than guessing", () => {
    for (const said of ["No, go ahead", "Not yet", "Wait, hold on", "yes but later", "later"]) {
      expect(resolveSpokenAnswer(said)).toBe("unclear");
    }
  });

  it("treats a long line or nothing at all as no answer", () => {
    expect(resolveSpokenAnswer("")).toBe("unclear");
    expect(resolveSpokenAnswer("yes and then I think the second paper needs a new intro")).toBe("unclear");
  });
});
