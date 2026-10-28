"use client";

import { Search } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
// The `/digest` subpath, not the package index: the index pulls in server code.
import type { ConversationDigest, DigestGist } from "@voicemural/talkback/digest";
import type { Conversation, Speaker } from "@/lib/talkback/conversation";
import { useAgentName } from "../agent-name-context";
import { settleGists } from "./recent";
import { stackModel, type StackTopic, type Whose } from "./stack";

/**
 * Stack: the conversation as a stack of topics (`stack.ts`), drawn from the
 * design canvas "Souffleur Topic Stack" (28 Oct 2026). From the bottom up:
 * the newest words as they are said, the turn before as a line, and the topic
 * being talked about as the largest bubble, with what was decided on it; the
 * earlier topics above, each with its decision, on slots they keep.
 *
 * THE LARGEST BUBBLE, NOT A SHEET. The current topic sits on the same ground
 * as the others, rounded all round and inset, the same kind of thing, bigger
 * — never a drawer over the screen.
 *
 * NO LABELS. No "open", no visit count, no "replying to": the decision says
 * where a topic stands, the dot says whose words it rests on, and a return
 * shows in the one motion on the screen.
 *
 * TWO MOTIONS, NOTHING ELSE. A return is cued first — the topic's bubble
 * lifts with a dark ring for `CUE_MS` — then the topic comes down into the
 * large bubble while the one left rises out of it into its own slot, in one
 * eased move of `MOVE_MS` with no overshoot. A new topic only pushes the one
 * left up. The topic just left keeps a soft ring for `RING_MS`, because the
 * move is most likely missed at a glance. Everything else holds still, and
 * with reduced motion the moves are cuts.
 */

const CUE_MS = 200;
const MOVE_MS = 500;
const RING_MS = 8000;
const EASE = "cubic-bezier(.3,0,.1,1)";
/** The live line's oldest words fade, when the line starts mid-turn. */
const FADES = [0.3, 0.5, 0.75];

