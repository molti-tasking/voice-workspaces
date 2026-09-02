"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { CaptureSetting } from "@voicemural/shared";
// The `/setting` subpath, not the package index — see recorder-client.tsx.
import { SETTINGS } from "@voicemural/talkback/setting";

/**
 * The remembered setting, as an external store.
 *
 * `localStorage` is an external system, and reading it during render would
 * either mismatch the server's HTML or force a cascading re-render on mount.
 * `useSyncExternalStore` is what React provides for exactly this: the server
 * snapshot is the safe default, the client snapshot is what was stored, and
 * React reconciles the two itself.
 *
 * Per-browser rather than per-account on purpose. The setting is a fact about
 * the device's situation, and the phone in a cradle and the laptop on a desk
 * are not the same situation even for the same person.
 */
const KEY = "voicemural.setting";

/** The safest option, and the stance the base prompt was written with. */
const DEFAULT: CaptureSetting = "driving";

const listeners = new Set<() => void>();

/** Cached so `getSnapshot` returns a stable value between writes. */
let cached: CaptureSetting | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  // Another tab changing it should not leave this one out of date.
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

function getSnapshot(): CaptureSetting {
  if (cached !== null) return cached;
  try {
    const stored = window.localStorage.getItem(KEY);
    cached = (SETTINGS as readonly string[]).includes(stored ?? "")
      ? (stored as CaptureSetting)
      : DEFAULT;
  } catch {
    // Private mode, or site data blocked. The default is the safe answer.
    cached = DEFAULT;
  }
  return cached;
}

function getServerSnapshot(): CaptureSetting {
  return DEFAULT;
}

export function useSetting(): [CaptureSetting, (next: CaptureSetting) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback((next: CaptureSetting) => {
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
