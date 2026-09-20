"use client";

import { useEffect, useRef } from "react";

/**
 * Records that the board, or one card, was OPENED. Nothing else.
 *
 * WHY. Days 2–6 of the study are the deployment: the person uses the thing,
 * and the protocol says log counts only — opens, new dictations, edits.
 * Dictations and edits already leave `workspace_op` rows. Opening does not,
 * and it is the behaviour the offloading question turns on: a card somebody
 * re-read every morning and never edited is indistinguishable, in the ledger,
 * from one nobody ever saw again, and "never revisited" is half the definition
 * of a lost item.
 *
 * A kind, a card id and a timestamp. No path, no referrer, no dwell time, no
 * text — so the whole table crosses the privacy boundary untouched.
 *
 * ONCE PER MOUNT, and fire-and-forget. A failed beacon costs one row; blocking
 * or retrying would cost somebody reading their own board. The ref guards
 * React's double-invoked effects in development, which would otherwise double
 * every count in the researcher's own testing.
 */
export function StudyOpen({ kind, cardId }: { kind: "board_open" | "card_open"; cardId?: string }) {
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    void fetch("/api/study/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, cardId: cardId ?? null }),
      keepalive: true,
    }).catch(() => undefined);
  }, [kind, cardId]);

  return null;
}
