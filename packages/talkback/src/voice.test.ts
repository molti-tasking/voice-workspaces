import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_ID,
  VOICES,
  VOICE_IDS,
  asVoiceId,
  isKnownVoice,
  ratingVoiceIdFor,
  voiceProfile,
} from "./voice";

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

describe("the rating voice", () => {
  it("is never the voice the drive is already speaking in", () => {
    // The different voice IS the mode indicator — a driver cannot look at a
    // screen — so a rating voice equal to the agent's silently removes it.
    for (const voice of VOICE_IDS) {
      expect(ratingVoiceIdFor(voice)).not.toBe(voice);
      expect(VOICE_IDS).toContain(ratingVoiceIdFor(voice));
    }
  });

  it("is the same one every time, so a participant hears one feedback channel", () => {
    expect(ratingVoiceIdFor(DEFAULT_VOICE_ID)).toBe(ratingVoiceIdFor(DEFAULT_VOICE_ID));
    // A drive with no stored choice — and one whose stored choice has since
    // left the catalogue — still gets a real voice rather than an empty string.
    for (const junk of [null, undefined, "", "retired-voice"]) {
      expect(VOICE_IDS).toContain(ratingVoiceIdFor(junk));
    }
  });
});
