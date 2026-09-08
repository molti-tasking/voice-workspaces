"""The voice service: talk-back on Pipecat.

This began as one half of a comparison against a LiveKit implementation. That
comparison ran, Pipecat won, and `apps/agent` is gone — so this is no longer a
contender being held constant against another, it is the thing itself. What
survives from that period is the discipline: everything the agent KNOWS still
lives on the TypeScript side and is fetched over HTTP, so there is exactly one
implementation of retrieval, one prompt, and one summary instruction.

WHAT IS HERE
  transport   SmallWebRTC, peer-to-peer with the browser. No media server, and
              WebRTC is what gets the browser's real echo canceller — a
              WebSocket transport would lose it.
  STT         Whisper via LiteLLM, VAD-segmented.
  LLM         Whatever MODEL_CONVERSE names, via LiteLLM.
  TTS         ElevenLabs over its streaming websocket, in the voice the
              session chose (see packages/talkback/src/voice.ts).
  speakers    `SpeakerTagger` labels transcripts [Speaker N] once a second
              voice is heard — Deepgram/AssemblyAI only; Whisper cannot.
  summary     A rolling summary of the drive, folded in the background off the
              live STT stream — see `RunningSummary` for why it lives here and
              not in the ledger.

WHAT IS FETCHED, NOT DUPLICATED
  /api/realtime/session   the system prompt, the summary instruction, the
                          voice, a seed summary for reconnects, and the
                          drive's start time. Once per connection.
  /api/realtime/context   passages from PAST drives matching what was just
                          said. Once per turn.

WHAT IS NOT HERE. Retrieval and echo filtering run in TypeScript against the
ledger. A second implementation in Python would be a second thing to keep
correct, and only one of them would get fixed.
"""

import asyncio
import json
import os
import re
import time
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
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMTextFrame,
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

# Read at import so a missing value fails at boot rather than on the first
# drive. Per-session voices come from `/api/realtime/session`; this is the
# fallback that every session without one — and every degraded one — uses.
FALLBACK_VOICE_ID = os.environ["ELEVENLABS_VOICE_ID"]

# Where retrieval lives. Inside a container `localhost` is this container, so
# the host gateway is what reaches the Next app running on the developer's
# machine.
WEB_URL = os.getenv("WEB_URL", "http://host.docker.internal:3000").rstrip("/")

# How the browser and this container find a path for the AUDIO.
#
# Only the SDP exchange goes through Traefik; the media is peer-to-peer. In
# development both ends are on one LAN, so the host candidates each side gathers
# are directly reachable and no ICE server is needed — which is exactly why this
# was missing and why the gap does not show up until deployment.
#
# In production this container sits behind Docker's bridge NAT on a host that is
# itself usually NATed, so its only candidates are 172.x addresses no browser can
# reach. The call then connects, sits in `connecting`, and times out after ~40s
# with a message that reads like a network blip. STUN is what lets it discover
# its public mapping and hole-punch.
#
# STUN alone is usually enough from a datacenter host. If ICE still fails —
# symmetric NAT, or UDP blocked — a TURN server is required, and this is the
# variable that points at it:
#
#   ICE_SERVERS=stun:stun.example.org:3478,turn:user:pass@turn.example.org:3478
#
# Comma-separated. Empty disables ICE servers entirely, which is the right
# setting for a purely local run and wrong for anything else. The default is a
# public STUN server: it learns this container's IP and nothing about the
# participant — no audio and no transcript passes through it — but point it at
# AU infrastructure if even that is worth avoiding.
ICE_SERVERS = [
    s.strip() for s in os.getenv("ICE_SERVERS", "stun:stun.l.google.com:19302").split(",") if s.strip()
]

# Folds the drive into a rolling summary. Falls back to MODEL_CONVERSE and
# deliberately NOT to MODEL_FAST: each fold builds on the last, so a model that
# restates a transcription artefact as fact turns the summary into a
# hallucination amplifier — a fabrication at turn three survives to turn forty
# and the ledger cannot correct it. See packages/llm/src/config.ts.
SUMMARISE_MODEL = os.getenv("MODEL_SUMMARISE") or os.environ["MODEL_CONVERSE"]


# Langfuse, over OpenTelemetry.
#
# The reason this exists: the composed prompt is assembled somewhere else
# entirely — `composeSystemPrompt` in packages/talkback sandwiches the base
# identity, the setting stanza and the output contract, and /api/realtime/context
# appends recalled passages per turn. By the time it reaches the model it has
# been through two services, and the only record of what was ACTUALLY sent was a
# character count in a log line. That is not enough to tell a bad reply caused by
# a bad prompt from one caused by a bad model.
#
# Pipecat 1.7 emits spans for each STT/LLM/TTS call with the serialised messages
# on the `input` attribute, which is exactly the thing that was missing, and
# Langfuse ingests OTLP directly — so this is an exporter and a header, not an
# integration.
#
# OFF unless LANGFUSE_PUBLIC_KEY is set. It is a study rig: a drive must not
# fail because an observability backend is down, and the import itself is
# deferred so a deployment that never sets the key does not even need the
# packages installed.
LANGFUSE_PUBLIC_KEY = os.getenv("LANGFUSE_PUBLIC_KEY", "")
LANGFUSE_SECRET_KEY = os.getenv("LANGFUSE_SECRET_KEY", "")
LANGFUSE_HOST = os.getenv("LANGFUSE_HOST", "https://cloud.langfuse.com").rstrip("/")

TRACING_ENABLED = False


def setup_langfuse_tracing() -> bool:
    """Point Pipecat's OpenTelemetry spans at Langfuse. Idempotent.

    Returns whether tracing is on, and never raises: a misconfigured or
    unreachable Langfuse must cost a log line, not the drive. The export itself
    is batched and off the event loop by the SDK, so a slow backend cannot add
    latency to a turn either.
    """
    global TRACING_ENABLED
    if TRACING_ENABLED:
        return True
    if not (LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY):
        return False

    try:
        import base64

        from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
        from pipecat.utils.tracing.setup import setup_tracing

        # Langfuse authenticates OTLP with HTTP Basic over the key pair, not a
        # bearer token — the same credentials as its SDKs, encoded per RFC 7617.
        auth = base64.b64encode(
            f"{LANGFUSE_PUBLIC_KEY}:{LANGFUSE_SECRET_KEY}".encode()
        ).decode()

        setup_tracing(
            service_name=os.getenv("LANGFUSE_SERVICE_NAME", "voicemural-talkback"),
            exporter=OTLPSpanExporter(
                endpoint=f"{LANGFUSE_HOST}/api/public/otel/v1/traces",
                headers={"Authorization": f"Basic {auth}"},
            ),
        )
        TRACING_ENABLED = True
        logger.info(f"[tracing] exporting to Langfuse at {LANGFUSE_HOST}")
    except Exception as exc:  # noqa: BLE001 — see the docstring
        logger.warning(f"[tracing] disabled, could not reach OpenTelemetry: {exc}")

    return TRACING_ENABLED


