"use client";

import { Check, ClipboardCopy } from "lucide-react";
import { useState } from "react";

/**
 * Copy this conversation as plain text for debugging: settings, topics, both
 * transcripts and the agent's turns (`/api/capture-sessions/[id]/debug`).
 *
 * The clipboard is handed a promise of the text rather than the text after
 * the fetch, so the write still counts as part of the tap in Safari, which
 * refuses a clipboard write once the tap's moment has passed. When the
 * clipboard refuses anyway, the link beside it opens the same text.
 */
export function CopyDebug({ captureSessionId }: { captureSessionId: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const url = `/api/capture-sessions/${captureSessionId}/debug`;

  const copy = async () => {
    const text = fetch(url, { cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.text();
    });
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/plain": text.then((t) => new Blob([t], { type: "text/plain" })) }),
        ]);
      } else {
        await navigator.clipboard.writeText(await text);
      }
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2_500);
  };

  return (
    <span className="inline-flex items-center gap-3 text-xs text-fg/60">
      <button
        type="button"
        onClick={() => void copy()}
        className="inline-flex items-center gap-1.5 rounded border border-[var(--color-line)] px-2.5 py-1 hover:border-fg/30 hover:text-fg/90"
      >
        {state === "copied" ? <Check size={13} aria-hidden /> : <ClipboardCopy size={13} aria-hidden />}
        {state === "copied" ? "Copied" : state === "failed" ? "Could not copy" : "Copy for debugging"}
      </button>
      <a href={url} target="_blank" rel="noreferrer" className="underline-offset-2 hover:underline">
        as text
      </a>
    </span>
  );
}
