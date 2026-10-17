"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { EMPTY_CONVERSATION, type ConversationStore } from "@/lib/talkback/conversation";
import type { Spark, SparkKind } from "@/lib/talkback/signals";
import { EMPTY_LEDGER, sparkKey, type SparkLedger } from "@/lib/talkback/spark-ledger";
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

export function SparkChips({
  store,
  ledger,
  connected,
  speaking,
  onPull,
  layout = "row",
}: {
  store: ConversationStore;
  ledger: SparkLedger;
  /** Talk-back is up: a pull can reach the agent. */
  connected: boolean;
  /** The agent is talking: nothing to pull into. */
  speaking: boolean;
  onPull: (spark: SparkRequest) => Promise<PokeResult | null>;
  /**
   * A scrolling row under the panels (`/record`), or a stack at the foot of
   * the person's panel (the study, `/p`), where a row would be too narrow.
   */
  layout?: "row" | "stack";
}) {
  const conversation = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    () => EMPTY_CONVERSATION,
  );
  // Worked out above the router, where the container is also told about it
  // (`capture-provider.tsx`): what is here is what can be asked for out loud.
  const spent = useSyncExternalStore(ledger.subscribe, ledger.getSnapshot, () => EMPTY_LEDGER);
  const sparks = spent.offered;
  const [note, setNote] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);

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
      const question = spent.questions.get(sparkKey(spark));
      const result = await onPull({ kind: spark.kind, ordinal: spark.ordinal, ...(question ? { question } : {}) });
      // Taken only if the poke was: an agent already talking, or another poke
      // under way, has not asked it.
      if (result === "fired" || result === "armed") ledger.notePulled(spark);
      setNote(result ? POKE_NOTES[result] : "Could not reach it");
    } finally {
      setPulling(false);
    }
  }

  return (
    <div
      className={[
        "ph-no-capture relative shrink-0",
        // At the foot of their panel: set off from the subjects above it.
        layout === "stack" ? "border-t border-line px-3 pt-3 pb-3" : "",
      ].join(" ")}
      role="group"
      aria-label="Sparks"
    >
      <ul className={layout === "stack" ? "flex flex-col gap-2" : "flex gap-2 overflow-x-auto pb-0.5"}>
        {sparks.map((spark) => {
          // Its own question when one has been written; the kind's label
          // until then, or if none comes.
          const question = spent.questions.get(sparkKey(spark));
          return (
          <li
            key={`${spark.ordinal}:${spark.kind}`}
            className={layout === "stack" ? "min-w-0" : "min-w-0 shrink-0 basis-[min(15rem,80%)]"}
          >
            <button
              type="button"
              onClick={() => void pull(spark)}
              disabled={!connected || speaking || pulling}
              className={[
                "flex min-h-11 w-full cursor-pointer flex-col items-start gap-0.5 rounded-2xl px-3 py-2 text-left",
                // The page's own text colour on a faint amber wash, so it reads
                // in both themes; amber was the text colour once, and on the
                // light theme it all but vanished.
                "border border-amber-500/45 bg-amber-500/10 text-fg transition-[transform,background-color]",
                "hover:bg-amber-500/20",
                "active:scale-95 disabled:cursor-default disabled:opacity-40",
              ].join(" ")}
            >
              <span className="flex w-full min-w-0 items-start gap-1.5 text-sm font-medium">
                <Sparkles size={14} aria-hidden className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
                <span className={question ? "line-clamp-2" : "truncate"}>
                  {question ?? SPARK_LABELS[spark.kind]}
                </span>
              </span>
              <span className="w-full truncate text-xs text-fg/70">
                {spark.title} · {question ? SPARK_LABELS[spark.kind] : spark.reason}
              </span>
            </button>
          </li>
          );
        })}
        {asked.map((spark) => (
          <li
            key={`asked:${spark.ordinal}`}
            className={layout === "stack" ? "min-w-0" : "min-w-0 shrink-0 basis-[min(12rem,60%)]"}
          >
            <span className="flex min-h-11 w-full flex-col justify-center gap-0.5 rounded-2xl border border-line px-3 py-2 text-fg/55">
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
