"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ESM_EXPIRY_MS,
  esmDue,
  gameDue,
  type EsmSlot,
  type SessionMoment,
  type SessionTimings,
} from "@voicemural/shared";
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
  /** The one-tap prompt on screen now. */
  prompt: { slot: EsmSlot; shownMs: number } | null;
  answerPrompt: (value: number) => void;
  gameDone: (stats: GameStats) => void;
  /** Close what is still open, unanswered, before the conversation ends. */
  flush: () => void;
}

/** How often the conversation is looked at: often enough for "first words" to be on time. */
const TICK_MS = 250;

/**
 * Runs a block's moments against the drive's clock (`clock`: ms since the
 * drive started, null before it is known): the game when it is due, which
 * pauses the agent until it ends; the prompts in quiet moments; and the
 * first words after the game. Each is handed to `record` once, as it closes.
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
  const [prompt, setPrompt] = useState<BlockMoments["prompt"]>(null);

  // What the tick reads: the latest of everything, without restarting it.
  const latest = useRef({ clock, userSpeaking, agentSpeaking, timings, record, pauseAgent });
  useEffect(() => {
    latest.current = { clock, userSpeaking, agentSpeaking, timings, record, pauseAgent };
  });
  const phaseNow = useRef<BlockPhase>("talk");
  const promptNow = useRef<BlockMoments["prompt"]>(null);
  const lastSound = useRef(0);
  const shown = useRef(new Set<number>());
  const lastShown = useRef<number | null>(null);
  const resumedAt = useRef<number | null>(null);
  const gameShown = useRef(0);
  /** No quiet moment came for the first prompt before the game did. */
  const missedBefore = useRef(false);
  const awaitingWords = useRef<number | null>(null);

  const go = useCallback((next: BlockPhase) => {
    phaseNow.current = next;
    setPhase(next);
  }, []);
  const show = useCallback((next: BlockMoments["prompt"]) => {
    promptNow.current = next;
    setPrompt(next);
  }, []);

  /** The prompt on screen, closed unanswered. */
  const expirePrompt = useCallback(
    (why: "expired" | "interrupted" | "ended") => {
      const open = promptNow.current;
      if (!open) return;
      latest.current.record({
        kind: "esm",
        ordinal: open.slot.ordinal,
        item: open.slot.item,
        shownOffsetMs: open.shownMs,
        answeredOffsetMs: null,
        value: null,
        text: null,
        meta: { closed: why },
      });
      show(null);
    },
    [show],
  );

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

      const open = promptNow.current;
      if (open && at - open.shownMs >= ESM_EXPIRY_MS) expirePrompt("expired");

      if (where === "talk" && gameDue({ elapsedMs: at, quietMs: quiet, timings: t })) {
        expirePrompt("interrupted");
        // The prompt before the game is the "before" of a before-and-after:
        // shown after it, it would be neither. Skipped, and said so.
        if (!shown.current.has(0)) {
          shown.current.add(0);
          missedBefore.current = true;
        }
        pause(true);
        gameShown.current = at;
        go("game");
        return;
      }
      if ((where === "talk" || where === "back") && !promptNow.current) {
        const slot = esmDue({
          elapsedMs: at,
          quietMs: quiet,
          busy: false,
          shown: shown.current,
          lastShownMs: lastShown.current,
          resumedAtMs: resumedAt.current,
          timings: t,
        });
        if (slot) {
          shown.current.add(slot.ordinal);
          lastShown.current = at;
          show({ slot, shownMs: at });
        }
      }
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [active, expirePrompt, go, show]);

  const answerPrompt = useCallback(
    (value: number) => {
      const open = promptNow.current;
      const at = latest.current.clock();
      if (!open || at === null) return;
      latest.current.record({
        kind: "esm",
        ordinal: open.slot.ordinal,
        item: open.slot.item,
        shownOffsetMs: open.shownMs,
        answeredOffsetMs: at,
        value,
        text: null,
      });
      show(null);
    },
    [show],
  );

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
        meta: { ...stats, promptBeforeMissed: missedBefore.current },
      });
      // Straight back: the agent listens again and their first words are
      // timed from here.
      latest.current.pauseAgent(false);
      resumedAt.current = at;
      awaitingWords.current = at;
      // The way back is not a quiet stretch to fill with a prompt.
      lastSound.current = at;
      go("back");
    },
    [go],
  );

  const flush = useCallback(() => {
    expirePrompt("ended");
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
  }, [expirePrompt]);

  return { phase, prompt, answerPrompt, gameDone, flush };
}
