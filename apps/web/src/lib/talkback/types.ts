/**
 * The shape the recorder sees, independent of what is doing the talking.
 *
 * This was an abstraction over two backends being compared head to head. That
 * comparison is over and only Pipecat remains, but the seam is worth keeping:
 * the recorder should not know how the voice path is implemented, and the
 * capture path must stay able to run with talk-back off entirely.
 */
export type TalkbackStatus = "off" | "connecting" | "listening" | "speaking" | "degraded";

export interface TalkbackState {
  status: TalkbackStatus;
  /**
   * What the conversation is about right now, in two to four words.
   *
   * Held in memory only, and not produced here: the voice container names it
   * off the live STT stream and pushes it over the data channel that is
   * already open (see `TopicTitle` in apps/pipecat/bot.py). The browser only
   * ever receives it, so a reload during a drive starts blank again and the
   * next push refills it — the durable record is `utterance`, as always.
   *
   * Null until the container has heard enough to name anything, which is also
   * what the board shows before the first title: empty tiles.
   */
  title: string | null;
  /**
   * Whether the agent can reach anything the driver has said before.
   *
   * Separate from `status` because it is orthogonal: talk-back can be perfectly
   * connected and holding a fluent conversation while knowing nothing about the
   * person it is talking to. That happens when the context ticket cannot be
   * minted — an expired session cookie, or BETTER_AUTH_SECRET unset — and the
   * bot then falls back to a prompt that admits it has no memory.
   *
   * It is surfaced because failing open SILENTLY is how a whole drive gets
   * recorded against an amnesiac agent, and the transcript afterwards gives no
   * hint why the answers were thin.
   */
  memory: "ready" | "unavailable";
  error: string | null;
}

export const OFF: TalkbackState = {
  status: "off",
  title: null,
  memory: "ready",
  error: null,
};

export interface TalkbackOptions {
  captureSessionId: string | null;
  enabled: boolean;
}
