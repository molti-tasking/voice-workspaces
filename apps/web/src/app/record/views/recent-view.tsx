"use client";

import type { RecentLadder } from "./recent";
import type { TopicEntry } from "./topics";

/**
 * Recent: the conversation shrunk by age (`recent.ts`). From the bottom up —
 * the last turn in its own words, large, under who said it; the turn before
 * in two words; the few before that in one word each; and above them the
 * topic being talked about. The further back, the smaller and the fewer the
 * words: one screen, no scrolling, nothing to tap but the whole of it, which
 * opens the topic with every word.
 *
 * FIXED ROWS. Each row keeps its place; a turn moves up a row only when a new
 * one begins, and nothing animates.
 */
export function RecentView({
  ladder,
  topics,
  onZoom,
}: {
  ladder: RecentLadder;
  topics: TopicEntry[];
  onZoom: (key: string) => void;
}) {
  if (!ladder.last) {
    return (
      <p className="m-auto max-w-xs text-center text-sm text-fg/55">
        The last words of the conversation show here as you talk.
      </p>
    );
  }
  const current = topics.find((t) => t.current) ?? null;

  return (
    <button
      type="button"
      onClick={current ? () => onZoom(current.key) : undefined}
      disabled={!current}
      aria-label={current ? `The last turns, on ${current.title}. Open it.` : "The last turns"}
      className="ph-no-capture mt-auto flex w-full cursor-pointer flex-col gap-4 rounded-3xl p-3 text-left hover:bg-fg/[0.03] disabled:cursor-default disabled:hover:bg-transparent"
    >
      <span className="min-h-5 text-sm font-medium tracking-wide text-fg/50 uppercase">{current?.title}</span>
      <span className="min-h-6 text-base text-fg/40">{ladder.earlier.map((w) => w.text).join(" · ")}</span>
      <span className="min-h-8 text-xl text-fg/65">{ladder.previous?.text}</span>
      {/* Room for the longest last turn (LAST_WORDS), so the rows above never move with it. */}
      <span className="flex min-h-[10rem] flex-col justify-end gap-1">
        <span className="text-xs text-fg/50">{ladder.last.who === "user" ? "You" : "Souffleur"}</span>
        <span className="text-3xl leading-tight font-semibold text-balance text-fg">
          {ladder.last.cut ? "… " : ""}
          {ladder.last.text}
        </span>
      </span>
    </button>
  );
}
