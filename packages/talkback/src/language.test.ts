import { describe, expect, it } from "vitest";
import {
  STT_LANGUAGES,
  STT_LANGUAGE_CODES,
  asSttLanguage,
  isKnownSttLanguage,
  sttLanguageProfile,
} from "./language";

describe("the STT language catalogue", () => {
  it("has distinct codes and offers German alongside English", () => {
    expect(new Set(STT_LANGUAGE_CODES).size).toBe(STT_LANGUAGES.length);
    expect(STT_LANGUAGE_CODES).toContain("de");
    expect(STT_LANGUAGE_CODES).toContain("en");
  });

  it("narrows an untrusted value to a catalogue code or null", () => {
    expect(asSttLanguage("de")).toBe("de");
    for (const junk of [undefined, null, "", "auto", "DE", "english", "de-DE", "de_AT"]) {
      expect(asSttLanguage(junk)).toBeNull();
      expect(isKnownSttLanguage(junk)).toBe(false);
    }
  });

  it("finds a profile by code", () => {
    expect(sttLanguageProfile("de")?.label).toBe("Deutsch");
    expect(sttLanguageProfile("nope")).toBeNull();
  });
});
