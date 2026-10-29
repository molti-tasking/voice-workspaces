"use client";

import { Search } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
// The `/digest` subpath, not the package index: the index pulls in server code.
import type { ConversationDigest, DigestGist } from "@voicemural/talkback/digest";
import type { Conversation, Speaker } from "@/lib/talkback/conversation";
import { useAgentName } from "../agent-name-context";
import { settleGists } from "./recent";
import { SpokenWords } from "./spoken-text";
import {
  STACK_LIVE_WORDS,
  STACK_LIVE_WORDS_TIGHT,
  STACK_MAX_CLUSTERS,
  arrangeShelf,
  clusterLabel,
  stackModel,
  type StackCluster,
  type StackSlot,
  type StackTopic,
  type Whose,
} from "./stack";

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
 *
 * AS MANY TOPICS AS FIT. The current topic's bubble has a fixed height, so
 * the words coming in never squeeze the shelf; on a short screen it is the
 * smaller one (`TIGHT_BELOW`) and pages fewer words. The shelf fills the rest
 * with as many earlier topics as it holds, the newest nearest: as full
 * bubbles with their decisions while they fit; past that the oldest become
 * small ones with their names only, side by side; and past that the oldest
 * of those are grouped into clusters (`arrangeShelf`), each drawn with a
 * larger circle that counts the topics it holds. Order never changes: a
 * topic only ever moves into the smaller form above it, as the oldest folded
 * before. The fit is worked out again whenever a topic comes or the screen
 * changes size, before it is painted, so it is never seen settling.
 */

const CUE_MS = 200;
const MOVE_MS = 500;
const RING_MS = 8000;
const EASE = "cubic-bezier(.3,0,.1,1)";
/** The live line's first words fade, when its page starts inside a sentence. */
const FADES = [0.3, 0.5, 0.75];
/** Below this height for the whole view, the current topic's bubble is the smaller one. */
const TIGHT_BELOW = 680;
/** The least a full bubble takes, with its gap: what bounds how many could fit. */
const FULL_MIN_PX = 56;

