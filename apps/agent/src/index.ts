// Must run before anything reads process.env.
import { config } from "dotenv";
config({ path: new URL("../../../.env", import.meta.url).pathname, quiet: true });

import {
  Agent,
  AgentSession,
  type ChatContext,
  type ChatMessage,
  type JobContext,
  type JobProcess,
  ServerOptions,
  cli,
  defineAgent,
  voice,
} from "@livekit/agents";
import * as elevenlabs from "@livekit/agents-plugin-elevenlabs";
import * as openai from "@livekit/agents-plugin-openai";
import * as silero from "@livekit/agents-plugin-silero";
import { stt as stt_ } from "@livekit/agents";
import { litellmConfig, modelFor } from "@voicemural/llm";
import { installGenerationSink, log } from "@voicemural/telemetry";
import { recordAgentTurn } from "./agent-turns";
import { SYSTEM_PROMPT, TALKBACK_CONFIG_VERSION } from "./prompt";
import { buildContextMessage } from "@voicemural/talkback";

/**
 * Talk-back, on LiveKit Agents.
 *
 * REPLACES a hand-rolled WebSocket service, two AudioWorklets, an energy VAD,
 * a barge-in guard and a TTS chunker. That stack worked on paper and sounded
 * broken in practice: the agent interrupted itself on its own echo, and speech
 * came out in disconnected chunks because every clause was a separate HTTP
 * synthesis with its own prosody.
 *
 * Both are solved problems, and the framework solves them properly:
 *
 * - WebRTC carries the audio, so echo cancellation is the browser's real AEC
 *   against the actual render stream — not a threshold guessed from RMS.
 * - `turnHandling.interruption` needs real WORDS before it treats sound as an
 *   interruption, and `AgentFalseInterruption` reports when it changes its mind.
 * - The ElevenLabs plugin feeds text into ONE continuous websocket synthesis
 *   rather than a request per clause, which is what removes the seams.
 *
 * What did NOT move: the capture path and the ledger. The recorder still owns
 * the microphone and still writes `audio_chunk`/`utterance` exactly as before —
 * this joins the same room as a second consumer. Kill this process mid-drive and
 * capture is untouched, which remains the acceptance criterion for the feature.
 */

/** Room naming: one room per drive, so the session id travels with the room. */
export const ROOM_PREFIX = "drive-";

function captureSessionIdFromRoom(roomName: string): string | null {
  return roomName.startsWith(ROOM_PREFIX) ? roomName.slice(ROOM_PREFIX.length) : null;
}

