import type { ConversationDisplay } from "@voicemural/shared";

/**
 * How the session's pages name each view: a short label they rank it by at
 * the end, and one sentence for the brief before the conversation that shows
 * it. The sentences are kept about the same length, so no view is explained
 * better than another — what they learn about each is what they see.
 */
export const DISPLAY_COPY: Record<ConversationDisplay, { label: string; brief: string }> = {
  transcript: {
    label: "Word for word",
    brief: "the conversation word for word, as a running transcript, newest at the bottom.",
  },
  conversation: {
    label: "Topics in order",
    brief: "the conversation in order, under a short headline for each topic, newest last.",
  },
  track: {
    label: "Topic map",
    brief: "the topics as a map, on the side of whoever brought them up, newest at the bottom.",
  },
  bubbles: {
    label: "Topic bubbles",
    brief: "the topics as circles, the ones you brought up in one panel, the assistant's in another.",
  },
};

/** "4 minutes", or "24 seconds" for a sped-up walkthrough. */
export function spokenDuration(ms: number): string {
  if (ms >= 60_000 && ms % 60_000 === 0) {
    const minutes = ms / 60_000;
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  return `${Math.round(ms / 1000)} seconds`;
}

/** The timer at the top of a conversation. */
export function clock(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
