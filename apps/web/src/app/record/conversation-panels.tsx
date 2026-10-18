"use client";

import { Lock } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from "react";
import { stripFillers } from "@voicemural/shared";
import type { Floor } from "@/lib/recorder/floor-store";
import {
  EMPTY_CONVERSATION,
  type ConversationStore,
  type Section,
  type Speaker,
} from "@/lib/talkback/conversation";
import { SAY_BACK_SHARE, allSignals, type SubjectSignal } from "@/lib/talkback/signals";

/**
 * Both sides of the conversation, one panel each, in sections by subject.
 *
 * REPLACES THE TOPIC TITLE AND ITS TRAIL. Those said what was being talked
 * about and where the talk had been, in a few words, because the screen was
 * for somebody who could not read it. The study has since moved to who holds
 * the floor, and that is a question about TURNS: when the agent spoke, when it
 * was held back, when it was poked. So the screen shows them — the agent's in
 * one panel, the person's in the other — and keeps what the title did well:
 * the current subject resolves in from a blur, the earlier ones recede, and
 * nothing moves except when something happened.
 *
 * ONE SUBJECT, ONE SECTION, in both panels. A drive comes back to things, and
 * a log would put the second half of a subject twenty minutes below its first.
 * Here the conversation going back to a subject scrolls both panels back to
 * its section, where the new turns land under the old ones
 * (`conversation.ts`).
 *
 * TWO SCROLLERS, KEPT ON THE SAME SUBJECT. Stacked in portrait and side by
 * side in landscape, so each panel scrolls on its own — and when the person
 * scrolls one, the other follows to the same section, at the same point
 * through it. While the drive runs the panels follow the newest line; a
 * scroll of their own pauses that until they tap back to now, or leave the
 * panels alone for a few seconds.
 *
 * WHOEVER IS TALKING IS LIT: their panel takes a ring in their colour, the
 * other recedes a little, and the header says "speaking". Turn-taking is the
 * subject, so who holds the floor this second is the one thing on the screen
 * worth catching from the corner of an eye. The agent wins a tie: its own
 * voice can reach the microphone, and the person's panel must not light up
 * because the agent is talking.
 *
 * WHAT THEY HOLD OF EACH SUBJECT, under its heading in their panel: a thin
 * bar of whose words it is built on (theirs, the agent's), a mark for settled
 * or still open, and under the current subject the reasons in plain words
 * (`signals.ts`). No numbers: it is an offer to look, not a score.
 *
 * Never announced (`aria-live="off"`), as the title never was: a screen
 * reader reading turns aloud would talk over the conversation it shows. And
 * `ph-no-capture`, because PostHog's autocapture records the text of whatever
 * is tapped, and these are their words.
 */

/** How long after their last scroll the panels go back to following. */
const RESUME_AFTER_MS = 8000;

