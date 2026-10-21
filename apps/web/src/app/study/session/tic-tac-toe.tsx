"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EMPTY_BOARD, PERSON, PHONE, outcome, phoneMove, place, type Board, type Mark } from "@/lib/study/tic-tac-toe";

/**
 * The display study's interruption: noughts and crosses against the phone,
 * over the whole screen, so the conversation is out of sight and out of mind
 * for a minute. Rounds follow each other until `minMs` has passed, and the
 * one under way then is played out — unless `capMs` comes first, which cuts
 * it off. The same game, once and unhurried, is the practice before the
 * first conversation (`minMs` 0: one round).
 */

export interface GameStats {
  /** Rounds played to the end. */
  rounds: number;
  won: number;
  lost: number;
  drawn: number;
  /** Squares they tapped. */
  moves: number;
  /** The cap ended it mid-round. */
  cutOff: boolean;
}

/** How long the phone takes over its move, so it reads as a turn. */
const PHONE_DELAY_MS = 450;
/** How long a finished round's result stays up before the next round. */
const ROUND_PAUSE_MS = 1_100;

export function TicTacToe({
  eyebrow,
  title,
  note,
  minMs,
  capMs,
  onDone,
}: {
  eyebrow: string;
  title: string;
  note: string;
  minMs: number;
  capMs: number;
  onDone: (stats: GameStats) => void;
}) {
  const [board, setBoard] = useState<Board>(EMPTY_BOARD);
  const [result, setResult] = useState<Mark | "draw" | null>(null);
  const [thinking, setThinking] = useState(false);
  const [score, setScore] = useState({ rounds: 0, won: 0, lost: 0, drawn: 0, moves: 0 });
  const [startedAt] = useState(() => Date.now());
  const [now, setNow] = useState(startedAt);
  const latest = useRef(score);
  const ended = useRef(false);
  const timers = useRef<number[]>([]);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  const finish = useCallback((cutOff: boolean) => {
    if (ended.current) return;
    ended.current = true;
    done.current({ ...latest.current, cutOff });
  }, []);

  // The cap, and a clock for the bar.
  useEffect(() => {
    const cap = window.setTimeout(() => finish(true), capMs);
    const tick = window.setInterval(() => setNow(Date.now()), 250);
    const pending = timers.current;
    return () => {
      window.clearTimeout(cap);
      window.clearInterval(tick);
      for (const t of pending) window.clearTimeout(t);
    };
  }, [capMs, finish]);

  const record = (next: typeof score) => {
    latest.current = next;
    setScore(next);
  };

  function endRound(final: Board, moves: number) {
    const o = outcome(final);
    record({
      rounds: latest.current.rounds + 1,
      won: latest.current.won + (o === PERSON ? 1 : 0),
      lost: latest.current.lost + (o === PHONE ? 1 : 0),
      drawn: latest.current.drawn + (o === "draw" ? 1 : 0),
      moves,
    });
    setResult(o);
    later(() => {
      if (Date.now() - startedAt >= minMs) return finish(false);
      setBoard(EMPTY_BOARD);
      setResult(null);
    }, ROUND_PAUSE_MS);
  }

  function tap(at: number) {
    if (ended.current || result || thinking || board[at] !== null) return;
    const moves = latest.current.moves + 1;
    const mine = place(board, at, PERSON);
    setBoard(mine);
    if (outcome(mine)) return endRound(mine, moves);
    record({ ...latest.current, moves });
    setThinking(true);
    later(() => {
      const reply = phoneMove(mine);
      const theirs = reply === null ? mine : place(mine, reply, PHONE);
      setBoard(theirs);
      setThinking(false);
      if (outcome(theirs)) endRound(theirs, moves);
    }, PHONE_DELAY_MS);
  }

  const share = minMs > 0 ? Math.min(1, (now - startedAt) / minMs) : 0;
  const line =
    result === PERSON ? "You won this one." : result === PHONE ? "The phone won this one." : result === "draw" ? "A draw." : thinking ? "The phone is thinking…" : "Your move: you are ✕.";

  return (
    <main className="no-touch-fuss fixed inset-0 z-50 flex flex-col items-center gap-5 overflow-y-auto bg-canvas px-4 pt-10 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
      <header className="w-full max-w-sm text-center">
        <p className="mb-1 text-xs font-medium tracking-wide text-fg/55 uppercase">{eyebrow}</p>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-sm text-fg/65">{note}</p>
      </header>
      {minMs > 0 && (
        <div className="h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-fg/10" aria-hidden>
          <div className="h-full rounded-full bg-fg/50 transition-[width] duration-200" style={{ width: `${share * 100}%` }} />
        </div>
      )}
      <div className="grid w-full max-w-sm grid-cols-3 gap-2" role="grid" aria-label="Noughts and crosses">
        {board.map((cell, i) => (
          <button
            key={i}
            type="button"
            onClick={() => tap(i)}
            disabled={cell !== null || result !== null || thinking}
            aria-label={cell === PERSON ? "yours" : cell === PHONE ? "the phone's" : `square ${i + 1}, empty`}
            className="grid aspect-square cursor-pointer place-items-center rounded-2xl bg-fg/[0.06] text-5xl font-semibold disabled:cursor-default"
          >
            {cell === PERSON ? "✕" : cell === PHONE ? "◯" : ""}
          </button>
        ))}
      </div>
      <p className="h-6 text-center text-fg/75" aria-live="polite">
        {line}
      </p>
      <p className="font-mono text-sm text-fg/55">
        You {score.won} · Phone {score.lost} · Draws {score.drawn}
      </p>
    </main>
  );
}
