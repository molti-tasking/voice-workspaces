"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { EMPTY_CONVERSATION, type ConversationStore } from "@/lib/talkback/conversation";
import { sparksFor, type Spark, type SparkKind } from "@/lib/talkback/signals";
import { EMPTY_LEDGER, type SparkLedger } from "@/lib/talkback/spark-ledger";
import type { SparkRequest } from "@/lib/talkback/types";
import type { PokeResult } from "@/lib/talkback/use-talkback";
import { POKE_NOTES } from "./floor-controls";

/**
 * The sparks on offer: at most three short questions about the subjects of
 * this drive, for the person to pull (`signals.ts`).
 *
 * AN OFFER, PULLED THROUGH THE POKE THEY ALREADY USE. A tap is a poke that
 * carries the spark; the agent then asks that question about that subject and
 * does not answer it itself. Nothing here ever makes the agent speak on its
 * own, and under Lock the chips just sit there — no sound, no motion beyond
 * appearing. A pulled spark is done for its subject for the rest of the drive,
 * and stays at the end of the row, greyed, so they can see what they asked.
 *
 * NOT FOR WHILE MOVING. `/study` says never to touch or read the phone while
 * driving; in the car a spark is pulled by voice. These are for a parked car,
 * a walk, the dishes.
 *
 * Each chip is at least 44px tall, names its subject, and says why it is
 * offered in a line under the question — in words, never a number. Inside
 * `ph-no-capture`, because the subject names are theirs.
 */

/** What each kind asks, as a chip says it. The agent words the real question. */
const SPARK_LABELS: Record<SparkKind, string> = {
  say_back: "Say it back in your own words",
  decide: "Decide it now",
  unsure: "What makes you unsure?",
  revisit: "Go back to it",
};

/** How long what became of a pull stays under the chips. */
const NOTE_MS = 2500;
/** How often the ranking is looked at again: a subject fades with time, not only with talk. */
const TICK_MS = 30_000;

export function SparkChips({
  store,
  ledger,
  connected,
  speaking,
  onPull,
}: {
  store: ConversationStore;
  ledger: SparkLedger;
  /** Talk-back is up: a pull can reach the agent. */
  connected: boolean;
  /** The agent is talking: nothing to pull into. */
  speaking: boolean;
  onPull: (spark: SparkRequest) => Promise<PokeResult | null>;
}) {
  const conversation = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => EMPTY_CONVERSATION,
  );
  const spent = useSyncExternalStore(ledger.subscribe, ledger.getSnapshot, () => EMPTY_LEDGER);
  const now = useNow(TICK_MS);
  const [note, setNote] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

  const sparks = useMemo(
    () => sparksFor(conversation, now, new Set(spent.pulled.keys())),
    [conversation, now, spent.pulled],
  );

  // The ones already pulled, greyed at the end of the row.
  const asked = useMemo(
    () =>
      [...spent.pulled].flatMap(([ordinal, kind]) => {
        const title = conversation.sections.find((s) => s.ordinal === ordinal)?.title;
        return title ? [{ ordinal, kind, title }] : [];
      }),
    [conversation, spent.pulled],
  );

  // What was offered is part of the record (`subject_signal.sparks_shown`).
  useEffect(() => {
    if (sparks.length > 0) ledger.noteShown(sparks);
  }, [ledger, sparks]);

  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  if (sparks.length === 0 && asked.length === 0 && !note) return null;

  async function pull(spark: Spark) {
    setPulling(true);
    try {
      const result = await onPull({ kind: spark.kind, ordinal: spark.ordinal });
      // Taken only if the poke was: an agent already talking, or another poke
      // under way, has not asked it.
      if (result === "fired" || result === "armed") ledger.notePulled(spark);
      setNote(result ? POKE_NOTES[result] : "Could not reach it");
    } finally {
      setPulling(false);
    }
  }

  return (
    <div className="ph-no-capture relative shrink-0" role="group" aria-label="Sparks">
      <ul className="flex gap-2 overflow-x-auto pb-0.5">
        {sparks.map((spark) => (
          <li key={`${spark.ordinal}:${spark.kind}`} className="min-w-0 shrink-0 basis-[min(15rem,80%)]">
            <button
              type="button"
              onClick={() => void pull(spark)}
              disabled={!connected || speaking || pulling}
              className={[
                "flex min-h-11 w-full cursor-pointer flex-col items-start gap-0.5 rounded-2xl px-3 py-2 text-left",
                "border border-amber-300/25 bg-amber-300/10 text-amber-50 transition-transform",
                "active:scale-95 disabled:cursor-default disabled:opacity-40",
              ].join(" ")}
            >
              <span className="flex w-full min-w-0 items-center gap-1.5 text-sm font-medium">
                <Sparkles size={14} aria-hidden className="shrink-0 text-amber-300" />
                <span className="truncate">{SPARK_LABELS[spark.kind]}</span>
              </span>
              <span className="w-full truncate text-xs text-fg/60">
                {spark.title} · {spark.reason}
              </span>
            </button>
          </li>
        ))}
        {asked.map((spark) => (
          <li key={`asked:${spark.ordinal}`} className="min-w-0 shrink-0 basis-[min(12rem,60%)]">
            <span className="flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-2xl border border-line px-3 py-2 text-fg/40">
              <span className="truncate text-sm">{SPARK_LABELS[spark.kind]}</span>
              <span className="truncate text-xs">{spark.title} · asked</span>
            </span>
          </li>
        ))}
      </ul>
      {note && (
        // Said once, briefly — never announced, like the poke's.
        <span className="pointer-events-none absolute -top-7 left-0 whitespace-nowrap rounded-full bg-fg/10 px-2.5 py-0.5 text-xs text-fg/75">
          {note}
        </span>
      )}
    </div>
  );
}

/** The clock, as epoch ms, ticking every `ms`. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(timer);
  }, [ms]);
  return now;
}
