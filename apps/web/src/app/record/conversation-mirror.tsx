"use client";

import { AudioLines, Sparkles, UserRound } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
// A type only: the package index pulls in server code.
import type { MirrorBullets } from "@voicemural/talkback";
import { EMPTY_CONVERSATION, type ConversationStore, type Speaker } from "@/lib/talkback/conversation";
import { mirrorTopics, type MirrorTopic } from "@/lib/talkback/mirror";
import { allSignals, type Spark } from "@/lib/talkback/signals";
import { EMPTY_LEDGER, sparkKey, type SparkLedger } from "@/lib/talkback/spark-ledger";
import type { SparkRequest } from "@/lib/talkback/types";
import { useMirrorBullets, type TopicBullets } from "@/lib/talkback/use-mirror-bullets";
import type { PokeResult } from "@/lib/talkback/use-talkback";
import { POKE_NOTES } from "./floor-controls";
import { SPARK_LABELS, pullSpark } from "./spark-chips";

/**
 * The conversation mirror: the conversation, not the words.
 *
 * WHAT A GLANCE READS. Each topic once, on the side of whoever's words it
 * mostly is — the person's (amber, left or top) or Souffleur's (sky, right or
 * bottom). The topic being talked about now is drawn larger, one left a while
 * ago has a dashed outline, and a spark on offer is an amber dot on it. No
 * sentences: the words are in the focus strip below, for whoever looks longer.
 *
 * NOTHING MOVES. A topic keeps its place once it has one, and its side once
 * the talk has moved on from it (its words stop changing); changes happen at
 * once, without animation —
 * motion at the edge of vision pulls the eye, which is what a glance must not
 * cost.
 *
 * WORDS IN PLACE, NOT IN A DRAWER. The focus strip always shows one topic's
 * points, what Souffleur said first and theirs under it
 * (`/api/realtime/mirror`). It follows the conversation; a tap on a topic
 * shows that one instead, until the talk moves to another topic. A spark on
 * the topic in focus is pulled from the strip, exactly as from the chips
 * (`pullSpark`).
 *
 * TWO LAYOUTS OF THE SAME THING. `track`: one line in the order the topics
 * came up, newest at the bottom. `bubbles`: two panels, each topic in the next
 * free cell of a fixed grid. Inside `ph-no-capture`, because the titles and
 * points are theirs.
 */

export type MirrorLayout = "track" | "bubbles";

/** How often fading is re-read while the drive runs. */
const CLOCK_MS = 15_000;
/** How long what became of a pull stays in the strip. */
const NOTE_MS = 2500;

const SIDE_LABEL: Record<Speaker, string> = { user: "your topic", agent: "Souffleur's topic" };

