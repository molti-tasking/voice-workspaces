import { describe, expect, it } from "vitest";
import {
  PROACTIVITY_STANZAS,
  PROACTIVE_AFTER_SECS,
  SETTINGS,
  SETTING_PROFILES,
  asSetting,
  settingProfile,
} from "./setting";

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

  /**
   * The mistake this catches: the panel's at-110km/h rules were being applied
   * to someone sitting at a desk, because `displayAllowed` was doing double
   * duty as "is there a screen" and "how should it look".
   */
  it("only reads at desk density where there is room to read", () => {
    for (const profile of Object.values(SETTING_PROFILES)) {
      if (profile.density === "read") {
        expect(profile.displayAllowed).toBe(true);
        expect(profile.maxContentCues).toBeGreaterThan(3);
      }
    }
  });

  it("gives a reading display more room than a glancing one", () => {
    const glancing = Object.values(SETTING_PROFILES).filter(
      (p) => p.displayAllowed && p.density === "glance",
    );
    const reading = Object.values(SETTING_PROFILES).filter((p) => p.density === "read");
    for (const r of reading) {
      for (const g of glancing) {
        expect(r.maxContentCues).toBeGreaterThan(g.maxContentCues);
      }
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

  /**
   * The proactive engine's patience, mirroring the prompt-level table the
   * container reads. A car gets the longest silence before an unprompted
   * turn is even offered; a desk the shortest — the same ordering as
   * everything else the proactivity level governs, so the engine can never be
   * more forthcoming than the prompt has already told the model to be.
   */
  it("waits longest before an unprompted turn where the least attention is spare", () => {
    expect(PROACTIVE_AFTER_SECS.quiet).toBeGreaterThan(PROACTIVE_AFTER_SECS.occasional);
    expect(PROACTIVE_AFTER_SECS.occasional).toBeGreaterThan(PROACTIVE_AFTER_SECS.forthcoming);
    for (const level of Object.keys(PROACTIVITY_STANZAS)) {
      expect(PROACTIVE_AFTER_SECS[level as keyof typeof PROACTIVE_AFTER_SECS]).toBeGreaterThan(0);
    }
  });
});
