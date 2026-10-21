import type { Conversation, Turn } from "./conversation";

/**
 * Every turn of the drive in the order it was said, whatever topic it was
 * filed under: the transcript control of the display study
 * (`conversation-transcript.tsx`), which shows a voice conversation the way a
 * voice assistant's chat does — line after line, nothing else.
 */
export function transcriptLines(conversation: Conversation): Turn[] {
  return conversation.sections.flatMap((section) => section.turns).sort((a, b) => a.seq - b.seq);
}
