"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * What the conversation is about right now, in two to four words.
 *
 * REPLACES THE LIVE EXCHANGE, which used to sit here: the last eight turns of
 * the conversation, as text. It was the wrong thing to put in front of somebody
 * in a car cradle. Reading is the one thing they cannot do, and a column of
 * bubbles that reflows every time a reply streams in is motion in the corner of
 * the eye for the whole drive — the exact failure the cue panel below is
 * designed around. One short title naming the subject can be taken in
 * peripherally, in what a glance actually costs.
 *
 * PLAIN TEXT, NOT A DEPARTURE BOARD. This was a split-flap board first, and the
 * tiles were the problem: uppercase monospace in boxes, cut by a seam, is slower
 * to read than the same words set as a headline — and reading speed is the
 * whole budget here.
 *
 * WHY IT BLURS. A cut is ambiguous at a glance: a peripheral look cannot tell
 * "this just changed" from "this was always that". So the old title blurs away
 * and the new one resolves out of the blur. That says "the subject moved"
 * without asking anybody to read the letters while they are moving.
 *
 * WHAT MAKES THAT AFFORDABLE is upstream, not here: the container's title
 * prompt returns the current title UNCHANGED while the subject holds, so this
 * animates when the conversation genuinely turns and sits perfectly still the
 * rest of the time.
 *
 * Never announced (`aria-live="off"`), the same rule the exchange had and the
 * cue panel keeps: a screen reader reading this out would interrupt the thought
 * it is supposed to support.
 */

/** How long the old title takes to blur away. Matches `vm-title-blur`. */
const BLUR_MS = 320;

export function TopicTitle({ title }: { title: string | null }) {
  // A plain cut for anybody who has asked for less motion. `globals.css`
  // cancels the animation; this skips the wait for a blur that will not play.
  const still = useReducedMotion();

  const [shown, setShown] = useState(title);
  // Derived rather than stored: the title is being replaced for exactly as long
  // as the one that arrived differs from the one on screen. A title that
  // changes again mid-blur restarts the wait and lands on the newest.
  const changing = title !== shown;

  useEffect(() => {
    if (!changing) return;
    // Nothing on screen yet, or no blur to wait for: swap straight away.
    const wait = still || !shown ? 0 : BLUR_MS;
    const id = window.setTimeout(() => setShown(title), wait);
    return () => window.clearTimeout(id);
  }, [changing, title, shown, still]);

  return (
    <section
      // Height reserved from the first render, empty included, so the cue panel
      // below keeps the position it has trained. Two lines of title.
      className="flex min-h-20 w-full max-w-md items-center justify-center sm:min-h-24"
      // Never announced. See the file comment.
      aria-live="off"
    >
      {shown && (
        <p
          // Keyed by the text, so each new title is a new element and resolves
          // in from the blur the old one left behind.
          key={shown}
          data-blurred={changing && !still ? "" : undefined}
          className="vm-title text-balance text-center text-3xl font-semibold leading-tight tracking-tight text-white sm:text-4xl"
        >
          {shown}
        </p>
      )}
    </section>
  );
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
