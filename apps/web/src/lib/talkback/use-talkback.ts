"use client";

import { usePipecatTalkback } from "./use-pipecat";
import type { TalkbackOptions, TalkbackState } from "./types";

/**
 * Talk-back.
 *
 * A thin pass-through to the Pipecat hook. It used to select between two
 * backends and had to call BOTH hooks unconditionally to keep React's hook
 * order stable across an env change; with LiveKit gone that dance is
 * unnecessary, and the indirection survives only so the recorder keeps
 * importing one stable name.
 */
export function useTalkback(options: TalkbackOptions): TalkbackState {
  return usePipecatTalkback(options);
}

export type { TalkbackState, TalkbackStatus } from "./types";
