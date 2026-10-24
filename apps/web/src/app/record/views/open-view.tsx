"use client";

import { Check } from "lucide-react";
import type { DigestQuestion } from "@voicemural/talkback/digest";

/**
 * Open: the questions the conversation has raised — where, when, how much —
 * the open ones first and large, the settled ones below, ticked and quiet.
 * What is left to decide, at a glance, rather than what was said. A tap zooms
 * into the question's topic.
 */
export function OpenView({
  questions,
  pending,
  onZoom,
}: {
  questions: (DigestQuestion & { title: string | null })[];
  pending: boolean;
  /** Zoom into a topic, by ordinal. */
  onZoom: (ordinal: number) => void;
}) {
  if (questions.length === 0) {
    return (
      <p className="m-auto max-w-xs text-center text-sm text-fg/55">
        {pending ? "…" : "The questions to settle show here as they come up."}
      </p>
    );
  }
  return (
    <div className="ph-no-capture min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <ul className="flex min-h-full flex-col justify-end gap-1 py-3">
        {questions.map((q, i) => {
          const inner = (
            <>
              <span aria-hidden className="mt-1 grid size-5 shrink-0 place-items-center">
                {q.settled ? (
                  <Check size={16} strokeWidth={2.5} className="text-fg/45" />
                ) : (
                  <span className="size-3 rounded-full ring-2 ring-fg/60 ring-inset" />
                )}
              </span>
              <span className="flex min-w-0 flex-col">
                <span
                  className={
                    q.settled ? "text-base text-fg/45 line-through decoration-fg/25" : "text-xl leading-snug font-medium text-fg"
                  }
                >
                  {q.text}
                </span>
                {q.title && <span className="text-xs text-fg/50">{q.title}</span>}
              </span>
              <span className="sr-only">{q.settled ? ", settled" : ", still open"}</span>
            </>
          );
          return (
            <li key={`${i}:${q.text}`}>
              {q.ordinal !== null ? (
                <button
                  type="button"
                  onClick={() => onZoom(q.ordinal!)}
                  className="flex min-h-12 w-full cursor-pointer items-start gap-3 rounded-2xl px-1 py-2 text-left hover:bg-fg/[0.04]"
                >
                  {inner}
                </button>
              ) : (
                <p className="flex min-h-12 items-start gap-3 px-1 py-2">{inner}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
