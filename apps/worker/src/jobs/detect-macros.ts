/**
 * Offer back the operations someone invented.
 *
 * Retrospective crystallisation, run by the system rather than asked for. The
 * user improvises an operation; when it recurs, the system names it, writes it
 * down, and offers it. Notes.md's other path — the user saying "make that a
 * thing" — is the same machinery reached from the other end, and lands here as
 * an ordinary direction.
 *
 * Two things this deliberately does NOT do:
 *
 * 1. **Install anything.** A proposal is not a capability until the person
 *    accepts it. `capability` is the repertoire, and the growth curve is the
 *    paper's dependent variable — filling it with things nobody agreed to would
 *    measure the detector rather than the person.
 * 2. **Go through the extraction cache.** `extraction`'s whole value is that a
 *    replay makes no network calls. Induction is a one-off creative call whose
 *    output is offered to a human; caching it there would poison a table whose
 *    determinism the workspace depends on.
 */
import {
  existingCanonicalForms,
  proposeMacro,
  unresolvedDirectives,
} from "@voicemural/db/repertoire";
import { artifact, getDb } from "@voicemural/db";
import { chat } from "@voicemural/llm";
import {
  buildMacroPrompt,
  mineRecurring,
  parseMacroResponse,
  MIN_OCCURRENCES,
  type MacroCandidate,
} from "@voicemural/workspace";
import { capture, log } from "@voicemural/telemetry";

export { MIN_OCCURRENCES };

/** How far back the miner looks. */
export const MACRO_WINDOW_DAYS = Number(process.env.MACRO_WINDOW_DAYS ?? 30);

/**
 * Proposals made per run.
 *
 * One. Offering three capabilities at once is a menu, and a menu is exactly the
 * fixed-grammar interface the whole design argues against — it also makes the
 * growth curve a step function of when the detector ran rather than of when the
 * person's needs changed.
 */
const MAX_PROPOSALS_PER_RUN = 1;

export interface DetectOutcome {
  directives: number;
  candidates: number;
  proposed: number;
  skipped?: string;
}

export async function detectMacros(userId: string): Promise<DetectOutcome> {
  const since = new Date(Date.now() - MACRO_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rows = await unresolvedDirectives(userId, since);

  if (rows.length < MIN_OCCURRENCES) {
    return { directives: rows.length, candidates: 0, proposed: 0, skipped: "too few directions" };
  }

  const mined = mineRecurring(rows);

  // Anything already offered is skipped, accepted or declined alike. A system
  // that re-asks after a refusal is worse than one that never asked.
  const alreadyOffered = await existingCanonicalForms(userId);
  const fresh = mined.filter((c) => !alreadyOffered.has(c.canonicalForm));

  let proposed = 0;

  for (const candidate of fresh.slice(0, MAX_PROPOSALS_PER_RUN)) {
    const induced = await induce(candidate);
    if (!induced) continue;

    const replayArtifactId = await writeReplayPreview(candidate, induced.restatement);

    const id = await proposeMacro({
      userId,
      canonicalForm: candidate.canonicalForm,
      occurrences: candidate.occurrences.map((o) => ({
        utteranceId: o.utteranceId,
        captureSessionId: o.captureSessionId,
        text: o.text,
        occurredAt: o.occurredAt.toISOString(),
      })),
      sessionCount: candidate.sessionCount,
      proposedName: induced.name,
      restatement: induced.restatement,
      markdown: induced.markdown,
      params: induced.params,
      replayArtifactId: replayArtifactId ?? undefined,
    });

    if (!id) continue;
    proposed += 1;

    capture(userId, "macro_proposed", {
      canonical_form: candidate.canonicalForm,
      occurrences: candidate.occurrences.length,
      session_count: candidate.sessionCount,
      has_replay: replayArtifactId !== null,
    });

    log.info("macro proposed", {
      userId,
      name: induced.name,
      form: candidate.canonicalForm,
    });
  }

  return { directives: rows.length, candidates: fresh.length, proposed };
}

async function induce(candidate: MacroCandidate) {
  try {
    // `reasoning`, not `fast`: this writes a capability the person will be
    // offered by name and will then live with. It happens once per pattern,
    // ever, so the cost is a rounding error against a drive of transcription.
    const result = await chat(buildMacroPrompt(candidate), { role: "reasoning", json: true });
    const induced = parseMacroResponse(result.content);
    if (!induced) {
      log.warn("macro induction unusable", { form: candidate.canonicalForm });
    }
    return induced;
  } catch (err) {
    log.error("macro induction failed", {
      form: candidate.canonicalForm,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Verification by replay, not by definition.
 *
 * Notes.md is explicit that the hard part of eyes-free authoring is checking
 * the result: the person cannot read the file. So what is stored is the
 * *effect* — the proposal run against the very speech that triggered it — with
 * spans back to those utterances. The repertoire page shows it; a voice
 * confirmation reads its first line. Either way they hear what it does rather
 * than what it says it does.
 *
 * Never throws: a proposal without a preview is worse than one with, and much
 * better than none.
 */
async function writeReplayPreview(
  candidate: MacroCandidate,
  restatement: string,
): Promise<string | null> {
  const session = candidate.occurrences[0]?.captureSessionId;
  if (!session) return null;

  const body = [
    restatement,
    "",
    ...candidate.occurrences.map((o) => `- ${o.text.trim()}`),
  ].join("\n");

  try {
    const [row] = await getDb()
      .insert(artifact)
      .values({
        captureSessionId: session,
        kind: "replay_preview",
        title: `If this had been running: ${candidate.canonicalForm}`,
        body,
        spans: candidate.occurrences.map((o) => ({
          utteranceId: o.utteranceId,
          startChar: 0,
          endChar: o.text.length,
        })),
      })
      .returning({ id: artifact.id });
    return row?.id ?? null;
  } catch (err) {
    log.warn("replay preview failed", {
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
