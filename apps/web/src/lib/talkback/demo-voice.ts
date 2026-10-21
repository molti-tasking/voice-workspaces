"use client";

import type { Speaker } from "./conversation";

/**
 * Voices for the simulated conversation (`/record/demo`): the browser's own
 * speech synthesis, one voice for the person and another for Souffleur. No
 * audio files and no AI — the demo has to work when the AI is down.
 *
 * A line is spoken a sentence at a time: some browsers stop a long utterance
 * part-way (Chrome after about fifteen seconds), and the demo's longest lines
 * run longer than that.
 */

/** Voices to prefer, by name, where a system has them. */
const PREFERRED: Record<Speaker, readonly string[]> = {
  user: ["Samantha", "Google US English", "Karen", "Moira", "Tessa"],
  agent: ["Daniel", "Google UK English Male", "Arthur", "Alex", "Oliver"],
};

/** Speaking voice settings, so the two sides sound apart even with one voice. */
const DELIVERY: Record<Speaker, { rate: number; pitch: number }> = {
  user: { rate: 1.05, pitch: 1.05 },
  agent: { rate: 1, pitch: 0.9 },
};

interface VoiceLike {
  name: string;
  lang: string;
}

/** A voice each for the person and for Souffleur, different where possible. */
export function pickVoices<V extends VoiceLike>(voices: readonly V[]): { user: V | null; agent: V | null } {
  const english = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const pool = english.length > 0 ? english : voices;
  const preferred = (who: Speaker, not?: V | null) =>
    PREFERRED[who].map((name) => pool.find((v) => v.name.includes(name) && v !== not)).find(Boolean) ?? null;
  const user = preferred("user") ?? pool[0] ?? null;
  const agent = preferred("agent", user) ?? pool.find((v) => v !== user) ?? user;
  return { user, agent };
}

/**
 * The longest a line may take before the demo goes on without it, in ms: a
 * browser that accepts a line but never says it is done (no voices installed)
 * must not stop the conversation.
 */
export function speechLimitMs(text: string): number {
  return 2000 + 450 * text.split(/\s+/).filter(Boolean).length;
}

/** A line as the sentences it is spoken in. */
export function speechChunks(text: string): string[] {
  return text
    .split(/(?<=[.!?…;:])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface DemoVoice {
  /** Speech synthesis exists in this browser. */
  available: boolean;
  /** Speak a line; resolves when it has been said, or was cut off. */
  speak(text: string, who: Speaker): Promise<void>;
  pause(): void;
  resume(): void;
  /** Stop everything queued, now. */
  cancel(): void;
  /** Call from a tap: some browsers only speak once a gesture has started it. */
  unlock(): void;
}

export function createDemoVoice(): DemoVoice {
  const synth = typeof window !== "undefined" && "speechSynthesis" in window ? window.speechSynthesis : null;
  let chosen: ReturnType<typeof pickVoices<SpeechSynthesisVoice>> | null = null;
  // Voices load late in some browsers; asked for again until they are there.
  const voices = () => {
    if (!chosen && synth) {
      const all = synth.getVoices();
      if (all.length > 0) chosen = pickVoices(all);
    }
    return chosen;
  };

  return {
    available: synth !== null,
    speak(text, who) {
      if (!synth) return Promise.resolve();
      const chunks = speechChunks(text);
      if (chunks.length === 0) return Promise.resolve();
      const voice = voices()?.[who] ?? null;
      return new Promise((resolve) => {
        const limit = window.setTimeout(resolve, speechLimitMs(text));
        const finish = () => {
          window.clearTimeout(limit);
          resolve();
        };
        chunks.forEach((chunk, i) => {
          const utterance = new SpeechSynthesisUtterance(chunk);
          if (voice) {
            utterance.voice = voice;
            utterance.lang = voice.lang;
          }
          utterance.rate = DELIVERY[who].rate;
          utterance.pitch = DELIVERY[who].pitch;
          if (i === chunks.length - 1) {
            utterance.onend = finish;
            utterance.onerror = finish;
          }
          synth.speak(utterance);
        });
      });
    },
    pause: () => synth?.pause(),
    resume: () => synth?.resume(),
    cancel: () => synth?.cancel(),
    unlock() {
      if (!synth) return;
      synth.resume();
      synth.speak(new SpeechSynthesisUtterance(""));
    },
  };
}
