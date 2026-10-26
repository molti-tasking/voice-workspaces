"use client";

import type { Talkback, TalkbackOptions } from "./types";
import { usePipecatTalkback } from "./use-pipecat";
import { useRealtimeTalkback } from "./use-realtime";

/**
 * Which engine runs the conversation: `realtime`, a speech-to-speech model
 * the browser talks to through the LiteLLM proxy (`use-realtime.ts`), or
 * `pipecat`, the Python container (`use-pipecat.ts`), kept for rolling back.
 *
 * A build-time flag like `NEXT_PUBLIC_TALKBACK_ENABLED`, so the choice is one
 * constant for the life of the bundle and the hook below never changes which
 * hook it calls between renders.
 */
export const VOICE_ENGINE: "realtime" | "pipecat" =
  process.env.NEXT_PUBLIC_VOICE_ENGINE === "pipecat" ? "pipecat" : "realtime";

/**
 * Talk-back: the one name every screen imports. Same state, same options, same
 * rule that capture must not depend on it, whichever engine is behind it.
 */
export const useTalkback: (options: TalkbackOptions) => Talkback =
  VOICE_ENGINE === "pipecat" ? usePipecatTalkback : useRealtimeTalkback;

export type { PokeResult, Talkback, TalkbackState, TalkbackStatus } from "./types";
