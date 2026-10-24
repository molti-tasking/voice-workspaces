import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { SESSION_TASK_IDS } from "@voicemural/shared";
import { PROACTIVITY_STANZAS, PROFILE } from "./profile";
import {
  DRAFT_OPEN,
  FLOOR_SECTION,
  HEARING_SECTION,
  OPENING_NUDGE,
  OUTPUT_CONTRACT,
  READING_SECTION,
  SPARK_SECTION,
  SPEECH_ONLY_CONTRACT,
  SYSTEM_PROMPT,
  composeSystemPrompt,
} from "./prompt";
import {
  SESSION_OPENING_NUDGE,
  SESSION_PROFILE,
  SESSION_SYSTEM_PROMPT,
  STUDY_PROFILE,
  STUDY_SYSTEM_PROMPT,
  composeSessionPrompt,
} from "./study-agent";
import { PROLIFIC_TASKS, SESSION_TASKS, sessionTaskFor } from "./study-task";

describe("the study's agent", () => {
  const composed = composeSystemPrompt({
    base: STUDY_SYSTEM_PROMPT,
    profile: STUDY_PROFILE,
    sections: [PROLIFIC_TASKS.heat.agentSection],
  });

  it("handles the floor, the sparks and the transcription with the field agent's own words", () => {
    for (const section of [FLOOR_SECTION, SPARK_SECTION, HEARING_SECTION]) {
      expect(SYSTEM_PROMPT).toContain(section);
      expect(composed.prompt).toContain(section);
    }
  });

  it("is a conversational assistant at a desk, not a companion in a car", () => {
    // (The shared output contract mentions driving once, about draft handles.)
    expect(STUDY_SYSTEM_PROMPT + STUDY_PROFILE.stanza).not.toMatch(/driving|while they drive/i);
    expect(composed.prompt).not.toContain("One sentence, occasionally two");
    expect(composed.prompt).not.toContain(PROACTIVITY_STANZAS.forthcoming);
    expect(composed.proactivity).toBe("forthcoming");
    expect(composed.maxReplyWords).toBe(80);
  });

  it("keeps the output contract last, and the task before it", () => {
    expect(composed.prompt.endsWith(OUTPUT_CONTRACT)).toBe(true);
    expect(composed.prompt.indexOf("THE PROBLEM")).toBeLessThan(composed.prompt.indexOf(OUTPUT_CONTRACT));
  });

  it("leaves everyone else's agent exactly as it was", () => {
    const field = composeSystemPrompt();
    expect(field.prompt.startsWith(SYSTEM_PROMPT)).toBe(true);
    expect(field.prompt).toContain(PROACTIVITY_STANZAS[PROFILE.proactivity]);
    expect(field.prompt).not.toContain("You are Souffleur, a voice assistant");
  });
});

describe("the display study's agent", () => {
  const composed = composeSessionPrompt(SESSION_TASKS.trip);

  it("leaves the Prolific study's agent byte for byte as its data were collected under", () => {
    expect(createHash("sha256").update(STUDY_SYSTEM_PROMPT).digest("hex")).toBe(
      "dfa0d9b778e599857638349fe84528dc9160c6b7bbad3b053866c79d4c627756",
    );
  });

  it("hears and reads with the field agent's own words, and has no floor controls or sparks to explain", () => {
    for (const section of [READING_SECTION, HEARING_SECTION]) expect(composed.prompt).toContain(section);
    for (const section of [FLOOR_SECTION, SPARK_SECTION]) expect(composed.prompt).not.toContain(section);
  });

  it("is someone on a phone, who writes nothing down and never talks about the screen", () => {
    expect(SESSION_SYSTEM_PROMPT + SESSION_PROFILE.stanza).toMatch(/holding their phone/);
    expect(SESSION_SYSTEM_PROMPT + SESSION_PROFILE.stanza).not.toMatch(/computer|desk|driving|the plan below/i);
    expect(SESSION_SYSTEM_PROMPT).toContain("You cannot see it: never describe it");
    expect(SESSION_SYSTEM_PROMPT).toContain("cannot write anything down");
    expect(composed.maxReplyWords).toBe(60);
    expect(composed.proactivity).toBe("forthcoming");
  });

  it("ends with the speech-only contract, after the task, and says nothing about drafts", () => {
    expect(composed.prompt.endsWith(SPEECH_ONLY_CONTRACT)).toBe(true);
    expect(composed.prompt.indexOf("THE PROBLEM")).toBeLessThan(composed.prompt.indexOf(SPEECH_ONLY_CONTRACT));
    expect(composed.prompt).not.toContain(DRAFT_OPEN);
    expect(composed.prompt).not.toMatch(/the drafts from this drive|somebody driving|WHEN THEY ASK FOR SOMETHING TO KEEP/);
  });

  it("has no name of its own, and says it is the study's assistant if asked", () => {
    expect(composed.prompt).not.toMatch(/souffleur/i);
    expect(SESSION_SYSTEM_PROMPT).toContain("say you are the assistant for this study");
  });

  it("opens without a drive or a background to offer a next step from", () => {
    expect(SESSION_OPENING_NUDGE).not.toBe(OPENING_NUDGE);
    expect(SESSION_OPENING_NUDGE).not.toMatch(/drive|background/i);
    expect(SESSION_OPENING_NUDGE).toMatch(/one short sentence/);
  });

  it("has one task per id, each of three parts and a similar length", () => {
    expect(Object.keys(SESSION_TASKS).sort()).toEqual([...SESSION_TASK_IDS].sort());
    const lengths = Object.values(SESSION_TASKS).map((t) => t.brief.length);
    for (const task of Object.values(SESSION_TASKS)) {
      expect(task.prompts).toHaveLength(3);
      expect(task.agentSection).toContain("Never summarise the conversation");
      expect(task.agentSection).not.toMatch(/draft|plan titled/i);
    }
    expect(Math.max(...lengths) / Math.min(...lengths)).toBeLessThan(1.25);
    expect(sessionTaskFor("move")).toBe(SESSION_TASKS.move);
    expect(sessionTaskFor("heat")).toBeNull();
  });
});
