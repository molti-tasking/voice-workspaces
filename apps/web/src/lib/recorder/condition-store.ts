"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { StudyCondition } from "@voicemural/shared";

/**
 * A per-drive override of the study condition, for the pilot.
 *
 * WHY IT EXISTS. The next pilot is a cold-start test: the same person, two
 * drives an hour apart, agenda offers on in one and off in the other. The
 * condition is a property of the participant (`user.study_condition`) copied
 * onto each drive at insert, which is exactly right for a seven-day phase and
 * useless for two drives in an afternoon — flipping it means a database write
 * between them, with the researcher in a car.
 *
 * WHO IT WORKS FOR. Nobody, unless two separate switches are on: this store is
 * only rendered when the bundle was built with `NEXT_PUBLIC_STUDY_TOGGLES`,
 * and the server only honours the override for accounts listed in
 * `STUDY_PILOT_USER_IDS`. A participant whose arm could be flipped from their
 * own browser is a participant whose phase cannot be analysed, and the client
 * is not a trustworthy place to decide a study condition — so it asks, and the
 * server decides.
 *
 * Sparse, like the researcher's template: only the flags actually toggled are
 * sent, and everything else comes from the participant's condition as usual.
 *
 * `localStorage` rather than component state, for the same reason the voice
 * and language pickers use it: the dock can start a drive from any page, and a
 * choice that evaporated on navigation would be a choice nobody could rely on.
 */
const KEY = "voicemural.condition-override";

export const STUDY_TOGGLES_ENABLED = process.env.NEXT_PUBLIC_STUDY_TOGGLES === "true";

/** The flags a drive may override. The rest of a condition is not per-drive. */
export const TOGGLEABLE = ["proactiveOffers", "agendaOffers", "voiceMacroOffers"] as const;
export type ToggleableFlag = (typeof TOGGLEABLE)[number];

export type ConditionOverride = Partial<Pick<StudyCondition, ToggleableFlag>>;

const listeners = new Set<() => void>();

/** Cached so `getSnapshot` returns a stable reference between writes. */
let cached: ConditionOverride | null = null;

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

const EMPTY: ConditionOverride = Object.freeze({});

function getSnapshot(): ConditionOverride {
  if (cached !== null) return cached;
  try {
    const stored = window.localStorage.getItem(KEY);
    const parsed = stored ? (JSON.parse(stored) as Record<string, unknown>) : {};
    const next: ConditionOverride = {};
    for (const flag of TOGGLEABLE) {
      if (typeof parsed[flag] === "boolean") next[flag] = parsed[flag];
    }
    cached = Object.keys(next).length > 0 ? next : EMPTY;
  } catch {
    cached = EMPTY;
  }
  return cached;
}

function getServerSnapshot(): ConditionOverride {
  return EMPTY;
}

export function useConditionOverride(): [
  ConditionOverride,
  (flag: ToggleableFlag, value: boolean | null) => void,
] {
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const set = useCallback((flag: ToggleableFlag, next: boolean | null) => {
    const current = { ...getSnapshot() };
    // Null clears the flag rather than setting it false: "not overridden" and
    // "overridden to off" are different instructions to the server, and only
    // one of them should survive into the drive's stored condition.
    if (next === null) delete current[flag];
    else current[flag] = next;
    cached = Object.keys(current).length > 0 ? current : EMPTY;
    try {
      window.localStorage.setItem(KEY, JSON.stringify(current));
    } catch {
      // The override still holds for this page; it just is not remembered.
    }
    for (const listener of listeners) listener();
  }, []);

  return [value, set];
}
