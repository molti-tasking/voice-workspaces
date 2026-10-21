"use client";

import type { ConversationDisplay } from "@voicemural/shared";
import { useLocalValue, writeLocalValue } from "@/lib/local-value";

/**
 * Conversation, Mirror or Bubbles: the same drive shown three ways
 * (`ConversationFlow`, and `ConversationMirror` in its two layouts). A choice
 * of this browser, kept across drives, and shared by the recorder and the
 * simulated conversation (`/record/demo`), which also offers the display
 * study's plain transcript. A drive whose condition forces a display has no
 * switch at all.
 */

const VIEW_KEY = "souffleur.record-view";

export type RecordView = "conversation" | "track" | "bubbles";

const VIEWS: { id: ConversationDisplay; label: string }[] = [
  { id: "transcript", label: "Transcript" },
  { id: "conversation", label: "Conversation" },
  { id: "track", label: "Mirror" },
  { id: "bubbles", label: "Bubbles" },
];

/**
 * The plain transcript is the display study's control, not one of the
 * recorder's own views: only the simulated conversation offers it.
 */
function viewsFor(withTranscript: boolean) {
  return withTranscript ? VIEWS : VIEWS.filter((v) => v.id !== "transcript");
}

export function useRecordView(): RecordView;
export function useRecordView(options: { withTranscript: true }): ConversationDisplay;
export function useRecordView({ withTranscript = false }: { withTranscript?: boolean } = {}): ConversationDisplay {
  const stored = useLocalValue(VIEW_KEY);
  return viewsFor(withTranscript).some((v) => v.id === stored) ? (stored as ConversationDisplay) : "conversation";
}

/**
 * One row of targets, so switching is one tap during a drive and after it.
 * Equal from `sm` up; narrower, each is as wide as its label, so four fit a
 * phone.
 */
export function ViewSwitch({
  view,
  withTranscript = false,
}: {
  view: ConversationDisplay;
  /** Offer the plain transcript too (the simulated conversation). */
  withTranscript?: boolean;
}) {
  return (
    <div
      role="group"
      aria-label="Show the conversation as"
      className="flex shrink-0 rounded-2xl bg-fg/[0.06] p-1"
    >
      {viewsFor(withTranscript).map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => writeLocalValue(VIEW_KEY, id)}
          className={[
            "min-h-10 flex-auto cursor-pointer rounded-xl px-2 text-sm transition-colors sm:flex-1",
            view === id ? "bg-surface font-semibold text-fg shadow-sm" : "text-fg/65 hover:text-fg",
          ].join(" ")}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
