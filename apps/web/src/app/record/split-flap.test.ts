import { describe, expect, it } from "vitest";
import { FLAP_ALPHABET, flapPlan, flapSequence } from "./split-flap";

describe("flapSequence", () => {
  it("does not move a cell that is already showing the right character", () => {
    expect(flapSequence("A", "A")).toEqual([]);
    expect(flapSequence(" ", " ")).toEqual([]);
  });

  it("turns through every drum in between, never jumping", () => {
    expect(flapSequence("A", "D")).toEqual(["B", "C", "D"]);
  });

  it("wraps past the end of the alphabet rather than running backwards", () => {
    // The last drum to the first letter: forwards through blank, as a real
    // board does — the drum only turns one way.
    expect(flapSequence("'", "A")).toEqual([" ", "A"]);
  });

  it("keeps only the last steps of a long journey", () => {
    const steps = flapSequence(" ", "Z", 8);
    expect(steps).toHaveLength(8);
    expect(steps).toEqual(["S", "T", "U", "V", "W", "X", "Y", "Z"]);
  });

  it("honours a shorter cap", () => {
    expect(flapSequence("A", "H", 3)).toEqual(["F", "G", "H"]);
  });

  it("flips through the tail and lands on a character it has no drum for", () => {
    const steps = flapSequence("A", "É", 4);
    expect(steps).toHaveLength(4);
    expect(steps[steps.length - 1]).toBe("É");
    // Everything before the landing is a real drum, so the cell still ticks.
    for (const step of steps.slice(0, -1)) {
      expect(FLAP_ALPHABET).toContain(step);
    }
  });

  it("travels from blank when the cell is showing something off the drum", () => {
    expect(flapSequence("É", "B")).toEqual(["A", "B"]);
  });
});

describe("flapPlan", () => {
  it("staggers the cells left to right", () => {
    expect(flapPlan("AA", "BB").map((cell) => cell.offset)).toEqual([0, 1]);
  });

  it("leaves unchanged cells still", () => {
    const plan = flapPlan("AB", "AC");
    expect(plan[0]!.steps).toEqual([]);
    expect(plan[1]!.steps).toEqual(["C"]);
  });

  it("grows a longer title into blank cells", () => {
    const plan = flapPlan("A", "AB");
    expect(plan).toHaveLength(2);
    expect(plan[0]!.steps).toEqual([]);
    // The new cell was blank and turns forward to B.
    expect(plan[1]!.steps).toEqual(["A", "B"]);
  });

  it("flips the tail of a shorter title back to blank", () => {
    const plan = flapPlan("AB", "A");
    expect(plan).toHaveLength(2);
    expect(plan[0]!.steps).toEqual([]);
    expect(plan[1]!.steps[plan[1]!.steps.length - 1]).toBe(" ");
  });

  it("starts an empty board from blanks", () => {
    const plan = flapPlan("", "HI");
    expect(plan).toHaveLength(2);
    expect(plan[0]!.steps).toEqual(["A", "B", "C", "D", "E", "F", "G", "H"]);
    expect(plan[1]!.steps).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I"].slice(-8));
  });
});
