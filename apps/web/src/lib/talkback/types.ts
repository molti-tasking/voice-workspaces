/**
 * The shape both backends present, so the recorder does not know which is live.
 *
 * LiveKit and Pipecat are being compared head to head, and a comparison is only
 * fair if the surrounding code is identical — a difference in how the UI drives
 * one of them would show up as a difference in how it feels.
 */
export type TalkbackStatus = "off" | "connecting" | "listening" | "speaking" | "degraded";

export interface TalkbackState {
  status: TalkbackStatus;
  /** What the agent is saying, as transcribed by whichever backend is running. */
  reply: string | null;
  error: string | null;
}

export const OFF: TalkbackState = { status: "off", reply: null, error: null };

export interface TalkbackOptions {
  captureSessionId: string | null;
  enabled: boolean;
}

/** Which implementation to run. Switched by env so neither is privileged. */
export type TalkbackBackend = "livekit" | "pipecat";

export function configuredBackend(): TalkbackBackend {
  return process.env.NEXT_PUBLIC_TALKBACK_BACKEND === "pipecat" ? "pipecat" : "livekit";
}