# The base prompt, used ONLY when /api/realtime/session cannot be reached.
#
# Deliberately not a copy of the real one. A silent partial copy that drifts is
# worse than an obviously degraded stand-in: this one announces itself, so a
# transcript recorded under it is still distinguishable months later when
# somebody is trying to work out why a drive reads oddly.
FALLBACK_SYSTEM_PROMPT = """You are a thinking companion riding along while someone drives and thinks aloud.

You are running in a DEGRADED mode: the service that supplies your instructions and your memory could not be reached, so you have no access to anything they have said before.

Answer any question put to you, even a loose one, in one sentence under 25 words — take the most likely reading rather than asking what they meant. When a thought clearly lands you may say the one thing worth saying, once. Mid-sentence pauses and half-finished thoughts are thinking: reply with exactly: <silence>

Never claim to remember anything. You cannot check the transcript right now, and saying otherwise would invent their own past back at them."""


# Whether the live STT should try to tell speakers apart.
#
# Only the hosted providers can: Deepgram labels every word with a speaker index
# and AssemblyAI labels each turn, both as a flag on the stream. Whisper through
# LiteLLM returns text and nothing else, so on the default provider this is a
# no-op that logs once at connect. Defaults on because a passenger is the
# common case rather than the edge case, and the cost is a flag, not a service.
STT_DIARIZE = os.getenv("STT_DIARIZE", "true").lower() in ("1", "true", "yes")

# What each model call is, for the proxy.
#
# LiteLLM strips a request's `metadata` before the upstream call, keeps it on
# its own request log, and hands it to whatever callbacks the proxy runs. So
# `session_id` attributes spend to a drive, `tags` and `version` to a prompt
# version, and `generation_name` separates the conversational turn from the
# summary fold — without this container knowing what, if anything, the proxy
# forwards to. The keys are the ones LiteLLM's Langfuse callback reads, should
# the proxy ever run one; the drive's own Langfuse traces come from the
# OpenTelemetry exporter below, not from here. See TALKBACK.md, "Evaluating the
# prompt".
def litellm_metadata(name: str, session: dict, capture_session_id: str | None) -> dict:
    tags = ["talkback", name]
    if session.get("configVersion"):
        tags.append(str(session["configVersion"]))
    if session.get("setting"):
        tags.append(f"setting:{session['setting']}")
    if session.get("degraded"):
        tags.append("degraded")
    meta: dict = {
        "generation_name": name,
        "trace_name": name,
        "tags": tags,
        "version": session.get("configVersion") or "fallback",
    }
    if capture_session_id:
        meta["session_id"] = capture_session_id
        meta["trace_metadata"] = {"capture_session_id": capture_session_id}
    return meta


