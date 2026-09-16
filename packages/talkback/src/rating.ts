/**
 * "Hey, rate this" — the driver's channel for saying how it is going.
 *
 * WHY IT EXISTS. Everything else the study measures is behavioural: whether a
 * card moved, whether a person put it back, how long a reply took. None of it
 * asks whether the thing was any good, and the participant is alone in a car
 * with no way to say so at the moment they think it. A debrief at the desk
 * gets the drive as remembered twenty minutes later; this gets it while it is
 * still happening, which is a different measurement rather than a cheaper one.
 *
 * WHY IT IS NOT A TOOL THE MODEL CALLS. The probe is an instrument, and an
 * instrument that fires when a language model decides it has been addressed is
 * not one. "Rate this" is matched deterministically in the container
 * (`RatingProbe` in apps/pipecat/bot.py), before the words reach the model at
 * all — and the exchange that follows never reaches it either. A rating the
 * agent could hear is a rating given to somebody who is listening, which is
 * the whole thing this is trying not to be.
 *
 * WHAT LIVES HERE AND WHAT LIVES IN PYTHON. These lines, the voice
 * (`ratingVoiceIdFor`) and the row that gets written are TypeScript, handed to
 * the container by `/api/realtime/session` exactly as the prompt and the
 * summary instruction are: one copy of the words, changeable without
 * rebuilding an image. Matching what the driver said is Python, because it
 * happens on live ASR inside the pipeline — the container carries its own
 * copies of these lines only as the fallback for a degraded connection.
 */
import { getDb, interactionRating } from "@voicemural/db";
import { log } from "@voicemural/telemetry";

/* ---------------------------------------------------------------------------
 * What the probe says
 * ------------------------------------------------------------------------- */

/**
 * The probe's whole vocabulary, spoken in the rating voice.
 *
 * Short to the point of curtness, and deliberately: this is an interruption
 * the driver asked for, it is not a conversation, and every word it spends is
 * a word taken from the drive. The question names the scale because a scale
 * nobody states is a scale everybody answers differently.
 */
export interface RatingLines {
  /** Asked as soon as the second voice takes over. */
  question: string;
  /** Asked once when the answer was not a number. */
  reask: string;
  /** Spoken back with the number, so the driver hears what was recorded. */
  ack: string;
  /** For "never mind". */
  cancelled: string;
  /** After a second unusable answer. The probe then lets go. */
  gaveUp: string;
}

export const RATING_LINES: RatingLines = {
  question: "How was that? One to five.",
  reask: "One to five, or say never mind.",
  // `{rating}` is substituted by the container. Saying the number back is the
  // only confirmation available to someone who cannot look at anything.
  ack: "{rating}. Noted.",
  cancelled: "Never mind, then.",
  gaveUp: "Let's leave it.",
};

/** The scale, stated once here so the route and the writer agree on it. */
export const MIN_RATING = 1;
export const MAX_RATING = 5;

/* ---------------------------------------------------------------------------
 * The row
 * ------------------------------------------------------------------------- */

export type RatingOutcome = "rated" | "cancelled" | "unclear" | "timeout";

export interface InteractionRatingRecord {
  captureSessionId: string;
  /** For log attribution only — the row is keyed by session. */
  userId: string;
  seq: number;
  askedOffsetMs: number;
  endedOffsetMs: number;
  answeredOffsetMs?: number;
  /** 1–5, and only with `outcome: "rated"`. */
  rating?: number;
  outcome: RatingOutcome;
  agentTurnId?: string;
  configVersion?: string;
}

/**
 * Persist one rating probe, whatever came of it.
 *
 * Never throws, for the reason `recordAgentTurn` does not: a drive that loses
 * a row has lost a row; a drive that crashes recording one has lost the drive.
 *
 * A rating outside the scale, or attached to an outcome that is not `rated`,
 * is stored as no rating rather than refused — the probe's other three
 * outcomes are the finding that the channel did not work, and dropping the row
 * to protect a column would delete exactly that.
 */
export async function recordInteractionRating(
  record: InteractionRatingRecord,
): Promise<string | null> {
  const rating =
    record.outcome === "rated" &&
    typeof record.rating === "number" &&
    Number.isInteger(record.rating) &&
    record.rating >= MIN_RATING &&
    record.rating <= MAX_RATING
      ? record.rating
      : null;

  try {
    const rows = await getDb()
      .insert(interactionRating)
      .values({
        captureSessionId: record.captureSessionId,
        seq: record.seq,
        askedOffsetMs: Math.max(0, record.askedOffsetMs),
        // Never before it started, whatever the container's clock did.
        endedOffsetMs: Math.max(record.askedOffsetMs, record.endedOffsetMs),
        answeredOffsetMs: record.answeredOffsetMs ?? null,
        rating,
        outcome: record.outcome,
        agentTurnId: record.agentTurnId ?? null,
        configVersion: record.configVersion,
      })
      .returning({ id: interactionRating.id });

    return rows[0]?.id ?? null;
  } catch (err) {
    log.error("could not record interaction rating", {
      captureSessionId: record.captureSessionId,
      userId: record.userId,
      seq: record.seq,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
