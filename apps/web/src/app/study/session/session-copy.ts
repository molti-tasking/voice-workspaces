import type { SessionDisplay } from "@voicemural/shared";

/**
 * How the brief before the conversation describes its view, in one sentence.
 * The sentences are kept about the same length, so no view is explained
 * better than another — what they learn about each is what they see.
 */
export const DISPLAY_COPY: Record<SessionDisplay, { brief: string }> = {
  transcript: {
    brief: "the conversation word for word, as a running transcript, newest at the bottom.",
  },
  track: {
    brief: "the topics as a map, on the side of whoever brought them up, newest at the bottom.",
  },
  bubbles: {
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
