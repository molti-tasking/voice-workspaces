"use client";

import { ChevronRight, FileText, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { stripFillers } from "@voicemural/shared";
import { CopyButton } from "@/components/copy-button";
import { DraftMarkdown } from "@/components/draft-markdown";
import type { DraftCue } from "@/lib/display/use-cues";
import { timeline, type Conversation, type Mark, type Turn } from "@/lib/talkback/conversation";
import { SPARK_LABELS } from "../spark-chips";
import { SpokenText } from "./spoken-text";

/**
 * The chat: every line in the order it was said — theirs in a bubble on the
 * right, the assistant's as plain text on the left — the way a voice
 * assistant's chat shows a voice conversation. The same live, after the
 * drive, and when the conversation is continued: one look for one
 * conversation, wherever it is read.
 *
 * WHAT ELSE HAPPENED, WHERE IT HAPPENED. A draft the assistant wrote is a line
 * after the turn that wrote it, and opens to its text with Copy. A spark they
 * pulled is a line before the question it asked. Where a later drive picked
 * the conversation up, a thin rule says so.
 *
 * FOLLOWING, BY WHERE THE COLUMN IS. Live and at now, it stays at the end,
 * pinned instantly on every change. Scrolling up or selecting text stops it;
 * scrolling back to the end starts it again. Nothing resumes on a timer.
 *
 * Never announced (`aria-live="off"`): a screen reader reading turns aloud
 * would talk over the conversation. And `ph-no-capture`: these are their words.
 */

/** Scrolling down to within this many pixels of the end starts following again. */
const FOLLOW_SLACK_PX = 80;

type Item = { kind: "turn"; turn: Turn } | { kind: "mark"; mark: Mark };

export function ChatView({
  conversation,
  follow: live,
  drafts,
  placeholder,
  titleOf,
}: {
  conversation: Conversation;
  /** Stay at the newest line: live, and at now. */
  follow: boolean;
  drafts: readonly DraftCue[];
  placeholder?: string;
  titleOf: (ordinal: number) => string | null;
}) {
  const items = useMemo<Item[]>(() => timeline(conversation).flatMap((run) => run.items), [conversation]);
  const draftsById = useMemo(() => new Map(drafts.map((d) => [d.id, d])), [drafts]);
  const [openDraft, setOpenDraft] = useState<string | null>(null);

  const scroller = useRef<HTMLDivElement>(null);
  // Where the column was at its last scroll, so a scroll UP — theirs — can be
  // told from following, which only ever moves it down.
  const lastTop = useRef(0);
  const [following, setFollowing] = useState(true);
  const follow = live && following;

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!follow || !el) return;
    el.scrollTop = el.scrollHeight;
    lastTop.current = el.scrollTop;
  }, [follow, items, drafts]);

  // Not live — a stored conversation, or one scrolled back in time: open at
  // its end, where the time bar points.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (live || !el) return;
    el.scrollTop = el.scrollHeight;
  }, [live, items]);

  const selecting = useCallback(() => {
    const selection = typeof document === "undefined" ? null : document.getSelection();
    const el = scroller.current;
    return Boolean(el && selection && !selection.isCollapsed && selection.anchorNode && el.contains(selection.anchorNode));
  }, []);

  useEffect(() => {
    if (!live) return;
    const onSelection = () => {
      if (selecting()) setFollowing(false);
    };
    document.addEventListener("selectionchange", onSelection);
    return () => document.removeEventListener("selectionchange", onSelection);
  }, [live, selecting]);

  const scrolled = () => {
    const el = scroller.current;
    if (!el) return;
    const top = el.scrollTop;
    const up = top < lastTop.current - 1;
    lastTop.current = top;
    if (!live) return;
    const fromEnd = el.scrollHeight - top - el.clientHeight;
    if (up && fromEnd > 2) setFollowing(false);
    else if (!up && fromEnd <= FOLLOW_SLACK_PX && !selecting()) setFollowing(true);
  };

  return (
    <div className="ph-no-capture relative flex min-h-0 flex-1 flex-col" aria-live="off">
      <div
        ref={scroller}
        onScroll={scrolled}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain select-text [-webkit-touch-callout:default]"
      >
        <div className="flex w-full flex-col gap-4 py-3">
          {items.length === 0 && placeholder && <p className="text-fg/55">{placeholder}</p>}
          {items.map((item) =>
            item.kind === "turn" ? (
              <TurnLine key={item.turn.id} turn={item.turn} />
            ) : item.mark.kind === "draft" ? (
              <DraftLine
                key={item.mark.key}
                mark={item.mark}
                draft={draftsById.get(item.mark.draftId)}
                open={openDraft === item.mark.key}
                onToggle={() => {
                  setFollowing(false);
                  setOpenDraft((was) => (was === item.mark.key ? null : item.mark.key));
                }}
              />
            ) : item.mark.kind === "spark" ? (
              <SparkLine key={item.mark.key} mark={item.mark} title={titleOf(item.mark.ordinal)} />
            ) : item.mark.kind === "lookup" ? (
              <LookupLine key={item.mark.key} mark={item.mark} />
            ) : (
              <ContinuedLine key={item.mark.key} />
            ),
          )}
        </div>
      </div>
      {live && !following && (
        <button
          type="button"
          onClick={() => setFollowing(true)}
          onWheel={(event) => scroller.current?.scrollBy({ top: event.deltaY })}
          className="vm-glass absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-medium text-fg select-none"
        >
          Latest ↓
        </button>
      )}
    </div>
  );
}

