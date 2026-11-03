import { describe, expect, it } from "vitest";
import { VoicePace, voicedAfterWords, wordCount } from "./voice-pace";

const agent = (text: string, id = "a1", interrupted = false) => ({
  type: "agent" as const,
  id,
  text,
  ...(interrupted ? { interrupted: true } : {}),
});

describe("the agent's turn kept to the pace of its voice (Pipecat)", () => {
  it("counts words as the voice says them", () => {
    expect(wordCount("  Train or  flight. ")).toBe(3);
    expect(voicedAfterWords("Train or flight.", 0)).toBe(0);
    expect(voicedAfterWords("Train or flight.", 2)).toBe("Train or".length);
    expect(voicedAfterWords("Train or flight.", 9)).toBe("Train or flight.".length);
  });

  it("shows nothing before the voice starts, then each word as it is said", () => {
    // The text arrives whole, seconds ahead of the voice (AgentFeed).
    const pace = new VoicePace();
    expect(pace.agent(agent("Both work. The train is calmer."))).toBeNull();
    expect(pace.word("Both")).toEqual({ ...agent("Both work. The train is calmer."), voiced: 4 });
    expect(pace.word("work.")).toMatchObject({ voiced: "Both work.".length });
    for (const w of ["The", "train", "is"]) pace.word(w);
    // The last word said: all of it, so no `voiced`.
    expect(pace.word("calmer.")).toEqual(agent("Both work. The train is calmer."));
  });

  it("paces the text as it grows, from what was said", () => {
    const pace = new VoicePace();
    pace.agent(agent("Both work."));
    pace.word("Both");
    expect(pace.agent(agent("Both work. The train is calmer."))).toMatchObject({ voiced: 4 });
  });

  it("never takes back what is on screen when the voice stops mid-reply", () => {
    // The TTS can run dry between two sentences of a slow completion.
    const pace = new VoicePace();
    pace.agent(agent("Both work."));
    pace.word("Both");
    expect(pace.stopped()).toEqual(agent("Both work."));
    // More of the same turn: the first sentence stays whole, the rest waits for the voice.
    expect(pace.agent(agent("Both work. The train is calmer."))).toMatchObject({ voiced: "Both work.".length });
    expect(pace.stopped()).toEqual(agent("Both work. The train is calmer."));
    expect(pace.stopped()).toBeNull();
  });

  it("keeps only what was said of a turn they cut off", () => {
    const pace = new VoicePace();
    pace.agent(agent("Both work. The train is calmer."));
    pace.word("Both");
    pace.word("work.");
    expect(pace.agent(agent("Both work. The train is calmer.", "a1", true))).toEqual(agent("Both work.", "a1", true));
    // Cut off before a word was said: nothing to show.
    pace.agent(agent("Let me think.", "a2"));
    expect(pace.agent(agent("Let me think.", "a2", true))).toBeNull();
  });

  it("brings out a held turn whole when they talk, and nothing when it was all shown", () => {
    const pace = new VoicePace();
    pace.agent(agent("Its voice never played."));
    expect(pace.user()).toEqual(agent("Its voice never played."));
    pace.agent(agent("Short.", "a2"));
    pace.word("Short.");
    expect(pace.user()).toBeNull();
  });

  it("starts each turn from nothing", () => {
    const pace = new VoicePace();
    pace.agent(agent("First reply."));
    pace.word("First");
    pace.word("reply.");
    expect(pace.agent(agent("Second one.", "a2"))).toBeNull();
    expect(pace.word("Second")).toMatchObject({ id: "a2", voiced: "Second".length });
  });
});
