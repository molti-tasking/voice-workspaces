"use client";

import { useSyncExternalStore } from "react";

/**
 * A string kept in this browser's storage, readable during render.
 *
 * `useSyncExternalStore` rather than state filled in from an effect: the
 * server renders `null`, the browser reads storage on hydration, and React
 * reconciles the two without a second render pass. Writes notify every
 * reader in this tab; the `storage` event covers other tabs.
 *
 * Storage can be missing or throw (private windows, blocked site data). Then
 * values live in memory for as long as the tab does — nothing persists, and
 * nothing breaks.
 */

const memory = new Map<string, string>();
const EVENT = "souffleur:local-value";

export function readLocalValue(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

export function writeLocalValue(key: string, value: string): void {
  memory.set(key, value);
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* kept in memory above */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(EVENT, onChange);
  };
}

export function useLocalValue(key: string): string | null {
  return useSyncExternalStore(
    subscribe,
    () => readLocalValue(key),
    () => null,
  );
}
