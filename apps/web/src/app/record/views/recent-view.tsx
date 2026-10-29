"use client";

import { useState } from "react";
// The `/digest` subpath, not the package index: the index pulls in server code.
import type { DigestGist } from "@voicemural/talkback/digest";
import type { Conversation } from "@/lib/talkback/conversation";
import { useAgentName } from "../agent-name-context";
import { recentLadder, settleGists, type RecentWords } from "./recent";
import { SpokenWords } from "./spoken-text";
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
 * one begins, and nothing animates. A word guessed here is lighter until the
 * model's word replaces it, once.
 */
export function RecentView({
  conversation,
  gists,
  topics,
  onZoom,
}: {
  conversation: Conversation;
  /** The digest's gists for this point; the screen keeps the first it gets for each turn. */
  gists: readonly DigestGist[] | undefined;
  topics: TopicEntry[];
  onZoom: (key: string) => void;
}) {
  const agent = useAgentName();
  // Gists settled so far, kept across digests: a turn's words change at most
  // once, from the guess to the model's (`settleGists`).
  const [settled, setSettled] = useState<ReadonlyMap<number, DigestGist>>(() => new Map());
  const next = settleGists(settled, gists);
  if (next !== settled) setSettled(next);
  const ladder = recentLadder(conversation, next);

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
      <span className="min-h-6 text-base">
        {ladder.earlier.map((w, i) => (
          <span key={w.seq}>
            {i > 0 && <span className="text-fg/30"> · </span>}
            <Shrunk words={w} tone="text-fg/45" />
          </span>
        ))}
      </span>
      <span className="min-h-8 text-xl">{ladder.previous && <Shrunk words={ladder.previous} tone="text-fg/65" />}</span>
      {/* Room for the longest last turn (LAST_WORDS), so the rows above never move with it. */}
      <span className="flex min-h-[10rem] flex-col justify-end gap-1">
        <span className="text-xs text-fg/50">{ladder.last.who === "user" ? "You" : agent.Name}</span>
        <span className="text-3xl leading-tight font-semibold text-balance text-fg">
          {ladder.last.cut ? "… " : ""}
          <SpokenWords words={ladder.last.words} animate={ladder.last.spoken} />
        </span>
      </span>
    </button>
  );
}

/** A turn's shrunk words: lighter while they are only this screen's guess. */
function Shrunk({ words, tone }: { words: RecentWords; tone: string }) {
  return <span className={words.provisional ? "text-fg/30" : tone}>{words.text}</span>;
}
