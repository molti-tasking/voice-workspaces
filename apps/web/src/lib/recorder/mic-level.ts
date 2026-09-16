"use client";

import { useEffect, type RefObject } from "react";
import { subscribeStream } from "./mic-bus";

/**
 * How loud the microphone is, right now, as a number the record button can
 * draw.
 *
 * Exists because a drive recorded from the wrong input is indistinguishable
 * from a working one until the transcript comes back empty: the chunks upload,
 * the timer runs, talk-back connects and then never answers. A level that moves
 * when you speak is the only check that works at a glance, before the minutes
 * are lost.
 *
 * It taps the recorder's own stream through `mic-bus`, so it measures exactly
 * the audio going into the ledger — after echo cancellation, noise suppression
 * and gain — and never opens a second capture.
 */

/** Below this is the room, not a voice. Noise suppression puts it well under. */
const FLOOR_DB = -55;
/** Ordinary speech at cradle distance, after the browser's gain control. */
const CEILING_DB = -15;

/** RMS of a float PCM frame (full scale = 1) mapped onto 0..1 in decibels. */
export function levelFromRms(rms: number): number {
  if (!(rms > 0)) return 0;
  const db = 20 * Math.log10(rms);
  return Math.min(1, Math.max(0, (db - FLOOR_DB) / (CEILING_DB - FLOOR_DB)));
}

/**
 * One animation frame of a meter's ballistics: rise quickly, fall slowly.
 *
 * Raw RMS flickers between syllables, and a flickering target reads as a
 * faulty one. Fast attack keeps the response to a word immediate; the slow
 * release is what lets the eye register that anything happened at all.
 */
export function nextLevel(previous: number, target: number): number {
  if (target > previous) return previous + (target - previous) * 0.5;
  return Math.max(target, previous * 0.9);
}

/**
 * Write the live level to `--vm-mic-level` on `ref`'s element, 0..1.
 *
 * A CSS variable rather than React state: this updates every frame for the
 * length of a drive, on a phone that is also holding a MediaRecorder open, and
 * nothing about it needs a render.
 */
export function useMicLevel(ref: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    let context: AudioContext | null = null;
    let frame = 0;
    let level = 0;

    // Safari may create the context suspended when it was not made inside the
    // tap that started recording. A suspended meter would sit at zero and say
    // "your microphone is silent" about a microphone that is fine, so the next
    // touch anywhere gets another chance to start it.
    const resume = () => void context?.resume().catch(() => undefined);

    const teardown = () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointerdown", resume);
      void context?.close().catch(() => undefined);
      context = null;
      level = 0;
      ref.current?.style.setProperty("--vm-mic-level", "0");
    };

    const unsubscribe = subscribeStream((stream) => {
      teardown();
      if (!stream || stream.getAudioTracks().length === 0) return;

      // Nothing here may throw into the recorder's publish path, and a meter
      // that cannot start is cosmetic: capture carries on without it.
      try {
        context = new AudioContext();
        const analyser = context.createAnalyser();
        analyser.fftSize = 512;
        context.createMediaStreamSource(stream).connect(analyser);
        if (context.state !== "running") {
          resume();
          document.addEventListener("pointerdown", resume);
        }

        const samples = new Float32Array(analyser.fftSize);
        const tick = () => {
          analyser.getFloatTimeDomainData(samples);
          let sum = 0;
          for (const sample of samples) sum += sample * sample;
          level = nextLevel(level, levelFromRms(Math.sqrt(sum / samples.length)));
          ref.current?.style.setProperty("--vm-mic-level", level.toFixed(3));
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        teardown();
      }
    });

    return () => {
      unsubscribe();
      teardown();
    };
  }, [ref]);
}
