"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { flapPlan } from "./split-flap";

/**
 * What the conversation is about right now, on a departure board.
 *
 * REPLACES THE LIVE EXCHANGE, which used to sit here: the last eight turns of
 * the conversation, as text. It was the wrong thing to put in front of somebody
 * in a car cradle. Reading is the one thing they cannot do, and a column of
 * bubbles that reflows every time a reply streams in is motion in the corner of
 * the eye for the whole drive — the exact failure the cue panel below is
 * designed around. Two to four words naming the subject can be taken in
 * peripherally, in what a glance actually costs.
 *
 * WHY IT FLIPS. A cut is ambiguous at a glance: a peripheral look cannot tell
 * "this just changed" from "this was always that". The split-flap makes the
 * change itself the signal, and it is legible without being read — the ticking
 * row says "the subject moved" before any of the letters have been.
 *
 * WHAT MAKES THAT AFFORDABLE is upstream, not here: the container's title
 * prompt returns the current title UNCHANGED while the subject holds, so this
 * animates when the conversation genuinely turns and sits perfectly still the
 * rest of the time. One `setInterval` for about a second, a handful of times an
 * hour, on a phone that is also holding a MediaRecorder open.
 *
 * Never announced — `aria-live="off"`, with the title on the wrapper's label
 * and the tiles hidden — the same rule the exchange had and the cue panel
 * keeps: a screen reader reading this out would interrupt the thought it is
 * supposed to support.
 */

/** One drum step. Eight of them is the longest journey a cell takes. */
const FLAP_MS = 70;
/** How far each cell lags the one to its left, so the row ripples. */
const STAGGER_MS = 20;
/** The empty board, before anything has been said worth naming. */
const BLANK_CELLS = 12;

export function TopicBoard({ title }: { title: string | null }) {
  // Uppercase because the drums are: `FLAP_ALPHABET` has one case, and a board
  // that mixed them would need twice the drums to say the same thing.
  const target = (title ?? "").toUpperCase();

  /* A plain cut for anybody who has asked for less motion.
   *
   * Read here rather than left to a `motion-reduce:` class, because the ticking
   * is a TIMER and not a CSS animation: the class would cancel the fold and
   * leave the letters marching through the alphabet, which is the worse half of
   * the effect. `globals.css` cancels the fold; this cancels the ticking.
   *
   * Subscribed rather than sampled, so turning the preference on mid-drive
   * stops the board rather than waiting for a reload — which is the whole
   * situation somebody turns it on in. */
  const still = useReducedMotion();

  const [shown, setShown] = useState("");
  /* The mirror of `shown` that the interval reads.
   *
   * The ticks run faster than a render settles, and a flip interrupted by a new
   * title has to restart from what is ON THE BOARD rather than from the title
   * it was heading for. So the interval writes both, and the effect reads this
   * one. */
  const showing = useRef("");

  useEffect(() => {
    // Nothing runs while motion is reduced: the title is rendered straight.
    // `showing` is deliberately left where it was, so turning the preference
    // back off flips the board forward from what it last showed rather than
    // from a position it never held.
    if (still) return;
    if (target === showing.current) return;

    const plan = flapPlan(showing.current, target);
    const from = showing.current.padEnd(plan.length, " ");
    let elapsed = 0;

    const id = window.setInterval(() => {
      elapsed += FLAP_MS;
      let settled = true;
      const next = plan
        .map((cell, i) => {
          // One clock for the whole board, read per cell — which is what lets a
          // single interval drive 32 drums that all started at different times.
          const step = Math.floor((elapsed - cell.offset * STAGGER_MS) / FLAP_MS);
          if (step < cell.steps.length) settled = false;
          if (step <= 0 || cell.steps.length === 0) return from[i]!;
          return cell.steps[Math.min(step, cell.steps.length) - 1]!;
        })
        .join("");

      // The padding the plan needed is not part of the title: land on the
      // title itself, so the next change compares like with like.
      showing.current = settled ? target : next;
      setShown(showing.current);
      if (settled) window.clearInterval(id);
    }, FLAP_MS);

    return () => window.clearInterval(id);
  }, [target, still]);

  const board = still ? target : shown;
  const groups = board.trim()
    ? words(board)
    : [{ at: 0, chars: Array.from({ length: BLANK_CELLS }, () => " ") }];

  return (
    <section
      className="flex w-full max-w-md flex-wrap items-center justify-center gap-x-2 gap-y-1"
      // Height reserved from the first render, blank board included, so the cue
      // panel below keeps the position it has trained. Two rows of tiles.
      style={{ minHeight: "5rem" }}
      // Never announced. See the file comment.
      aria-live="off"
      aria-label={title ?? undefined}
    >
      {groups.map((group) => (
        // The group is what `flex-wrap` breaks between, so a line never breaks
        // inside a word — a title split across two rows mid-word is unreadable
        // at a glance, which is the only way this is ever read.
        <span key={group.at} className="flex gap-0.5">
          {group.chars.map((char, j) => (
            <Tile key={`${group.at + j}:${char}`} char={char} />
          ))}
        </span>
      ))}
    </section>
  );
}

function Tile({ char }: { char: string }) {
  return (
    <span
      aria-hidden
      className="relative flex size-8 items-center justify-center rounded bg-ink-soft font-mono text-lg ring-1 ring-line sm:size-9 sm:text-xl"
      // Keyed by the character above, so this element is NEW on every change
      // and the fold replays. Inline rather than a class for the same reason
      // the cue rows are: a class cannot restart an animation on a re-render.
      style={{ animation: `vm-flap ${FLAP_MS}ms ease-out` }}
    >
      {/* The seam the flaps meet at. It is what makes a tile read as a drum
          rather than as a box with a letter in it. */}
      <span
        aria-hidden
        className="absolute inset-x-0 top-1/2 h-px bg-[var(--color-ink)]/70"
      />
      {char === " " ? "\u00a0" : char}
    </span>
  );
}

/**
 * The cells, grouped into words.
 *
 * `at` is the cell's position on the whole board, not in its word, so a tile's
 * key stays put as the words around it grow and shrink — otherwise every cell
 * to the right of a lengthening word would remount and re-fold for nothing.
 */
function words(shown: string): { at: number; chars: string[] }[] {
  const groups: { at: number; chars: string[] }[] = [];
  let at = 0;
  for (const part of shown.split(" ")) {
    if (part.length > 0) groups.push({ at, chars: [...part] });
    at += part.length + 1;
  }
  return groups;
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
