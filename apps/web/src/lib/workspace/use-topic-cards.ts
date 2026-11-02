"use client";

import { useEffect, useState } from "react";
import type { TopicCards } from "@voicemural/workspace";

/**
 * The workspace cards behind a topic (`/api/workspace/topic-cards`), fetched
 * when a topic sheet opens and kept per title for the page's life, so opening
 * the same topic again is instant. A failed fetch is an empty answer: the
 * sheet still has the conversation's own points.
 */
const cache = new Map<string, TopicCards>();
const EMPTY: TopicCards = { topic: null, cards: [] };

export function useTopicCards(
  title: string | null,
  captureSessionId: string | null,
): { cards: TopicCards; loading: boolean } {
  const key = title ? `${captureSessionId ?? ""}|${title}` : null;
  const [state, setState] = useState<{ key: string | null; cards: TopicCards } | null>(null);
  const current = key === null ? EMPTY : state?.key === key ? state.cards : (cache.get(key) ?? null);

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
