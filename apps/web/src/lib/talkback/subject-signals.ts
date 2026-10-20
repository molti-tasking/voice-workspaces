import type { Conversation, KeepVia } from "./conversation";
import { SIGNALS_VERSION, allSignals, type SparkKind } from "./signals";
import type { SparkLedgerState } from "./spark-ledger";

/**
 * What leaves the phone about each subject of a drive: counts, a judgement, a
 * score, the sparks shown and pulled, and whether they kept it, keyed by
 * ordinal. No title, no words.
 * Posted to `/api/study/subject-signals` at Stop (`final`) and, as a best
 * effort, when the page is hidden mid-drive. See `subject_signal`.
 */
export interface SubjectSignalsBody {
  captureSessionId: string;
  final: boolean;
  signalsVersion: string;
  subjects: {
    ordinal: number;
    userWords: number;
    agentWords: number;
    pauses: number;
    pausesBefore: number;
    fillers: number;
    selfRepairs: number;
    hedges: number;
    settled: boolean | null;
    fade: number;
    sparksShown: SparkKind[];
    sparksPulled: SparkKind[];
    /** Whether they kept it in their own head; how; and when (epoch ms). */
    kept: boolean;
    keptVia: KeepVia | null;
    keptAt: number | null;
  }[];
}

export function subjectSignalsBody(
  captureSessionId: string,
  conversation: Conversation,
  ledger: SparkLedgerState,
  now: number,
  final: boolean,
): SubjectSignalsBody {
  return {
    captureSessionId,
    final,
    signalsVersion: SIGNALS_VERSION,
    subjects: allSignals(conversation, now).map((s) => {
      const pulled = ledger.pulled.get(s.ordinal!);
      return {
        ordinal: s.ordinal!,
        userWords: s.userWords,
        agentWords: s.agentWords,
        pauses: s.pauses,
        pausesBefore: s.pausesBefore,
        fillers: s.fillers,
        selfRepairs: s.selfRepairs,
        hedges: s.hedges,
        settled: s.settled,
        fade: Math.round(s.fade * 1000) / 1000,
        sparksShown: [...(ledger.shown.get(s.ordinal!) ?? [])],
        sparksPulled: pulled ? [pulled] : [],
        kept: s.keptVia !== null,
        keptVia: s.keptVia,
        keptAt: s.keptAt,
      };
    }),
  };
}

/** Fire and forget, and survive the page going away. */
export function postSubjectSignals(body: SubjectSignalsBody): void {
  if (body.subjects.length === 0) return;
  void fetch("/api/study/subject-signals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => undefined);
}
