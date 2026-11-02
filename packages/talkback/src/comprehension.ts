/**
 * The comprehension monitor (DRAFT, 2 Nov 2026): a second process beside the
 * conversation that asks, per topic, what the person has made their own and
 * what they are only holding because the assistant said it — and writes ONE
 * check that would make them rethink the shakiest part.
 *
 * WHERE IT COMES FROM. The sparks (`spark-question.ts`, `signals.ts` in the
 * web app) pick a subject by rules on word share, hesitation and settling and
 * ask a question of a fixed kind. This adds the judgement those rules cannot
 * make: which IDEAS on a topic are held, borrowed or shaky, read from what the
 * person actually said about them. The design follows the related-work notes
 * (`claude/related-work-comprehension.md` in the project):
 * - AI-originated ideas are the ones that slip (Zindulka et al. CHI '26), so
 *   an idea's origin is part of the answer, and the assistant's ideas the
 *   person never restated are the first candidates.
 * - Echo is not automatically shallow (Ward & Litman 2007): a restatement that
 *   adds nothing is "borrowed", one that adds a reason or a consequence is
 *   "held".
 * - Hesitation indexes expressed certainty AND load (Huckvale 2014), so the
 *   local signals reach the model as evidence to weigh, never as a verdict.
 * - Cognitive forcing works but is disliked (Buçinca et al. 2021), so the
 *   check is offered, pulled by the person, and asked by the agent, which
 *   never answers it: the four kinds below are forcing functions in miniature.
 *
 * Pure: the messages and the parser, so the route only calls the model.
 */

import type { ChatMessage } from "@voicemural/llm";

/**
 * How the check makes them think, each a known forcing move:
 * - explain: teach back one idea in their own words (self-explanation);
 * - predict: apply it to a concrete case before being told (generation);
 * - challenge: name the strongest reason it could be wrong (consider-the-opposite);
 * - commit: choose between the live options before the assistant recommends one.
 */
export const CHECK_KINDS = ["explain", "predict", "challenge", "commit"] as const;
export type CheckKind = (typeof CHECK_KINDS)[number];

export type IdeaHold = "held" | "borrowed" | "shaky";
export type IdeaOrigin = "you" | "assistant" | "both";

export interface ComprehensionIdea {
  /** The idea, at most 10 words, concrete. */
  text: string;
  origin: IdeaOrigin;
  hold: IdeaHold;
  /** Why it is judged so, in plain words, at most 12 words. */
  why: string;
}

export interface ComprehensionCheck {
  kind: CheckKind;
  /** The question the agent will ask, at most 22 words, ending in "?". */
  question: string;
  /** The idea it is about, as in `ideas`. */
  about: string | null;
}

export interface TopicComprehension {
  ordinal: number;
  ideas: ComprehensionIdea[];
  check: ComprehensionCheck | null;
}

/** What the monitor knows about a topic besides its lines, from the local signals. */
export interface ComprehensionEvidence {
  /** The assistant's share of the words, 0-1; null when too few. */
  agentShare: number | null;
  /** Against their own median for the drive. */
  hesitation: "low" | "mid" | "high" | null;
  settled: boolean | null;
  /** They said it back in their own words since the assistant last spoke on it. */
  restated: boolean;
}

export interface ComprehensionLine {
  who: "user" | "agent";
  text: string;
}

export const MAX_IDEAS = 4;
const MAX_LINES = 24;
const MAX_LINE_CHARS = 500;

