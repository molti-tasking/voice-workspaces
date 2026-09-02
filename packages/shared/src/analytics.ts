/**
 * The analytics event taxonomy — the single source of truth for every event
 * name and payload sent to PostHog, from the browser, the web server, and the
 * worker alike.
 *
 * Deliberately plain TypeScript rather than Zod, unlike `contracts.ts`. Those
 * schemas guard data arriving from an untrusted client and must be validated at
 * runtime; these payloads are constructed by our own code from our own types,
 * so a compile-time check is the whole of the protection needed and a runtime
 * one would be ceremony.
 *
 * The reason this file exists at all is that event names drift. Once a name is
 * loose in three packages as a string literal, a typo produces a second event
 * that looks plausible in the UI and quietly splits every funnel that uses it.
 * Adding an event means adding a line here first.
 *
 * Naming: `object_verb_past`, snake_case, properties snake_case too.
 */

/**
 * Why `recording_*` and `capture_session_*` both exist.
 *
 * They are not two names for one thing. `recording_*` is the user's gesture,
 * captured in the browser, and is best-effort: a phone in a dead zone may never
 * deliver it. `capture_session_*` is the data lifecycle, emitted server-side,
 * and is the funnel of record. Keeping both is what lets us measure the gap
 * between the two — which for a study run from a moving car is a finding, not
 * an inconsistency.
 */
export interface AnalyticsEventMap {
  // --- recorder, client-side (best-effort) ---------------------------------
  recording_started: {
    mime_type: string;
    /** True when picking up an unfinished session from a previous page load. */
    resumed: boolean;
    wake_lock_active: boolean;
    /**
     * Where the user said they were. Null when the browser had nothing stored.
     *
     * The independent variable for everything setting-governed: reply length,
     * whether the cue panel rendered at all, how much went on it.
     */
    setting?: string | null;
  };
  recording_stopped: {
    capture_session_id: string;
    recording_duration_ms: number;
    chunks_recorded: number;
    chunks_pending: number;
  };
  mic_permission_denied: { error_name: string };
  wake_lock_denied: Record<string, never>;
  unfinished_session_detected: { capture_session_id: string };
  unfinished_session_closed: { capture_session_id: string };

  /**
   * One per drain-loop completion, not per chunk.
   *
   * Per-chunk would be ~6 events a minute of near-zero information; per-session
   * would average away the thing worth seeing. Per-drain yields the dead-zone
   * duration distribution, which is the interesting measurement in a study
   * conducted while driving.
   */
  upload_drained: {
    chunks_flushed: number;
    oldest_chunk_age_ms: number;
    dropped: number;
  };
  /** A chunk the server refused permanently. Each one is lost recording. */
  upload_chunk_dropped: { status: number; seq: number; error_code?: string };

  // --- capture session lifecycle, server-side (authoritative) --------------
  capture_session_opened: {
    capture_session_id: string;
    resumed: boolean;
    /** Null for a resumed session, whose setting was fixed when it opened. */
    setting?: string | null;
  };
  /**
   * Emitted once per session by the worker, after late chunks have settled.
   * This — not `recording_stopped` — is the conversion event.
   */
  capture_session_completed: {
    capture_session_id: string;
    duration_ms: number;
    chunk_count: number;
    failed_chunk_count: number;
    utterance_count: number;
    /** Whether the phone reached `/end`, or the idle sweep closed it. */
    closed_by: "client" | "idle_sweep";
  };
  chunk_upload_rejected: { capture_session_id: string; reason: string; status: number };
  chunk_requeued: { count: number };

  // --- auth ----------------------------------------------------------------
  user_signed_up: { is_guest: boolean };
  /**
   * Authentication succeeded. Server-side, from Better Auth's session hook, so
   * it is emitted once per session creation however it happened — including a
   * guest tapping Record, which is why `provider` carries "anonymous".
   *
   * Distinct from `user_signed_up`, which fires only when the row is first
   * created. The pair is what separates returning participants from new ones.
   */
  user_signed_in: { provider: AuthProvider; is_guest: boolean };
  /**
   * The redirect to a provider was started. Client-side and best-effort: the
   * matching `user_signed_in` may never arrive, and the gap between the two is
   * the OAuth drop-off worth seeing.
   *
   * `location` separates the two gestures that look identical in aggregate —
   * signing in cold from the landing page, versus a guest upgrading an account
   * that already holds recordings.
   */
  sign_in_started: {
    provider: "github" | "google";
    location: "landing" | "account_menu" | "guest_banner";
  };
  user_signed_out: { is_guest: boolean };
  guest_account_upgraded: {
    sessions_moved: number;
    capabilities_moved: number;
    starter_capabilities_replaced: number;
    renamed_on_collision: number;
  };

