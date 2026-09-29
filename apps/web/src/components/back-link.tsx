"use client";

import { ChevronLeft } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";
import { useCapture } from "./capture-provider";
import { Link } from "./nav-link";

/*
 * THE SCREEN BEFORE THIS ONE, as the app navigated. Module state, not React
 * state: it must survive the page that shows the back link being unmounted
 * and a new one mounted, which is exactly what a navigation does.
 */
let current: string | null = null;
let previous: string | null = null;
const listeners = new Set<() => void>();

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}

/** Records each in-app navigation. Rendered once, in the root layout. */
export function NavHistoryTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (pathname === current) return;
    previous = current;
    current = pathname;
    for (const notify of listeners) notify();
  }, [pathname]);
  return null;
}

const NAMES: { prefix: string; name: string }[] = [
  { prefix: "/record", name: "Conversation" },
  { prefix: "/timeline", name: "Timeline" },
  { prefix: "/workspace", name: "Workspace" },
  { prefix: "/board", name: "Board" },
];

/**
 * A back link that goes BACK.
 *
 * The session page's top-left link said "← Timeline" and went to the timeline
 * even when the person had come from the conversation view — a back button in
 * position and shape that went somewhere else (29 Sep 2026). This returns to
 * the screen they actually came from, named, and falls back to `fallback` when
 * there is none (a link opened fresh, or a reload).
 */
export function BackLink({ fallback }: { fallback: { href: string; name: string } }) {
  const pathname = usePathname();
  const { isRecording } = useCapture();
  const from = useSyncExternalStore(
    subscribe,
    () => previous,
    () => null,
  );
  const known = from && from !== pathname ? NAMES.find((n) => from.startsWith(n.prefix)) : undefined;
  const target = known && from ? { href: from, name: known.name } : fallback;

  // During a drive the bar at the top already says "‹ Conversation"; the same
  // link twice, one above the other, is noise.
  if (isRecording && target.href.startsWith("/record")) return null;

  return (
    <Link
      href={target.href}
      className="-ml-1 inline-flex items-center gap-0.5 text-sm text-fg/60 underline-offset-4 hover:text-fg/80 hover:underline"
    >
      <ChevronLeft size={16} aria-hidden />
      {target.name}
    </Link>
  );
}
