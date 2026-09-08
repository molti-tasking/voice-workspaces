/**
 * The semantic arm of recall.
 *
 * Lexical search finds the word; this finds the thought. Both run on every
 * turn, in parallel, and `mergePassages` puts lexical first — an exact name or
 * number is what people most often ask to be reminded of, and a lexical hit is
 * never a false friend. The semantic arm fills in behind with paraphrases the
 * word search cannot see: "the deadline" against "when it has to be submitted".
 *
 * It also answers a different question: WHERE THINGS STAND. Topic entries are
 * the workspace's current state per topic, embedded as one text each, so the
 * two or three topics nearest to what was just said come back as compact
 * "Topic: … / Open: … / Next: …" blocks. That is what lets the agent refer to
 * the project instead of asking to have it explained again.
 *
 * LATENCY. The route this runs on exists for latency, and embedding the query
 * is a model call. It is bounded by `QUERY_TIMEOUT_MS` and skipped entirely
 * when the question has no content words; on timeout or error the turn simply
 * proceeds lexical-only, as every turn did before this existed. Nothing here
 * can fail a turn.
 *
 * OFF WITHOUT MODEL_EMBED. `hasEmbeddings()` is false, nothing is called, and
 * recall is exactly what it was.
 */

import { searchMemory } from "@voicemural/db/memory";
import { embed, embeddingModel, hasEmbeddings } from "@voicemural/llm";
import { log } from "@voicemural/telemetry";
import type { Passage } from "./retrieval";
import { contentWords } from "./retrieval";

/** How long a turn will wait for the query embedding before going lexical-only. */
export const QUERY_TIMEOUT_MS = Number(process.env.MEMORY_QUERY_TIMEOUT_MS ?? 700);

/** Cosine distance gates. Tuned loose for passages, tighter for topics. */
const PASSAGE_MAX_DISTANCE = Number(process.env.MEMORY_PASSAGE_MAX_DISTANCE ?? 0.55);
const TOPIC_MAX_DISTANCE = Number(process.env.MEMORY_TOPIC_MAX_DISTANCE ?? 0.5);

export interface Thread {
  /** The topic id, for logging and joins. */
  topicId: string;
  /** "Topic: … / - … / - Open: …", as stored. */
  text: string;
  /** When the topic last moved. */
  updatedAt: Date;
}

export interface MemoryRecall {
  passages: (Passage & { captureSessionId: string | null })[];
  threads: Thread[];
  /** Why there is nothing, when there is nothing. For the log line. */
  skipped?: "disabled" | "no_content_words" | "timeout" | "error";
}

const EMPTY: MemoryRecall = { passages: [], threads: [] };

/**
 * Semantic passages and relevant threads for what was just said.
 *
 * One embedding call, two searches. The searches run in parallel once the
 * vector is back; the whole thing is bounded by the query timeout.
 */
export async function recallFromMemory(
  userId: string,
  said: string,
  options: { excludeSessionId?: string; passageLimit?: number; threadLimit?: number } = {},
): Promise<MemoryRecall> {
  if (!hasEmbeddings()) return { ...EMPTY, skipped: "disabled" };
  if (contentWords(said).length === 0) return { ...EMPTY, skipped: "no_content_words" };

  const signal = AbortSignal.timeout(QUERY_TIMEOUT_MS);
  try {
    const { vectors } = await embed([said], { signal, context: { userId } });
    const vector = vectors[0];
    if (!vector) return EMPTY;
    const model = embeddingModel();

    const [passageHits, topicHits] = await Promise.all([
      searchMemory(userId, "passage", vector, model, {
        limit: options.passageLimit ?? 4,
        excludeSessionId: options.excludeSessionId,
        maxDistance: PASSAGE_MAX_DISTANCE,
      }),
      searchMemory(userId, "topic", vector, model, {
        limit: options.threadLimit ?? 2,
        maxDistance: TOPIC_MAX_DISTANCE,
      }),
    ]);

    return {
      passages: passageHits.map((h) => ({
        occurredAt: h.occurredAt,
        text: h.text,
        captureSessionId: h.captureSessionId,
      })),
      threads: topicHits.map((h) => ({ topicId: h.refId, text: h.text, updatedAt: h.occurredAt })),
    };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
    // A warning, not an error: the turn goes on without it, and the cause is
    // usually a cold self-hosted embedder rather than a fault.
    log.warn(timedOut ? "memory recall timed out, lexical only" : "memory recall failed, lexical only", {
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { ...EMPTY, skipped: timedOut ? "timeout" : "error" };
  }
}
