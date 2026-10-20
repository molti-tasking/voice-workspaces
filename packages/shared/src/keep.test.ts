import { describe, expect, it } from "vitest";
import { keepRequest } from "./keep";

describe("keepRequest", () => {
  it("hears a keep, in English and German, with a little courtesy around it", () => {
    for (const said of [
      "Keep this one.",
      "Okay, keep this one please.",
      "I want to keep this.",
      "I'll keep that one.",
      "I want to remember this myself.",
      "Let me keep this topic.",
      "Das will ich behalten.",
      "Behalte das.",
      "Ja, diesen Punkt möchte ich behalten.",
      "Das will ich mir merken.",
      "Um, keep this one.",
    ]) {
      expect(keepRequest(said), said).toBe("keep");
    }
  });

  it("hears taking a keep back", () => {
    for (const said of ["Don't keep this one.", "I don't want to keep that after all.", "Das doch nicht behalten."]) {
      expect(keepRequest(said), said).toBe("unkeep");
    }
  });

  it("does not take the words inside a sentence for a command", () => {
    for (const said of [
      "I want to keep this simple.",
      "We should keep that budget for the second trip.",
      "Keep this one in mind when we talk to the council about the heat plan tomorrow.",
      "Das will ich eigentlich behalten, aber der Antrag ist zu lang.",
      "I think we keep it.",
    ]) {
      expect(keepRequest(said), said).toBeNull();
    }
  });

  it("does not treat asking the agent to remember as keeping it yourself", () => {
    // "Remember this" hands it OVER; keeping is holding it in your own head.
    expect(keepRequest("Remember this.")).toBeNull();
    expect(keepRequest("Can you remember that for me?")).toBeNull();
  });

  it("ignores an empty or filler-only turn", () => {
    expect(keepRequest("")).toBeNull();
    expect(keepRequest("Um, uh.")).toBeNull();
  });
});
