import { prolificCompletionUrl } from "@voicemural/shared";
import { DEFAULT_STUDY_TASK, type StudyTaskId } from "@voicemural/talkback/study-task";

/**
 * The Prolific study's settings, from the environment (PROLIFIC.md). Server
 * only: the completion codes must never reach a browser before the part they
 * pay for is finished.
 *
 * Every setting has a default that works on a laptop with nothing configured,
 * except the completion codes in production: a deployment that would hand out
 * a made-up code refuses to run the study instead, because Prolific rejects
 * such submissions and the participant is the one who pays for it.
 */

const isProduction = process.env.NODE_ENV === "production";

/**
 * Whether the Prolific study runs at all. Off unless `PROLIFIC_ENABLED` is
 * "true", here as in production: it was parked (19 Oct 2026) for the field
 * week with Keep, so `/p`, `/p/recall` and `/api/prolific/*` answer 404 and
 * nobody lands in it from an old link. Its code and tables stay as they are;
 * switching it back on is this variable and nothing else (PROLIFIC.md).
 */
export function prolificEnabled(): boolean {
  return process.env.PROLIFIC_ENABLED === "true";
}

function numberFrom(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

/** The code for a finished part, or null where the study is not configured. */
function code(part: 1 | 2): string | null {
  const value = process.env[`PROLIFIC_COMPLETION_CODE_PART${part}`]?.trim();
  if (value) return value;
  return isProduction ? null : `TEST-PART${part}`;
}

export interface ProlificConfig {
  /** Both completion codes are set (or this is not production). */
  configured: boolean;
  /** The task new participants get. */
  task: StudyTaskId;
  /** Hours after part 1 before part 2 opens. 0 lets a researcher test both parts in one sitting. */
  recallDelayHours: number;
  /** How long the conversation must run before Finish is offered. */
  minMinutes: number;
  /** When the page suggests wrapping up. */
  targetMinutes: number;
  /** Whether `?arm=` may pin the arm: never in production unless switched on. */
  allowArmParam: boolean;
}

export function prolificConfig(): ProlificConfig {
  const minMinutes = numberFrom("PROLIFIC_MIN_MINUTES", 10, 0, 120);
  return {
    configured: code(1) !== null && code(2) !== null,
    task: DEFAULT_STUDY_TASK,
    recallDelayHours: numberFrom("PROLIFIC_RECALL_DELAY_HOURS", 20, 0, 24 * 14),
    minMinutes,
    targetMinutes: Math.max(minMinutes, numberFrom("PROLIFIC_TARGET_MINUTES", 15, 0, 120)),
    allowArmParam: !isProduction || process.env.PROLIFIC_ALLOW_ARM_PARAM === "true",
  };
}

/** Where to send a participant who has finished a part, or null if no code is configured. */
export function completionUrlFor(part: 1 | 2): string | null {
  const value = code(part);
  return value ? prolificCompletionUrl(value) : null;
}

/** The code itself, shown on the page in case the redirect is blocked. */
export function completionCodeFor(part: 1 | 2): string | null {
  return code(part);
}
