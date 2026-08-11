import { describe, expect, it } from "vitest";
import type { AnalyticsEventName } from "./analytics";

/**
 * A rename is a data migration, not a refactor.
 *
 * PostHog keys everything — insights, funnels, cohorts, survey targeting — on
 * the event name string. Renaming one silently splits its history in two, and
 * nothing in the type system notices because both sides of the rename compile.
 * This list is the tripwire: changing it should require deciding what happens
 * to the events already stored under the old name.
 */
const KNOWN_EVENTS = [
  "capture_session_completed",
  "capture_session_opened",
  "chunk_requeued",
  "chunk_upload_rejected",
  "guest_account_upgraded",
  "mic_permission_denied",
  "recording_started",
  "recording_stopped",
  "sign_in_started",
  "timeline_marker_clicked",
  "timeline_page_loaded",
  "timeline_viewed",
  "transcript_viewed",
  "transcription_failed",
  "unfinished_session_closed",
  "unfinished_session_detected",
  "upload_chunk_dropped",
  "upload_drained",
  "user_signed_in",
  "user_signed_out",
  "user_signed_up",
  "wake_lock_denied",
  "workspace_diff_viewed",
  "workspace_extraction_cached",
  "workspace_extraction_failed",
  "workspace_topic_exported",
  "workspace_viewed",
] as const;

describe("analytics taxonomy", () => {
  it("has not gained or lost an event without the list being updated", () => {
    // Exhaustiveness in both directions: the object literal must supply every
    // AnalyticsEventName (missing one fails to compile), and every key must be
    // an AnalyticsEventName (a stale one fails to compile).
    const coverage: Record<AnalyticsEventName, true> = {
      capture_session_completed: true,
      capture_session_opened: true,
      chunk_requeued: true,
      chunk_upload_rejected: true,
      guest_account_upgraded: true,
      mic_permission_denied: true,
      recording_started: true,
      recording_stopped: true,
      sign_in_started: true,
      timeline_marker_clicked: true,
      timeline_page_loaded: true,
      timeline_viewed: true,
      transcript_viewed: true,
      transcription_failed: true,
      unfinished_session_closed: true,
      unfinished_session_detected: true,
      upload_chunk_dropped: true,
      upload_drained: true,
      user_signed_in: true,
      user_signed_out: true,
      user_signed_up: true,
      wake_lock_denied: true,
      workspace_diff_viewed: true,
      workspace_extraction_cached: true,
      workspace_extraction_failed: true,
      workspace_topic_exported: true,
      workspace_viewed: true,
    };

    expect(Object.keys(coverage).sort()).toEqual([...KNOWN_EVENTS]);
  });

  it("uses snake_case throughout", () => {
    for (const name of KNOWN_EVENTS) {
      expect(name).toMatch(/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/);
    }
  });

  it("does not collide with PostHog's reserved `$`-prefixed namespace", () => {
    for (const name of KNOWN_EVENTS) expect(name.startsWith("$")).toBe(false);
  });
});
