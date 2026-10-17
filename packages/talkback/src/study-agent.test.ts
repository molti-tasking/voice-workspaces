import { describe, expect, it } from "vitest";
import { PROACTIVITY_STANZAS, PROFILE } from "./profile";
import {
  FLOOR_SECTION,
  HEARING_SECTION,
  OUTPUT_CONTRACT,
  SPARK_SECTION,
  SYSTEM_PROMPT,
  composeSystemPrompt,
} from "./prompt";
import { STUDY_PROFILE, STUDY_SYSTEM_PROMPT } from "./study-agent";
import { PROLIFIC_TASKS } from "./study-task";

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