/** One line of the conversation, theirs or the assistant's. */
export function TurnLine({ turn }: { turn: Turn }) {
  if (turn.who === "user") {
    // Their fillers are counted, not shown: "um" on a screen reads as a fault.
    const said = stripFillers(turn.text);
    return said ? (
      <p className="max-w-[85%] self-end rounded-2xl rounded-br-md bg-fg/[0.07] px-4 py-2.5 leading-relaxed">{said}</p>
    ) : null;
  }
  return (
    <p className="max-w-[95%] leading-relaxed text-fg/90">
      {/* While its voice is saying it, each word fades in where it already is. */}
      <SpokenText text={turn.text} voiced={turn.voiced} />
      {turn.interrupted && <span className="ml-1.5 text-xs text-amber-700 dark:text-amber-300/80">cut off</span>}
    </p>
  );
}

/** A draft, where the assistant wrote it: every line of one draft opens its newest text. */
function DraftLine({
  mark,
  draft,
  open,
  onToggle,
}: {
  mark: Extract<Mark, { kind: "draft" }>;
  draft: DraftCue | undefined;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        aria-expanded={draft ? open : undefined}
        disabled={!draft}
        onClick={onToggle}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface/60 px-3 py-2 text-left text-sm disabled:cursor-default"
      >
        <FileText size={15} aria-hidden className="shrink-0 text-sky-700 dark:text-sky-300" />
        <span className="min-w-0 flex-1 truncate">
          <span className="font-medium">{mark.major > 1 ? "Draft updated" : "Draft"}</span>
          {" · "}
          {draft ? draft.title || "Untitled" : "on the recording's page"}
        </span>
        <span className="shrink-0 text-xs text-fg/55">v{mark.major}</span>
        {draft && (
          <ChevronRight
            size={15}
            aria-hidden
            className={["shrink-0 text-fg/45 transition-transform", open ? "rotate-90" : ""].join(" ")}
          />
        )}
      </button>
      {open && draft && (
        <div className="rounded-xl border border-line bg-surface/40 p-3">
          <div className="mb-2 flex items-start gap-3">
            <p className="min-w-0 flex-1 text-xs text-fg/55">{draft.version}, the latest.</p>
            <CopyButton text={draft.text} />
          </div>
          <DraftMarkdown text={draft.text} className="max-h-[50dvh] overflow-y-auto text-sm leading-relaxed select-text" />
        </div>
      )}
    </div>
  );
}

/** A spark they pulled: the question the assistant is about to ask, and on what. */
function SparkLine({ mark, title }: { mark: Extract<Mark, { kind: "spark" }>; title: string | null }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-fg/65">
      <Sparkles size={14} aria-hidden className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-300" />
      <span className="min-w-0">
        You asked: {mark.question ?? SPARK_LABELS[mark.spark]}
        {title && <span className="text-fg/50"> · {title}</span>}
      </span>
    </p>
  );
}

/** A search the assistant ran: what it looked up, and what came back. */
function LookupLine({ mark }: { mark: Extract<Mark, { kind: "lookup" }> }) {
  return (
    <p className="flex items-start gap-1.5 text-sm text-fg/65">
      <Search size={14} aria-hidden className="mt-0.5 shrink-0 text-sky-700 dark:text-sky-300" />
      <span className="min-w-0">
        {mark.query}
        <span className="text-fg/50"> · {mark.found ?? "looking it up"}</span>
      </span>
    </p>
  );
}

/** Where a later drive picked the conversation up. */
function ContinuedLine() {
  return (
    <p className="flex items-center gap-3 text-xs text-fg/50 select-none">
      <span aria-hidden className="h-px flex-1 bg-line" />
      Continued
      <span aria-hidden className="h-px flex-1 bg-line" />
    </p>
  );
}
