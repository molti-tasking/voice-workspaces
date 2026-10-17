import type { SparkKind } from "./signals";

/**
 * Which sparks this drive has shown, and which the person pulled.
 *
 * Per drive and above the router, beside the conversation it is about
 * (`capture-provider.tsx`): walking to the workspace and back must not offer a
 * pulled spark again, and the subject signals posted at Stop
 * (`subject_signal.sparks_shown`, `sparks_pulled`) are read from here. Keyed
 * by ordinal, never by title.
 *
 * A pulled spark is done for its subject for the rest of the drive.
 */
export interface SparkLedgerState {
  shown: ReadonlyMap<number, ReadonlySet<SparkKind>>;
  pulled: ReadonlyMap<number, SparkKind>;
}

export interface SparkLedger {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SparkLedgerState;
  /** These were on screen. Idempotent. */
  noteShown(sparks: readonly { kind: SparkKind; ordinal: number }[]): void;
  notePulled(spark: { kind: SparkKind; ordinal: number }): void;
}

export const EMPTY_LEDGER: SparkLedgerState = { shown: new Map(), pulled: new Map() };

export function createSparkLedger(): SparkLedger {
  let state = EMPTY_LEDGER;
  const listeners = new Set<() => void>();
  const set = (next: SparkLedgerState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => state,
    noteShown(sparks) {
      const fresh = sparks.filter((s) => !state.shown.get(s.ordinal)?.has(s.kind));
      if (fresh.length === 0) return;
      const shown = new Map(state.shown);
      for (const s of fresh) shown.set(s.ordinal, new Set([...(shown.get(s.ordinal) ?? []), s.kind]));
      set({ ...state, shown });
    },
    notePulled(spark) {
      if (state.pulled.has(spark.ordinal)) return;
      set({ ...state, pulled: new Map(state.pulled).set(spark.ordinal, spark.kind) });
    },
  };
}
