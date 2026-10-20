import { keepRequest, type KeepRequest } from "@voicemural/shared";
import type { Conversation } from "./conversation";

/**
 * Hearing "keep this one" in the drive's own turns, with the phone untouched.
 *
 * The recorder already receives every turn of theirs, filed by subject
 * (`conversation.ts`), so keeping by voice needs nothing from the container:
 * a turn that is, all of it, a keep command (`keepRequest`) keeps the subject
 * it was said under.
 *
 * ONLY ONCE THE TURN HAS SETTLED. A turn arrives as it is transcribed, and
 * "keep this" may still become "keep this simple, though". So a turn is acted
 * on when it is no longer the newest line of the drive, or when it has not
 * changed for `KEEP_SETTLE_MS` — whichever comes first. And once only: a turn
 * that has been acted on is never acted on again, even if it is edited.
 *
 * A turn said before anything was named has no subject to keep yet; it waits
 * until the first title gives its section an ordinal.
 */

/** How long a keep command must stand unchanged before it counts. */
export const KEEP_SETTLE_MS = 1500;

export interface KeepAction {
  ordinal: number;
  request: KeepRequest;
  /** The turn that asked, so it is never acted on twice. */
  turnId: string;
}

export interface KeepWatcher {
  /** What the drive's turns ask for now. Call on every change, and on a clock. */
  observe(conversation: Conversation, now: number): KeepAction[];
}

export function createKeepWatcher(settleMs = KEEP_SETTLE_MS): KeepWatcher {
  const handled = new Set<string>();
  /** A keep command not yet settled: its text, and since when it has read so. */
  const pending = new Map<string, { text: string; since: number }>();

  return {
    observe(conversation, now) {
      const current = conversation.sections.find((s) => s.key === conversation.current);
      const newest = current?.turns.at(-1)?.id ?? null;
      const actions: KeepAction[] = [];

      for (const section of conversation.sections) {
        for (const turn of section.turns) {
          if (turn.who !== "user" || handled.has(turn.id)) continue;
          const request = keepRequest(turn.text);
          if (!request) {
            pending.delete(turn.id);
            continue;
          }
          const seen = pending.get(turn.id);
          if (!seen || seen.text !== turn.text) {
            pending.set(turn.id, { text: turn.text, since: now });
          }
          const since = pending.get(turn.id)!.since;
          const settled = turn.id !== newest || now - since >= settleMs;
          if (!settled || section.ordinal === undefined) continue;
          handled.add(turn.id);
          pending.delete(turn.id);
          actions.push({ ordinal: section.ordinal, request, turnId: turn.id });
        }
      }
      return actions;
    },
  };
}
