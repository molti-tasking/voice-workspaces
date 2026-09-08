/**
 * Drafts: text the agent handed over to be kept, rather than said.
 *
 * The write side is reached only by the voice container, through
 * `/api/realtime/draft`. The read side feeds two places — the live cue panel
 * during a drive and the session page afterwards — and both read Postgres
 * directly, so a draft survives a reload, a tunnel, and the container dying.
 * That is the same rule the rest of the display follows: the ledger is durable,
 * the conversation is ephemeral.
 */
import { asc, eq } from "drizzle-orm";
import { getDb } from "./index";
import { agentDraft } from "./schema";

export interface Draft {
  id: string;
  seq: number;
  startOffsetMs: number;
  title: string;
  text: string;
  respondingToText: string | null;
  createdAt: Date;
}

export interface RecordDraftInput {
  captureSessionId: string;
  seq: number;
  startOffsetMs: number;
  title: string;
  text: string;
  respondingToText?: string | null;
}

/**
 * Write one draft. Idempotent on `(captureSessionId, seq)`.
 *
 * The container fires this off without awaiting a reply and retries nothing by
 * itself, but a POST that times out after the row landed would otherwise leave
 * a second copy on the screen if it were ever retried. `seq` is the container's
 * own counter for the drive, so the conflict target is a fact about the
 * conversation rather than a hash of the text — two genuinely different drafts
 * with identical wording still both land.
 */
export async function recordDraft(input: RecordDraftInput): Promise<void> {
  await getDb()
    .insert(agentDraft)
    .values({
      captureSessionId: input.captureSessionId,
      seq: input.seq,
      startOffsetMs: input.startOffsetMs,
      title: input.title,
      text: input.text,
      respondingToText: input.respondingToText ?? null,
    })
    .onConflictDoNothing({
      target: [agentDraft.captureSessionId, agentDraft.seq],
    });
}

/** Every draft from one drive, oldest first — the order they were asked for. */
export async function loadSessionDrafts(captureSessionId: string): Promise<Draft[]> {
  return getDb()
    .select({
      id: agentDraft.id,
      seq: agentDraft.seq,
      startOffsetMs: agentDraft.startOffsetMs,
      title: agentDraft.title,
      text: agentDraft.text,
      respondingToText: agentDraft.respondingToText,
      createdAt: agentDraft.createdAt,
    })
    .from(agentDraft)
    .where(eq(agentDraft.captureSessionId, captureSessionId))
    .orderBy(asc(agentDraft.seq));
}
