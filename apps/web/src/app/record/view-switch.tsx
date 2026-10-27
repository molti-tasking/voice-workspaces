"use client";

import { CONVERSATION_DISPLAYS, normalizeDisplay, type ConversationDisplay } from "@voicemural/shared";
import { useLocalValue, writeLocalValue } from "@/lib/local-value";

/**
 * Which way the conversation is shown (`ConversationView`): a choice of this
 * browser, kept across conversations, and the same switch on the recorder,
 * on a past conversation's page and in the simulated conversation. A drive
 * whose condition forces a view has no switch at all.
 */

const VIEW_KEY = "souffleur.record-view";

const LABELS: Record<ConversationDisplay, string> = {
  chat: "Chat",
  topics: "Topics",
  uptake: "Uptake",
  now: "Now",
  open: "Open",
  recent: "Recent",
};

export function useRecordView(): ConversationDisplay {
  // A view remembered from before the views were renamed reads as its successor.
  const stored = normalizeDisplay(useLocalValue(VIEW_KEY));
  return (CONVERSATION_DISPLAYS as readonly unknown[]).includes(stored) ? (stored as ConversationDisplay) : "chat";
}

/** One row of targets, so switching is one tap during a drive and after it. Six still fit a phone. */
export function ViewSwitch({ view }: { view: ConversationDisplay }) {
  return (
    <div role="group" aria-label="Show the conversation as" className="flex shrink-0 rounded-2xl bg-fg/[0.06] p-1">
      {CONVERSATION_DISPLAYS.map((id) => (
        <button
          key={id}
          type="button"
          aria-pressed={view === id}
          onClick={() => writeLocalValue(VIEW_KEY, id)}
          className={[
            "min-h-10 flex-1 cursor-pointer rounded-xl px-1 text-sm transition-colors",
            view === id ? "bg-surface font-semibold text-fg shadow-sm" : "text-fg/65 hover:text-fg",
          ].join(" ")}
        >
          {LABELS[id]}
        </button>
      ))}
    </div>
  );
}
