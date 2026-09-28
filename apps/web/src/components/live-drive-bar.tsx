"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { useCapture } from "./capture-provider";
import { Link } from "./nav-link";

/**
 * What the drive is about, kept at the top of every other screen while it runs.
 *
 * The record screen has its own sticky strip; everywhere else the subject, and
 * the way back to the conversation, scrolled away with the page heading — the
 * only route back was a sheet behind the dock's chevron. On 27 Sep 2026 the
 * person asked for exactly this: a header that stays, naming the current topic.
 *
 * Deliberately quiet: one line, no animation of its own (the dot is the
 * dock's breathing halo's job), and never announced — `RecordingBadge` already
 * said "recording" once, and saying it again on every navigation would be noise.
 */
export function LiveDriveBar() {
  const { isRecording, talkback, cues } = useCapture();
  const pathname = usePathname();
  const shown = isRecording && !pathname.startsWith("/record");
  const bar = useRef<HTMLDivElement>(null);

  /* Its height, published for the page's own sticky headers to sit under.
   * Without it the timeline's date headers stuck at the very top too, behind
   * this bar, and the two overlapped: "some problem with the headers of this
   * page" (28 Sep 2026). */
  useEffect(() => {
    const el = bar.current;
    const root = document.documentElement;
    if (!shown || !el) return;
    const publish = () => root.style.setProperty("--vm-live-bar", `${el.offsetHeight}px`);
    publish();
    const observer = new ResizeObserver(publish);
    observer.observe(el);
    return () => {
      observer.disconnect();
      root.style.removeProperty("--vm-live-bar");
    };
  }, [shown]);

  if (!shown) return null;

  const drafts = cues.drafts.length;

  return (
    <div
      ref={bar}
      className="sticky top-0 z-40 border-b border-line bg-canvas/90 backdrop-blur"
      style={{ paddingTop: "env(safe-area-inset-top)" }}
      aria-live="off"
    >
      <Link
        href="/record"
        className="mx-auto flex max-w-3xl items-center gap-2 px-6 py-2 text-sm text-fg/80 hover:text-fg"
      >
        <span aria-hidden className="size-2 shrink-0 rounded-full bg-red-500" />
        <span className="min-w-0 flex-1 truncate font-medium">
          {talkback.title ?? "Recording"}
        </span>
        {drafts > 0 && (
          <span className="shrink-0 text-xs text-fg/55 tabular-nums">
            {drafts} draft{drafts === 1 ? "" : "s"}
          </span>
        )}
        <span className="shrink-0 text-xs text-fg/55">Back to conversation →</span>
      </Link>
    </div>
  );
}
