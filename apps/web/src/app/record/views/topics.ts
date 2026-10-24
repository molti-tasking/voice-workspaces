// The `/digest` subpath, not the package index: the index pulls in server code.
import type { ConversationDigest, DigestIdea, DigestQuestion } from "@voicemural/talkback/digest";
import type { Conversation, Turn } from "@/lib/talkback/conversation";

/**
 * What the topic views draw, as data: one entry per topic, in the order the
 * topics first came up, with what the conversation knows of it (current,
 * settled, kept, its turns) and what the digest wrote (points and ideas).
 * Pure, so the views and their tests read the same thing.
 */

export interface TopicEntry {
  key: string;
  ordinal: number | null;
  title: string;
  /** Being talked about at this point. */
  current: boolean;
  /** They landed on something, as the container judged it. */
  settled: boolean;
  kept: boolean;
  turns: Turn[];
  you: string[];
  ai: string[];
  ideas: DigestIdea[];
}

export function topicEntries(conversation: Conversation, digest: ConversationDigest): TopicEntry[] {
  const written = new Map(digest.topics.map((t) => [t.ordinal, t]));
  return conversation.sections.flatMap((section) => {
    if (!section.title) return [];
    const topic = section.ordinal !== undefined ? written.get(section.ordinal) : undefined;
    return [
      {
        key: section.key,
        ordinal: section.ordinal ?? null,
        title: section.title,
        current: section.key === conversation.current,
        settled: section.settled === true,
        kept: section.kept !== undefined,
        turns: section.turns,
        you: topic?.you ?? [],
        ai: topic?.ai ?? [],
        ideas: topic?.ideas ?? [],
      },
    ];
  });
}

/** The digest's questions, open first, each with its topic's title where it has one. */
export function questionEntries(
  conversation: Conversation,
  digest: ConversationDigest,
): (DigestQuestion & { title: string | null })[] {
  const titleOf = new Map(conversation.sections.map((s) => [s.ordinal, s.title]));
  const withTitle = digest.open.map((q) => ({ ...q, title: q.ordinal !== null ? (titleOf.get(q.ordinal) ?? null) : null }));
  return [...withTitle.filter((q) => !q.settled), ...withTitle.filter((q) => q.settled)];
}