export default defineAgent({
  /**
   * Silero is a few megabytes of ONNX and takes a moment to initialise. Loading
   * it per job would put that on the first turn of every drive.
   */
  prewarm: async (proc: JobProcess) => {
    proc.userData.vad = await silero.VAD.load();
  },

  entry: async (ctx: JobContext) => {
    const { baseUrl, apiKey } = litellmConfig();

    /* Connect FIRST, then read the room, then wait for the driver.
     *
     * Order matters and both halves were wrong to begin with: starting the
     * session before connecting gives it a room that is not joined yet, and
     * `localParticipant` is the AGENT — reading a user id from it yields the
     * agent's own identity, so retrieval would search the wrong person's
     * transcripts, or nobody's.
     *
     * The driver's identity is set by the token route from their authenticated
     * session, so it is trustworthy: the browser cannot choose whose transcripts
     * get read back to it. */
    await ctx.connect();

    // `room.name` is EMPTY until the connection completes — reading it before
    // `connect()` returned an empty string, the drive lookup failed, and the
    // agent returned immediately while LiveKit reported the job as assigned.
    // Two sources on purpose: `ctx.job.room` is set from the dispatch itself and
    // is available immediately, while `ctx.room.name` is only populated once the
    // connection completes. Reading the latter too early yielded an empty string
    // and made the agent return silently while LiveKit still reported the job as
    // assigned — a failure that looks exactly like "the agent never responds".
    const roomName = ctx.job.room?.name || ctx.room.name || "";
    const captureSessionId = captureSessionIdFromRoom(roomName);
    if (!captureSessionId) {
      log.error("room name carries no capture session", { roomName });
      return;
    }

    const driver = await ctx.waitForParticipant();
    const userId = driver.identity;

    /**
     * Whisper through LiteLLM, and Sonnet through LiteLLM.
     *
     * Both are OpenAI-compatible, so the same plugin serves them with a
     * `baseURL`. That keeps the existing model-role indirection: which model
     * answers is still an env change, not a code change.
     */
    const vad = ctx.proc.userData.vad as silero.VAD;

    /* Whisper is a BATCH transcriber, and that has to be made explicit.
     *
     * The plugin's `_recognize(buffer)` takes a complete utterance; it has no
     * streaming mode to subscribe to. Handed to the session directly, nothing
     * ever segments the audio, no transcript is ever produced, and the session
     * eventually concludes the driver is away — which is precisely what
     * happened: "User away timeout triggered" fifteen seconds after joining,
     * having recognised nothing, with no error anywhere.
     *
     * `StreamAdapter` is the piece that bridges the two: the VAD cuts the
     * incoming audio into utterances and each one is sent to Whisper as a batch.
     * Swap in a genuinely streaming provider later and the adapter comes off.
     */
    const stt = new stt_.StreamAdapter(
      new openai.STT({
        baseURL: baseUrl,
        apiKey,
        model: modelFor("transcribe_live"),
        language: "en",
        useRealtime: false,
      }),
      vad,
    );

    /* NO `temperature`, deliberately.
     *
     * `claude-sonnet-5` accepts only temperature=1, and LiteLLM answers a 400
     * for anything else — which the plugin swallows, so the turn came back as
     * zero completion tokens in 106ms with nothing in the log. From the outside:
     * the agent hears you and never replies.
     *
     * `chat.ts` in packages/llm avoids this with `drop_params: true` and even
     * documents the same class of failure. The plugin exposes no equivalent, so
     * the safe move is to send no sampling parameters at all and let the model
     * use its own default.
     *
     * ANY parameter added here must be checked against the configured model
     * first — this proxy rejects rather than ignores, and the rejection is
     * invisible from the session's point of view. */
    const llm = new openai.LLM({
      baseURL: baseUrl,
      apiKey,
      model: modelFor("converse"),
    });

    const tts = new elevenlabs.TTS({
      apiKey: process.env.ELEVENLABS_API_KEY,
      voiceId: process.env.ELEVENLABS_VOICE_ID,
      /* Turbo, not v3.
       *
       * Continuous speech requires the streaming-input websocket, and
       * `eleven_v3` answers 403 there — it is HTTP-only. Measured, not assumed:
       * v3 403s, turbo and flash both stream. v3 sounds best over plain HTTP
       * and cannot be used for a live conversation at all. */
      model: process.env.ELEVENLABS_MODEL_ID ?? "eleven_turbo_v2_5",
      // The whole reason for the migration: text is fed into one continuous
      // synthesis over a websocket, so there are no seams between sentences.
      streamingLatency: 3,
    });

    const session = new AgentSession({
      vad,
      stt,
      llm,
      tts,

      turnHandling: {
        endpointing: {
          // The single biggest latency lever. 500ms is snappy without cutting
          // off someone thinking mid-sentence; the old hand-rolled tap used 600.
          minDelay: 500,
          maxDelay: 6000,
        },
        interruption: {
          enabled: true,
          /**
           * Real WORDS before it counts as an interruption.
           *
           * This is what the hand-rolled version got wrong for days: it gated on
           * signal energy, so echo residue and road noise read as speech and the
           * agent cut itself off mid-reply. Requiring transcribed words means
           * only somebody actually talking can interrupt.
           */
          minWords: 2,
          minDuration: 300,
        },
      },
    });

    /* Observability. `AgentFalseInterruption` is the event that matters most
     * here: it fires when the session started to treat something as an
     * interruption and then decided it was not — which is exactly the failure
     * that made the previous implementation unusable. If these appear in a
     * drive's logs, the interruption thresholds above are still too loose. */
    session.on(voice.AgentSessionEventTypes.AgentFalseInterruption, () => {
      log.warn("false interruption — the agent nearly cut itself off", {
        captureSessionId,
        hint: "raise turnHandling.interruption.minWords or minDuration",
      });
    });

    /* The transcript, logged. Without this the pipeline is opaque exactly where
     * it broke: audio can arrive, the VAD can fire, and no words come out, with
     * nothing in the log to say so. */
    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (ev) => {
      if (ev.isFinal) log.info("heard", { captureSessionId, text: ev.transcript });
    });

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (ev) => {
      // The union includes handoff items, which carry no role or content.
      if (!("role" in ev.item) || ev.item.role !== "assistant") return;
      log.info("said", { captureSessionId, text: String(ev.item.content).slice(0, 120) });
    });

    session.on(voice.AgentSessionEventTypes.MetricsCollected, (ev) => {
      log.info("turn metrics", { captureSessionId, metrics: ev.metrics });
    });

    await session.start({
      agent: new VoiceMuralAgent(captureSessionId, userId),
      room: ctx.room,
    });

    log.info("agent joined", { room: ctx.room.name, captureSessionId, userId });
  },
});

