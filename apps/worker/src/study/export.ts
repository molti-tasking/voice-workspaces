/**
 * One participant's study record, as lines the analysis can read — and nothing
 * the privacy boundary forbids.
 *
 * THE BOUNDARY. The participant sheet (/study) promises that nobody on the
 * research team listens to a drive or reads a transcript: what researchers see
 * is counts and timings. So this export carries counts, timings, ids, enums and
 * lengths, and no free text from any table — not the transcript, not what the
 * agent said, not the workspace, not a direction's restatement.
 *
 * HOW IT HOLDS BY CONSTRUCTION, not by care:
 * - Every query names its columns. Nothing is `select()`ed whole, so a text
 *   column added to a table next month does not start flowing out of here.
 * - Lengths are computed IN SQL. The text is never fetched into this process
 *   for the default export, so no later edit to a mapper can leak it.
 * - The test seeds a sentinel into every free-text column and fails if it
 *   appears anywhere in the output.
 *
 * `includeText` exists for one purpose: the researcher's own pilot account,
 * where reading the words is the point of piloting. The script refuses it for
 * anyone not on `STUDY_PILOT_USER_IDS`.
 *
 * Shape: one JSON object per line, discriminated by `type`. `EXPORT_VERSION`
 * is on the first line; bump it when a record changes shape.
 */
import { asc, eq, getDb, inArray, isNotNull, sql } from "@voicemural/db";
import {
  agentDecision,
  agentTurn,
  capability,
  capabilityOrigin,
  capabilityVersion,
  captureSession,
  directive,
  interactionRating,
  invocation,
  macroProposal,
  user,
  utterance,
  workspaceOp,
} from "@voicemural/db/schema";
import { loadOps } from "@voicemural/db/workspace";
import { KEPT_AFTER_SESSIONS, foldBoard, judge } from "@voicemural/workspace";

export const EXPORT_VERSION = 1;

export type ExportRecord = { type: string } & Record<string, unknown>;

export interface ExportOptions {
  /** Pilot accounts only. See the header. */
  includeText?: boolean;
  now?: Date;
}

