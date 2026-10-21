import { describe, expect, it } from "vitest";
import { EMPTY_BOARD, outcome, phoneMove, place, type Board, type Cell } from "./tic-tac-toe";

const board = (rows: string): Board =>
  [...rows.replace(/\s/g, "")].map((c): Cell => (c === "X" || c === "O" ? c : null));

/** A random source that never slips and takes the first option. */
const steady = () => 0.99;

describe("outcome", () => {
  it("finds a line in any direction, a draw on a full board, and nothing yet otherwise", () => {
    expect(outcome(board("XXX ... ..."))).toBe("X");
    expect(outcome(board("O.. O.. O.."))).toBe("O");
    expect(outcome(board("X.. .X. ..X"))).toBe("X");
    expect(outcome(board("..O .O. O.."))).toBe("O");
    expect(outcome(board("XOX XOO OXX"))).toBe("draw");
    expect(outcome(board("XO. ... ..."))).toBeNull();
    expect(outcome(EMPTY_BOARD)).toBeNull();
  });
});

describe("place", () => {
  it("marks a free square and leaves a taken one", () => {
    const once = place(EMPTY_BOARD, 4, "X");
    expect(once[4]).toBe("X");
    expect(place(once, 4, "O")).toBe(once);
  });
});

describe("phoneMove", () => {
  it("wins when it can, before blocking", () => {
    expect(phoneMove(board("OO. XX. X.."), steady)).toBe(2);
  });

  it("blocks a line of theirs", () => {
    expect(phoneMove(board("XX. .O. ..."), steady)).toBe(2);
  });

  it("takes the centre, then a corner", () => {
    expect(phoneMove(board("X.. ... ..."), steady)).toBe(4);
    expect([0, 2, 6, 8]).toContain(phoneMove(board("... .X. ..."), steady));
  });

  it("now and then plays any free square instead", () => {
    // 0.1 slips; the next 0 picks the first free square.
    const values = [0.1, 0];
    const slipping = () => values.shift() ?? 0;
    expect(phoneMove(board("XX. .O. ..."), slipping)).toBe(2);
    const values2 = [0.1, 0.99];
    expect(phoneMove(board("XX. .O. ..."), () => values2.shift() ?? 0)).toBe(8);
  });

  it("never plays a taken square, and has no move on a full board", () => {
    let b = EMPTY_BOARD;
    for (let turn = 0; turn < 9 && outcome(b) === null; turn++) {
      const at = phoneMove(b, Math.random)!;
      expect(b[at]).toBeNull();
      b = place(b, at, turn % 2 ? "O" : "X");
    }
    expect(phoneMove(board("XOX XOO OXX"))).toBeNull();
  });
});
