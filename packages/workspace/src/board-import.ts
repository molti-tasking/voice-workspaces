/**
 * A board the person already keeps, brought in as cards.
 *
 * WHY THIS EXISTS. Nobody arrives without work in flight. They have a Trello
 * board, a Jira filter, a Notion database, or a list in a notes app, and until
 * that work is on this board the first drives talk past it: the extractor can
 * only ever hear a task that gets SAID, so "how did the William thing go" makes
 * no card, and the agent — which is shown the board and nothing else — cannot
 * see what the person is actually carrying. An import is the one way to start a
 * deployment mid-stream rather than from zero.
 *
 * WHAT IT MUST NOT DO. Imported cards are not evidence about the system. They
 * are the person's own claim about their own work, so they enter the ledger
 * under `via: "import"` and `judge()` refuses to score them (see board.ts): a
 * hundred imported cards sitting untouched for two drives would otherwise read
 * as a hundred machine-made transitions the person accepted, and the acceptance
 * measure would be mostly furniture. Every LATER transition on an imported card
 * is judged as usual, which is the point — an imported task that speech moves
 * to `done` is the acceptance question asked on day one instead of day ten.
 *
 * NO PROVENANCE, AND THAT IS HONEST. An imported block carries no spans. No
 * utterance said it, so seeking from the card to the audio would be a lie; the
 * card says where it came from instead.
 *
 * TWO HALVES. `parseBoard` reads pasted text and answers what tasks it found,
 * so a person can see and correct them before anything is written;
 * `planBoardImport` turns the list they confirmed into ops. Both pure: no I/O,
 * no model call, no database. Parsing deliberately uses no model — a board
 * export is structured text, and a person watching a spinner while an LLM
 * rewrites their task list would have to check every line anyway.
 */
import { foldBoard } from "./board";
import { MAX_TASK_TEXT, cardHandle, sameTaskText, type PlannedCard } from "./board-edit";
import { deterministicId } from "./extract";
import { foldWorkspace } from "./fold";
import type { StoredOp, TaskState, WorkspaceOp } from "./types";

/* ---------------------------------------------------------------------------
 * What comes out
 * ------------------------------------------------------------------------- */

/** How the pasted text was read. Reported so the person can tell it guessed right. */
export type ImportFormat = "trello-json" | "table" | "outline";

export interface ImportedTask {
  text: string;
  state: TaskState;
  /** The topic it should land in, when the source named one. */
  topic?: string;
  /** The column, list or heading it came from, verbatim — shown in the preview. */
  from?: string;
}

/**
 * Why a line did not become a card.
 *
 * Reported rather than dropped silently. An import that quietly loses nine of
 * forty tasks is worse than one that refuses them out loud, because the person
 * finds out weeks later when the card they were waiting for never came up.
 */
export type ImportSkipReason =
  /** Longer than a task line — a paragraph, not an item. Never truncated. */
  | "too_long"
  /** Past MAX_IMPORT_TASKS. */
  | "over_limit"
  /** Trello had it archived. Already disposed of; not this board's business. */
  | "archived"
  /** The same task twice in the paste, or already on the board. */
  | "duplicate";

export interface SkippedTask {
  /** Trimmed for display: this is the person's own text coming straight back. */
  text: string;
  reason: ImportSkipReason;
}

export interface ParsedBoard {
  format: ImportFormat;
  tasks: ImportedTask[];
  skipped: SkippedTask[];
}

/**
 * Most cards one import may add.
 *
 * A Jira export of an entire backlog is thousands of rows, and a board of
 * thousands is not a board — it is a backlog the person stopped reading, which
 * would also swamp `MAX_BOARD_CHARS` in the agent's context and crowd out
 * every card that came from speech. Two hundred is more than any board anyone
 * works from, and the overflow is reported rather than dropped.
 */
export const MAX_IMPORT_TASKS = 200;

/** Where imported tasks land when the source named no project, epic or board. */
export const DEFAULT_IMPORT_TOPIC = "Imported";

/** Longest topic title accepted, matching `planBoardEdit`'s add. */
const MAX_TOPIC_TITLE = 80;

/** Skipped lines are echoed back to the person, but not a whole paragraph of one. */
const MAX_SKIPPED_TEXT = 120;

/* ---------------------------------------------------------------------------
 * Columns
 * ------------------------------------------------------------------------- */

