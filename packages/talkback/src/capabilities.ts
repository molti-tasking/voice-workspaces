import type { SparkSelection } from "@voicemural/shared";

/**
 * What the agent can do on THIS drive, in one place (talkback-23).
 *
 * Asked "can you still take notes? What are your capabilities? What can you
 * do for me?" on 20 Oct 2026, it assembled an answer from fragments of the
 * prompt — "draft text, search the web, manage your task board" — and then
 * could not say where its draft was, or why there were no sparks: "I can't".
 * What it can do differs by drive (the board tools, web search, the sparks
 * arm and who picks the sparks' subjects), and nothing told it which applied.
 * This section is built from the same flags that decide those things, so the
 * list is true for the drive it is in.
 *
 * A composed section, before `OUTPUT_CONTRACT`, like `webSearchSection`. The
 * detail of each capability stays in its own section; this is the inventory,
 * so an answer to "what can you do?" is short, specific and never invented.
 */
export interface DriveCapabilities {
  /** The board tools are on: it can add, move, reword and remove tasks. */
  board: boolean;
  /** `search_web` is on. */
  webSearch: boolean;
  /** The drive is in the sparks arm. */
  sparks: boolean;
  /** Who picks the subjects a spark is offered on, frozen for the drive. */
  sparkSelection: SparkSelection;
}

export function capabilitiesSection(drive: DriveCapabilities): string {
  const lines = [
    "- Think things through with them: answer, react, give your view, and stay quiet while they think. They decide when you talk, with Lock, Normal and Poke.",
    "- Recall what they said earlier on this drive, and what you are shown of their earlier drives and where their topics stand.",
    "- Write something down for them to keep — an email, a message, a list, notes, a prompt — as a draft, and rewrite a draft from this drive when they ask. They find it in the conversation on their screen, as a line with its title where you wrote it, and in their workspace; once they stop, also on that recording's own page.",
    drive.board
      ? "- Change their task board: add, move, reword or remove a task."
      : "- You cannot add, move or change their tasks on this drive.",
    drive.webSearch
      ? "- Look things up on the web: anything that changes, such as news, prices, versions or opening hours."
      : "- You cannot look anything up on the web.",
    drive.sparks
      ? `- Sparks: their screen offers short questions about their subjects — say it back in their own words, decide it, what makes them unsure, go back to it — for them to tap, or to ask you for out loud; you ask the one they pull. ${
          drive.sparkSelection === "chosen"
            ? 'On this drive a spark comes only for a subject they keep: by saying "keep this one", or with Keep on its headline.'
            : "On this drive the screen picks the subjects itself, once one has had enough talk."
        } You cannot make one appear. Asked where the sparks are, or why there are none, answer from SPARKS ON OFFER — never just "I can't".`
      : "- This drive has no sparks. Asked for one, say so in a few words.",
    "- You cannot send anything to anyone, set a reminder, or change the app or what it shows: only drafts, and the board where it says so above.",
  ];
  return `WHAT YOU CAN DO ON THIS DRIVE
Asked what you can do, what you are for, or whether you can do something, answer from this list: the two or three things that fit what they are doing, in plain words, then stop. Never answer vaguely, and never claim anything that is not on it.
${lines.join("\n")}`;
}
