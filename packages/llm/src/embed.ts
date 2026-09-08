import { LiteLLMError, hasModelFor, litellmConfig, modelFor } from "./config";
import { emitGeneration, type GenerationContext } from "./observe";

/**
 * Embeddings, for the memory index.
 *
 * One call per batch of texts via LiteLLM's OpenAI-compatible `/embeddings`.
 * The model is whatever MODEL_EMBED names, and the DIMENSION is whatever that
 * model returns: nothing here or in the schema pins it, because the models
 * worth considering disagree (768, 1024, 1536, 3072) and a self-hosted one is
 * the likely choice for a corpus of participants thinking aloud. The memory
 * table stores the model name beside every vector and searches only rows made
 * by the current model, so switching models means re-indexing, not migrating.
 */

export interface EmbeddingResult {
  vectors: number[][];
  /** What LiteLLM actually used — provenance, and the key rows are searched by. */
  resolvedModel: string;
  requestedModel: string;
  dimensions: number;
  promptTokens: number;
  latencyMs: number;
}

interface EmbeddingsResponse {
  model?: string;
  data?: { index?: number; embedding?: number[] }[];
  usage?: { prompt_tokens?: number };
}

/** Whether a memory index can be built or queried at all. */
export function hasEmbeddings(): boolean {
  return hasModelFor("embed");
}

/** The model rows must have been embedded with to be searchable now. */
export function embeddingModel(): string {
  return modelFor("embed");
}

export async function embed(
  texts: string[],
  options: { signal?: AbortSignal; context?: GenerationContext } = {},
): Promise<EmbeddingResult> {
  if (texts.length === 0) {
    const model = embeddingModel();
    return {
      vectors: [],
      resolvedModel: model,
      requestedModel: model,
      dimensions: 0,
      promptTokens: 0,
      latencyMs: 0,
    };
  }

  const { baseUrl, apiKey } = litellmConfig();
  const requestedModel = embeddingModel();
  const startedAt = Date.now();

  const res = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: requestedModel, input: texts, encoding_format: "float" }),
    signal: options.signal,
  });
  const latencyMs = Date.now() - startedAt;

  if (!res.ok) {
    throw new LiteLLMError(res.status, await res.text(), "/embeddings");
  }

  const json = (await res.json()) as EmbeddingsResponse;
  const data = json.data ?? [];
  if (data.length !== texts.length) {
    throw new Error(`embeddings: asked for ${texts.length} vectors, got ${data.length}`);
  }
  // The API may return them out of order; `index` is authoritative.
  const vectors: number[][] = new Array(texts.length);
  for (const [position, item] of data.entries()) {
    const at = item.index ?? position;
    if (!Array.isArray(item.embedding) || item.embedding.length === 0) {
      throw new Error(`embeddings: item ${at} carries no vector`);
    }
    vectors[at] = item.embedding;
  }
  const dimensions = vectors[0]?.length ?? 0;
  if (vectors.some((v) => v.length !== dimensions)) {
    throw new Error("embeddings: vectors of mixed dimension in one response");
  }

  const resolvedModel = json.model ?? requestedModel;
  emitGeneration({
    spanName: "embed",
    model: resolvedModel,
    latencyMs,
    context: options.context ?? {},
    properties: { texts: texts.length, dimensions },
  });

  return {
    vectors,
    resolvedModel,
    requestedModel,
    dimensions,
    promptTokens: json.usage?.prompt_tokens ?? 0,
    latencyMs,
  };
}
