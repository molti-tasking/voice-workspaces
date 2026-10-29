"use client";

import { useEffect, useRef, useState } from "react";
// The `/digest` subpath, not the package index: the index pulls in server code.
import type { DigestGist } from "@voicemural/talkback/digest";
import type { Conversation } from "./conversation";
import { turnsInOrder } from "./cursor";

/**
 * The gist of the turn just answered, asked for the moment the next turn
 * begins (`/api/realtime/gist`), so the Stack view's line above the answer is
 * the turn's key point or question while the answer is still being said —
 * not its first words cut off. The conversation digest writes gists too, but
 * only once the conversation stands still, seconds into the answer; the views
 * keep whichever comes first (`settleGists`).
 *
 * Live only, once per turn, and never for a turn still being said. Null
 * `captureSessionId` asks for nothing.
 */
export function useTurnGists(conversation: Conversation, captureSessionId: string | null): DigestGist[] {
  const [bySession, setBySession] = useState<Record<string, DigestGist[]>>({});
  const asked = useRef(new Set<string>());

  useEffect(() => {
    if (!captureSessionId) return;
    const turns = turnsInOrder(conversation).filter((t) => t.text.trim().length > 0);
    const over = turns.at(-2);
    // The newest turn has begun, so the one before it is over — unless its voice is still on it.
    if (!over || over.voiced !== undefined) return;
    const key = `${captureSessionId}:${over.seq}`;
    if (asked.current.has(key)) return;
    asked.current.add(key);
    const before = turns.at(-3) ?? null;
    void fetch("/api/realtime/gist", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        captureSessionId,
        seq: over.seq,
        turn: { who: over.who, text: over.text },
        before: before ? { who: before.who, text: before.text } : null,
      }),
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ gist: DigestGist | null }>) : null))
      .then((body) => {
        const gist = body?.gist;
        if (gist) setBySession((all) => ({ ...all, [captureSessionId]: [...(all[captureSessionId] ?? []), gist] }));
      })
      // No gist: the screen keeps its own shortening until the digest writes one.
      .catch(() => {});
  }, [conversation, captureSessionId]);

  return captureSessionId ? (bySession[captureSessionId] ?? NONE) : NONE;
}

const NONE: DigestGist[] = [];
