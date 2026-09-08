import { MAX_CONTEXT_CHARS, trimToBudget } from "./budget";
import { mergePassages } from "./memory";
import { recallFromMemory } from "./memory-search";
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
  return (await buildTurnContext(userId, captureSessionId, said)).passages;
}

/** Where things stand on one topic, for the turn. */
export interface ContextThread {
  topicId: string;
  /** "Topic: … / - … / - Open: …" — compact, labelled lines. */
  text: string;
}

export interface TurnContext {
  passages: ContextPassage[];
  threads: ContextThread[];
}

/** Rendered threads may take this much of the turn; passages get the rest. */
const MAX_THREAD_CHARS = 1200;

/**
 * Everything recall has for one turn: passages from past drives and the state
 * of the topics what was said touches.
 *
 * Both arms of passage search run in parallel — lexical over `utterance`,
 * semantic over the memory index — and are merged lexical-first. Threads come
 * only from the index, because "where things stand" is a folded state and has
 * no lexical form in the ledger. Without MODEL_EMBED the semantic arm returns
 * nothing and this is exactly the lexical route it replaced.
 */
export async function buildTurnContext(
  userId: string,
  captureSessionId: string,
  said: string,
): Promise<TurnContext> {
  const [lexical, memory] = await Promise.all([
    searchTranscripts(userId, said, { excludeSessionId: captureSessionId }),
    recallFromMemory(userId, said, { excludeSessionId: captureSessionId }),
  ]);

  const merged = mergePassages(lexical, memory.passages);
  const labelled = merged.map((passage) => ({
    when: describeWhen(passage.occurredAt),
    text: passage.text,
  }));

  // Budgeted on the rendered length, not the passage count: four windows of
  // forty seconds of speech is a great deal more prompt than four short ones.
  const rendered = labelled.map((p) => `[${p.when}] ${p.text}`);
  const kept = new Set(trimToBudget(rendered, MAX_CONTEXT_CHARS));
  const passages = labelled.filter((_, i) => kept.has(rendered[i] ?? ""));

  const threadTexts = memory.threads.map((t) => t.text);
  const keptThreads = new Set(trimToBudget(threadTexts, MAX_THREAD_CHARS));
  const threads = memory.threads
    .filter((t) => keptThreads.has(t.text))
    .map((t) => ({ topicId: t.topicId, text: t.text }));

  return { passages, threads };
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