/**
 * The column names other tools use, mapped onto the tenses of speech.
 *
 * The board's five columns are tenses — what the person's own speech implied
 * about where a task stands — and every tool here names them differently. The
 * mapping is a lookup rather than a model call because it has to be the same
 * every time: a participant who imports twice and gets "In Review" in `doing`
 * one week and `next` the next is looking at an instrument that moved.
 *
 * Unrecognised names are NOT forced into a column. A heading the list does not
 * know is a topic (see `parseOutline`), which is how a Notion database grouped
 * by project imports sensibly rather than as five hundred cards in `open`.
 */
const COLUMN_NAMES: Record<TaskState, readonly string[]> = {
  open: [
    "open", "to do", "todo", "todos", "to dos", "backlog", "inbox", "ideas", "someday",
    "maybe", "later", "parked", "on hold", "blocked", "waiting", "new", "not started",
    "unstarted", "triage", "wishlist", "unsorted",
  ],
  next: [
    "next", "up next", "next up", "this week", "ready", "ready for dev",
    "selected for development", "planned", "upcoming", "soon", "sprint", "committed",
    "scheduled",
  ],
  doing: [
    "doing", "in progress", "inprogress", "work in progress", "wip", "started",
    "in review", "review", "in development", "current", "active", "now", "today",
    "ongoing", "underway",
  ],
  done: [
    "done", "complete", "completed", "closed", "resolved", "shipped", "finished",
    "delivered", "merged", "released", "fixed",
  ],
  dropped: [
    "dropped", "wont do", "wont fix", "will not do", "not doing", "cancelled",
    "canceled", "abandoned", "rejected", "declined", "discarded", "obsolete",
    "duplicate", "trash", "archive", "archived", "no longer needed",
  ],
};

/** Case, punctuation and emoji removed, so "🚧 In-Progress!" matches "in progress". */
function normaliseColumn(name: string): string {
  return name
    .toLowerCase()
    // Apostrophes close up rather than splitting the word: "Won't Do" is
    // "wont do", which is how the list below spells it.
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Which column a list, status or heading names — or null when it names none.
 *
 * Null is a real answer and the caller must handle it: it is what tells a
 * topic heading apart from a column heading.
 */
export function taskStateFor(name: string): TaskState | null {
  const normalised = normaliseColumn(name);
  if (!normalised) return null;
  for (const [state, names] of Object.entries(COLUMN_NAMES) as [TaskState, readonly string[]][]) {
    if (names.includes(normalised)) return state;
  }
  return null;
}

/* ---------------------------------------------------------------------------
 * Reading one line
 * ------------------------------------------------------------------------- */

const BULLET = /^\s*(?:[-*+•·‣▪]|\d+[.)]|\(\d+\))\s+/;
const HEADING = /^\s*#{1,6}\s+(.+?)\s*#*\s*$/;
const CHECKBOX = /^\[([ xX~/-])\]\s*/;
/** A heading written as a label: "Doing:", "Next week:". */
const LABEL_HEADING = /^\s*([^-*+•|:][^:]{0,58}):\s*$/;

/** A card's words, freed of the markup a list format wrapped them in. */
function cleanText(raw: string): { text: string; done: boolean } {
  let text = raw.replace(BULLET, "");
  let done = false;

  const box = CHECKBOX.exec(text);
  if (box) {
    // `[x]` and `[~]` both mean finished in the dialects people actually write;
    // `[ ]`, `[/]` and `[-]` mean started, deferred or not yet.
    if (/[xX~]/.test(box[1]!)) done = true;
    text = text.replace(CHECKBOX, "");
  }

  // Struck-through in a notes app means finished, and is often the ONLY mark of
  // it — a plain list has no column to say it.
  const struck = /^~~(.+)~~$/.exec(text.trim());
  if (struck) {
    done = true;
    text = struck[1]!;
  }

  text = text
    // A link is its words, not its URL: "[Fix the sweep](https://…)" is a task
    // whose text is "Fix the sweep", and the URL alone would blow MAX_TASK_TEXT.
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return { text, done };
}

/** A parse in progress: collects tasks and refusals under one cap. */
class Collector {
  readonly tasks: ImportedTask[] = [];
  readonly skipped: SkippedTask[] = [];
  private readonly seen: string[] = [];

