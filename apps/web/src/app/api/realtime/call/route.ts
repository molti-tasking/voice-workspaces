import { NextResponse } from "next/server";
import { z } from "zod";
import { captureSession, eq, getDb } from "@voicemural/db";
import { findBlockByCaptureSession } from "@voicemural/db/study-session";
import {
  LiteLLMError,
  hasModelFor,
  mintRealtimeSecret,
  mintTranscriptionSecret,
  modelFor,
  openaiDirectConfig,
  type RealtimeEagerness,
} from "@voicemural/llm";
import { resolveStudyCondition } from "@voicemural/shared";
import { issueTicket } from "@voicemural/shared/realtime-ticket";
import {
  LOOKUP_TOOL,
  REALTIME_CONFIG_VERSION,
  STUDY_SCREEN,
  asSttLanguage,
  composeRealtimeFieldPrompt,
  composeRealtimeSessionPrompt,
  nextRecordSeqs,
  realtimeOpeningNudge,
  liveTranscriptionConfig,
  realtimeSessionConfig,
  realtimeVoiceFor,
  renderLocalTime,
  sessionTaskFor,
  timeZoneOf,
} from "@voicemural/talkback";
import { currentUserId } from "@/lib/session";
import { earlierInConversation } from "@/lib/talkback/earlier-in-conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Start one speech-to-speech call for a drive (`use-realtime.ts`).
 *
 * WHAT `/session` AND `/context` WERE TO THE CONTAINER, IN ONE ROUND TRIP. The
 * agent is composed here — the display study's session agent for a block,
 * the field companion for everyone else — and fixed for the call: the
 * engine takes nothing per turn, so what the agent knows of the time, the
 * screen and a conversation this one continues is said once, now.
 *
 * The browser gets a secret for ONE session, minted by the LiteLLM proxy with
 * that configuration, and the proxy's address to offer its audio to. The
 * proxy key never leaves this server, and the browser cannot choose the
 * agent's instructions, only connect to the session they were minted with.
 *
 * And the drive's ticket, for the records the container used to write — the
 * agent's turns, the subjects, the floor — through the same routes and the
 * same checks, with each counter resumed where this drive's rows end, so a
 * reconnect cannot collide with them.
 */

const Body = z.object({ captureSessionId: z.uuid() });

const CONTEXT_TICKET_TTL_MS = 3 * 60 * 60 * 1000;

const EAGERNESS: readonly RealtimeEagerness[] = ["low", "medium", "high", "auto"];

/**
 * `REALTIME_MOCK_SEARCH=on`: the agent can look things up, answered by the
 * mock search (`/api/realtime/lookup`). For demos and the display study only:
 * the results are made up.
 */
function mockSearch(): boolean {
  return process.env.REALTIME_MOCK_SEARCH?.trim().toLowerCase() === "on";
}

/**
 * `REALTIME_LIVE_TRANSCRIBE_MODEL` (`gpt-live-transcribe`): a transcription
 * session beside the call, so their words are on screen while they say them.
 * Unset is off, and the turn appears once it is transcribed, as before.
 *
 * Minted at OpenAI itself when `OPENAI_API_KEY` is set — the proxy cannot
 * carry a transcription call (`openaiDirectConfig`) — else through the proxy
 * by this name, for the day it can.
 */
function liveTranscribeModel(): string | null {
  return process.env.REALTIME_LIVE_TRANSCRIBE_MODEL?.trim() || null;
}

/** `REALTIME_EAGERNESS`, or the provider's own default. */
function eagerness(): RealtimeEagerness {
  const value = process.env.REALTIME_EAGERNESS?.trim();
  return EAGERNESS.includes(value as RealtimeEagerness) ? (value as RealtimeEagerness) : "auto";
}

