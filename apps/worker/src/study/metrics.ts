/**
 * The study's measures, computed per session and per participant.
 *
 * WHAT CHANGED AND WHY. Pilot 01 measured whether the SYSTEM worked: response
 * latency, turn counts, decline rate, error rate. Every one of those numbers
 * was healthy on a drive where the participant was left in 40.4 seconds of
 * dead air after answering a question, could not tell a lookup from a dropped
 * connection, and heard a turn spoken 52.6 seconds after they had stopped
 * recording. A system can pass all of Tier 1 and fail the person completely.
 *
 * So there are three tiers here, and the order is the argument:
 *
 *   Tier 1 — system behaviour. Kept unchanged. It is necessary and it is not
 *            the point.
 *   Tier 2 — steerability. Could the person get the thing back on track: did
 *            they have to prompt again, ask for a repeat, correct it, did
 *            their stated intents reach the board, and did it ever decline an
 *            answer to its own question.
 *   Tier 3 — relief. Did it take load off them, and do the things they handed
 *            it come back. `lostRate` is the primary failure measure: a system
 *            that writes many items to the board and never brings them back
 *            has failed, whatever the latency says.
 *
 * OPTIMISE FOR RELIEF, NOT THROUGHPUT. Nothing here counts items written,
 * turns taken or words spoken as a good. More board writes with a higher lost
 * rate is a worse system, and these numbers are arranged so that reads as a
 * worse result.
 *
 * THE PRIVACY BOUNDARY. This module READS transcript text — two of the
 * steerability measures exist only in what was said — and returns only counts
 * and timings. That is the same rule the export holds to, moved one step
 * later: the text is read inside the worker, against the database, and never
 * appears in a return value, a log line or a file. `metrics.test.ts` seeds a
 * sentinel into every text column and fails if it surfaces anywhere in the
 * output.
 *
 * DEDUPLICATION IS NOT OPTIONAL. Every rate over decisions counts only
 * `authoritative` rows (see `recordAgentDecision`): Pilot 01 wrote two
 * `agent_decision` rows per offset, which doubles the denominator of the
 * silence rate and halves it again depending on which one you keep. The
 * non-authoritative rows are counted separately, as `doubleDispatched`,
 * because how often one moment runs two completions is a finding of its own.
 */
import {
  agentDecision,
  agentTurn,
  asc,
  captureSession,
  directive,
  eq,
  getDb,
  inArray,
  invocation,
  studyEvent,
  studyItemReview,
  studyResponse,
  user,
  utterance,
  workspaceOp,
} from "@voicemural/db";
import { loadOps } from "@voicemural/db/workspace";
import { isEcho } from "@voicemural/talkback";
import { KEPT_AFTER_SESSIONS, foldBoard, judge } from "@voicemural/workspace";
import { isCorrection, isRepeatRequest, isSelfRepair, normalise } from "./steerability";

export const METRICS_VERSION = 1;

export interface MetricsOptions {
  /**
   * How long the agent must have been silent after the person's words before
   * their next utterance counts as a RE-PROMPT, in ms.
   *
   * Configurable because it is the one threshold in here that is a judgement
   * call rather than a definition, and the right value depends on the setting:
   * five seconds of nothing at a desk is awkward, in a car it is alarming.
   * Five is the default because Pilot 01's tool-backed turns had a median of
   * 8.4s, so it separates "the system is thinking" from "the system is gone"
   * roughly where the participant did.
   */
  rePromptAfterMs?: number;
  /**
   * How soon after an agent turn a rejection still counts as correcting IT
   * rather than as the person contradicting themselves.
   */
  correctionWindowMs?: number;
  /**
   * The IANA zone whose calendar days the revisit measure counts in.
   *
   * "Reopens or edits it on a LATER DAY" needs a day, and a day is local. A
   * study run in Germany on UTC boundaries misclassifies in both directions:
   * an edit at 00:30 local on Tuesday is Monday in UTC, so a genuine revisit
   * reads as same-day, and one at 23:30 Monday reads as a revisit of itself.
   * Defaults to `STUDY_TIME_ZONE`, then UTC — a deployment in one place should
   * set it once rather than have the analysis correct for it afterwards.
   */
  timeZone?: string;
  now?: Date;
}

