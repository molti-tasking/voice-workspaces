import { MAX_CONTEXT_CHARS, trimToBudget } from "./budget";
import { describeWhen, loadDriveSoFar, searchTranscripts } from "./retrieval";

/** One labelled passage from a past drive. */
export interface ContextPassage {
  /** Already human-readable — "yesterday", "3 weeks ago". */
  when: string;
  text: string;
}

/**
 * Passages from PAST recordings, for one turn.
 *
 * Returns structured passages rather than the flat prompt string this used to
 * build. The container assembles the final block now, because it is the only
 * party that holds the running summary of the current drive and that summary
 * has to sit last — closest to the user's message, since it is what anaphora
 * resolves against.
 *
 * NOTE WHAT IS NO LONGER HERE: "Earlier in this drive". It used to come from
 * `loadDriveSoFar`, which reads the `utterance` LEDGER — written by the batch
 * pipeline (10s chunks, a 5s worker sweep, then Whisper), so it trailed live
 * speech by 15-25 seconds. The driver would say something, ask about it, and
 * the context genuinely did not contain it yet. The live path keeps its own
 * running summary from the STT stream instead; see `RunningSummary` in
 * `apps/pipecat/bot.py`. The ledger is still the seed for that summary on
 * connect (see `loadDriveSoFarText`), and nothing else.
 *
 * Returns an empty array when there is nothing worth adding, so a turn with no
 * recall carries no extra prompt at all.
 */
export async function buildContextPassages(
  userId: string,
  captureSessionId: string,
  said: string,
): Promise<ContextPassage[]> {
  const fromThePast = await searchTranscripts(userId, said, {
    excludeSessionId: captureSessionId,
  });
  if (fromThePast.length === 0) return [];

  const labelled = fromThePast.map((passage) => ({
    when: describeWhen(passage.occurredAt),
    text: passage.text,
  }));

  // Budgeted on the rendered length, not the passage count: four windows of
  // forty seconds of speech is a great deal more prompt than four short ones.
  const rendered = labelled.map((p) => `[${p.when}] ${p.text}`);
  const kept = new Set(trimToBudget(rendered, MAX_CONTEXT_CHARS));
  return labelled.filter((_, i) => kept.has(rendered[i] ?? ""));
}

/**
 * The current drive's ledger text, for seeding a running summary on connect.
 *
 * The ONLY remaining read of the ledger on the conversational path, and it
 * happens once per connection rather than once per turn. It exists so a
 * mid-drive reconnect — a tunnel, a dropped socket — does not start the
 * conversation over with no idea what has been discussed.
 */
export async function loadDriveSoFarText(captureSessionId: string): Promise<string> {
  const passages = await loadDriveSoFar(captureSessionId);
  return passages.map((p) => p.text).join(" ").trim();
}
