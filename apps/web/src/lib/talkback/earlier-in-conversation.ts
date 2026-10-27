import { loadConversation } from "@voicemural/db/conversation";
import { renderContinued, renderLocalTime } from "@voicemural/talkback";

/**
 * What was said in the conversation a drive continues, rendered for the agent
 * (`renderContinued`). Read by `/api/realtime/context` on every turn for the
 * container, and once at the start by `/api/realtime/call` for the
 * speech-to-speech engine, which gets nothing per turn.
 */
export async function earlierInConversation(
  userId: string,
  continuesId: string,
  timeZone: string | null,
): Promise<string | null> {
  // Up to the drive it continues: never this drive's own lines, nor a later one's.
  const drives = await loadConversation(userId, continuesId, { forward: false });
  if (!drives || drives.length === 0) return null;
  const topics: string[] = [];
  for (const visit of drives.flatMap((d) => d.visits)) if (!topics.includes(visit.title)) topics.push(visit.title);
  const last = drives.at(-1)!;
  return renderContinued({
    topics,
    lines: drives.flatMap((d) => d.lines.map(({ who, text }) => ({ who, text }))),
    when: renderLocalTime(last.endedAt ?? last.startedAt, timeZone),
  });
}
