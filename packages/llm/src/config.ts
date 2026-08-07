/**
 * LiteLLM access.
 *
 * Every model call in the system goes through the LiteLLM proxy, and models are
 * referenced by ROLE rather than by name. Swapping the transcription model or
 * trying a different open-source reasoning model is then an env change, not a
 * code change — which matters both for cost control and for reproducibility
 * when reporting what the deployment actually ran.
 */

export type ModelRole = "transcribe" | "fast" | "reasoning";

const ROLE_ENV: Record<ModelRole, string> = {
  transcribe: "MODEL_TRANSCRIBE",
  fast: "MODEL_FAST",
  reasoning: "MODEL_REASONING",
};

export function modelFor(role: ModelRole): string {
  const envVar = ROLE_ENV[role];
  const model = process.env[envVar];
  if (!model) {
    throw new Error(
      `${envVar} is not set. Models are referenced by role — see .env.example.`,
    );
  }
  return model;
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
