"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CaptureSetting } from "@voicemural/shared";
import { DEFAULT_SETTING } from "@voicemural/talkback/setting";

/**
 * Where the person is, inferred rather than asked.
 *
 * The premise of every setting is that the voice interaction is not the
 * primary task — and a row of buttons to tap before starting is a task. So
 * the recorder reads the situation off the device and the person only
 * corrects it when it is wrong.
 *
 * Two signals, neither of which needs a permission prompt where it matters:
 *
 * - **Device class.** A fine pointer with hover and no touch points is a
 *   laptop or desktop: the screen is in front of them, so `desk`.
 * - **Motion.** On a phone, the accelerometer over the last few seconds.
 *   Walking is periodic — steps at one to three a second with real
 *   amplitude. Driving is aperiodic vibration and cornering. A phone that is
 *   still is either flat on a surface, which reads as `desk` (the screen is
 *   readable), or propped up, which reads as `hands_busy` (glanceable).
 *
 * Android exposes `devicemotion` without asking; iOS needs a one-off
 * permission that can only be requested from a tap, so it is requested on
 * the Record button and benefits the next recording. Without any motion data
 * the default is the base prompt's stance, `driving`, which is the safe one.
 *
 * Pure classifier, testable; the hook only feeds it samples.
 */

export interface MotionSample {
  /** ms */
  t: number;
  /** Linear acceleration magnitude, gravity removed, m/s². */
  a: number;
}

export interface MotionWindow {
  samples: readonly MotionSample[];
  /** Gravity as seen by the device, m/s². Null when unknown. */
  gravity: { x: number; y: number; z: number } | null;
}

export type SettingSource = "device" | "motion" | "default" | "chosen";

/** How much history the classifier looks at. */
export const WINDOW_MS = 4_000;
/** Below this many samples the window says nothing yet. */
const MIN_SAMPLES = 20;

/** Standard deviation of |a| above which the phone is being moved about. */
const MOVING_STD = 0.3;
/** Below which it is being held still, or lying somewhere. */
const STILL_STD = 0.15;
/** A step is a peak this far above the mean, m/s². */
const STEP_PROMINENCE = 0.8;
/** Two peaks closer than this are one step. */
const STEP_MIN_GAP_MS = 250;
/** Steps per second that read as walking. */
const WALKING_HZ: [number, number] = [1.2, 3.2];
/** |gz| above this of ~9.81 means the phone is lying flat. */
const FLAT_GZ = 8;

/**
 * Classify a window of motion, or null when the window cannot say.
 *
 * Null rather than a guess for the ambiguous band between still and moving,
 * so the caller keeps its last answer instead of flapping between two.
 */
export function classifyMotion(window: MotionWindow): CaptureSetting | null {
  const samples = window.samples;
  if (samples.length < MIN_SAMPLES) return null;

  const span = samples[samples.length - 1]!.t - samples[0]!.t;
  if (span < WINDOW_MS / 2) return null;

  const mean = samples.reduce((n, s) => n + s.a, 0) / samples.length;
  const variance = samples.reduce((n, s) => n + (s.a - mean) ** 2, 0) / samples.length;
  const std = Math.sqrt(variance);

  if (std > STILL_STD) {
    const stepsPerSecond = (countPeaks(samples, mean + STEP_PROMINENCE) / span) * 1000;
    if (
      std > 2 * MOVING_STD &&
      stepsPerSecond >= WALKING_HZ[0] &&
      stepsPerSecond <= WALKING_HZ[1]
    ) {
      return "walking";
    }
    if (std > MOVING_STD) return "driving";
    return null;
  }

  // Still. Flat on a surface reads as a screen in front of them; anything
  // propped or upright is a screen to glance at.
  const g = window.gravity;
  if (g && Math.abs(g.z) > FLAT_GZ) return "desk";
  return "hands_busy";
}

/** Local maxima above `threshold`, at least `STEP_MIN_GAP_MS` apart. */
function countPeaks(samples: readonly MotionSample[], threshold: number): number {
  let peaks = 0;
  let lastPeakAt = -Infinity;
  for (let i = 1; i < samples.length - 1; i += 1) {
    const s = samples[i]!;
    if (s.a <= threshold) continue;
    if (s.a < samples[i - 1]!.a || s.a < samples[i + 1]!.a) continue;
    if (s.t - lastPeakAt < STEP_MIN_GAP_MS) continue;
    peaks += 1;
    lastPeakAt = s.t;
  }
  return peaks;
}

