import { litellmConfig, modelFor } from "@voicemural/llm";
import { log } from "@voicemural/telemetry";

/**
 * Check LiteLLM once at startup and say plainly whether it is usable.
 *
 * Without this, a bad base URL or a stale value cached from before someone
 * edited .env surfaces only as a rolling flood of `fetch failed` — one line per
 * chunk, per retry, with no hint that configuration is the cause. Diagnosing
 * that from the logs is far harder than it should be.
 *
 * Never throws: the worker must still start and keep accepting uploads, because
 * audio accumulating as `stored` is exactly the right behaviour while LiteLLM
 * is unreachable.
 */
export async function preflightLiteLLM(): Promise<void> {
  let baseUrl: string;
  let apiKey: string;
  let transcribeModel: string;

  try {
    ({ baseUrl, apiKey } = litellmConfig());
    transcribeModel = modelFor("transcribe");
  } catch (err) {
    log.error("LiteLLM is not configured — transcription will fail", {
      reason: err instanceof Error ? err.message : String(err),
      hint: "Set LITELLM_BASE_URL, LITELLM_API_KEY and MODEL_* in .env, then restart.",
    });
    return;
  }

  try {
    const res = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      log.error("LiteLLM reachable but rejected our key", {
        baseUrl,
        status: res.status,
        hint: res.status === 401 ? "Check LITELLM_API_KEY." : undefined,
      });
      return;
    }

    const body = (await res.json()) as { data?: { id?: string }[] };
    const available = (body.data ?? []).map((m) => m.id).filter(Boolean) as string[];
    const hasTranscribe = available.includes(transcribeModel);

    log.info("LiteLLM reachable", {
      baseUrl,
      models: available.length,
      transcribeModel,
      transcribeModelAvailable: hasTranscribe,
    });

    if (!hasTranscribe && available.length > 0) {
      // Wrong model name fails per-chunk with an opaque 400; say so up front.
      log.warn("MODEL_TRANSCRIBE is not in this LiteLLM's model list", {
        transcribeModel,
        // Enough to spot the right name without dumping a huge list.
        sample: available.slice(0, 15),
      });
    }
  } catch (err) {
    log.error("LiteLLM unreachable — chunks will queue as `stored` until it returns", {
      baseUrl,
      reason: err instanceof Error ? err.message : String(err),
      hint:
        "If you just edited .env, restart: the worker reads it once at startup. " +
        "Also check whether this host needs the university VPN.",
    });
  }
}
