import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb } from "@voicemural/db";
import { boardEnabledAt } from "@voicemural/db/board";
import { resolveStudyCondition } from "@voicemural/shared";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import {
  BOARD_EDITING,
  BOARD_TOOLS,
  SUMMARY_PROMPT,
  TALKBACK_CONFIG_VERSION,
  TITLE_PROMPT,
  asSttLanguage,
  asVoiceId,
  composeSystemPrompt,
  foldSummary,
  loadDriveSoFarText,
} from "@voicemural/talkback";

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
 * build-time copy can produce, so the container has to ask. It is composed
 * today from the session's `setting` — the same value that decides whether the
 * cue panel renders — so the agent and the screen can never disagree about
 * whether the person it is talking to can look at anything.
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
    .select({
      userId: captureSession.userId,
      startedAt: captureSession.startedAt,
      setting: captureSession.setting,
      voiceId: captureSession.voiceId,
      sttLanguage: captureSession.sttLanguage,
      studyCondition: captureSession.studyCondition,
    })
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

  // The board, and the agent's hands on it, only where the person has a board.
  // Decided once per connection, because the tools are registered once per
  // connection: a board switched on mid-drive shows up in the turn context
  // (the context route checks every turn) but the agent can only read it
  // until the next drive, which the base prompt handles.
  const boardEditable = (await boardEnabledAt(payload.userId).catch(() => null)) !== null;
  const composed = composeSystemPrompt({
    setting: row.setting,
    sections: boardEditable ? [BOARD_EDITING] : [],
  });

  return NextResponse.json(
    {
      systemPrompt: composed.prompt,
      summaryPrompt: SUMMARY_PROMPT,
      // The live topic title, folded in the container next to the summary and
      // pushed to the browser as an RTVI server message. Sent here for the same
      // reason as the summary instruction: one copy of the text, in TypeScript.
      // An older web app that does not send this leaves the container's
      // `TopicTitle` inert, which is the right failure — no board, no calls.
      titlePrompt: TITLE_PROMPT,
      // Echoed so a turn can be interpreted from the container's own logs, and
      // so `bot.py` need not parse prose to know the reply cap.
      setting: composed.setting,
      // The setting's proactivity level, so the container's proactive engine
      // (Offers) times its unprompted turns by the same value that governs how
      // forthcoming the prompt tells the model to be — one source of truth,
      // read in two places (PROACTIVE_AFTER_SECS in bot.py / setting.ts).
      proactivity: composed.proactivity,
      maxReplyWords: composed.maxReplyWords,
      displayAllowed: composed.displayAllowed,
      // The voice chosen for this recording, or null for "use the container's
      // ELEVENLABS_VOICE_ID fallback". Re-narrowed to the catalogue on the way
      // out so a retired id stored months ago cannot reach the TTS service.
      voiceId: asVoiceId(row.voiceId),
      // The transcription language chosen for this recording, or null for
      // auto-detect. Re-narrowed for the same reason as the voice: a code the
      // catalogue no longer offers must fall back to detection, not error the
      // ASR provider. Empty for every drive recorded before this existed,
      // which is fine — detection was what those drives were running anyway.
      sttLanguage: asSttLanguage(row.sttLanguage),
      driveSummary,
      // The container computes offsets against this so `agent_turn` shares a
      // clock with `utterance`, which is ms since the drive started.
      startedAtEpochMs: new Date(row.startedAt).getTime(),
      configVersion: TALKBACK_CONFIG_VERSION,
      // The study condition frozen onto THIS drive when it opened — not the
      // participant's current template, which may have moved to the next
      // phase since. Resolved, so the container reads flags and never
      // defaults. A drive from before conditions existed reads as the
      // defaults, which is what it ran under unless the container's
      // PROACTIVE_OFFERS said otherwise.
      studyCondition: resolveStudyCondition(row.studyCondition).condition,
      // OpenAI-format function tools for the container to register as they
      // are. Empty when the board is off, and then the prompt says nothing
      // about editing it either. Every call comes back to /api/realtime/board.
      tools: boardEditable ? BOARD_TOOLS : [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
