import type { Conversation, Section, Speaker } from "./conversation";
import type { Spark, SubjectSignal } from "./signals";

/**
 * The conversation mirror, as data: one entry per topic, in the order the
 * topics first came up, with the four things a glance reads
 * (`conversation-mirror.tsx`):
 *
 * - SIDE — whose topic it is: the person's, or the agent's when most of its
 *   words are the agent's (the same word share the sparks read).
 * - ACTIVE — the topic being talked about now.
 * - FADED — left a while ago (`fade` in signals.ts).
 * - SPARK — a spark on offer on it.
 *
 * Pure, so the screen and its tests read the same thing. The order never
 * changes once a topic is there: a glance finds a topic where it was.
 */

/** A topic counts as faded from this `fade` on (signals.ts, 0–1). */
export const FADED_AT = 0.5;

export interface MirrorTopic {
  key: string;
  ordinal: number | null;
  title: string;
  side: Speaker;
  active: boolean;
  faded: boolean;
  spark: Spark | null;
}

function sideOf(signal: SubjectSignal | undefined): Speaker {
  if (!signal) return "user";
  if (signal.agentShare !== null) return signal.agentShare > 0.5 ? "agent" : "user";
  return signal.agentWords > signal.userWords ? "agent" : "user";
}

export function mirrorTopics(
  conversation: Conversation,
  signals: readonly SubjectSignal[],
  offered: readonly Spark[],
): MirrorTopic[] {
  const byKey = new Map(signals.map((s) => [s.key, s]));
  return conversation.sections.flatMap((section) => {
    if (!section.title) return [];
    const signal = byKey.get(section.key);
    const active = section.key === conversation.current;
    return [
      {
        key: section.key,
        ordinal: section.ordinal ?? null,
        title: section.title,
        side: sideOf(signal),
        active,
        faded: !active && (signal?.fade ?? 0) >= FADED_AT,
        spark: offered.find((spark) => spark.key === section.key) ?? null,
      },
    ];
  });
}

/**
 * What a topic's bullets are written from, and a signature that changes
 * whenever any of it does — a turn added, or one still being transcribed
 * growing — so the bullets are asked for again only when there is something
 * new to say.
 */
export function topicDigest(section: Section): {
  signature: string;
  lines: { who: Speaker; text: string }[];
} {
  const turns = section.turns.filter((t) => t.text.trim().length > 0);
  return {
    signature: `${section.title ?? ""}|${turns.map((t) => `${t.id}:${t.text.length}`).join(",")}`,
    lines: turns.map((t) => ({ who: t.who, text: t.text })),
  };
}
