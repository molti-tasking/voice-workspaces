/**
 * Targeted sparks: one specific question per spark, written for THIS
 * conversation (the Prolific study's screen, `/api/realtime/spark-question`).
 *
 * WHY. A chip reading "Say it back in your own words" under every subject is
 * a label, not a question — the first local run ignored it (18 Oct 2026). The
 * rules in `signals.ts` still decide WHICH subject gets a spark and of what
 * kind; this writes the question itself, naming the measure, the option or
 * the claim it is about, and the agent then asks exactly that
 * (`SPARK_QUESTION_NUDGE`).
 *
 * Pure: the messages and the clean-up, so the route only calls the model.
 */

import type { ChatMessage } from "@voicemural/llm";
import type { SparkKind } from "./prompt";

/** What each kind asks for, to the model writing the question. */
const KIND_BRIEF: Record<SparkKind, string> = {
  say_back:
    "Most of what was said on this topic came from the assistant. Ask the person to explain, in their own words, ONE specific idea the assistant contributed — name it — for example why it would work or what it involves.",
  decide:
    "This topic is still open. Ask the person to choose between the concrete options that came up — name them — or to commit to one.",
  unsure:
    "The person hesitated on this topic. Ask what specifically makes them unsure about the concrete point they hesitated over — name it.",
  revisit:
    "The person left this topic a while ago. Ask them to come back to the specific point that was left open there — name it.",
};

const SYSTEM = `You write ONE short question that a voice assistant will ask a person, so that the person does the thinking about one topic of their conversation themselves.

Rules:
- About the specific content: name the measure, option, group or claim it is about. Never a generic question like "what do you think about this?".
- At most 18 words, in the second person, in the language of the conversation.
- It must not contain or hint at the answer, and must not praise or summarise.
- Output the question only: no quotes, no preamble, one line, ending in a question mark.`;

export interface SparkLine {
  who: "user" | "agent";
  text: string;
}

/** The last lines of a topic, as the model sees them: bounded, newest last. */
const MAX_LINES = 14;
const MAX_LINE_CHARS = 400;

export function sparkQuestionMessages(kind: SparkKind, title: string, lines: readonly SparkLine[]): ChatMessage[] {
  const transcript = lines
    .slice(-MAX_LINES)
    .map((l) => `${l.who === "agent" ? "Assistant" : "Person"}: ${l.text.slice(0, MAX_LINE_CHARS)}`)
    .join("\n");
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `${KIND_BRIEF[kind]}\n\nTopic: "${title}"\n\nWhat was said on it:\n${transcript || "(nothing transcribed yet)"}`,
    },
  ];
}

/** Longest question shown on a chip and sent to the container (`SPARK_QUESTION_MAX_CHARS` there). */
export const SPARK_QUESTION_MAX_CHARS = 200;

/**
 * The model's reply as a question, or null if it is not one: a single line,
 * unquoted, ending in "?", and short enough for a chip. Null means the chip
 * keeps the kind's generic label and the agent its generic question.
 */
export function cleanSparkQuestion(raw: string): string | null {
  const line = raw
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!line) return null;
  const text = line.replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").replace(/\s+/g, " ").trim();
  if (!text.endsWith("?") && !text.endsWith("？")) return null;
  if (text.length < 8 || text.length > SPARK_QUESTION_MAX_CHARS) return null;
  return text;
}
