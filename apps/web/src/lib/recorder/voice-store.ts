"use client";

import { useCallback, useSyncExternalStore } from "react";
// The `/voice` subpath, not the package index — see recorder-client.tsx.
import { DEFAULT_VOICE_ID, isKnownVoice } from "@voicemural/talkback/voice";

/**
 * The remembered voice, as an external store.
 *
 * `localStorage` is an external system and `useSyncExternalStore` is how React
 * reads one without a hydration mismatch. Per-browser rather than per-account,
 * like the setting — a voice that suits car speakers may not suit headphones.
 *
 * A stored id that is no longer in the catalogue falls back to the default
 * rather than being sent: the server would null it anyway, and the picker
 * should never show a selection it does not offer.
 */
const KEY = "voicemural.voice";

const listeners = new Set<() => void>();

let cached: string | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      cached = null;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): string {
  if (cached !== null) return cached;
  try {
    const stored = window.localStorage.getItem(KEY);
    cached = isKnownVoice(stored) ? stored : DEFAULT_VOICE_ID;
  } catch {
    cached = DEFAULT_VOICE_ID;
  }
  return cached;
}

function getServerSnapshot(): string {
  return DEFAULT_VOICE_ID;
}

export function useVoice(): [string, (next: string) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback((next: string) => {
    if (!isKnownVoice(next)) return;
    cached = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // The choice still holds for this recording; it just is not remembered.
    }
    for (const listener of listeners) listener();
  }, []);

  return [value, set];
}
