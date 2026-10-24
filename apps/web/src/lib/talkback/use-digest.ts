"use client";

import { useEffect, useMemo, useRef, useState } from "react";
// The `/digest` subpath, not the package index: the index pulls in server code.
import { EMPTY_DIGEST, type ConversationDigest, type DigestLine, type DigestTopicInput } from "@voicemural/talkback/digest";
import type { Conversation } from "./conversation";
import { lastSeq, turnsInOrder } from "./cursor";

/**
 * The digest the views read (`digest.ts` in @voicemural/talkback), for the
 * conversation as it stands at the cursor — live, or scrolled back in time.
 *
 * ASKED FOR ONCE IT STANDS STILL. A turn being transcribed changes every few
 * hundred milliseconds, and a drag along the time bar passes dozens of
 * cursors; the digest is asked for once the conversation has not changed for
 * `DIGEST_SETTLE_MS`, and again only when it does.
 *
 * NEVER FROM THE FUTURE. Each digest is kept with how far into the
 * conversation it was written. Until the one for this point arrives, the
 * screen shows the latest one written no later than this point — never one
 * that knows what was decided afterwards, which scrolling back would
 * otherwise show as already settled.
 *
 * `fixed` replaces the route for a conversation with no AI behind it (the
 * simulated one): a digest worked out from the conversation itself.
 */

export const DIGEST_SETTLE_MS = 2500;

export interface DigestState {
  digest: ConversationDigest;
  /** A digest for this point is being written. */
  pending: boolean;
}

/** What the digest is written from, and a signature that changes whenever any of it does. */
export function digestInput(conversation: Conversation): {
  signature: string;
  topics: DigestTopicInput[];
  lines: DigestLine[];
  upTo: number;
} {
  const ordinalOf = new Map<number, number | null>();
  for (const section of conversation.sections) {
    for (const turn of section.turns) ordinalOf.set(turn.seq, section.ordinal ?? null);
  }
  const topics = conversation.sections.flatMap((s) =>
    s.title !== null && s.ordinal !== undefined ? [{ ordinal: s.ordinal, title: s.title }] : [],
  );
  const lines = turnsInOrder(conversation)
    .filter((t) => t.text.trim().length > 0)
    .map((t) => ({ who: t.who, text: t.text, ordinal: ordinalOf.get(t.seq) ?? null }));
  const signature = [
    topics.map((t) => `${t.ordinal}:${t.title}`).join("|"),
    turnsInOrder(conversation)
      .map((t) => `${t.seq}:${t.text.length}`)
      .join(","),
  ].join("#");
  return { signature, topics, lines, upTo: lastSeq(conversation) ?? -1 };
}

interface Written {
  upTo: number;
  digest: ConversationDigest;
}

export function useDigest(
  conversation: Conversation,
  {
    captureSessionId,
    fixed,
  }: {
    /** The drive the digest is written for; null asks for nothing. */
    captureSessionId: string | null;
    fixed?: (conversation: Conversation) => ConversationDigest;
  },
): DigestState {
  const input = useMemo(() => digestInput(conversation), [conversation]);
  const [written, setWritten] = useState<ReadonlyMap<string, Written>>(() => new Map());
  const [writing, setWriting] = useState<string | null>(null);
  /** Signatures already asked for, so each is asked once. */
  const asked = useRef(new Set<string>());

  useEffect(() => {
    if (fixed || !captureSessionId || input.lines.length === 0) return;
    if (asked.current.has(input.signature)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      asked.current.add(input.signature);
      setWriting(input.signature);
      void fetch("/api/realtime/digest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ captureSessionId, topics: input.topics, lines: input.lines }),
      })
        .then((res) => (res.ok ? (res.json() as Promise<{ digest?: ConversationDigest | null }>) : null))
        .then((body) => {
          const digest = body?.digest;
          if (digest) setWritten((prev) => new Map(prev).set(input.signature, { upTo: input.upTo, digest }));
          // Not written: asked again the next time this point is reached.
          else asked.current.delete(input.signature);
        })
        .catch(() => asked.current.delete(input.signature))
        .finally(() => {
          if (!cancelled) setWriting((was) => (was === input.signature ? null : was));
        });
    }, DIGEST_SETTLE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [input, captureSessionId, fixed]);

  return useMemo(() => {
    if (fixed) return { digest: fixed(conversation), pending: false };
    const exact = written.get(input.signature);
    if (exact) return { digest: exact.digest, pending: false };
    let best: Written | null = null;
    for (const entry of written.values()) {
      if (entry.upTo <= input.upTo && (!best || entry.upTo > best.upTo)) best = entry;
    }
    // Waiting to settle, or being written: either way, this point's digest is on its way.
    return {
      digest: best?.digest ?? EMPTY_DIGEST,
      pending: input.lines.length > 0 && (writing === input.signature || captureSessionId !== null),
    };
  }, [fixed, conversation, written, writing, input, captureSessionId]);
}
