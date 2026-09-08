import { describe, expect, it } from "vitest";
import { WINDOW_MS, classifyMotion, type MotionSample } from "./detect-setting";

/** A window of samples at 50 Hz from a generator of |a| over time. */
function window(f: (t: number) => number, ms = WINDOW_MS): MotionSample[] {
  const out: MotionSample[] = [];
  for (let t = 0; t <= ms; t += 20) out.push({ t, a: f(t) });
  return out;
}

const FLAT = { x: 0, y: 0, z: 9.7 };
const PROPPED = { x: 0, y: 8.5, z: 4.8 };

describe("classifyMotion", () => {
  it("says nothing until it has seen enough", () => {
    expect(classifyMotion({ samples: [], gravity: FLAT })).toBeNull();
    expect(classifyMotion({ samples: window(() => 0, 500), gravity: FLAT })).toBeNull();
  });

  it("reads a still phone lying flat as a desk", () => {
    const still = window((t) => 0.03 * Math.sin(t / 90));
    expect(classifyMotion({ samples: still, gravity: FLAT })).toBe("desk");
  });

  it("reads a still phone propped up as hands busy", () => {
    const still = window((t) => 0.03 * Math.sin(t / 90));
    expect(classifyMotion({ samples: still, gravity: PROPPED })).toBe("hands_busy");
    expect(classifyMotion({ samples: still, gravity: null })).toBe("hands_busy");
  });

  it("reads steps at two a second as walking", () => {
    // 2 Hz sinusoid, ±2 m/s², plus a little noise.
    const steps = window((t) => 2 + 2 * Math.sin((2 * Math.PI * t) / 500) + 0.1 * Math.sin(t / 7));
    expect(classifyMotion({ samples: steps, gravity: PROPPED })).toBe("walking");
  });

  it("reads aperiodic vibration as driving", () => {
    // Pseudo-random jitter with no beat: what a cradle sees on a road.
    let seed = 7;
    const noise = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const road = window(() => 0.4 + (noise() - 0.5) * 1.6);
    expect(classifyMotion({ samples: road, gravity: PROPPED })).toBe("driving");
  });

  it("stays quiet in the band between still and moving, rather than flapping", () => {
    const slight = window((t) => 0.3 * Math.sin(t / 300));
    expect(classifyMotion({ samples: slight, gravity: FLAT })).toBeNull();
  });
});
