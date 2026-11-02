"use client";

import { useEffect, useRef, useState } from "react";
import type { TopicComprehension } from "@voicemural/talkback/comprehension";
import { monitorRequest, seenNow, topicsDue, type MonitorSeen } from "./comprehension-monitor";
import type { Conversation } from "./conversation";

/**
 * The comprehension monitor running beside a conversation (DRAFT): one topic
 * at a time, in the background, via `/api/realtime/comprehension`, by the
 * rules in `comprehension-monitor.ts`. Live, it watches every topic; for a
 * conversation read back, only the one zoomed into (`focus`), so opening an
 * old conversation does not spend a model call per topic.
 *
 * Returns what it has found, by ordinal. Failures leave a topic as it was.
 */
export function useComprehension(
  conversation: Conversation,
  captureSessionId: string | null,
  { live, focus, enabled }: { live: boolean; focus: number | null; enabled: boolean },
): ReadonlyMap<number, TopicComprehension> {
  const [found, setFound] = useState<ReadonlyMap<number, TopicComprehension>>(() => new Map());
  const seen = useRef(new Map<number, MonitorSeen>());
  const busy = useRef(false);
  // A look that lands after the view closed is dropped, not aborted: the
  // effect re-runs on every new line, and aborting there would cancel each
  // look the moment the next word came in.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || !captureSessionId || busy.current) return;
    const due = topicsDue(conversation, seen.current).filter((s) => live || s.ordinal === focus);
    const next = due[0];
    if (!next) return;
    const body = monitorRequest(conversation, next, Date.now());
    if (!body) return;
    busy.current = true;
    seen.current.set(body.ordinal, seenNow(conversation, next));
    void fetch("/api/realtime/comprehension", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ captureSessionId, ...body }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ comprehension: TopicComprehension | null }>) : null))
      .catch(() => null)
      .then((result) => {
        busy.current = false;
        if (!mounted.current) return;
        const c = result?.comprehension;
        if (c) setFound((prev) => new Map(prev).set(c.ordinal, c));
        // Nudge the effect so the next due topic is looked at.
        else setFound((prev) => new Map(prev));
      });
  }, [conversation, captureSessionId, live, focus, enabled, found]);

  return found;
}
