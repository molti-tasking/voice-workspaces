"use client";

import { formatOffset } from "@voicemural/shared";
import type { Turn } from "@/lib/talkback/conversation";

/**
 * Going back in time, the same in every view: a slider over the
 * conversation's turns, from the first to now. Dragged back, every view shows
 * the conversation as it stood then — the chat its lines up to that point,
 * the topic line the topics that had come up, Now and Open what they said at
 * the time — and "Now" returns. A native range input, so it works by touch,
 * by keyboard and with a screen reader alike.
 */
export function TimeBar({
  turns,
  cursor,
  label,
  onCursor,
}: {
  /** Every turn, in order. */
  turns: readonly Turn[];
  /** The `seq` shown up to; null is now. */
  cursor: number | null;
  /** Where the cursor is: the topic then, and the time when known. */
  label: { title: string | null; at: number | null } | null;
  onCursor: (seq: number | null) => void;
}) {
  const last = turns.length - 1;
  const index = cursor === null ? last : Math.max(0, turns.findIndex((t) => t.seq === cursor));
  const words =
    cursor === null
      ? "Now"
      : [label?.at !== null && label?.at !== undefined ? formatOffset(label.at) : null, label?.title ?? null]
          .filter(Boolean)
          .join(" · ") || `Line ${index + 1} of ${turns.length}`;

  return (
    <div className="flex h-11 w-full shrink-0 items-center gap-3 select-none">
      <input
        type="range"
        min={0}
        max={last}
        step={1}
        value={index}
        aria-label="Go back in the conversation"
        aria-valuetext={words}
        onChange={(event) => {
          const i = Number(event.currentTarget.value);
          onCursor(i >= last ? null : (turns[i]?.seq ?? null));
        }}
        className="h-11 min-w-0 flex-1 cursor-pointer accent-fg"
      />
      <span className="w-28 shrink-0 truncate text-right text-xs text-fg/60" aria-hidden>
        {words}
      </span>
      {/* Always there, hidden at now, so the slider never changes width under a finger. */}
      <button
        type="button"
        onClick={() => onCursor(null)}
        disabled={cursor === null}
        className={[
          "min-h-9 shrink-0 cursor-pointer rounded-full bg-fg px-3 text-xs font-semibold text-canvas",
          cursor === null ? "invisible" : "",
        ].join(" ")}
      >
        Now
      </button>
    </div>
  );
}
