import { describe, expect, it } from "vitest";
import {
  DEFAULT_VOICE_ID,
  VOICES,
  VOICE_IDS,
  asVoiceId,
  isKnownVoice,
  nativeVoicesByLanguage,
  voiceFor,
  voiceProfile,
  voicesForPicker,
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

describe("voiceFor", () => {
  it("keeps the choice when no language is known yet", () => {
    expect(voiceFor(null, DEFAULT_VOICE_ID)).toBe(DEFAULT_VOICE_ID);
  });

  it("keeps the choice when the catalogue has no native speaker for the language", () => {
    const native = nativeVoicesByLanguage();
    for (const code of ["da", "de", "es"]) {
      const expected = native[code] ?? DEFAULT_VOICE_ID;
      expect(voiceFor(code, DEFAULT_VOICE_ID)).toBe(expected);
    }
  });

  it("keeps a chosen voice that is already native to the language", () => {
    for (const v of VOICES) {
      expect(voiceFor(v.language, v.id)).toBe(v.id);
    }
  });

  it("offers native speakers first once a language is pinned", () => {
    for (const code of ["da", "de", "es"]) {
      const offered = voicesForPicker(code);
      const firstOther = offered.findIndex((v) => v.language !== code);
      const lastNative = offered.map((v) => v.language).lastIndexOf(code);
      expect(lastNative < firstOther || firstOther === -1).toBe(true);
    }
    expect(voicesForPicker(null)).toEqual([...VOICES]);
  });
});
