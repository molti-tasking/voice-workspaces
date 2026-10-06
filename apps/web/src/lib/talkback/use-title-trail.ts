"use client";

import { useState } from "react";

/** How many earlier subjects are remembered. More than are ever shown. */
const KEPT = 8;

/**
 * The drive's current subject, and the ones it has moved on from, newest first.
 *
 * Held with the recorder, above the router, rather than in the component that
 * shows it. It used to live in `TopicTitle`'s own state, so walking over to the
 * timeline and back — while the drive went on — came back to a record screen
 * with no trail at all: "and then I come back, then it's suddenly empty" (27
 * Sep 2026). Cleared when the drive changes.
 *
 * A NULL TITLE IS NOT A NEW SUBJECT. Talk-back goes off at Stop and reports no
 * title from then on, which used to blank the conversation the moment it
 * ended. The last real title is kept as `title` until the next drive, so the
 * conversation view can stay on screen after it is over (6 Oct 2026).
 */
export function useTitleTrail(
  title: string | null,
  sessionId: string | null,
): { title: string | null; trail: string[] } {
  const [trail, setTrail] = useState<string[]>([]);
  const [trailFor, setTrailFor] = useState(sessionId);
  const [previous, setPrevious] = useState(title);

  // Adjusting state during render, React's documented pattern for deriving
  // from a changed prop: no effect, and no render showing the stale value.
  if (trailFor !== sessionId) {
    setTrailFor(sessionId);
    setTrail([]);
    setPrevious(title);
  } else if (title && previous !== title) {
    setPrevious(title);
    if (previous) {
      setTrail((t) => [previous, ...t.filter((x) => x !== previous && x !== title)].slice(0, KEPT));
    }
  }

  return { title: previous, trail };
}