const DEFAULT_RE_PROMPT_MS = 5_000;
const DEFAULT_CORRECTION_WINDOW_MS = 15_000;
/**
 * READ AT CALL TIME, not at module load.
 *
 * The CLI loads `.env` with dotenv at the top of its own module, and ESM
 * evaluates every import before any of that runs — so a constant initialised
 * here would have been computed before `STUDY_TIME_ZONE` existed, and the
 * setting would have been silently ignored on every run. `STUDY_PILOT_USER_IDS`
 * avoids the same trap by being read inside its function; so does this.
 */
function defaultTimeZone(): string {
  return process.env.STUDY_TIME_ZONE || "UTC";
}

/**
 * How long a gap between two of the person's utterances may be before it ends
 * a RUN of thinking aloud.
 *
 * Two seconds. Long enough to cover the pause between clauses that the VAD
 * cuts an utterance on — those are one thought, and the whole prompt is built
 * on not treating them as a turn boundary — and short enough that a genuine
 * stop does not get glued to whatever they said next.
 */
const RUN_GAP_MS = 2_000;

/* --- small helpers ---------------------------------------------------------- */

/** The median of the values present. Null for an empty set, never zero. */
export function median(values: readonly number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]!
    : Math.round((sorted[middle - 1]! + sorted[middle]!) / 2);
}

/** Words in an utterance, on the same normalisation the classifiers use. */
function wordCount(text: string): number {
  const said = normalise(text);
  return said ? said.split(" ").length : 0;
}

/**
 * A share, or null when the denominator is empty.
 *
 * Null rather than 0, everywhere, because "no opportunities arose" and "every
 * opportunity was taken" are opposite findings and a zero would merge them.
 * A drive with no tool calls has no tool latency; it does not have a tool
 * latency of nought.
 */
