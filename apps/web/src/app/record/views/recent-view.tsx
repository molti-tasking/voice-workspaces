"use client";

import { Check } from "lucide-react";
import type { RecentLadder, RecentWords } from "./recent";
import type { TopicEntry } from "./topics";

/**
 * Recent: the conversation shrunk by age (`recent.ts`). From the bottom up —
 * the newest turn in its own words, large; the turn before in two words; the
 * turns before that in one word each; and at the top, the topics. The further
 * back, the smaller and the fewer the words: detail where the conversation
 * is, the rest as context, on one screen and without scrolling.
 *
 * SAME SIDES AS THE CHAT. The person's words sit on the right in a grey
 * bubble, the assistant's on the left as plain text, so the view reads like
 * the chat it shrinks, and whose words they were is never lost.
 *
 * FIXED ROWS. Each row keeps its place; a turn moves up a row only when a new
 * one begins, and nothing animates. A tap anywhere below the topics opens the
 * topic being talked about, with every word of it.
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
  const zoomCurrent = current ? () => onZoom(current.key) : undefined;

  return (
    <div className="ph-no-capture flex min-h-0 flex-1 flex-col gap-4 py-3">
      {topics.length > 0 && (
        <ol aria-label="Topics" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm leading-snug">
          {topics.map((topic) => (
            <li key={topic.key}>
              <button
                type="button"
                onClick={() => onZoom(topic.key)}
                aria-current={topic.current ? "step" : undefined}
                className={[
                  "flex min-h-9 cursor-pointer items-center gap-1 rounded-lg hover:bg-fg/[0.05]",
                  topic.current ? "font-semibold text-fg" : "text-fg/55",
                ].join(" ")}
              >
                {topic.title}
                {topic.settled && <Check size={12} strokeWidth={3} aria-label="settled" className="text-fg/55" />}
              </button>
            </li>
          ))}
        </ol>
      )}

      <button
        type="button"
        onClick={zoomCurrent}
        disabled={!zoomCurrent}
        aria-label={current ? `The last turns, on ${current.title}. Open it.` : "The last turns"}
        className="mt-auto flex w-full cursor-pointer flex-col gap-3 rounded-3xl p-2 text-left hover:bg-fg/[0.03] disabled:cursor-default disabled:hover:bg-transparent"
      >
        {/* Always rendered, so the rows below keep their places from the first turn on. */}
        <span className="flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
          {ladder.earlier.map((w) => (
            <Words key={w.seq} words={w} className="text-sm text-fg/45" pill="px-2 py-0.5" />
          ))}
        </span>
        <span className="flex min-h-9 flex-col">
          {ladder.previous && <Words words={ladder.previous} className="text-lg text-fg/70" pill="px-3 py-1" side />}
        </span>
        {/* Room for the longest last turn (LAST_WORDS), so the rows above never move with it. */}
        <span className="flex min-h-[10.5rem] flex-col justify-end">
          <Words
            words={ladder.last}
            prefix={ladder.last.cut ? "… " : ""}
            className="text-2xl leading-snug font-semibold text-balance text-fg"
            pill="px-4 py-2.5"
            side
          />
        </span>
      </button>
    </div>
  );
}

/** One turn's words: the person's in a grey bubble, the assistant's plain. `side` puts the person's on the right. */
function Words({
  words,
  className,
  pill,
  side = false,
  prefix = "",
}: {
  words: RecentWords;
  className: string;
  pill: string;
  side?: boolean;
  prefix?: string;
}) {
  const you = words.who === "user";
  return (
    <span
      className={[
        className,
        "max-w-[92%] break-words",
        side ? (you ? "self-end" : "self-start") : "",
        you ? `rounded-2xl bg-fg/[0.07] ${pill}` : "",
      ].join(" ")}
    >
      <span className="sr-only">{you ? "You: " : "Assistant: "}</span>
      {prefix}
      {words.text}
    </span>
  );
}
