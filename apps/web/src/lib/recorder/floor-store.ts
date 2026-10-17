"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Who may talk, remembered on this device: Lock ("locked") or Normal ("open").
 *
 * Mirrors language-store.ts: per-browser rather than per-account, an external
 * store, and a stored value it does not recognise falls back rather than being
 * sent. The LAST USED mode is what the next drive starts in — someone who
 * locks the agent for every drive should not have to lock it again at the top
 * of each one, before it has already said its opening line.
 *
 * NOT a study condition. The person changes it during a drive as often as
 * they like, and the container records each change it applies (`floor_event`).
 */
export type Floor = "open" | "locked";

const KEY = "voicemural.floor";
const DEFAULT: Floor = "open";

const listeners = new Set<() => void>();

let cached: Floor | null = null;

function isFloor(value: unknown): value is Floor {
  return value === "open" || value === "locked";
}

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

function getSnapshot(): Floor {
  if (cached) return cached;
  try {
    const stored = window.localStorage.getItem(KEY);
    cached = isFloor(stored) ? stored : DEFAULT;
  } catch {
    cached = DEFAULT;
  }
  return cached;
}

function getServerSnapshot(): Floor {
  return DEFAULT;
}

/** The floor for this drive and the next: what the person last chose. */
export function useFloorPreference(): [Floor, (next: Floor) => void] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback((next: Floor) => {
    if (!isFloor(next)) return;
    cached = next;
    try {
      window.localStorage.setItem(KEY, next);
    } catch {
      // Still holds for this drive; it just is not remembered for the next.
    }
    for (const listener of listeners) listener();
  }, []);

  return [value, set];
}
