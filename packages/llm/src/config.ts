/**
 * LiteLLM access.
 *
 * Every model call in the system goes through the LiteLLM proxy, and models are
 * referenced by ROLE rather than by name. Swapping the transcription model or
 * trying a different open-source reasoning model is then an env change, not a
 * code change — which matters both for cost control and for reproducibility
 * when reporting what the deployment actually ran.
 */

export type ModelRole =
  | "transcribe"
  | "fast"
  | "reasoning"
  | "transcribe_live"
  | "converse"
  | "speak"
  | "embed";

const ROLE_ENV: Record<ModelRole, string> = {
  transcribe: "MODEL_TRANSCRIBE",
  fast: "MODEL_FAST",
  reasoning: "MODEL_REASONING",
  transcribe_live: "MODEL_TRANSCRIBE_LIVE",
  converse: "MODEL_CONVERSE",
  speak: "MODEL_SPEAK",
  embed: "MODEL_EMBED",
};

/**
 * Roles that fall back to another role when unset, and why.
 *
 * `transcribe_live` is the live conversation's ASR. It exists as its own role
 * because the chunk pipeline runs `transcribe.chunk` at batchSize 4 against the
 * same GPU continuously during a drive, and a measured live turn queues behind
 * it for 6-8 SECONDS. The ledger wants `large-v3` (quality matters, latency does
 * not); the live path wants a small model on its own queue (latency matters,
 * quality does not — its output is a working copy that is never written to the
 * `utterance` ledger). Falling back to MODEL_TRANSCRIBE keeps a single-model
 * deployment working, just slowly; see scripts/spike-talkback.mjs for the numbers.
 *
 * `converse` deliberately does NOT fall back to `fast`. MODEL_FAST is chosen for
 * the workspace extractor, and the measured behaviour of gemma3:12b is that it
 * accepts a `tools` parameter without erroring and then never calls a tool —
 * which would present as an agent that simply refuses to look anything up, with
 * no error to explain why. Better to fail at boot with a clear message.
 */
const ROLE_FALLBACK: Partial<Record<ModelRole, ModelRole>> = {
  transcribe_live: "transcribe",
};

export function modelFor(role: ModelRole): string {
  const model = process.env[ROLE_ENV[role]];
  if (model) return model;

  const fallback = ROLE_FALLBACK[role];
  if (fallback) {
    const inherited = process.env[ROLE_ENV[fallback]];
    if (inherited) return inherited;
  }

  throw new Error(
    `${ROLE_ENV[role]} is not set. Models are referenced by role — see .env.example.`,
  );
}

/** Whether a role is configured, without throwing. Lets a service degrade a
 *  feature (talk-back cannot speak) instead of failing to start. */
export function hasModelFor(role: ModelRole): boolean {
  if (process.env[ROLE_ENV[role]]) return true;
  const fallback = ROLE_FALLBACK[role];
  return Boolean(fallback && process.env[ROLE_ENV[fallback]]);
}

/** The env var backing a role, for error messages and preflight output. */
export function envVarFor(role: ModelRole): string {
  return ROLE_ENV[role];
}

export interface LiteLLMConfig {
  baseUrl: string;
  apiKey: string;
}

export function litellmConfig(): LiteLLMConfig {
  const baseUrl = process.env.LITELLM_BASE_URL;
  const apiKey = process.env.LITELLM_API_KEY;
  if (!baseUrl) throw new Error("LITELLM_BASE_URL is not set.");
  if (!apiKey) throw new Error("LITELLM_API_KEY is not set.");
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

/** Raised for a non-2xx LiteLLM response, carrying enough detail to triage. */
export class LiteLLMError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
    readonly endpoint: string,
  ) {
    super(`LiteLLM ${endpoint} failed with ${status}: ${body.slice(0, 500)}`);
    this.name = "LiteLLMError";
  }

  /**
   * Whether retrying could plausibly succeed. 429 and 5xx are transient;
   * a 400 means we sent something wrong and will keep sending it.
   */
  get retryable(): boolean {
    return this.status === 429 || this.status >= 500;
  }
}
