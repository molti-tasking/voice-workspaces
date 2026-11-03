import type { ConversationMessage, Speaker } from "./conversation";

/**
 * The agent's turn on the Pipecat engine, kept to the pace of its voice
 * (3 Nov 2026).
 *
 * The container sends a reply's text as the model writes it (`AgentFeed` in
 * bot.py), seconds ahead of the voice: the screen showed the reply's last
 * sentence while the voice was still on its first. Pipecat also says each
 * word as it is spoken (`bot-tts-text`, timed by ElevenLabs), and that is
 * what this counts. The turn goes on screen with `voiced` at the last word
 * said — the field the realtime engine sets (`realtime/events.ts`), so the
 * views fade each word in as it is reached and need nothing new.
 *
 * - Nothing shows before the voice starts, as on the realtime engine.
 * - What is on screen is never taken back: when the voice stops between two
 *   sentences of a slow reply, all of it so far shows, and the words that
 *   come after are paced from there.
 * - Cut off, a turn keeps only what was said.
 * - Their next words bring out whatever of the turn is still held, whole: a
 *   reply whose voice never played still reaches the screen.
 *
 * Pure, so it is tested without a call.
 */

type TurnMessage = Extract<ConversationMessage, { type: Speaker }>;

/** The words in `text`, as the voice counts them: runs of non-space. */
export function wordCount(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

/** Where the `n`th word of `text` ends: all of it once `n` reaches its last. */
export function voicedAfterWords(text: string, n: number): number {
  if (n <= 0) return 0;
  let seen = 0;
  for (const match of text.matchAll(/\S+/g)) {
    seen += 1;
    if (seen === n) return (match.index ?? 0) + match[0].length;
  }
  return text.length;
}

export class VoicePace {
  private turn: TurnMessage | null = null;
  /** Words its voice has said. */
  private said = 0;
  /** Characters of it already on screen. */
  private shown = 0;

  /** A turn of the agent's from the container: what to put on screen, or null to hold it. */
  agent(message: TurnMessage): ConversationMessage | null {
    if (message.interrupted) {
      const same = this.turn?.id === message.id;
      const upTo = same ? Math.max(this.shown, voicedAfterWords(message.text, this.said)) : 0;
      this.reset();
      const text = message.text.slice(0, upTo).trimEnd();
      return text ? { ...message, text } : null;
    }
    if (this.turn?.id !== message.id) this.reset();
    this.turn = message;
    return this.paced();
  }

  /** A word its voice has just said. */
  word(text: string): ConversationMessage | null {
    if (!this.turn) return null;
    this.said += wordCount(text);
    return this.paced();
  }

  /** Its voice stopped: what it has of the turn is said. */
  stopped(): ConversationMessage | null {
    if (!this.turn || this.shown >= this.turn.text.length) return null;
    this.shown = this.turn.text.length;
    return this.turn;
  }

  /** They are talking: the turn before theirs, whole, if any of it is still held. */
  user(): ConversationMessage | null {
    const turn = this.turn;
    const held = turn !== null && this.shown < turn.text.length;
    this.reset();
    return held ? turn : null;
  }

  private paced(): ConversationMessage | null {
    const turn = this.turn!;
    const voiced = Math.max(this.shown, voicedAfterWords(turn.text, this.said));
    if (voiced === 0) return null;
    this.shown = voiced;
    return voiced >= turn.text.length ? turn : { ...turn, voiced };
  }

  private reset(): void {
    this.turn = null;
    this.said = 0;
    this.shown = 0;
  }
}
