import { relations, sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/* ---------------------------------------------------------------------------
 * Better Auth tables
 *
 * Property names must match Better Auth's field names exactly — its Drizzle
 * adapter looks columns up by JS property. Note that Better Auth owns `session`
 * (a login session); our domain "session" (a drive) is `captureSession`.
 * ------------------------------------------------------------------------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  /**
   * Guest account, created by tapping Record without signing in. Required by
   * Better Auth's anonymous plugin. A guest is cookie-scoped: clearing site
   * data or switching browsers produces a different person as far as the
   * database is concerned.
   */
  isAnonymous: boolean("is_anonymous").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const session = pgTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [index("session_user_id_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_id_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

/* ---------------------------------------------------------------------------
 * Enums
 * ------------------------------------------------------------------------- */

export const capabilityTypeEnum = pgEnum("capability_type", [
  "mode",
  "persona",
  "action",
  "rule",
]);

export const utteranceKindEnum = pgEnum("utterance_kind", [
  "content",
  "directive",
  "unclassified",
]);

export const capabilityOriginKindEnum = pgEnum("capability_origin_kind", [
  "starter",
  "crystallisation",
  "reflexive",
]);

/**
 * Where a recording happened.
 *
 * Not a fifth `capability_type`: Notes.md argues for the closure of
 * mode/persona/action/rule, and a setting is not something the user authors —
 * it is a fact about where they were, stated once per recording. It governs
 * turn-taking and how much may appear on screen, so it has to be recoverable
 * for the whole session afterwards, which is why it is stored rather than held
 * in the client.
 */
export const captureSettingEnum = pgEnum("capture_setting", [
  "driving",
  "walking",
  "hands_busy",
  "desk",
]);

export const macroProposalStatusEnum = pgEnum("macro_proposal_status", [
  "proposed",
  "accepted",
  "declined",
]);

export const chunkStatusEnum = pgEnum("chunk_status", [
  "stored",
  "transcribing",
  "transcribed",
  "failed",
]);

/* ---------------------------------------------------------------------------
 * Capture
 * ------------------------------------------------------------------------- */

/** One drive. Named `capture_session` to avoid colliding with auth sessions. */
export const captureSession = pgTable(
  "capture_session",
  {
    id: uuid("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /**
     * Which path closed the session.
     *
     * A drive usually ends by arriving somewhere rather than by deciding to
     * stop, so the explicit /end call is frequently never made and the idle
     * sweep closes the session instead. Recording which happened is a finding
     * in its own right for a study conducted while driving, and it is the only
     * way to tell the two apart after the fact — both write `endedAt`.
     */
    endedBy: text("ended_by").$type<"client" | "idle_sweep">(),
    /**
     * When `capture_session_completed` was sent to PostHog.
     *
     * Exactly-once is enforced here rather than relying on PostHog's event
     * deduplication, which resolves at ClickHouse merge time and is defeated by
     * any difference in timestamp — a retry a minute later would not be caught.
     */
    analyticsEmittedAt: timestamp("analytics_emitted_at", { withTimezone: true }),
    /**
     * The setting the user stated before starting. NULL for recordings made
     * before the question was asked; readers treat that as `driving`, which is
     * the stance the base prompt was written with, so old sessions are
     * unchanged rather than retroactively reinterpreted.
     */
    setting: captureSettingEnum("setting"),
    /** Active mode/persona at capture time, for reconstructing what was in force. */
    activeModeId: uuid("active_mode_id"),
    activePersonaId: uuid("active_persona_id"),
    deviceInfo: jsonb("device_info").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("capture_session_user_started_idx").on(t.userId, t.startedAt),
    // Drives the sweep's "ended but not yet reported" scan.
    index("capture_session_analytics_pending_idx")
      .on(t.endedAt)
      .where(sql`${t.analyticsEmittedAt} is null`),
  ],
);

/**
 * An uploaded audio chunk. Append-only.
 *
 * `seq` is unique per session so a retried upload from the offline queue is
 * idempotent — the recorder may legitimately send the same chunk twice.
 */
export const audioChunk = pgTable(
  "audio_chunk",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    captureSessionId: uuid("capture_session_id")
      .notNull()
      .references(() => captureSession.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    startOffsetMs: integer("start_offset_ms").notNull(),
    durationMs: integer("duration_ms").notNull(),
    mimeType: text("mime_type").notNull(),
    byteSize: integer("byte_size").notNull(),
    /** sha256 of the payload, for detecting a corrupted re-upload. */
    checksum: text("checksum").notNull(),
    /**
     * Where the audio lives — NULL once it has been discarded.
     *
     * Audio is transient by design: it exists only until its transcript is
     * committed, then it is deleted (unless KEEP_AUDIO=true). The transcript is
     * the durable record.
     */
    storageKey: text("storage_key"),
    /** When the audio was deleted. Distinguishes "discarded" from "never stored". */
    audioDiscardedAt: timestamp("audio_discarded_at", { withTimezone: true }),
    status: chunkStatusEnum("status").notNull().default("stored"),
    failureReason: text("failure_reason"),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
    /**
     * When the current transcription attempt began. Distinct from `uploadedAt`
     * because a chunk may sit queued for hours after an offline drain — stuck
     * detection has to measure the attempt, not the upload.
     */
    transcribeStartedAt: timestamp("transcribe_started_at", { withTimezone: true }),
    transcribedAt: timestamp("transcribed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("audio_chunk_session_seq_idx").on(t.captureSessionId, t.seq),
    index("audio_chunk_status_idx").on(t.status),
  ],
);

/**
 * The verbatim stream. Append-only, never mutated.
 *
 * This is the asymmetry the design rests on: because the record is immutable
 * and artefacts are derived from it, misclassification blemishes but never
 * destroys. Corrections go to `kindOverride`, leaving `text` untouched.
 */
export const utterance = pgTable(
  "utterance",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    captureSessionId: uuid("capture_session_id")
      .notNull()
      .references(() => captureSession.id, { onDelete: "cascade" }),
    chunkId: uuid("chunk_id")
      .notNull()
      .references(() => audioChunk.id, { onDelete: "cascade" }),
    startOffsetMs: integer("start_offset_ms").notNull(),
    endOffsetMs: integer("end_offset_ms").notNull(),
    text: text("text").notNull(),
    kind: utteranceKindEnum("kind").notNull().default("unclassified"),
    /** Human correction from the Workspace. Never overwrite `kind` in place. */
    kindOverride: utteranceKindEnum("kind_override"),
    /** Classifier confidence, kept for tuning the content/directive split. */
    kindConfidence: integer("kind_confidence"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("utterance_session_offset_idx").on(t.captureSessionId, t.startOffsetMs),
    index("utterance_kind_idx").on(t.kind),
    // Drives the classifier sweep: "which chunks still hold unclassified
    // speech". Partial, because after the backlog drains the answer is almost
    // always none and a full index would be scanned every five seconds.
    index("utterance_unclassified_idx")
      .on(t.chunkId)
      .where(sql`${t.kind} = 'unclassified'`),
    // Full-text search over the corpus, for talk-back's recall.
    //
    // `simple` rather than a language configuration on purpose: the corpus is
    // mixed German and English, and stemming everything as one language is
    // worse than not stemming at all. Phase 5 adds pgvector alongside this; the
    // lexical arm stays either way, because exact words — a name, a project, a
    // number — are what people actually ask to be reminded of.
    index("utterance_text_search_idx").using(
      "gin",
      sql`to_tsvector('simple', ${t.text})`,
    ),
  ],
);

/* ---------------------------------------------------------------------------
 * Repertoire
 *
 * The growth curve is the paper's dependent variable, so these tables are
 * append-only by design: edits create versions, invocations are never deleted.
 * None of this can be reconstructed after the fact.
 * ------------------------------------------------------------------------- */

export const capability = pgTable(
  "capability",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    type: capabilityTypeEnum("type").notNull(),
    name: text("name").notNull(),
    /** Retired, not deleted — "which survived" needs the tombstone. */
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("capability_user_name_idx").on(t.userId, t.name),
    index("capability_user_type_idx").on(t.userId, t.type),
  ],
);

/** Append-only versions, so edits are measurable and not just creations. */
export const capabilityVersion = pgTable(
  "capability_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    capabilityId: uuid("capability_id")
      .notNull()
      .references(() => capability.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    markdown: text("markdown").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    /** One-sentence restatement read back to the user for eyes-free verification. */
    restatement: text("restatement"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("capability_version_unique_idx").on(t.capabilityId, t.version),
    index("capability_version_created_idx").on(t.createdAt),
  ],
);

/**
 * How a capability entered the repertoire.
 *
 * `triggeringSessionId` and the utterance range answer the paper's question
 * "added when, after what triggering episode" (Notes.md:62).
 */
export const capabilityOrigin = pgTable("capability_origin", {
  capabilityId: uuid("capability_id")
    .primaryKey()
    .references(() => capability.id, { onDelete: "cascade" }),
  createdVia: capabilityOriginKindEnum("created_via").notNull(),
  triggeringSessionId: uuid("triggering_session_id").references(() => captureSession.id, {
    onDelete: "set null",
  }),
  triggeringStartOffsetMs: integer("triggering_start_offset_ms"),
  triggeringEndOffsetMs: integer("triggering_end_offset_ms"),
  note: text("note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Every fire, including rejected and reverted ones. Frequency data for the paper. */
export const invocation = pgTable(
  "invocation",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    capabilityId: uuid("capability_id")
      .notNull()
      .references(() => capability.id, { onDelete: "cascade" }),
    capabilityVersionId: uuid("capability_version_id")
      .notNull()
      .references(() => capabilityVersion.id, { onDelete: "cascade" }),
    captureSessionId: uuid("capture_session_id").references(() => captureSession.id, {
      onDelete: "set null",
    }),
    triggeringUtteranceId: uuid("triggering_utterance_id").references(() => utterance.id, {
      onDelete: "set null",
    }),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
    /** Null while awaiting confirmation for an irreversible or outbound action. */
    confirmed: boolean("confirmed"),
    reverted: boolean("reverted").notNull().default(false),
    latencyMs: integer("latency_ms"),
    error: text("error"),
  },
  (t) => [
    index("invocation_capability_fired_idx").on(t.capabilityId, t.firedAt),
    index("invocation_session_idx").on(t.captureSessionId),
  ],
);

/* ---------------------------------------------------------------------------
 * Talk-back
 * ------------------------------------------------------------------------- */

/**
 * One turn the system took. Append-only.
 *
 * A SEPARATE TABLE FROM `utterance`, deliberately, and this is the load-bearing
 * decision in talk-back's schema.
 *
 * The obvious alternative — a `speaker` column on `utterance` — would mean
 * making `chunkId` nullable (permanently weakening a NOT NULL on the ledger)
 * and, worse, every existing reader would silently start including the machine's
 * words: `loadPendingSegments`, `loadAllSegments`, `loadSessionUtterances`,
 * `usersWithPendingSpeech`, `listSessionsWithStats`, `loadTimelineMarkers`, and
 * the Whisper prompt-carryover in transcribe-chunk.ts, which would feed the
 * agent's own speech back to Whisper as context for the user's next chunk. The
 * workspace — "what do *I* currently think about X" — would start folding in
 * the system's opinions. Miss one call site and it is silent.
 *
 * Here that corruption is impossible by construction rather than prevented by
 * remembering a WHERE clause in seven places.
 *
 * They are also not the same kind of thing. An utterance is what Whisper heard
 * from a microphone at an offset into audio that existed. A turn is generated
 * text with a model, a cost, a time-to-first-token, a truncation point and a
 * mode/persona in force.
 */
export const agentTurnKindEnum = pgEnum("agent_turn_kind", [
  "reply",
  "proactive_prompt",
  "confirmation_request",
  "backchannel",
]);

export const agentTurn = pgTable(
  "agent_turn",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    captureSessionId: uuid("capture_session_id")
      .notNull()
      .references(() => captureSession.id, { onDelete: "cascade" }),
    /** Monotonic within a drive. */
    seq: integer("seq").notNull(),
    /**
     * Session-relative, on the SAME clock as `utterance.startOffsetMs`, so the
     * two tables merge into one dialogue when read together.
     */
    startOffsetMs: integer("start_offset_ms").notNull(),
    /** When speaking actually stopped: truncated by barge-in, or a natural end. */
    endOffsetMs: integer("end_offset_ms").notNull(),
    kind: agentTurnKindEnum("kind").notNull().default("reply"),
    /**
     * The live ASR of the user turn this answers.
     *
     * Deliberately text, not a foreign key to `utterance`: the ledger's copy of
     * that speech is written seconds later by the chunk pipeline, and is a
     * different transcription of the same audio. Pointing at a row that does
     * not exist yet — and will not match word for word — would be a lie.
     */
    respondingToText: text("responding_to_text"),
    /**
     * What the user actually HEARD.
     *
     * Differs from `generatedText` exactly when the user barged in. How often
     * that happens, and how far into a reply, is the turn-taking data the `mode`
     * abstraction claims to govern — a finding, not bookkeeping.
     */
    text: text("text").notNull(),
    /** What the model produced, whether or not it was all spoken. */
    generatedText: text("generated_text").notNull(),
    truncatedAtMs: integer("truncated_at_ms"),
    bargedIn: boolean("barged_in").notNull().default(false),
    /**
     * What was in force for THIS turn.
     *
     * `capture_session.activeModeId` only holds the last one, and because
     * `capability_version` is append-only these two ids reconstruct the exact
     * composed prompt months later — so the prompt text itself is never stored.
     */
    modeVersionId: uuid("mode_version_id").references(() => capabilityVersion.id, {
      onDelete: "set null",
    }),
    personaVersionId: uuid("persona_version_id").references(() => capabilityVersion.id, {
      onDelete: "set null",
    }),
    requestedModel: text("requested_model"),
    /** What LiteLLM actually used — aliases and fallbacks make these differ. */
    resolvedModel: text("resolved_model"),
    /**
     * Latency, split by stage.
     *
     * A live conversation is not replayable — it depends on wall-clock timing,
     * VAD outcomes, network jitter and a sampler above temperature 0 — so unlike
     * the workspace there is no cache to reconstruct it from. These columns are
     * the only record that a turn ever happened, and the only way to answer
     * "did it feel fast" after the fact.
     */
    asrMs: integer("asr_ms"),
    ttftMs: integer("ttft_ms"),
    speakTtfbMs: integer("speak_ttfb_ms"),
    totalLatencyMs: integer("total_latency_ms"),
    promptTokens: integer("prompt_tokens"),
    completionTokens: integer("completion_tokens"),
    /** Text, not numeric: absent means unknown, never zero. */
    costUsd: text("cost_usd"),
    toolCalls: jsonb("tool_calls")
      .$type<{ name: string; latencyMs: number; error?: string; invocationId?: string }[]>()
      .notNull()
      .default([]),
    /** Which talk-back configuration produced this, for later interpretation. */
    configVersion: text("config_version"),
    error: text("error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("agent_turn_session_seq_idx").on(t.captureSessionId, t.seq),
    // Also the interval the echo filter needs: an utterance fully inside one of
    // these, and similar to its text, is the agent hearing itself.
    index("agent_turn_session_offset_idx").on(t.captureSessionId, t.startOffsetMs),
  ],
);

export const agentTurnRelations = relations(agentTurn, ({ one }) => ({
  captureSession: one(captureSession, {
    fields: [agentTurn.captureSessionId],
    references: [captureSession.id],
  }),
}));

/* ---------------------------------------------------------------------------
 * Artefacts and outlets
 * ------------------------------------------------------------------------- */

/**
 * Derived output. `spans` carries provenance back to source utterances —
 * a schema constraint, not a feature to add later.
 */
export const artifact = pgTable(
  "artifact",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    captureSessionId: uuid("capture_session_id")
      .notNull()
      .references(() => captureSession.id, { onDelete: "cascade" }),
    producedByInvocationId: uuid("produced_by_invocation_id").references(
      () => invocation.id,
      { onDelete: "set null" },
    ),
    kind: text("kind").notNull(),
    title: text("title"),
    body: text("body").notNull(),
    spans: jsonb("spans")
      .$type<{ utteranceId: string; startChar: number; endChar: number }[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("artifact_session_idx").on(t.captureSessionId)],
);

export const outlet = pgTable(
  "outlet",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: text("kind").notNull(),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("outlet_user_name_idx").on(t.userId, t.name)],
);

export const exportDelivery = pgTable(
  "export_delivery",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    artifactId: uuid("artifact_id")
      .notNull()
      .references(() => artifact.id, { onDelete: "cascade" }),
    outletId: uuid("outlet_id")
      .notNull()
      .references(() => outlet.id, { onDelete: "cascade" }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    externalRef: text("external_ref"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("export_delivery_artifact_idx").on(t.artifactId)],
);

/* ---------------------------------------------------------------------------
 * Directions
 *
 * The Midas-touch split, made durable.
 *
 * `utterance.kind` says WHETHER a line was addressed to the system. This table
 * says WHAT it asked for, and it exists because that is a different question
 * with a different lifetime: `kind` is a three-valued column on an append-only
 * ledger, while a direction has a verb, an object, a restatement to read back,
 * and possibly a capability it resolves to. Putting those on `utterance` would
 * have meant four nullable columns that are null for 98% of rows.
 *
 * Append-only, one row per directive utterance. A re-classification never
 * updates a row; the guard on `utterance.kind` means it never runs twice.
 * ------------------------------------------------------------------------- */

export const directive = pgTable(
  "directive",
  {
    /** One direction per utterance, so the PK is the utterance. */
    utteranceId: uuid("utterance_id")
      .primaryKey()
      .references(() => utterance.id, { onDelete: "cascade" }),
    captureSessionId: uuid("capture_session_id")
      .notNull()
      .references(() => captureSession.id, { onDelete: "cascade" }),
    /** Normalised operation, e.g. "mark". Lower case, one word where possible. */
    verb: text("verb").notNull(),
    /** What it acted on, in the speaker's words. Empty when the verb stands alone. */
    object: text("object").notNull().default(""),
    /** One sentence, read back for eyes-free verification. */
    restatement: text("restatement").notNull(),
    /**
     * The capability this resolved to, or NULL for an improvised operation.
     *
     * NULL is the interesting case, not the failure case: it is precisely the
     * set the macro detector mines, because an operation nobody has a
     * capability for is one the user invented.
     */
    capabilityId: uuid("capability_id").references(() => capability.id, {
      onDelete: "set null",
    }),
    /** 0-100. Kept for tuning the split, like `utterance.kindConfidence`. */
    confidence: integer("confidence").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("directive_session_created_idx").on(t.captureSessionId, t.createdAt),
    // The macro detector's scan: improvised operations, newest first.
    index("directive_unresolved_idx")
      .on(t.createdAt)
      .where(sql`${t.capabilityId} is null`),
  ],
);

/* ---------------------------------------------------------------------------
 * Macros
 *
 * A recurring improvised operation, induced from the transcript and offered
 * back. Kept out of `capability` on purpose: a proposal is not a capability
 * until the user accepts it, and `capability` is the repertoire — putting
 * unaccepted rows in it would corrupt the growth curve, which is the paper's
 * dependent variable.
 *
 * Declined proposals are kept. "What they tried to add and failed" is a stated
 * field-study measure, and it is only answerable if refusals survive.
 * ------------------------------------------------------------------------- */

export const macroProposal = pgTable(
  "macro_proposal",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /**
     * The canonical form that recurred — `verb|object-head`, or several joined
     * by `>` for a sequence. Unique per user, so re-detection is idempotent and
     * a declined proposal is never offered twice.
     */
    canonicalForm: text("canonical_form").notNull(),
    /** Every utterance that evidenced the pattern, oldest first. */
    occurrences: jsonb("occurrences")
      .$type<{ utteranceId: string; captureSessionId: string; text: string; occurredAt: string }[]>()
      .notNull()
      .default([]),
    /** How many distinct sessions it spanned. Below two it is a habit of one drive. */
    sessionCount: integer("session_count").notNull().default(0),
    proposedName: text("proposed_name").notNull(),
    restatement: text("restatement").notNull(),
    markdown: text("markdown").notNull(),
    params: jsonb("params").$type<Record<string, unknown>>().notNull().default({}),
    /**
     * The replay preview: the proposal run against the speech that triggered it.
     *
     * Notes.md is explicit that the user cannot read the file, so verification
     * is hearing the effect rather than the definition. This is that effect,
     * with spans, so the same text serves the screen and the speaker.
     */
    replayArtifactId: uuid("replay_artifact_id").references(() => artifact.id, {
      onDelete: "set null",
    }),
    status: macroProposalStatusEnum("status").notNull().default("proposed"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Set on acceptance. The link from proposal to repertoire entry. */
    capabilityId: uuid("capability_id").references(() => capability.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("macro_proposal_user_form_idx").on(t.userId, t.canonicalForm),
    index("macro_proposal_user_status_idx").on(t.userId, t.status),
  ],
);

/* ---------------------------------------------------------------------------
 * Relations
 * ------------------------------------------------------------------------- */

export const captureSessionRelations = relations(captureSession, ({ many, one }) => ({
  chunks: many(audioChunk),
  utterances: many(utterance),
  artifacts: many(artifact),
  user: one(user, { fields: [captureSession.userId], references: [user.id] }),
}));

export const audioChunkRelations = relations(audioChunk, ({ one, many }) => ({
  captureSession: one(captureSession, {
    fields: [audioChunk.captureSessionId],
    references: [captureSession.id],
  }),
  utterances: many(utterance),
}));

export const utteranceRelations = relations(utterance, ({ one }) => ({
  captureSession: one(captureSession, {
    fields: [utterance.captureSessionId],
    references: [captureSession.id],
  }),
  chunk: one(audioChunk, { fields: [utterance.chunkId], references: [audioChunk.id] }),
}));

export const directiveRelations = relations(directive, ({ one }) => ({
  utterance: one(utterance, {
    fields: [directive.utteranceId],
    references: [utterance.id],
  }),
  capability: one(capability, {
    fields: [directive.capabilityId],
    references: [capability.id],
  }),
}));

export const macroProposalRelations = relations(macroProposal, ({ one }) => ({
  replayArtifact: one(artifact, {
    fields: [macroProposal.replayArtifactId],
    references: [artifact.id],
  }),
  capability: one(capability, {
    fields: [macroProposal.capabilityId],
    references: [capability.id],
  }),
}));

export const capabilityRelations = relations(capability, ({ many, one }) => ({
  versions: many(capabilityVersion),
  invocations: many(invocation),
  origin: one(capabilityOrigin, {
    fields: [capability.id],
    references: [capabilityOrigin.capabilityId],
  }),
}));

export const capabilityVersionRelations = relations(capabilityVersion, ({ one }) => ({
  capability: one(capability, {
    fields: [capabilityVersion.capabilityId],
    references: [capability.id],
  }),
}));

export const artifactRelations = relations(artifact, ({ one, many }) => ({
  captureSession: one(captureSession, {
    fields: [artifact.captureSessionId],
    references: [captureSession.id],
  }),
  deliveries: many(exportDelivery),
}));

/* ---------------------------------------------------------------------------
 * Workspace — the balance sheet derived from the transcript ledger
 *
 * The transcript answers "what did I say, when". The workspace answers "what do
 * I currently think about X", by folding an append-only op log:
 *
 *     workspace(T) = fold(ops where occurredAt <= T)
 *
 * Only the ops and the model calls that produced them are stored. Topics and
 * blocks are folded in memory, so time travel and per-drive diffs come for free
 * rather than needing their own tables.
 * ------------------------------------------------------------------------- */

export const workspaceOpTypeEnum = pgEnum("workspace_op_type", [
  "create_topic",
  "rename_topic",
  "merge_topics",
  "add_block",
  "revise_block",
  "retire_block",
  "move_block",
]);

/**
 * One model call: the cache, and the provenance record.
 *
 * Persisting the request and the verbatim response is what makes the workspace
 * deterministic. Rebuilding replays stored extractions and makes no network
 * calls at all; only a deliberate PROMPT_VERSION or model change forces new
 * ones. Keeping `rawResponse` also means a parser fix can re-derive ops without
 * re-paying for — or re-rolling — the model output.
 */
export const extraction = pgTable(
  "extraction",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** sha256(promptVersion, model, temperature, segments, stateDigest). */
    inputHash: text("input_hash").notNull(),
    promptVersion: text("prompt_version").notNull(),
    requestedModel: text("requested_model").notNull(),
    /** What LiteLLM actually used — aliases and fallbacks make these differ. */
    resolvedModel: text("resolved_model").notNull(),
    temperature: text("temperature").notNull(),
    seed: integer("seed"),
    /** The exact utterances fed in, in order. */
    inputSegmentIds: jsonb("input_segment_ids").$type<string[]>().notNull().default([]),
    /** Fingerprint of the carried-forward state it was conditioned on. */
    stateDigest: text("state_digest").notNull(),
    requestMessages: jsonb("request_messages")
      .$type<{ role: string; content: string }[]>()
      .notNull(),
    rawResponse: text("raw_response").notNull(),
    /** Non-null when the response could not be parsed. The row is kept regardless. */
    parseError: text("parse_error"),
    parseWarnings: jsonb("parse_warnings").$type<string[]>().notNull().default([]),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    totalTokens: integer("total_tokens").notNull().default(0),
    latencyMs: integer("latency_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // The cache. Identical input reuses the stored call instead of paying again.
    uniqueIndex("extraction_user_input_hash_idx").on(t.userId, t.inputHash),
    index("extraction_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/**
 * The ledger postings. Append-only.
 *
 * `occurredAt` is absolute wall-clock, not a session offset: the workspace is
 * cumulative across every drive, so all sessions compose onto one timeline and
 * "as of last Tuesday" is a meaningful question.
 */
export const workspaceOp = pgTable(
  "workspace_op",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** Every op traces to the model call that produced it. */
    extractionId: uuid("extraction_id").references(() => extraction.id, {
      onDelete: "cascade",
    }),
    /** Total order, and the deterministic tie-break when two ops share a moment. */
    seq: bigserial("seq", { mode: "number" }).notNull(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    captureSessionId: uuid("capture_session_id").references(() => captureSession.id, {
      onDelete: "set null",
    }),
    type: workspaceOpTypeEnum("type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    sourceUtteranceIds: jsonb("source_utterance_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("workspace_op_user_seq_idx").on(t.userId, t.seq),
    index("workspace_op_user_occurred_idx").on(t.userId, t.occurredAt),
    index("workspace_op_session_idx").on(t.captureSessionId),
  ],
);

/**
 * How far extraction has consumed the transcript.
 *
 * Explicit rather than inferred from `sourceUtteranceIds`: an utterance may
 * legitimately produce no ops — filler, false starts, a Whisper hallucination on
 * silence — and inferring the watermark would reprocess those forever.
 */
export const workspaceCursor = pgTable("workspace_cursor", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  lastUtteranceId: uuid("last_utterance_id"),
  lastOccurredAt: timestamp("last_occurred_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const workspaceOpRelations = relations(workspaceOp, ({ one }) => ({
  extraction: one(extraction, {
    fields: [workspaceOp.extractionId],
    references: [extraction.id],
  }),
  captureSession: one(captureSession, {
    fields: [workspaceOp.captureSessionId],
    references: [captureSession.id],
  }),
}));