export function ConversationMirror({
  store,
  sparks,
  layout,
  captureSessionId,
  fixedPoints,
  live,
  canPull,
  onPull,
  className = "",
}: {
  store: ConversationStore;
  /** The drive's sparks, in the sparks arm only. */
  sparks: SparkLedger | null;
  layout: MirrorLayout;
  /** The drive the points are written for. */
  captureSessionId: string | null;
  /**
   * Points given rather than written, by topic title — the simulated
   * conversation (`/record/demo`), where there is no AI to write them.
   */
  fixedPoints?: ReadonlyMap<string, MirrorBullets>;
  /** The drive is running. */
  live: boolean;
  /** A pulled spark can reach the agent now. */
  canPull: boolean;
  onPull: (spark: SparkRequest) => Promise<PokeResult | null>;
  className?: string;
}) {
  const conversation = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_CONVERSATION);
  const ledger = useSyncExternalStore(
    sparks?.subscribe ?? noSubscription,
    sparks?.getSnapshot ?? emptyLedger,
    emptyLedger,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_MS);
    return () => window.clearInterval(timer);
  }, [live]);

  const signals = useMemo(() => allSignals(conversation, now), [conversation, now]);
  const offered = sparks ? ledger.offered : NO_SPARKS;
  // A topic's side can only change while it is being talked about: once the
  // talk moves on, its words — and so its side — stay as they were.
  const topics = useMemo(() => mirrorTopics(conversation, signals, offered), [conversation, signals, offered]);

  const written = useMirrorBullets(conversation, fixedPoints ? null : captureSessionId);
  const pointsOf = (topic: MirrorTopic): TopicBullets | null => {
    if (!fixedPoints) return written.get(topic.key) ?? null;
    const given = fixedPoints.get(topic.title);
    return given ? { bullets: given, pending: false } : null;
  };

  // What was offered is part of the record (`subject_signal.sparks_shown`).
  useEffect(() => {
    if (sparks && offered.length > 0) sparks.noteShown(offered);
  }, [sparks, offered]);

  // The focus follows the talk; a tap pins another topic until the talk moves.
  const [pinned, setPinned] = useState<{ key: string; at: string | null } | null>(null);
  const followed = topics.find((t) => t.key === conversation.current) ?? topics.at(-1) ?? null;
  const focus =
    (pinned && pinned.at === conversation.current ? topics.find((t) => t.key === pinned.key) : null) ?? followed;
  const choose = (key: string) =>
    setPinned(key === followed?.key ? null : { key, at: conversation.current });

  return (
    <div className={`ph-no-capture flex min-h-0 flex-col gap-3 ${className}`}>
      {topics.length === 0 ? (
        <p className="m-auto max-w-xs text-center text-sm text-fg/55">
          Topics appear here as you talk.
        </p>
      ) : layout === "track" ? (
        <Track topics={topics} focusKey={focus?.key ?? null} onChoose={choose} />
      ) : (
        <Bubbles topics={topics} focusKey={focus?.key ?? null} onChoose={choose} />
      )}
      {focus && (
        <FocusStrip
          key={focus.key}
          topic={focus}
          bullets={pointsOf(focus)}
          question={focus.spark ? (ledger.questions.get(sparkKey(focus.spark)) ?? null) : null}
          canPull={canPull && sparks !== null}
          onPull={(spark) => (sparks ? pullSpark(spark, { onPull, ledger: sparks, store }) : Promise.resolve(null))}
        />
      )}
    </div>
  );
}

const NO_SPARKS: Spark[] = [];

/* --- the two layouts --------------------------------------------------------- */

function Track({
  topics,
  focusKey,
  onChoose,
}: {
  topics: MirrorTopic[];
  focusKey: string | null;
  onChoose: (key: string) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const active = useRef<HTMLLIElement>(null);
  const count = topics.length;
  const activeKey = topics.find((t) => t.active)?.key ?? null;
  // Keep the topic being talked about in view: a new one is at the bottom, a
  // return can be far up the track.
  useEffect(() => {
    if (active.current) active.current.scrollIntoView({ block: "nearest" });
    else end.current?.scrollIntoView({ block: "end" });
  }, [count, activeKey]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid shrink-0 grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] items-center pb-1">
        <SideIcon side="user" className="mr-2 justify-self-end" />
        <span />
        <SideIcon side="agent" className="ml-2" />
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <ol className="relative mt-auto flex flex-col gap-3 py-2">
          <span aria-hidden className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line" />
          {topics.map((topic) => (
            <li
              key={topic.key}
              ref={topic.active ? active : undefined}
              className="relative grid grid-cols-[minmax(0,1fr)_28px_minmax(0,1fr)] items-center"
            >
              {topic.side === "user" ? (
                <TopicChip topic={topic} focused={topic.key === focusKey} onChoose={onChoose} align="end" />
              ) : (
                <span />
              )}
              <span
                aria-hidden
                className={[
                  "justify-self-center rounded-full",
                  topic.active ? "size-3.5 bg-fg" : topic.faded ? "size-2 bg-fg/25" : "size-2.5 bg-fg/40",
                ].join(" ")}
              />
              {topic.side === "agent" ? (
                <TopicChip topic={topic} focused={topic.key === focusKey} onChoose={onChoose} align="start" />
              ) : (
                <span />
              )}
            </li>
          ))}
        </ol>
        <div ref={end} />
      </div>
    </div>
  );
}

