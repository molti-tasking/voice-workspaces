"use client";

import { useEffect, useRef } from "react";

/**
 * Jumps to the most recent drive when the timeline first opens.
 *
 * The timeline runs oldest-first so it reads like a journal, which puts today
 * at the bottom — and nobody wants to land five weeks in the past and scroll.
 *
 * Instant, not smooth: a half-second scroll animation on first paint reads as
 * the page being broken. And once only — the infinite scroll navigates with
 * `router.replace`, and re-running this would yank the reader back down every
 * time an earlier drive loaded in.
 */
export function ScrollToLatest({ targetId }: { targetId: string }) {
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;

    // Deep links to a specific drive win over the default jump.
    if (window.location.hash) return;

    const target = document.getElementById(targetId);
    if (target) target.scrollIntoView({ block: "start", behavior: "instant" });
    else window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
  }, [targetId]);

  return null;
}
