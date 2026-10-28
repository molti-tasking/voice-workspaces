import type { SessionDisplay } from "@voicemural/shared";

/**
 * How the brief before the conversation describes its view, in one sentence.
 * The sentences are kept about the same length, so no view is explained
 * better than another — what they learn about each is what they see. Every
 * view has one, so a setup can compare any of them (`SESSION_VIEWS`).
 */
export const DISPLAY_COPY: Record<SessionDisplay, { brief: string }> = {
  chat: {
    brief: "the conversation word for word, like a chat, newest at the bottom.",
  },
  topics: {
    brief: "only the topics, one under another, newest at the bottom; tap one for more.",
  },
  uptake: {
    brief: "only the topics, each with the assistant's ideas marked as taken up by you or not yet.",
  },
  now: {
    brief: "one line on where the conversation is now, under the topic it is on.",
  },
  open: {
    brief: "the questions the conversation raises, the open ones first; tap one for more.",
  },
  recent: {
    brief: "the last thing said in full, with what came before it shrunk to a word or two.",
  },
  stack: {
    brief: "the topics as a stack, the current one largest, each with what was decided on it.",
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
