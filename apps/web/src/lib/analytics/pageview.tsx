"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";
import posthog from "posthog-js";

/**
 * Routes where session replay is worth its cost.
 *
 * `/record` is deliberately absent. It is a phone in a cradle showing a timer
 * that counts up — there is nothing to watch, and recording it would spend a
 * participant's mobile data, and their battery, for the length of a drive.
 */
function shouldRecord(pathname: string): boolean {
  return !pathname.startsWith("/record");
}

/**
 * Manual pageviews, keyed on pathname alone.
 *
 * The query string is dropped on purpose. `/timeline` pages itself in with
 * `router.replace('/timeline?sessions=N')` on every infinite-scroll step, and
 * `/workspace` carries `?asOf` and `?since` for time travel — automatic
 * history-change capture would turn one visit into a dozen pageviews spread
 * across as many distinct URLs, which is unusable in a funnel.
 *
 * The UUID in `/sessions/<id>` is left intact here and cleaned in PostHog's
 * Path Cleaning Rules instead, so the raw event keeps the real URL and the rule
 * can be fixed later without a deploy.
 */
export function PostHogPageview() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname) return;

    posthog.capture("$pageview", {
      $current_url: `${window.location.origin}${pathname}`,
      $pathname: pathname,
    });

    if (shouldRecord(pathname)) posthog.startSessionRecording();
    else posthog.stopSessionRecording();
  }, [pathname]);

  return null;
}
