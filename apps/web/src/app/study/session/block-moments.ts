"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { gameDue, type SessionMoment, type SessionTimings } from "@voicemural/shared";
import type { GameStats } from "./tic-tac-toe";

/**
 * Where a block's conversation is: talking; the game; and back in it, from
 * the moment the game ends. Each step happens once, in that order. Nothing
 * comes between the game and the conversation — no question about where
 * they were, no screen that tells them to carry on — because how they pick
 * it up unaided is what the resumption measures.
 */
export type BlockPhase = "talk" | "game" | "back";

export interface BlockMoments {
  phase: BlockPhase;
  gameDone: (stats: GameStats) => void;
  /** Close what is still open, unanswered, before the conversation ends. */
  flush: () => void;
}

/** How often the conversation is looked at: often enough for "first words" to be on time. */
const TICK_MS = 250;

/**
 * Runs a block's moments against the drive's clock (`clock`: ms since the
 * drive started, null before it is known): the game when it is due, which
 * pauses the agent until it ends, and the first words after the game. Each
 * is handed to `record` once, as it closes.
 *
 * No one-tap prompts during the conversation since session-3 (29 Oct 2026):
 * they interrupted it as much as the game did, and the questions after it
 * ask the same. Session-2's are still in its moments (`kind: "esm"`).
 *
 * Quiet is both sides at once: `userSpeaking` and `agentSpeaking` both off,
 * timed from the last moment either was on.
 */
export function useBlockMoments({
  active,
  clock,
  userSpeaking,
  agentSpeaking,
  timings,
  record,
  pauseAgent,
}: {
  /** The conversation is running: nothing is due before or after it. */
  active: boolean;
  clock: () => number | null;
  userSpeaking: boolean;
  agentSpeaking: boolean;
  timings: SessionTimings;
  record: (moment: SessionMoment) => void;
  pauseAgent: (paused: boolean) => void;
}): BlockMoments {
  const [phase, setPhase] = useState<BlockPhase>("talk");

  // What the tick reads: the latest of everything, without restarting it.
  const latest = useRef({ clock, userSpeaking, agentSpeaking, timings, record, pauseAgent });
  useEffect(() => {
    latest.current = { clock, userSpeaking, agentSpeaking, timings, record, pauseAgent };
  });
  const phaseNow = useRef<BlockPhase>("talk");
  const lastSound = useRef(0);
  const gameShown = useRef(0);
  const awaitingWords = useRef<number | null>(null);

  const go = useCallback((next: BlockPhase) => {
    phaseNow.current = next;
    setPhase(next);
  }, []);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      const { clock: now, userSpeaking: user, agentSpeaking: agent, timings: t, record: keep, pauseAgent: pause } =
        latest.current;
      const at = now();
      if (at === null) return;
      if (user || agent) lastSound.current = at;
      const quiet = at - lastSound.current;
      const where = phaseNow.current;

      // Their first words after the way back: the resumption.
      if (where === "back" && awaitingWords.current !== null && user) {
        keep({
          kind: "resume",
          ordinal: 0,
          item: "first_speech",
          shownOffsetMs: awaitingWords.current,
          answeredOffsetMs: at,
          value: null,
          text: null,
        });
        awaitingWords.current = null;
      }

      if (where === "talk" && gameDue({ elapsedMs: at, quietMs: quiet, timings: t })) {
        pause(true);
        gameShown.current = at;
        go("game");
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [active, go]);

  const gameDone = useCallback(
    (stats: GameStats) => {
      const at = latest.current.clock() ?? gameShown.current;
      latest.current.record({
        kind: "game",
        ordinal: 0,
        item: "tic_tac_toe",
        shownOffsetMs: gameShown.current,
        answeredOffsetMs: at,
        value: null,
        text: null,
        meta: { ...stats },
      });
      // Straight back: the agent listens again and their first words are
      // timed from here.
      latest.current.pauseAgent(false);
      awaitingWords.current = at;
      go("back");
    },
    [go],
  );

  const flush = useCallback(() => {
    if (awaitingWords.current !== null) {
      latest.current.record({
        kind: "resume",
        ordinal: 0,
        item: "first_speech",
        shownOffsetMs: awaitingWords.current,
        answeredOffsetMs: null,
        value: null,
        text: null,
      });
      awaitingWords.current = null;
    }
  }, []);

  return { phase, gameDone, flush };
}