export function share(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

/* --- the shapes ------------------------------------------------------------- */

export interface Tier1 {
  /** Spoken turns, excluding fillers. */
  turns: number;
  /** Liveness placeholders. Never counted as replies — see `agent_turn.kind`. */
  fillers: number;
  latencyMsMedian: number | null;
  latencyMsMedianWithTool: number | null;
  latencyMsMedianWithoutTool: number | null;
  /** Turns whose end was measured at the speaker rather than estimated. */
  endsMeasured: number;
  /** Moments the model was given, deduplicated. */
  opportunities: number;
  silent: number;
  silentShare: number | null;
  /** Extra completions for a moment that already had one. */
  doubleDispatched: number;
  errors: number;
  errorRate: number | null;
}

export interface Tier2 {
  /** The person's own utterances, echo and debrief excluded. */
  userUtterances: number;
  rePrompts: number;
  rePromptRate: number | null;
  repeatRequests: number;
  repeatRequestRate: number | null;
  /** What the person could have corrected: spoken proposals and machine board writes. */
  correctable: number;
  corrections: {
    spoken: number;
    declinedInvocations: number;
    reversedOrCorrected: number;
    total: number;
  };
  correctionRate: number | null;
  /** Directions the classifier heard. */
  intents: number;
  intentsRealised: number;
  intentThroughput: number | null;
  /**
   * Answers to the agent's own questions that it then declined. TARGET: 0.
   *
   * The single number Pilot 01 would have failed on, and the reason the
   * `answer` trigger exists.
   *
   * THE ONE MEASURE THAT DOES NOT DEDUPLICATE, deliberately. When `AnswerGuard`
   * rescues a declined answer, the completion that finally speaks becomes the
   * moment's authoritative decision — correctly, because it is what the person
   * heard. Counting only authoritative rows would then report zero for a drive
   * where the model declined every answer it was given and was overruled every
   * time, which is precisely the behaviour this number exists to see. So it
   * counts the declines themselves. A non-zero value means the guard fired,
   * and somebody waited an extra completion for an answer they had already
   * earned.
   */
  unansweredAnswers: number;
}

/**
 * Whether the person was still THINKING, and whether they were let.
 *
 * The fourth group, and the one the other three cannot see. Tier 1 asks
 * whether the system worked, Tier 2 whether it could be steered, Tier 3
 * whether it relieved them — and a system that did the thinking for somebody
 * would score well on all three. What should come off the person is what they
 * are HOLDING; what must not come off them is the thinking, which is the thing
 * they opened the app to do. See EVALUATION_PLAN §10.
 *
 * Three observables, all from the ledger and all counts:
 *
 * - INTRUSIONS. Agent speech that began while the person was still talking.
 *   The prompt's central rule is "never interrupt a thought that is still
 *   being formed" and until now nothing measured it. It matters more than
 *   politeness: the verbalization literature's one robust finding is that
 *   vocalizing a thought as it forms leaves the thought alone, while being
 *   asked to explain or justify it mid-formation changes it. An intrusion is
 *   the system reaching into the thinking it is supposed to be supporting.
 *
 * - SELF-REPAIRS. The person revising their own half-formed sentence:
 *   "beziehungsweise…", "no, wait". The audible form of a thought being
 *   worked on, and the mechanism the self-explanation literature credits for
 *   why explaining to yourself works at all.
 *
 * - RUNS. How long they speak for without the agent taking a turn. Thinking
 *   aloud comes in long stretches; issuing commands does not. A week in which
 *   the runs get steadily shorter is a week in which the person has become an
 *   operator of the thing rather than a thinker using it.
 *
 * NONE OF THESE IS GOOD OR BAD ON ITS OWN, and that is why they are reported
 * next to the Tier 3 items rather than folded into a score. A low self-repair
 * rate on a drive where `thinking_moved` is high is somebody who arrived with
 * the thought already formed. The same number where `did_my_thinking` is also
 * high is the failure this group exists to catch.
 */
export interface Thinking {
  /** Agent speech that started while the person was mid-utterance. */
  intrusions: number;
  intrusionRate: number | null;
  /** Utterances in which they revised their own thought. */
  selfRepairs: number;
  selfRepairRate: number | null;
  /** Median words in one of their utterances. */
  medianUtteranceWords: number | null;
  /** Unbroken stretches of their own speech, with the agent not taking a turn. */
  runs: number;
  medianRunMs: number | null;
  longestRunMs: number | null;
}

export interface Tier3Session {
  mentalLoadPre: number | null;
  mentalLoadPost: number | null;
  /** Post minus pre. NEGATIVE IS THE GOOD DIRECTION: less held in the head. */
  mentalLoadDelta: number | null;
  livenessPerceived: number | null;
  canCorrect: number | null;
  /** Whether the debrief was actually recorded, and how long it ran. */
  debriefMs: number | null;
}

export interface SessionMetrics {
  sessionId: string;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  endedBy: string | null;
  setting: string | null;
  settingSource: string | null;
  studyCondition: unknown;
  tier1: Tier1;
  tier2: Tier2;
  thinking: Thinking;
  tier3: Tier3Session;
}

export interface Tier3Participant {
  /**
   * Cards touched or opened on a LATER CALENDAR DAY than the one they were
   * created on, in the study's own time zone. See `MetricsOptions.timeZone`.
   */
  revisitRate: number | null;
  revisited: number;
  cards: number;
  /** What they opened and what they changed, across the whole deployment. */
  boardOpens: number;
  cardOpens: number;
  dictations: number;
  edits: number;
  day7: {
    reviewed: number;
    done: number;
    open: number;
    lost: number;
    /** THE PRIMARY FAILURE MEASURE FOR OFFLOADING. */
    lostRate: number | null;
  };
}

export interface ParticipantMetrics {
  metricsVersion: number;
  computedAt: string;
  userId: string;
  participantId: string | null;
  options: { rePromptAfterMs: number; correctionWindowMs: number; timeZone: string };
  sessions: SessionMetrics[];
  /** Tier 1, 2 and the thinking group, pooled across the participant's drives. */
  tier1: Tier1;
  tier2: Tier2;
  thinking: Thinking;
  tier3: Tier3Participant;
}

/* --- the computation -------------------------------------------------------- */

export async function participantMetrics(
  userId: string,
  options: MetricsOptions = {},
): Promise<ParticipantMetrics> {
  const db = getDb();
  const now = options.now ?? new Date();
  const rePromptAfterMs = options.rePromptAfterMs ?? DEFAULT_RE_PROMPT_MS;
  const correctionWindowMs = options.correctionWindowMs ?? DEFAULT_CORRECTION_WINDOW_MS;

  const [person] = await db
    .select({ id: user.id, participantId: user.studyParticipantId })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!person) throw new Error(`no user ${userId}`);

  const sessions = await db
    .select({
      id: captureSession.id,
      startedAt: captureSession.startedAt,
      endedAt: captureSession.endedAt,
      endedBy: captureSession.endedBy,
      setting: captureSession.setting,
      settingSource: captureSession.settingSource,
      studyCondition: captureSession.studyCondition,
      debriefStartedOffsetMs: captureSession.debriefStartedOffsetMs,
      debriefEndedOffsetMs: captureSession.debriefEndedOffsetMs,
    })
    .from(captureSession)
    .where(eq(captureSession.userId, userId))
    .orderBy(asc(captureSession.startedAt));

  const sessionIds = sessions.map((s) => s.id);
  const perSession: SessionMetrics[] = [];

  if (sessionIds.length > 0) {
    const [turns, decisions, utterances, directives, invocations, ops, responses] =
      await Promise.all([
        db
          .select({
            sessionId: agentTurn.captureSessionId,
            kind: agentTurn.kind,
            startOffsetMs: agentTurn.startOffsetMs,
            endOffsetMs: agentTurn.endOffsetMs,
            totalLatencyMs: agentTurn.totalLatencyMs,
            endMeasured: agentTurn.endMeasured,
            toolCalls: agentTurn.toolCalls,
            error: agentTurn.error,
            // Read to filter the agent's own voice out of the transcript, and
            // for no other purpose. Never returned.
            text: agentTurn.text,
          })
          .from(agentTurn)
          .where(inArray(agentTurn.captureSessionId, sessionIds))
          .orderBy(asc(agentTurn.captureSessionId), asc(agentTurn.startOffsetMs)),
        db
          .select({
            sessionId: agentDecision.captureSessionId,
            trigger: agentDecision.trigger,
            outcome: agentDecision.outcome,
            authoritative: agentDecision.authoritative,
          })
          .from(agentDecision)
          .where(inArray(agentDecision.captureSessionId, sessionIds)),
        db
          .select({
            id: utterance.id,
            sessionId: utterance.captureSessionId,
            startOffsetMs: utterance.startOffsetMs,
            endOffsetMs: utterance.endOffsetMs,
            // Classified here, counted out. See the header.
            text: utterance.text,
          })
          .from(utterance)
          .where(inArray(utterance.captureSessionId, sessionIds))
          .orderBy(asc(utterance.captureSessionId), asc(utterance.startOffsetMs)),
        db
          .select({ sessionId: directive.captureSessionId, utteranceId: directive.utteranceId })
          .from(directive)
          .where(inArray(directive.captureSessionId, sessionIds)),
        db
          .select({
            sessionId: invocation.captureSessionId,
            confirmed: invocation.confirmed,
          })
          .from(invocation)
          .where(inArray(invocation.captureSessionId, sessionIds)),
        db
          .select({
            sessionId: workspaceOp.captureSessionId,
            sourceUtteranceIds: workspaceOp.sourceUtteranceIds,
            occurredAt: workspaceOp.occurredAt,
          })
          .from(workspaceOp)
          .where(eq(workspaceOp.userId, userId)),
        db
          .select({
            sessionId: studyResponse.captureSessionId,
            phase: studyResponse.phase,
            item: studyResponse.item,
            value: studyResponse.value,
          })
          .from(studyResponse)
          .where(eq(studyResponse.userId, userId)),
      ]);

    // The board's judged transitions, for the behavioural half of corrections.
    const board = foldBoard(await loadOps(userId), { asOf: now });
    const judged = judge(board.transitions, {
      withinSessions: KEPT_AFTER_SESSIONS,
      sessions: board.sessions,
    });

    const by = <T extends { sessionId: string | null }>(rows: T[], id: string) =>
      rows.filter((r) => r.sessionId === id);

    for (const session of sessions) {
      const sessionTurns = by(turns, session.id);
      const sessionUtterances = by(utterances, session.id);
      const spokenByAgent = sessionTurns.map((t) => t.text);

      /* THE PERSON'S OWN SPEECH.
       *
       * Two exclusions, and both matter. The agent's voice reaches the
       * microphone through the speaker and lands in `utterance` like anything
       * else — counting those as the participant re-prompting would make a
       * talkative agent look like a frustrated person. And the debrief is the
       * participant answering a researcher's questions with the microphone
       * still open, which is not the drive. */
      const debriefFrom = session.debriefStartedOffsetMs;
      const theirs = sessionUtterances.filter((u) => {
        if (debriefFrom !== null && u.startOffsetMs >= debriefFrom) return false;
        if (isEcho(u.text, spokenByAgent)) return false;
        // The interval test catches what the text test cannot: a mishearing of
        // the agent's own words that shares too few tokens to look like one.
        return !sessionTurns.some(
          (t) => u.startOffsetMs >= t.startOffsetMs && u.endOffsetMs <= t.endOffsetMs,
        );
      });

      /* --- Tier 1 --------------------------------------------------------- */

      const spoken = sessionTurns.filter((t) => t.kind !== "filler");
      const withTool = spoken.filter((t) => (t.toolCalls ?? []).length > 0);
      const withoutTool = spoken.filter((t) => (t.toolCalls ?? []).length === 0);
      const latencies = (rows: typeof spoken) =>
        rows.flatMap((t) => (t.totalLatencyMs === null ? [] : [t.totalLatencyMs]));

      const sessionDecisions = by(decisions, session.id);
      const counted = sessionDecisions.filter((d) => d.authoritative);
      const silent = counted.filter((d) => d.outcome === "declined").length;

      const tier1: Tier1 = {
        turns: spoken.length,
        fillers: sessionTurns.length - spoken.length,
        latencyMsMedian: median(latencies(spoken)),
        latencyMsMedianWithTool: median(latencies(withTool)),
        latencyMsMedianWithoutTool: median(latencies(withoutTool)),
        endsMeasured: sessionTurns.filter((t) => t.endMeasured).length,
        opportunities: counted.length,
        silent,
        silentShare: share(silent, counted.length),
        doubleDispatched: sessionDecisions.length - counted.length,
        errors: sessionTurns.filter((t) => t.error !== null).length,
        errorRate: share(sessionTurns.filter((t) => t.error !== null).length, sessionTurns.length),
      };

      /* --- Tier 2 --------------------------------------------------------- */

      /* RE-PROMPTS. They said something, nothing came back, and after a long
       * enough silence they said something again. Measured from the END of
       * their previous utterance, with no agent turn STARTING in between —
       * which is what makes it "the agent was silent" rather than "they kept
       * talking". */
      let rePrompts = 0;
      for (let i = 1; i < theirs.length; i += 1) {
        const previous = theirs[i - 1]!;
        const current = theirs[i]!;
        const gap = current.startOffsetMs - previous.endOffsetMs;
        if (gap < rePromptAfterMs) continue;
        const agentSpokeBetween = sessionTurns.some(
          (t) => t.startOffsetMs >= previous.endOffsetMs && t.startOffsetMs <= current.startOffsetMs,
        );
        if (!agentSpokeBetween) rePrompts += 1;
      }

      const repeatRequests = theirs.filter((u) => isRepeatRequest(u.text)).length;

      /* CORRECTIONS, three ways, reported apart and pooled.
       *
       * Spoken: a rejection that opens an utterance shortly after the agent
       * said something. Declined: an irreversible action they were asked about
       * and said no to. Reversed or corrected: a move speech or the agent made
       * that they then undid, which `judge()` already labels. */
      const spokenCorrections = theirs.filter((u) => {
        if (!isCorrection(u.text)) return false;
        return sessionTurns.some(
          (t) =>
            t.kind !== "filler" &&
            t.endOffsetMs <= u.startOffsetMs &&
            u.startOffsetMs - t.endOffsetMs <= correctionWindowMs,
        );
      }).length;

      const declinedInvocations = by(invocations, session.id).filter(
        (i) => i.confirmed === false,
      ).length;

      const reversedOrCorrected = judged.filter(
        (j) =>
          j.transition.captureSessionId === session.id &&
          (j.outcome === "reversed" || j.outcome === "corrected"),
      ).length;

      // What there WAS to correct: things the machine said or did. A drive
      // where the agent never spoke has no correction rate, which is why this
      // is a denominator rather than the utterance count.
      const machineWrites = board.transitions.filter(
        (t) => t.captureSessionId === session.id && (t.via === "speech" || t.via === "agent"),
      ).length;
      const correctable = spoken.length + machineWrites;

      const sessionDirectives = by(directives, session.id);
      const wroteTheBoard = new Set(
        ops.flatMap((o) => (o.sourceUtteranceIds ?? []) as string[]),
      );
      const intentsRealised = sessionDirectives.filter((d) =>
        wroteTheBoard.has(d.utteranceId),
      ).length;

      const corrections = {
        spoken: spokenCorrections,
        declinedInvocations,
        reversedOrCorrected,
        total: spokenCorrections + declinedInvocations + reversedOrCorrected,
      };

      const tier2: Tier2 = {
        userUtterances: theirs.length,
        rePrompts,
        rePromptRate: share(rePrompts, theirs.length),
        repeatRequests,
        repeatRequestRate: share(repeatRequests, theirs.length),
        correctable,
        corrections,
        correctionRate: share(corrections.total, correctable),
        intents: sessionDirectives.length,
        intentsRealised,
        intentThroughput: share(intentsRealised, sessionDirectives.length),
        // Over `sessionDecisions`, not `counted`. See the field's note.
        unansweredAnswers: sessionDecisions.filter(
          (d) => d.trigger === "answer" && d.outcome === "declined",
        ).length,
      };

      /* --- Thinking --------------------------------------------------------- */

      /* INTRUSIONS: agent audio that began while they were still talking.
       *
       * Every spoken turn counts, fillers included — a placeholder spoken over
       * somebody mid-sentence is an interruption whatever it says. Strictly
       * inside the utterance, so a turn that begins exactly as they stop is
       * the system taking its turn rather than taking theirs.
       *
       * Utterance boundaries come from the chunk pipeline and turn offsets
       * from the container. Both are on the drive's clock, so they compare —
       * but the ASR's idea of where a sentence ended is approximate, so read
       * this as a rate that should be near zero rather than as a count of
       * individual incidents. */
      const intrusions = sessionTurns.filter((t) =>
        theirs.some(
          (u) => t.startOffsetMs > u.startOffsetMs && t.startOffsetMs < u.endOffsetMs,
        ),
      ).length;

      /* SELF-REPAIRS: them revising their own thought rather than the agent's
       * proposal. The same few phrases can do both jobs, so the addressee is
       * decided by the turn structure — a repair is the one with no agent turn
       * in front of it. */
      const selfRepairs = theirs.filter((u) => {
        if (!isSelfRepair(u.text)) return false;
        const answeringAgent = sessionTurns.some(
          (t) =>
            t.kind !== "filler" &&
            t.endOffsetMs <= u.startOffsetMs &&
            u.startOffsetMs - t.endOffsetMs <= correctionWindowMs,
        );
        return !answeringAgent;
      }).length;

      /* RUNS: unbroken stretches of their own speech.
       *
       * Two of their utterances belong to the same run when the gap between
       * them is short AND the agent did not take a turn in it. The second
       * condition is what makes this a measure of thinking aloud rather than
       * of talkativeness: a run ends when the conversation becomes a
       * conversation. */
      const runs: { startMs: number; endMs: number }[] = [];
      for (const u of theirs) {
        const current = runs[runs.length - 1];
        const gap = current ? u.startOffsetMs - current.endMs : Infinity;
        const interrupted =
          current !== undefined &&
          sessionTurns.some(
            (t) => t.startOffsetMs >= current.endMs && t.startOffsetMs <= u.startOffsetMs,
          );
        if (current && gap <= RUN_GAP_MS && !interrupted) current.endMs = u.endOffsetMs;
        else runs.push({ startMs: u.startOffsetMs, endMs: u.endOffsetMs });
      }
      const runLengths = runs.map((r) => Math.max(0, r.endMs - r.startMs));

      const thinking: Thinking = {
        intrusions,
        intrusionRate: share(intrusions, sessionTurns.length),
        selfRepairs,
        selfRepairRate: share(selfRepairs, theirs.length),
        medianUtteranceWords: median(theirs.map((u) => wordCount(u.text))),
        runs: runs.length,
        medianRunMs: median(runLengths),
        longestRunMs: runLengths.length > 0 ? Math.max(...runLengths) : null,
      };

      /* --- Tier 3, the session's half ------------------------------------- */

      const answer = (phase: string, item: string): number | null =>
        responses.find((r) => r.sessionId === session.id && r.phase === phase && r.item === item)
          ?.value ?? null;

      const mentalLoadPre = answer("pre", "mental_load");
      const mentalLoadPost = answer("post", "mental_load");

      perSession.push({
        sessionId: session.id,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null,
        durationMs: session.endedAt
          ? session.endedAt.getTime() - session.startedAt.getTime()
          : null,
        endedBy: session.endedBy,
        setting: session.setting,
        settingSource: session.settingSource,
        studyCondition: session.studyCondition,
        tier1,
        tier2,
        thinking,
        tier3: {
          mentalLoadPre,
          mentalLoadPost,
          mentalLoadDelta:
            mentalLoadPre !== null && mentalLoadPost !== null
              ? mentalLoadPost - mentalLoadPre
              : null,
          livenessPerceived: answer("post", "liveness_perceived"),
          canCorrect: answer("post", "can_correct"),
          debriefMs:
            session.debriefStartedOffsetMs !== null && session.debriefEndedOffsetMs !== null
              ? session.debriefEndedOffsetMs - session.debriefStartedOffsetMs
              : null,
        },
      });
    }
  }

  const tier1 = poolTier1(perSession.map((s) => s.tier1));
  const tier2 = poolTier2(perSession.map((s) => s.tier2));

  return {
    metricsVersion: METRICS_VERSION,
    computedAt: now.toISOString(),
    userId: person.id,
    participantId: person.participantId,
    options: {
      rePromptAfterMs,
      correctionWindowMs,
      timeZone: options.timeZone ?? defaultTimeZone(),
    },
    sessions: perSession,
    tier1,
    tier2,
    thinking: poolThinking(perSession.map((s) => s.thinking), {
      // Every turn that reached the speaker, fillers included, because an
      // intrusion is an intrusion whatever it said.
      turns: tier1.turns + tier1.fillers,
      utterances: tier2.userUtterances,
    }),
    tier3: await participantTier3(userId, now, options.timeZone ?? defaultTimeZone()),
  };
}



