"use client";

import { useEffect, useRef } from "react";
import type { AnalyticsEventMap, AnalyticsEventName } from "@voicemural/shared";
import { capture } from "./client";

/**
 * Emit one event when a server-rendered page mounts.
 *
 * `$pageview` already records that a route was visited; this carries what was
 * actually on it — how many topics a workspace had, whether a diff was being
 * shown — which is what makes the visit interpretable and gives surveys
 * something to target.
 *
 * Rendered from a server component with the numbers passed as props, so the
 * page itself stays on the server.
 */
export function ViewEvent<K extends AnalyticsEventName>({
  event,
  properties,
}: {
  event: K;
  properties: AnalyticsEventMap[K];
}) {
  // Fires once per mount. React 19 in development mounts effects twice, and
  // the timeline remounts this on every infinite-scroll page-in, so without the
  // guard one visit would report several times.
  const sent = useRef(false);
  const payload = JSON.stringify(properties);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;
    capture(event, JSON.parse(payload) as AnalyticsEventMap[K]);
  }, [event, payload]);

  return null;
}
