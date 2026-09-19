import { describe, expect, it } from "vitest";
import { KEPT_AFTER_SESSIONS, foldBoard, judge } from "./board";
import {
  DEFAULT_IMPORT_TOPIC,
  MAX_IMPORT_TASKS,
  parseBoard,
  planBoardImport,
  taskStateFor,
} from "./board-import";
import type { StoredOp, WorkspaceOp } from "./types";

const D1 = new Date("2026-09-14T08:00:00Z");
const D2 = new Date("2026-09-15T08:00:00Z");
const BATCH = "3f0d1f2e-8b1a-4a0c-9a55-1f2e3d4c5b6a";

let seq = 0;
function op(o: WorkspaceOp, extras: Partial<StoredOp> = {}): StoredOp {
  seq += 1;
  return { id: `op-${seq}`, seq, occurredAt: D1, op: o, ...extras };
}

/** A board with one task speech already put in `next`. */
function spoken(text = "Write up the asymmetry argument."): StoredOp[] {
  seq = 0;
  return [
    op({ type: "create_topic", topicId: "t-a", title: "Voice paper" }, { captureSessionId: "s1" }),
    op(
      {
        type: "add_block",
        blockId: "b-1",
        topicId: "t-a",
        kind: "task",
        text,
        state: "next",
        spans: [{ utteranceId: "u1" }],
      },
      { captureSessionId: "s1", extractionId: "x1" },
    ),
  ];
}

/** Append a plan's ops the way the route does. */
function applied(ops: StoredOp[], plan: { ops: { id: string; op: WorkspaceOp }[] }): StoredOp[] {
  return [...ops, ...plan.ops.map((p) => op(p.op, { id: p.id, occurredAt: D2 }))];
}

describe("taskStateFor", () => {
  it("maps the column names other tools use onto the tenses of speech", () => {
    expect(taskStateFor("To Do")).toBe("open");
    expect(taskStateFor("Backlog")).toBe("open");
    expect(taskStateFor("Selected for Development")).toBe("next");
    expect(taskStateFor("In Progress")).toBe("doing");
    expect(taskStateFor("🚧 In-Progress!")).toBe("doing");
    expect(taskStateFor("Done")).toBe("done");
    expect(taskStateFor("Won't Do")).toBe("dropped");
  });

  it("answers null for a name that is not a column, so it can be read as a topic", () => {
    expect(taskStateFor("Voice paper")).toBeNull();
    expect(taskStateFor("")).toBeNull();
  });
});

describe("parseBoard: an outline", () => {
  it("reads a heading as a column when it names one, and as a topic when it does not", () => {
    const parsed = parseBoard(
      [
        "## Doing",
        "- Rewrite the silence gate",
        "## Voice paper",
        "- Draft the related work",
      ].join("\n"),
    );

    expect(parsed.format).toBe("outline");
    expect(parsed.tasks).toEqual([
      { text: "Rewrite the silence gate", state: "doing", topic: undefined, from: "Doing" },
      // The column persists past the topic heading: each kind of heading holds
      // until the next of its own kind.
      { text: "Draft the related work", state: "doing", topic: "Voice paper", from: "Doing" },
    ]);
  });

  it("takes a tick over the column it sits under", () => {
    const parsed = parseBoard(["To do", "- [ ] call the garage", "- [x] pay the invoice"].join("\n"));
    expect(parsed.tasks.map((t) => [t.text, t.state])).toEqual([
      ["call the garage", "open"],
      ["pay the invoice", "done"],
    ]);
  });

  it("reads struck-through lines as done, since a plain list has no column to say so", () => {
    const parsed = parseBoard("- ~~book the ferry~~\n- renew the pass");
    expect(parsed.tasks.map((t) => [t.text, t.state])).toEqual([
      ["book the ferry", "done"],
      ["renew the pass", "open"],
    ]);
  });

  it("keeps a link's words and drops its URL, which would blow the length cap", () => {
    const parsed = parseBoard("- [Fix the sweep](https://example.com/a/very/long/issue/url/1234)");
    expect(parsed.tasks[0]!.text).toBe("Fix the sweep");
  });

  it("treats every line as a task when the notes have no bullets and no headings", () => {
    const parsed = parseBoard("email William\nbook the MOT\nfinish the ethics form");
    expect(parsed.tasks).toHaveLength(3);
  });

  it("ignores prose between headings once the page has structure", () => {
    const parsed = parseBoard(
      ["# Next week", "Some thoughts before the list proper.", "- send the consent form"].join("\n"),
    );
    expect(parsed.tasks.map((t) => t.text)).toEqual(["send the consent form"]);
  });

  it("refuses a paragraph rather than truncating it into a task", () => {
    const paragraph = `- ${"a fairly long sentence about nothing ".repeat(8)}`;
    const parsed = parseBoard(paragraph);
    expect(parsed.tasks).toHaveLength(0);
    expect(parsed.skipped[0]!.reason).toBe("too_long");
  });
});