/** A laptop or desktop: the screen is in front of them by construction. */
export function isDeskDevice(): boolean {
  if (typeof window === "undefined") return false;
  const fine = window.matchMedia?.("(pointer: fine) and (hover: hover)").matches ?? false;
  const touch = navigator.maxTouchPoints > 0;
  return fine && !touch;
}

type MotionEventCtor = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

/** Whether this browser gates the accelerometer behind a tap (iOS). */
function motionNeedsPermission(): boolean {
  if (typeof DeviceMotionEvent === "undefined") return false;
  return typeof (DeviceMotionEvent as MotionEventCtor).requestPermission === "function";
}

export interface DetectedSetting {
  setting: CaptureSetting;
  source: SettingSource;
  /**
   * Ask iOS for the accelerometer. Must be called from a tap; a no-op
   * everywhere else. Resolves once the answer is in, granted or not.
   */
  requestMotion: () => Promise<void>;
}

/**
 * The inferred setting, kept current while idle and frozen while recording.
 *
 * `enabled` false stops sampling: the setting is fixed at session creation
 * and a classification that kept changing underneath a recording would only
 * mislead the person about what the session ran under.
 */
export function useDetectedSetting({ enabled }: { enabled: boolean }): DetectedSetting {
  // Device class first: a laptop needs no sensor to answer. Read as an
  // external store so the server renders the default and the client's answer
  // arrives without a state write inside an effect.
  const desk = useSyncExternalStore(subscribeNever, isDeskDevice, () => false);

  const [detected, setDetected] = useState<{ setting: CaptureSetting; source: SettingSource }>({
    setting: DEFAULT_SETTING,
    source: "default",
  });
  /** iOS only: set from the tap that asked. Elsewhere motion needs no answer. */
  const [granted, setGranted] = useState(false);

  const samples = useRef<MotionSample[]>([]);
  const gravity = useRef<{ x: number; y: number; z: number } | null>(null);

  useEffect(() => {
    if (!enabled || desk) return;
    if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) return;
    if (motionNeedsPermission() && !granted) return;

    const onMotion = (event: DeviceMotionEvent) => {
      const now = Date.now();
      const lin = event.acceleration;
      const withG = event.accelerationIncludingGravity;

      if (withG && lin) {
        gravity.current = {
          x: (withG.x ?? 0) - (lin.x ?? 0),
          y: (withG.y ?? 0) - (lin.y ?? 0),
          z: (withG.z ?? 0) - (lin.z ?? 0),
        };
      } else if (withG) {
        gravity.current = { x: withG.x ?? 0, y: withG.y ?? 0, z: withG.z ?? 0 };
      }

      let a: number | null = null;
      if (lin && (lin.x !== null || lin.y !== null || lin.z !== null)) {
        a = Math.hypot(lin.x ?? 0, lin.y ?? 0, lin.z ?? 0);
      } else if (withG) {
        a = Math.abs(Math.hypot(withG.x ?? 0, withG.y ?? 0, withG.z ?? 0) - 9.81);
      }
      if (a === null) return;

      const list = samples.current;
      list.push({ t: now, a });
      while (list.length > 0 && now - list[0]!.t > WINDOW_MS) list.shift();
    };

    window.addEventListener("devicemotion", onMotion);

    const timer = setInterval(() => {
      const verdict = classifyMotion({ samples: samples.current, gravity: gravity.current });
      if (!verdict) return;
      setDetected((previous) =>
        previous.setting === verdict && previous.source === "motion"
          ? previous
          : { setting: verdict, source: "motion" },
      );
    }, 1_000);

    return () => {
      window.removeEventListener("devicemotion", onMotion);
      clearInterval(timer);
    };
  }, [enabled, desk, granted]);

  const requestMotion = useCallback(async () => {
    if (granted || desk || !motionNeedsPermission()) return;
    try {
      const answer = await (DeviceMotionEvent as MotionEventCtor).requestPermission?.();
      if (answer === "granted") setGranted(true);
    } catch {
      // Declined, or not from a tap. The default stands.
    }
  }, [granted, desk]);

  if (desk) return { setting: "desk", source: "device", requestMotion };
  return { ...detected, requestMotion };
}

function subscribeNever(): () => void {
  return () => {};
}
