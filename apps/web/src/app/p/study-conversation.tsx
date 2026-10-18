"use client";

import { Lock } from "lucide-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { stripFillers } from "@voicemural/shared";
import type { Floor } from "@/lib/recorder/floor-store";
import { EMPTY_CONVERSATION, type ConversationStore, type Section } from "@/lib/talkback/conversation";
import { SAY_BACK_SHARE, allSignals, type SubjectSignal } from "@/lib/talkback/signals";

/**
 * The study's conversation: one column, both voices, like a chat with Claude
 * — their turns in a bubble on the right, the agent's as plain text on the
 * left — on the page itself rather than in boxes.
 *
 * ONLY THE CURRENT TOPIC IN WORDS. Each topic is a divider with its name and
 * what the recorder makes of it (whose words, settled or open); only the topic
 * being talked about now shows its last few turns. Earlier topics fold to
 * their divider: a whole transcript on screen is something to reread, and
 * rereading is rehearsal before the recall test (PROLIFIC.md).
 *
 * Replaces the two panels `/record` uses (`ConversationPanels`), which are
 * built for a glance from a car; this page is read at a desk.
 */

/** How many of the current topic's turns are shown. */
const RECENT_TURNS = 6;
/** Within this many pixels of the bottom counts as following along. */
const FOLLOW_SLACK_PX = 80;

export function StudyConversation({
  store,
  live,
  floor,
  speaking,
  listening,
  className = "",
}: {
  store: ConversationStore;
  live: boolean;
  /** Who may talk, as the agent is under it — null when nothing is connected. */
  floor: Floor | null;
  /** The agent is talking this second. */
  speaking: boolean;
  /** They are talking this second. */
  listening: boolean;
  className?: string;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_CONVERSATION);
  const signals = useMemo(
    () => new Map(allSignals(state, 0).map((signal) => [signal.key, signal])),
    [state],
  );

  // Follow the newest line, unless they have scrolled up to look at something.
  const scroller = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    const el = scroller.current;
    if (el && following.current) el.scrollTop = el.scrollHeight;
  }, [state]);

  const empty = state.sections.length === 0;

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
        <div className="mx-auto flex w-full max-w-2xl flex-col gap-5 px-1 py-4">
          {empty && (
            <p className="text-fg/55">
              {live ? "Start talking whenever you are ready. Souffleur listens, and answers when you pause." : ""}
            </p>
          )}
          {state.sections.map((section) => (
            <Topic
              key={section.key}
              section={section}
              current={section.key === state.current}
              signal={signals.get(section.key)}
            />
          ))}
        </div>
      </div>
      {live && <Status floor={floor} speaking={speaking} listening={listening} />}
    </div>
  );
}

function Topic({
  section,
  current,
  signal,
}: {
  section: Section;
  current: boolean;
  signal: SubjectSignal | undefined;
}) {
  const turns = current ? section.turns.slice(-RECENT_TURNS) : [];
  const hidden = current ? section.turns.length - turns.length : 0;
  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center gap-3">
        <span className="h-px flex-1 bg-line" aria-hidden />
        <span
          className={[
            "max-w-[70%] truncate text-sm",
            current ? "font-semibold text-fg" : "font-medium text-fg/50",
          ].join(" ")}
        >
          {section.title ?? "…"}
        </span>
        {signal && <Marks signal={signal} />}
        <span className="h-px flex-1 bg-line" aria-hidden />
      </header>
      {hidden > 0 && <p className="text-center text-xs text-fg/40">{hidden} earlier turns on this topic</p>}
      {turns.map((turn) =>
        turn.who === "user" ? (
          <p
            key={turn.id}
            className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-fg/[0.07] px-4 py-2.5 leading-relaxed"
          >
            {stripFillers(turn.text)}
          </p>
        ) : (
          <p key={turn.id} className="max-w-[95%] leading-relaxed text-fg/90">
            {turn.text}
            {turn.interrupted && (
              <span className="ml-1.5 text-xs text-amber-700 dark:text-amber-300/80">cut off</span>
            )}
          </p>
        ),
      )}
    </section>
  );
}

/**
 * What the recorder makes of a topic, in the divider: a thin bar of whose
 * words it is built on (theirs dark, Souffleur's blue) and settled or open.
 * No numbers; the bar's label says it in words.
 */
function Marks({ signal }: { signal: SubjectSignal }) {
  const share = signal.agentShare;
  if (share === null && signal.settled === null) return null;
  return (
    <span className="flex shrink-0 items-center gap-1.5">
      {share !== null && (
        <span
          className="flex h-1 w-10 overflow-hidden rounded-full bg-sky-400/60"
          role="img"
          aria-label={
            share >= SAY_BACK_SHARE
              ? "Mostly Souffleur's words"
              : share <= 1 - SAY_BACK_SHARE
                ? "Mostly your words"
                : "Your words and Souffleur's"
          }
          title={
            share >= SAY_BACK_SHARE
              ? "Mostly Souffleur's words"
              : share <= 1 - SAY_BACK_SHARE
                ? "Mostly your words"
                : "Your words and Souffleur's"
          }
        >
          <span className="h-full bg-fg/70" style={{ width: `${(1 - share) * 100}%` }} />
        </span>
      )}
      {signal.settled !== null && (
        <span
          className={[
            "text-[0.65rem] font-medium tracking-wide uppercase",
            signal.settled ? "text-emerald-700 dark:text-emerald-300/80" : "text-amber-700 dark:text-amber-300/80",
          ].join(" ")}
        >
          {signal.settled ? "settled" : "open"}
        </span>
      )}
    </span>
  );
}

/** One line under the conversation: who has the floor this second. */
function Status({ floor, speaking, listening }: { floor: Floor | null; speaking: boolean; listening: boolean }) {
  return (
    <p className="mx-auto flex h-7 w-full max-w-2xl shrink-0 items-center gap-2 px-1 text-sm text-fg/55">
      {speaking ? (
        <>
          <SpeakingBars />
          <span className="text-sky-700 dark:text-sky-300">Souffleur is speaking</span>
        </>
      ) : listening ? (
        <>
          <SpeakingBars />
          <span className="text-fg/80">Listening</span>
        </>
      ) : floor === "locked" ? (
        <>
          <Lock size={13} aria-hidden />
          <span>Locked: Souffleur only talks when you poke it</span>
        </>
      ) : floor === null ? (
        <span>Connecting…</span>
      ) : (
        <span>Your turn</span>
      )}
    </p>
  );
}

function SpeakingBars() {
  return (
    <span className="vm-speaking flex h-3 items-end gap-[2px]" role="img" aria-label="speaking">
      <span className="h-full w-[3px] rounded-full bg-current" />
      <span className="h-full w-[3px] rounded-full bg-current" />
      <span className="h-full w-[3px] rounded-full bg-current" />
    </span>
  );
}
