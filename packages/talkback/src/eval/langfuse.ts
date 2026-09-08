/**
 * Putting an eval run into Langfuse, next to the drives.
 *
 * The container's live turns reach Langfuse as OpenTelemetry spans — see
 * `setup_langfuse_tracing` in `bot.py` — with `langfuse.session.id` set to the
 * capture session and `langfuse.trace.tags` naming the prompt version. The
 * harness does not run inside Pipecat, so it has no spans to export; it posts
 * the same shape through Langfuse's public ingestion API instead: one trace per
 * evaluated turn, a generation for the reply and one for the judge, and the
 * check result and judge scores as scores on the trace. Same keys as bot.py,
 * same project, so a filter on `version` shows drives and eval runs together.
 *
 * No SDK. One POST per turn, basic-auth with the key pair, and a batch body —
 * which is all the ingestion endpoint is. Entirely optional: without the keys
 * nothing is posted and the run says so once.
 */

export interface LangfuseConfig {
  host: string;
  publicKey: string;
  secretKey: string;
}

export function langfuseConfig(env: NodeJS.ProcessEnv = process.env): LangfuseConfig | null {
  const publicKey = env.LANGFUSE_PUBLIC_KEY;
  const secretKey = env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) return null;
  return {
    host: (env.LANGFUSE_HOST || "https://cloud.langfuse.com").replace(/\/+$/, ""),
    publicKey,
    secretKey,
  };
}

/**
 * A trace id Langfuse accepts.
 *
 * Langfuse v3 stores traces on OpenTelemetry ids — 32 lowercase hex characters
 * — and rejects anything else on ingestion. A UUID without its dashes is one.
 */
export function newTraceId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

export interface GenerationRecord {
  name: string;
  model: string;
  input: unknown;
  output: string;
  startedAt: Date;
  latencyMs: number;
  usage?: { input: number; output: number };
}

export interface ScoreRecord {
  name: string;
  value: number | string;
  comment?: string;
}

export interface TraceRecord {
  id: string;
  name: string;
  sessionId: string;
  tags: string[];
  version: string;
  input: unknown;
  output: string;
  metadata: Record<string, unknown>;
  generations: GenerationRecord[];
  scores: ScoreRecord[];
}

interface IngestionEvent {
  id: string;
  type: string;
  timestamp: string;
  body: Record<string, unknown>;
}

/** The batch the ingestion endpoint takes, built from one evaluated turn. */
export function ingestionEvents(trace: TraceRecord, now: Date = new Date()): IngestionEvent[] {
  const at = now.toISOString();
  const events: IngestionEvent[] = [
    {
      id: crypto.randomUUID(),
      type: "trace-create",
      timestamp: at,
      body: {
        id: trace.id,
        name: trace.name,
        sessionId: trace.sessionId,
        tags: trace.tags,
        version: trace.version,
        input: trace.input,
        output: trace.output,
        metadata: trace.metadata,
      },
    },
  ];
  for (const generation of trace.generations) {
    events.push({
      id: crypto.randomUUID(),
      type: "generation-create",
      timestamp: at,
      body: {
        id: crypto.randomUUID(),
        traceId: trace.id,
        name: generation.name,
        model: generation.model,
        input: generation.input,
        output: generation.output,
        startTime: generation.startedAt.toISOString(),
        endTime: new Date(generation.startedAt.getTime() + generation.latencyMs).toISOString(),
        ...(generation.usage ? { usage: generation.usage } : {}),
      },
    });
  }
  for (const score of trace.scores) {
    events.push({
      id: crypto.randomUUID(),
      type: "score-create",
      timestamp: at,
      body: {
        id: crypto.randomUUID(),
        traceId: trace.id,
        name: score.name,
        value: score.value,
        comment: score.comment,
        dataType: typeof score.value === "number" ? "NUMERIC" : "CATEGORICAL",
      },
    });
  }
  return events;
}

/** Post one evaluated turn. Throws on a non-2xx so the caller can count it. */
export async function ingestTrace(config: LangfuseConfig, trace: TraceRecord): Promise<void> {
  const auth = Buffer.from(`${config.publicKey}:${config.secretKey}`).toString("base64");
  const res = await fetch(`${config.host}/api/public/ingestion`, {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({ batch: ingestionEvents(trace) }),
  });
  // 207 is the endpoint's normal answer: per-event outcomes inside.
  if (!res.ok) throw new Error(`langfuse ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json().catch(() => null)) as { errors?: unknown[] } | null;
  if (body?.errors?.length) throw new Error(`langfuse rejected ${body.errors.length} event(s)`);
}
