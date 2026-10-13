import {
  ARRIVALS,
  FINDINGS_TEXT_FIELDS,
  HAND_OFF_ANSWERS,
  HAND_OFF_TASKS,
  KEEP_USING,
  NOT_APPLICABLE,
  USAGE_LEVELS,
  USE_REASONS,
  WRAP_UPS,
  type Arrival,
  type FindingsAnswers,
  type FindingsTextField,
  type HandOffAnswer,
  type HandOffTask,
  type KeepUsing,
  type UsageLevel,
  type UseReason,
  type WrapUp,
} from "@voicemural/shared";

/**
 * The findings survey, counted.
 *
 * COUNTS, NOT PERCENTAGES. A handful of colleagues answer this; "40%" of five
 * people is two people dressed up as a rate. Every tally carries the number
 * who answered that question, which is not the number who sent the form —
 * every question is optional.
 *
 * NOTHING IS BROKEN DOWN BY RESPONDENT. With this few people, "the regular
 * user said…" is a name. The usage question is tallied on its own and never
 * used to split another one.
 *
 * Pure: the dashboard calls it on every refresh, and the tests call it on
 * hand-made documents.
 */

export interface FindingsResponse {
  id: string;
  /** The UTC day it was sent, `YYYY-MM-DD`. */
  submittedOn: string;
  answers: FindingsAnswers;
}

export interface Tally<K extends string> {
  key: K;
  count: number;
}

export interface Tallied<K extends string> {
  /** In the option order the form shows, so a chart never reorders between refreshes. */
  tallies: Tally<K>[];
  /** How many respondents answered this question at all. */
  answered: number;
}

export interface Quote {
  /** `responseId:field`, stable across refreshes, so a pin survives one. */
  id: string;
  field: FindingsTextField;
  text: string;
}

export interface HandOffRow {
  task: HandOffTask;
  counts: Record<HandOffAnswer, number>;
  answered: number;
  /** (gladly − myself) / answered: −1 is "keep it", +1 is "hand it over". */
  net: number;
}

export interface FindingsSummary {
  respondents: number;
  usage: Tallied<UsageLevel>;
  silence: { values: number[]; notApplicable: number; answered: number };
  useReasons: Tallied<UseReason>;
  arrival: Tallied<Arrival>;
  wrapUp: Tallied<WrapUp>;
  /** Sorted from most handed over to most kept; unanswered rows last. */
  handOff: HandOffRow[];
  umux: {
    capabilities: number[];
    ease: number[];
    /** UMUX-Lite 0–100, one per respondent who answered both items. */
    scores: number[];
  };
  keepUsing: Tallied<KeepUsing>;
  quotes: Record<FindingsTextField, Quote[]>;
}

/** The median of the values present. Null for an empty set, never zero. */
export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const upper = sorted[mid] as number;
  return sorted.length % 2 === 1 ? upper : ((sorted[mid - 1] as number) + upper) / 2;
}

/**
 * UMUX-Lite on a 0–100 scale (Lewis, Utesch & Maher 2013): both items on
 * 1–7, rescaled and summed. The unadjusted form; the regression-adjusted one
 * exists to approximate SUS, which nobody here is comparing against.
 */
export function umuxLite(capabilities: number, ease: number): number {
  return ((capabilities - 1 + (ease - 1)) / 12) * 100;
}

function tally<K extends string>(options: readonly K[], picks: readonly (K | undefined)[]): Tallied<K> {
  const answered = picks.filter((p) => p !== undefined);
  return {
    tallies: options.map((key) => ({ key, count: answered.filter((p) => p === key).length })),
    answered: answered.length,
  };
}

export function summarise(responses: readonly FindingsResponse[]): FindingsSummary {
  const all = responses.map((r) => r.answers);

  const silenceValues = all.flatMap((a) => (typeof a.silenceMatch === "number" ? [a.silenceMatch] : []));
  const silenceNa = all.filter((a) => a.silenceMatch === NOT_APPLICABLE).length;

  // A reason ticked twice in one document is still one respondent's reason.
  const reasonSets = all.map((a) => new Set(a.useReasons ?? []));
  const useReasons: Tallied<UseReason> = {
    tallies: USE_REASONS.map((key) => ({
      key,
      count: reasonSets.filter((set) => set.has(key)).length,
    })),
    answered: reasonSets.filter((set) => set.size > 0).length,
  };

  const handOff = HAND_OFF_TASKS.map((task, order) => {
    const counts = Object.fromEntries(HAND_OFF_ANSWERS.map((answer) => [answer, 0])) as Record<
      HandOffAnswer,
      number
    >;
    for (const a of all) {
      const answer = a.handOff?.[task];
      if (answer) counts[answer] += 1;
    }
    const answered = HAND_OFF_ANSWERS.reduce((sum, answer) => sum + counts[answer], 0);
    const net = answered === 0 ? 0 : (counts.gladly - counts.myself) / answered;
    return { row: { task, counts, answered, net }, order };
  })
    .sort((x, y) => {
      if ((x.row.answered === 0) !== (y.row.answered === 0)) return x.row.answered === 0 ? 1 : -1;
      return y.row.net - x.row.net || x.order - y.order;
    })
    .map(({ row }) => row);

  const scores = all.flatMap((a) =>
    a.umuxCapabilities !== undefined && a.umuxEase !== undefined
      ? [umuxLite(a.umuxCapabilities, a.umuxEase)]
      : [],
  );

  const quotes = Object.fromEntries(
    FINDINGS_TEXT_FIELDS.map((field) => [
      field,
      responses.flatMap((r) => {
        const text = r.answers[field]?.trim();
        return text ? [{ id: `${r.id}:${field}`, field, text }] : [];
      }),
    ]),
  ) as Record<FindingsTextField, Quote[]>;

  return {
    respondents: responses.length,
    usage: tally(USAGE_LEVELS, all.map((a) => a.usage)),
    silence: { values: silenceValues, notApplicable: silenceNa, answered: silenceValues.length + silenceNa },
    useReasons,
    arrival: tally(ARRIVALS, all.map((a) => a.arrival)),
    wrapUp: tally(WRAP_UPS, all.map((a) => a.wrapUp)),
    handOff,
    umux: {
      capabilities: all.flatMap((a) => (a.umuxCapabilities !== undefined ? [a.umuxCapabilities] : [])),
      ease: all.flatMap((a) => (a.umuxEase !== undefined ? [a.umuxEase] : [])),
      scores,
    },
    keepUsing: tally(KEEP_USING, all.map((a) => a.keepUsing)),
    quotes,
  };
}
