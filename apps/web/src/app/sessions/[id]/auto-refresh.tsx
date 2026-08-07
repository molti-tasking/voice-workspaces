"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Re-fetch the session while work is still outstanding.
 *
 * Transcription is asynchronous, so arriving straight from the recorder shows a
 * transcript that is still filling in. Without this the page looks frozen and
 * indistinguishable from a failure — you would reload by hand to find out
 * whether anything was happening.
 *
 * Stops as soon as nothing is pending, so an old session costs nothing.
 */
export function AutoRefresh({
  pending,
  intervalMs = 4000,
}: {
  pending: number;
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (pending <= 0) return;
    const timer = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [pending, intervalMs, router]);

  return null;
}
