import { NextResponse } from "next/server";
import { captureSession, eq, getDb } from "@voicemural/db";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import {
  SUMMARY_PROMPT,
  SYSTEM_PROMPT,
  TALKBACK_CONFIG_VERSION,
  foldSummary,
  loadDriveSoFarText,
} from "@voicemural/talkback";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Everything the voice container needs ONCE, at the start of a drive.
 *
 * The per-turn route (`/context`) is the hot path and carries only what changes
 * turn to turn. This one carries what does not: the prompt, the summary
 * instructions, and a seed summary of anything already said. Splitting them
 * that way is the whole point — the prompt is ~2.5KB and the seed costs a model
 * call, and paying either on every turn would be paying for a constant.
 *
 * WHY THE PROMPT COMES OVER HTTP AT ALL. It used to live in
 * `apps/agent/src/prompt.ts`, and `bot.py` recovered it by string-parsing that
 * TypeScript file at import time — with the file copied into the image by the
 * Dockerfile. That worked only because the prompt was a constant. From Phase 3
 * it is composed per driver from `capabilityVersion.markdown`, which no
 * build-time copy can produce, so the container has to ask.
 *
 * Authorised by the same drive-scoped ticket as `/context`, and ownership is
 * re-resolved here rather than trusted from the payload, for the same reason
 * given there.
 */

const Body = z.object({
  ticket: z.string().min(1),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  let payload;
  try {
    payload = verifyTicket(parsed.data.ticket);
  } catch {
    return NextResponse.json({ error: "bad_ticket" }, { status: 401 });
  }

  const rows = await getDb()
    .select({ userId: captureSession.userId, startedAt: captureSession.startedAt })
    .from(captureSession)
    .where(eq(captureSession.id, payload.captureSessionId))
    .limit(1);

  const row = rows[0];
  if (!row || row.userId !== payload.userId) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  /* Seed the running summary from the ledger.
   *
   * This is the ONE read of `utterance` left on the conversational path, and it
   * exists for reconnects: a tunnel drops the socket mid-drive, the container
   * restarts with an empty summary, and without this the agent would have no
   * idea what the last twenty minutes were about.
   *
   * Fails open. `foldSummary` never throws, and an absent seed costs the first
   * few minutes of recall — an absent connection costs the whole drive. */
  const driveSoFar = await loadDriveSoFarText(payload.captureSessionId).catch(() => "");
  const driveSummary = driveSoFar ? await foldSummary(null, driveSoFar) : null;

  return NextResponse.json(
    {
      systemPrompt: SYSTEM_PROMPT,
      summaryPrompt: SUMMARY_PROMPT,
      driveSummary,
      // The container computes offsets against this so `agent_turn` shares a
      // clock with `utterance`, which is ms since the drive started.
      startedAtEpochMs: new Date(row.startedAt).getTime(),
      configVersion: TALKBACK_CONFIG_VERSION,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