  add(task: ImportedTask): void {
    const text = task.text.trim();
    if (!text) return;
    if (text.length > MAX_TASK_TEXT) {
      this.skip(text, "too_long");
      return;
    }
    // Within one paste, a task listed twice is one task. Across the paste and
    // the board, `planBoardImport` decides — it is the only half that has ops.
    if (this.seen.some((s) => sameTaskText(s, text))) {
      this.skip(text, "duplicate");
      return;
    }
    if (this.tasks.length >= MAX_IMPORT_TASKS) {
      this.skip(text, "over_limit");
      return;
    }
    this.seen.push(text);
    this.tasks.push({ ...task, text });
  }

  skip(text: string, reason: ImportSkipReason): void {
    this.skipped.push({ text: text.slice(0, MAX_SKIPPED_TEXT).trim(), reason });
  }
}

/* ---------------------------------------------------------------------------
 * Trello's own export
 * ------------------------------------------------------------------------- */

interface Trelloish {
  name?: unknown;
  lists?: unknown;
  cards?: unknown;
}

/**
 * Trello's "Export JSON", which is what its share menu hands you.
 *
 * Lists are columns, so their names go through `taskStateFor`; the BOARD's name
 * is the topic, because one export is one board and "Voice paper" is exactly
 * the kind of title a topic wants. Archived cards and cards in archived lists
 * are refused: the person already decided about those, and importing them would
 * reopen a year of finished work in `done`.
 */
function parseTrello(text: string): ParsedBoard | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;

  const board = raw as Trelloish;
  if (!Array.isArray(board.cards)) return null;

  const lists = new Map<string, { name: string; closed: boolean }>();
  if (Array.isArray(board.lists)) {
    for (const entry of board.lists) {
      const list = entry as { id?: unknown; name?: unknown; closed?: unknown };
      if (typeof list.id === "string") {
        lists.set(list.id, {
          name: typeof list.name === "string" ? list.name : "",
          closed: list.closed === true,
        });
      }
    }
  }

  const topic = typeof board.name === "string" ? board.name.trim() : "";
  const collector = new Collector();

  for (const entry of board.cards) {
    const card = entry as { name?: unknown; idList?: unknown; closed?: unknown };
    if (typeof card.name !== "string") continue;
    const list = typeof card.idList === "string" ? lists.get(card.idList) : undefined;

    if (card.closed === true || list?.closed) {
      collector.skip(card.name, "archived");
      continue;
    }

    const { text: cardText, done } = cleanText(card.name);
    collector.add({
      text: cardText,
      state: (list?.name ? taskStateFor(list.name) : null) ?? (done ? "done" : "open"),
      topic: topic || undefined,
      from: list?.name || undefined,
    });
  }

  return { format: "trello-json", tasks: collector.tasks, skipped: collector.skipped };
}

/* ---------------------------------------------------------------------------
 * A table: Jira's CSV, Trello's CSV, a Notion export
 * ------------------------------------------------------------------------- */

/** Header names that hold the task itself. Checked in order; first hit wins. */
const TITLE_KEYS = ["summary", "card name", "task name", "title", "name", "task", "item"];
/** Header names that say where it stands. */
const STATE_KEYS = ["status", "state", "list name", "list", "column", "stage", "progress"];
/** Header names that say what it belongs to. */
const TOPIC_KEYS = [
  "epic link", "epic", "parent summary", "parent", "project", "board name", "board",
  "category", "area", "topic", "component", "components",
];

