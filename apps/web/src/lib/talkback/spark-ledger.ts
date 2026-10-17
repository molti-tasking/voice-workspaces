import type { Conversation } from "./conversation";
import { sparksFor, type Spark, type SparkKind } from "./signals";

/**
 * Which sparks this drive offers now, which it has shown, and which the person
 * pulled.
 *
 * Per drive and above the router, beside the conversation it is about
 * (`capture-provider.tsx`): walking to the workspace and back must not offer a
 * pulled spark again, the container must keep hearing what is on offer (so a
 * spark can be asked for out loud with the phone untouched), and the subject
 * signals posted at Stop (`subject_signal.sparks_shown`, `sparks_pulled`) are
 * read from here. Keyed by ordinal, never by title.
 *
 * A pulled spark is done for its subject for the rest of the drive.
 */
export interface SparkLedgerState {
  /** What is on offer now, the most faded first. */
  offered: readonly Spark[];
  shown: ReadonlyMap<number, ReadonlySet<SparkKind>>;
  pulled: ReadonlyMap<number, SparkKind>;
}

export interface SparkLedger {
  subscribe(listener: () => void): () => void;
  getSnapshot(): SparkLedgerState;
  /** Work out what is on offer now. Notifies only when that changed. */
  refresh(conversation: Conversation, now: number): void;
  /** These were on screen. Idempotent. */
  noteShown(sparks: readonly { kind: SparkKind; ordinal: number }[]): void;
  notePulled(spark: { kind: SparkKind; ordinal: number }): void;
}

export const EMPTY_LEDGER: SparkLedgerState = { offered: [], shown: new Map(), pulled: new Map() };

/** What the container is told, and what decides whether the offer changed. */
export function offerKey(sparks: readonly { kind: SparkKind; ordinal: number }[]): string {
  return sparks.map((s) => `${s.ordinal}:${s.kind}`).join(",");
}

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
    refresh(conversation, now) {
      const offered = sparksFor(conversation, now, new Set(state.pulled.keys()));
      const changed =
        offerKey(offered) !== offerKey(state.offered) ||
        offered.some((s, i) => s.title !== state.offered[i]?.title || s.reason !== state.offered[i]?.reason);
      if (changed) set({ ...state, offered });
    },
    noteShown(sparks) {
      const fresh = sparks.filter((s) => !state.shown.get(s.ordinal)?.has(s.kind));
      if (fresh.length === 0) return;
      const shown = new Map(state.shown);
      for (const s of fresh) shown.set(s.ordinal, new Set([...(shown.get(s.ordinal) ?? []), s.kind]));
      set({ ...state, shown });
    },
    notePulled(spark) {
      if (state.pulled.has(spark.ordinal)) return;
      set({
        ...state,
        pulled: new Map(state.pulled).set(spark.ordinal, spark.kind),
        // Off the offer at once, not at the next refresh.
        offered: state.offered.filter((s) => s.ordinal !== spark.ordinal),
      });
    },
  };
}
