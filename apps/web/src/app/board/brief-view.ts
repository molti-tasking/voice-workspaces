import {
  KEPT_AFTER_SESSIONS,
  judge,
  type Board,
  type CardStep,
  type JudgedTransition,
} from "@voicemural/workspace";

/**
 * What the three board pages share.
 *
 * Pure and free of React, so the link shapes and the step wording are testable
 * — `brief-view.test.ts` — rather than asserted by reading a page. Nothing
 * from @voicemural/db may be imported here: these helpers are used from server
 * components, but a helper module is exactly how a database driver ends up in
 * a client bundle, and `next build` is the only check that catches it.
 */

/**
 * The verdict on each card's latest machine-made move, keyed by the block that
 * carried it.
 *
 * Was inline in `board/page.tsx`. Three pages now draw the marker line, and
 * `markerFor` reads `outcome` — so a second copy of this would mean a card
 * could say "kept" on one page and not on another.
 */
export function outcomesByBlock(board: Board): Map<string, JudgedTransition> {
  const outcomes = judge(board.transitions, {
    withinSessions: KEPT_AFTER_SESSIONS,
    sessions: board.sessions,
  });
  return new Map(outcomes.map((o) => [o.transition.blockId, o]));
}

/**
 * Carry the time-travel cursor across a link.
 *
 * A brief read "as of last Tuesday" that linked to today's board would be two
 * views of the ledger disagreeing on the same screen, so every link between
 * these pages keeps the parameter.
 */
export function withAsOf(path: string, asOf?: Date): string {
  if (!asOf) return path;
  return `${path}?asOf=${encodeURIComponent(asOf.toISOString())}`;
}

export function cardHref(cardId: string, asOf?: Date): string {
  return withAsOf(`/board/cards/${encodeURIComponent(cardId)}`, asOf);
}

/** A line in a drive's transcript. `UserLine` carries the matching anchor id. */
export function transcriptHref(sessionId: string, utteranceId?: string): string {
  const base = `/sessions/${encodeURIComponent(sessionId)}`;
  return utteranceId ? `${base}#u-${utteranceId}` : base;
}

/**
 * One step in a card's life, in the person's terms.
 *
 * Two axes, and both matter: what happened to the card, and who did it. A
 * participant reading their own board has to be able to tell a move they made
 * from one the extractor read into their speech — that difference is the
 * study's primary measure — so it is never left implicit.
 */
export function stepLabel(step: CardStep): string {
  const { transition } = step;
  let what: string;

  if (transition) {
    what =
      transition.from === null
        ? `added to ${transition.to}`
        : `${transition.from} → ${transition.to}`;
  } else {
    // A revise that did not move the card: either the wording changed or the
    // task simply came up again and the extractor re-stated it.
    what = step.previousText ? "reworded" : "mentioned again";
  }

  return `${what} · ${BY[step.via]}`;
}

const BY: Record<CardStep["via"], string> = {
  speech: "by speech",
  user: "by you",
  agent: "by the agent",
};

/**
 * A date as the board already writes one.
 *
 * On the server, always. Formatting a date in a client component runs it twice
 * — once during SSR, once in the browser — and the two disagree whenever their
 * timezones do, which is a hydration mismatch on a page whose whole job is to
 * be trusted. See the note on `CardView`.
 */
export function formatWhen(at: Date): string {
  return at.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
