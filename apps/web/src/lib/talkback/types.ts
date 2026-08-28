/**
 * The shape the recorder sees, independent of what is doing the talking.
 *
 * This was an abstraction over two backends being compared head to head. That
 * comparison is over and only Pipecat remains, but the seam is worth keeping:
 * the recorder should not know how the voice path is implemented, and the
 * capture path must stay able to run with talk-back off entirely.
 */
export type TalkbackStatus = "off" | "connecting" | "listening" | "speaking" | "degraded";

/**
 * One side of the live exchange, as it happens.
 *
 * Held in memory only and deliberately so: the durable record is `utterance`
 * and `agent_turn`, written by the capture pipeline and the bot. This is the
 * screen catching up with the conversation, not a second transcript — if it
 * disagreed with the ledger, the ledger is right.
 */
export interface TalkbackTurn {
  id: string;
  role: "you" | "agent";
  text: string;
}

export interface TalkbackState {
  status: TalkbackStatus;
  /** What the agent last said. Kept for the single-line glance view. */
  reply: string | null;
  /**
   * The exchange so far, oldest first, bounded.
   *
   * Bounded because this runs for a whole drive on a phone: an unbounded list
   * would grow without limit in memory and re-render longer every turn, on the
   * same device that is holding a MediaRecorder open.
   */
  turns: TalkbackTurn[];
  error: string | null;
}

/** How much of the exchange is kept on screen. A glance, not a history. */
export const MAX_VISIBLE_TURNS = 8;

export const OFF: TalkbackState = { status: "off", reply: null, turns: [], error: null };

export interface TalkbackOptions {
  captureSessionId: string | null;
  enabled: boolean;
}
