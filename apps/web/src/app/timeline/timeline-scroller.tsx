"use client";

import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";

/**
 * Pulls in the next session when the reader nears the bottom.
 *
 * Paging is server-side and expressed in the URL rather than fetched into
 * client state: the sessions themselves are server components doing database
 * work, and a shareable `?sessions=` also means the back button behaves.
 *
 * Paged from the start rather than retrofitted — a 40-minute commute is ~200
 * utterances, so five weeks of driving is ~5,000 rows, and adding paging at
 * that point means doing it on a page that is already unusable.
 */
export function LoadMoreSentinel({ nextCount }: { nextCount: number }) {
  const router = useRouter();
  const params = useSearchParams();
  const sentinel = useRef<HTMLDivElement | null>(null);
  const requested = useRef(false);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Once per mount: the observer keeps firing while the sentinel is on
        // screen, and each navigation would otherwise stack up.
        if (!entries[0]?.isIntersecting || requested.current) return;
        requested.current = true;

        const next = new URLSearchParams(params.toString());
        next.set("sessions", String(nextCount));
        router.replace(`/timeline?${next.toString()}`, { scroll: false });
      },
      // Start fetching before the reader actually reaches the bottom.
      { rootMargin: "600px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [nextCount, params, router]);

  return (
    <div ref={sentinel} className="flex justify-center py-10 text-white/25">
      <Loader2 size={16} className="animate-spin" aria-label="Loading earlier drives" />
    </div>
  );
}
