import { relations, sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
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
  /**
   * When the task board was switched on for this person.
   *
   * ON BY DEFAULT since the peer week. It used to be null until a researcher
   * ran an UPDATE, which made the board the study's before/after phase gate —
   * and made every new account experience the system with its most visible
   * capability dark. That is exactly what the first peers reported: "it seemed
   * like an organizer for voice memos". Nothing was wrong; the agent simply
   * had no board to act on, so `BOARD_EDITING` was never composed into the
   * prompt and its four tools were never registered.
   *
   * STILL A TIMESTAMP, not a flag, and still nullable. It keeps recording WHEN
   * somebody got the board, which is what an analysis needs, and a researcher
   * can still null it deliberately. But it is no longer the phase gate: a
   * before/after design needs a mechanism that does not also decide whether a
   * new sign-up sees a working product. Not a Better Auth field.
   */
  boardEnabledAt: timestamp("board_enabled_at", { withTimezone: true }).defaultNow(),
  /**
   * The pseudonym this person carries in the study's analysis, or null for
   * everyone who is not a participant (the researchers, pilots, guests).
   *
   * The analysis joins PostHog events and `study:export` files to people by
   * this and nothing else — never by name or email, which the analysis must
   * not need. Unique so two rows can never claim one participant; set by hand,
   * like `boardEnabledAt`, or with `pnpm study:participant`.
   */
  studyParticipantId: text("study_participant_id").unique(),
  /**
   * The study condition this person's NEXT drives run under, or null for
   * today's behaviour.
   *
   * Only a template. Every drive copies the resolved condition onto its own
   * `capture_session.study_condition` when it opens, so a phase change is one
   * write here — new drives pick it up, drives already recorded keep what
   * they ran under. Shape: `StudyCondition` in @voicemural/shared, validated on
   * the way in by `pnpm study:condition` and on the way out at session insert.
   */
  studyCondition: jsonb("study_condition").$type<Record<string, unknown>>(),
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

/**
 * Which of the three worked examples on `/welcome` a drive was started from.
 *
 * Mirrors `CaptureUseCase` in `@voicemural/shared` — that package owns the wire
 * format, this one the column. See the contract for why a seeded example has to
 * be visible in the data rather than remembered afterwards.
 */
export const captureUseCaseEnum = pgEnum("capture_use_case", [
  "think_aloud",
  "draft",
  "recall",
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

/**
 * Who wrote a draft version.
 *
 * The same two parties `workspace_op.via` already distinguishes — see `OpVia`
 * in `packages/workspace/src/types.ts` — and for the same reason: the study
 * compares what the model produced with what the person did to it afterwards,
 * and that comparison is only possible if each version says which of them it
 * came from. It is also what decides the number: the agent owns the major, the
 * person owns the minor (see `agentDraftVersion`).
 */
export const agentDraftAuthorEnum = pgEnum("agent_draft_author", ["agent", "user"]);

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
     * The post-drive debrief window, in ms into the recording.
     *
     * THE PRIVACY BOUNDARY RUNS THROUGH THESE TWO COLUMNS. `/study` promises
     * that nobody on the research team listens to a drive or reads its
     * transcript; what researchers see is counts and timings. The debrief is
     * the exception the participant is told about — three questions they answer
     * aloud, knowing the answers are read. So the content channel is not a
     * property of a session, it is a property of an INTERVAL inside one, and
     * an export that cannot name the interval cannot honour the promise.
     *
     * Recorded rather than inferred from the clock, because "after Stop" is not
     * a time anyone can reconstruct: the recording continues across it, and the
     * ledger has no seam.
     *
     * `debriefStartedOffsetMs` set with `debriefEndedOffsetMs` still null means
     * a debrief that was never closed — the participant walked away and the
     * idle sweep ended the session. Everything after the start is then the
     * debrief, which is the reading that keeps the promise: it can only ever
     * make the readable window smaller than the truth, never larger.
     *
     * Null on every recording made before the debrief existed, which had none.
     */
    debriefStartedOffsetMs: integer("debrief_started_offset_ms"),
    debriefEndedOffsetMs: integer("debrief_ended_offset_ms"),
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
    /**
     * WHERE THAT SETTING CAME FROM: the device class, the accelerometer, a
     * remembered choice, or the person correcting it before they started.
     *
     * Reported to PostHog since settings existed and stored nowhere, which is
     * why Pilot 01 could be run stationary under the `driving` profile without
     * that being visible in the data. `default` no longer reaches this column
     * from the recorder — a drive with no evidence now asks — but old rows and
     * any other client may still carry it, so it is text rather than an enum
     * and readers treat an unknown value as "not stated".
     */
    settingSource: text("setting_source").$type<
      "device" | "motion" | "remembered" | "chosen" | "default"
    >(),
    /**
     * The worked example this drive was started from, or NULL for a drive
     * begun any other way — which is every drive before `/welcome` existed,
     * and every drive of the longitudinal deployment.
     *
     * Fixed at insert and never updated, exactly like `setting` above: it
     * records the intent the recording began under.
     */
    useCase: captureUseCaseEnum("use_case"),
    /**
     * The ElevenLabs voice the system spoke with, chosen before starting.
     *
     * Text rather than an enum: voices are named by opaque provider ids and the
     * catalogue (`@voicemural/talkback/voice`) will change without a schema
     * migration being the right place to record that. NULL means no choice was
     * made and the container used its `ELEVENLABS_VOICE_ID` fallback — a
     * different fact from having chosen the default, and worth keeping apart.
     */
     voiceId: text("voice_id"),
    /**
     * The transcription language chosen before starting, as a BCP-47 code from
     * `@voicemural/talkback/language`.
     *
     * Text rather than an enum, like `voiceId`: the catalogue will grow
     * without a schema migration being the right place to record that. NULL
     * means no choice was made and BOTH transcription paths auto-detect —
     * "let the ASR figure it out", which is the default and the right one for
     * a mixed corpus, and a different fact from having chosen a language.
     *
     * Read by the live path (`/api/realtime/session` → bot.py) and by the
     * ledger worker (apps/worker/src/jobs/transcribe-chunk.ts), so a drive
     * that stated German is transcribed in German everywhere, not only while
     * talking back.
     */
    sttLanguage: text("stt_language"),
    /**
     * When this drive's speech was folded into the memory index.
     *
     * Set by the worker once the session has ended and its passages are
     * embedded (see apps/worker/src/jobs/index-memory.ts). NULL means not yet,
     * or never — the index is optional and off without MODEL_EMBED. Cleared to
     * re-index after a model change.
     */
    memoryIndexedAt: timestamp("memory_indexed_at", { withTimezone: true }),
    /**
     * The study condition this drive ran under, copied from
     * `user.study_condition` when the session was inserted and never written
     * again — the same rule as `setting` and `voiceId`, for the same reason: a
     * drive whose second half ran under different rules cannot be analysed as
     * either.
     *
     * Stored RESOLVED, defaults filled in, rather than as the sparse template
     * the researcher wrote. A default that changes next month must not
     * reinterpret the drives recorded under the old one.
     *
     * NULL only for drives recorded before conditions existed. Those ran under
     * the container's `PROACTIVE_OFFERS` environment variable, which nothing
     * recorded — say so in the analysis rather than guess.
     */
    studyCondition: jsonb("study_condition").$type<Record<string, unknown>>(),
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
    // worse than not stemming at all. The semantic arm lives in `memory_entry`
    // (pgvector); the lexical arm stays either way, because exact words — a
    // name, a project, a number — are what people actually ask to be reminded of.
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
    // The invoker's queue joins on this: `directivesAwaitingInvocation`
    // left-joins invocation on `triggering_utterance_id` to find directives
    // with no fire yet, and `pendingConfirmation` inner-joins it. Without an
    // index both scan the whole invocation history per sweep.
    index("invocation_triggering_utterance_idx").on(t.triggeringUtteranceId),
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
    /**
     * Whether `endOffsetMs` was MEASURED or estimated.
     *
     * It was always an estimate — `len(text) / 14`, about fourteen characters a
     * second — because the container never learned when playback ended. On the
     * first formative pilot that overstated the agent's measured speech by
     * about 8%, and every duration on `/sessions/[id]` carried a `~` because
     * nothing could honestly say otherwise.
     *
     * Now the container waits for the output transport's own
     * `BotStoppedSpeakingFrame` before writing the row, and a barge-in has been
     * measured at the interruption all along. This column is what keeps the two
     * kinds apart, because a fallback still happens: a turn whose audio ran
     * together with a keep-alive's has no matched start and stop of its own,
     * and the estimate stands. An analysis that mixes them without filtering on
     * this is measuring the fallback as if it were a stopwatch.
     *
     * False for every row written before this existed, which is what they were.
     */
    endOffsetMeasured: boolean("end_offset_measured").notNull().default(false),
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

/**
 * What prompted the model to consider a turn.
 *
 * `macro_offer` and `agenda` are written by nothing yet. They are the study's
 * two varied behaviours (EVALUATION_PLAN.md T2.5, T2.8), declared now so the
 * migration that brings them in does not also have to alter a type in use.
 */
export const agentDecisionTriggerEnum = pgEnum("agent_decision_trigger", [
  "user_turn",
  "opening",
  "silence_offer",
  "confirmation",
  "macro_offer",
  "agenda",
]);

/**
 * What the turn became.
 *
 * No `error`. A completion that fails raises an ErrorFrame that Pipecat sends
 * UPSTREAM, away from the gate that writes these rows, so the container cannot
 * tell a failed turn from one still in flight. Add the value together with a
 * writer that can observe it, not before.
 */
export const agentDecisionOutcomeEnum = pgEnum("agent_decision_outcome", [
  "spoke",
  "declined",
  "interrupted",
]);

/**
 * Every moment the model was given to speak, and what it did with it.
 * Append-only.
 *
 * A SEPARATE TABLE FROM `agent_turn`, for the reason `agent_turn` is separate
 * from `utterance`: `agent_turn` is the echo filter's only input, and a row in
 * it asserts that audio reached the speaker. A declined turn produced no audio.
 * Writing one there would teach the filter to discard the driver's speech for
 * matching words the car never heard.
 *
 * Yet the declines are the data. A silence the agent chose is how guideline G3
 * (time services to the task) shows up in a drive; an offer it made and the
 * driver talked over is G8 (efficient dismissal); and "a declined offer is
 * never repeated" is a rule that can only be kept against a stored record of
 * the decline. Before this table all of it was a log line.
 *
 * ONE ROW PER COMPLETION, NOT PER MOMENT — and the difference is the counting
 * rule this table has to state, because it is a measurement instrument.
 *
 * Pipecat's user aggregator may run inference MORE THAN ONCE inside one user
 * turn: `_on_user_turn_inference_triggered` pushes the aggregation it has so
 * far and starts a completion, and `_maybe_emit_user_turn_stopped` pushes
 * again at the end of the turn ("so multiple inferences in the same turn don't
 * lose earlier segments"). The first sees a half-finished sentence, which the
 * prompt correctly tells the model to answer with `<silence>`; the second sees
 * the whole thing and speaks. Both are real completions, both are decisions,
 * and both belong here — but they are ONE moment the agent was given.
 *
 * On the first formative pilot (19 Sep 2026) that made sixteen of forty-eight
 * rows share an `offset_ms` with another, and in five of those pairs the first
 * declined in about 400ms and the second spoke. Counted by row the decline rate
 * was 69%; counted by moment it was 53%, and nothing in the table said which
 * number the log supported.
 *
 * SO COUNT MOMENTS WITH `opportunity_seq`, NOT ROWS. Every row carries the
 * moment it belongs to and its `attempt` within it:
 *
 *   -- how often the agent was given a moment
 *   select count(distinct opportunity_seq) ...
 *   -- what it did with each, one row per moment
 *   select distinct on (opportunity_seq) * ... order by opportunity_seq, attempt desc
 *
 * The AUTHORITATIVE outcome of a moment is its LAST attempt: the completion
 * that spoke is what the driver experienced, and an earlier decline on a
 * sentence that was not finished yet is a step on the way to it, not a separate
 * silence they sat through.
 *
 * Deliberately not fixed by suppressing the second dispatch. How a turn ends is
 * the paper's independent variable, and `user_turn_stop_timeout` is one of the
 * dials on it (TALKBACK.md → Latency); a container that quietly ran one
 * inference where Pipecat runs two would be a different system from the one
 * being measured.
 *
 * A spoken or interrupted row points at its `agent_turn` when that write
 * succeeded first.
 */
export const agentDecision = pgTable(
  "agent_decision",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    captureSessionId: uuid("capture_session_id")
      .notNull()
      .references(() => captureSession.id, { onDelete: "cascade" }),
    /**
     * Monotonic per connection, not per drive: a reconnect restarts it, as it
     * restarts `agent_turn.seq`. Order by `offsetMs` when reading a drive.
     * Not unique for the same reason.
     */
    seq: integer("seq").notNull(),
    /**
     * When the moment arose — the driver's final words, or the offer timer
     * firing — as ms into the drive, on the `utterance` clock.
     */
    offsetMs: integer("offset_ms").notNull(),
    /**
     * The MOMENT this decision belongs to, monotonic per connection.
     *
     * Rows sharing it came from one cue — the same words, or the same firing of
     * the offer timer — and are the several completions Pipecat ran over it.
     * This is what makes the log countable without collapsing duplicates by
     * hand; see the counting rule above. Null on rows written before it
     * existed, which have to be deduplicated on `offset_ms` as before.
     */
    opportunitySeq: integer("opportunity_seq"),
    /**
     * Which completion this was within that moment, from 0.
     *
     * The last one is the authoritative outcome. Kept rather than derived from
     * `seq` because a decision is not always written for every completion — a
     * decline the container refuses and re-runs (see `AnswerGuard` in bot.py)
     * writes none at all, so gaps in `seq` are not gaps in attempts.
     */
    attempt: integer("attempt").notNull().default(0),
    trigger: agentDecisionTriggerEnum("trigger").notNull(),
    outcome: agentDecisionOutcomeEnum("outcome").notNull(),
    /** `TALKBACK_CONFIG_VERSION` of the prompt the container was running. */
    configVersion: text("config_version"),
    /**
     * From the moment to the first word released to speech; for a decline,
     * to the end of the completion that declined. Null when unmeasured.
     */
    latencyMs: integer("latency_ms"),
    /**
     * What the moment was ABOUT, when it was about one thing: the invocation
     * id for a confirmation, the proposal id for a macro offer, a topic key for
     * an agenda offer. The key "never offer a declined subject again" is kept
     * against, which is why it is indexed.
     */
    subjectKey: text("subject_key"),
    /**
     * Whether `AnswerGuard` had to force this moment.
     *
     * The guard refuses to let a completion decline an answer the agent itself
     * asked for, and writes NO decision for the refusal — their words were one
     * moment to speak, and the re-run is what that moment became. Which is
     * right, and leaves the guard invisible: a re-run that speaks looks exactly
     * like a first completion that spoke.
     *
     * This is the mark on the moment that says it needed forcing. The study's
     * unanswered-answer count is the share of moments carrying it, and its
     * target is zero — a number that could never be anything else would
     * measure nothing. See `note_forced_answer` in bot.py.
     */
    forcedAnswer: boolean("forced_answer").notNull().default(false),
    agentTurnId: uuid("agent_turn_id").references(() => agentTurn.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("agent_decision_session_offset_idx").on(t.captureSessionId, t.offsetMs),
    // How the export reads a drive: one moment at a time, attempts in order.
    index("agent_decision_session_opportunity_idx").on(
      t.captureSessionId,
      t.opportunitySeq,
      t.attempt,
    ),
    // The context route counts asks per pending invocation on the turn path.
    index("agent_decision_session_subject_idx")
      .on(t.captureSessionId, t.subjectKey)
      .where(sql`${t.subjectKey} is not null`),
  ],
);

export const agentDecisionRelations = relations(agentDecision, ({ one }) => ({
  captureSession: one(captureSession, {
    fields: [agentDecision.captureSessionId],
    references: [captureSession.id],
  }),
  agentTurn: one(agentTurn, {
    fields: [agentDecision.agentTurnId],
    references: [agentTurn.id],
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
    // `appendOps` counts ops per extraction on every append, and the FK
    // cascade from `clearExtractions` deletes by it — both sequential scans
    // without this.
    index("workspace_op_extraction_idx").on(t.extractionId),
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

/**
 * Text the agent handed the person to keep, rather than said to them.
 *
 * Its own table, not a `kind` on `agent_turn`. A draft is not a turn: nothing
 * was spoken, so it has no `endOffsetMs`, no barge-in, no latency columns, and
 * — crucially — the echo filter must never see it. `agent_turn` exists so
 * `withoutEcho` can tell the agent's voice from the driver's, and a draft that
 * was never played through a speaker cannot be echoed. Putting it there would
 * teach the filter to delete the participant's own words whenever they happened
 * to resemble a draft they asked for.
 *
 * Durable on purpose. The point of a draft is copying it later, which usually
 * means after the drive, from a different device — so it outlives the
 * conversation exactly the way the ledger does.
 *
 * LINEAGE, NOT CONTENT. This row is the draft's IDENTITY — which drive it came
 * from, where in it, and which request produced the first version — and it is
 * never updated. Everything that can change lives in `agent_draft_version`,
 * one append-only row per version, exactly the split `capability` /
 * `capability_version` already uses. Nothing reads `title`/`text` here any
 * more: they are still written, as a frozen copy of v1.0, because the append-
 * only rule says a column that recorded what the agent produced does not stop
 * recording it just because a better home exists.
 */
export const agentDraft = pgTable(
  "agent_draft",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    captureSessionId: uuid("capture_session_id")
      .notNull()
      .references(() => captureSession.id, { onDelete: "cascade" }),
    /** Monotonic within a drive, from the container's own counter. */
    seq: integer("seq").notNull(),
    /** Session-relative, same clock as `utterance` and `agent_turn`. */
    startOffsetMs: integer("start_offset_ms").notNull(),
    /** The tag's `title`. Empty when the model omitted one. */
    title: text("title").notNull().default(""),
    /** The draft body, verbatim. Markdown allowed: this is read, never spoken. */
    text: text("text").notNull(),
    /** The user turn that asked for it, for reading the two back together. */
    respondingToText: text("responding_to_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per (drive, seq): the container retries a failed POST, and a
    // retry must not leave two copies of the same draft on the screen.
    uniqueIndex("agent_draft_session_seq_idx").on(t.captureSessionId, t.seq),
    index("agent_draft_session_idx").on(t.captureSessionId),
  ],
);

/**
 * Every version a draft has ever had, newest LAST by number rather than by time.
 *
 * WHY VERSIONS AT ALL. A draft is the one thing on the screen the person asked
 * for by name, and the first answer is rarely the one they send. Before this,
 * a draft was insert-only: "make it shorter" produced a SECOND card, the first
 * one stayed on the page looking equally current, and a typo in a name could
 * only be fixed by copying the text somewhere else. Both of those lose the
 * thing the feature is for.
 *
 * NUMBERING SAYS WHO. The agent owns the major and the person owns the minor:
 * the agent's first draft is v1.0, the person editing it gives v1.1, an agent
 * rewrite gives v2.0, a later edit of that gives v2.1. So the label is not
 * decoration — read off a card weeks later it says, without any extra column
 * being consulted, how many times the model rewrote this and how much hand
 * editing each of its attempts needed. That is the measurement the study wants
 * out of drafts, and it is free.
 *
 * THE NEWEST VERSION IS ALWAYS THE CURRENT ONE. A restore does not move a
 * pointer back; it APPENDS a copy of the restored version with the next number
 * and records what it came from, so restoring v1.1 while at v1.3 gives v1.4.
 * The record stays append-only (EVALUATION_PLAN.md §4), and "what did they end
 * up with" is `order by (major, minor) desc limit 1` rather than a flag that
 * two writers can disagree about.
 *
 * ORDERED BY `(major, minor)`, NEVER BY `createdAt`. Clock skew between the
 * web app and the container, or two versions inside the same millisecond, would
 * otherwise be able to make an older version look current.
 */
export const agentDraftVersion = pgTable(
  "agent_draft_version",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    draftId: uuid("draft_id")
      .notNull()
      .references(() => agentDraft.id, { onDelete: "cascade" }),
    /** Bumped by an agent rewrite. See the numbering note above. */
    major: integer("major").notNull(),
    /** Bumped by a person's edit, and reset to 0 by each agent rewrite. */
    minor: integer("minor").notNull(),
    author: agentDraftAuthorEnum("author").notNull(),
    /** The tag's `title`, or the person's. Empty when neither supplied one. */
    title: text("title").notNull().default(""),
    /** The body, verbatim. Markdown allowed: this is read, never spoken. */
    text: text("text").notNull(),
    /**
     * The version this one was restored from, when it was a restore.
     *
     * Self-referencing, so the column's type is only known once the table is,
     * which is what `AnyPgColumn` is for. `set null` rather than cascade: a
     * version is never deleted today, and if one ever were, losing the
     * provenance label is better than losing the restored text with it.
     */
    restoredFromVersionId: uuid("restored_from_version_id").references(
      (): AnyPgColumn => agentDraftVersion.id,
      { onDelete: "set null" },
    ),
    /**
     * What was said to get THIS version, when the agent wrote it.
     *
     * On v1.0 it is the request that produced the draft; on an agent rewrite it
     * is the change they asked for ("make it shorter"). Per version rather than
     * per draft because that is the only way to read a rewrite back against the
     * instruction it was following. Null on a person's edit — they did not ask
     * anybody for it — and on a restore.
     */
    respondingToText: text("responding_to_text"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One row per (draft, major, minor). Two writers racing on the same number
    // — the person's Save and the agent's rewrite landing together — must lose
    // one of them at the database rather than leave two rows claiming to be
    // v2.0. `appendDraftVersion` takes a row lock as well, so this is the
    // backstop rather than the mechanism.
    uniqueIndex("agent_draft_version_number_idx").on(t.draftId, t.major, t.minor),
    index("agent_draft_version_draft_idx").on(t.draftId),
  ],
);

/* ---------------------------------------------------------------------------
 * Memory
 *
 * What talk-back can be reminded of across drives, by MEANING rather than by
 * word. Two kinds of entry share one table because they are searched the same
 * way and differ only in what the text is:
 *
 *   passage  a stretch of one past drive's transcript — the same 20-40 second
 *            window lexical recall quotes, embedded once the drive has ended
 *            and echo- and hallucination-filtered at index time, so a read
 *            never has to clean it again.
 *   topic    where things stand on one workspace topic: its current claims,
 *            open questions and tasks, rendered from the fold. Re-embedded
 *            whenever the rendering's hash changes, so the entry is always the
 *            latest state and never a history.
 *
 * DERIVED, never authoritative. Everything here can be rebuilt from `utterance`
 * and `workspace_op`; `pnpm memory:reindex` does exactly that. Nothing reads it
 * but recall.
 *
 * The vector column is UNTYPED on purpose. Embedding models disagree on
 * dimension, the likely choice here is self-hosted, and pinning 1536 in a
 * migration would make a model change a schema change. The cost is that no
 * HNSW/IVF index can be built — pgvector needs a dimension for that — so
 * search is an exact scan. At one passage per ~40s of speech that is a few
 * thousand rows for a whole study, which Postgres scans in milliseconds.
 * `model` is stored per row and search is restricted to the current model, so
 * a switch leaves no mixed-dimension comparison and a re-index replaces rows
 * as it goes.
 * ------------------------------------------------------------------------- */

export const memoryKindEnum = pgEnum("memory_kind", ["passage", "topic"]);

/** pgvector's `vector` with no dimension — see the note above. */
const untypedVector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return value
      .slice(1, -1)
      .split(",")
      .map((n) => Number(n));
  },
});

export const memoryEntry = pgTable(
  "memory_entry",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: memoryKindEnum("kind").notNull(),
    /**
     * What this entry stands for: `<captureSessionId>:<startOffsetMs>` for a
     * passage, the topic id for a topic. Unique per user and kind, which is
     * what makes re-indexing an upsert.
     */
    refId: text("ref_id").notNull(),
    /** The drive a passage came from. Null for a topic, which spans drives. */
    captureSessionId: uuid("capture_session_id").references(() => captureSession.id, {
      onDelete: "cascade",
    }),
    /** When the speech behind it was said (passage) or the topic last moved. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    /** The text that was embedded, already cleaned. Quoted back verbatim. */
    text: text("text").notNull(),
    /** Of `text`. A topic is re-embedded only when this changes. */
    contentHash: text("content_hash").notNull(),
    /** The model that produced `embedding`. Search matches on this. */
    model: text("model").notNull(),
    embedding: untypedVector("embedding").notNull(),
    utteranceIds: jsonb("utterance_ids").$type<string[]>().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("memory_entry_user_kind_ref_idx").on(t.userId, t.kind, t.refId),
    index("memory_entry_user_kind_model_idx").on(t.userId, t.kind, t.model),
    index("memory_entry_session_idx").on(t.captureSessionId),
  ],
);
/* ---------------------------------------------------------------------------
 * Study measures
 *
 * The three tables the relief measures need, and the reason they are tables
 * rather than PostHog events: the analysis has to join them to a drive and to
 * a board card, and it has to be reproducible from one export months later.
 *
 * ALL THREE ARE COUNTS. A rating is an integer on a stated scale, an outcome
 * is one of three words this file names, an event is a kind and a timestamp.
 * Nothing here holds anything a participant said or wrote, so the whole of it
 * crosses the privacy boundary (`apps/worker/src/study/export.ts`) unchanged.
 * ------------------------------------------------------------------------- */

/**
 * When a rating was taken, relative to the drive it is about.
 *
 * `pre` and `post` bracket one session — the same item asked twice is what
 * makes a change in mental load readable at all. `day7` is the review at the
 * end of the week, which is about the week rather than about a session, and
 * so carries no `captureSessionId`.
 */
export const studyResponsePhaseEnum = pgEnum("study_response_phase", ["pre", "post", "day7"]);

/**
 * A single rating, one row per item per asking.
 *
 * `item` is a short stable key (`mental_load`, `liveness_perceived`,
 * `can_correct`) rather than the question's text, so rewording a question does
 * not fork the series — the wording lives in
 * `packages/shared/src/study-items.ts`, versioned with the prompt.
 *
 * `value` is the point on the scale. `scaleMax` is stored beside it rather
 * than assumed, because a 1–7 item read as 1–5 two months later is a silent
 * error no constraint would catch.
 */
export const studyResponse = pgTable(
  "study_response",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The drive this brackets. Null for `day7`, which is about the week. */
    captureSessionId: uuid("capture_session_id").references(() => captureSession.id, {
      onDelete: "cascade",
    }),
    phase: studyResponsePhaseEnum("phase").notNull(),
    item: text("item").notNull(),
    value: integer("value").notNull(),
    scaleMax: integer("scale_max").notNull().default(7),
    respondedAt: timestamp("responded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One answer per item per phase per drive: a re-tap corrects the answer
    // rather than adding a second one, which is what makes a pre/post pair
    // countable without deduplication in the analysis.
    uniqueIndex("study_response_session_phase_item_idx").on(
      t.userId,
      t.captureSessionId,
      t.phase,
      t.item,
    ),
    // And the same rule for an answer that belongs to no drive — the day-7
    // review is about the week. A SECOND index, because Postgres treats two
    // nulls in a unique index as distinct, so the one above does not
    // constrain these rows at all: without this, two taps arriving together
    // both insert and the week has two answers to one question.
    uniqueIndex("study_response_phase_item_idx")
      .on(t.userId, t.phase, t.item)
      .where(sql`${t.captureSessionId} is null`),
    index("study_response_user_at_idx").on(t.userId, t.respondedAt),
  ],
);

/**
 * What became of one board item at the day-7 review: done, still open, or lost.
 *
 * `lost` is the primary failure measure for offloading, and it is defined
 * behaviourally, not by feeling: never revisited and not acted on. A system
 * that writes many items to the board and never brings them back produces a
 * high lost rate however good its latency looks.
 */
export const studyItemOutcomeEnum = pgEnum("study_item_outcome", ["done", "open", "lost"]);

export const studyItemReview = pgTable(
  "study_item_review",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    /** The card's stable identity: the root of its revision chain. */
    cardId: text("card_id").notNull(),
    /** The drive the review itself was recorded in, when it had one. */
    captureSessionId: uuid("capture_session_id").references(() => captureSession.id, {
      onDelete: "set null",
    }),
    outcome: studyItemOutcomeEnum("outcome").notNull(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // One verdict per card per review round. A correction replaces it.
    uniqueIndex("study_item_review_user_card_idx").on(t.userId, t.cardId),
    index("study_item_review_user_at_idx").on(t.userId, t.reviewedAt),
  ],
);

/**
 * Everything days 2–6 are allowed to record: that something was opened.
 *
 * Dictations and edits are already in `workspace_op`, so this table exists for
 * the one thing that leaves no other trace — the participant opening the board
 * or a card to look at it. That is the behaviour "revisit" is about, and
 * without it a card someone re-read every morning and never edited is
 * indistinguishable from one nobody ever saw again.
 */
export const studyEventKindEnum = pgEnum("study_event_kind", ["board_open", "card_open"]);

export const studyEvent = pgTable(
  "study_event",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    kind: studyEventKindEnum("kind").notNull(),
    /** The card, for `card_open`. Null for `board_open`. */
    cardId: text("card_id"),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("study_event_user_at_idx").on(t.userId, t.occurredAt),
    index("study_event_user_card_idx").on(t.userId, t.cardId).where(sql`${t.cardId} is not null`),
  ],
);
