import { NextResponse } from "next/server";
import { z } from "zod";
import { and, captureSession, desc, eq, getDb, lt } from "@voicemural/db";
import { boardEnabledAt } from "@voicemural/db/board";
import { nextDraftSeq } from "@voicemural/db/drafts";
import { findParticipantByUser } from "@voicemural/db/prolific";
import { findBlockByCaptureSession } from "@voicemural/db/study-session";
import { resolveStudyCondition } from "@voicemural/shared";
import { verifyTicket } from "@voicemural/shared/realtime-ticket";
import {
  BOARD_EDITING,
  BOARD_TOOLS,
  RECENT_DRIVES_SHOWN,
  SESSION_OPENING_NUDGE,
  SETTLED_PROMPT,
  STUDY_PROFILE,
  STUDY_SYSTEM_PROMPT,
  TALKBACK_CONFIG_VERSION,
  TITLE_PROMPT,
  WEB_SEARCH_TOOL,
  asSttLanguage,
  asVoiceId,
  capabilitiesSection,
  composeSessionPrompt,
  composeSystemPrompt,
  foldSummary,
  loadDriveSoFarText,
  nativeVoicesByLanguage,
  renderRecentDrives,
  sessionTaskFor,
  studyTaskFor,
  summaryPromptFor,
  timeZoneOf,
  voiceFor,
  webSearchSection,
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
      deviceInfo: captureSession.deviceInfo,
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

  /* Where the container's draft counter should resume.
   *
   * Same reconnect story as the summary seed above, and a worse failure: the
   * counter restarting at 0 collides with rows this drive already has, and the
   * unique index turns every later draft into a silent no-op. Fails open to 0
   * — which is exactly the behaviour before this existed, so a broken read
   * costs a reconnected drive its drafts rather than costing every drive its
   * connection. */
  const draftSeq = await nextDraftSeq(payload.captureSessionId).catch(() => 0);

  // The board, and the agent's hands on it, only where the person has a board.
  // Decided once per connection, because the tools are registered once per
  // connection: a board switched on mid-drive shows up in the turn context
  // (the context route checks every turn) but the agent can only read it
  // until the next drive, which the base prompt handles.
  const boardEditable = (await boardEnabledAt(payload.userId).catch(() => null)) !== null;
  // Web search wherever an instance is configured. Checked here rather than
  // only in `/search` so a deployment without one never tells the model it can
  // look things up.
  const webSearch = Boolean(process.env.SEARXNG_URL);
  // Their drives before this one, by name, so "what did we discuss last
  // time?" has an answer (see recent-drives.ts). Fails open to none: an
  // agent that cannot name the last drive is what there was before.
  const earlier = await getDb()
    .select({
      title: captureSession.title,
      startedAt: captureSession.startedAt,
      endedAt: captureSession.endedAt,
    })
    .from(captureSession)
    .where(and(eq(captureSession.userId, payload.userId), lt(captureSession.startedAt, row.startedAt)))
    .orderBy(desc(captureSession.startedAt))
    .limit(RECENT_DRIVES_SHOWN)
    .catch(() => []);
  const recentDrives = renderRecentDrives(earlier, new Date(), timeZoneOf(row.deviceInfo));
  // A Prolific participant talks about the study's fixed task, in both arms
  // alike (study-task.ts). Fails open to none: the conversation still works,
  // and a missing task shows up in the export as an off-topic drive.
  const participant = await findParticipantByUser(payload.userId).catch(() => null);
  const studyTask = studyTaskFor(participant?.task);
  // A block of the display study talks to the session's own agent about the
  // block's task (study-agent.ts): the same agent for every view, with no
  // tools, no web search and nothing from the session's other blocks. Fails
  // open to the ordinary agent, as the Prolific task does.
  const block = await findBlockByCaptureSession(payload.captureSessionId).catch(() => null);
  const sessionTask = sessionTaskFor(block?.task);
  const searchSection = webSearch ? [webSearchSection(new Date(), timeZoneOf(row.deviceInfo))] : [];
  // Frozen to the day's concrete mode when the drive was registered.
  const condition = resolveStudyCondition(row.studyCondition).condition;
  // A participant talks to the study's own agent (study-agent.ts): a
  // conversational assistant at a desk, the same in both arms, with the task
  // on top. No board and no earlier drives — a participant has neither.
  // Everyone else gets the field study's agent, unchanged.
  const composed = sessionTask
    ? composeSessionPrompt(sessionTask)
    : studyTask
    ? composeSystemPrompt({
        base: STUDY_SYSTEM_PROMPT,
        profile: STUDY_PROFILE,
        sections: [studyTask.agentSection, ...searchSection],
      })
    : composeSystemPrompt({
        sections: [
          ...(boardEditable ? [BOARD_EDITING] : []),
          ...searchSection,
          // What it can do on THIS drive, from the same flags that decide it
          // (capabilities.ts): asked "what can you do?", it answered from
          // fragments, and could not say why there were no sparks.
          capabilitiesSection({
            board: boardEditable,
            webSearch,
            sparks: condition.sparks,
            sparkSelection: condition.sparkSelection === "chosen" ? "chosen" : "suggested",
          }),
          ...(recentDrives ? [recentDrives] : []),
        ],
      });

  return NextResponse.json(
    {
      systemPrompt: composed.prompt,
      // In the drive's own language. A German drive was getting an English
      // running summary, which sits closest to the driver's words in every
      // turn's context — see `summaryPromptFor`.
      summaryPrompt: summaryPromptFor(asSttLanguage(row.sttLanguage)),
      // The live topic title, folded in the container next to the summary and
      // pushed to the browser as an RTVI server message. Sent here for the same
      // reason as the summary instruction: one copy of the text, in TypeScript.
      // An older web app that does not send this leaves the container's
      // `TopicTitle` inert, which is the right failure — no board, no calls.
      titlePrompt: TITLE_PROMPT,
      // The opening turn's instruction, where it is not the field agent's: the
      // display study's session has no drive and no background to offer a
      // next step from (SESSION_OPENING_NUDGE). Null, the container keeps its
      // own OPENING_NUDGE, which is also what an older web app gets.
      openingNudge: sessionTask ? SESSION_OPENING_NUDGE : null,
      // Whether a subject the talk has just left was settled, judged in the
      // container when it is left and pushed to the recorder like the title.
      // Absent, the container makes no such call (`TopicTitle._judge`).
      settledPrompt: SETTLED_PROMPT,
      // The profile's proactivity level, so the container's proactive engine
      // (Offers) times its unprompted turns by the same value that governs how
      // forthcoming the prompt tells the model to be — one source of truth,
      // read in two places (PROACTIVE_AFTER_SECS in bot.py / profile.ts).
      proactivity: composed.proactivity,
      // Echoed so `bot.py` need not parse prose to know the reply cap.
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
      // What TTS is TOLD it is speaking. Without it ElevenLabs guesses from the
      // text, and the pilots heard every language with an English accent.
      // Null on auto-detect: bot.py's LanguageFollower sets it from what STT
      // hears instead.
      ttsLanguage: asSttLanguage(row.sttLanguage),
      // The voice that actually speaks: the chosen one, unless the drive is
      // pinned to a language the catalogue has a native speaker for. Kept
      // apart from `voiceId`, which stays what the person chose.
      ttsVoiceId: voiceFor(asSttLanguage(row.sttLanguage), asVoiceId(row.voiceId)),
      // For auto-detect drives: which voice to switch to when STT hears a
      // language, so the rule in `voiceFor` has one copy of its data.
      nativeVoices: nativeVoicesByLanguage(),
      driveSummary,
      // The container computes offsets against this so `agent_turn` shares a
      // clock with `utterance`, which is ms since the drive started.
      startedAtEpochMs: new Date(row.startedAt).getTime(),
      // The container seeds `DraftRecorder` from this rather than counting from
      // zero, so a reconnect mid-drive cannot collide with the drafts already
      // written. See `nextDraftSeq`.
      nextDraftSeq: draftSeq,
      configVersion: TALKBACK_CONFIG_VERSION,
      // The study condition frozen onto THIS drive when it opened — not the
      // participant's current template, which may have moved to the next
      // phase since. Resolved, so the container reads flags and never
      // defaults. A drive from before conditions existed reads as the
      // defaults, which is what it ran under unless the container's
      // PROACTIVE_OFFERS said otherwise.
      studyCondition: condition,
      // OpenAI-format function tools for the container to register as they
      // are. Board tools only when the board is on, and then the prompt says
      // nothing about editing it either; every call comes back to
      // /api/realtime/board.
      tools: sessionTask
        ? []
        : [...(boardEditable && !studyTask ? BOARD_TOOLS : []), ...(webSearch ? [WEB_SEARCH_TOOL] : [])],
      // Which of those is the search, so the container can route it to
      // /api/realtime/search, speak its announcement and play the cue —
      // without a tool name hard-coded in Python. Null when not offered.
      webSearchTool: webSearch && !sessionTask ? WEB_SEARCH_TOOL.function.name : null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