  // --- workspace / timeline, client-side -----------------------------------
  workspace_viewed: { topic_count: number; block_count: number; has_diff: boolean };
  workspace_topic_exported: { topic_slug: string; block_count: number; bytes: number };
  workspace_diff_viewed: { added: number; revised: number; new_topics: number };
  // Clearing a diff and expanding a revision history are both plain element
  // clicks (an <a> and a <summary>), which autocapture already records. Naming
  // them here would add a second, redundant event for the same interaction.
  timeline_viewed: { session_count: number; marker_count: number };
  timeline_page_loaded: { sessions_shown: number };
  /**
   * The join between a user action and an `$ai_generation`: `extraction_id` is
   * the same value as that generation's `$ai_trace_id`, so survey responses and
   * clicks can be attributed to the exact model call being reviewed.
   */
  timeline_marker_clicked: {
    extraction_id: string;
    op_count: number;
    total_tokens: number;
    resolved_model: string;
  };
  transcript_viewed: {
    capture_session_id: string;
    utterance_count: number;
    has_gaps: boolean;
    has_failed_chunks: boolean;
  };

  // --- workspace extraction, worker-side -----------------------------------
  /**
   * A run that hit the extraction cache and therefore made no model call.
   * Tracked separately from `$ai_generation` so cost is never overstated —
   * `workspace:rebuild` replays an entire transcript at zero spend.
   */
  workspace_extraction_cached: {
    extraction_id: string;
    segments: number;
    ops_appended: number;
  };
  workspace_extraction_failed: {
    extraction_id: string;
    /** Set when nothing could be parsed at all. */
    parse_error: string | null;
    /** Individual ops dropped by the parser. */
    parse_warning_count: number;
  };
  // --- directions, repertoire and macros -----------------------------------
  /**
   * Directions found in one chunk.
   *
   * `candidates` against `utterances` is the lexical gate's yield, which is how
   * you tell "the gate is too tight" from "this person gives few directions" —
   * a distinction invisible from the directive count alone.
   */
  directives_detected: {
    chunk_id: string;
    directives: number;
    candidates: number;
    utterances: number;
    prompt_version: string;
    model: string | null;
  };
  /** Every fire, including the ones parked awaiting confirmation. */
  capability_invoked: {
    capability: string;
    capability_type: "mode" | "persona" | "action" | "rule";
    capture_session_id: string;
    /** Null while awaiting confirmation for an irreversible or outbound action. */
    confirmed: boolean | null;
  };
  /** A recurring improvised operation offered back as a macro. */
  macro_proposed: {
    canonical_form: string;
    occurrences: number;
    session_count: number;
    has_replay: boolean;
  };
  /**
   * The growth curve's increments, and its refusals.
   *
   * Declines matter as much as acceptances: "what they tried to add and failed"
   * is a stated field-study measure, and it is only answerable if a refusal is
   * an event rather than the absence of one.
   */
  macro_decided: {
    canonical_form: string;
    accepted: boolean;
    occurrences: number;
  };
  repertoire_viewed: {
    capability_count: number;
    proposal_count: number;
    total_invocations: number;
  };
  trajectory_viewed: {
    topic_count: number;
    bucket_count: number;
    /** Whether the scrubber was moved off "now" before this render. */
    has_as_of: boolean;
  };

  transcription_failed: {
    chunk_id: string;
    capture_session_id: string;
    retryable: boolean;
    reason: string;
  };
}

export type AnalyticsEventName = keyof AnalyticsEventMap;

/**
 * How a person authenticated.
 *
 * A union rather than a bare string so adding a provider is a compile error at
 * every site that reports one — which is exactly what did not happen when Google
 * was added and two call sites went on hardcoding "github" for anyone who was
 * not a guest.
 */
export type AuthProvider = "anonymous" | "github" | "google";

/**
 * Person properties set from database truth, not counted from the event stream.
 *
 * PostHog has no atomic increment for person properties, so anything counted
 * client-side drifts the first time an event is lost — and in this app events
 * are lost by design, every time a phone enters a tunnel. The worker recomputes
 * these from Postgres instead.
 *
 * Timestamps are ISO strings so PostHog can do relative-date comparison. There
 * is deliberately no `days_since_first_session`: it would only be recomputed
 * when a session closes, so for a lapsed participant — precisely who a churn
 * survey targets — it would freeze on the day they stopped.
 */
export interface PersonProperties {
  is_guest: boolean;
  auth_provider: AuthProvider;
  study_participant_id?: string;
  sessions_count: number;
  total_recorded_ms: number;
  failed_chunk_rate: number;
  topics_count: number;
  blocks_count: number;
  extractions_count: number;
  last_session_at: string;
}

/** Set once and never overwritten, so a re-run cannot rewrite history. */
export interface PersonPropertiesOnce {
  first_session_at: string;
}
