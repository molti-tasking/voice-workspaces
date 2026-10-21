"use client";

import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { stripFillers } from "@voicemural/shared";
import { EMPTY_CONVERSATION, type ConversationStore } from "@/lib/talkback/conversation";
import { transcriptLines } from "@/lib/talkback/transcript";

/**
 * The display study's control: a voice conversation shown the way a voice
 * assistant's chat shows one — every line in the order it was said, their
 * words in a bubble on the right, the assistant's as text on the left, and
 * nothing else. No headlines, no topics, no signals, no sparks, no drafts.
 *
 * Follows the newest line unless they have scrolled up to read. Inside
 * `ph-no-capture`, because the words are theirs.
 */

/** Within this many pixels of the bottom counts as following along. */
const FOLLOW_SLACK_PX = 80;

export function ConversationTranscript({
  store,
  placeholder,
  className = "",
}: {
  store: ConversationStore;
  /** Shown until anything has been said. */
  placeholder?: string;
  className?: string;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_CONVERSATION);
  const lines = useMemo(() => transcriptLines(state), [state]);

  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  return (
    <div className={`ph-no-capture flex min-h-0 flex-col ${className}`} aria-live="off">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          following.current = el.scrollHeight - el.scrollTop - el.clientHeight < FOLLOW_SLACK_PX;
        }}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
      >
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-1 py-4">
          {lines.length === 0 && placeholder && <p className="text-fg/55">{placeholder}</p>}
          {lines.map((turn) => {
            if (turn.who === "agent") {
              return (
                <p key={turn.id} className="max-w-[95%] leading-relaxed text-fg/90">
                  {turn.text}
                </p>
              );
            }
            const said = stripFillers(turn.text);
            return said ? (
              <p
                key={turn.id}
                className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-fg/[0.07] px-4 py-2.5 leading-relaxed"
              >
                {said}
              </p>
            ) : null;
          })}
        </div>
      </div>
    </div>
  );
}