/** How the shelf is drawn: how many of the newest are full bubbles, and how many keep their own. */
interface Fit {
  full: number;
  named: number;
  /** The most clusters: fewer only on a shelf too short for `STACK_MAX_CLUSTERS`. */
  clusters: number;
  /** What it was worked out for: the number of earlier topics and the shelf's height. */
  topics: number;
  height: number;
  /** Still being worked out: the next layout pass checks it again. */
  settling: boolean;
}

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

  // The view's height decides the current bubble's size; the shelf's, how many topics it holds.
  const root = useRef<HTMLDivElement>(null);
  const [tight, setTight] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const model = stackModel(conversation, digest, settled, shown, tight ? STACK_LIVE_WORDS_TIGHT : STACK_LIVE_WORDS);
  const [fit, setFit] = useState<Fit>({
    full: Infinity,
    named: Infinity,
    clusters: STACK_MAX_CLUSTERS,
    topics: 0,
    height: 0,
    settling: true,
  });
  const empty = !model.current && !model.live;
  const shelfPlan = arrangeShelf(model.slots, fit.named, fit.clusters);
  // A cluster that has since merged into a larger one closes.
  const openCluster = shelfPlan.clusters.find((c) => c.key === open) ?? null;

  // Which element stands for a topic on the shelf: its own, or its cluster's.
  const owner = new Map<string, string>();
  for (const c of shelfPlan.clusters) for (const t of c.topics) owner.set(t.key, c.key);
  const ownerOf = (key: string | null) => (key === null ? undefined : (owner.get(key) ?? key));
  const cuedKey = ownerOf(cue);
  const ringKey = ownerOf(ring);

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    const measure = () => setTight(el.clientHeight > 0 && el.clientHeight < TIGHT_BELOW);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [empty]);

  // FLIP: where everything was before this render, so a move starts there.
  const bubbles = useRef(new Map<string, HTMLElement>());
  const header = useRef<HTMLButtonElement>(null);
  const rects = useRef(new Map<string, DOMRect>());
  const headerRect = useRef<DOMRect | null>(null);
  const lastShown = useRef(shown);
  const shelf = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [shelfHeight, setShelfHeight] = useState(0);
  useLayoutEffect(() => {
    const el = shelf.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setShelfHeight(Math.round(el.clientHeight)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [empty]);

  // A new topic or shelf size works the fit out again, from as many full
  // bubbles as could fit. Adjusted during render, not in an effect.
  const topicCount = model.slots.length;
  if (shelfHeight > 0 && (fit.height !== shelfHeight || fit.topics !== topicCount)) {
    setFit({
      full: Math.floor(shelfHeight / FULL_MIN_PX),
      named: Infinity,
      clusters: STACK_MAX_CLUSTERS,
      topics: topicCount,
      height: shelfHeight,
      settling: true,
    });
  }
  const fullCount = Math.min(fit.full, shelfPlan.slots.length);

  // The fit, worked out from the laid-out shelf before it is painted: one
  // step denser per pass, until the shelf holds it.
  useLayoutEffect(() => {
    const el = shelf.current;
    const box = content.current;
    if (!el || !box || openCluster || !fit.settling || fit.height === 0) return;
    const refine = (next: Fit) => setFit(next);
    // Layout sizes, not drawn ones: a bubble mid-move is drawn somewhere else.
    const style = getComputedStyle(el);
    const room = el.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    if (box.offsetHeight <= room + 1) {
      refine({ ...fit, settling: false });
    } else if (fullCount > 0) {
      // One full bubble fewer: the oldest of them joins the small ones.
      refine({ ...fit, full: fullCount - 1 });
    } else if (fit.named === 0 || shelfPlan.slots.length === 0) {
      // Only clusters, and still too many: fewer, larger ones.
      refine({ ...fit, clusters: fit.clusters - 1, settling: fit.clusters > 2 });
    } else {
      // Keep by name the newest wholly in view, less one for the clusters' own
      // bubble. In view as the shelf will show it: scrolled to its bottom.
      const from = box.offsetHeight - room;
      const inView = shelfPlan.slots.filter((slot) => {
        const node =
          slot.kind === "gap"
            ? box.querySelector<HTMLElement>(`[data-slot="${CSS.escape(slot.topic.key)}"]`)
            : bubbles.current.get(slot.topic.key);
        return node ? node.offsetTop >= from - 1 : false;
      }).length;
      // Always at least one fewer than now, so this ends.
      const named = Math.max(0, Math.min(Math.min(fit.named, shelfPlan.slots.length) - 1, inView - 1));
      refine({ ...fit, named });
    }
  }, [fit, fullCount, openCluster, shelfPlan.slots]);

  useLayoutEffect(() => {
    // The newest topics sit nearest the current one: a shelf too tall for the
    // screen keeps its bottom in view, and the oldest scroll away above.
    if (shelf.current && !openCluster) shelf.current.scrollTop = shelf.current.scrollHeight;
    const prev = lastShown.current;
    if (prev !== shown) {
      lastShown.current = shown;
      if (!reducedMotion()) {
        const head = header.current;
        const fromKey = ownerOf(shown);
        const from = fromKey ? rects.current.get(fromKey) : undefined;
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
            head.animate([{ opacity: 0 }, { opacity: 1 }], {
              duration: 200,
              easing: "ease-out",
            });
          }
        }
        // The topic left rises out of the large bubble into its slot, or its cluster.
        const leavingKey = ownerOf(prev);
        const leaving = leavingKey ? bubbles.current.get(leavingKey) : undefined;
        const fromHead = headerRect.current;
        if (leaving && fromHead) {
          const to = leaving.getBoundingClientRect();
          leaving.animate(
            [
              {
                transform: `translate(${fromHead.left - to.left}px, ${fromHead.top - to.top}px)`,
                opacity: 0,
              },
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

  if (empty) {
    return (
      <p className="m-auto max-w-xs text-center text-sm text-fg/55">
        {placeholder ?? "Topics appear here as you talk, each with what you decided."}
      </p>
    );
  }

  const live = model.live;
  const smallSlots = shelfPlan.slots.slice(0, shelfPlan.slots.length - fullCount);
  const fullSlots = shelfPlan.slots.slice(shelfPlan.slots.length - fullCount);
  const small = shelfPlan.clusters.length > 0 || smallSlots.length > 0;
  const slotProps = (slot: StackSlot, compact: boolean) => ({
    slot,
    compact,
    onZoom,
    elRef: bubbleRef(slot.topic.key),
    cued: cuedKey === slot.topic.key,
    ringed: ringKey === slot.topic.key,
  });
  return (
    <div ref={root} className="ph-no-capture flex min-h-0 flex-1 flex-col gap-3 pt-2" aria-live="off">
      {/* Pushed down by `mt-auto` rather than `justify-end`, so a shelf that overflows still scrolls to its top. */}
      <div
        ref={shelf}
        className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain px-1 pt-1 pb-1"
      >
        <span aria-hidden className="mt-auto" />
        <div ref={content} className="relative flex flex-col gap-3">
          {small && (
            <div className="flex flex-wrap gap-2">
              {shelfPlan.clusters.map((cluster) => (
                <ClusterBubble
                  key={cluster.key}
                  cluster={cluster}
                  expanded={openCluster?.key === cluster.key}
                  onToggle={() => setOpen((was) => (was === cluster.key ? null : cluster.key))}
                  elRef={bubbleRef(cluster.key)}
                  cued={cuedKey === cluster.key}
                  ringed={ringKey === cluster.key}
                />
              ))}
              {openCluster && (
                <div className="flex w-full flex-wrap gap-2 rounded-[22px] bg-fg/[0.04] p-2">
                  {openCluster.topics.map((topic) => (
                    <Pill key={topic.key} topic={topic} onZoom={onZoom} />
                  ))}
                </div>
              )}
              {smallSlots.map((slot) => (
                <SlotBubble key={slot.topic.key} {...slotProps(slot, true)} />
              ))}
            </div>
          )}
          {fullSlots.map((slot) => (
            <SlotBubble key={slot.topic.key} {...slotProps(slot, false)} />
          ))}
        </div>
      </div>

      <section
        className={`flex shrink-0 flex-col overflow-hidden rounded-[28px] border border-line bg-surface ${
          tight ? "h-[12.5rem] gap-2.5 px-4 pt-4 pb-3" : "h-[21rem] gap-3 px-5 pt-5 pb-4"
        }`}
      >
        {model.current ? (
          <button
            ref={header}
            type="button"
            onClick={() => onZoom(model.current!.key)}
            style={{ transformOrigin: "left top" }}
            className="flex shrink-0 cursor-pointer flex-col gap-0.5 text-left"
          >
            <span className="flex items-center gap-2.5">
              <Dot whose={model.current.whose} size={tight ? "size-2.5" : "size-3"} />
              <span
                className={`min-w-0 leading-tight font-bold tracking-tight ${
                  tight ? "truncate text-xl" : "line-clamp-2 text-[1.625rem]"
                }`}
              >
                {model.current.title}
              </span>
            </span>
            {model.current.decision && (
              <span
                className={`truncate leading-snug text-fg/70 ${tight ? "pl-5 text-[15px]" : "pl-[1.375rem] text-[17px]"}`}
              >
                {model.current.decision}
              </span>
            )}
          </button>
        ) : (
          <span className={tight ? "min-h-7" : "min-h-9"} />
        )}
        <span aria-hidden className="h-px shrink-0 bg-line/70" />

        {model.previous && (
          <p className={`flex shrink-0 items-baseline gap-2.5 leading-snug ${tight ? "text-base" : "text-lg"}`}>
            <span
              aria-hidden
              className={`size-2 shrink-0 -translate-y-0.5 rounded-full ${CARET[model.previous.who]}`}
            />
            <span className="sr-only">{model.previous.who === "user" ? "You:" : `${agent.Name}:`}</span>
            <span
              className={`min-w-0 ${tight ? "truncate" : "line-clamp-2"} ${model.previous.provisional ? "text-fg/45" : "text-fg/80"}`}
            >
              {model.previous.text}
            </span>
          </p>
        )}

        {model.lookup && (
          <div className="flex shrink-0 flex-col gap-2 rounded-2xl bg-sky-500/10 px-3.5 py-2.5">
            <p className="flex items-start gap-2.5 text-[17px] leading-snug">
              <Search size={17} aria-hidden className="mt-0.5 shrink-0 text-sky-700 dark:text-sky-300" />
              <span className="min-w-0 truncate">{model.lookup.query}</span>
            </p>
            {model.lookup.found === null ? (
              <span aria-hidden className="relative h-[3px] overflow-hidden rounded-full bg-sky-500/20">
                <span className="vm-sweep absolute inset-y-0 w-2/5 rounded-full bg-viz-1" />
              </span>
            ) : (
              <span className="truncate pl-7 text-sm font-semibold text-sky-700 dark:text-sky-300">
                {model.lookup.found}
              </span>
            )}
          </div>
        )}

        {live && (
          <p
            key={live.seq}
            className={`min-h-0 flex-1 leading-snug font-medium text-fg ${tight ? "text-xl" : "text-2xl"}`}
          >
            <span className="sr-only">{live.who === "user" ? "You:" : `${agent.Name}:`}</span>
            <SpokenWords
              words={live.words}
              animate={live.spoken}
              style={(i) => (live.cut && i < FADES.length ? { opacity: FADES[i] } : undefined)}
              // After the last word said, not the end of the page: the rest is waiting, unseen.
              after={
                speaking === live.who && (
                  <span
                    aria-hidden
                    className={`vm-caret ml-0.5 inline-block h-[1.1em] w-[3px] -translate-y-[0.1em] rounded-full align-middle ${CARET[live.who]}`}
                  />
                )
              }
            />
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

const CUED = "-translate-y-0.5 border-fg shadow-[0_0_0_2px_var(--color-fg),0_8px_20px_rgb(0_0_0/0.14)]";
const RINGED = "border-line shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-fg)_12%,transparent)] duration-700";
const marked = (cued: boolean, ringed: boolean) => (cued ? CUED : ringed ? RINGED : "border-line");

/** An earlier topic in its slot, or the gap it left while it is the current one again. */
function SlotBubble({
  slot,
  compact,
  onZoom,
  elRef,
  cued,
  ringed,
}: {
  slot: StackSlot;
  compact: boolean;
  onZoom: (key: string) => void;
  elRef: (el: HTMLElement | null) => void;
  /** About to come back: lifted, with a dark ring. */
  cued: boolean;
  /** Just left: a soft ring while the move may have been missed. */
  ringed: boolean;
}) {
  const { topic } = slot;
  if (slot.kind === "gap") {
    return compact ? (
      <span
        aria-hidden
        data-slot={topic.key}
        className="inline-flex max-w-full items-center rounded-full border-[1.5px] border-dashed border-fg/25 px-3 py-1.5"
      >
        <span className="invisible truncate pl-3.5 text-[15px] leading-snug font-semibold">{topic.title}</span>
      </span>
    ) : (
      <div
        aria-hidden
        data-slot={topic.key}
        className={`${side(topic)} w-[min(17rem,80%)] shrink-0 rounded-[20px] border-[1.5px] border-dashed border-fg/25`}
      >
        <span className="invisible block px-4 pt-2.5 pb-3">
          <span className="block text-[17px] font-semibold">{topic.title}</span>
          {topic.decision && <span className="block text-sm">{topic.decision}</span>}
        </span>
      </div>
    );
  }
  if (compact) return <Pill topic={topic} onZoom={onZoom} elRef={elRef} cued={cued} ringed={ringed} />;
  return (
    <button
      ref={elRef}
      type="button"
      onClick={() => onZoom(topic.key)}
      className={[
        side(topic),
        "flex w-[min(17rem,80%)] shrink-0 cursor-pointer flex-col gap-0.5 rounded-[20px] border bg-surface px-4 pt-2.5 pb-3 text-left transition-[box-shadow,transform,border-color] duration-200",
        marked(cued, ringed),
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

/** An earlier topic by its name only, when the shelf has too little room for full bubbles. A tap opens it. */
function Pill({
  topic,
  onZoom,
  elRef,
  cued = false,
  ringed = false,
}: {
  topic: StackTopic;
  onZoom: (key: string) => void;
  elRef?: (el: HTMLElement | null) => void;
  cued?: boolean;
  ringed?: boolean;
}) {
  return (
    <button
      ref={elRef}
      type="button"
      onClick={() => onZoom(topic.key)}
      className={`inline-flex min-h-9 max-w-full cursor-pointer items-center gap-1.5 rounded-full border bg-surface px-3 py-1.5 text-left text-[15px] leading-snug font-semibold transition-[box-shadow,transform,border-color] duration-200 ${marked(cued, ringed)}`}
    >
      <Dot whose={topic.whose} size="size-2" />
      <span className="min-w-0 truncate">{topic.title}</span>
    </button>
  );
}

/**
 * Several of the oldest topics as one bubble: instead of a dot, a larger
 * circle counting them, set on a second outline, so it reads as a bubble that
 * holds bubbles. A tap opens it on the shelf, and another closes it.
 */
function ClusterBubble({
  cluster,
  expanded,
  onToggle,
  elRef,
  cued,
  ringed,
}: {
  cluster: StackCluster;
  expanded: boolean;
  onToggle: () => void;
  elRef: (el: HTMLElement | null) => void;
  cued: boolean;
  ringed: boolean;
}) {
  const n = cluster.topics.length;
  return (
    <button
      ref={elRef}
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={`inline-flex min-h-9 max-w-full cursor-pointer items-center gap-2 rounded-full border bg-surface py-1 pr-3 pl-1 text-left text-[15px] leading-snug font-semibold text-fg/75 shadow-[3px_-3px_0_-1px_var(--color-canvas),3px_-3px_0_0_var(--color-line)] transition-[box-shadow,transform,border-color] duration-200 ${
        cued ? CUED : ringed ? RINGED : expanded ? "border-fg/40" : "border-line"
      }`}
    >
      <span
        aria-hidden
        className="relative grid size-7 shrink-0 place-items-center rounded-full border-[1.5px] border-fg/30 bg-fg/[0.06] text-[13px] font-bold text-fg tabular-nums"
      >
        {n}
        <span className="absolute -right-0.5 -bottom-0.5 flex">
          {cluster.topics.slice(0, 3).map((t, i) => (
            <span
              key={t.key}
              className={`size-1.5 rounded-full ring-1 ring-surface ${DOT[t.whose]} ${i > 0 ? "-ml-0.5" : ""}`}
            />
          ))}
        </span>
      </span>
      <span className="sr-only">
        {n} topics, {cluster.topics[0]!.title} to {cluster.topics.at(-1)!.title}:
      </span>
      <span aria-hidden className="min-w-0 truncate">
        {clusterLabel(cluster.topics)}
      </span>
    </button>
  );
}
