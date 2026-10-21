/**
 * Noughts and crosses against the phone: the display study's interruption
 * (`tic-tac-toe.tsx`). Something that takes the eyes and a little thought
 * for a minute, so the conversation has to be picked up again afterwards —
 * not a test of skill, so the opponent is fair rather than perfect.
 *
 * Pure, for the tests.
 */

export type Mark = "X" | "O";
export type Cell = Mark | null;
export type Board = readonly Cell[];

/** They play X and always start; the phone plays O. */
export const PERSON: Mark = "X";
export const PHONE: Mark = "O";

export const EMPTY_BOARD: Board = Array.from({ length: 9 }, () => null);

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const;

const CORNERS = [0, 2, 6, 8] as const;

/**
 * How often the phone plays a random square instead of its best one: often
 * enough that a person can win, rarely enough that it still has to be watched.
 */
export const SLIP = 0.25;

/** Who has won, "draw" on a full board with no line, or null while it goes on. */
export function outcome(board: Board): Mark | "draw" | null {
  for (const [a, b, c] of LINES) {
    const mark = board[a];
    if (mark && mark === board[b] && mark === board[c]) return mark;
  }
  return board.every((cell) => cell !== null) ? "draw" : null;
}

/** The board with `mark` on square `at`; unchanged if that square is taken. */
export function place(board: Board, at: number, mark: Mark): Board {
  if (board[at] !== null) return board;
  return board.map((cell, i) => (i === at ? mark : cell));
}

function free(board: Board): number[] {
  return board.flatMap((cell, i) => (cell === null ? [i] : []));
}

/** A square that completes a line of `mark`'s, if there is one. */
function completing(board: Board, mark: Mark): number | null {
  for (const line of LINES) {
    const cells = line.map((i) => board[i]);
    if (cells.filter((c) => c === mark).length === 2) {
      const gap = line.find((i) => board[i] === null);
      if (gap !== undefined) return gap;
    }
  }
  return null;
}

function pick(squares: readonly number[], random: () => number): number {
  return squares[Math.min(squares.length - 1, Math.floor(random() * squares.length))]!;
}

/**
 * The phone's move: now and then any free square (`SLIP`); otherwise win if
 * it can, block if it must, then the centre, then a corner, then anything.
 * Null on a full board.
 */
export function phoneMove(board: Board, random: () => number = Math.random): number | null {
  const open = free(board);
  if (open.length === 0) return null;
  if (random() < SLIP) return pick(open, random);
  const win = completing(board, PHONE);
  if (win !== null) return win;
  const block = completing(board, PERSON);
  if (block !== null) return block;
  if (board[4] === null) return 4;
  const corners = CORNERS.filter((i) => board[i] === null);
  if (corners.length > 0) return pick(corners, random);
  return pick(open, random);
}
