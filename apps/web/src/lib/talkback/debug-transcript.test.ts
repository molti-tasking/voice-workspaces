import { describe, expect, it } from "vitest";
import { renderDebugTranscript, type DebugDrive } from "./debug-transcript";

const drive: DebugDrive = {
  id: "ae7e7d16-06e7-461d-9fc2-771a35b63aed",
  startedAt: new Date("2026-10-26T22:19:36.986Z"),
  endedAt: new Date("2026-10-26T22:23:59.986Z"),
  title: "Research workshop",
  sttLanguage: null,
  voiceId: null,
  condition: { display: "choice" },
  block: null,
  utterances: [
    { startMs: 10_002, text: "Na, what do you think we should talk about?" },
    { startMs: 40_008, text: "So tomorrow there's a research workshop" },
  ],
  turns: [
    {
      seq: 0,
      startMs: 3_683,
      endMs: 6_000,
      kind: "proactive_prompt",
      text: "I'm here with you.",
      generatedText: "I'm here with you.",
      respondingToText: null,
      bargedIn: false,
      totalLatencyMs: 850,
      configVersion: "realtime-1",
      resolvedModel: "gpt-realtime-2.1",
      trigger: "opening",
    },
    {
      seq: 1,
      startMs: 14_217,
      endMs: 16_000,
      kind: "reply",
      text: "We could start",
      generatedText: "We could start simple: what is the one thing?",
      respondingToText: "Yeah, mitä luulet meidän pitäisi puhua?",
      bargedIn: true,
      totalLatencyMs: 703,
      configVersion: "realtime-1",
      resolvedModel: "gpt-realtime-2.1",
      trigger: "user_turn",
    },
  ],
  silentAttempts: [{ offsetMs: 45_199, trigger: "user_turn" }],
  floor: [{ offsetMs: 2_831, kind: "open", atConnect: true }],
  subjects: [{ ordinal: 1, title: "Research workshop", visits: [{ startMs: 14_139, endMs: null }], settled: false, kept: false }],
  moments: [],
};

describe("renderDebugTranscript", () => {
  const text = renderDebugTranscript([drive]);

  it("says how the drive was set up", () => {
    expect(text).toContain("engine realtime-1 · gpt-realtime-2.1 · transcription language auto-detect");
    expect(text).toContain("s1. Research workshop (0:14–…) — open");
  });

  it("puts the two transcripts of their words side by side, in time order", () => {
    const lines = text.split("\n");
    const at = (needle: string) => lines.findIndex((l) => l.includes(needle));
    expect(at("[0:02] (connected, floor open)")).toBeLessThan(at("[0:03] Assistant (opening)"));
    expect(at("[0:10] You: Na, what do you think")).toBeLessThan(at("[0:14] Assistant: We could start"));
    expect(text).toContain("answering the live transcript: «Yeah, mitä luulet meidän pitäisi puhua?»");
    expect(text).toContain("cut off after 0:01; it had generated: We could start simple: what is the one thing?");
    expect(text).toContain("[0:45] (began to answer, cut off before a word)");
  });

  it("says what each latency is measured from", () => {
    expect(text).toContain("first sound 850 ms after it was asked to open");
    expect(text).toContain("first sound 703 ms after their turn ended");
  });

  it("says when there is no ledger yet", () => {
    expect(renderDebugTranscript([{ ...drive, utterances: [] }])).toContain("the worker has not transcribed");
  });
});