/* --- pooling ---------------------------------------------------------------- */

/**
 * Pooled rather than averaged, everywhere.
 *
 * The mean of per-session rates gives a three-turn drive the same weight as an
 * hour-long one, which for a study with unequal sessions is how a single
 * unlucky commute becomes the headline. Medians are the exception: they cannot
 * be pooled from summaries, so the pooled median is recomputed by the caller
 * from the raw values where that matters and left null here rather than being
 * faked from medians of medians.
 */
function poolTier1(rows: readonly Tier1[]): Tier1 {
  const sum = (pick: (r: Tier1) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const opportunities = sum((r) => r.opportunities);
  const silent = sum((r) => r.silent);
  const turns = sum((r) => r.turns) + sum((r) => r.fillers);
  const errors = sum((r) => r.errors);
  return {
    turns: sum((r) => r.turns),
    fillers: sum((r) => r.fillers),
    // Medians of medians are not medians. The per-session values above are the
    // ones to read; a pooled one needs the raw list, which this does not have.
    latencyMsMedian: null,
    latencyMsMedianWithTool: null,
    latencyMsMedianWithoutTool: null,
    endsMeasured: sum((r) => r.endsMeasured),
    opportunities,
    silent,
    silentShare: share(silent, opportunities),
    doubleDispatched: sum((r) => r.doubleDispatched),
    errors,
    errorRate: share(errors, turns),
  };
}

function poolTier2(rows: readonly Tier2[]): Tier2 {
  const sum = (pick: (r: Tier2) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const userUtterances = sum((r) => r.userUtterances);
  const rePrompts = sum((r) => r.rePrompts);
  const repeatRequests = sum((r) => r.repeatRequests);
  const correctable = sum((r) => r.correctable);
  const corrections = {
    spoken: sum((r) => r.corrections.spoken),
    declinedInvocations: sum((r) => r.corrections.declinedInvocations),
    reversedOrCorrected: sum((r) => r.corrections.reversedOrCorrected),
    total: sum((r) => r.corrections.total),
  };
  const intents = sum((r) => r.intents);
  const intentsRealised = sum((r) => r.intentsRealised);
  return {
    userUtterances,
    rePrompts,
    rePromptRate: share(rePrompts, userUtterances),
    repeatRequests,
    repeatRequestRate: share(repeatRequests, userUtterances),
    correctable,
    corrections,
    correctionRate: share(corrections.total, correctable),
    intents,
    intentsRealised,
    intentThroughput: share(intentsRealised, intents),
    unansweredAnswers: sum((r) => r.unansweredAnswers),
  };
}

/**
 * Pooled from the group's own counts and the denominators the other two
 * groups already hold — every spoken turn, and every utterance of theirs.
 *
 * Taken rather than reconstructed from the per-session rates: a drive with no
 * intrusions has a rate of zero and no recoverable denominator, so dividing
 * back out would silently drop exactly the drives that went well.
 */
function poolThinking(
  rows: readonly Thinking[],
  denominators: { turns: number; utterances: number },
): Thinking {
  const sum = (pick: (r: Thinking) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const intrusions = sum((r) => r.intrusions);
  const selfRepairs = sum((r) => r.selfRepairs);
  const { turns, utterances } = denominators;
  return {
    intrusions,
    intrusionRate: share(intrusions, turns),
    selfRepairs,
    selfRepairRate: share(selfRepairs, utterances),
    // Medians of medians are not medians; the per-session values are the ones
    // to read. Same rule as the latency medians above.
    medianUtteranceWords: null,
    runs: sum((r) => r.runs),
    medianRunMs: null,
    longestRunMs: rows.reduce<number | null>(
      (longest, r) =>
        r.longestRunMs === null ? longest : Math.max(longest ?? 0, r.longestRunMs),
      null,
    ),
  };
}

/* --- Tier 3, the week ------------------------------------------------------- */

/**
 * Relief, measured over the whole deployment rather than one drive.
 *
 * REVISIT IS BY DAY, not by session. "The user reopens or edits it on a LATER
 * DAY" is the definition, and it is the right one: coming back to something
 * the next morning is the behaviour that says it was offloaded rather than
 * forgotten, and two edits in the same session are still one sitting.
 *
 * Opening counts as much as editing, which is why `study_event` exists — an
 * item somebody re-read every morning and never changed leaves no other trace.
 */
async function participantTier3(
  userId: string,
  now: Date,
  timeZone: string,
): Promise<Tier3Participant> {
  const db = getDb();
  const board = foldBoard(await loadOps(userId), { asOf: now });

  // Calendar days where the participant is, not where the server is. See
  // `MetricsOptions.timeZone`. `en-CA` because it formats as YYYY-MM-DD, which
  // sorts and compares as a date should.
  const format = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const day = (date: Date) => format.format(date);

  // When each card first appeared, and every later day it was touched.
  const createdOn = new Map<string, string>();
  const touchedOn = new Map<string, Set<string>>();
  for (const t of board.transitions) {
    const on = day(t.at);
    if (!createdOn.has(t.cardId)) createdOn.set(t.cardId, on);
    const days = touchedOn.get(t.cardId) ?? new Set<string>();
    days.add(on);
    touchedOn.set(t.cardId, days);
  }

  const opens = await db
    .select({ kind: studyEvent.kind, cardId: studyEvent.cardId, occurredAt: studyEvent.occurredAt })
    .from(studyEvent)
    .where(eq(studyEvent.userId, userId));

  for (const open of opens) {
    if (!open.cardId) continue;
    const days = touchedOn.get(open.cardId) ?? new Set<string>();
    days.add(day(open.occurredAt));
    touchedOn.set(open.cardId, days);
  }

  const cards = [...createdOn.keys()];
  const revisited = cards.filter((cardId) => {
    const first = createdOn.get(cardId)!;
    return [...(touchedOn.get(cardId) ?? [])].some((d) => d > first);
  }).length;

  const reviews = await db
    .select({ outcome: studyItemReview.outcome })
    .from(studyItemReview)
    .where(eq(studyItemReview.userId, userId));

  const count = (outcome: string) => reviews.filter((r) => r.outcome === outcome).length;
  const lost = count("lost");

  /* Opens, new dictations and edits — the three things days 2–6 are allowed
   * to record.
   *
   * TOTALS ACROSS THE DEPLOYMENT, not a days 2–6 slice. Bounding them here
   * would mean this module deciding when a participant's week started, which
   * is a protocol fact it does not have; the export carries `occurredAt` on
   * every `study_event` and `workspace_op` row, so the analysis can cut any
   * window it likes from the same data. What this reports is the whole of it.
   *
   * A dictation is the op that first put a card on the board; an edit is
   * anything done to one afterwards. Both come from the ledger rather than
   * from an event, because both already leave a row there. */
  const dictations = board.transitions.filter((t) => t.from === null).length;
  const edits = board.transitions.length - dictations;

  return {
    revisitRate: share(revisited, cards.length),
    revisited,
    cards: cards.length,
    boardOpens: opens.filter((o) => o.kind === "board_open").length,
    cardOpens: opens.filter((o) => o.kind === "card_open").length,
    dictations,
    edits,
    day7: {
      reviewed: reviews.length,
      done: count("done"),
      open: count("open"),
      lost,
      lostRate: share(lost, reviews.length),
    },
  };
}

