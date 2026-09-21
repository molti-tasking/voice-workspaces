import { describe, expect, it } from "vitest";
import { PROACTIVE_AFTER_SECS, PROACTIVITY_STANZAS, PROFILE } from "./profile";

describe("the conversation profile", () => {
  /**
   * One fact, read in two places. If the profile said "no screen" but still
   * allowed cues, the agent would tell someone there is nothing on screen
   * while the panel filled up behind the words.
   */
  it("keeps the cue budget consistent with whether a screen exists", () => {
    const cues = PROFILE.maxContentCues + PROFILE.maxDirectionCues;
    expect(cues > 0).toBe(PROFILE.displayAllowed);
  });

  it("only reads at a density where there is room to read", () => {
    if (PROFILE.density === "read") {
      expect(PROFILE.displayAllowed).toBe(true);
      expect(PROFILE.maxContentCues).toBeGreaterThan(3);
    }
  });

  it("never lets the reply cap fall to something unspeakably short", () => {
    expect(PROFILE.maxReplyWords).toBeGreaterThanOrEqual(20);
    expect(PROFILE.stanza.trim().length).toBeGreaterThan(0);
  });

  it("uses a proactivity level the engine knows", () => {
    expect(PROACTIVITY_STANZAS[PROFILE.proactivity]).toBeTruthy();
    expect(PROACTIVE_AFTER_SECS[PROFILE.proactivity]).toBeGreaterThan(0);
  });

  /**
   * The proactive engine's patience, mirroring the prompt-level table the
   * container reads. The quieter the level, the longer the silence before an
   * unprompted turn is even offered, so the engine can never be more
   * forthcoming than the prompt has already told the model to be.
   */
  it("waits longest before an unprompted turn at the quietest level", () => {
    expect(PROACTIVE_AFTER_SECS.quiet).toBeGreaterThan(PROACTIVE_AFTER_SECS.occasional);
    expect(PROACTIVE_AFTER_SECS.occasional).toBeGreaterThan(PROACTIVE_AFTER_SECS.forthcoming);
  });
});
