import { describe, expect, it } from "vitest";
import {
  EARCONS,
  HAPTICS,
  PEAK_GAIN,
  earconDurationMs,
  type EarconName,
} from "./earcon";

/**
 * The earcons as data, which is the only part of them a test can see.
 *
 * Scheduling oscillators needs a browser, and a test that mocks `AudioContext`
 * would only assert that the mock was called. What is worth pinning is the
 * design: that the pair is learnable, that none of them lasts long enough to
 * become an event in the car, and that the quiet one stays quiet.
 */

const NAMES: EarconName[] = ["started", "stopped", "ready"];

describe("earcons", () => {
  it("makes start and stop the same two notes in opposite order", () => {
    // Learnable in one drive rather than memorised: rising is on, falling is
    // off, and the interval is the same either way.
    const up = EARCONS.started.map((n) => n.hz);
    const down = EARCONS.stopped.map((n) => n.hz);
    expect(down).toEqual([...up].reverse());
    expect(up[0]).toBeLessThan(up[1]!);
  });

  it("keeps every earcon short enough to be a confirmation, not an event", () => {
    for (const name of NAMES) {
      expect(earconDurationMs(name), name).toBeLessThanOrEqual(300);
    }
    // And long enough to be heard through road noise at all.
    expect(earconDurationMs("started")).toBeGreaterThanOrEqual(150);
  });

  it("gives the good news less room than the state change", () => {
    // "It can hear you" is not a transport control, and should not sound like
    // one — it is quieter, shorter and a single note.
    expect(PEAK_GAIN.ready).toBeLessThan(PEAK_GAIN.started);
    expect(EARCONS.ready).toHaveLength(1);
    expect(earconDurationMs("ready")).toBeLessThan(earconDurationMs("started"));
  });

  it("stays in the range a phone speaker actually reproduces", () => {
    for (const name of NAMES) {
      for (const note of EARCONS[name]) {
        expect(note.hz, name).toBeGreaterThan(500);
        expect(note.hz, name).toBeLessThan(3_000);
        expect(note.durationMs, name).toBeGreaterThan(0);
      }
    }
  });

  it("never asks for a gain that would make a tone an alarm", () => {
    for (const name of NAMES) {
      expect(PEAK_GAIN[name], name).toBeGreaterThan(0);
      expect(PEAK_GAIN[name], name).toBeLessThanOrEqual(0.2);
    }
  });

  it("buzzes for the transport pair and not for the good news", () => {
    // A haptic is an addition to the tone where the phone is in a hand. The
    // `ready` note is not a state change and does not earn one.
    expect(HAPTICS.started.length).toBeGreaterThan(0);
    expect(HAPTICS.stopped.length).toBeGreaterThan(0);
    expect(HAPTICS.ready).toHaveLength(0);
  });
});
