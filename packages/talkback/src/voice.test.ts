import { describe, expect, it } from "vitest";
import { DEFAULT_VOICE_ID, VOICES, VOICE_IDS, asVoiceId, isKnownVoice, voiceProfile } from "./voice";

describe("the voice catalogue", () => {
  it("has distinct ids and a default drawn from it", () => {
    expect(new Set(VOICE_IDS).size).toBe(VOICES.length);
    expect(VOICE_IDS).toContain(DEFAULT_VOICE_ID);
  });

  it("narrows an untrusted value to a catalogue id or null", () => {
    expect(asVoiceId(DEFAULT_VOICE_ID)).toBe(DEFAULT_VOICE_ID);
    for (const junk of [undefined, null, "", "not-a-voice", DEFAULT_VOICE_ID.toLowerCase() + "x"]) {
      expect(asVoiceId(junk)).toBeNull();
      expect(isKnownVoice(junk)).toBe(false);
    }
  });

  it("finds a profile by id", () => {
    expect(voiceProfile(VOICES[1]!.id)?.label).toBe(VOICES[1]!.label);
    expect(voiceProfile("nope")).toBeNull();
  });
});
