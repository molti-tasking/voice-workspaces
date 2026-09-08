/**
 * The messages a turn is made of, built the way `bot.py` builds them.
 *
 * `Recall._compose` in the container assembles the context block from the
 * retrieved passages, the running summary and any pending confirmation, and
 * parks it as a system message immediately before the user's words. An
 * evaluation that hands the model a differently shaped prompt is evaluating a
 * different system, so the shape is ported here — text for text — and a test
 * pins the port to the Python.
 *
 * Pure. No I/O, no model call.
 */

import type { ChatMessage } from "@voicemural/llm";
import { composeSystemPrompt, type ComposeInputs, type ComposedPrompt } from "../prompt";

export interface EvalContext {
  /** Where things stand on the topics touched, as `/api/realtime/context` returns them. */
  threads?: { text: string }[];
  /** From past drives, as `/api/realtime/context` returns them. */
  passages?: { when: string; text: string }[];
  /** The container's running summary of the current drive. */
  summary?: string;
  /** A parked irreversible action, restated for the person. */
  pending?: string;
}

/** Mirrors `Recall._compose`. Returns null when there is nothing to say. */
export function composeContextBlock(context: EvalContext | undefined): string | null {
  if (!context) return null;
  const sections: string[] = [];
  if (context.threads?.length) {
    sections.push(
      "Where things stand, from their earlier sessions:\n" +
        context.threads.map((t) => t.text).join("\n\n"),
    );
  }
  if (context.passages?.length) {
    sections.push(
      "From their past recordings:\n" +
        context.passages.map((p) => `[${p.when}] ${p.text}`).join("\n\n"),
    );
  }
  if (context.summary?.trim()) {
    sections.push(`So far in this drive:\n${context.summary.trim()}`);
  }
  if (sections.length === 0 && !context.pending) return null;

  let block = sections.join("\n\n");
  if (block) block += "\n\nThat is background. Answer only what was just said to you.";

  if (context.pending) {
    const ask =
      "They earlier asked for this, and it has not happened yet because it " +
      `cannot be undone: ${context.pending}\n` +
      "If they are between thoughts, ask in one short sentence whether to go " +
      "ahead. If they are mid-thought, say nothing and it will keep.";
    block = block ? `${block}\n\n${ask}` : ask;
  }
  return block;
}

export interface TurnInputs {
  compose: ComposeInputs;
  history?: { role: "user" | "assistant"; content: string }[];
  context?: EvalContext;
  said: string;
}

export interface TurnMessages {
  composed: ComposedPrompt;
  messages: ChatMessage[];
}

/** The full message list for one turn, in the container's order. */
export function buildTurnMessages(inputs: TurnInputs): TurnMessages {
  const composed = composeSystemPrompt(inputs.compose);
  const messages: ChatMessage[] = [{ role: "system", content: composed.prompt }];
  for (const turn of inputs.history ?? []) messages.push(turn);
  const block = composeContextBlock(inputs.context);
  if (block) messages.push({ role: "system", content: block });
  messages.push({ role: "user", content: inputs.said });
  return { composed, messages };
}
