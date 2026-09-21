import { describe, expect, it } from "vitest";
import { TASK_STATES } from "@voicemural/shared";
import { BOARD_TOOLS, BOARD_TOOL_NAMES, boardEditFromToolCall } from "./board-tools";
import { BOARD_EDITING, OUTPUT_CONTRACT, composeSystemPrompt } from "./prompt";

describe("the board tools", () => {
  /**
   * The prompt names the tools and the container registers whatever the
   * session sends; if the two lists drift, the model calls a tool nothing
   * answers, or is told about one it does not have.
   */
  it("are exactly the tools the editing section names", () => {
    expect(BOARD_TOOL_NAMES).toEqual(["move_task", "add_task", "reword_task", "remove_task"]);
    for (const name of BOARD_TOOL_NAMES) expect(BOARD_EDITING).toContain(name);
  });

  it("offer every column, so a model cannot be told to invent one", () => {
    const move = BOARD_TOOLS.find((t) => t.function.name === "move_task")!;
    expect(move.function.parameters.properties.column?.enum).toEqual(TASK_STATES);
  });

  it("read each call into the edit the board page would make", () => {
    expect(boardEditFromToolCall("move_task", { card: "1225b3", column: "dropped" })).toEqual({
      edit: { action: "move", state: "dropped" },
      target: { handle: "1225b3" },
    });
    expect(boardEditFromToolCall("remove_task", { card: "1225b3" })).toEqual({
      edit: { action: "retire" },
      target: { handle: "1225b3" },
    });
    expect(boardEditFromToolCall("reword_task", { card: "1225b3", text: "  Draft it.  " })).toEqual({
      edit: { action: "reword", text: "Draft it." },
      target: { handle: "1225b3" },
    });
    expect(boardEditFromToolCall("add_task", { text: "Book flights.", topic: "Research stay" })).toEqual({
      edit: { action: "add", text: "Book flights.", topic: "Research stay", state: undefined },
    });
  });

  it("refuse a call they cannot read, with a reason the model can repeat", () => {
    expect(boardEditFromToolCall("move_task", { card: "1225b3", column: "finished" })).toMatchObject({
      error: expect.stringMatching(/column/),
    });
    expect(boardEditFromToolCall("add_task", { text: "Book flights." })).toMatchObject({
      error: expect.stringMatching(/topic/),
    });
    expect(boardEditFromToolCall("delete_everything", {})).toEqual({ error: "unknown tool delete_everything" });
    expect(boardEditFromToolCall("move_task", null)).toMatchObject({ error: expect.any(String) });
  });
});

describe("the editing section", () => {
  it("composes before the output contract, and only when asked for", () => {
    const withBoard = composeSystemPrompt({ sections: [BOARD_EDITING] }).prompt;
    expect(withBoard.indexOf(BOARD_EDITING)).toBeGreaterThan(-1);
    expect(withBoard.indexOf(BOARD_EDITING)).toBeLessThan(withBoard.indexOf(OUTPUT_CONTRACT));
    expect(composeSystemPrompt().prompt).not.toContain("EDITING THEIR BOARD");
  });

  it("treats delete as a move to dropped, and acts rather than asking first", () => {
    expect(BOARD_EDITING).toMatch(/Delete[^\n]*move_task to "dropped"/);
    expect(BOARD_EDITING).toMatch(/Do not ask first/);
    expect(BOARD_EDITING).toMatch(/Never claim a change the tool did not report/);
  });
});
