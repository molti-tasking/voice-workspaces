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

export const SCREENS = [
  "conversation",
  "workspace",
  "board",
  "timeline",
  "conversations",
  "session",
  "other",
] as const;
export type Screen = (typeof SCREENS)[number];

export function isScreen(value: unknown): value is Screen {
  return typeof value === "string" && (SCREENS as readonly string[]).includes(value);
}

/** A pathname as the coarse screen name that is stored and shown to the model. */
export function screenFor(pathname: string): Screen {
  if (pathname.startsWith("/record")) return "conversation";
  // The Prolific study's conversation page is a conversation too: one column,
  // the current topic only, and no draft lines (it is parked; see PROLIFIC.md).
  if (pathname === "/p" || pathname.startsWith("/p/")) return "conversation";
  if (pathname.startsWith("/workspace")) return "workspace";
  if (pathname.startsWith("/board")) return "board";
  if (pathname.startsWith("/timeline")) return "timeline";
  if (pathname.startsWith("/conversations")) return "conversations";
  if (pathname.startsWith("/sessions/")) return "session";
  return "other";
}

/**
 * What this drive's conversation view has on it beyond the conversation and
 * the floor controls. The context route knows the drive's study condition.
 */
export interface ConversationScreen {
  /** The sparks arm: a row of sparks above the controls. */
  sparks?: boolean;
  /** They choose what to keep: Keep on each headline. */
  keep?: boolean;
  /**
   * How the conversation is shown, when the drive forces it (the display
   * study, `study_condition.display`). Absent: the person's own choice, which
   * is described as the column in order, the view a drive opens on.
   */
  display?: ShownAs;
}

/** The displays a drive can force (`ConversationDisplay` in @voicemural/shared). */
export type ShownAs = "transcript" | "conversation" | "track" | "bubbles";

/**
 * The conversation itself, as each display shows it. `conversation` is the
 * recorder's own column (talkback-23); the others are the display study's.
 */
const SHOWN_AS: Record<ShownAs, string> = {
  conversation:
    "the conversation view: this drive's conversation as one column, in the order it was said — their words on the right, yours on the left — under headlines naming each stretch of it, named automatically from what is said; you do not name them and cannot move anything between them, but they can rename one with the pencil beside it, and you then hear it by their name. Going back to an earlier subject starts a new headline at the bottom, \"Back to\" it, and earlier stretches fold to their headline and open with a tap. A draft you write shows in it as a line with its title, where you wrote it; a tap opens its text with a Copy button.",
  transcript:
    "the conversation view as a plain transcript: every line of this drive in the order it was said — their words in bubbles on the right, yours as text on the left — and nothing else: no headlines, no topics, no sparks.",
  track:
    "the conversation view as a map of topics rather than words: each topic once, on the side of whoever's words it mostly is — theirs on the left, yours on the right — in the order the topics came up, along one line. The topic being talked about is drawn larger, one left a while ago is faded, and a dot on a topic marks a spark on offer. Under it, a strip shows a few short points for one topic — the current one, or one they tapped — written automatically from what was said, not by you, with that topic's spark to tap when it has one.",
  bubbles:
    "the conversation view as a map of topics rather than words: their topics as circles in one panel and yours in another, each in the next free place; the topic being talked about is drawn larger, one left a while ago is faded, and a dot on a topic marks a spark on offer. Under them, a strip shows a few short points for one topic — the current one, or one they tapped — written automatically from what was said, not by you, with that topic's spark to tap when it has one.",
};

/**
 * The recorder while it records (talkback-23): one column in time order, not
 * the two panels it was. It said "two panels … no other icon or button" while
 * the screen also had spark chips and Keep, and "Drafts are not shown here;
 * they are kept on this recording's page", which the agent repeated to
 * somebody looking at this screen as "it's on this recording's page".
 */
