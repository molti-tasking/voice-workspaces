"use client";

import { useState, useTransition } from "react";

/**
 * The one place a human corrects the content/direction split.
 *
 * It writes `kindOverride`, so the classifier's original answer survives beside
 * it and its error rate stays measurable — the ledger is not edited, it is
 * annotated.
 *
 * Deliberately quiet: invisible until the line is hovered or the control is
 * focused. A transcript of a whole recording would otherwise carry a button on
 * every line, and this is a page for reading.
 */
export function KindToggle({
  utteranceId,
  kind,
}: {
  utteranceId: string;
  kind: "content" | "directive" | "unclassified";
}) {
  const [current, setCurrent] = useState(kind);
  const [pending, startTransition] = useTransition();

  const target = current === "directive" ? "content" : "directive";

  const correct = () => {
    startTransition(async () => {
      const previous = current;
      setCurrent(target);
      try {
        const res = await fetch(`/api/utterances/${utteranceId}/kind`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: target }),
        });
        if (!res.ok) setCurrent(previous);
      } catch {
        setCurrent(previous);
      }
    });
  };

  return (
    <button
      type="button"
      onClick={correct}
      disabled={pending}
      title={
        current === "directive"
          ? "Not a direction — this was just thinking"
          : "This was a direction, addressed to the system"
      }
      className="rounded px-1.5 py-0.5 text-[10px] text-white/0 transition-colors group-hover:text-white/30 hover:!text-white/70 focus-visible:text-white/70 disabled:opacity-40"
    >
      {current === "directive" ? "not a direction" : "mark as direction"}
    </button>
  );
}