export async function POST(req: Request) {
  const userId = await currentUserId(req);
  if (!userId) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  const { captureSessionId } = parsed.data;

  if (!hasModelFor("realtime")) {
    return NextResponse.json({ error: "not_configured" }, { status: 503 });
  }

  const [row] = await getDb()
    .select({
      userId: captureSession.userId,
      startedAt: captureSession.startedAt,
      endedAt: captureSession.endedAt,
      voiceId: captureSession.voiceId,
      sttLanguage: captureSession.sttLanguage,
      studyCondition: captureSession.studyCondition,
      deviceInfo: captureSession.deviceInfo,
      continuesId: captureSession.continuesId,
    })
    .from(captureSession)
    .where(eq(captureSession.id, captureSessionId))
    .limit(1);
  if (!row || row.userId !== userId) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  // A drive that has ended takes no call: Stop ends the session first, and an
  // agent connecting after it would talk into a drive the database says is over.
  if (row.endedAt) return NextResponse.json({ error: "ended" }, { status: 409 });

  const block = await findBlockByCaptureSession(captureSessionId).catch(() => null);
  const sessionTask = sessionTaskFor(block?.task);
  const timeZone = timeZoneOf(row.deviceInfo);
  const language = asSttLanguage(row.sttLanguage);
  // A block knows only its own conversation, so it never continues one.
  const continued =
    !sessionTask && row.continuesId
      ? await earlierInConversation(userId, row.continuesId, timeZone).catch(() => null)
      : null;
  const background = {
    localTime: renderLocalTime(new Date(), timeZone),
    screen: sessionTask ? STUDY_SCREEN : null,
    language,
    continued,
    lookup: mockSearch(),
  };
  const composed = sessionTask
    ? composeRealtimeSessionPrompt(sessionTask, background)
    : composeRealtimeFieldPrompt(background);

  const session = realtimeSessionConfig({
    model: modelFor("realtime"),
    instructions: composed.prompt,
    voice: realtimeVoiceFor(row.voiceId),
    language,
    // The provider's name, not the proxy's: transcription runs inside the
    // realtime session, at the provider.
    transcribeModel: process.env.REALTIME_TRANSCRIBE_MODEL?.trim() || "gpt-4o-transcribe",
    eagerness: eagerness(),
    tools: background.lookup ? [LOOKUP_TOOL] : [],
  });

  // The live words' session alongside, never in the way: refused, the call goes ahead without them.
  const liveModel = liveTranscribeModel();
  const [call, captions] = await Promise.allSettled([
    mintRealtimeSecret(session),
    liveModel
      ? mintTranscriptionSecret(
          liveModel,
          // The provider's name inside the session: the part after any proxy prefix.
          liveTranscriptionConfig({ model: liveModel.split("/").at(-1)!, language }),
          { direct: openaiDirectConfig() },
        )
      : Promise.resolve(null),
  ]);
  const failed = (what: string, err: unknown) =>
    console.warn(
      `[realtime] could not mint ${what}:`,
      err instanceof LiteLLMError ? `${err.status} ${err.body.slice(0, 300)}` : String(err),
    );
  if (call.status === "rejected") {
    failed("a call", call.reason);
    return NextResponse.json({ error: "unavailable" }, { status: 502 });
  }
  const secret = call.value;
  if (captions.status === "rejected") failed("the live transcription", captions.reason);
  const liveTranscription =
    captions.status === "fulfilled" && captions.value
      ? { clientSecret: captions.value.value, callsUrl: captions.value.callsUrl }
      : null;

  // Without a ticket the call still works; nothing of it is recorded, and the
  // recorder says so (`memory: "unavailable"`).
  let ticket: string | null = null;
  try {
    ({ ticket } = issueTicket({ userId, captureSessionId }, { ttlMs: CONTEXT_TICKET_TTL_MS }));
  } catch {
    console.warn("[realtime] no ticket: BETTER_AUTH_SECRET is unset, so this call records nothing");
  }

  const condition = resolveStudyCondition(row.studyCondition).condition;
  return NextResponse.json(
    {
      clientSecret: secret.value,
      expiresAt: secret.expiresAt,
      callsUrl: secret.callsUrl,
      requestedModel: session.model,
      resolvedModel: secret.resolvedModel,
      ticket,
      startedAtEpochMs: new Date(row.startedAt).getTime(),
      seq: await nextRecordSeqs(captureSessionId),
      openingNudge: realtimeOpeningNudge({ session: Boolean(sessionTask), proactiveOffers: condition.proactiveOffers }),
      // For the browser to lock and pause with: turn detection is the only
      // thing it changes on the session, and it has to resend it whole.
      turnDetection: session.audio.input.turn_detection,
      configVersion: REALTIME_CONFIG_VERSION,
      // The browser runs the search the agent asks for.
      lookup: background.lookup,
      // Their words as they say them, from a second session on the same track; null without.
      liveTranscription,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
