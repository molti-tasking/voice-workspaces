import type {
  AnalyticsEventMap,
  AnalyticsEventName,
  PersonProperties,
  PersonPropertiesOnce,
} from "@voicemural/shared";
import { PostHog } from "posthog-node";

/**
 * Server-side PostHog, constructed on first use.
 *
 * Lazy for the same reason `getAuth()` and `getDb()` are: building it at module
 * load would read configuration during `next build`, and nothing here is needed
 * until a request actually arrives.
 *
 * A singleton rather than a client per request, which matters more than it
 * looks. `enableExceptionAutocapture` installs handlers on `process`; creating
 * and shutting down a client per call would add a fresh pair on every request
 * and leave the old ones pointing at a closed client, which surfaces later as a
 * MaxListenersExceededWarning and silently dropped exceptions.
 */
let instance: PostHog | null | undefined;

function projectToken(): string | undefined {
  return process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim() || undefined;
}

function host(): string | undefined {
  return process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim() || undefined;
}

/**
 * Analytics is optional, exactly like GitHub sign-in.
 *
 * A fresh clone has to run with nothing but a database — that is what
 * `scripts/check-dev.mjs` and the lazy auth setup exist to preserve. Throwing
 * here when the token is absent would make PostHog a prerequisite for `pnpm
 * dev`, so an unconfigured environment is a silent no-op instead.
 */
export function analyticsEnabled(): boolean {
  return Boolean(projectToken() && host());
}

function getPostHog(): PostHog | null {
  if (instance !== undefined) return instance;

  const token = projectToken();
  const apiHost = host();
  if (!token || !apiHost) {
    instance = null;
    return null;
  }

  instance = new PostHog(token, {
    host: apiHost,
    // Batched, with the flush on shutdown wired up in `instrumentation.ts`.
    // `flushAt: 1` would put a round-trip to Frankfurt inside every request
    // that captures anything — including chunk upload, which runs six times a
    // minute per participant over mobile data.
    flushAt: 20,
    flushInterval: 10_000,
    enableExceptionAutocapture: true,
  });
  return instance;
}

/**
 * Capture a server-side event.
 *
 * Typed against the shared taxonomy, so an event name that is not in
 * `AnalyticsEventMap` — or a payload that does not match it — is a compile
 * error rather than a second event that looks plausible in the PostHog UI.
 */
export function capture<K extends AnalyticsEventName>(
  distinctId: string,
  event: K,
  properties: AnalyticsEventMap[K],
  options?: { sessionId?: string | null; processPerson?: boolean },
): void {
  const posthog = getPostHog();
  if (!posthog) return;

  posthog.capture({
    distinctId,
    event,
    properties: {
      ...properties,
      ...(options?.sessionId ? { $session_id: options.sessionId } : {}),
      // System events with no real person behind them would otherwise mint a
      // junk profile and distort every person-level count.
      ...(options?.processPerson === false ? { $process_person_profile: false } : {}),
    },
  });
}

export function setPersonProperties(
  distinctId: string,
  set: Partial<PersonProperties>,
  setOnce?: Partial<PersonPropertiesOnce>,
): void {
  const posthog = getPostHog();
  if (!posthog) return;
  posthog.identify({ distinctId, properties: { ...set, $set_once: setOnce } });
}

/**
 * Merge a guest person into the account they just signed into.
 *
 * `alias` is the obvious call and the wrong one: PostHog refuses to merge two
 * persons that have both already been identified, and by this point both have.
 * `$merge_dangerously` is the one mechanism that does merge them.
 *
 * It is irreversible, which is why it is only ever called from Better Auth's
 * `onLinkAccount` — the single place where both ids are known to belong to the
 * same human rather than inferred.
 */
export function mergeGuestIntoUser(guestUserId: string, newUserId: string): void {
  const posthog = getPostHog();
  if (!posthog) return;
  posthog.capture({
    distinctId: newUserId,
    event: "$merge_dangerously",
    properties: { alias: guestUserId },
  });
}

export function captureServerException(error: unknown, distinctId?: string): void {
  const posthog = getPostHog();
  if (!posthog) return;
  posthog.captureException(error, distinctId);
}

/** Flush and close. Called from `instrumentation.ts` on SIGTERM. */
export async function shutdownAnalytics(): Promise<void> {
  const posthog = instance;
  instance = undefined;
  if (posthog) await posthog.shutdown();
}

/**
 * The browser's replay session id, forwarded by posthog-js `tracing_headers` on
 * same-origin fetches. Attaching it lets a server event be lined up against the
 * session replay it happened during.
 */
export function sessionIdFrom(req: Request): string | null {
  return req.headers.get("X-POSTHOG-SESSION-ID");
}
