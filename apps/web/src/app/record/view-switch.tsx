"use client";

import { useLocalValue, writeLocalValue } from "@/lib/local-value";

/**
 * Conversation, Mirror or Bubbles: the same drive shown three ways
 * (`ConversationFlow`, and `ConversationMirror` in its two layouts). A choice
 * of this browser, kept across drives, and shared by the recorder and the
 * simulated conversation (`/record/demo`).
 */

const VIEW_KEY = "souffleur.record-view";

export type RecordView = "conversation" | "track" | "bubbles";

const VIEWS: { id: RecordView; label: string }[] = [
  { id: "conversation", label: "Conversation" },
  { id: "track", label: "Mirror" },
  { id: "bubbles", label: "Bubbles" },
];

export function useRecordView(): RecordView {
  const stored = useLocalValue(VIEW_KEY);
  return VIEWS.some((v) => v.id === stored) ? (stored as RecordView) : "conversation";
}

/** One row of equal targets, so switching is one tap during a drive and after it. */
export function ViewSwitch({ view }: { view: RecordView }) {
  return (
    <div
      role="group"
      aria-label="Show the conversation as"
      className="flex shrink-0 rounded-2xl bg-fg/[0.06] p-1"
    >
      {VIEWS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => writeLocalValue(VIEW_KEY, id)}
          className={[
            "min-h-10 flex-1 cursor-pointer rounded-xl text-sm transition-colors",
            view === id ? "bg-surface font-semibold text-fg shadow-sm" : "text-fg/65 hover:text-fg",
          ].join(" ")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