const DOT: Record<Whose, string> = {
  user: "bg-viz-2",
  agent: "bg-viz-1",
  both: "bg-[linear-gradient(90deg,var(--color-viz-2)_50%,var(--color-viz-1)_50%)]",
};
const CARET: Record<Speaker, string> = { user: "bg-viz-2", agent: "bg-viz-1" };

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export function StackView({
  conversation,
  digest,
  speaking,
  onZoom,
  placeholder,
}: {
  conversation: Conversation;
  digest: ConversationDigest;
  /** Who is talking this second, for the caret; null for nobody. */
  speaking: Speaker | null;
  onZoom: (key: string) => void;
  placeholder?: string;
}) {
  const agent = useAgentName();
  // A turn's line changes at most once, from the guess to the model's (`settleGists`).
  const [gists, setGists] = useState<ReadonlyMap<number, DigestGist>>(() => new Map());
  const settled = settleGists(gists, digest.gists);
  if (settled !== gists) setGists(settled);

  // The topic shown as current lags the conversation's for the moment a
  // return is cued. Adjusted during render, not in an effect.
  const target = conversation.current;
  const [seen, setSeen] = useState(target);
  const [shown, setShown] = useState(target);
  const [cue, setCue] = useState<string | null>(null);
  const [ring, setRing] = useState<string | null>(null);
  if (target !== seen) {
    setSeen(target);
    const returning = conversation.sections.some((s) => s.key === target && (s.visits ?? 1) > 1);
    if (returning && !reducedMotion()) {
      setCue(target);
    } else {
      setRing(shown);
      setShown(target);
      setCue(null);
    }
  }
  useEffect(() => {
    if (cue === null) return;
    const timer = window.setTimeout(() => {
      setRing(shown);
      setShown(cue);
      setCue(null);
    }, CUE_MS);
    return () => window.clearTimeout(timer);
  }, [cue, shown]);
  useEffect(() => {
    if (ring === null) return;
    const timer = window.setTimeout(() => setRing(null), RING_MS);
    return () => window.clearTimeout(timer);
  }, [ring]);

  const [unfolded, setUnfolded] = useState(false);
  const model = stackModel(conversation, digest, settled, shown);

  // FLIP: where everything was before this render, so a move starts there.
  const bubbles = useRef(new Map<string, HTMLElement>());
  const header = useRef<HTMLButtonElement>(null);
  const rects = useRef(new Map<string, DOMRect>());
  const headerRect = useRef<DOMRect | null>(null);
  const lastShown = useRef(shown);
  const shelf = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    // The newest topics sit nearest the current one: a shelf too tall for the
    // screen keeps its bottom in view, and the oldest scroll away above.
    if (shelf.current && !unfolded) shelf.current.scrollTop = shelf.current.scrollHeight;
    const prev = lastShown.current;
    if (prev !== shown) {
      lastShown.current = shown;
      if (!reducedMotion()) {
        const head = header.current;
        const from = shown ? rects.current.get(shown) : undefined;
        if (head) {
          const to = head.getBoundingClientRect();
          if (from && to.width > 0) {
            // The topic comes down from its bubble into the large one.
            head.animate(
              [
                {
                  transform: `translate(${from.left - to.left}px, ${from.top - to.top}px) scale(${Math.min(1, from.width / to.width)})`,
                  opacity: 0.85,
                },
                { transform: "none", opacity: 1 },
              ],
              { duration: MOVE_MS, easing: EASE },
            );
          } else {
            head.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
          }
        }
        // The topic left rises out of the large bubble into its slot.
        const leaving = prev ? bubbles.current.get(prev) : undefined;
        const fromHead = headerRect.current;
        if (leaving && fromHead) {
          const to = leaving.getBoundingClientRect();
          leaving.animate(
            [
              { transform: `translate(${fromHead.left - to.left}px, ${fromHead.top - to.top}px)`, opacity: 0 },
              { transform: "none", opacity: 1 },
            ],
            { duration: MOVE_MS, easing: EASE },
          );
        }
      }
    }
    // Measured at rest only: a rect taken mid-move would start the next one in the wrong place.
    for (const [key, el] of bubbles.current) {
      if (el.getAnimations().length === 0) rects.current.set(key, el.getBoundingClientRect());
    }
    if (header.current && header.current.getAnimations().length === 0) {
      headerRect.current = header.current.getBoundingClientRect();
    }
  });

  const bubbleRef = (key: string) => (el: HTMLElement | null) => {
    if (el) bubbles.current.set(key, el);
    else bubbles.current.delete(key);
  };

  if (!model.current && !model.live) {
    return (
      <p className="m-auto max-w-xs text-center text-sm text-fg/55">
        {placeholder ?? "Topics appear here as you talk, each with what you decided."}
      </p>
    );
  }

  const live = model.live;
  return (
    <div className="ph-no-capture flex min-h-0 flex-1 flex-col gap-3 pt-2" aria-live="off">
      {/* Pushed down by `mt-auto` rather than `justify-end`, so a shelf that overflows still scrolls to its top. */}
      <div ref={shelf} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto overscroll-contain px-1 pt-1 pb-1">
        <span aria-hidden className="mt-auto" />
        {model.folded.length > 0 && (
          <button
            type="button"
            onClick={() => setUnfolded((was) => !was)}
            aria-expanded={unfolded}
            className="inline-flex min-h-11 cursor-pointer items-center gap-2 self-center rounded-full border-[1.5px] border-dashed border-fg/25 px-4 text-sm font-semibold text-fg/70"
          >
            <span aria-hidden className="flex">
              {model.folded.slice(0, 3).map((t, i) => (
                <span key={t.key} className={`size-2 rounded-full ${DOT[t.whose]} ${i > 0 ? "-ml-0.5" : ""}`} />
              ))}
            </span>
            {foldedLabel(model.folded)}
          </button>
        )}
        {unfolded &&
          model.folded.map((topic) => (
            <Bubble key={topic.key} topic={topic} onZoom={onZoom} elRef={bubbleRef(topic.key)} />
          ))}
        {model.slots.map((slot) =>
          slot.kind === "gap" ? (
            <div
              key={slot.topic.key}
              aria-hidden
              className={`${side(slot.topic)} w-[min(17rem,80%)] rounded-[20px] border-[1.5px] border-dashed border-fg/25`}
            >
              <span className="invisible block px-4 pt-2.5 pb-3">
                <span className="block text-[17px] font-semibold">{slot.topic.title}</span>
                {slot.topic.decision && <span className="block text-sm">{slot.topic.decision}</span>}
              </span>
            </div>
          ) : (
            <Bubble
              key={slot.topic.key}
              topic={slot.topic}
              onZoom={onZoom}
              elRef={bubbleRef(slot.topic.key)}
              cued={cue === slot.topic.key}
              ringed={ring === slot.topic.key}
            />
          ),
        )}
      </div>

      <section className="flex min-h-[18rem] shrink-0 flex-col gap-3 rounded-[28px] border border-line bg-surface px-5 pt-5 pb-4">
        {model.current ? (
          <button
            ref={header}
            type="button"
            onClick={() => onZoom(model.current!.key)}
            style={{ transformOrigin: "left top" }}
            className="flex cursor-pointer flex-col gap-1 text-left"
          >
            <span className="flex items-center gap-2.5">
              <Dot whose={model.current.whose} size="size-3" />
              <span className="text-[1.625rem] leading-tight font-bold tracking-tight">
                {model.current.title}
              </span>
            </span>
            {model.current.decision && (
              <span className="pl-[1.375rem] text-[17px] leading-snug text-fg/70">{model.current.decision}</span>
            )}
          </button>
        ) : (
          <span className="min-h-9" />
        )}
        <span aria-hidden className="h-px shrink-0 bg-line/70" />

        {model.previous && (
          <p className="flex items-baseline gap-2.5 text-lg leading-snug">
            <span
              aria-hidden
              className={`size-2 shrink-0 -translate-y-0.5 rounded-full ${CARET[model.previous.who]}`}
            />
            <span className="sr-only">{model.previous.who === "user" ? "You:" : `${agent.Name}:`}</span>
            <span className={model.previous.provisional ? "text-fg/45" : "text-fg/80"}>{model.previous.text}</span>
          </p>
        )}

        {model.lookup && (
          <div className="flex flex-col gap-2 rounded-2xl bg-sky-500/10 px-3.5 py-3">
            <p className="flex items-start gap-2.5 text-[17px] leading-snug">
              <Search size={17} aria-hidden className="mt-0.5 shrink-0 text-sky-700 dark:text-sky-300" />
              <span className="min-w-0">{model.lookup.query}</span>
            </p>
            {model.lookup.found === null ? (
              <span aria-hidden className="relative h-[3px] overflow-hidden rounded-full bg-sky-500/20">
                <span className="vm-sweep absolute inset-y-0 w-2/5 rounded-full bg-viz-1" />
              </span>
            ) : (
              <span className="pl-7 text-sm font-semibold text-sky-700 dark:text-sky-300">{model.lookup.found}</span>
            )}
          </div>
        )}

        {live && (
          <p className="line-clamp-4 flex-1 text-2xl leading-snug font-medium text-fg">
            <span className="sr-only">{live.who === "user" ? "You:" : `${agent.Name}:`}</span>
            {live.words.map((word, i) => (
              <span
                key={`${live.seq}:${i}`}
                style={live.cut && i < FADES.length ? { opacity: FADES[i] } : undefined}
              >
                {word}{" "}
              </span>
            ))}
            {speaking === live.who && (
              <span
                aria-hidden
                className={`vm-caret ml-0.5 inline-block h-[1.1em] w-[3px] -translate-y-[0.1em] rounded-full align-middle ${CARET[live.who]}`}
              />
            )}
          </p>
        )}
      </section>
    </div>
  );
}

