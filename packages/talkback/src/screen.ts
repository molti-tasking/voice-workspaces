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
    "the conversation view: the current subject, short cues, the drafts you have written on this drive, and a link to this drive's transcript. It shows nothing from earlier drives",
  workspace:
    "the workspace: the topics touched in the last two weeks as cards, older ones folded into one closed section below, each with its open questions, tasks, notes and the drafts filed on it. They can archive an item or change a task's state there; nothing is dragged",
  board:
    "the task board: their tasks in the columns open, next, doing, done and dropped. Cards are dragged between columns",
  timeline:
    "the timeline: every recording's transcript, oldest first, with a link from each to that recording's own page",
  session: "the page of one past recording, with its transcript and drafts",
  other: "a page other than the conversation, workspace or board",
};

/**
 * Where things are, whichever screen is open.
 *
 * On 28 Sep 2026, asked "how can I see my last discussion?", the agent said
 * the transcript was in the conversation view — which shows nothing from
 * earlier drives. It knew the current screen and nothing about the others, so
 * it guessed. This is the whole map, in the words of the dock.
 */
export const APP_MAP =
  "WHERE THINGS ARE: the dock at the bottom leads to Workspace (their topics, tasks and filed drafts) and Timeline (every past recording's transcript; each links to that recording's page, with its drafts). The conversation view is the recorder itself. Point them there by those names; there is no other place to look.";

/**
 * The line for the turn context. Always something: "not known" is itself the
 * instruction not to describe a screen.
 */
export function renderScreen(screen: string | null | undefined): string {
  if (!isScreen(screen)) {
    return `WHICH SCREEN: not known. Do not describe what is on their screen or tell them where to tap.\n${APP_MAP}`;
  }
  return `WHICH SCREEN: they have ${DESCRIPTIONS[screen]} open.\n${APP_MAP}`;
}