describe("parseBoard: a table", () => {
  it("reads a Jira CSV by its header, not by column position", () => {
    const csv = [
      "Issue key,Summary,Status,Epic Link",
      'VM-1,"Fix the sweep, finally",In Progress,Ledger',
      "VM-2,Write the consent form,To Do,Ethics",
    ].join("\n");

    const parsed = parseBoard(csv);
    expect(parsed.format).toBe("table");
    expect(parsed.tasks).toEqual([
      { text: "Fix the sweep, finally", state: "doing", topic: "Ledger", from: "In Progress" },
      { text: "Write the consent form", state: "open", topic: "Ethics", from: "To Do" },
    ]);
  });

  it("reads a Trello CSV, whose column is called a list", () => {
    const csv = ["Card Name,List Name,Board Name", "Book the ferry,Done,Trip"].join("\n");
    expect(parseBoard(csv).tasks).toEqual([
      { text: "Book the ferry", state: "done", topic: "Trip", from: "Done" },
    ]);
  });

  it("reads a Markdown table and skips its rule row", () => {
    const table = [
      "| Name | Status |",
      "| --- | --- |",
      "| Renew the pass | Blocked |",
    ].join("\n");
    const parsed = parseBoard(table);
    expect(parsed.format).toBe("table");
    expect(parsed.tasks).toEqual([
      { text: "Renew the pass", state: "open", topic: undefined, from: "Blocked" },
    ]);
  });

  it("falls through to the outline reader when no header names the task", () => {
    // Otherwise a CSV of something else entirely imports its first column.
    expect(parseBoard("date,minutes,distance\n2026-09-15,42,80").format).toBe("outline");
  });
});

describe("parseBoard: Trello JSON", () => {
  const board = JSON.stringify({
    name: "Voice paper",
    lists: [
      { id: "l1", name: "To Do", closed: false },
      { id: "l2", name: "In Progress", closed: false },
      { id: "l3", name: "Old sprint", closed: true },
    ],
    cards: [
      { name: "Write the method", idList: "l1", closed: false },
      { name: "Rewrite the gate", idList: "l2", closed: false },
      { name: "Something from March", idList: "l1", closed: true },
      { name: "Something from January", idList: "l3", closed: false },
    ],
  });

  it("maps lists to columns and the board's own name to the topic", () => {
    const parsed = parseBoard(board);
    expect(parsed.format).toBe("trello-json");
    expect(parsed.tasks).toEqual([
      { text: "Write the method", state: "open", topic: "Voice paper", from: "To Do" },
      { text: "Rewrite the gate", state: "doing", topic: "Voice paper", from: "In Progress" },
    ]);
  });

  it("refuses archived cards and cards in archived lists, and says it did", () => {
    expect(parseBoard(board).skipped).toEqual([
      { text: "Something from March", reason: "archived" },
      { text: "Something from January", reason: "archived" },
    ]);
  });
});

describe("parseBoard: limits", () => {
  it("caps the import and reports the overflow rather than dropping it silently", () => {
    const lines = Array.from({ length: MAX_IMPORT_TASKS + 3 }, (_, i) => `- task number ${i}`);
    const parsed = parseBoard(lines.join("\n"));
    expect(parsed.tasks).toHaveLength(MAX_IMPORT_TASKS);
    expect(parsed.skipped).toHaveLength(3);
    expect(parsed.skipped.every((s) => s.reason === "over_limit")).toBe(true);
  });

  it("counts a task listed twice in one paste once", () => {
    const parsed = parseBoard("- Email William\n- email william.");
    expect(parsed.tasks).toHaveLength(1);
    expect(parsed.skipped[0]!.reason).toBe("duplicate");
  });
});

