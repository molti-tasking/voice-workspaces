"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { canShowSurvey } from "@/lib/analytics/surveys";
import { isStudyRoute } from "@/lib/study/routes";
import { useCapture } from "./capture-provider";

/**
 * "A few questions about a past drive", on any screen that is not recording,
 * when a recall probe is due (`/recall`).
 *
 * The survey card's rules (`canShowSurvey`): never during a drive, never on
 * `/record`, never in a hidden tab or offline. No push and no badge; a tap
 * away hides it for the rest of the visit. Asks the server at most every few
 * minutes, after mount, so the layout stays static.
 */

const DISMISSED_KEY = "voicemural.recall-dismissed";
const CHECKED_KEY = "voicemural.recall-checked";
const CHECK_EVERY_MS = 10 * 60 * 1000;

function readSession(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key: string, value: string): void {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // A private window: the card just comes back next time.
  }
}

export function RecallCard() {
  const { isRecording } = useCapture();
  const pathname = usePathname();
  const [due, setDue] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!canShowSurvey({ isRecording, pathname }) || pathname.startsWith("/recall")) return;
    if (readSession(DISMISSED_KEY)) return;
    const last = Number(readSession(CHECKED_KEY) ?? 0);
    if (Date.now() - last < CHECK_EVERY_MS) return;
    writeSession(CHECKED_KEY, String(Date.now()));
    let current = true;
    fetch("/api/recall/due", { cache: "no-store" })
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { due?: number } | null) => {
        if (current && typeof body?.due === "number") setDue(body.due);
      })
      .catch(() => undefined);
    return () => {
      current = false;
    };
  }, [isRecording, pathname]);

  if (due === 0 || dismissed || isRecording) return null;
  if (pathname.startsWith("/record") || pathname.startsWith("/recall") || isStudyRoute(pathname)) return null;

  function dismiss() {
    writeSession(DISMISSED_KEY, "1");
    setDismissed(true);
  }

  return (
    // Below the dock in the stack, like the survey card: it must never cover
    // the record button.
    <div className="fixed right-4 bottom-36 z-30 w-[min(22rem,calc(100vw-2rem))]">
      <div className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4 shadow-2xl shadow-black/40">
        <Link href="/recall" onClick={dismiss} className="min-w-0 flex-1">
          <p className="text-sm font-medium">A few questions about a past drive</p>
          <p className="mt-0.5 text-xs text-fg/60">
            {due === 1 ? "One subject" : `${due} subjects`} to look back on. About a minute each.
          </p>
        </Link>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 text-fg/50 hover:text-fg/70"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