export function ConversationPanels({
  store,
  live,
  floor,
  speaker,
  placeholder,
  className = "",
}: {
  store: ConversationStore;
  /** The drive is running: follow the newest line. After it, the panels are a record. */
  live: boolean;
  /** Who may talk, as the agent is under it — null when nothing is connected. */
  floor: Floor | null;
  /** Who is talking this second, if anyone. */
  speaker: Speaker | null;
  /** Shown in their panel until anything has been said. */
  placeholder?: string;
  className?: string;
}) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, () => EMPTY_CONVERSATION);
  const still = useReducedMotion();
  // What is drawn — whose words, settled, the reasons — does not depend on the
  // clock, only the sparks' ranking does; so no ticking time here.
  const signals = useMemo(
    () => new Map(allSignals(state, 0).map((signal) => [signal.key, signal])),
    [state],
  );

  const agentPanel = useRef<HTMLDivElement>(null);
  const userPanel = useRef<HTMLDivElement>(null);
  // The panel the person last put a finger or a wheel on. Only its scrolls are
  // theirs; the other panel's are this component keeping it in step.
  const driver = useRef<HTMLDivElement | null>(null);
  const resumeTimer = useRef<number | null>(null);
  const syncFrame = useRef<number | null>(null);

  const [following, setFollowing] = useState(true);
  const follow = live && following;

  /* FOLLOW: both panels to the end of the current section, after every change
   * while following. The end, not the bottom: on a return to an earlier
   * subject the current section is in the middle, and that is where the new
   * turns are. Laid out first, so it lands in the same frame as the text. */
  useLayoutEffect(() => {
    if (!follow || state.current === null) return;
    for (const panel of [agentPanel.current, userPanel.current]) {
      if (!panel) continue;
      const section = sectionIn(panel, state.current);
      if (!section) continue;
      const top = Math.max(
        section.offsetTop,
        section.offsetTop + section.offsetHeight - panel.clientHeight,
      );
      panel.scrollTo({ top, behavior: still ? "auto" : "smooth" });
    }
  }, [follow, state, still]);

  useEffect(
    () => () => {
      if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
      if (syncFrame.current !== null) window.cancelAnimationFrame(syncFrame.current);
    },
    [],
  );

  const resume = useCallback(() => {
    if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = null;
    driver.current = null;
    setFollowing(true);
  }, []);

  /** Their own hand on a panel: stop following, and come back on our own later. */
  const touched = useCallback(
    (panel: HTMLDivElement | null) => {
      driver.current = panel;
      if (!live) return;
      setFollowing(false);
      if (resumeTimer.current !== null) window.clearTimeout(resumeTimer.current);
      resumeTimer.current = window.setTimeout(resume, RESUME_AFTER_MS);
    },
    [live, resume],
  );

  /** One panel scrolled by them: put the other on the same subject, at the same point through it. */
  const scrolled = useCallback(
    (panel: HTMLDivElement | null) => {
      if (!panel || driver.current !== panel) return;
      if (live && resumeTimer.current !== null) {
        window.clearTimeout(resumeTimer.current);
        resumeTimer.current = window.setTimeout(resume, RESUME_AFTER_MS);
      }
      if (syncFrame.current !== null) return;
      syncFrame.current = window.requestAnimationFrame(() => {
        syncFrame.current = null;
        const other = panel === agentPanel.current ? userPanel.current : agentPanel.current;
        if (!other) return;
        const anchor = sectionAtTop(panel);
        if (!anchor) return;
        const twin = sectionIn(other, anchor.dataset.section ?? "");
        if (!twin) return;
        const through = (panel.scrollTop - anchor.offsetTop) / Math.max(1, anchor.offsetHeight);
        other.scrollTop = twin.offsetTop + through * twin.offsetHeight;
      });
    },
    [live, resume],
  );

  const current = state.sections.find((s) => s.key === state.current);
  const empty = state.sections.length === 0;

  // A drive that is over and said nothing live — talk-back was off, or never
  // connected — is one line, not two empty boxes.
  if (!live && empty) {
    return (
      <p className="rounded-2xl border border-line px-4 py-3 text-sm text-fg/55">
        Nothing from the live conversation to show. The transcript is on the
        recording&rsquo;s page.
      </p>
    );
  }

  return (
    <div
      className={`ph-no-capture relative flex gap-3 portrait:flex-col landscape:flex-row ${className}`}
      aria-live="off"
    >
      <Panel
        who="agent"
        label="Agent"
        panelRef={agentPanel}
        sections={state.sections}
        current={state.current}
        returns={state.returns}
        speaker={speaker}
        onTouched={touched}
        onScrolled={scrolled}
        badge={
          floor === "locked" ? (
            <span className="flex items-center gap-1 normal-case tracking-normal text-amber-700 dark:text-amber-300">
              <Lock size={12} aria-hidden />
              locked
            </span>
          ) : null
        }
        emptyText={
          empty
            ? floor === "locked"
              ? "Locked: it listens, and talks only when you poke it."
              : "It answers when it has something to say."
            : null
        }
      />
      <Panel
        who="user"
        label="You"
        panelRef={userPanel}
        sections={state.sections}
        current={state.current}
        returns={state.returns}
        speaker={speaker}
        onTouched={touched}
        onScrolled={scrolled}
        signals={signals}
        emptyText={empty ? (placeholder ?? null) : null}
      />

      {live && !following && current && (
        // The way back to now, naming where now is — after a return to an
        // earlier subject that is not the bottom of anything.
        <button
          type="button"
          onClick={resume}
          className="vm-glass absolute bottom-3 left-1/2 z-20 max-w-[80%] -translate-x-1/2 truncate rounded-full px-4 py-2 text-sm font-medium text-fg"
        >
          Now: {current.title ?? "…"} ↓
        </button>
      )}
    </div>
  );
}

