/**
 * An LLM as the judge of what the checks cannot see.
 *
 * Whether a reply was the one thing worth saying, whether a silence was the
 * right call, whether an answer was grounded in the transcript it was given —
 * none of that is a regex. A second model reading the whole turn can score it,
 * and the same rubric can run inside Langfuse as a managed evaluator over LIVE
 * turns (see TALKBACK.md, "Evaluating the prompt"), so the rubric text is kept
 * here as the one copy and pasted there.
 *
 * The judge sees exactly what the model saw plus the reply. It is asked for
 * scores on four axes and a one-line reason, as JSON, so a run can be
 * summarised and a regression pinned to an axis.
 *
 * What it cannot judge: timing. A live turn's quality depends on WHEN it
 * arrived — 400ms after a landed thought or three seconds into the next one —
 * and neither the transcript nor Langfuse carries that. Latency columns on
 * `agent_turn` are the record of it; this judge reads text.
 */

import { chat, type ChatMessage } from "@voicemural/llm";

export const JUDGE_PROMPT = `You are judging one turn of a voice companion that rides along while someone thinks aloud — usually while driving. You will see the companion's instructions, the conversation so far, any background it was given, what was just said, and what the companion replied. "<silence>" means it chose to say nothing.

Score each axis from 1 (bad) to 5 (good):

turn_decision — Was speaking or staying silent the right call? Speaking over a thought that was still forming, or ignoring a question, is a 1. Silence on a genuine question is a 1. Answering a loose "right?" or reacting once to a clearly landed thought is a 5.
brevity — Is it as short as the setting demands, with no preamble, sign-off or restatement? A hedge or a filler word costs a point. Silence scores 5.
grounding — Does it use only what was said and what was given? Inventing a name, number, date or decision that is not in the transcript is a 1. Saying plainly that the transcript does not contain it is a 5. A garbled transcript restated as fact is a 1. Silence scores 5.
register — Does it sound like a thinking companion rather than an assistant? Committing to a view when asked, addressing the right person when several are talking, and never referring to a screen a driver cannot see, all score high.

Reply with ONLY a JSON object of this shape, nothing else:
{"turn_decision": 1-5, "brevity": 1-5, "grounding": 1-5, "register": 1-5, "verdict": "pass" | "fail", "reason": "one sentence"}

"verdict" is "fail" if any axis is 2 or below.`;

export interface Judgement {
  turn_decision: number;
  brevity: number;
  grounding: number;
  register: number;
  verdict: "pass" | "fail";
  reason: string;
}

export const JUDGE_AXES = ["turn_decision", "brevity", "grounding", "register"] as const;

/** Tolerant of a fenced or prefixed JSON object. Throws when there is none. */
export function parseJudgement(raw: string): Judgement {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end < start) throw new Error(`judge returned no JSON: ${raw.slice(0, 120)}`);
  const parsed = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>;
  const score = (key: string): number => {
    const value = Number(parsed[key]);
    if (!Number.isInteger(value) || value < 1 || value > 5) {
      throw new Error(`judge score ${key} out of range: ${String(parsed[key])}`);
    }
    return value;
  };
  const judgement: Judgement = {
    turn_decision: score("turn_decision"),
    brevity: score("brevity"),
    grounding: score("grounding"),
    register: score("register"),
    verdict: parsed.verdict === "fail" ? "fail" : "pass",
    reason: typeof parsed.reason === "string" ? parsed.reason : "",
  };
  // The verdict rule is the rubric's, restated so a judge that forgets it is
  // still summarised consistently.
  if (JUDGE_AXES.some((axis) => judgement[axis] <= 2)) judgement.verdict = "fail";
  return judgement;
}

/** Everything the judge is shown, as one document. */
export function renderTurnForJudge(messages: ChatMessage[], reply: string, about: string): string {
  const [system, ...rest] = messages;
  const lines: string[] = [];
  lines.push("=== COMPANION'S INSTRUCTIONS ===", system?.content ?? "", "");
  lines.push("=== CONVERSATION (oldest first; system lines are background the companion was given) ===");
  for (const m of rest) lines.push(`${m.role.toUpperCase()}: ${m.content}`);
  lines.push("", "=== THE COMPANION REPLIED ===", reply || "(empty)", "");
  lines.push("=== WHAT THIS CASE IS CHECKING ===", about);
  return lines.join("\n");
}

export interface JudgeCall {
  judgement: Judgement;
  /** What was asked and answered, for the trace. */
  input: ChatMessage[];
  output: string;
  model: string;
  latencyMs: number;
  usage: { input: number; output: number };
}

export async function judgeTurn(
  messages: ChatMessage[],
  reply: string,
  about: string,
  metadata?: Record<string, unknown>,
): Promise<JudgeCall> {
  const input: ChatMessage[] = [
    { role: "system", content: JUDGE_PROMPT },
    { role: "user", content: renderTurnForJudge(messages, reply, about) },
  ];
  const result = await chat(input, {
    role: "reasoning",
    json: true,
    temperature: null,
    maxTokens: 300,
    metadata,
  });
  return {
    judgement: parseJudgement(result.content),
    input,
    output: result.content,
    model: result.resolvedModel,
    latencyMs: result.latencyMs,
    usage: { input: result.usage.promptTokens, output: result.usage.completionTokens },
  };
}
