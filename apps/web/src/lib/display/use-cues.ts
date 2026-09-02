"use client";

import { useEffect, useRef, useState } from "react";
import {
  DISPLAY_RULES,
  POLL_INTERVAL_MS,
  STREAM_ERRORS_BEFORE_POLLING,
  settle,
  type Density,
} from "./rules";

export interface Cue {
  id: string;
  text: string;
  /**
   * Present on a content cue: what the extractor made of it.
   *
   * Carried through rather than flattened, so the read view can type a block
   * the way `workspace/topic-card.tsx` types it — a question is not a claim,
   * and rendering both as grey text loses the distinction the extractor was
   * asked to make.
   */
  kind?: "claim" | "context" | "meta" | "question" | "fact";
  /** The left-hand column of a `fact`. Absent on every other kind. */
  label?: string;
  /** Present on a content cue: which topic it landed under. */
  topic?: string;
  /** Present on a direction cue: the operation, and whether it resolved. */
  verb?: string;
  resolved?: boolean;
  at: string;
}

interface CuePayload {
  displayAllowed: boolean;
  /** Decided server-side from the session's setting, so one value governs both. */
  density?: Density;
  content?: Cue[];
  directions?: Cue[];
  pending?: number;
}

export interface CueState {
  /** False when the setting has no screen. The panel renders nothing at all. */
  displayAllowed: boolean;
  /** How the panel should render, and how long an item must hold its slot. */
  density: Density;
  content: Cue[];
  directions: Cue[];
  /** Utterances still awaiting a verdict. Not shown as a cue; see rules.ts. */
  pending: number;
  /** True once the stream has given up and the browser is polling instead. */
  degraded: boolean;
}

const IDLE: CueState = {
  displayAllowed: false,
  density: "glance",
  content: [],
  directions: [],
  pending: 0,
  degraded: false,
};

/**
 * The secondary display's data.
 *
 * Two things happen here that the server cannot do for us.
 *
 * **Slot stability.** `settle` merges each payload into what is already on
 * screen without reordering it. The server sends a list; which of those the
 * user is already looking at, and where, is browser state.
 *
 * **Dwell.** A phone draining a dead-zone backlog commits several extractions
 * at once, and without a floor the whole panel would turn over in one frame —
 * the single moment a peripheral display must not demand attention. An arrival
 * inside the dwell window is held and applied when it expires.
 *
 * The transport degrades rather than fails: EventSource first, because it
 * reconnects itself after a tunnel, then plain polling if the stream will not
 * hold. Either way the source of truth is Postgres, so the panel keeps filling
 * with the voice container dead.
 */
export function useCues({
  captureSessionId,
  budgets,
  enabled,
}: {
  captureSessionId: string | null;
  budgets: { content: number; directions: number };
  enabled: boolean;
}): CueState {
  const [state, setState] = useState<CueState>(IDLE);

  const lastAppliedAt = useRef(0);
  const heldPayload = useRef<CuePayload | null>(null);

  // The budgets come from the setting profile, which cannot change while a
  // recording is running — so depending on them costs a reconnect only in the
  // case where reconnecting is right anyway.
  const contentBudget = budgets.content;
  const directionBudget = budgets.directions;

  const active = enabled && captureSessionId !== null;

  useEffect(() => {
    if (!active || !captureSessionId) return;

    let cancelled = false;
    let dwellTimer: ReturnType<typeof setTimeout> | undefined;

    const apply = (payload: CuePayload) => {
      if (cancelled) return;

      if (!payload.displayAllowed) {
        setState({ ...IDLE, displayAllowed: false });
        return;
      }

      // Scaled by density: a panel turning over at once is intolerable in the
      // corner of someone's eye and merely brisk in front of their face.
      const dwellMs = DISPLAY_RULES[payload.density ?? "glance"].dwellMs;

      const waited = Date.now() - lastAppliedAt.current;
      if (lastAppliedAt.current !== 0 && waited < dwellMs) {
        // Inside the dwell window. Hold the newest payload — not a queue of
        // them, because only the latest is worth showing when it releases.
        heldPayload.current = payload;
        clearTimeout(dwellTimer);
        dwellTimer = setTimeout(() => {
          const held = heldPayload.current;
          heldPayload.current = null;
          if (held) apply(held);
        }, dwellMs - waited);
        return;
      }

      lastAppliedAt.current = Date.now();

      // Functional form so the merge reads the state React actually holds. A
      // mirrored ref would be a second copy that can only ever be stale.
      setState((previous) => ({
        displayAllowed: true,
        density: payload.density ?? "glance",
        content: settle(previous.content, payload.content ?? [], contentBudget),
        directions: settle(previous.directions, payload.directions ?? [], directionBudget),
        pending: payload.pending ?? 0,
        degraded: previous.degraded,
      }));
    };

    const url = `/api/record/cues?session=${encodeURIComponent(captureSessionId)}`;

    /* The fallback. Not a retry loop over EventSource: a stream that has failed
     * twice is failing for a reason a third attempt will not fix, and a phone
     * mid-recording should not spend its radio finding that out repeatedly. */
    let pollTimer: ReturnType<typeof setInterval> | undefined;
    const startPolling = () => {
      if (cancelled || pollTimer) return;
      setState((s) => ({ ...s, degraded: true }));
      const poll = async () => {
        try {
          const res = await fetch(url, { headers: { Accept: "application/json" } });
          if (!res.ok) return;
          const type = res.headers.get("content-type") ?? "";
          if (!type.includes("application/json")) return;
          apply((await res.json()) as CuePayload);
        } catch {
          // Offline. The next tick tries again; nothing is lost, because the
          // server holds the state and this is only a view of it.
        }
      };
      pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
      void poll();
    };

    let errors = 0;
    let source: EventSource | undefined;

    try {
      source = new EventSource(url);
    } catch {
      startPolling();
    }

    if (source) {
      source.addEventListener("cues", (event) => {
        errors = 0;
        try {
          apply(JSON.parse((event as MessageEvent<string>).data) as CuePayload);
        } catch {
          // A malformed frame is not worth tearing the stream down for.
        }
      });

      source.addEventListener("done", () => {
        source?.close();
      });

      source.onerror = () => {
        errors += 1;
        if (errors >= STREAM_ERRORS_BEFORE_POLLING) {
          source?.close();
          startPolling();
        }
      };
    }

    return () => {
      cancelled = true;
      clearTimeout(dwellTimer);
      clearInterval(pollTimer);
      source?.close();
      heldPayload.current = null;
      lastAppliedAt.current = 0;
    };
  }, [captureSessionId, active, contentBudget, directionBudget]);

  // Derived, not stored: a disabled hook has nothing to show, and computing
  // that here rather than writing IDLE into state from an effect avoids a
  // render whose only purpose is to undo the previous one.
  return active ? state : IDLE;
}