/** Left and right in turn, by the order topics first came up, so a topic never changes sides. */
function side(topic: StackTopic): string {
  return (topic.ordinal ?? 0) % 2 === 1 ? "self-start" : "self-end";
}

function foldedLabel(folded: StackTopic[]): string {
  const [first, second, ...rest] = folded;
  const names = [first, second].filter(Boolean).map((t) => t!.title.split(" ")[0]);
  return rest.length > 0 ? `${names.join(", ")} and ${rest.length} more` : names.join(" and ");
}

function Dot({ whose, size = "size-2.5" }: { whose: Whose; size?: string }) {
  return (
    <>
      <span aria-hidden className={`${size} shrink-0 rounded-full ${DOT[whose]}`} />
      <span className="sr-only">
        {whose === "user" ? "Mostly your words." : whose === "agent" ? "Mostly the assistant's words." : "Both of you."}
      </span>
    </>
  );
}

/** An earlier topic: its name and what was decided. A tap opens it. */
function Bubble({
  topic,
  onZoom,
  elRef,
  cued = false,
  ringed = false,
}: {
  topic: StackTopic;
  onZoom: (key: string) => void;
  elRef: (el: HTMLElement | null) => void;
  /** About to come back: lifted, with a dark ring. */
  cued?: boolean;
  /** Just left: a soft ring while the move may have been missed. */
  ringed?: boolean;
}) {
  return (
    <button
      ref={elRef}
      type="button"
      onClick={() => onZoom(topic.key)}
      className={[
        side(topic),
        "flex w-[min(17rem,80%)] shrink-0 cursor-pointer flex-col gap-0.5 rounded-[20px] border bg-surface px-4 pt-2.5 pb-3 text-left transition-[box-shadow,transform,border-color] duration-200",
        cued
          ? "-translate-y-0.5 border-fg shadow-[0_0_0_2px_var(--color-fg),0_8px_20px_rgb(0_0_0/0.14)]"
          : ringed
            ? "border-line shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-fg)_12%,transparent)] duration-700"
            : "border-line",
      ].join(" ")}
    >
      <span className="flex items-center gap-2 text-[17px] leading-snug font-semibold">
        <Dot whose={topic.whose} />
        <span className="min-w-0 truncate">{topic.title}</span>
      </span>
      {topic.decision && <span className="pl-[1.125rem] text-sm leading-snug text-fg/65">{topic.decision}</span>}
    </button>
  );
}
