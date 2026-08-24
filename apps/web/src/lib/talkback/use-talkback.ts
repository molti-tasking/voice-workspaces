"use client";

import { useLiveKitTalkback } from "./use-livekit";
import { usePipecatTalkback } from "./use-pipecat";
import { configuredBackend, type TalkbackOptions, type TalkbackState } from "./types";

/**
 * Talk-back, on whichever backend is configured.
 *
 * BOTH HOOKS ARE ALWAYS CALLED, and only one is enabled. React forbids calling
 * hooks conditionally, and the alternative — branching on the backend — would
 * change the hook order the moment the env var changed. The disabled one
 * returns immediately without connecting, so the cost is nothing.
 *
 * Switch with NEXT_PUBLIC_TALKBACK_BACKEND=livekit|pipecat. Neither is the
 * "real" one: they exist side by side to be compared on the same voice, the
 * same models and the same prompt, and the loser gets deleted.
 */
export function useTalkback(options: TalkbackOptions): TalkbackState {
  const backend = configuredBackend();

  const livekit = useLiveKitTalkback({
    ...options,
    enabled: options.enabled && backend === "livekit",
  });
  const pipecat = usePipecatTalkback({
    ...options,
    enabled: options.enabled && backend === "pipecat",
  });

  return backend === "pipecat" ? pipecat : livekit;
}

export type { TalkbackState, TalkbackStatus } from "./types";
export { configuredBackend } from "./types";
