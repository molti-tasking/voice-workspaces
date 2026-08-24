"""Talk-back on Pipecat, for comparison against the LiveKit implementation.

WHY THIS EXISTS. Both frameworks solve the same problem — echo cancellation,
turn detection, interruption, continuous TTS — and the only honest way to choose
is to hear both on the same voice, the same models and the same prompt. Anything
that differs between them is a confound, so this deliberately mirrors
`apps/agent/src/index.ts` line for line where it can.

WHAT IS HELD CONSTANT
  transport   WebRTC both sides, so both get the browser's real echo canceller.
              A WebSocket transport here would lose that and make Pipecat look
              worse for a reason that has nothing to do with Pipecat.
  STT         Whisper via LiteLLM, VAD-segmented.
  LLM         Whatever MODEL_CONVERSE names, via LiteLLM.
  TTS         ElevenLabs over its streaming websocket.
  prompt      Byte-identical to the LiveKit agent's, loaded from the same file.

WHAT IS NOT HERE. Retrieval, the `agent_turn` record and echo filtering live in
the TypeScript side and are not duplicated: they are identical for both
frameworks, so they cannot discriminate between them, and a second
implementation would only be a second thing to keep in sync. This container is
for judging the CONVERSATION — latency, interruption, whether the voice sounds
like speech.
"""

import asyncio
import json
import os
import urllib.request
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

from aiortc.sdp import candidate_from_sdp
from fastapi import BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger

from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    Frame,
    InputAudioRawFrame,
    TranscriptionFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
)
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai.stt import OpenAISTTService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import SmallWebRTCConnection
from pipecat.transports.smallwebrtc.transport import SmallWebRTCTransport
from pipecat.workers.runner import WorkerRunner

LITELLM_BASE_URL = os.environ["LITELLM_BASE_URL"].rstrip("/")
LITELLM_API_KEY = os.environ["LITELLM_API_KEY"]

# Where retrieval lives. Inside a container `localhost` is this container, so
# the host gateway is what reaches the Next app running on the developer's
# machine.
WEB_URL = os.getenv("WEB_URL", "http://host.docker.internal:3000").rstrip("/")


def system_prompt() -> str:
    """The LiveKit agent's prompt, verbatim.

    Read from the TypeScript source rather than copied, so the two cannot drift
    apart. A prompt difference would silently become the thing being compared.
    """
    source = Path(__file__).resolve().parents[1] / "agent" / "src" / "prompt.ts"
    text = source.read_text()
    start = text.index("`", text.index("SYSTEM_PROMPT")) + 1
    return text[start : text.index("`", start)]


class Trace(FrameProcessor):
    """Logs the frames that decide whether a turn happens, and nothing else.

    Silence is the hardest failure to debug here: a connected transport with no
    reply looks identical whether audio never arrived, the VAD never fired, or
    Whisper returned nothing. These three frame types separate those cases, and
    per-frame audio is deliberately NOT logged — it would be thousands of lines
    a minute and would bury the events that matter.
    """

    def __init__(self, label: str):
        super().__init__()
        self._label = label
        self._audio_frames = 0

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, InputAudioRawFrame):
            self._audio_frames += 1
            # Only on the round hundreds: proof audio is flowing, at a rate a
            # human can read.
            if self._audio_frames % 100 == 1:
                logger.info(f"[{self._label}] audio frames: {self._audio_frames}")
        elif isinstance(frame, UserStartedSpeakingFrame):
            logger.info(f"[{self._label}] VAD: user started speaking")
        elif isinstance(frame, UserStoppedSpeakingFrame):
            logger.info(f"[{self._label}] VAD: user stopped speaking")
        elif isinstance(frame, TranscriptionFrame):
            logger.info(f"[{self._label}] heard: {frame.text!r}")

        await self.push_frame(frame, direction)