describe("planBoardImport", () => {
  it("writes adds that carry via: import and no spans", () => {
    const plan = planBoardImport([], [{ text: "Book the ferry", state: "next", topic: "Trip" }], {
      batchId: BATCH,
    });

    expect(plan.ops.map((o) => o.op.type)).toEqual(["create_topic", "add_block"]);
    const add = plan.ops[1]!.op;
    expect(add).toMatchObject({
      type: "add_block",
      kind: "task",
      text: "Book the ferry",
      state: "next",
      via: "import",
      // No utterance said it, so seeking from the card would be a lie.
      spans: [],
    });
    expect(plan.topicsCreated).toEqual(["Trip"]);
  });

  it("puts tasks with no topic of their own in one fallback topic", () => {
    const plan = planBoardImport(
      [],
      [
        { text: "Email William", state: "open" },
        { text: "Book the MOT", state: "open" },
      ],
      { batchId: BATCH },
    );

    expect(plan.topicsCreated).toEqual([DEFAULT_IMPORT_TOPIC]);
    expect(plan.ops.filter((o) => o.op.type === "create_topic")).toHaveLength(1);
    expect(plan.cards.every((c) => c.topicTitle === DEFAULT_IMPORT_TOPIC)).toBe(true);
  });

  it("lands in a topic that already exists rather than opening a second one", () => {
    const plan = planBoardImport(spoken(), [{ text: "Draft the intro", state: "open", topic: "voice paper" }], {
      batchId: BATCH,
    });

    expect(plan.ops.map((o) => o.op.type)).toEqual(["add_block"]);
    expect(plan.ops[0]!.op).toMatchObject({ topicId: "t-a" });
    expect(plan.topicsCreated).toEqual([]);
  });

  it("refuses a task the board already carries, whatever column it sits in", () => {
    const ops = spoken("Write up the asymmetry argument.");
    const plan = planBoardImport(
      ops,
      [
        { text: "write up the asymmetry argument", state: "open" },
        { text: "Draft the related work", state: "open" },
      ],
      { batchId: BATCH },
    );

    expect(plan.cards.map((c) => c.text)).toEqual(["Draft the related work"]);
    expect(plan.skipped).toEqual([
      { text: "write up the asymmetry argument", reason: "duplicate" },
    ]);
  });

  it("plans the same rows twice, so a retried submit is a no-op at the primary key", () => {
    const tasks = [{ text: "Book the ferry", state: "next" as const }];
    const first = planBoardImport([], tasks, { batchId: BATCH });
    const second = planBoardImport([], tasks, { batchId: BATCH });
    expect(second.ops.map((o) => o.id)).toEqual(first.ops.map((o) => o.id));
  });

  it("renumbers nothing when a row is removed from the preview and the rest resubmitted", () => {
    const all = [
      { text: "Book the ferry", state: "next" as const },
      { text: "Email William", state: "open" as const },
    ];
    const full = planBoardImport([], all, { batchId: BATCH });
    const trimmed = planBoardImport([], all.slice(1), { batchId: BATCH });

    const idOf = (plan: typeof full, text: string) => plan.cards.find((c) => c.text === text)!.blockId;
    expect(idOf(trimmed, "Email William")).toBe(idOf(full, "Email William"));
  });
});

describe("an imported board, folded", () => {
  it("becomes cards in the columns it was imported into", () => {
    const ops = applied(
      [],
      planBoardImport(
        [],
        [
          { text: "Book the ferry", state: "next", topic: "Trip" },
          { text: "Renew the pass", state: "doing", topic: "Trip" },
        ],
        { batchId: BATCH },
      ),
    );

    const board = foldBoard(ops);
    expect(board.columns.next.map((c) => c.block.text)).toEqual(["Book the ferry"]);
    expect(board.columns.doing.map((c) => c.block.text)).toEqual(["Renew the pass"]);
    expect(board.transitions.every((t) => t.via === "import")).toBe(true);
  });

  it("is not judged: an imported card left alone is not an accepted machine move", () => {
    const ops = applied(
      spoken(),
      planBoardImport(spoken(), [{ text: "Book the ferry", state: "next" }], { batchId: BATCH }),
    );

    const board = foldBoard(ops);
    const judged = judge(board.transitions, {
      withinSessions: KEPT_AFTER_SESSIONS,
      sessions: board.sessions,
    });

    expect(judged.map((j) => j.transition.via)).toEqual(["speech"]);
  });

  it("still judges what speech later does to an imported card", () => {
    const withImport = applied(
      [],
      planBoardImport([], [{ text: "Book the ferry", state: "next" }], { batchId: BATCH }),
    );
    const card = withImport.find((o) => o.op.type === "add_block")!;
    const blockId = (card.op as { blockId: string }).blockId;

    // A later drive hears "the ferry is booked" and the extractor moves it.
    const moved = [
      ...withImport,
      op(
        {
          type: "revise_block",
          blockId: "b-moved",
          supersedesBlockId: blockId,
          topicId: (card.op as { topicId: string }).topicId,
          kind: "task",
          text: "Book the ferry",
          state: "done",
          spans: [{ utteranceId: "u9" }],
        },
        { captureSessionId: "s2", extractionId: "x2" },
      ),
    ];

    const board = foldBoard(moved);
    const judged = judge(board.transitions, {
      withinSessions: KEPT_AFTER_SESSIONS,
      sessions: board.sessions,
    });

    expect(judged).toHaveLength(1);
    expect(judged[0]!.transition.via).toBe("speech");
    expect(judged[0]!.transition.from).toBe("next");
    expect(judged[0]!.transition.to).toBe("done");
  });
});
