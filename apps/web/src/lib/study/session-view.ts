import type { StudyDesign, StudySession } from "@voicemural/db/study-session";
import {
  ConversationDisplay,
  prolificCompletionUrl,
  type SessionCompletion,
  type SessionDisplay,
} from "@voicemural/shared";
import { sessionTaskFor } from "@voicemural/talkback/study-task";

/**
 * The display study's session as its page and routes hand it to the
 * browser: the block's view and the words of its task, and — for a
 * participant from Prolific who has finished — the code that pays them.
 * Server only: a setup's completion code must never reach a browser before
 * the session it pays for is complete.
 */

/** The session's one conversation, as the page shows it. */
export interface SessionBlockView {
  position: number;
  display: SessionDisplay;
  task: { title: string; brief: string; prompts: string[] };
}

export function blockView(b: { position: number; display: string; task: string }): SessionBlockView {
  const task = sessionTaskFor(b.task);
  if (!task) throw new Error(`study block ${b.position} has a task not in the catalogue: ${b.task}`);
  // A block from before the views were renamed holds the old name.
  return {
    position: b.position,
    display: ConversationDisplay.parse(b.display),
    task: { title: task.title, brief: task.brief, prompts: [...task.prompts] },
  };
}

const isProduction = () => process.env.NODE_ENV === "production";

/**
 * Where a session's links point: `STUDY_SESSION_BASE_URL`, else the public
 * origin (`BETTER_AUTH_URL`), else the request's own. No trailing slash.
 */
export function studyBaseUrl(requestUrl?: string): string {
  const base =
    process.env.STUDY_SESSION_BASE_URL ||
    process.env.BETTER_AUTH_URL ||
    (requestUrl ? new URL(requestUrl).origin : "http://localhost:3000");
  return base.replace(/\/+$/, "");
}

/**
 * Whether a new Prolific session needs its setup to have a completion code:
 * in production, so nobody does the study and then finds there is nothing to
 * hand in. Elsewhere a made-up one stands in (`completionCodeOf`).
 */
export function completionCodeRequired(): boolean {
  return isProduction();
}

/** A setup's completion code; outside production, a made-up one where it has none. */
export function completionCodeOf(design: Pick<StudyDesign, "completionCode"> | null): string | null {
  return design?.completionCode ?? (isProduction() ? null : "TEST-SESSION");
}

/** What a finished Prolific participant is shown. Null for an invite, or before the end. */
export function completionFor(
  session: Pick<StudySession, "source" | "completedAt">,
  design: Pick<StudyDesign, "completionCode"> | null,
): SessionCompletion | null {
  if (session.source !== "prolific" || !session.completedAt) return null;
  const code = completionCodeOf(design);
  return code ? { code, url: prolificCompletionUrl(code) } : null;
}