def fetch_session(ticket: str | None) -> dict:
    """Everything that does not change during a drive, fetched once.

    The prompt used to be recovered by string-parsing `apps/agent/src/prompt.ts`,
    a file copied into this image at build time. That worked while the prompt was
    a constant; it is composed per driver now, so the container has to ask.

    Fails open to the degraded prompt above. A drive where the agent is dim is
    worth more than a drive where it will not connect — and either way the
    capture ledger is untouched.

    BUT IT SAYS SO, LOUDLY. Failing open silently is how a whole drive gets
    recorded against an agent with no memory, with the only trace a browser
    console warning nobody reads at 110 km/h. Both degraded paths log.
    """
    if not ticket:
        # No ticket at all: either a test harness dialling /offer directly, or a
        # browser whose /api/realtime/ticket call failed — an expired session
        # cookie, or BETTER_AUTH_SECRET unset, which answers 503.
        logger.warning("[session] no ticket supplied — running degraded, no memory of past drives")
        return {"systemPrompt": FALLBACK_SYSTEM_PROMPT, "degraded": True}
    try:
        req = urllib.request.Request(
            f"{WEB_URL}/api/realtime/session",
            method="POST",
            data=json.dumps({"ticket": ticket}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=10) as res:
            session = json.loads(res.read())
        logger.info(
            f"[session] prompt {len(session.get('systemPrompt') or '')} chars, "
            f"seed summary {len(session.get('driveSummary') or '')} chars, "
            f"config {session.get('configVersion')}"
        )
        return session
    except Exception as err:
        logger.warning(f"[session] unreachable, running degraded: {err}")
        return {"systemPrompt": FALLBACK_SYSTEM_PROMPT, "degraded": True}


def build_stt():
    """Transcription, from whichever provider STT_PROVIDER names.

    ASR IS THE WHOLE LATENCY PROBLEM, and this is the dial. Measured on a real
    drive: 1.7s to first text with the GPU free, 11.1s when the batch chunk
    pipeline was using the same `faster-whisper-large-v3` deployment. LLM and
    TTS together are under 2.5s and barely move.

    A STREAMING provider changes the shape rather than the number: transcription
    finishes as the driver stops talking instead of starting then, and it runs
    on somebody else's hardware, so the contention spikes disappear entirely.

    WHAT THIS DOES AND DOES NOT SEND. Only the live conversation goes to the
    provider. The durable ledger is still transcribed by Whisper on AU
    infrastructure by `apps/worker`, and `utterance` never contains a word this
    path produced — so the paper's primary artefact stays AU-derived. Raw
    participant audio does leave the deployment, which is an ethics-application
    matter and the reason this is a switch with an AU-hosted default rather than
    a hard-coded vendor.
    """
    provider = os.getenv("STT_PROVIDER", "litellm").lower()

    if provider == "deepgram":
        from pipecat.services.deepgram.stt import DeepgramSTTService

        return DeepgramSTTService(
            api_key=os.environ["DEEPGRAM_API_KEY"],
            settings=DeepgramSTTService.Settings(
                model=os.getenv("DEEPGRAM_MODEL", "nova-3"),
                language="en",
                # Per-word speaker indices on the raw result. Pipecat does not
                # read them; `SpeakerTagger` below does.
                diarize=STT_DIARIZE,
                # Interim results are what make it feel immediate; the final
                # transcript is still what reaches the LLM.
                interim_results=True,
                smart_format=True,
                # Deepgram's own endpointing. Left near Silero's `stop_secs` so
                # the two backends still feel alike — this is the dial to move
                # if it starts cutting people off mid-thought.
                utterance_end_ms=int(os.getenv("DEEPGRAM_UTTERANCE_END_MS", "1000")),
            ),
        )

    if provider == "assemblyai":
        from pipecat.services.assemblyai.stt import AssemblyAISTTService

        return AssemblyAISTTService(
            api_key=os.environ["ASSEMBLYAI_API_KEY"],
            # AssemblyAI puts the speaker label ("A", "B") in `user_id` itself;
            # `SpeakerTagger` reads it from there. No `speaker_format` — the tag
            # is written once, downstream, in the one shape the prompt knows.
            settings=AssemblyAISTTService.Settings(speaker_labels=STT_DIARIZE),
        )

    if STT_DIARIZE:
        logger.info("[stt] diarization unavailable with STT_PROVIDER=litellm — one speaker assumed")

    # The default, and the only one that keeps audio at AU. Batch, so it needs
    # the VADProcessor above to tell it where an utterance ends.
    return OpenAISTTService(
        settings=OpenAISTTService.Settings(
            model=os.getenv("MODEL_TRANSCRIBE_LIVE") or os.environ["MODEL_TRANSCRIBE"],
            language="en",
        ),
        api_key=LITELLM_API_KEY,
        base_url=LITELLM_BASE_URL,
    )


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


SPEAKER_TAG = re.compile(r"^\[Speaker (\d+)\]\s*")


def strip_speaker_tag(text: str) -> str:
    """The transcript without its `[Speaker N]` prefix, for readers that search."""
    return SPEAKER_TAG.sub("", text, count=1)


class SpeakerTagger(FrameProcessor):
    """Says who is talking, once there is more than one of them.

    WHAT THE PROVIDERS GIVE. Deepgram, with `diarize=True`, puts an integer
    `speaker` on every word of the raw result; Pipecat keeps that result on
    `TranscriptionFrame.result` and otherwise ignores it. AssemblyAI, with
    `speaker_labels=True`, writes its label ("A", "B") straight into
    `TranscriptionFrame.user_id`. Whisper gives nothing, so on the default
    provider this processor sees no speaker and changes nothing.

    WHAT THIS DOES WITH IT. Provider labels are renumbered 1, 2, 3 in order of
    first appearance, so "Speaker 1" is the voice heard first — on a drive,
    the driver — whichever index the provider happened to assign. Once a
    SECOND voice has been heard, every transcript from then on is prefixed
    `[Speaker N] `, and `user_id` is set to `speaker-N`.

    The prefix is written INTO THE TEXT deliberately, rather than carried as
    metadata: the text is the one thing that reaches every reader — the LLM via
    the aggregator, the running summary, the turn record, and the browser's
    live exchange — and the prompt's "WHEN SEVERAL PEOPLE ARE TALKING" section
    is written against exactly this shape. Readers that search the ledger
    (`Recall`) strip it with `strip_speaker_tag` first.

    NOT WRITTEN BEFORE A SECOND VOICE. A one-person drive must read exactly as
    it did before this existed; a tag on every line of a monologue would be
    noise in the prompt and on the screen, and would change the model's
    behaviour on the common case to serve the rare one.

    The ledger is untouched. `utterance` is transcribed by batch Whisper, which
    has no diarization, so speaker identity lives only in the live path — in
    `agent_turn.respondingToText` and in this container's summary. That is a
    known asymmetry, recorded in TALKBACK.md.
    """

    def __init__(self):
        super().__init__()
        # Provider label -> our 1-based number, in order of first appearance.
        self._labels: dict[str, int] = {}

    @property
    def speakers_heard(self) -> int:
        return len(self._labels)

    @staticmethod
    def _provider_label(frame: TranscriptionFrame) -> str | None:
        # Deepgram: majority speaker across the words of this result.
        result = frame.result
        try:
            words = result.channel.alternatives[0].words or []
        except (AttributeError, IndexError, TypeError):
            words = []
        counts: dict[int, int] = {}
        for word in words:
            speaker = getattr(word, "speaker", None)
            if speaker is not None:
                counts[speaker] = counts.get(speaker, 0) + 1
        if counts:
            return f"dg:{max(counts, key=lambda k: counts[k])}"

        # AssemblyAI: the label is the user id, when it is not the default one.
        user_id = getattr(frame, "user_id", "") or ""
        if user_id and not user_id.startswith("speaker-") and len(user_id) <= 3:
            return f"aai:{user_id}"
        return None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            label = self._provider_label(frame)
            if label is not None:
                if label not in self._labels:
                    self._labels[label] = len(self._labels) + 1
                    if len(self._labels) == 2:
                        logger.info("[speakers] a second voice — tagging transcripts from here on")
                    elif len(self._labels) > 2:
                        logger.info(f"[speakers] {len(self._labels)} voices heard")
                if len(self._labels) > 1:
                    number = self._labels[label]
                    frame.user_id = f"speaker-{number}"
                    frame.text = f"[Speaker {number}] {strip_speaker_tag(frame.text)}"

        await self.push_frame(frame, direction)


class RunningSummary(FrameProcessor):
    """A rolling summary of the drive, kept in memory and never persisted.

    WHY THIS EXISTS. "Earlier in this drive" used to be read from the `utterance`
    ledger. The ledger is written by the BATCH capture path — 10-second
    MediaRecorder chunks, a 5-second worker sweep, then Whisper — so it trailed
    live speech by 15 to 25 seconds. The driver would finish a thought, ask about
    it, and the context genuinely did not contain it yet; the prompt then told
    the model to say it could not find anything. That is most of what "it is not
    context aware" meant.

    WHY IT LIVES HERE AND NOT IN THE LEDGER. Three reasons, in order of weight:

    1. Freshness. It is fed by the live STT stream, which exists nowhere else.
    2. Ledger independence. TALKBACK.md's non-negotiable is that the capture path
       must never gain a dependency on the conversation. This is in memory, in
       this container, derived from a working copy of ASR that is never written
       to `utterance`. Kill the container mid-drive and the only thing lost is
       the summary.
    3. It cannot suffer the echo bug by construction. The container knows which
       text it produced and which came from the microphone, so the agent's own
       replies can never re-enter as "what the driver said" — no filter needed.

    THE FOLD NEVER BLOCKS A TURN. It runs as a background task; a fold still in
    flight is simply not yet visible to the next turn, which is the right
    trade — a slightly stale summary costs nothing, a turn that waits on one
    costs the conversation.

    CADENCE IS NOT PER-UTTERANCE. VoiceStudio folds on every utterance because it
    replays pre-segmented sessions. In a car people monologue and the VAD emits
    many fragments per thought, so folding each one would be constant model
    traffic over sentence fragments. Debounced on volume or elapsed time instead.
    """

    # Enough new speech to be worth a fold, or long enough that a slow talker
    # still gets one.
    FOLD_AFTER_CHARS = 600
    FOLD_AFTER_SECONDS = 45

    def __init__(self, summary_prompt: str, seed: str | None, metadata: dict | None = None):
        super().__init__()
        self._prompt = summary_prompt
        self._metadata = metadata or {}
        self._summary = seed
        self._pending: list[str] = []
        self._lock = asyncio.Lock()
        self._task: asyncio.Task | None = None
        self._last_fold = time.monotonic()

    @property
    def summary(self) -> str | None:
        return self._summary

    def note_agent(self, text: str) -> None:
        """Record what the agent actually said.

        Called directly by `SilenceGate` rather than observed as a frame,
        because the gate is the only place that knows the FINAL text — after the
        sentinel is stripped and a declined turn is dropped. A summary that
        included turns the driver never heard would describe a conversation that
        did not happen.
        """
        if text.strip():
            self._pending.append(f"(you said) {text.strip()}")

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            self._pending.append(frame.text.strip())
            self._maybe_fold()

        await self.push_frame(frame, direction)

    def _maybe_fold(self) -> None:
        pending_chars = sum(len(p) for p in self._pending)
        elapsed = time.monotonic() - self._last_fold
        if pending_chars < self.FOLD_AFTER_CHARS and elapsed < self.FOLD_AFTER_SECONDS:
            return
        # One fold in flight at a time. New speech accumulates in `_pending` and
        # is swept into the NEXT fold rather than queueing another — a queue
        # would let folds pile up behind a slow model call and arrive in the
        # wrong order, and the summary is order-dependent.
        if self._task is not None and not self._task.done():
            return
        self._task = asyncio.create_task(self._fold())

    async def _fold(self) -> None:
        async with self._lock:
            if not self._pending:
                return
            new_text = " ".join(self._pending)
            self._pending = []
            self._last_fold = time.monotonic()
            try:
                folded = await asyncio.to_thread(self._call, new_text)
                if folded:
                    self._summary = folded
                    logger.info(f"[summary] {len(folded)} chars")
            except Exception as err:
                # Put the speech back so the next fold still sees it: dropping it
                # would leave a permanent hole in the drive's memory.
                self._pending.insert(0, new_text)
                logger.warning(f"[summary] fold failed, will retry: {err}")

    def _call(self, new_text: str) -> str | None:
        prior = (
            f"Summary so far:\n{self._summary.strip()}"
            if self._summary and self._summary.strip()
            else "Summary so far: (nothing yet)"
        )
        req = urllib.request.Request(
            f"{LITELLM_BASE_URL}/chat/completions",
            method="POST",
            data=json.dumps(
                {
                    "model": SUMMARISE_MODEL,
                    "messages": [
                        {"role": "system", "content": self._prompt},
                        {"role": "user", "content": f"{prior}\n\nNewly spoken:\n{new_text}"},
                    ],
                    "max_tokens": 300,
                    "temperature": 0,
                    # For Langfuse, through LiteLLM. Ignored by a proxy without it.
                    "metadata": self._metadata,
                }
            ).encode(),
            headers={
                "Authorization": f"Bearer {LITELLM_API_KEY}",
                "Content-Type": "application/json",
            },
        )
        with urllib.request.urlopen(req, timeout=30) as res:
            body = json.loads(res.read())
        return (body["choices"][0]["message"]["content"] or "").strip() or None


class Recall(FrameProcessor):
    """Puts what the driver said before in front of the model, every turn.

    Retrieval is NOT duplicated in Python. This calls `/api/realtime/context`,
    which runs the same lexical search over the same ledger, with the same
    filtering of the agent's own echoed voice. Two implementations would mean two
    answers to "what does it remember", and only one of them would get fixed.

    ASSEMBLES THE BLOCK, rather than receiving one. The route returns PASSAGES
    now; the running summary of the current drive lives only in this process, so
    this is the only place that can put the two together. Order matters: past
    passages first, the current drive LAST, immediately before the user's
    message — that is what "that", "the second one" and "what I just said"
    resolve against, and burying it above four paragraphs of older transcript is
    what made anaphora fail.

    Fires on the transcription BEFORE the aggregator turns it into a user
    message, so the block is already in place when the LLM runs.
    """

    def __init__(
        self,
        context: LLMContext,
        summary: RunningSummary,
        ticket: str | None,
        recorder: "TurnRecorder | None" = None,
        drafts: "DraftRecorder | None" = None,
    ):
        super().__init__()
        self._recorder = recorder
        self._drafts = drafts
        self._context = context
        self._summary = summary
        self._ticket = ticket
        # ONE message, reused. See the note in process_frame — this reference is
        # the whole mechanism that stops the prompt growing without bound.
        self._message: dict | None = None

    def _fetch(self, said: str) -> tuple[list[dict], dict | None]:
        req = urllib.request.Request(
            f"{WEB_URL}/api/realtime/context",
            method="POST",
            data=json.dumps({"ticket": self._ticket, "said": said}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as res:
            body = json.loads(res.read())
            return body.get("passages") or [], body.get("pending")

    def _compose(self, passages: list[dict], pending: dict | None = None) -> str | None:
        sections: list[str] = []
        if passages:
            sections.append(
                "From their past recordings:\n"
                + "\n\n".join(
                    f"[{p.get('when', 'earlier')}] {p.get('text', '')}" for p in passages
                )
            )
        summary = self._summary.summary
        if summary and summary.strip():
            sections.append(f"So far in this drive:\n{summary.strip()}")

        if not sections and not pending:
            return None

        block = "\n\n".join(sections) if sections else ""
        if block:
            block += "\n\nThat is background. Answer only what was just said to you."

        # An outbound or irreversible action they asked for, parked until they
        # agree. The instruction is deliberately permissive about waiting: the
        # asymmetry the whole design rests on is that additive things fire
        # freely while irreversible things ask — and asking in the middle of
        # somebody's sentence is its own kind of damage.
        if pending and pending.get("restatement"):
            ask = (
                "They earlier asked for this, and it has not happened yet because it "
                f"cannot be undone: {pending['restatement']}\n"
                "If they are between thoughts, ask in one short sentence whether to go "
                "ahead. If they are mid-thought, say nothing and it will keep."
            )
            block = f"{block}\n\n{ask}" if block else ask

        return block

    def _reflow(self) -> None:
        """Bound the history, and park the context block beside the current turn.

        Two jobs, done together because both need the whole message list and
        both must happen between turns rather than during one.

        TRIMMING keeps the prompt from growing across an hour-long drive. The
        base system prompt is always kept; only the user/assistant thread is cut.

        REPOSITIONING moves the context block to the end, so the next user
        message lands immediately after it. Left where `add_message` first put
        it, it stays at index 1 forever while the conversation grows past it — so
        the transcript the model most needs ends up furthest from the question it
        is supposed to answer.

        `get_messages()` hands back the context's own list, so the replacement is
        materialised before `set_messages` assigns it (which does an in-place
        slice assignment, preserving the list identity the aggregator holds).
        """
        messages = list(self._context.get_messages())
        others = [m for m in messages if m is not self._message]
        base = [m for m in others if isinstance(m, dict) and m.get("role") == "system"]
        history = [m for m in others if not (isinstance(m, dict) and m.get("role") == "system")]

        trimmed = history[-(MAX_HISTORY_TURNS * 2) :]
        ordered = base + trimmed + ([self._message] if self._message is not None else [])

        if len(ordered) != len(messages) or any(a is not b for a, b in zip(ordered, messages)):
            dropped = len(history) - len(trimmed)
            if dropped:
                logger.info(f"[history] dropped {dropped} message(s), keeping {len(trimmed)}")
            self._context.set_messages(ordered)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            # Upstream of the aggregator, so this is the last point that sees
            # the driver's words before they are consumed. The turn recorder
            # cannot read them itself.
            if self._recorder is not None:
                self._recorder.note_user(frame.text)
            # The draft recorder needs the same words for `respondingToText`:
            # a draft read back weeks later is far more legible next to the
            # request that produced it.
            if self._drafts is not None:
                self._drafts.note_user(frame.text)

            passages: list[dict] = []
            pending: dict | None = None
            if self._ticket:
                try:
                    # The search query is what was said, not who said it.
                    passages, pending = await asyncio.to_thread(
                        self._fetch, strip_speaker_tag(frame.text)
                    )
                    if passages:
                        logger.info(f"[recall] {len(passages)} passage(s) from past drives")
                    if pending:
                        logger.info(f"[recall] pending confirmation {pending.get('invocationId')}")
                except Exception as err:
                    # Never fatal. An agent that has forgotten the past is worth
                    # far more than one that stops talking, and the capture
                    # ledger is untouched either way.
                    logger.warning(f"[recall] failed, continuing without it: {err}")

            # Composed even when retrieval failed: the running summary is local
            # and still worth putting in front of the model.
            content = self._compose(passages, pending)
            if content:
                # REPLACE, never append. Calling add_message every turn used to
                # stack a new block onto a context that is never pruned — by turn
                # 20 the model read twenty of them, every one but the last
                # already stale. That is a monotonically growing prompt, and it
                # is why a long drive got slower the longer it ran.
                #
                # LLMContext.add_message does `self._messages.append(message)`,
                # storing the dict BY REFERENCE, so mutating it here updates the
                # context in place without touching list membership — which
                # matters because LLMContextAggregatorPair holds that same list.
                if self._message is None:
                    self._message = {"role": "system", "content": content}
                    self._context.add_message(self._message)
                else:
                    self._message["content"] = content

            self._reflow()

        await self.push_frame(frame, direction)


MAX_HISTORY_TURNS = 8

SILENCE_TOKEN = "<silence>"

# The tags around text meant for the screen rather than the speaker.
#
# Mirrors DRAFT_OPEN/DRAFT_CLOSE in packages/talkback/src/prompt.ts, which is
# where the model is told about them. Change one and change the other.
DRAFT_OPEN = "<draft"
DRAFT_CLOSE = "</draft>"

# What a partial tag at the end of a stream chunk could still turn into. Both
# start with `<`, which is what lets a normal spoken reply stop being a
# candidate on its very first frame — see SilenceGate's latency note.
_TAG_PREFIXES = (SILENCE_TOKEN, DRAFT_OPEN, DRAFT_CLOSE)


def extract_drafts(reply: str) -> tuple[str, list[dict]]:
    """Split a completion into what is spoken and what is kept.

    Ported from `extractDrafts` in the TypeScript prompt module, with the same
    tolerance: a model that forgets the closing tag has still obviously written
    a draft, so an unterminated block runs to the end of the completion rather
    than being thrown away over seven missing characters.

    Returns (speech, drafts) where each draft is {"title", "text"}.
    """
    drafts: list[dict] = []
    speech = ""
    rest = reply

    while True:
        open_at = rest.find(DRAFT_OPEN)
        if open_at == -1:
            speech += rest
            break
        # `<draft` must actually open a tag. Without this a sentence that merely
        # contains the characters would swallow the rest of the reply.
        open_end = rest.find(">", open_at)
        if open_end == -1:
            # `<draft` with no `>` never opened a tag: ordinary text, kept.
            # Dropping from here would truncate a reply that merely used the
            # characters. Mirrors the TypeScript `extractDrafts`.
            speech += rest
            break

        speech += rest[:open_at]
        title_match = re.search(r'title\s*=\s*"([^"]*)"', rest[open_at:open_end])
        title = title_match.group(1).strip() if title_match else ""

        close_at = rest.find(DRAFT_CLOSE, open_end)
        body = rest[open_end + 1 :] if close_at == -1 else rest[open_end + 1 : close_at]
        if body.strip():
            drafts.append({"title": title, "text": body.strip()})
        if close_at == -1:
            break
        rest = rest[close_at + len(DRAFT_CLOSE) :]

    return clean_reply(speech), drafts


def is_silence(reply: str) -> bool:
    """Whether a reply is the model declining to speak.

    Ported from `isSilence` in the TypeScript prompt module, including its
    tolerance for how a model dresses the sentinel up — surrounding whitespace,
    a trailing full stop, a stray quotation mark. A missed sentinel is the
    system reading the word "silence" aloud in a car, which is the single most
    conspicuous way this can fail.
    """
    normalised = re.sub(r"[.\"'`*]", "", reply.strip().lower())
    return normalised in (SILENCE_TOKEN, SILENCE_TOKEN.strip("<>"))


def clean_reply(reply: str) -> str:
    """Strip anything the model added around a real reply.

    Small models occasionally emit the sentinel AND a sentence, or wrap a reply
    in quotes. Both are read aloud verbatim otherwise.
    """
    return re.sub(r"^\s*[\"'`]+|[\"'`]+\s*$", "", reply.replace(SILENCE_TOKEN, "")).strip()


class TurnRecorder:
    """Writes down what the agent said, for the filter that reads it back.

    🔴 NOT bookkeeping. `agent_turn` is what the echo filter consults: the
    agent's voice reaches the microphone through the speaker, is transcribed
    into `utterance` like any other sound, and with no record of what was spoken
    there is nothing to tell those lines from the driver's own. Retrieval then
    quotes the system's last reply back to it as the participant's words.

    Observed, not theorised — with nothing writing this table after the LiveKit
    agent was removed, a drive recalled "[yesterday] Yes, I can hear you." and
    presented it to the model as something the driver had said.

    It is also the paper's turn-taking record. A live conversation cannot be
    replayed, so these rows are the only evidence it happened.
    """

    def __init__(self, ticket: str | None, started_at_ms: int | None):
        self._ticket = ticket
        self._started_at_ms = started_at_ms
        self._seq = 0
        self._responding_to: str | None = None

    def note_user(self, text: str) -> None:
        """What the driver just said, told to us from upstream.

        `SilenceGate` cannot read this itself: it sits downstream of the
        aggregator, which consumes the TranscriptionFrame on its way past. So
        the processor that does see it passes it along.
        """
        if text.strip():
            self._responding_to = text

    def record(self, spoken: str, generated: str) -> None:
        """Fire and forget. A failure here must never cost the driver a reply."""
        if not self._ticket or not self._started_at_ms or not spoken.strip():
            return

        seq, self._seq = self._seq, self._seq + 1
        # Milliseconds into the drive, on the same clock as `utterance` — which
        # is what lets the two be read as one dialogue, and what the echo filter
        # compares intervals against.
        offset = max(0, int(time.time() * 1000) - self._started_at_ms)
        payload = {
            "ticket": self._ticket,
            "seq": seq,
            "startOffsetMs": offset,
            # Roughly 14 characters a second of speech. An estimate, and marked
            # as one: the container never learns when playback actually ended.
            "endOffsetMs": offset + int(len(spoken) / 14 * 1000),
            "text": spoken,
            "generatedText": generated,
        }
        if self._responding_to:
            payload["respondingToText"] = self._responding_to

        async def send() -> None:
            try:
                await asyncio.to_thread(self._post, payload)
            except Exception as err:
                logger.warning(f"[turn] not recorded, echo filter will be blind: {err}")

        asyncio.create_task(send())

    def _post(self, payload: dict) -> None:
        req = urllib.request.Request(
            f"{WEB_URL}/api/realtime/agent-turn",
            method="POST",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5):
            pass


def _partial_tail(text: str, token: str) -> str:
    """The longest suffix of `text` that is still a proper prefix of `token`.

    What makes streaming tag removal safe: `<dra` arriving at the end of one
    frame must be held rather than spoken, because the next frame may complete
    it into `<draft`. Returns "" when nothing at the end could grow into the
    token, which is the common case and costs one comparison.
    """
    for size in range(min(len(token) - 1, len(text)), 0, -1):
        if token.startswith(text[-size:]):
            return text[-size:]
    return ""


class DraftRecorder:
    """Posts drafts to the web app, which is what makes them outlive the drive.

    Separate from `TurnRecorder` and deliberately so: a draft was never spoken,
    so it must not reach `agent_turn`. That table is the echo filter's input —
    `withoutEcho` deletes transcript lines matching what the agent said aloud —
    and a draft that only ever existed on screen cannot have been echoed.
    Filing it as a turn would teach the filter to delete the participant's own
    words whenever they resembled a draft they had asked for.
    """

    def __init__(self, ticket: str | None, started_at_ms: int | None):
        self._ticket = ticket
        self._started_at_ms = started_at_ms
        self._seq = 0
        self._responding_to: str | None = None

    def note_user(self, text: str) -> None:
        if text.strip():
            self._responding_to = text

    def record(self, drafts: list[dict]) -> None:
        """Fire and forget. A failed POST must never cost the driver a reply."""
        if not self._ticket or not self._started_at_ms or not drafts:
            return

        offset = max(0, int(time.time() * 1000) - self._started_at_ms)
        payloads = []
        for draft in drafts:
            seq, self._seq = self._seq, self._seq + 1
            payload = {
                "ticket": self._ticket,
                "seq": seq,
                "startOffsetMs": offset,
                "title": draft.get("title", ""),
                "text": draft["text"],
            }
            if self._responding_to:
                payload["respondingToText"] = self._responding_to
            payloads.append(payload)

        async def send() -> None:
            for payload in payloads:
                try:
                    await asyncio.to_thread(self._post, payload)
                    logger.info(
                        f"[draft] stored {payload['title']!r} ({len(payload['text'])} chars)"
                    )
                except Exception as err:
                    # Loud: the person was told the text is on their screen, and
                    # this is the only place that knows it never arrived.
                    logger.warning(f"[draft] NOT stored, the person will not see it: {err}")

        asyncio.create_task(send())

    def _post(self, payload: dict) -> None:
        req = urllib.request.Request(
            f"{WEB_URL}/api/realtime/draft",
            method="POST",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5):
            pass


class SilenceGate(FrameProcessor):
    """Stops the sentinel reaching TTS.

    The prompt tells the model that the DEFAULT is to say nothing — talk-back is
    armed for a whole drive with no gesture to enter it, so the failure mode is
    not being unhelpful, it is talking over somebody who is thinking. The model
    signals that by replying with exactly `<silence>`.

    Nothing downstream understood that. `isSilence`/`cleanReply` were written
    for this and then never called from either backend, so every declined turn
    was handed to ElevenLabs and spoken aloud.

    A sentinel split across two text frames is invisible to a per-frame check,
    so this holds text back — but only for as long as what has arrived could
    still BECOME the sentinel. `<silence>` starts with `<`, which a spoken reply
    effectively never does, so a real reply stops being a candidate on its first
    frame and streams from then on. Holding the whole completion instead would
    cost the full generation time on every turn, which is ~200ms on a local
    model and ~2s on a hosted one — a price paid on all replies to catch the
    minority that are declines.
    """

    def __init__(
        self,
        summary: RunningSummary | None = None,
        recorder: TurnRecorder | None = None,
        drafts: DraftRecorder | None = None,
    ):
        super().__init__()
        self._summary = summary
        self._recorder = recorder
        self._drafts = drafts
        self._text = ""
        self._spoken = ""
        self._holding = True
        # Draft suppression, which runs on everything released downstream.
        # `_pending` holds a partial tag straddling two frames; `_in_draft` is
        # true between the tags, where nothing may reach TTS.
        self._pending = ""
        self._in_draft = False

    def _for_speech(self, chunk: str) -> str:
        """Strip draft blocks out of streaming text, tag-safe across frames.

        The body between the tags is the whole point of a draft — it is read,
        not heard — so it must never reach TTS. Done here rather than by holding
        the completion and splitting it at the end, because holding would cost
        the full generation time on every turn, which is the trade `SilenceGate`
        already refused once.
        """
        buf, self._pending, out = self._pending + chunk, "", ""

        while buf:
            if self._in_draft:
                close_at = buf.find(DRAFT_CLOSE)
                if close_at == -1:
                    # All body. Keep back anything that could still become the
                    # closing tag, and discard the rest.
                    self._pending = _partial_tail(buf, DRAFT_CLOSE)
                    break
                buf = buf[close_at + len(DRAFT_CLOSE) :]
                self._in_draft = False
                continue

            open_at = buf.find(DRAFT_OPEN)
            if open_at == -1:
                tail = _partial_tail(buf, DRAFT_OPEN)
                out += buf[: len(buf) - len(tail)] if tail else buf
                self._pending = tail
                break

            out += buf[:open_at]
            open_end = buf.find(">", open_at)
            if open_end == -1:
                # The tag is still arriving — attributes can be long. Hold it.
                self._pending = buf[open_at:]
                break
            self._in_draft = True
            buf = buf[open_end + 1 :]

        return out

    def _spoke(self, text: str) -> None:
        """Tell the running summary what the driver actually HEARD.

        Reported from here rather than observed as a frame upstream, because
        this is the only place that knows the final text: after the sentinel is
        stripped, and never for a turn the gate suppressed. A summary that
        included declined turns would describe a conversation that did not
        happen.
        """
        if self._summary is not None:
            self._summary.note_agent(text)
        # ACCUMULATE ONLY. This runs per released fragment as the reply streams,
        # so recording here writes a row per word — "Yes", ",", " I", " can" —
        # which is worse than no rows at all: the echo filter would then be
        # matching the ledger against single tokens. The turn is written once,
        # on LLMFullResponseEndFrame.
        self._spoken += text

    def _could_become_sentinel(self, text: str) -> bool:
        """Whether `text` is still a viable prefix of the sentinel."""
        candidate = re.sub(r"[.\"'`*]", "", text.strip().lower())
        if not candidate:
            return True
        return any(
            form.startswith(candidate) for form in (SILENCE_TOKEN, SILENCE_TOKEN.strip("<>"))
        )

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMFullResponseStartFrame):
            self._text = ""
            self._spoken = ""
            self._holding = True
            self._pending = ""
            self._in_draft = False
        elif isinstance(frame, LLMTextFrame):
            self._text += frame.text
            if self._holding:
                if self._could_become_sentinel(self._text):
                    # Still might be a decline — say nothing yet.
                    return
                # It cannot be. Release everything held so far as one frame and
                # stream normally from here. A reply that opens with a draft tag
                # lands here too — `<draft` is not a sentinel prefix — and
                # `_for_speech` is what keeps its body out of TTS.
                self._holding = False
                released = self._for_speech(clean_reply(self._text))
                if released:
                    self._spoke(released)
                    await self.push_frame(LLMTextFrame(text=released), direction)
                return
            # Already streaming. Strip any sentinel the model tacked on mid-reply
            # — small models emit one alongside a real sentence often enough that
            # `clean_reply` was written for it.
            tail = self._for_speech(frame.text.replace(SILENCE_TOKEN, ""))
            if tail:
                self._spoke(tail)
                await self.push_frame(LLMTextFrame(text=tail), direction)
            return
        elif isinstance(frame, LLMFullResponseEndFrame):
            if self._holding:
                if is_silence(self._text):
                    logger.info(f"[silence] declined turn suppressed: {self._text.strip()!r}")
                else:
                    # Held to the end without ever resolving — e.g. a reply that
                    # is genuinely just "sil". Emit it rather than swallow it.
                    remainder = self._for_speech(clean_reply(self._text))
                    if remainder:
                        self._spoke(remainder)
                        await self.push_frame(LLMTextFrame(text=remainder), direction)

            # Drafts come off the WHOLE completion rather than the stream: the
            # streaming pass only has to keep the body away from TTS, and
            # parsing the finished text is where a malformed or unterminated tag
            # can still be recovered. `_pending` is dropped on purpose — it is
            # by construction a fragment of a tag, never speech.
            if self._drafts is not None:
                _, drafts = extract_drafts(self._text)
                if drafts:
                    self._drafts.record(drafts)
            # ONE row per turn, written here because this is the only point that
            # knows the whole reply. A suppressed turn leaves `_spoken` empty and
            # records nothing — the echo filter must only ever learn about audio
            # that actually reached the speaker.
            if self._recorder is not None and self._spoken.strip():
                self._recorder.record(self._spoken, self._text)
            self._text = ""
            self._spoken = ""
            self._holding = True

        await self.push_frame(frame, direction)


def build_pipeline(
    connection: SmallWebRTCConnection,
    ticket: str | None = None,
    session: dict | None = None,
    capture_session_id: str | None = None,
) -> PipelineWorker:
    """Assemble one drive's pipeline.

    `session` is the bootstrap from `/api/realtime/session` — the prompt, the
    summary instruction, the voice and any seed summary. Fetched once by the
    caller rather than here so a renegotiation does not pay for it again.

    `capture_session_id` is carried only for observability — the tracing
    conversation id and the LiteLLM metadata session — where it is the same key
    the ledger uses, so a Langfuse trace joins to `capture_session`, `utterance`
    and `agent_turn` by an id that is already there rather than a correlation
    anyone has to reconstruct by timestamp. It arrives from the browser
    unauthenticated, which is fine for a grouping key and would not be for
    anything else — authorisation is the ticket's job.
    """
    session = session or {"systemPrompt": FALLBACK_SYSTEM_PROMPT, "degraded": True}
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

    stt = build_stt()

    # NO temperature, and this is not an oversight. claude-sonnet-5 accepts only
    # temperature=1; LiteLLM answers 400 for anything else, and the error is
    # swallowed by the framework — the agent hears you and silently never
    # replies, with nothing in the logs to say why.
    llm = OpenAILLMService(
        settings=OpenAILLMService.Settings(
            model=os.environ["MODEL_CONVERSE"],
            # Sonnet reasons BEFORE it emits any text, and in a spoken exchange
            # every one of those tokens is dead air. Worth ~1.4s a turn on the
            # measured turn, and this is a companion answering in a sentence, not
            # a model being asked to work something out.
            #
            # It MUST be nested under `extra_body`: Pipecat spreads `extra` as
            # keyword arguments into the OpenAI SDK's create(), and the SDK
            # rejects anything it does not recognise —
            # `got an unexpected keyword argument 'thinking'`, which arrives as
            # an ErrorFrame and simply produces no reply. `extra_body` is the
            # SDK's own escape hatch for non-standard body fields.
            #
            # `metadata` rides in the same envelope. LiteLLM strips it before the
            # upstream call and hands it to its callbacks, so Langfuse sees
            # every turn of a drive as one session tagged with the prompt
            # version — which is what makes an LLM-as-judge evaluator over live
            # turns possible without this container knowing Langfuse exists.
            extra={
                "extra_body": {
                    "thinking": {"type": "disabled"},
                    "metadata": litellm_metadata("talkback.turn", session, capture_session_id),
                }
            },
        ),
        api_key=LITELLM_API_KEY,
        base_url=LITELLM_BASE_URL,
    )

    # Turbo, NOT eleven_v3: v3 answers 403 on the streaming-input websocket and
    # is HTTP-only. Streaming is the whole point — one continuous synthesis fed
    # incrementally, rather than a request per sentence, which is what separates
    # speech from stitched fragments.
    # WHICH VOICE. Chosen on the recorder before the drive started, stored on
    # `capture_session.voice_id`, and handed over by `/api/realtime/session` —
    # already narrowed to the catalogue in `packages/talkback/src/voice.ts`, so
    # this container never decides and never validates. `ELEVENLABS_VOICE_ID`
    # is the fallback for a session that carries no choice, including every
    # degraded connection, and it stays REQUIRED so that fallback always exists.
    voice = session.get("voiceId") or FALLBACK_VOICE_ID
    logger.info(f"[tts] voice {voice}{'' if session.get('voiceId') else ' (fallback)'}")

    tts = ElevenLabsTTSService(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        settings=ElevenLabsTTSService.Settings(
            voice=voice,
            model=os.getenv("ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5"),
        ),
        # NO `optimize_streaming_latency` here, and it is not an oversight: in
        # 1.7.0 that field belongs to ElevenLabsHttpTTSService, not to the
        # websocket service used here, which errors on it rather than ignoring
        # it. The websocket equivalent is `auto_mode`, and its default is
        # already the fast setting for SENTENCE aggregation (tts.py:622) — it is
        # only worth disabling if text_aggregation_mode ever moves to TOKEN.
    )

    # The universal context, not the OpenAI-specific one: Pipecat 1.x moved to a
    # provider-agnostic LLMContext, and the aggregator pair is constructed
    # directly rather than handed out by the LLM service.
    # `stop_secs` is the endpointing delay, and the single biggest lever on how
    # quick the agent feels. Left at 0.5 deliberately: the prompt's whole stance
    # is that a pause is thinking, not a turn boundary.
    def silero() -> SileroVADAnalyzer:
        return SileroVADAnalyzer(params=VADParams(stop_secs=0.5))

    # Whisper here is BATCH: OpenAISTTService extends SegmentedSTTService, which
    # only transcribes when it sees VADUserStartedSpeaking/StoppedSpeaking. Those
    # frames come from this processor and nowhere else, so without it the STT
    # sits on a live audio stream and never sends a single request.
    vad = VADProcessor(vad_analyzer=silero())

    context = LLMContext(
        [{"role": "system", "content": session.get("systemPrompt") or FALLBACK_SYSTEM_PROMPT}]
    )

    # Seeded from the ledger on connect so a mid-drive reconnect — a tunnel, a
    # dropped socket — does not restart the conversation with no idea what the
    # last twenty minutes were about. After this the live STT stream owns it and
    # the ledger is not read for this purpose again.
    summary = RunningSummary(
        summary_prompt=session.get("summaryPrompt") or "",
        seed=session.get("driveSummary"),
        metadata=litellm_metadata("talkback.summary", session, capture_session_id),
    )
    # Offsets are measured against the drive's own start, the same clock
    # `utterance` uses — which is what lets the two tables be read as one
    # dialogue, and what the echo filter compares intervals against.
    recorder = TurnRecorder(ticket, session.get("startedAtEpochMs"))
    drafts = DraftRecorder(ticket, session.get("startedAtEpochMs"))
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
            # Before the trace, so the log shows the tag the model will see.
            SpeakerTagger(),
            Trace("stt"),
            # Before Recall: the summary must see this turn's speech, and Recall
            # reads the summary when it composes the block.
            summary,
            Recall(context, summary, ticket, recorder, drafts),
            aggregator.user(),
            llm,
            # Between the LLM and TTS deliberately: the aggregator downstream
            # still records what the model generated, so a declined turn is
            # visible in the context as a turn that happened, while never
            # reaching the speaker.
            SilenceGate(summary, recorder, drafts),
            tts,
            transport.output(),
            aggregator.assistant(),
        ]
    )

    # PipelineWorker, not the PipelineTask/PipelineRunner pair — those are
    # deprecated since 1.3.0 and removed in 2.0.0. Metrics stay on: they are the
    # only per-stage timing this path has, and silence is its hardest failure.
    #
    # `enable_tracing` is what makes the spans, and it is gated on the exporter
    # actually being configured: turning it on without one buys the per-turn span
    # overhead and drops the result on the floor.
    return PipelineWorker(
        pipeline,
        params=PipelineParams(enable_metrics=True, enable_usage_metrics=True),
        enable_tracing=TRACING_ENABLED,
        conversation_id=capture_session_id,
        additional_span_attributes={
            # Which arm of the study this drive ran under, on every span. The
            # setting decides the prompt's stanza and the reply length, so a
            # trace that does not carry it cannot be compared with another.
            "voicemural.setting": session.get("setting") or "unknown",
            # A degraded drive ran on FALLBACK_SYSTEM_PROMPT and knows nothing
            # about the person. Its replies are thin BY DESIGN, and without this
            # they look like a model regression months later.
            "voicemural.degraded": bool(session.get("degraded")),
            # THE THREE LANGFUSE-SPECIFIC KEYS, and they are what make a trace
            # findable rather than merely present.
            #
            # Pipecat's own spans name themselves `llm`/`stt`/`tts` and leave the
            # TRACE unnamed, so without this every drive lists as a blank row —
            # 97 observations of real content behind nothing you can search for.
            # `conversation_id` above groups spans into one trace; it does NOT
            # populate Langfuse's session, which reads this attribute instead.
            "langfuse.trace.name": f"drive · {session.get('setting') or 'unknown'}",
            # The ledger's own key, so a trace opens straight onto the drive it
            # came from — the same id in `capture_session`, `utterance` and
            # `agent_turn`. Empty string rather than None: OTel drops an
            # attribute with a null value and the field would silently vanish.
            "langfuse.session.id": capture_session_id or "",
            # Tags render as filter chips, which is how you find the degraded
            # drives without reading them.
            "langfuse.trace.tags": [
                session.get("setting") or "unknown",
                "degraded" if session.get("degraded") else "full",
            ],
        },
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

# At import rather than under `__main__`, so it is set up the same way whether
# the container runs bot.py directly or something wraps it in `uvicorn bot:app`.
# Spans are created per connection, so this only has to happen before the first
# one — but a tracer configured after the fact silently loses the drive that
# provoked it, which is the one anybody would be looking at.
setup_langfuse_tracing()


@app.get("/healthz")
async def healthz():
    return {"ok": True, "backend": "pipecat", "connections": len(connections)}


@app.post("/offer")
async def offer(request: dict, background_tasks: BackgroundTasks):
    """WebRTC signalling: the browser offers, this answers.

    Peer-to-peer, with no media server at all. Fine for one driver at a time,
    which is all this deployment ever has — and it means the audio never
    traverses a server anyone has to run.
    """
    pc_id = request.get("pc_id")

    if pc_id and pc_id in connections:
        connection = connections[pc_id]
        await connection.renegotiate(
            sdp=request["sdp"], type=request["type"], restart_pc=request.get("restart_pc", False)
        )
        return connection.get_answer()

    connection = SmallWebRTCConnection(ice_servers=ICE_SERVERS)
    await connection.initialize(sdp=request["sdp"], type=request["type"])

    @connection.event_handler("closed")
    async def on_closed(conn: SmallWebRTCConnection):
        connections.pop(conn.pc_id, None)
        logger.info("connection closed")

    # The client nests anything it sends under `requestData`; the top level is
    # reserved for the transport's own sdp/type/pc_id/restart_pc.
    request_data = request.get("requestData") or {}
    ticket = request_data.get("ticket")
    # Tracing only. It is NOT trusted for anything the participant owns —
    # ownership is re-resolved from the signed ticket on every /context call.
    capture_session_id = request_data.get("captureSessionId")

    # Once per connection, not per turn. Off the event loop because it makes a
    # blocking HTTP call that itself waits on a model call for the seed summary,
    # and stalling the loop here would stall every other drive on this container.
    session = await asyncio.to_thread(fetch_session, ticket)

    worker = build_pipeline(connection, ticket, session, capture_session_id)

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
