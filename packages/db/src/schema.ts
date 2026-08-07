import { relations } from "drizzle-orm";
import {
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
    /** Active mode/persona at capture time, for reconstructing what was in force. */
    activeModeId: uuid("active_mode_id"),
    activePersonaId: uuid("active_persona_id"),
    deviceInfo: jsonb("device_info").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("capture_session_user_started_idx").on(t.userId, t.startedAt)],
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
    storageKey: text("storage_key").notNull(),
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
