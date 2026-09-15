/**
 * The tools that let the talk-back agent change the person's task board.
 *
 * DEFINED HERE, NOT IN THE CONTAINER, for the reason the prompt is: there must
 * be one copy. `/api/realtime/session` hands these schemas to bot.py, which
 * registers them with Pipecat without knowing what they mean, and every call
 * comes back to `/api/realtime/board`, which reads it with
 * `boardEditFromToolCall` below. The eval passes the same schemas to the model.
 * A tool renamed in Python and not here would be a tool the agent calls and
 * nothing answers.
 *
 * Four tools, one per edit the board page can also make or the extractor can
 * make from speech: move a card, add one, reword one, and say one was never a
 * task. "Delete" is deliberately a MOVE to `dropped`, not a removal — the card
 * stays visible, a drag undoes it, and "decided not to" stays data.
 *
 * Pure: schemas and a parser. No I/O.
 */
import { TASK_STATES } from "@voicemural/shared";
import type { BoardEdit, CardTarget } from "@voicemural/workspace";

/** OpenAI function-tool shape, which LiteLLM and Pipecat both accept. */
export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, { type: "string"; description: string; enum?: readonly string[] }>;
      required: string[];
    };
  };
}

const CARD = {
  type: "string" as const,
  description: 'The card\'s handle from the board, e.g. "1225b3".',
};

export const BOARD_TOOLS: ToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "move_task",
      description:
        'Move a task to another column. Use "done" when they finished it, "doing" when they started it, "next" or "open" to reprioritise, and "dropped" when they want it deleted, removed, cancelled or forgotten.',
      parameters: {
        type: "object",
        properties: {
          card: CARD,
          column: { type: "string", enum: TASK_STATES, description: "The column to move it to." },
        },
        required: ["card", "column"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "add_task",
      description:
        "Add a task they have asked you to put on the board. Short, in their words, phrased as something to do.",
      parameters: {
        type: "object",
        properties: {
          text: { type: "string", description: 'The task, e.g. "Book the flights to Stanford."' },
          topic: {
            type: "string",
            description: "The topic it belongs to: one of their topics by name, or a short new name if none fits.",
          },
          column: { type: "string", enum: TASK_STATES, description: 'Where it starts. "open" unless they say.' },
        },
        required: ["text", "topic"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "reword_task",
      description: "Change what a task says, keeping its column. Only when they ask for different wording.",
      parameters: {
        type: "object",
        properties: {
          card: CARD,
          text: { type: "string", description: "The new wording." },
        },
        required: ["card", "text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "remove_task",
      description:
        'Take a card off the board because it was never a task at all. NOT for deleting a task they have decided against — that is move_task to "dropped".',
      parameters: {
        type: "object",
        properties: { card: CARD },
        required: ["card"],
      },
    },
  },
];

export const BOARD_TOOL_NAMES = BOARD_TOOLS.map((t) => t.function.name);

export type BoardToolName = "move_task" | "add_task" | "reword_task" | "remove_task";
type State = (typeof TASK_STATES)[number];

function text(args: Record<string, unknown>, key: string, max: number): string | undefined {
  const value = args[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : undefined;
}

function state(args: Record<string, unknown>, key: string): State | undefined {
  const value = args[key];
  return (TASK_STATES as readonly unknown[]).includes(value) ? (value as State) : undefined;
}

/**
 * A tool call as the model made it, read into an edit — or the reason it
 * cannot be. The reason goes back to the model as the tool's result, so it is
 * written to be read by it.
 */
export function boardEditFromToolCall(
  name: string,
  rawArgs: unknown,
): { edit: BoardEdit; target?: CardTarget } | { error: string } {
  const args = (rawArgs && typeof rawArgs === "object" ? rawArgs : {}) as Record<string, unknown>;
  const card = text(args, "card", 16);

  switch (name) {
    case "move_task": {
      const column = state(args, "column");
      if (!card || !column) return { error: `move_task needs a card handle and a column (${TASK_STATES.join(", ")})` };
      return { edit: { action: "move", state: column }, target: { handle: card } };
    }
    case "add_task": {
      const task = text(args, "text", 200);
      const topic = text(args, "topic", 80);
      if (!task || !topic) return { error: "add_task needs the task's text and a topic" };
      if (args.column !== undefined && !state(args, "column")) {
        return { error: `add_task column must be one of ${TASK_STATES.join(", ")}` };
      }
      return { edit: { action: "add", text: task, topic, state: state(args, "column") } };
    }
    case "reword_task": {
      const wording = text(args, "text", 200);
      if (!card || !wording) return { error: "reword_task needs a card handle and the new text" };
      return { edit: { action: "reword", text: wording }, target: { handle: card } };
    }
    case "remove_task":
      if (!card) return { error: "remove_task needs a card handle" };
      return { edit: { action: "retire" }, target: { handle: card } };
    default:
      return { error: `unknown tool ${name}` };
  }
}