/** Word count of a text column, in SQL, so the text itself stays in Postgres. */
function words(column: unknown) {
  return sql<number>`coalesce(array_length(regexp_split_to_array(nullif(btrim(${column}), ''), '\\s+'), 1), 0)::int`;
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function exportParticipant(
  userId: string,
  options: ExportOptions = {},
): Promise<ExportRecord[]> {
  const db = getDb();
  const now = options.now ?? new Date();
  const text = options.includeText === true;
  const out: ExportRecord[] = [];

  const [person] = await db
    .select({
      id: user.id,
      studyParticipantId: user.studyParticipantId,
      studyCondition: user.studyCondition,
      boardEnabledAt: user.boardEnabledAt,
      isAnonymous: user.isAnonymous,
      createdAt: user.createdAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!person) throw new Error(`no user ${userId}`);

  out.push({
    type: "participant",
    exportVersion: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    includesText: text,
    userId: person.id,
    participantId: person.studyParticipantId,
    // The template for the NEXT drive; each session below carries its own.
    currentCondition: person.studyCondition,
    boardEnabledAt: iso(person.boardEnabledAt),
    isGuest: person.isAnonymous,
    createdAt: iso(person.createdAt),
  });

  /* Sessions ----------------------------------------------------------------- */

  const sessions = await db
    .select({
      id: captureSession.id,
      startedAt: captureSession.startedAt,
      endedAt: captureSession.endedAt,
      endedBy: captureSession.endedBy,
      setting: captureSession.setting,
      voiceId: captureSession.voiceId,
      sttLanguage: captureSession.sttLanguage,
      studyCondition: captureSession.studyCondition,
    })
    .from(captureSession)
    .where(eq(captureSession.userId, userId))
    .orderBy(asc(captureSession.startedAt));
  const sessionIds = sessions.map((s) => s.id);
  const ended = new Map(sessions.map((s) => [s.id, s.endedAt !== null]));

  for (const s of sessions) {
    out.push({
      type: "session",
      sessionId: s.id,
      startedAt: iso(s.startedAt),
      endedAt: iso(s.endedAt),
      durationMs: s.endedAt ? s.endedAt.getTime() - s.startedAt.getTime() : null,
      endedBy: s.endedBy,
      setting: s.setting,
      voiceId: s.voiceId,
      sttLanguage: s.sttLanguage,
      // Null for drives recorded before conditions existed — not "defaults".
      studyCondition: s.studyCondition,
    });
  }

  if (sessionIds.length > 0) {
    /* The ledger ------------------------------------------------------------- */

    const utterances = await db
      .select({
        id: utterance.id,
        sessionId: utterance.captureSessionId,
        startOffsetMs: utterance.startOffsetMs,
        endOffsetMs: utterance.endOffsetMs,
        kind: utterance.kind,
        kindOverride: utterance.kindOverride,
        kindConfidence: utterance.kindConfidence,
        wordCount: words(utterance.text),
        charCount: sql<number>`char_length(${utterance.text})::int`,
        ...(text ? { text: utterance.text } : {}),
      })
      .from(utterance)
      .where(inArray(utterance.captureSessionId, sessionIds))
      .orderBy(asc(utterance.captureSessionId), asc(utterance.startOffsetMs));

    for (const u of utterances) {
      out.push({
        type: "utterance",
        utteranceId: u.id,
        sessionId: u.sessionId,
        startOffsetMs: u.startOffsetMs,
        endOffsetMs: u.endOffsetMs,
        // What the pipeline acted on, and the two halves it came from.
        kind: u.kindOverride ?? u.kind,
        classifiedKind: u.kind,
        kindOverride: u.kindOverride,
        kindConfidence: u.kindConfidence,
        wordCount: u.wordCount,
        charCount: u.charCount,
        ...(text ? { text: u.text } : {}),
      });
    }

    /* The conversation ------------------------------------------------------- */

    const turns = await db
      .select({
        id: agentTurn.id,
        sessionId: agentTurn.captureSessionId,
        seq: agentTurn.seq,
        kind: agentTurn.kind,
        startOffsetMs: agentTurn.startOffsetMs,
        endOffsetMs: agentTurn.endOffsetMs,
        bargedIn: agentTurn.bargedIn,
        truncatedAtMs: agentTurn.truncatedAtMs,
        asrMs: agentTurn.asrMs,
        ttftMs: agentTurn.ttftMs,
        speakTtfbMs: agentTurn.speakTtfbMs,
        totalLatencyMs: agentTurn.totalLatencyMs,
        promptTokens: agentTurn.promptTokens,
        completionTokens: agentTurn.completionTokens,
        requestedModel: agentTurn.requestedModel,
        resolvedModel: agentTurn.resolvedModel,
        configVersion: agentTurn.configVersion,
        hasError: sql<boolean>`${agentTurn.error} is not null`,
        spokenWordCount: words(agentTurn.text),
        generatedWordCount: words(agentTurn.generatedText),
        respondingToWordCount: words(agentTurn.respondingToText),
        ...(text
          ? {
              text: agentTurn.text,
              generatedText: agentTurn.generatedText,
              respondingToText: agentTurn.respondingToText,
            }
          : {}),
      })
      .from(agentTurn)
      .where(inArray(agentTurn.captureSessionId, sessionIds))
      .orderBy(asc(agentTurn.captureSessionId), asc(agentTurn.startOffsetMs));

    for (const t of turns) {
      const { id, ...rest } = t;
      out.push({ type: "agent_turn", agentTurnId: id, ...rest });
    }

    const decisions = await db
      .select({
        id: agentDecision.id,
        sessionId: agentDecision.captureSessionId,
        seq: agentDecision.seq,
        offsetMs: agentDecision.offsetMs,
        trigger: agentDecision.trigger,
        outcome: agentDecision.outcome,
        configVersion: agentDecision.configVersion,
        latencyMs: agentDecision.latencyMs,
        subjectKey: agentDecision.subjectKey,
        agentTurnId: agentDecision.agentTurnId,
      })
      .from(agentDecision)
      .where(inArray(agentDecision.captureSessionId, sessionIds))
      .orderBy(asc(agentDecision.captureSessionId), asc(agentDecision.offsetMs));

    for (const d of decisions) {
      const { id, ...rest } = d;
      out.push({ type: "agent_decision", decisionId: id, ...rest });
    }

    /* What they said about it, when they asked to ---------------------------- */
    //
    // The only self-report in the export, and the only measure here that is not
    // behavioural: everything else says what somebody did, this says what they
    // thought of it, at the moment they thought it rather than at a debrief
    // twenty minutes later. Whole rows, including the probes that produced no
    // number — a channel people trigger and cannot finish is the finding, and
    // an export of successful ratings only would hide it.
    //
    // Nothing to redact: the table has never held text (see `interaction_rating`
    // in the schema), so this is the same shape with or without `--include-text`.
    const ratings = await db
      .select({
        id: interactionRating.id,
        sessionId: interactionRating.captureSessionId,
        seq: interactionRating.seq,
        askedOffsetMs: interactionRating.askedOffsetMs,
        answeredOffsetMs: interactionRating.answeredOffsetMs,
        endedOffsetMs: interactionRating.endedOffsetMs,
        rating: interactionRating.rating,
        outcome: interactionRating.outcome,
        // The turn it was about, so a rating joins to what was just said.
        agentTurnId: interactionRating.agentTurnId,
        configVersion: interactionRating.configVersion,
        createdAt: interactionRating.createdAt,
      })
      .from(interactionRating)
      .where(inArray(interactionRating.captureSessionId, sessionIds))
      .orderBy(asc(interactionRating.captureSessionId), asc(interactionRating.askedOffsetMs));

    for (const r of ratings) {
      const { id, createdAt, ...rest } = r;
      out.push({ type: "interaction_rating", ratingId: id, ...rest, createdAt: iso(createdAt) });
    }

    /* Directions and what they fired ----------------------------------------- */

    const directives = await db
      .select({
        utteranceId: directive.utteranceId,
        sessionId: directive.captureSessionId,
        // One classifier-chosen word ("mark", "send"), the operation's name.
        verb: directive.verb,
        capabilityId: directive.capabilityId,
        confidence: directive.confidence,
        createdAt: directive.createdAt,
        ...(text ? { object: directive.object, restatement: directive.restatement } : {}),
      })
      .from(directive)
      .where(inArray(directive.captureSessionId, sessionIds))
      .orderBy(asc(directive.createdAt));

    for (const d of directives) {
      out.push({ type: "directive", ...d, createdAt: iso(d.createdAt) });
    }

    const invocations = await db
      .select({
        id: invocation.id,
        capabilityId: invocation.capabilityId,
        capabilityVersionId: invocation.capabilityVersionId,
        sessionId: invocation.captureSessionId,
        triggeringUtteranceId: invocation.triggeringUtteranceId,
        firedAt: invocation.firedAt,
        confirmed: invocation.confirmed,
        reverted: invocation.reverted,
        latencyMs: invocation.latencyMs,
        hasError: sql<boolean>`${invocation.error} is not null`,
      })
      .from(invocation)
      .where(inArray(invocation.captureSessionId, sessionIds))
      .orderBy(asc(invocation.firedAt));

    // How often each was asked about aloud — an ask is a decision about the
    // invocation whose turn was a confirmation request (see pendingConfirmation).
    const asks = new Map<string, number>();
    const turnKind = new Map(turns.map((t) => [t.id, t.kind]));
    for (const d of decisions) {
      if (d.subjectKey && d.trigger === "confirmation" && d.agentTurnId) {
        if (turnKind.get(d.agentTurnId) === "confirmation_request") {
          asks.set(d.subjectKey, (asks.get(d.subjectKey) ?? 0) + 1);
        }
      }
    }

    for (const i of invocations) {
      out.push({
        type: "invocation",
        invocationId: i.id,
        capabilityId: i.capabilityId,
        capabilityVersionId: i.capabilityVersionId,
        sessionId: i.sessionId,
        triggeringUtteranceId: i.triggeringUtteranceId,
        firedAt: iso(i.firedAt),
        confirmed: i.confirmed,
        reverted: i.reverted,
        latencyMs: i.latencyMs,
        hasError: i.hasError,
        timesAsked: asks.get(i.id) ?? 0,
        status: invocationStatus(i, i.sessionId ? ended.get(i.sessionId) === true : true),
      });
    }
  }

  /* The repertoire ----------------------------------------------------------- */

  const capabilities = await db
    .select({
      id: capability.id,
      capabilityType: capability.type,
      createdAt: capability.createdAt,
      retiredAt: capability.retiredAt,
      createdVia: capabilityOrigin.createdVia,
      triggeringSessionId: capabilityOrigin.triggeringSessionId,
      versionCount: sql<number>`(select count(*)::int from ${capabilityVersion} where ${capabilityVersion.capabilityId} = ${capability.id})`,
    })
    .from(capability)
    .leftJoin(capabilityOrigin, eq(capabilityOrigin.capabilityId, capability.id))
    .where(eq(capability.userId, userId))
    .orderBy(asc(capability.createdAt));

  for (const c of capabilities) {
    const { id, ...rest } = c;
    out.push({
      type: "capability",
      capabilityId: id,
      ...rest,
      createdAt: iso(c.createdAt),
      retiredAt: iso(c.retiredAt),
    });
  }

  const proposals = await db
    .select({
      id: macroProposal.id,
      status: macroProposal.status,
      createdAt: macroProposal.createdAt,
      decidedAt: macroProposal.decidedAt,
      sessionCount: macroProposal.sessionCount,
      occurrenceCount: sql<number>`jsonb_array_length(${macroProposal.occurrences})::int`,
      // The one name allowed out: /study tells participants the names of
      // things are seen. `canonicalForm` is NOT — it is built from their words.
      proposedName: macroProposal.proposedName,
      capabilityId: macroProposal.capabilityId,
    })
    .from(macroProposal)
    .where(eq(macroProposal.userId, userId))
    .orderBy(asc(macroProposal.createdAt));

  for (const p of proposals) {
    const { id, ...rest } = p;
    out.push({
      type: "macro_proposal",
      proposalId: id,
      ...rest,
      createdAt: iso(p.createdAt),
      decidedAt: iso(p.decidedAt),
      msToDecision: p.decidedAt ? p.decidedAt.getTime() - p.createdAt.getTime() : null,
    });
  }

  /* The workspace, as op shapes ---------------------------------------------- */

  const ops = await db
    .select({
      id: workspaceOp.id,
      seq: workspaceOp.seq,
      opType: workspaceOp.type,
      sessionId: workspaceOp.captureSessionId,
      occurredAt: workspaceOp.occurredAt,
      extractionId: workspaceOp.extractionId,
      sourceUtteranceCount: sql<number>`jsonb_array_length(${workspaceOp.sourceUtteranceIds})::int`,
      // Enum fields of the payload only. Titles, text, labels and icons are
      // the workspace's content and stay in the database.
      blockKind: sql<string | null>`${workspaceOp.payload}->>'kind'`,
      taskState: sql<string | null>`${workspaceOp.payload}->>'state'`,
      via: sql<string>`coalesce(${workspaceOp.payload}->>'via', 'speech')`,
    })
    .from(workspaceOp)
    .where(eq(workspaceOp.userId, userId))
    .orderBy(asc(workspaceOp.seq));

  for (const o of ops) {
    const { id, ...rest } = o;
    out.push({ type: "workspace_op", opId: id, ...rest, occurredAt: iso(o.occurredAt) });
  }

  /* The board's acceptance measure (T3.3) ------------------------------------- */
  //
  // Computed on read, as the board page computes it — the same fold, the same
  // judge, the same threshold — because it is stored nowhere. The fold reads op
  // payloads in this process; only transition fields leave it.
  const board = foldBoard(await loadOps(userId), { asOf: now });
  const judged = judge(board.transitions, {
    withinSessions: KEPT_AFTER_SESSIONS,
    sessions: board.sessions,
  });
  const outcomes = new Map(judged.map((j) => [j.transition.seq, j]));

  for (const t of board.transitions) {
    const j = outcomes.get(t.seq);
    out.push({
      type: "board_transition",
      cardId: t.cardId,
      blockId: t.blockId,
      from: t.from,
      to: t.to,
      via: t.via,
      at: iso(t.at),
      seq: t.seq,
      sessionId: t.captureSessionId ?? null,
      // Only speech transitions are judged; a person's own move is the verdict.
      outcome: j?.outcome ?? null,
      decidedBySeq: j?.decidedBy?.seq ?? null,
    });
  }

  return out;
}

/**
 * What became of an invocation, in the analysis's terms.
 *
 * `confirmed` alone conflates three things: `false` is both a spoken refusal and
 * a fire that errored, and `null` is both "still waiting" and "the drive ended
 * without an answer" — which `settleInvocation` deliberately leaves unwritten.
 */
export function invocationStatus(
  i: { confirmed: boolean | null; reverted: boolean; hasError: boolean },
  sessionEnded: boolean,
): "fired" | "declined" | "error" | "reverted" | "pending" | "unanswered" {
  if (i.hasError) return "error";
  if (i.reverted) return "reverted";
  if (i.confirmed === true) return "fired";
  if (i.confirmed === false) return "declined";
  return sessionEnded ? "unanswered" : "pending";
}

/** Users with a participant id, for an export of the whole study. */
export async function studyParticipants(): Promise<{ userId: string; participantId: string }[]> {
  const rows = await getDb()
    .select({ userId: user.id, participantId: user.studyParticipantId })
    .from(user)
    .where(isNotNull(user.studyParticipantId))
    .orderBy(asc(user.studyParticipantId));
  return rows.flatMap((r) => (r.participantId ? [{ userId: r.userId, participantId: r.participantId }] : []));
}