class Recall(FrameProcessor):
    """Puts what the driver said before in front of the model, every turn.

    Retrieval is NOT duplicated in Python. This calls `/api/realtime/context`,
    which runs the very same `buildContextMessage` the LiveKit agent calls in
    process — same ledger, same lexical search, same filtering of the agent's
    own echoed voice. Two implementations would mean the two backends could
    differ in what they remember, and that difference would read as a property
    of the framework rather than as a bug in the copy.

    Fires on the transcription BEFORE the aggregator turns it into a user
    message, so the system message is already in the context when the LLM runs.
    """

    def __init__(self, context: LLMContext, ticket: str | None):
        super().__init__()
        self._context = context
        self._ticket = ticket

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame) and self._ticket and frame.text.strip():
            try:
                recalled = await asyncio.to_thread(self._fetch, frame.text)
                if recalled:
                    logger.info(f"[recall] {len(recalled)} chars of transcript")
                    self._context.add_message({"role": "system", "content": recalled})
            except Exception as err:
                # Never fatal. An agent that has forgotten the past is worth far
                # more than one that stops talking, and the capture ledger is
                # untouched either way.
                logger.warning(f"[recall] failed, continuing without it: {err}")

        await self.push_frame(frame, direction)

    def _fetch(self, said: str) -> str | None:
        req = urllib.request.Request(
            f"{WEB_URL}/api/realtime/context",
            method="POST",
            data=json.dumps({"ticket": self._ticket, "said": said}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as res:
            return json.loads(res.read()).get("context")


def build_pipeline(
    connection: SmallWebRTCConnection, ticket: str | None = None
) -> PipelineWorker:
    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        # NO `vad_analyzer` here. Pipecat 1.7 removed that field from
        # TransportParams, and pydantic's default `extra` policy is *ignore* —
        # so passing it raises nothing, changes nothing, and the bot connects
        # perfectly and then never hears a word. VAD is a pipeline stage now.
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
        ),
    )

    # Whisper through LiteLLM. Batch, like the other side: Pipecat segments with
    # the VAD above and sends one utterance per request.
    stt = OpenAISTTService(
        settings=OpenAISTTService.Settings(
            model=os.getenv("MODEL_TRANSCRIBE_LIVE") or os.environ["MODEL_TRANSCRIBE"],
            language="en",
        ),
        api_key=LITELLM_API_KEY,
        base_url=LITELLM_BASE_URL,
    )

    # NO temperature, and this is not an oversight. claude-sonnet-5 accepts only
    # temperature=1; LiteLLM answers 400 for anything else, and the error is
    # swallowed by the framework — the agent hears you and silently never
    # replies. The LiveKit side carries the same warning for the same reason.
    llm = OpenAILLMService(
        settings=OpenAILLMService.Settings(
            model=os.environ["MODEL_CONVERSE"],
            # Sonnet reasons BEFORE it emits any text, and in a spoken exchange
            # every one of those tokens is dead air. Worth ~1.4s a turn on the
            # LiveKit side, and this is a companion answering in a sentence, not
            # a model being asked to work something out.
            #
            # It MUST be nested under `extra_body`: Pipecat spreads `extra` as
            # keyword arguments into the OpenAI SDK's create(), and the SDK
            # rejects anything it does not recognise —
            # `got an unexpected keyword argument 'thinking'`, which arrives as
            # an ErrorFrame and simply produces no reply. `extra_body` is the
            # SDK's own escape hatch for non-standard body fields.
            extra={"extra_body": {"thinking": {"type": "disabled"}}},
        ),
        api_key=LITELLM_API_KEY,
        base_url=LITELLM_BASE_URL,
    )

    # Turbo, NOT eleven_v3: v3 answers 403 on the streaming-input websocket and
    # is HTTP-only. Streaming is the whole point — one continuous synthesis fed
    # incrementally, rather than a request per sentence, which is what separates
    # speech from stitched fragments.
    tts = ElevenLabsTTSService(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        settings=ElevenLabsTTSService.Settings(
            voice=os.environ["ELEVENLABS_VOICE_ID"],
            model=os.getenv("ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5"),
        ),
    )

    # The universal context, not the OpenAI-specific one: Pipecat 1.x moved to a
    # provider-agnostic LLMContext, and the aggregator pair is constructed
    # directly rather than handed out by the LLM service.
    # `stop_secs` is the endpointing delay — the equivalent of
    # turnHandling.endpointing.minDelay on the LiveKit side, and the single
    # biggest lever on how quick the agent feels.
    def silero() -> SileroVADAnalyzer:
        return SileroVADAnalyzer(params=VADParams(stop_secs=0.5))

    # Whisper here is BATCH: OpenAISTTService extends SegmentedSTTService, which
    # only transcribes when it sees VADUserStartedSpeaking/StoppedSpeaking. Those
    # frames come from this processor and nowhere else, so without it the STT
    # sits on a live audio stream and never sends a single request.
    vad = VADProcessor(vad_analyzer=silero())

    context = LLMContext([{"role": "system", "content": system_prompt()}])
    # A SECOND analyzer, deliberately, not the same instance: this one drives
    # turn completion and interruption in the aggregator, and the two keep
    # independent state.
    aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(vad_analyzer=silero()),
    )

    pipeline = Pipeline(
        [
            transport.input(),
            vad,
            Trace("in"),
            stt,
            Trace("stt"),
            Recall(context, ticket),
            aggregator.user(),
            llm,
            tts,
            transport.output(),
            aggregator.assistant(),
        ]
    )

    # PipelineWorker, not the PipelineTask/PipelineRunner pair — those are
    # deprecated since 1.3.0 and removed in 2.0.0. Metrics are on because the
    # numbers are the point: this container exists to be compared.
    return PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
    )


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[os.getenv("BETTER_AUTH_URL", "http://localhost:3000")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# One connection per browser tab. Keyed so a renegotiation finds its own peer.
connections: dict[str, SmallWebRTCConnection] = {}


@app.get("/healthz")
async def healthz():
    return {"ok": True, "backend": "pipecat", "connections": len(connections)}


@app.post("/offer")
async def offer(request: dict, background_tasks: BackgroundTasks):
    """WebRTC signalling: the browser offers, this answers.

    Peer-to-peer, with no media server — which is why this container needs no
    equivalent of the LiveKit service. Fine for one driver at a time, which is
    all this deployment ever has.
    """
    pc_id = request.get("pc_id")

    if pc_id and pc_id in connections:
        connection = connections[pc_id]
        await connection.renegotiate(
            sdp=request["sdp"], type=request["type"], restart_pc=request.get("restart_pc", False)
        )
        return connection.get_answer()

    connection = SmallWebRTCConnection()
    await connection.initialize(sdp=request["sdp"], type=request["type"])

    @connection.event_handler("closed")
    async def on_closed(conn: SmallWebRTCConnection):
        connections.pop(conn.pc_id, None)
        logger.info("connection closed")

    # The client nests anything it sends under `requestData`; the top level is
    # reserved for the transport's own sdp/type/pc_id/restart_pc.
    worker = build_pipeline(connection, (request.get("requestData") or {}).get("ticket"))

    async def run():
        await WorkerRunner(handle_sigint=False).run(worker)

    background_tasks.add_task(run)

    answer = connection.get_answer()
    connections[answer["pc_id"]] = connection
    return JSONResponse(answer)


@app.patch("/offer")
async def ice_candidates(request: dict):
    """Trickle ICE: the browser posts candidates here as it discovers them.

    THIS ENDPOINT IS NOT OPTIONAL, and its absence fails in a way that looks
    like something else entirely. Without it the JS client's PATCHes get a 405,
    its candidates never arrive, the peer connection never leaves `connecting`,
    and 40 seconds later the server logs a bare "Timeout establishing the
    connection to the remote peer" — which reads like a network problem rather
    than a missing route.
    """
    connection = connections.get(request.get("pc_id"))
    if connection is None:
        return JSONResponse({"error": "unknown pc_id"}, status_code=404)

    for entry in request.get("candidates", []):
        sdp = entry.get("candidate") or ""
        # aiortc's parser wants the attribute value, not the "candidate:" prefix
        # the browser sends.
        candidate = candidate_from_sdp(sdp.removeprefix("candidate:"))
        candidate.sdpMid = entry.get("sdp_mid")
        candidate.sdpMLineIndex = entry.get("sdp_mline_index")
        await connection.add_ice_candidate(candidate)

    return JSONResponse({"ok": True})


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PIPECAT_PORT", "7860")))
