// The `/comprehension` subpath, not the package index: the index pulls in server code.
import type {
  CheckKind,
  ComprehensionEvidence,
  ComprehensionLine,
  TopicComprehension,
} from "@voicemural/talkback/comprehension";
import type { Conversation, Section } from "./conversation";
import { driveContext, signalsFor } from "./signals";
import type { SparkKind } from "./signals";

/**
 * When the comprehension monitor (DRAFT, `comprehension.ts` in
 * @voicemural/talkback) looks at a topic, and what it sends: pure, so the
 * hook only fetches and the rules are tested.
 *
 * A BACKGROUND PROCESS, NOT A VOICE. It runs beside the conversation and
 * writes only to the screen: a mark on the topic and a check in its sheet.
 * Nothing it finds is ever spoken unless the person pulls the check, and
 * then it rides the poke the sparks already use, so the agent asks it and
 * does not answer it.
 *
 * WHEN. A topic is looked at once it has had real talk (`MIN_WORDS`), again
 * when it is left with new lines since the last look, and while it is still
 * current only after it has grown by `GROWTH_WORDS` — a judgement on a topic
 * mid-sentence is mostly noise, and every look is a model call.
 */

const MIN_WORDS = 60;
const GROWTH_WORDS = 120;
/** The last lines of a topic the model reads. */
const MAX_LINES = 24;

export interface MonitorSeen {
  /** Its words when it was last looked at. */
  words: number;
  /** Whether it was current then. */
  current: boolean;
}

function wordsIn(section: Section): number {
  return section.turns.reduce((n, t) => n + (t.text.trim() ? t.text.trim().split(/\s+/).length : 0), 0);
}

/** The topics to look at now, the one just left first. */
export function topicsDue(conversation: Conversation, seen: ReadonlyMap<number, MonitorSeen>): Section[] {
  const due: Section[] = [];
  for (const section of conversation.sections) {
    if (section.ordinal === undefined || !section.title) continue;
    const words = wordsIn(section);
    if (words < MIN_WORDS) continue;
    const current = section.key === conversation.current;
    const last = seen.get(section.ordinal);
    if (!last) {
      due.push(section);
      continue;
    }
    const grown = words - last.words;
    if (grown <= 0) continue;
    if (!current || grown >= GROWTH_WORDS) due.push(section);
  }
  // The topic just left, then the others in order, then the current one.
  return due.sort((a, b) => Number(a.key === conversation.current) - Number(b.key === conversation.current));
}

export function seenNow(conversation: Conversation, section: Section): MonitorSeen {
  return { words: wordsIn(section), current: section.key === conversation.current };
}

/** What the route is sent for one topic. */
export function monitorRequest(
  conversation: Conversation,
  section: Section,
  now: number,
): { ordinal: number; title: string; lines: ComprehensionLine[]; evidence: ComprehensionEvidence } | null {
  if (section.ordinal === undefined || !section.title) return null;
  const signal = signalsFor(section, driveContext(conversation, now));
  const lines = section.turns
    .filter((t) => t.text.trim())
    .slice(-MAX_LINES)
    .map((t) => ({ who: t.who, text: t.text.slice(0, 2000) }));
  if (lines.length === 0) return null;
  return {
    ordinal: section.ordinal,
    title: section.title,
    lines,
    evidence: {
      agentShare: signal.agentShare,
      hesitation: signal.hesitation,
      settled: signal.settled,
      restated: signal.restated,
    },
  };
}

/**
 * The spark kind a check travels as. The container and the stored decision
 * know only the four spark kinds; the check's own question is what the agent
 * asks, so the kind is only the nearest label for the record.
 */
export const CHECK_AS_SPARK: Record<CheckKind, SparkKind> = {
  explain: "say_back",
  predict: "say_back",
  challenge: "unsure",
  commit: "decide",
};

/** How a check's kind reads on the screen. */
export const CHECK_LABELS: Record<CheckKind, string> = {
  explain: "Explain it back",
  predict: "Predict it",
  challenge: "Argue against it",
  commit: "Commit first",
};

/** Whether a topic has something for the person to rethink: a check, or an idea not yet theirs. */
export function needsRethink(c: TopicComprehension | undefined): boolean {
  return c !== undefined && (c.check !== null || c.ideas.some((i) => i.hold !== "held"));
}