/**
 * The conversational behaviour, which is the part that did NOT change.
 *
 * Retrieval, the register, the silence-by-default stance and the `agent_turn`
 * record all carry over from the previous implementation — they were never the
 * problem. Only the audio plumbing underneath them was.
 */
class VoiceMuralAgent extends Agent {
  private turnSeq = 0;

  constructor(
    private readonly captureSessionId: string,
    private readonly userId: string,
  ) {
    super({ instructions: SYSTEM_PROMPT });
  }

  /**
   * Retrieval, run on every turn rather than offered as a tool.
   *
   * Same reasoning as before: a tool call costs a second round trip before the
   * first word, and the conversation model has to actually choose to call it.
   * Injecting the transcript here means it is simply present.
   */
  override async onUserTurnCompleted(chatCtx: ChatContext, newMessage: ChatMessage): Promise<void> {
    const said = typeof newMessage.content === "string" ? newMessage.content : "";
    if (!said.trim()) return;

    const context = await buildContextMessage(this.userId, this.captureSessionId, said);
    if (context) chatCtx.addMessage({ role: "system", content: context });
  }
}

// Bridge model calls inside packages/llm into AI Observability, exactly as the
// worker and the old realtime service do. Without it every call is unobserved.
installGenerationSink();

/**
 * The worker's HTTP port.
 *
 * NOTHING checks this before binding, deliberately. An earlier version asserted
 * the port was free at module scope — but LiveKit forks a job process per
 * conversation that imports THIS SAME MODULE, so every forked job re-ran the
 * assertion, found the port held by its own parent, and exited before it could
 * connect. A guard against silent failure became the cause of one.
 *
 * A genuine conflict surfaces as EADDRINUSE from the parent on startup, which
 * is loud enough. If the agent registers but never joins a room, check for a
 * second worker before anything else: `lsof -nP -iTCP:8081 -sTCP:LISTEN`.
 */
const AGENT_PORT = Number(process.env.AGENT_PORT ?? 8081);

cli.runApp(
  new ServerOptions({
    agent: import.meta.filename,

    /* Availability, and the reason this is not left at its default.
     *
     * The worker reports its own load and marks itself UNAVAILABLE above a
     * threshold, at which point LiveKit logs "no servers available" and simply
     * never dispatches — the agent looks registered and healthy while silently
     * refusing every drive. On a development machine already running Postgres,
     * Next, the worker, Docker and turbo, the default CPU-based load function
     * reads as saturated almost immediately.
     *
     * This deployment serves ONE driver at a time, so load-shedding protects
     * nothing and only costs conversations. A fixed low load says "always
     * available"; revisit only if this ever serves several drives at once. */
    loadFunc: async () => 0,
    loadThreshold: 1,

    // One warm process, so the first turn of a drive does not pay Silero's
    // initialisation on top of everything else.
    numIdleProcesses: 1,

    // Only so a second worker can be run alongside the dev one for debugging.
    port: AGENT_PORT,
  }),
);