function conversationDescription(drive: ConversationScreen): string {
  const shown = drive.display ?? "conversation";
  return [
    SHOWN_AS[shown],
    // In the mirror's layouts a spark is a dot and the strip, said above; the
    // transcript has none.
    drive.sparks && shown === "conversation"
      ? "Above the controls is a row of sparks: up to three short questions about their subjects for them to tap, or, when there are none, one line saying why."
      : null,
    drive.keep && shown === "conversation"
      ? "Each headline has Keep, for a subject they want to hold in their own head."
      : null,
    "Three controls at the bottom: Lock (only they speak, and you are not asked to reply), Normal (you may talk back) and Poke (they want one turn from you now), and Stop at the top right. That is everything on it while it records: no dock, no menu, no other icon or button, and nothing that leads to another screen. It shows nothing from earlier drives",
  ]
    .filter(Boolean)
    .join(" ");
}

const DESCRIPTIONS: Record<Exclude<Screen, "conversation">, string> = {
  workspace:
    "the workspace: the topics touched in the last two weeks as cards, older ones folded into one closed section below, each with its open questions, tasks, notes and the drafts filed on it. It redraws by itself within seconds when a tool changes something. They can archive an item or change a task's state there; nothing is dragged",
  board:
    "the task board: their tasks in the columns open, next, doing, done and dropped. Cards are dragged between columns",
  timeline:
    "the timeline: every recording's transcript, oldest first, with a link from each to that recording's own page",
  conversations:
    "the conversations list: every recording, newest first, each named by what it was about, with a search box that finds what was said and opens the recording at that line",
  session: "the page of one past recording, with its transcript and drafts",
  other: "a page other than the conversation, workspace or board",
};

/**
 * Where things are, whichever screen is open.
 *
 * NOT FROM THE CONVERSATION VIEW, while it records (talkback-20). That screen
 * lost its dock, so this map said "the dock at the bottom" while the screen's
 * own line said there was no dock — and on 14 Oct 2026 the agent resolved the
 * contradiction by inventing: Workspace "in the menu at the top right", then
 * "the icon next to the stop button", told four times running that neither
 * exists. So the map now says where the way out is, and the conversation view
 * says it has none.
 *
 * On 28 Sep 2026, asked "how can I see my last discussion?", the agent said
 * the transcript was in the conversation view — which shows nothing from
 * earlier drives. It knew the current screen and nothing about the others, so
 * it guessed. This is the whole map, in the words of the dock.
 *
 * Conversations replaced Timeline as the place to send someone looking for a
 * past drive (7 Oct 2026: "the tool does not allow me to view my past
 * transcripts easily"): drives now have names and can be searched. Timeline
 * stays, in the menu, for reading everything end to end.
 */
export const APP_MAP =
  "WHERE THINGS ARE: Workspace (their topics, tasks and filed drafts) and Conversations (every past recording, newest first, named by what it was about, with a search over everything they said; each opens that recording's page, with its transcript and drafts). A draft from the drive running now is a line in the conversation view, where it was written, and on its topic in Workspace; once they stop, it is also on that recording's page. Timeline reads every transcript end to end. On every other screen the dock at the bottom leads to Workspace and Conversations, and on a wide screen Conversations and Timeline are in the menu at the top right. The conversation view is the recorder itself, and while it records it has no dock and no menu: those places open once they stop the recording. From the conversation view, say exactly that and never point them at a button there. Point them there by those names; there is no other place to look.";

/**
 * The line for the turn context. Always something: "not known" is itself the
 * instruction not to describe a screen. `drive` says what the conversation
 * view has on it on this drive; other screens are the same for every drive.
 */
export function renderScreen(
  screen: string | null | undefined,
  drive: ConversationScreen = {},
): string {
  if (!isScreen(screen)) {
    return `WHICH SCREEN: not known. Do not describe what is on their screen or tell them where to tap.\n${APP_MAP}`;
  }
  const description = screen === "conversation" ? conversationDescription(drive) : DESCRIPTIONS[screen];
  return `WHICH SCREEN: they have ${description} open.\n${APP_MAP}`;
}
