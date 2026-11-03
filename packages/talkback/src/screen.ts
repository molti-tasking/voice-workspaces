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
  /** They choose what to keep: Keep on each topic. */
  keep?: boolean;
  /**
   * How the conversation is shown, when the drive forces it (a pilot's
   * condition, `study_condition.display`): no switch and no menu then.
   */
  display?: ShownAs;
  /** How it is shown by their own choice, as the screen reported it (3 Nov 2026); absent when not known. */
  view?: ShownAs;
  /** The title of the topic whose sheet is open over the conversation; absent when none is. */
  topic?: string;
}

/** The displays a drive can force (`ConversationDisplay` in @voicemural/shared). */
export type ShownAs = "chat" | "topics" | "uptake" | "now" | "open" | "recent" | "stack";

/** A view as the screen reported it, checked before it is described. */
export function isShownAs(value: unknown): value is ShownAs {
  return typeof value === "string" && Object.hasOwn(SHOWN_AS, value);
}

const NAMED =
  "Topics are named automatically from what is said; you do not name them and cannot move anything between them, but they can rename one, and you then hear it by their name.";

const TOPIC_LINE =
  "the conversation view as a line of topics rather than words: each topic once, one under the other in the order they came up; the one being talked about is larger and one they settled has a check. A tap on a topic opens a few short points about it, written automatically from what was said, not by you, and its lines.";

/** The conversation itself, as each view shows it. */
const SHOWN_AS: Record<ShownAs, string> = {
  chat: `the conversation view as a transcript ("Transcript" on their switch): every line of the conversation in the order it was said — their words in bubbles on the right, yours as text on the left. A draft you write shows in it as a line with its title, where you wrote it; a tap opens its text with a Copy button. ${NAMED}`,
  topics: `${TOPIC_LINE} ${NAMED}`,
  uptake: `${TOPIC_LINE} Each topic also has one small circle per idea you suggested on it: filled once they have taken it up in their own words, hollow until then — judged automatically, not by you. ${NAMED}`,
  now: "the conversation view as one line saying where the conversation is now, under the name of the current topic, written automatically from what was said, not by you.",
  open: "the conversation view as the questions this conversation has raised — where, when, how much — the open ones first and the settled ones ticked, written automatically from what was said, not by you.",
  recent:
    "the conversation view shrunk by age: the last turn in its own words, large, at the bottom, under who said it; the turn before it in two words; the three before that in one word each; and above them the name of the current topic. The short words are written automatically, not by you, and a tap opens the current topic with all of its lines.",
  stack: `the conversation view as a stack of topics ("Stack" on their switch, the view it opens on): the current topic as the largest bubble at the bottom, with what has been decided on it, the turn before as a short line and the words being said now, appearing as they are said; the earlier topics above it, each with what was decided, in places they keep. When the conversation goes back to an earlier topic, its bubble moves down into the large one. The decisions and short lines are written automatically, not by you. Drafts do not show in this view: they are in Transcript, one tap away on the switch, and in Workspace. ${NAMED}`,
};

/** Their view when the screen has not said which: the one it opens on, and that they may have switched. */
const UNKNOWN_VIEW =
  "the conversation view, which opens as a stack of topics with what was decided on each and can be switched to the full transcript or another view; you do not know which one is open now.";

/**
 * The recorder. It once said "two panels … no other icon or button" while the
 * screen also had spark chips and Keep, and "Drafts are not shown here; they
 * are kept on this recording's page", which the agent repeated to somebody
 * looking at this screen as "it's on this recording's page". Since 3 Nov
 * 2026 it is the display study's screen made the everyday one, and the line
 * says which view is open and which topic, as the screen reports them: the
 * same things, in the same words, as they see.
 */
function conversationDescription(drive: ConversationScreen): string {
  const forced = drive.display;
  const view = forced ?? drive.view;
  return [
    view ? SHOWN_AS[view] : UNKNOWN_VIEW,
    forced
      ? "At the top, a slim bar with the recording badge and its clock, and Stop at its right end; on this recording there is no switch and no menu."
      : "At the top, a slim bar: the recording badge and its clock, a switch between Stack and Transcript, a ⋯ menu with the other views (Topics, Uptake, Now, Open, Recent) and the way to Past conversations, Workspace, Board and Timeline, and at its right end Stop, which becomes Record once they stop.",
    "It is one conversation that keeps growing: what they said in earlier recordings is on it above this one, and Record after Stop carries it on.",
    "A tap on a topic opens its sheet over the conversation: what was said on it, your ideas on it marked taken up or not, what their workspace holds on it from every recording (tasks, claims, open questions, facts), and Ask me, which hands you a question about it to ask them back.",
    drive.topic ? `Open now: the sheet of the topic "${drive.topic}".` : null,
    drive.sparks
      ? "Under the conversation is a row of sparks: up to three short questions about their subjects for them to tap, or, when there are none, one line saying why."
      : null,
    drive.keep ? "They can keep a topic they want to hold in their own head: by saying \"keep this one\", or with Keep on a topic they open." : null,
    "That is everything on it: no dock and no other button. Never point them at anything else on this screen",
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
 * WHERE THE WAY OUT IS, EXACTLY (talkback-20). On 14 Oct 2026 the map said
 * "the dock at the bottom" while the conversation view's own line said it had
 * none, and the agent resolved the contradiction by inventing: Workspace "in
 * the menu at the top right", then "the icon next to the stop button", told
 * four times running that neither existed. Since 2 Nov 2026 there IS a menu
 * at the top right of the conversation view, during a recording too, so the
 * map says so; a recording whose view is forced has none, and the map then
 * says the places open once they stop (`appMap(false)`).
 *
 * On 28 Sep 2026, asked "how can I see my last discussion?", the agent said
 * the transcript was in the conversation view — which then showed nothing
 * from earlier drives. It knew the current screen and nothing about the
 * others, so it guessed. This is the whole map, in the words of the menu.
 *
 * Past conversations replaced Timeline as the place to send someone looking
 * for a past drive (7 Oct 2026: "the tool does not allow me to view my past
 * transcripts easily"): drives have names and can be searched. Timeline
 * stays, in the menu, for reading everything end to end.
 */
function appMap(menu: boolean): string {
  return [
    "WHERE THINGS ARE: Workspace (their topics, tasks and filed drafts) and Past conversations (every past recording, newest first, named by what it was about, with a search over everything they said; each opens that recording's page, with its transcript and drafts).",
    "A draft from the drive running now is a line in the conversation view's Transcript, where it was written, and on its topic in Workspace; once they stop, it is also on that recording's page. Timeline reads every transcript end to end.",
    menu
      ? "On the conversation view the ⋯ menu at the top right leads to them, during a recording too; on the other pages, the menu at the top, and the record button at the bottom leads back to the conversation."
      : "On this recording the conversation view has no menu: those places open once they stop it, from the ⋯ menu at its top right.",
    "Point them there by those names; there is no other place to look.",
  ].join(" ");
}

export const APP_MAP = appMap(true);

/**
 * The display study's conversation page (`/study/session`), as one line —
 * THE SAME FOR EVERY VIEW the session compares. The agent is the constant
 * there and must not learn which view they have (`SESSION_SYSTEM_PROMPT`),
 * so nothing here names one. No app map either: the page leads nowhere.
 */
export const STUDY_SCREEN =
  "WHICH SCREEN: the study's conversation page on their phone. Do not describe what is on it, refer to it, or tell them where to look or tap.";

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
  const map = screen === "conversation" && drive.display ? appMap(false) : APP_MAP;
  return `WHICH SCREEN: they have ${description} open.\n${map}`;
}