const SYSTEM = `You watch a spoken conversation between a person and a voice assistant, about ONE topic, and judge what the PERSON has actually understood and made their own. You never talk to the person; another process will ask your question later, only if the person asks for it.

Return JSON only:
{"ideas": [{"text": "...", "origin": "you|assistant|both", "hold": "held|borrowed|shaky", "why": "..."}], "check": {"kind": "explain|predict|challenge|commit", "question": "...", "about": "..."}}

- "ideas": the concrete ideas, options or claims on this topic that matter for what the person will do, at most ${MAX_IDEAS}, each at most 10 words.
  - "origin": who first brought it up.
  - "hold": "held" when the person restated it ADDING something of their own — a reason, a consequence, a condition, a choice. "borrowed" when they only accepted or repeated it ("okay", "sounds good", the same words back), or never mentioned it after the assistant said it. "shaky" when they contradicted themselves, hedged, asked about it again, or got it wrong.
  - "why": the evidence, at most 12 words, pointing at what they said or did not say.
- "check": ONE question for the shakiest idea that matters, or null when everything is held. Prefer an idea from the assistant that is borrowed.
  - "explain": ask them to explain it in their own words, naming it.
  - "predict": ask what would happen in a concrete case the conversation implies.
  - "challenge": ask for the strongest reason it could be wrong or fail.
  - "commit": ask them to choose between the named options, before any recommendation.
  - At most 22 words, second person, ending with a question mark. Name the concrete thing. Never contain or hint at the answer, never praise, never summarise.
  - "about": the idea's text as in "ideas".
- The signals given with the topic are rough: hesitation can mean doubt or just being busy (driving, cooking). Weigh them; trust what was said over them.
- Only what was actually said. In the language of the conversation.`;

function evidenceLines(e: ComprehensionEvidence): string {
  const share =
    e.agentShare === null ? "too little talk to say" : `${Math.round(e.agentShare * 100)}% of the words were the assistant's`;
  return [
    `- Word share: ${share}.`,
    `- Hesitation, against their own usual: ${e.hesitation ?? "not known"}.`,
    `- They stated a decision or next step: ${e.settled === null ? "not judged yet" : e.settled ? "yes" : "no"}.`,
    `- Said it back in their own words since the assistant last spoke: ${e.restated ? "yes" : "no"}.`,
  ].join("\n");
}

export function comprehensionMessages(
  title: string,
  lines: readonly ComprehensionLine[],
  evidence: ComprehensionEvidence,
): ChatMessage[] {
  const transcript = lines
    .slice(-MAX_LINES)
    .map((l) => `${l.who === "agent" ? "Assistant" : "Person"}: ${l.text.slice(0, MAX_LINE_CHARS)}`)
    .join("\n");
  return [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: `Topic: "${title}"\n\nSignals from how they spoke:\n${evidenceLines(evidence)}\n\nWhat was said on it:\n${transcript || "(nothing transcribed yet)"}`,
    },
  ];
}

function clip(raw: unknown, words: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim().split(" ").slice(0, words).join(" ");
  return text || null;
}

function oneOf<T extends string>(raw: unknown, values: readonly T[]): T | null {
  return typeof raw === "string" && (values as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** The model's answer, or null when it is not one. Anything malformed in it is dropped, not repaired. */
export function parseComprehension(raw: string, ordinal: number): TopicComprehension | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let body: unknown;
  try {
    body = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  if (!body || typeof body !== "object") return null;
  const { ideas: rawIdeas, check: rawCheck } = body as { ideas?: unknown; check?: unknown };
  if (!Array.isArray(rawIdeas) && rawCheck === undefined) return null;

  const ideas: ComprehensionIdea[] = [];
  for (const item of Array.isArray(rawIdeas) ? rawIdeas : []) {
    if (!item || typeof item !== "object") continue;
    const i = item as Record<string, unknown>;
    const text = clip(i.text, 10);
    const origin = oneOf(i.origin, ["you", "assistant", "both"] as const);
    const hold = oneOf(i.hold, ["held", "borrowed", "shaky"] as const);
    if (!text || !origin || !hold) continue;
    ideas.push({ text, origin, hold, why: clip(i.why, 12) ?? "" });
    if (ideas.length === MAX_IDEAS) break;
  }

  let check: ComprehensionCheck | null = null;
  if (rawCheck && typeof rawCheck === "object") {
    const c = rawCheck as Record<string, unknown>;
    const kind = oneOf(c.kind, CHECK_KINDS);
    const question = cleanCheckQuestion(c.question);
    if (kind && question) check = { kind, question, about: clip(c.about, 10) };
  }
  return { ordinal, ideas, check };
}

/** One line, at most 22 words, ending in a question mark; null when it is not a question. */
export function cleanCheckQuestion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const line = raw.replace(/\s+/g, " ").trim().replace(/^["'„“]+|["'”]+$/g, "");
  const words = line.split(" ");
  if (!line.endsWith("?") || words.length > 22 || words.length < 3) return null;
  return line;
}
