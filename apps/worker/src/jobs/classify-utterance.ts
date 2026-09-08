/**
 * Write the content/directive split onto the ledger.
 *
 * One job per chunk. The chunk is the batch the model is paid for — a call
 * covering ten lines costs what a call covering one does — and it is also the
 * unit the partial index is built on, so a chunk either has unclassified
 * speech in it or does not.
 *
 * Two properties worth keeping:
 *
 * 1. **Most lines never reach a model.** `isDirectiveCandidate` is pure and
 *    rejects the overwhelming majority of speech; those are written `content`
 *    directly. On a quiet drive this job makes no network call at all.
 * 2. **The write is a one-way fill.** `recordClassifications` guards on
 *    `kind = 'unclassified'`, so running twice cannot change an answer and a
 *    failure simply leaves the rows for the next sweep. `text` is never
 *    touched; human corrections still go to `kindOverride`.
 */
import {
  capabilityNames,
  loadChunkUtterances,
  loadRepertoire,
  recordClassifications,
  type ClassificationWrite,
} from "@voicemural/db/repertoire";
import { chat, modelFor } from "@voicemural/llm";
import { isDirectiveCandidate } from "@voicemural/shared";
import {
  CLASSIFY_PROMPT_VERSION,
  CLASSIFY_TEMPERATURE,
  buildClassifyPrompt,
  parseClassificationResponse,
  type ClassifyCandidate,
} from "@voicemural/workspace";
import { capture, log } from "@voicemural/telemetry";

/**
 * Confidence written for a line the gate rejected outright.
 *
 * Deliberately middling rather than high. No model looked at it, and recording
 * a rejection as if it were a confident verdict would make the column useless
 * for the thing it exists for — tuning where the gate sits.
 */
export const GATE_CONFIDENCE = 40;

export interface ClassifyOutcome {
  utterances: number;
  candidates: number;
  directives: number;
  written: number;
  modelCalled: boolean;
  skipped?: string;
}

export async function classifyChunk(
  chunkId: string,
  userId: string,
): Promise<ClassifyOutcome> {
  const lines = await loadChunkUtterances(chunkId);
  if (lines.length === 0) {
    return {
      utterances: 0,
      candidates: 0,
      directives: 0,
      written: 0,
      modelCalled: false,
      skipped: "nothing unclassified",
    };
  }

  const names = await capabilityNames(userId);

  const candidates: ClassifyCandidate[] = [];
  const writes: ClassificationWrite[] = [];

  for (const line of lines) {
    if (isDirectiveCandidate(line.text, { capabilityNames: names })) {
      candidates.push({ id: line.id, text: line.text });
    } else {
      writes.push({
        utteranceId: line.id,
        captureSessionId: line.captureSessionId,
        kind: "content",
        confidence: GATE_CONFIDENCE,
      });
    }
  }

  let directives = 0;
  let modelCalled = false;

  if (candidates.length > 0) {
    modelCalled = true;
    const messages = buildClassifyPrompt(candidates, names);

    const result = await chat(messages, {
      role: "fast",
      temperature: CLASSIFY_TEMPERATURE,
      json: true,
    });

    const { classifications, warnings } = parseClassificationResponse(
      result.content,
      candidates,
      names,
    );

    if (warnings.length > 0) {
      log.warn("classification warnings", { chunkId, warnings: warnings.slice(0, 5) });
    }

    // Resolve capability names to ids here rather than in the parser: the
    // parser is pure and must not know what a database row is.
    const repertoire = await loadRepertoire(userId);
    const byName = new Map(repertoire.map((c) => [c.name.toLowerCase(), c.id]));
    const byId = new Map(lines.map((l) => [l.id, l]));

    for (const c of classifications) {
      const line = byId.get(c.id);
      if (!line) continue;
      if (c.kind === "directive") directives += 1;
      writes.push({
        utteranceId: c.id,
        captureSessionId: line.captureSessionId,
        kind: c.kind,
        confidence: c.confidence,
        verb: c.verb,
        object: c.object,
        restatement: c.restatement,
        capabilityId: c.capabilityName ? (byName.get(c.capabilityName) ?? null) : null,
      });
    }
  }

  const written = await recordClassifications(writes);

  if (directives > 0) {
    capture(userId, "directives_detected", {
      chunk_id: chunkId,
      directives,
      candidates: candidates.length,
      utterances: lines.length,
      prompt_version: CLASSIFY_PROMPT_VERSION,
      model: modelCalled ? modelFor("fast") : null,
    });
  }

  return {
    utterances: lines.length,
    candidates: candidates.length,
    directives,
    written,
    modelCalled,
  };
}
