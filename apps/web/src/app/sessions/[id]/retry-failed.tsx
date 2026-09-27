"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Queue a session's failed chunks again.
 *
 * The page refreshes afterwards, and once the chunks are `stored` again its
 * AutoRefresh keeps it refreshing until they are transcribed or fail again.
 */
export function RetryFailed({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "busy" | "error">("idle");

  async function retry() {
    setState("busy");
    try {
      const res = await fetch(`/api/capture-sessions/${sessionId}/retry`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
      setState("idle");
      router.refresh();
    } catch {
      setState("error");
    }
  }

  return (
    <button
      type="button"
      onClick={retry}
      disabled={state === "busy"}
      className="mt-2 rounded-md border border-current/30 px-3 py-1 text-fg/80 hover:bg-fg/10 disabled:opacity-50"
    >
      {state === "busy" ? "Queuing…" : state === "error" ? "Retry failed — try again" : "Retry transcription"}
    </button>
  );
}