function Panel({
  who,
  label,
  panelRef,
  sections,
  current,
  returns,
  speaker,
  onTouched,
  onScrolled,
  badge,
  signals,
  emptyText,
}: {
  who: Speaker;
  label: string;
  panelRef: RefObject<HTMLDivElement | null>;
  sections: Section[];
  current: string | null;
  returns: number;
  speaker: Speaker | null;
  onTouched: (panel: HTMLDivElement | null) => void;
  onScrolled: (panel: HTMLDivElement | null) => void;
  badge?: React.ReactNode;
  /** Each subject's signals, drawn under its heading. Their panel only. */
  signals?: Map<string, SubjectSignal>;
  emptyText: string | null;
}) {
  const touch = () => onTouched(panelRef.current);
  const talking = speaker === who;
  // The other one is talking: step back, but stay readable.
  const waiting = speaker !== null && !talking;

  return (
    <section
      aria-label={label}
      className={[
        "flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl border bg-surface/70",
        "transition-[box-shadow,border-color,opacity] duration-200",
        talking
          ? who === "agent"
            ? "border-sky-400/70 ring-[3px] ring-sky-400/25"
            : "border-fg/45 ring-[3px] ring-fg/10"
          : "border-line",
        waiting ? "opacity-70" : "",
      ].join(" ")}
    >
      <header
        className={[
          "flex h-8 shrink-0 items-center justify-between gap-2 px-3 text-xs font-medium tracking-wide uppercase transition-colors",
          talking ? (who === "agent" ? "text-sky-700 dark:text-sky-300" : "text-fg") : "text-fg/60",
        ].join(" ")}
      >
        <span className="flex items-center gap-2">
          {label}
          {talking && <SpeakingBars />}
        </span>
        {badge}
      </header>
      <div
        ref={panelRef}
        onPointerDown={touch}
        onWheel={touch}
        onTouchStart={touch}
        onScroll={() => onScrolled(panelRef.current)}
        // Positioned, so each section's `offsetTop` is measured from here.
        className="relative min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-3"
      >
        {emptyText && <p className="pt-2 text-sm text-fg/50">{emptyText}</p>}
        {sections.map((section) => {
          const isCurrent = section.key === current;
          const turns = section.turns.filter((t) => t.who === who);
          return (
            <section key={section.key} data-section={section.key} className="pb-4">
              {/* The subject, stuck to the top of the panel while its turns are
                  in view. The current one resolves in from a blur — again on
                  every return to it, which is what the key is for — and the
                  others recede, as the trail under the old title did. */}
              <h3 className="sticky top-0 z-10 -mx-3 bg-surface/95 px-3 py-1.5 backdrop-blur">
                <span
                  key={isCurrent ? `${section.key}:${returns}` : section.key}
                  className={[
                    "block truncate tracking-tight",
                    isCurrent
                      ? "vm-title text-lg font-semibold text-fg"
                      : "text-sm font-medium text-fg/45",
                  ].join(" ")}
                >
                  {section.title ?? "…"}
                </span>
                {signals?.has(section.key) && (
                  <SubjectMarks signal={signals.get(section.key)!} current={isCurrent} />
                )}
              </h3>
              {turns.length > 0 && (
                <ol className="space-y-2">
                  {turns.map((turn) => (
                    <li
                      key={turn.id}
                      className={[
                        "border-l-2 pl-2.5 text-[0.95rem] leading-snug",
                        who === "agent" ? "border-sky-400/60" : "border-fg/25",
                        isCurrent ? "text-fg/90" : "text-fg/55",
                      ].join(" ")}
                    >
                      {/* Their fillers are counted (`signals.ts`), not shown:
                          "um" on a screen reads as a transcription fault. */}
                      {who === "user" ? stripFillers(turn.text) : turn.text}
                      {/* Cut off — by them talking, or by a Lock. Said, because
                          a reply that stops mid-sentence otherwise reads as a
                          rendering fault rather than as a turn taken back. */}
                      {turn.interrupted && (
                        <span className="ml-1.5 text-xs text-amber-700 dark:text-amber-300/80">cut off</span>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </section>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Whose words a subject is built on, and whether it was settled: a thin
 * two-tone bar and a mark, and under the current subject the reasons. Drawn
 * only once there is something to say — a bar needs enough words, a mark a
 * judgement — so a new subject's heading stays clean.
 */
function SubjectMarks({ signal, current }: { signal: SubjectSignal; current: boolean }) {
  const share = signal.agentShare;
  if (share === null && signal.settled === null && signal.reasons.length === 0) return null;
  return (
    <span className="mt-1 block">
      <span className="flex items-center gap-2">
        {share !== null && (
          <span
            className="flex h-1 w-16 overflow-hidden rounded-full bg-sky-400/60"
            role="img"
            aria-label={
              share >= SAY_BACK_SHARE
                ? "Mostly Souffleur's words"
                : share <= 1 - SAY_BACK_SHARE
                  ? "Mostly your words"
                  : "Your words and Souffleur's"
            }
          >
            {/* Theirs first, from the left; the rest of the bar is the agent's. */}
            <span className="h-full bg-fg/70" style={{ width: `${(1 - share) * 100}%` }} />
          </span>
        )}
        {signal.settled !== null && (
          <span
            className={[
              "text-[0.7rem] font-medium tracking-wide uppercase",
              signal.settled
                ? "text-emerald-700 dark:text-emerald-300/80"
                : "text-amber-700 dark:text-amber-300/80",
            ].join(" ")}
          >
            {signal.settled ? "settled" : "open"}
          </span>
        )}
      </span>
      {current && signal.reasons.length > 0 && (
        <span className="mt-0.5 block truncate text-xs font-normal text-fg/55">
          {signal.reasons.join(" · ")}
        </span>
      )}
    </span>
  );
}

/** Three bars rising and falling: someone is talking. Still, for reduced motion. */
function SpeakingBars() {
  return (
    <span className="vm-speaking flex h-3 items-end gap-[2px]" role="img" aria-label="speaking">
      <span className="h-full w-[3px] rounded-full bg-current" />
      <span className="h-full w-[3px] rounded-full bg-current" />
      <span className="h-full w-[3px] rounded-full bg-current" />
    </span>
  );
}

function sectionIn(panel: HTMLElement, key: string): HTMLElement | null {
  for (const el of panel.querySelectorAll<HTMLElement>("[data-section]")) {
    if (el.dataset.section === key) return el;
  }
  return null;
}

/** The section whose turns are at the top of the panel now. */
function sectionAtTop(panel: HTMLElement): HTMLElement | null {
  let anchor: HTMLElement | null = null;
  for (const el of panel.querySelectorAll<HTMLElement>("[data-section]")) {
    if (el.offsetTop <= panel.scrollTop + 1) anchor = el;
    else break;
  }
  return anchor ?? panel.querySelector<HTMLElement>("[data-section]");
}

/** Whether the viewer has asked for less motion, live. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribeToMotion, readMotion, () => false);
}

function motionQuery(): MediaQueryList | null {
  if (typeof window === "undefined") return null;
  return window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
}

function subscribeToMotion(onChange: () => void): () => void {
  const query = motionQuery();
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

function readMotion(): boolean {
  return motionQuery()?.matches ?? false;
}
