"use client";

import { useEffect, useState } from "react";
import type { TopicCards } from "@voicemural/workspace";

/**
 * The workspace cards behind a topic (`/api/workspace/topic-cards`), fetched
 * when a topic sheet opens and kept per title, so opening the same topic again
 * is instant. A failed fetch is an empty answer: the sheet still has the
 * conversation's own points.
 *
 * KEPT CURRENT WHILE A SHEET IS OPEN. The sheet is where a topic's tasks are
 * on screen since the Stack (2 Nov 2026), and the agent changes tasks by voice
 * ("Dropped the asymmetry argument") — told by its prompt that the change
 * shows by itself within seconds. With a cache that lived as long as the page,
 * it did not: the sheet kept the task until a reload. So while a sheet is
 * open it listens to the op log's fingerprint (`/api/board/stream`, the same
 * one `OpLogLive` redraws the workspace from), and when that moves, every
 * cached topic is stale and the open one is fetched again.
 */
const cache = new Map<string, TopicCards>();
const EMPTY: TopicCards = { topic: null, cards: [] };

/**
 * How many times the op log has moved since this page first heard it. The
 * first version the stream sends is the baseline, not a change: it is the log
 * the sheet was (or is about to be) fetched from.
 */
function useOpLogGeneration(active: boolean): number {
  const [generation, setGeneration] = useState(0);
  useEffect(() => {
    if (!active || typeof EventSource === "undefined") return;
    let baseline: string | null = null;
    let source: EventSource;
    try {
      source = new EventSource("/api/board/stream");
    } catch {
      // No stream: the sheet shows what it fetched, as it did before.
      return;
    }
    source.addEventListener("version", (event) => {
      try {
        const { version } = JSON.parse((event as MessageEvent<string>).data) as { version: string };
        if (baseline === null) baseline = version;
        else if (version !== baseline) {
          baseline = version;
          cache.clear();
          setGeneration((g) => g + 1);
        }
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    });
    return () => source.close();
  }, [active]);
  return generation;
}

export function useTopicCards(
  title: string | null,
  captureSessionId: string | null,
): { cards: TopicCards; loading: boolean } {
  const generation = useOpLogGeneration(title !== null);
  const key = title ? `${generation}|${captureSessionId ?? ""}|${title}` : null;
  const [state, setState] = useState<{ key: string | null; cards: TopicCards } | null>(null);
  const fresh = key === null ? EMPTY : state?.key === key ? state.cards : (cache.get(key) ?? null);
  // A refetch after the log moved keeps showing what was there until the new
  // answer lands, rather than flashing the sheet empty under their eyes.
  const current = fresh ?? (state?.key?.endsWith(`|${captureSessionId ?? ""}|${title}`) ? state.cards : null);

  useEffect(() => {
    if (!key || !title || cache.has(key)) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ title, ...(captureSessionId ? { captureSessionId } : {}) });
    fetch(`/api/workspace/topic-cards?${params}`, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<TopicCards>) : EMPTY))
      .catch(() => EMPTY)
      .then((cards) => {
        if (controller.signal.aborted) return;
        cache.set(key, cards);
        setState({ key, cards });
      });
    return () => controller.abort();
  }, [key, title, captureSessionId]);

  return { cards: current ?? EMPTY, loading: key !== null && current === null };
}
