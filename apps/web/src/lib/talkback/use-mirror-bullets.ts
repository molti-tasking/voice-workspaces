"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// A type only: the package index pulls in server code, which must not reach
// the browser bundle, and a type import is erased.
import type { MirrorBullets } from "@voicemural/talkback";
import type { Conversation } from "./conversation";
import { topicDigest } from "./mirror";

/**
 * Each topic's bullets for the mirror, from `/api/realtime/mirror`.
 *
 * Asked for once what was said on a topic has stood still for
 * `MIRROR_SETTLE_MS` — a turn still being transcribed changes every few
 * hundred milliseconds — and again only when it changes. A topic keeps the
 * points it had while new ones are written, and when writing them fails.
 * Keyed by the drive from outside (the mirror is remounted per drive), so
 * nothing here outlives one.
 */

export const MIRROR_SETTLE_MS = 2500;

export interface TopicBullets {
  bullets: MirrorBullets | null;
  /** New points are being written. */
  pending: boolean;
}

export function useMirrorBullets(
  conversation: Conversation,
  captureSessionId: string | null,
): Map<string, TopicBullets> {
  const [written, setWritten] = useState<Map<string, MirrorBullets>>(() => new Map());
  const [writing, setWriting] = useState<Set<string>>(() => new Set());
  /** The signature each topic was last asked for with. */
  const asked = useRef(new Map<string, string>());
  /** The latest request per topic: an older answer arriving late is dropped. */
  const latest = useRef(new Map<string, number>());
  const timers = useRef(new Map<string, number>());

  useEffect(() => {
    if (!captureSessionId) return;
    for (const section of conversation.sections) {
      const title = section.title;
      if (!title) continue;
      const { signature, lines } = topicDigest(section);
      if (lines.length === 0 || asked.current.get(section.key) === signature) continue;
      const key = section.key;
      const waiting = timers.current.get(key);
      if (waiting) window.clearTimeout(waiting);
      timers.current.set(
        key,
        window.setTimeout(() => {
          timers.current.delete(key);
          asked.current.set(key, signature);
          const request = (latest.current.get(key) ?? 0) + 1;
          latest.current.set(key, request);
          setWriting((prev) => new Set(prev).add(key));
          void fetch("/api/realtime/mirror", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ captureSessionId, title, lines }),
          })
            .then((res) => (res.ok ? (res.json() as Promise<{ bullets?: MirrorBullets | null }>) : null))
            .then((body) => {
              if (latest.current.get(key) !== request) return;
              if (body?.bullets) {
                const bullets = body.bullets;
                setWritten((prev) => new Map(prev).set(key, bullets));
              }
            })
            .catch(() => {
              // Asked again on the topic's next change.
              asked.current.delete(key);
            })
            .finally(() => {
              if (latest.current.get(key) !== request) return;
              setWriting((prev) => {
                const next = new Set(prev);
                next.delete(key);
                return next;
              });
            });
        }, MIRROR_SETTLE_MS),
      );
    }
  }, [conversation, captureSessionId]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer);
    };
  }, []);

  return useMemo(() => {
    const out = new Map<string, TopicBullets>();
    for (const key of new Set([...written.keys(), ...writing])) {
      out.set(key, { bullets: written.get(key) ?? null, pending: writing.has(key) });
    }
    return out;
  }, [written, writing]);
}
