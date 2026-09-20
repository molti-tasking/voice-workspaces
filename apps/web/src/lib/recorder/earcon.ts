"use client";

/**
 * The sound a drive makes when it starts, stops, and finds its voice.
 *
 * WHY SOUND AT ALL, in a repository that argues against filling silence. The
 * premise of the whole system is that the person's eyes and hands are on
 * something else, and every confirmation up to now was visual: the button
 * changes colour, a level meter appears inside it, the timer starts. All of
 * that is invisible to somebody who has just put the phone in a cradle and
 * looked back at the road, which is precisely the person this is for. Pilot 01
 * gave the same feedback from the other end — the participant could not tell
 * that recording had started.
 *
 * So there are three earcons, and there will not be a fourth:
 *
 * - `started`   two rising notes. Recording has begun.
 * - `stopped`   two falling notes, the same interval inverted, so the pair is
 *               learnable in one drive rather than memorised.
 * - `ready`     one soft high note, once per drive, when talk-back is actually
 *               connected and listening. It is the audible form of the thing
 *               the status pills only ever show when it is BROKEN — and the
 *               difference between "it is recording" and "it can hear me" is
 *               the difference the participant was actually unsure about.
 *
 * WHY NOT SPEECH. A spoken "recording started" needs the TTS, the network and
 * the container, so it would arrive seconds late and be absent exactly when
 * things are going wrong. A tone is local, instant, and works with the
 * conversation switched off entirely.
 *
 * SHORT, AND QUIET. Around a fifth of a second, at a fraction of full scale,
 * with a raised-cosine envelope so nothing clicks. Long or loud would make it
 * an event in the car rather than a confirmation of one.
 *
 * WHAT IT COSTS THE LEDGER. The start tone is played as the recorder flips to
 * `recording`, which is a tick before the first chunk opens, so it is at worst
 * clipped at the very start of chunk 0; the others land inside the recording
 * and go through the microphone like any other sound in the car. None of them
 * is speech, so none of them transcribes to words — and the alternative was a
 * participant who could not tell the system was on.
 *
 * NEVER THROWS, EVER. Audio is a nicety; recording is not. Every path here is
 * wrapped, because a browser that refuses to make a sound must not be able to
 * stop a drive.
 */

/** One note: when it starts relative to the earcon, how long, how high. */
export interface Note {
  atMs: number;
  durationMs: number;
  hz: number;
}

export type EarconName = "started" | "stopped" | "ready";

/**
 * The three earcons, as data.
 *
 * A perfect fourth apart (A5→D6), which is wide enough to read as a deliberate
 * pair through a phone speaker in a moving car and small enough not to sound
 * like an alarm. `stopped` is the same two notes in the other order, so the
 * two are one thing to learn. `ready` is a single quieter note an octave up,
 * which nothing else in the drive sounds like.
 */
export const EARCONS: Record<EarconName, readonly Note[]> = {
  started: [
    { atMs: 0, durationMs: 110, hz: 880 },
    { atMs: 120, durationMs: 150, hz: 1_175 },
  ],
  stopped: [
    { atMs: 0, durationMs: 110, hz: 1_175 },
    { atMs: 120, durationMs: 150, hz: 880 },
  ],
  ready: [{ atMs: 0, durationMs: 90, hz: 1_568 }],
};

/** Peak gain per earcon. `ready` is deliberately under the transport pair. */
export const PEAK_GAIN: Record<EarconName, number> = {
  started: 0.12,
  stopped: 0.12,
  ready: 0.06,
};

/** How long an earcon lasts end to end, in ms. Pure; used by the tests. */
export function earconDurationMs(name: EarconName): number {
  return EARCONS[name].reduce((end, note) => Math.max(end, note.atMs + note.durationMs), 0);
}

/**
 * The haptic pattern that goes with each earcon, in `navigator.vibrate` form.
 *
 * Android only in practice — iOS Safari has no vibrate — so it is an addition
 * to the sound and never a replacement for it. A phone in a cradle transmits
 * almost nothing to the person anyway; a phone in a hand transmits everything,
 * and that is the case where a tone may be missed in traffic noise.
 */
export const HAPTICS: Record<EarconName, readonly number[]> = {
  started: [40, 60, 40],
  stopped: [90],
  ready: [],
};

/**
 * ONE context for the whole app, created on the first earcon.
 *
 * A browser will not let a page make a sound before the person has interacted
 * with it, and the first earcon always comes from a tap on Record — so the
 * context is created inside that gesture and stays unlocked for the drive.
 * Creating one per earcon would eventually exhaust the browser's limit.
 */
let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    context ??= new Ctor();
    // Suspended is the normal state for a context created outside a gesture,
    // and for one the browser parked while the tab was in the background.
    if (context.state === "suspended") void context.resume().catch(() => undefined);
    return context;
  } catch {
    return null;
  }
}

/**
 * Play one earcon, and buzz if the device can.
 *
 * Synchronous and fire-and-forget: it schedules the notes and returns. The
 * caller is in the middle of starting or stopping a recording and must not
 * wait for a sound.
 */
export function earcon(name: EarconName): void {
  try {
    const ctx = audio();
    if (ctx) {
      const peak = PEAK_GAIN[name];
      const startAt = ctx.currentTime + 0.01;
      for (const note of EARCONS[name]) {
        const at = startAt + note.atMs / 1_000;
        const until = at + note.durationMs / 1_000;

        const osc = ctx.createOscillator();
        // A sine, not a square: a pure tone carries through road noise without
        // the harsh edge that makes a beep read as an error.
        osc.type = "sine";
        osc.frequency.value = note.hz;

        // A raised edge at each end. A gain that jumps from 0 is a click, and
        // a click is the one sound here that would be genuinely unpleasant.
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(peak, at + 0.015);
        gain.gain.setValueAtTime(peak, until - 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, until);

        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(until + 0.01);
      }
    }
  } catch {
    // No audio on this device, or the browser refused. The visual state and
    // the haptic below still say what happened.
  }

  try {
    const pattern = HAPTICS[name];
    if (pattern.length > 0) navigator.vibrate?.([...pattern]);
  } catch {
    // No vibrator, or a browser that throws rather than returning false.
  }
}