/** One row split on a delimiter, honouring the quotes a CSV writer emits. */
function splitRow(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i]!;
    if (quoted) {
      if (char === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (line[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === delimiter) {
      fields.push(field);
      field = "";
    } else field += char;
  }

  fields.push(field);
  return fields.map((f) => f.trim());
}

function markdownRow(line: string): string[] {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((f) => f.trim());
}

function indexOfKey(header: readonly string[], keys: readonly string[]): number {
  for (const key of keys) {
    const at = header.indexOf(key);
    if (at >= 0) return at;
  }
  return -1;
}

/**
 * A header row and rows under it — Jira's CSV, Trello's CSV, a Markdown table.
 *
 * Returns null unless the header names something recognisable as the task
 * itself, so a CSV of anything else falls through to the outline reader rather
 * than importing its first column as forty cards.
 */
function parseTable(text: string): ParsedBoard | null {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return null;

  const first = lines[0]!;
  const markdown = first.trim().startsWith("|");
  const delimiter = first.includes("\t") ? "\t" : ",";
  const split = (line: string) => (markdown ? markdownRow(line) : splitRow(line, delimiter));

  const header = split(first).map((h) => normaliseColumn(h));
  const titleAt = indexOfKey(header, TITLE_KEYS);
  if (titleAt < 0) return null;

  const stateAt = indexOfKey(header, STATE_KEYS);
  const topicAt = indexOfKey(header, TOPIC_KEYS);
  const collector = new Collector();

  for (const line of lines.slice(1)) {
    // The `|---|---|` rule under a Markdown table's header is not a row.
    if (markdown && /^[\s|:-]+$/.test(line)) continue;
    const fields = split(line);
    const raw = fields[titleAt];
    if (!raw) continue;

    const { text: taskText, done } = cleanText(raw);
    const column = stateAt >= 0 ? (fields[stateAt] ?? "") : "";
    const topic = topicAt >= 0 ? (fields[topicAt] ?? "").trim() : "";

    collector.add({
      text: taskText,
      state: taskStateFor(column) ?? (done ? "done" : "open"),
      topic: topic || undefined,
      from: column || undefined,
    });
  }

  if (collector.tasks.length === 0 && collector.skipped.length === 0) return null;
  return { format: "table", tasks: collector.tasks, skipped: collector.skipped };
}

/* ---------------------------------------------------------------------------
 * An outline, or just notes
 * ------------------------------------------------------------------------- */

/** The heading a line is, or null if it is not one. */
function headingOf(line: string): string | null {
  const hash = HEADING.exec(line);
  if (hash) return hash[1]!.trim();

  const label = LABEL_HEADING.exec(line);
  if (label) return label[1]!.trim();

  // A bare line naming a column, as people write a list by hand:
  //   Doing
  //   - the sweep
  const bare = line.trim();
  if (bare.length <= 30 && !BULLET.test(line) && taskStateFor(bare)) return bare;

  return null;
}

/**
 * Markdown, an indented list, or a page of notes with no structure at all.
 *
 * THE ONE INTERESTING RULE: a heading either sets the column or sets the topic,
 * and each persists until the next heading of its kind. `## Doing` is a column
 * because `taskStateFor` knows the word; `## Voice paper` is not, so it is a
 * topic. That is what makes a Trello-shaped export (headings are columns) and a
 * Notion-shaped one (headings are projects) both read correctly without asking
 * the person which they pasted — and a document with both, `## Doing` then
 * `### Voice paper`, keeps them independently.
 *
 * The fallback is deliberate: this reader never returns null, because a page of
 * notes is a legitimate thing to paste and every line of it is a candidate
 * task. That is exactly why the person confirms the list before it is written.
 */
function parseOutline(text: string): ParsedBoard {
  const lines = text.split(/\r?\n/);
  const collector = new Collector();

  // With no bullets and no headings anywhere, this is a list of lines and each
  // one is a task. With either, only bulleted lines are — otherwise a heading's
  // prose blurb becomes a card.
  const structured = lines.some((l) => BULLET.test(l) || headingOf(l) !== null);

  let state: TaskState | null = null;
  let topic: string | undefined;
  let column: string | undefined;

  for (const line of lines) {
    if (!line.trim()) continue;

    const heading = headingOf(line);
    if (heading) {
      const headingState = taskStateFor(heading);
      if (headingState) {
        state = headingState;
        column = heading;
      } else {
        topic = heading.slice(0, MAX_TOPIC_TITLE);
      }
      continue;
    }

    if (structured && !BULLET.test(line) && !CHECKBOX.test(line.trim())) continue;

    const { text: taskText, done } = cleanText(line);
    collector.add({
      text: taskText,
      // A tick beats the column it sits under: someone who wrote `- [x]` under
      // "To do" is telling you it is finished.
      state: done ? "done" : (state ?? "open"),
      topic,
      from: done && state !== "done" ? undefined : column,
    });
  }

  return { format: "outline", tasks: collector.tasks, skipped: collector.skipped };
}

/**
 * Read a pasted board.
 *
 * Tried in order of how much the format tells us: Trello's JSON names its own
 * lists and board, a table names its columns in a header, and an outline has to
 * be inferred. Nothing here writes; the person sees the result and corrects it
 * before `planBoardImport` turns it into ops.
 */
export function parseBoard(text: string): ParsedBoard {
  const trimmed = text.trim();
  if (!trimmed) return { format: "outline", tasks: [], skipped: [] };
  return parseTrello(trimmed) ?? parseTable(trimmed) ?? parseOutline(trimmed);
}

/* ---------------------------------------------------------------------------
 * Planning the ops
 * ------------------------------------------------------------------------- */

export interface BoardImportPlan {
  /** Rows to append, in order, each with its idempotent row id. */
  ops: { id: string; op: WorkspaceOp }[];
  /** The cards this import puts on the board. */
  cards: PlannedCard[];
  /** Tasks refused, and why — reported back rather than dropped. */
  skipped: SkippedTask[];
  /** Topic titles this import opens. */
  topicsCreated: string[];
}

/**
 * Turn a confirmed task list into ops.
 *
 * Every op carries `via: "import"`, and every block carries no spans: an
 * imported card is the person's own record of their own work, and no utterance
 * said it. A task already on the board in any column is refused — importing the
 * same board twice, or importing one whose tasks a drive has already put on the
 * board by speech, leaves a single card rather than a pair the person then has
 * to reconcile.
 *
 * Idempotent by construction, like `planBoardEdit`: ids are derived from the
 * caller's `batchId` and the task's own words, so a submit retried after a
 * dropped connection plans the same rows and the primary key turns the second
 * append into a no-op.
 */
export function planBoardImport(
  ops: readonly StoredOp[],
  tasks: readonly ImportedTask[],
  opts: { batchId: string; topic?: string },
): BoardImportPlan {
  const workspace = foldWorkspace(ops);
  const board = foldBoard(ops);

  const fallback =
    (opts.topic ?? "").trim().slice(0, MAX_TOPIC_TITLE) || DEFAULT_IMPORT_TOPIC;

  const planned: { id: string; op: WorkspaceOp }[] = [];
  const cards: PlannedCard[] = [];
  const skipped: SkippedTask[] = [];
  const topicsCreated: string[] = [];
  /** Topic id by lowercased title, so one import opens a topic once. */
  const topicIds = new Map<string, string>();
  const accepted: string[] = [];

  for (const task of tasks) {
    const text = task.text.trim();
    if (!text) continue;

    if (text.length > MAX_TASK_TEXT) {
      skipped.push({ text: text.slice(0, MAX_SKIPPED_TEXT), reason: "too_long" });
      continue;
    }

    if (cards.length >= MAX_IMPORT_TASKS) {
      skipped.push({ text: text.slice(0, MAX_SKIPPED_TEXT), reason: "over_limit" });
      continue;
    }

    // Against the board in EVERY column, including done and dropped — unlike
    // the agent's add, which may legitimately re-open something finished. An
    // import is a bulk restatement of what already exists; a second copy of a
    // card is noise the person has to clear by hand.
    const onBoard = board.cards.some((c) => sameTaskText(c.block.text, text));
    const inBatch = accepted.some((t) => sameTaskText(t, text));
    if (onBoard || inBatch) {
      skipped.push({ text: text.slice(0, MAX_SKIPPED_TEXT), reason: "duplicate" });
      continue;
    }

    const title = (task.topic ?? "").trim().slice(0, MAX_TOPIC_TITLE) || fallback;
    const key = title.toLowerCase();
    let topicId = topicIds.get(key);
    if (!topicId) {
      // Live topics only, as the agent's add does: a merged-away topic is not
      // a home for new work.
      const existing = workspace.topics.find((t) => t.title.toLowerCase() === key);
      topicId = existing?.id ?? deterministicId("import-topic", opts.batchId, key);
      topicIds.set(key, topicId);
      if (!existing) {
        planned.push({
          id: topicId,
          op: { type: "create_topic", topicId, title, via: "import" },
        });
        topicsCreated.push(title);
      }
    }

    // Keyed by the words rather than by position, so removing a row from the
    // preview and submitting again does not renumber every other card.
    const blockId = deterministicId("import-task", opts.batchId, text.toLowerCase());
    planned.push({
      id: blockId,
      op: {
        type: "add_block",
        blockId,
        topicId,
        kind: "task",
        text,
        state: task.state,
        via: "import",
        spans: [],
      },
    });

    accepted.push(text);
    cards.push({
      cardId: blockId,
      handle: cardHandle(blockId),
      blockId,
      text,
      state: task.state,
      topicTitle: title,
    });
  }

  return { ops: planned, cards, skipped, topicsCreated };
}
