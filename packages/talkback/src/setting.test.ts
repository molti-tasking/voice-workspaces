import { describe, expect, it } from "vitest";
import { SETTINGS, SETTING_PROFILES, asSetting, settingProfile } from "./setting";

describe("setting profiles", () => {
  it("covers every setting exactly once", () => {
    expect(Object.keys(SETTING_PROFILES).sort()).toEqual([...SETTINGS].sort());
  });

  /**
   * One fact, read in two places. If a profile said "no screen" but still
   * allowed cues, the agent would tell someone driving there is nothing on
   * screen while the panel filled up behind the words.
   */
  it("keeps the cue budget consistent with whether a screen exists", () => {
    for (const profile of Object.values(SETTING_PROFILES)) {
      const cues = profile.maxContentCues + profile.maxDirectionCues;
      expect(cues > 0).toBe(profile.displayAllowed);
    }
  });

  it("never lets a reply cap fall to something unspeakably short", () => {
    for (const profile of Object.values(SETTING_PROFILES)) {
      expect(profile.maxReplyWords).toBeGreaterThanOrEqual(20);
      expect(profile.stanza.trim().length).toBeGreaterThan(0);
    }
  });

  it("falls back to driving for anything unrecognised", () => {
    expect(asSetting(null)).toBe("driving");
    expect(asSetting("nonsense")).toBe("driving");
    expect(settingProfile(undefined)).toBe(SETTING_PROFILES.driving);
    expect(asSetting("desk")).toBe("desk");
  });
});
