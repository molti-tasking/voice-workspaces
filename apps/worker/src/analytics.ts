import type {
  AnalyticsEventMap,
  AnalyticsEventName,
  PersonProperties,
  PersonPropertiesOnce,
} from "@voicemural/shared";
import { PostHog } from "posthog-node";
import { log } from "./logger";

/**
 * PostHog for the worker.
 *
 * The worker is where the authoritative events come from: it is always online,
 * it reads from Postgres rather than from a phone in a tunnel, and it is the
 * only process that sees a model call. Everything the browser sends is a
 * best-effort supplement to what is emitted here.
 *
 * Constructed on first use and returning null when unconfigured, matching
 * `getDb()` and `githubConfigured()` — an unset token disables analytics rather
 * than preventing the worker from starting.
 */
let instance: PostHog | null | undefined;

function getPostHog(): PostHog | null {
  if (instance !== undefined) return instance;

  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN?.trim();
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST?.trim();
  if (!token || !host) {
    log.info("analytics disabled", { reason: "POSTHOG token or host not set" });
    instance = null;
    return null;
  }

  instance = new PostHog(token, { host, flushAt: 20, flushInterval: 10_000 });
  return instance;
}

export function analyticsEnabled(): boolean {
  return getPostHog() !== null;
}

/** Whether transcripts and model responses may be sent as event content. */
export function captureAiContent(): boolean {
  return process.env.POSTHOG_CAPTURE_AI_CONTENT !== "false";
}

/**
 * Capture a worker event, typed against the shared taxonomy.
 *
 * `timestamp` is worth passing for anything the sweep emits. A session closed
 * by the idle sweep is reported up to 25 minutes after it actually ended, and
 * without an explicit timestamp every drive would appear to have happened on a
 * five-second sweep boundary.
 */
export function capture<K extends AnalyticsEventName>(
  distinctId: string,
  event: K,
  properties: AnalyticsEventMap[K],
  options?: { timestamp?: Date; processPerson?: boolean },
): void {
  const posthog = getPostHog();
  if (!posthog) return;

  posthog.capture({
    distinctId,
    event,
    timestamp: options?.timestamp,
    properties: {
      ...properties,
      ...(options?.processPerson === false ? { $process_person_profile: false } : {}),
    },
  });
}

/** Send a raw PostHog event. Only for `$`-prefixed events it owns, e.g. `$ai_generation`. */
export function captureRaw(
  distinctId: string,
  event: string,
  properties: Record<string, unknown>,
  timestamp?: Date,
): void {
  const posthog = getPostHog();
  if (!posthog) return;
  posthog.capture({ distinctId, event, properties, timestamp });
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

export function captureException(error: unknown, distinctId?: string): void {
  const posthog = getPostHog();
  if (!posthog) return;
  posthog.captureException(error, distinctId);
}

/**
 * Flush and close. Wired into the worker's SIGTERM handler.
 *
 * Without this a redeploy discards whatever is still batched — which, because
 * the sweep runs every five seconds, is reliably the most recent thing that
 * happened.
 */
export async function shutdownAnalytics(): Promise<void> {
  const posthog = instance;
  instance = undefined;
  if (!posthog) return;
  try {
    await posthog.shutdown();
  } catch (err) {
    log.error("failed to flush analytics", { err: String(err) });
  }
}
