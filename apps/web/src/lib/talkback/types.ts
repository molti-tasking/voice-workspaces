import type { Floor } from "@/lib/recorder/floor-store";
import type { ConversationMessage } from "./conversation";
import type { SparkKind } from "./signals";

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
   * Who may talk, as the CONTAINER last confirmed it: "locked" or "open".
   * Null until it has answered — before the connection is up, or from an older
   * container that does not know the request.
   *
   * Kept apart from the person's choice (`useFloorPreference`) because the
   * two can differ for a moment, and the toggle on the recorder says so: a
   * lock that has been tapped and not yet applied is not a lock the agent is
   * under.
   */
  floor: Floor | null;
  /**
   * The container's VAD hears them right now. With `status === "speaking"` for
   * the agent, this is what lights the panel of whoever is talking. A few
   * changes a turn, so it can live here without the cost the turns would have.
   */
  userSpeaking: boolean;
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
  floor: null,
  userSpeaking: false,
  memory: "ready",
  error: null,
};

export interface TalkbackOptions {
  captureSessionId: string | null;
  enabled: boolean;
  /** The floor the person chose. Sent with the offer, and again on every change. */
  floor: Floor;
  /** Where the turns and titles the container pushes go. */
  onMessage: (message: ConversationMessage) => void;
  /** The sections the screen already has, for a reconnect. See `titlesForReconnect`. */
  titles: () => { title: string; ordinal?: number }[];
}

/** A spark the person pulled: which question, about which subject. Never its title. */
export interface SparkRequest {
  kind: SparkKind;
  ordinal: number;
  /** Its own question, when one was written: the agent asks that one. */
  question?: string;
}

/** What became of a tap on Poke, as the container answered it. */
export type PokeResult = "fired" | "armed" | "running" | "speaking" | "ended";

export interface Talkback {
  state: TalkbackState;
  /**
   * Ask the agent for one turn now — carrying a spark, when they pulled one.
   * Null when it could not be asked.
   */
  poke: (spark?: SparkRequest) => Promise<PokeResult | null>;
  /**
   * Tell the agent which sparks are on offer, so one can be asked for out
   * loud. Kept and re-sent on every connect; the latest list wins.
   */
  offerSparks: (sparks: readonly SparkRequest[]) => void;
  /**
   * Tell the agent they renamed a subject, so it and the titler use their
   * name from now on. Fire and forget: a reconnect hands the new name over
   * with the rest of the titles anyway.
   */
  renameSubject: (ordinal: number, title: string) => void;
}
