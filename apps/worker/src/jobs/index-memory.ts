import {
  deleteTopicEntries,
  loadSessionForMemory,
  loadTopicHashes,
  replaceSessionPassages,
  sessionsAwaitingMemory,
  touchTopicEntries,
  upsertMemoryEntries,
  type NewMemoryEntry,
} from "@voicemural/db/memory";
import { loadOps } from "@voicemural/db/workspace";
import { embed, embeddingModel, hasEmbeddings } from "@voicemural/llm";
import { contentHash, cutPassages, renderTopicForMemory } from "@voicemural/talkback";
import { log } from "@voicemural/telemetry";
import { foldWorkspace } from "@voicemural/workspace";

/**
 * Build the memory index for one user.
 *
 * Two things, in one job so a user's index is never half-updated by two
 * concurrent runs (pg-boss singletonKey per user):
 *
 * 1. PASSAGES. Every ended drive not yet indexed is cut into stretches of
 *    speech (`cutPassages`), each embedded once and stored with the model that
 *    made it. Ended drives only — the live drive is the container's running
 *    summary's business, and a cut over a finished drive is final.
 *
 * 2. TOPICS. The workspace is folded, each live topic rendered as "where things
 *    stand", hashed, and re-embedded only if the hash changed since last time.
 *    Topics merged away are removed. So the index always holds the CURRENT
 *    state of every topic and never a history — history is what passages are.
 *
 * DERIVED. Nothing here is the record: `utterance` and `workspace_op` are, and
 * `pnpm memory:reindex` rebuilds all of this from them. A failure costs recall
 * quality on the next drive and nothing else, so errors are logged and the job
 * retried by pg-boss rather than escalated.
 *
 * Off without MODEL_EMBED: `hasEmbeddings()` is false and the sweep never
 * queues this.
 */

/** How many texts go to the embedder per call. */
const EMBED_BATCH = 32;

export interface IndexMemoryResult {
  sessionsIndexed: number;
  passagesWritten: number;
  topicsEmbedded: number;
  topicsRemoved: number;
}

export async function indexMemory(userId: string): Promise<IndexMemoryResult> {
  const result: IndexMemoryResult = {
    sessionsIndexed: 0,
    passagesWritten: 0,
    topicsEmbedded: 0,
    topicsRemoved: 0,
  };
  if (!hasEmbeddings()) return result;
  const model = embeddingModel();

  /* ---- passages, one ended drive at a time ---- */
  for (const sessionId of await sessionsAwaitingMemory(userId)) {
    const session = await loadSessionForMemory(sessionId);
    if (!session) continue;

    const passages = cutPassages(sessionId, session.utterances, session.spoken);
    const entries: NewMemoryEntry[] = [];
    for (let i = 0; i < passages.length; i += EMBED_BATCH) {
      const batch = passages.slice(i, i + EMBED_BATCH);
      const { vectors } = await embed(
        batch.map((p) => p.text),
        { context: { userId, sessionId } },
      );
      batch.forEach((p, j) => {
        entries.push({
          kind: "passage",
          refId: p.refId,
          captureSessionId: sessionId,
          occurredAt: new Date(session.startedAt.getTime() + p.startOffsetMs),
          text: p.text,
          contentHash: contentHash(p.text),
          // The REQUESTED model name, not the resolved one: search filters on
          // `embeddingModel()`, which is the requested name, and a proxy alias
          // that resolves differently on two days must not split the index.
          model,
          embedding: vectors[j]!,
          utteranceIds: p.utteranceIds,
        });
      });
    }

    // Written even when empty — a drive of pure echo or silence still counts
    // as indexed, or the sweep would offer it forever.
    await replaceSessionPassages(userId, sessionId, entries);
    result.sessionsIndexed++;
    result.passagesWritten += entries.length;
    log.info("memory: drive indexed", { userId, sessionId, passages: entries.length });
  }

  /* ---- topics: current state, re-embedded on change ---- */
  const ops = await loadOps(userId);
  if (ops.length > 0) {
    const state = foldWorkspace(ops);
    const existing = await loadTopicHashes(userId);

    const wanted = state.topics.map((topic) => {
      const text = renderTopicForMemory(topic, state.blocksByTopic.get(topic.id) ?? []);
      return { topic, text, hash: contentHash(text) };
    });
    const changed = wanted.filter((w) => {
      const had = existing.get(w.topic.id);
      return !had || had.contentHash !== w.hash || had.model !== model;
    });
    const gone = [...existing.keys()].filter((id) => !state.topics.some((t) => t.id === id));

    for (let i = 0; i < changed.length; i += EMBED_BATCH) {
      const batch = changed.slice(i, i + EMBED_BATCH);
      const { vectors } = await embed(
        batch.map((w) => w.text),
        { context: { userId } },
      );
      await upsertMemoryEntries(
        userId,
        batch.map((w, j) => ({
          kind: "topic" as const,
          refId: w.topic.id,
          occurredAt: w.topic.lastTouchedAt,
          text: w.text,
          contentHash: w.hash,
          model,
          embedding: vectors[j]!,
        })),
      );
      result.topicsEmbedded += batch.length;
    }
    if (gone.length > 0) {
      await deleteTopicEntries(userId, gone);
      result.topicsRemoved = gone.length;
    }
    // Settle the "workspace moved since last index" check even when nothing
    // needed re-embedding, or the sweep would re-queue this user every pass.
    await touchTopicEntries(userId);
  }

  if (result.topicsEmbedded || result.topicsRemoved) {
    log.info("memory: topics refreshed", { userId, ...result });
  }
  return result;
}
