import { chat } from "@voicemural/llm";
import { log } from "@voicemural/telemetry";
import { sttLanguageProfile } from "./language";

/**
 * The rolling summary of the current drive.
 *
 * Adapted near-verbatim from VoiceStudio's live summary subagent
 * (`data/observable/users/*\/agents/summary/SUBAGENT.md`), which was already
 * tuned for exactly this job. Two lines of it are load-bearing and should not
 * be trimmed for brevity:
 *
 *   "Integrate the new utterance into the prior summary; do not merely append
 *   it."  — without this the summary becomes a transcript and grows without
 *   bound, which is the problem it exists to solve.
 *
 *   "Preserve uncertainty and corrections."  — each fold builds on the last, so
 *   a fabrication introduced early survives indefinitely and the ledger cannot
 *   correct it. This is the only guard against the summary amplifying its own
 *   mistakes.
 *
 * The word cap is what turns O(n) drive context into O(1): a summary that may
 * not exceed ninety words costs the same at turn forty as at turn four.
 *
 * Sent to the Python container in the `/api/realtime/session` response rather
 * than duplicated there, so there is one copy of this text.
 */
export const SUMMARY_PROMPT = `You maintain a concise, evolving summary of what someone has said aloud while thinking out loud.

Prioritise decisions, unresolved questions, concrete next steps, and the thread of the argument they are working through. Integrate new speech into the prior summary; do not merely append it. Preserve uncertainty and corrections — if they contradicted themselves or changed their mind, that IS the content, not noise to tidy away.

This is automatic transcription of unrehearsed speech, so it contains mistakes, false starts and half-finished sentences. Do not repair them into claims they did not make, and never state as fact something that reads like a transcription artefact.

Return only a short Markdown bulleted list. Every bullet must begin with "- ". Use at most 6 bullets and 90 words total. Keep each bullet to one concise sentence. Use brief labels such as "Decision:", "Question:", or "Next:" when useful. Include no heading, introduction, conclusion, or standalone paragraph.`;

/**
 * The same instruction, told which language the drive is in.
 *
 * WHY. On the first formative pilot (19 Sep 2026) the drive was German —
 * `stt_language = de` — and the running summary handed to the model was
 * English. The summary is the freshest thing in the turn context, sitting
 * closest to the driver's words, so a summary in the wrong language is
 * pressure on every reply to leave the conversation's own language. The same
 * drive's extracted blocks came out half English, which the extraction prompt
 * now fixes separately (PROMPT_VERSION "6").
 *
 * The ENDONYM, from the recorder's own catalogue: "write in Deutsch" is
 * clearer to a model than "write in German", and it is the word the person
 * chose. Null — auto-detect, or a code the catalogue no longer offers — leaves
 * the prompt exactly as it was, which is what those drives ran under.
 *
 * Composed here rather than in the route for the same reason the prompt lives
 * here at all: one copy of the text.
 */
export function summaryPromptFor(language: string | null | undefined): string {
  const profile = sttLanguageProfile(language);
  if (!profile) return SUMMARY_PROMPT;
  return `${SUMMARY_PROMPT}\n\nThis drive is being spoken in ${profile.label}. Write the summary in ${profile.label} — it is their own words you are condensing.`;
}

/**
 * Fold new speech into an existing summary.
 *
 * Used server-side to SEED the summary when a drive connects — the running
 * fold during the drive happens in the Pipecat container, off the critical
 * path, against this same prompt.
 *
 * Never throws. A drive with no summary is a drive that has merely forgotten
 * the first few minutes; a drive that fails to connect because summarising
 * failed is a lost recording.
 */
export async function foldSummary(
  previous: string | null,
  newText: string,
): Promise<string | null> {
  if (!newText.trim()) return previous;

  const prior = previous?.trim()
    ? `Summary so far:\n${previous.trim()}`
    : "Summary so far: (nothing yet)";

  try {
    const result = await chat(
      [
        { role: "system", content: SUMMARY_PROMPT },
        { role: "user", content: `${prior}\n\nNewly spoken:\n${newText.trim()}` },
      ],
      { role: "summarise", maxTokens: 300, temperature: 0 },
    );
    return result.content.trim() || previous;
  } catch (err) {
    log.error("could not fold drive summary", {
      err: err instanceof Error ? err.message : String(err),
    });
    return previous;
  }
}
