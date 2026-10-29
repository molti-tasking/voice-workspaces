import { describe, expect, it } from "vitest";
import { DRAFT_OPEN, SILENCE_TOKEN, SPARK_KINDS } from "./prompt";
import {
  DEFAULT_REALTIME_VOICE,
  REALTIME_CONTRACT,
  REALTIME_POKE_NUDGE,
  REALTIME_SESSION_PROMPT,
  composeRealtimeFieldPrompt,
  composeRealtimeSessionPrompt,
  realtimeOpeningNudge,
  realtimeSessionConfig,
  liveTranscriptionConfig,
  realtimeSparkNudge,
  realtimeVoiceFor,
} from "./realtime";
import { SESSION_OPENING_NUDGE, SESSION_SYSTEM_PROMPT } from "./study-agent";
import { SESSION_TASKS } from "./study-task";
import { VOICES } from "./voice";

/**
 * A speech-to-speech model says whatever it is told to say, so the sentinel
 * and the draft tags of the text pipeline must not reach it: `<silence>` would
 * be read out, and a draft it cannot make would be promised.
 */

describe("the display study's agent on this engine", () => {
  it("keeps every line of the session agent it does not have to replace", () => {
    const realtime = new Set(REALTIME_SESSION_PROMPT.split("\n"));
    const kept = SESSION_SYSTEM_PROMPT.split("\n").filter(
      (line) => !line.includes(SILENCE_TOKEN) && !line.includes("Before each turn") && !line.startsWith("Their words may carry"),
    );
    const missing = kept.filter((line) => !realtime.has(line));
    // Only the reading section's lines, which are replaced as one.
    expect(missing.every((line) => /read|reading|invite them to read|finished/i.test(line))).toBe(true);
    expect(REALTIME_SESSION_PROMPT).toContain("HOW TO TALK");
    expect(REALTIME_SESSION_PROMPT).toContain("You have no name of your own");
  });

  it("names no sentinel and no draft, for any task", () => {
    for (const task of Object.values(SESSION_TASKS)) {
      const { prompt } = composeRealtimeSessionPrompt(task, { localTime: "LOCAL TIME: Monday, 26 October 2026, 14:00 (Europe/Copenhagen)." });
      expect(prompt).not.toContain(SILENCE_TOKEN);
      expect(prompt).not.toContain(DRAFT_OPEN);
      expect(prompt).toContain(task.agentSection);
      expect(prompt).toContain("That is when this conversation started");
      expect(prompt.endsWith(REALTIME_CONTRACT)).toBe(true);
    }
  });

  it("says when the drive is pinned to a language, and nothing on auto-detect", () => {
    const task = Object.values(SESSION_TASKS)[0]!;
    expect(composeRealtimeSessionPrompt(task, { language: "da" }).prompt).toContain("Speak Danish throughout");
    expect(composeRealtimeSessionPrompt(task, { language: null }).prompt).not.toContain("LANGUAGE");
  });

  it("opens the way the session agent does", () => {
    expect(realtimeOpeningNudge({ session: true, proactiveOffers: false })).toBe(SESSION_OPENING_NUDGE);
    expect(realtimeOpeningNudge({ session: false, proactiveOffers: false })).toBeNull();
  });
});

describe("the field agent on this engine", () => {
  it("names no sentinel and no draft, and still gives way to a thought in progress", () => {
    const { prompt, maxReplyWords } = composeRealtimeFieldPrompt({ continued: "EARLIER IN THIS CONVERSATION\n…" });
    expect(prompt).not.toContain(SILENCE_TOKEN);
    expect(prompt).not.toContain(DRAFT_OPEN);
    expect(prompt).toContain("say nothing more than");
    expect(prompt).toContain("EARLIER IN THIS CONVERSATION");
    expect(maxReplyWords).toBe(40);
  });
});

describe("the nudges", () => {
  it("never tell the model a sentinel is withheld", () => {
    expect(REALTIME_POKE_NUDGE).not.toContain(SILENCE_TOKEN);
    expect(REALTIME_POKE_NUDGE).toMatch(/tapped to hear from you/);
    for (const kind of SPARK_KINDS) {
      const generic = realtimeSparkNudge(kind, "the train");
      expect(generic).toContain('"the train"');
      expect(generic).not.toContain(SILENCE_TOKEN);
      const own = realtimeSparkNudge(kind, "the train", "Which train, though?");
      expect(own).toContain("Which train, though?");
      expect(own).not.toContain(SILENCE_TOKEN);
    }
  });
});

describe("the session", () => {
  it("is minted with semantic turn detection and transcription in the drive's language", () => {
    const session = realtimeSessionConfig({
      model: "openai/gpt-realtime-2.1",
      instructions: "Talk.",
      voice: "marin",
      language: "de",
      transcribeModel: "gpt-4o-transcribe",
      eagerness: "auto",
    });
    expect(session.audio.input.turn_detection).toEqual({
      type: "semantic_vad",
      eagerness: "auto",
      create_response: true,
      interrupt_response: true,
    });
    expect(session.audio.input.transcription).toEqual({ model: "gpt-4o-transcribe", language: "de" });
    expect(
      realtimeSessionConfig({ ...session, voice: "marin", language: null, transcribeModel: "x", eagerness: "high" }).audio
        .input.transcription,
    ).toEqual({ model: "x" });
  });

  it("gives every catalogue voice one of the provider's, and the default to anything else", () => {
    const voices = VOICES.map((v) => realtimeVoiceFor(v.id));
    expect(new Set(voices).size).toBe(VOICES.length);
    expect(realtimeVoiceFor(null)).toBe(DEFAULT_REALTIME_VOICE);
    expect(realtimeVoiceFor("retired")).toBe(DEFAULT_REALTIME_VOICE);
  });
});

describe("liveTranscriptionConfig", () => {
  it("is a transcription-only session in the conversation's language, writing soon after the words, with no turn detection of its own", () => {
    expect(liveTranscriptionConfig({ model: "gpt-live-transcribe", language: "en" })).toEqual({
      type: "transcription",
      audio: {
        input: {
          transcription: { model: "gpt-live-transcribe", language: "en", delay: "low" },
          noise_reduction: { type: "near_field" },
          turn_detection: null,
        },
      },
    });
    expect(liveTranscriptionConfig({ model: "m", language: null }).audio.input.transcription).toEqual({ model: "m", delay: "low" });
  });
});