function Bubbles({
  topics,
  focusKey,
  onChoose,
}: {
  topics: MirrorTopic[];
  focusKey: string | null;
  onChoose: (key: string) => void;
}) {
  return (
    // Each panel as tall as its topics need, the two scrolling together.
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto">
      {(["user", "agent"] as const).map((side) => (
        <section
          key={side}
          aria-label={side === "user" ? "Your topics" : "Souffleur's topics"}
          className={[
            "relative min-h-36 shrink-0 rounded-3xl p-3",
            side === "user" ? "bg-amber-500/[0.07]" : "bg-sky-500/[0.07]",
          ].join(" ")}
        >
          <SideIcon side={side} className="absolute top-3 left-3" />
          {/* Fixed cells, filled in order: a bubble never moves to make room. */}
          <ul className="grid grid-cols-3 gap-2 pt-7">
            {topics
              .filter((topic) => topic.side === side)
              .map((topic) => (
                <li key={topic.key} className="flex aspect-square items-center justify-center">
                  <Bubble topic={topic} focused={topic.key === focusKey} onChoose={onChoose} />
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* --- topics -------------------------------------------------------------------- */

function topicLabel(topic: MirrorTopic): string {
  return [
    topic.title,
    SIDE_LABEL[topic.side],
    topic.active ? "being talked about" : topic.faded ? "left a while ago" : null,
    topic.spark ? "spark on offer" : null,
  ]
    .filter(Boolean)
    .join(", ");
}

function outline(topic: MirrorTopic): string {
  const color =
    topic.side === "user"
      ? topic.active
        ? "border-amber-500"
        : "border-amber-500/45"
      : topic.active
        ? "border-sky-500"
        : "border-sky-500/45";
  return [
    color,
    topic.active ? "border-[3px] font-semibold text-fg" : "border",
    topic.faded ? "border-dashed text-fg/60" : "",
  ].join(" ");
}

function TopicChip({
  topic,
  focused,
  onChoose,
  align,
}: {
  topic: MirrorTopic;
  focused: boolean;
  onChoose: (key: string) => void;
  align: "start" | "end";
}) {
  return (
    <button
      type="button"
      onClick={() => onChoose(topic.key)}
      aria-pressed={focused}
      aria-label={topicLabel(topic)}
      className={[
        "relative min-h-11 max-w-full cursor-pointer rounded-2xl bg-surface text-left",
        align === "end" ? "justify-self-end" : "justify-self-start",
        topic.active ? "px-4 py-2 text-lg" : "px-3 py-1.5 text-sm",
        outline(topic),
        focused ? "ring-4 ring-fg/10" : "",
      ].join(" ")}
    >
      <span className="line-clamp-2 leading-snug break-words">{topic.title}</span>
      {topic.spark && <SparkDot className={align === "end" ? "-top-1 -left-1" : "-top-1 -right-1"} />}
    </button>
  );
}

function Bubble({
  topic,
  focused,
  onChoose,
}: {
  topic: MirrorTopic;
  focused: boolean;
  onChoose: (key: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChoose(topic.key)}
      aria-pressed={focused}
      aria-label={topicLabel(topic)}
      className={[
        "relative grid aspect-square cursor-pointer place-items-center rounded-full bg-surface p-1.5 text-center",
        topic.active ? "w-full text-base" : topic.faded ? "w-[64%] text-xs" : "w-[80%] text-sm",
        outline(topic),
        focused ? "ring-4 ring-fg/10" : "",
      ].join(" ")}
    >
      <span className="line-clamp-3 leading-tight break-words">{topic.title}</span>
      {topic.spark && <SparkDot className="top-[6%] right-[6%]" />}
    </button>
  );
}

function SparkDot({ className }: { className: string }) {
  return (
    <span
      aria-hidden
      className={`absolute size-3.5 rounded-full border-2 border-canvas bg-amber-500 ${className}`}
    />
  );
}

function SideIcon({ side, className = "" }: { side: Speaker; className?: string }) {
  const Icon = side === "user" ? UserRound : AudioLines;
  return (
    <Icon
      size={18}
      aria-hidden
      className={[
        "opacity-50",
        side === "user" ? "text-amber-700 dark:text-amber-300" : "text-sky-700 dark:text-sky-300",
        className,
      ].join(" ")}
    />
  );
}

/* --- the focus strip --------------------------------------------------------- */

function FocusStrip({
  topic,
  bullets,
  question,
  canPull,
  onPull,
}: {
  topic: MirrorTopic;
  bullets: TopicBullets | null;
  question: string | null;
  canPull: boolean;
  onPull: (spark: Spark) => Promise<PokeResult | null>;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [pulling, setPulling] = useState(false);
  useEffect(() => {
    if (!note) return;
    const timer = window.setTimeout(() => setNote(null), NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [note]);

  const points = bullets?.bullets;
  const spark = topic.spark;

  async function pull(chosen: Spark) {
    setPulling(true);
    try {
      const result = await onPull(chosen);
      setNote(result ? POKE_NOTES[result] : "Could not reach it");
    } finally {
      setPulling(false);
    }
  }

  return (
    <section
      aria-label={`In focus: ${topic.title}`}
      className="relative shrink-0 rounded-3xl border border-line bg-surface p-4"
    >
      <div className="flex min-w-0 items-center gap-2">
        <SideIcon side={topic.side} className="shrink-0" />
        <h3 className="min-w-0 truncate text-base font-semibold text-fg">{topic.title}</h3>
        {bullets?.pending && <span className="shrink-0 text-xs text-fg/50">updating…</span>}
      </div>

      {points && (points.ai.length > 0 || points.you.length > 0) ? (
        <div className="mt-2 space-y-2">
          <Points side="agent" items={points.ai} />
          <Points side="user" items={points.you} />
        </div>
      ) : (
        <p className="mt-2 text-sm text-fg/55">
          {bullets?.pending ? "Summing up…" : "The points appear once there is something to sum up."}
        </p>
      )}

      {spark && (
        <button
          type="button"
          onClick={() => void pull(spark)}
          disabled={!canPull || pulling}
          className={[
            "mt-3 flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm font-medium",
            "border border-amber-500/45 bg-amber-500/10 text-fg hover:bg-amber-500/20",
            "active:scale-[0.98] disabled:cursor-default disabled:opacity-40",
          ].join(" ")}
        >
          <Sparkles size={14} aria-hidden className="shrink-0 text-amber-600 dark:text-amber-300" />
          <span className="line-clamp-2">{question ?? SPARK_LABELS[spark.kind]}</span>
        </button>
      )}
      {note && (
        <span className="pointer-events-none absolute -top-3 right-4 rounded-full bg-fg/10 px-2.5 py-0.5 text-xs text-fg/75">
          {note}
        </span>
      )}
    </section>
  );
}

function Points({ side, items }: { side: Speaker; items: string[] }) {
  if (items.length === 0) return null;
  return (
    <div className="flex gap-2">
      <span className="mt-0.5 shrink-0" title={side === "user" ? "You" : "Souffleur"}>
        <SideIcon side={side} />
        <span className="sr-only">{side === "user" ? "You:" : "Souffleur:"}</span>
      </span>
      <ul className={`min-w-0 space-y-0.5 text-sm ${side === "user" ? "text-fg/70" : "text-fg"}`}>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

function noSubscription(): () => void {
  return () => undefined;
}

function emptyLedger() {
  return EMPTY_LEDGER;
}
