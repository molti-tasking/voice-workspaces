import { asc, eq, getDb, inArray, sql } from "@voicemural/db";
import { loadSessionDrafts } from "@voicemural/db/drafts";
import { listParticipants, pseudonymFor } from "@voicemural/db/prolific";
import { agentTurn, captureSession, driveSubject, recallProbe, subjectSignal, utterance } from "@voicemural/db/schema";
import {
  ATTENTION_EXPECTED,
  ProlificClosing,
  ProlificQuestionnaire,
  TLX_ITEMS,
  isRealProlificPid,
  rawTlx,
  susScore,
} from "@voicemural/shared";

/**
 * The Prolific study's data, as two flat tables (PROLIFIC.md):
 *
 * - `participants`: one row per participant — arm, timings, how much each
 *   side talked (time on task is a confound the arms must be compared on),
 *   the judgement of learning, the questionnaire (raw TLX per subscale and
 *   overall, the SUS score, whether the attention item was passed), the FINAL
 *   PLAN and the FREE RECALL TEXT, the closing answers with the manipulation
 *   check, and the sparks they were shown and pulled.
 * - `probes`: one row per recall probe — the subject's title (content: the
 *   free recall is scored against it), its signals, and the three answers.
 *
 * Unlike `study:export`, this carries text: the free recall is the measure,
 * and the consent page says it is kept. PIDs are included because payments,
 * bonuses and part-2 invitations need them; `test` marks researcher IDs.
 */

export type Row = Record<string, string | number | boolean | null>;

