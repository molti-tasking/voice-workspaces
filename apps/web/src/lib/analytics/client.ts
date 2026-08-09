"use client";

import type { AnalyticsEventMap, AnalyticsEventName } from "@voicemural/shared";
import posthog from "posthog-js";

/**
 * Browser-side capture, typed against the shared taxonomy.
 *
 * Always prefer this over calling `posthog.capture` directly: an event name
 * that is not in `AnalyticsEventMap`, or a payload that does not match it,
 * becomes a compile error instead of a plausible-looking second event that
 * quietly splits a funnel.
 *
 * Everything sent from here is best-effort. posthog-js keeps failed requests in
 * memory, not IndexedDB, so a phone that loses signal mid-drive and has its tab
 * evicted loses whatever was queued. Anything that must survive a dead zone
 * belongs on the recorder's own upload queue instead — see `lib/recorder`.
 */
export function capture<K extends AnalyticsEventName>(
  event: K,
  properties: AnalyticsEventMap[K],
): void {
  posthog.capture(event, properties);
}

/**
 * Which distinct_id we last identified as, remembered across page loads.
 *
 * A `useRef` cannot do this job. Signing in with GitHub is a full document
 * navigation, so any in-memory record of the previous identity is gone by the
 * time the callback lands — which is exactly the moment we need to know that
 * the identity changed.
 */
const IDENTIFIED_KEY = "vm_posthog_identified_as";

function lastIdentifiedAs(): string | null {
  try {
    return window.localStorage.getItem(IDENTIFIED_KEY);
  } catch {
    // Private browsing and locked-down WebViews throw rather than return null.
    return null;
  }
}

function rememberIdentifiedAs(userId: string | null): void {
  try {
    if (userId === null) window.localStorage.removeItem(IDENTIFIED_KEY);
    else window.localStorage.setItem(IDENTIFIED_KEY, userId);
  } catch {
    /* best-effort */
  }
}

export interface IdentityInput {
  userId: string;
  isGuest: boolean;
  email?: string | null;
  name?: string | null;
}

/**
 * Point PostHog at the current user.
 *
 * Two transitions matter here and they need opposite handling:
 *
 * 1. Anonymous visitor becomes a guest. `identify` merges the anonymous person
 *    into the guest, which is the merge PostHog always honours.
 *
 * 2. A guest signs in with GitHub. Better Auth mints a *new* user row and
 *    deletes the guest, so this is one human arriving under a second identified
 *    id. `identify` alone will not merge those — posthog-js refuses to
 *    re-identify an already-identified distinct_id and no-ops with a console
 *    warning. The merge is done server-side in `onLinkAccount` with
 *    `$merge_dangerously`, where both ids are known for certain; the `reset`
 *    below then simply repoints this browser at the new id. It cannot lose the
 *    guest's history, because that history has already been merged.
 */
export function identifyUser({ userId, isGuest, email, name }: IdentityInput): void {
  const previous = lastIdentifiedAs();
  if (previous === userId) {
    // Same person as last load. Refresh properties without a redundant
    // $identify on every navigation.
    posthog.setPersonProperties(personPropertiesFor({ userId, isGuest, email, name }));
    return;
  }

  if (previous !== null) posthog.reset();

  posthog.identify(userId, personPropertiesFor({ userId, isGuest, email, name }));
  rememberIdentifiedAs(userId);
}

function personPropertiesFor({ isGuest, email, name }: IdentityInput): Record<string, unknown> {
  return {
    is_guest: isGuest,
    auth_provider: isGuest ? "anonymous" : "github",
    // Guests get a synthetic `…@guest.voicemural.local` address and the name
    // "Guest". Sending those would fill person search with thousands of
    // identical rows that identify nobody.
    ...(isGuest ? {} : { ...(email ? { email } : {}), ...(name ? { name } : {}) }),
  };
}

/**
 * Forget the current person. Called on explicit sign-out only.
 *
 * Without it the next guest on a shared device inherits the previous person —
 * which for a study run on borrowed phones would silently merge two
 * participants into one.
 */
export function resetIdentity(): void {
  rememberIdentifiedAs(null);
  posthog.reset();
}
