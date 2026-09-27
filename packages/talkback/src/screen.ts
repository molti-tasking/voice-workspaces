/**
 * Which screen the person has open, as one line of turn context.
 *
 * The agent had no idea what the person was looking at, and said so with
 * confidence: it praised "the board view" while the pilot was on the
 * workspace, told her to drag cards there (not possible) and said a list was
 * "on your screen as a draft" when it was not. The recorder now reports each
 * navigation during a drive (`capture_screen`), and this renders the latest
 * one — with what that screen can actually do, because the failure was
 * instructions, not just names.
 *
 * Pure, and free of @voicemural/db, so the web client can share `SCREENS`.
 */

export const SCREENS = ["conversation", "workspace", "board", "timeline", "session", "other"] as const;
export type Screen = (typeof SCREENS)[number];

export function isScreen(value: unknown): value is Screen {
  return typeof value === "string" && (SCREENS as readonly string[]).includes(value);
}

/** A pathname as the coarse screen name that is stored and shown to the model. */
export function screenFor(pathname: string): Screen {
  if (pathname.startsWith("/record")) return "conversation";
  if (pathname.startsWith("/workspace")) return "workspace";
  if (pathname.startsWith("/board")) return "board";
  if (pathname.startsWith("/timeline")) return "timeline";
  if (pathname.startsWith("/sessions/")) return "session";
  return "other";
}

const DESCRIPTIONS: Record<Screen, string> = {
  conversation:
    "the conversation view: the current subject, short cues, and the drafts you have written on this drive",
  workspace:
    "the workspace: their topics as cards, each with its open questions, tasks, notes and the drafts filed on it. They can archive an item or change a task's state there; nothing is dragged",
  board:
    "the task board: their tasks in the columns open, next, doing, done and dropped. Cards are dragged between columns",
  timeline: "the timeline: a list of their past recordings",
  session: "the page of one past recording, with its transcript and drafts",
  other: "a page other than the conversation, workspace or board",
};

/**
 * The line for the turn context. Always something: "not known" is itself the
 * instruction not to describe a screen.
 */
export function renderScreen(screen: string | null | undefined): string {
  if (!isScreen(screen)) {
    return "WHICH SCREEN: not known. Do not describe what is on their screen or tell them where to tap.";
  }
  return `WHICH SCREEN: they have ${DESCRIPTIONS[screen]} open.`;
}