export async function buildProlificExport(): Promise<{ participants: Row[]; probes: Row[] }> {
  const db = getDb();
  const people = await listParticipants();
  const sessionIds = people.map((p) => p.captureSessionId).filter((id): id is string => id !== null);

  const drives = sessionIds.length
    ? await db
        .select({ id: captureSession.id, startedAt: captureSession.startedAt, endedAt: captureSession.endedAt })
        .from(captureSession)
        .where(inArray(captureSession.id, sessionIds))
    : [];
  const subjects = sessionIds.length
    ? await db
        .select({
          subjectId: driveSubject.id,
          captureSessionId: driveSubject.captureSessionId,
          ordinal: driveSubject.ordinal,
          title: driveSubject.title,
          userWords: subjectSignal.userWords,
          agentWords: subjectSignal.agentWords,
          hedges: subjectSignal.hedges,
          fillers: subjectSignal.fillers,
          pauses: subjectSignal.pauses,
          settled: subjectSignal.settled,
          sparksShown: subjectSignal.sparksShown,
          sparksPulled: subjectSignal.sparksPulled,
          probeId: recallProbe.id,
          confidence: recallProbe.confidence,
          selfAccuracy: recallProbe.selfAccuracy,
          provenance: recallProbe.provenance,
          answeredAt: recallProbe.answeredAt,
        })
        .from(driveSubject)
        .leftJoin(subjectSignal, eq(subjectSignal.driveSubjectId, driveSubject.id))
        .leftJoin(recallProbe, eq(recallProbe.driveSubjectId, driveSubject.id))
        .where(inArray(driveSubject.captureSessionId, sessionIds))
        .orderBy(asc(driveSubject.captureSessionId), asc(driveSubject.ordinal))
    : [];

  // How much each side talked. Their turns are the transcribed utterances;
  // speech time is the sum of utterance spans, the agent's of its turn spans
  // (measured where the container could, estimated otherwise — see agent_turn).
  const words = (column: typeof utterance.text | typeof agentTurn.text) =>
    sql<number>`coalesce(sum(coalesce(array_length(regexp_split_to_array(nullif(trim(${column}), ''), '[[:space:]]+'), 1), 0)), 0)::int`;
  const userTalk = sessionIds.length
    ? await db
        .select({
          id: utterance.captureSessionId,
          turns: sql<number>`count(*)::int`,
          words: words(utterance.text),
          ms: sql<number>`coalesce(sum(${utterance.endOffsetMs} - ${utterance.startOffsetMs}), 0)::int`,
        })
        .from(utterance)
        .where(inArray(utterance.captureSessionId, sessionIds))
        .groupBy(utterance.captureSessionId)
    : [];
  const agentTalk = sessionIds.length
    ? await db
        .select({
          id: agentTurn.captureSessionId,
          turns: sql<number>`count(*)::int`,
          words: words(agentTurn.text),
          ms: sql<number>`coalesce(sum(${agentTurn.endOffsetMs} - ${agentTurn.startOffsetMs}), 0)::int`,
        })
        .from(agentTurn)
        .where(inArray(agentTurn.captureSessionId, sessionIds))
        .groupBy(agentTurn.captureSessionId)
    : [];

  // The plan as it stood at the end: the draft the agent kept (study-task.ts
  // asks for exactly one), at its current version. The latest if there were
  // several; how many there were is kept too, as a check on that rule.
  const plans = new Map<string, { text: string; version: string; drafts: number }>();
  for (const id of sessionIds) {
    const drafts = await loadSessionDrafts(id);
    const last = drafts.at(-1);
    if (last) plans.set(id, { text: last.text, version: last.version, drafts: drafts.length });
  }

  const iso = (d: Date | null) => (d ? d.toISOString() : null);
  const participants: Row[] = people.map((p) => {
    const plan = p.captureSessionId ? plans.get(p.captureSessionId) : undefined;
    const drive = drives.find((d) => d.id === p.captureSessionId);
    const mine = subjects.filter((s) => s.captureSessionId === p.captureSessionId);
    const closing = ProlificClosing.safeParse(p.closing ?? null);
    const questionnaire = ProlificQuestionnaire.safeParse(p.questionnaire ?? null);
    const q = questionnaire.success ? questionnaire.data : null;
    const tlxColumns = Object.fromEntries(TLX_ITEMS.map((item) => [`tlx_${item.key}`, q ? q.tlx[item.key] : null]));
    const user = userTalk.find((t) => t.id === p.captureSessionId);
    const agent = agentTalk.find((t) => t.id === p.captureSessionId);
    const minutes =
      drive?.endedAt != null ? Math.round((drive.endedAt.getTime() - drive.startedAt.getTime()) / 6_000) / 10 : null;
    return {
      pid: p.prolificPid,
      pseudonym: pseudonymFor(p.prolificPid),
      test: !isRealProlificPid(p.prolificPid),
      arm: p.arm,
      task: p.task,
      consented_at: iso(p.consentedAt),
      conversation_minutes: minutes,
      user_turns: user?.turns ?? 0,
      user_words: user?.words ?? 0,
      user_speech_seconds: user ? Math.round(user.ms / 1000) : 0,
      agent_turns: agent?.turns ?? 0,
      agent_words: agent?.words ?? 0,
      agent_speech_seconds: agent ? Math.round(agent.ms / 1000) : 0,
      subjects: mine.length,
      sparks_shown: mine.reduce((n, s) => n + (s.sparksShown?.length ?? 0), 0),
      sparks_pulled: mine.reduce((n, s) => n + (s.sparksPulled?.length ?? 0), 0),
      part1_completed_at: iso(p.part1CompletedAt),
      judgment_of_learning: p.judgmentOfLearning,
      ...tlxColumns,
      tlx_raw: q ? rawTlx(q.tlx) : null,
      sus_score: q ? susScore(q.sus) : null,
      attention_pass: q ? q.attention === ATTENTION_EXPECTED : null,
      plan_version: plan?.version ?? null,
      plan_drafts: plan?.drafts ?? 0,
      plan: plan?.text ?? null,
      part2_started_at: iso(p.part2StartedAt),
      free_recall_at: iso(p.freeRecallAt),
      free_recall_confidence: p.freeRecallConfidence,
      free_recall_chars: p.freeRecall?.length ?? null,
      free_recall: p.freeRecall,
      took_away: closing.success ? closing.data.tookAway : null,
      own_ideas: closing.success ? closing.data.ownIdeas : null,
      assistant_thought: closing.success ? closing.data.assistantThought : null,
      cards_helped: closing.success ? closing.data.cardsHelped : null,
      rehearsed: closing.success ? closing.data.rehearsed : null,
      noticed_cards: closing.success ? closing.data.noticedCards : null,
      comment: closing.success ? (closing.data.comment ?? null) : null,
      part2_completed_at: iso(p.part2CompletedAt),
      part1_study_id: p.part1StudyId,
      part2_study_id: p.part2StudyId,
    };
  });

  const probes: Row[] = subjects
    .filter((s) => s.probeId !== null)
    .map((s) => {
      const owner = people.find((p) => p.captureSessionId === s.captureSessionId)!;
      const words = (s.userWords ?? 0) + (s.agentWords ?? 0);
      return {
        pid: owner.prolificPid,
        arm: owner.arm,
        ordinal: s.ordinal,
        title: s.title,
        user_words: s.userWords,
        agent_words: s.agentWords,
        agent_share: words > 0 ? Math.round(((s.agentWords ?? 0) / words) * 100) / 100 : null,
        hedges: s.hedges,
        fillers: s.fillers,
        pauses: s.pauses,
        settled: s.settled,
        sparks_pulled: (s.sparksPulled ?? []).join("|"),
        confidence: s.confidence,
        self_accuracy: s.selfAccuracy,
        provenance: s.provenance,
        answered_at: iso(s.answeredAt),
      };
    });

  return { participants, probes };
}

/** RFC 4180: every field quoted when it needs to be, newlines kept inside quotes. */
export function toCsv(rows: Row[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]!);
  const cell = (value: Row[string]) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return [headers.join(","), ...rows.map((r) => headers.map((h) => cell(r[h] ?? null)).join(","))].join("\n") + "\n";
}
