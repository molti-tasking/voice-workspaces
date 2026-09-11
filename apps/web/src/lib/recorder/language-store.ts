"use client";

import { useCallback, useSyncExternalStore } from "react";
// The `/language` subpath, not the package index — see recorder-client.tsx.
import { isKnownSttLanguage } from "@voicemural/talkback/language";

/**
 * The remembered transcription language, as an external store.
 *
 * Mirrors voice-store.ts: per-browser rather than per-account, remembered
 * across visits, and a stored value that is no longer in the catalogue falls
 * back rather than being sent.
 *
 * ONE DIFFERENCE: the fallback — and the default — is null, meaning
 * AUTO-DETECT. That is a real choice the picker offers ("Auto"), not merely
 * the absence of one: the corpus is mixed German/English and detection is the
 * correct default for it.
 */
const KEY = "voicemural.sttLanguage";

const listeners = new Set<() => void>();

let cached: string | null = null;
// Null is a legitimate cached value here, so "computed" needs its own flag
// rather than borrowing the voice store's null-means-unloaded trick.
let loaded = false;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) {
      cached = null;
      loaded = false;
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function getSnapshot(): string | null {
  if (loaded) return cached;
  try {
    const stored = window.localStorage.getItem(KEY);
    cached = isKnownSttLanguage(stored) ? stored : null;
  } catch {
    cached = null;
  }
  loaded = true;
  return cached;
}

function getServerSnapshot(): string | null {
  return null;
}

/** The language for the next recording: a catalogue code, or null for auto. */
export function useSttLanguage(): [string | null, (next: string | null) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback((next: string | null) => {
    if (next !== null && !isKnownSttLanguage(next)) return;
    cached = next;
    loaded = true;
    try {
      if (next === null) window.localStorage.removeItem(KEY);
      else window.localStorage.setItem(KEY, next);
    } catch {
      // The choice still holds for this recording; it just is not remembered.
    }
    for (const listener of listeners) listener();
  }, []);

  return [value, set];
}
