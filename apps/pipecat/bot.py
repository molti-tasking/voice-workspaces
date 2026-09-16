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
  title       Two to four words naming what is being talked about right now,
              pushed to the browser as an RTVI server message for the title on
              the recorder — see `TopicTitle`.

WHAT IS FETCHED, NOT DUPLICATED
  /api/realtime/session   the system prompt, the summary and title
                          instructions, the voice, a seed summary for
                          reconnects, and the drive's start time. Once per
                          connection.
  /api/realtime/context   passages from PAST drives matching what was just
                          said, and any parked action to ask about — settling
                          the last ask first. Once per turn.
  /api/realtime/search    a web search the agent asked for, as a tool call —
                          only where the session offered one. The driver hears
                          the call's announcement and `SearchingSound` meanwhile.

WHAT IS WRITTEN BACK
  /api/realtime/agent-turn  what reached the speaker. The echo filter's input.
  /api/realtime/decision    every moment the model was given to speak and what
                            it became — spoken, declined, or talked over.
  /api/realtime/board       a board edit the agent was asked to make, as a tool
                            call. What the call means is decided there.

WHAT IS NOT HERE. Retrieval and echo filtering run in TypeScript against the
ledger. A second implementation in Python would be a second thing to keep
correct, and only one of them would get fixed.
"""

import asyncio
import json
import os
import re
import time
import urllib.error
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

import numpy as np
from aiortc.sdp import candidate_from_sdp
from fastapi import BackgroundTasks, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from loguru import logger

from pipecat.audio.mixers.base_audio_mixer import BaseAudioMixer
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.audio.vad.vad_analyzer import VADParams
from pipecat.frames.frames import (
    CancelFrame,
    EndFrame,
    Frame,
    InputAudioRawFrame,
    InterruptionFrame,
    LLMFullResponseEndFrame,
    LLMFullResponseStartFrame,
    LLMRunFrame,
    FunctionCallsStartedFrame,
    LLMTextFrame,
    MetricsFrame,
    MixerControlFrame,
    MixerEnableFrame,
    StartFrame,
    TranscriptionFrame,
    TTSSpeakFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
    VADUserStartedSpeakingFrame,
)
from pipecat.adapters.schemas.function_schema import FunctionSchema
from pipecat.adapters.schemas.tools_schema import ToolsSchema
from pipecat.metrics.metrics import LLMUsageMetricsData, TTFBMetricsData
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.worker import PipelineParams, PipelineWorker
from pipecat.processors.aggregators.llm_context import LLMContext
from pipecat.processors.aggregators.llm_response_universal import (
    LLMContextAggregatorPair,
    LLMUserAggregatorParams,
)
from pipecat.processors.audio.vad_processor import VADProcessor
from pipecat.processors.frame_processor import FrameDirection, FrameProcessor
# The board's one wire to the browser. The RTVI observer that PipelineWorker
# installs turns this frame into a `server-message` on the data channel the
# transcripts already use, so it can be pushed from anywhere in the pipeline.
from pipecat.processors.frameworks.rtvi import RTVIServerMessageFrame
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.services.llm_service import FunctionCallParams
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

# Language for the live conversation. Unset = let the provider detect it
# (Deepgram "multi", AssemblyAI per-turn detection, Whisper auto-detect); set to
# force ONE BCP-47 code ("en", "de", "nl-NL") — worth doing on a monolingual
# drive, where detection on a short VAD-cut utterance can misfire.
#
# THE BUG THIS CLOSES. language="en" was hard-coded, and a specific Deepgram
# language does not MISHEAR other languages — it transcribes nothing for them.
# Verified with a German sentence sent to nova-3: language=en returned an
# EMPTY transcript, language=multi returned perfect German and
# languages: ["de"]. So on a Deepgram deployment a German speaker was heard as
# silence while everyone else was transcribed — "the agent understands
# everybody except me" was exactly this, not a microphone problem.
#
# This is now the FALLBACK, not the only knob: a driver can pick a language on
# the recorder (Auto / English / Deutsch), the choice is stored on
# capture_session.stt_language and reaches build_stt via /api/realtime/session,
# overriding this for that drive. Sessions that state no choice — including
# every drive recorded before the picker existed, and every degraded
# connection with no ticket — fall back to this, and to auto-detect when it is
# unset. The ledger honours the session choice too (apps/worker passes it to
# Whisper) and auto-detects when there is none.
STT_LANGUAGE = os.getenv("STT_LANGUAGE") or None

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
            f"config {session.get('configVersion')}, "
            f"language {session.get('sttLanguage') or 'auto'}, "
            f"proactivity {session.get('proactivity') or 'quiet (default)'}"
        )
        return session
    except Exception as err:
        logger.warning(f"[session] unreachable, running degraded: {err}")
        return {"systemPrompt": FALLBACK_SYSTEM_PROMPT, "degraded": True}


def user_turn_stop_timeout_secs() -> float:
    """How long after the driver's last sound a turn is ended regardless.

    Pipecat ends a turn when its turn model judges the utterance finished. When
    it does not — a trailing "and the", or a final transcript landing after the
    VAD stop, which Pipecat warns about at startup with our stop_secs=0.5 — a
    fallback ends the turn after `user_turn_stop_timeout` of silence. Its
    default is 5.0s, and on the 15 Sep 2026 pilot drive half the replies took
    5.3-6.6s from the driver's words to the first spoken word while the model's
    own first token took 0.3-0.5s: the fallback, every time. A reply that late
    answers what was said two lines ago.

    2.0 by default. Ending a turn early does not make the agent talk over a
    thinker: the completion still runs through the prompt's "mid-thought, reply
    <silence>" rule and SilenceGate, so the cost is a declined completion, not
    an interruption. Clamped to 1-5s; `USER_TURN_STOP_TIMEOUT_SECS` tunes it
    without a rebuild (but with --force-recreate).
    """
    try:
        value = float(os.getenv("USER_TURN_STOP_TIMEOUT_SECS") or 2.0)
    except ValueError:
        value = 2.0
    return min(5.0, max(1.0, value))


def deepgram_utterance_end_ms() -> int:
    """`DEEPGRAM_UTTERANCE_END_MS`, never below the value Deepgram accepts.

    Clamped rather than validated at boot: a drive already in progress is worth
    more than a strict reading of the config, and the log line says plainly what
    was ignored. See the call site for what an unclamped value costs.
    """
    minimum = 1000
    raw = os.getenv("DEEPGRAM_UTTERANCE_END_MS", str(minimum))
    try:
        value = int(raw)
    except ValueError:
        logger.warning(f"[stt] DEEPGRAM_UTTERANCE_END_MS={raw!r} is not a number, using {minimum}")
        return minimum
    if value < minimum:
        logger.warning(
            f"[stt] DEEPGRAM_UTTERANCE_END_MS={value} is below Deepgram's minimum of "
            f"{minimum}; using {minimum}. Below it the websocket is refused with a 400 "
            f"and nothing is ever transcribed."
        )
        return minimum
    return value


def build_stt(session_language: str | None = None):
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

    LANGUAGE: the session's choice (made on the recorder, stored on
    capture_session.stt_language, already narrowed to the catalogue by
    /api/realtime/session) over the STT_LANGUAGE fallback over auto-detect.
    Logged below so "somehow it only transcribes English" is answerable from
    the container log rather than from guesswork about which knob won.
    """
    provider = os.getenv("STT_PROVIDER", "litellm").lower()
    forced = session_language or STT_LANGUAGE
    logger.info(
        f"[stt] language {forced or 'auto-detect'}"
        f"{' (session choice)' if session_language else ' (STT_LANGUAGE fallback)' if forced else ''}"
    )

    if provider == "deepgram":
        from pipecat.services.deepgram.stt import DeepgramSTTService

        return DeepgramSTTService(
            api_key=os.environ["DEEPGRAM_API_KEY"],
            settings=DeepgramSTTService.Settings(
                model=os.getenv("DEEPGRAM_MODEL", "nova-3"),
                # "multi" is nova-2/3 multilingual code-switching: Deepgram
                # detects the language per word, which is what a mixed
                # German/English drive needs. A specific code would not bias
                # recognition — it would silence every other language (see
                # STT_LANGUAGE). Verified against nova-3 with German speech:
                # `en` returned an empty transcript, `multi` perfect German
                # with languages: ["de"], and the websocket accepts
                # language=multi alongside diarize=true.
                language=forced or "multi",
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
                #
                # CLAMPED, because below 1000 Deepgram REJECTS THE WEBSOCKET with
                # a bare 400 and the drive then looks exactly like a dead
                # microphone: the transport connects, VAD fires, audio flows, and
                # no transcript ever arrives, so the agent never answers. Measured
                # against the live API — 999 is refused, 1000 accepted. Tuning
                # this down for latency is the obvious thing to try and it
                # silently costs the whole conversation.
                utterance_end_ms=deepgram_utterance_end_ms(),
            ),
        )

    if provider == "assemblyai":
        from pipecat.services.assemblyai.stt import AssemblyAISTTService

        # Auto-detect the language per turn, or force the one the session or
        # STT_LANGUAGE names. AssemblyAI's API treats the two settings as
        # mutually exclusive, so exactly one is passed. Not verified against a
        # live AssemblyAI stream the way the Deepgram and Whisper paths were —
        # the fields exist in pipecat 1.7 and match the provider's docs.
        language_settings = (
            {"language_code": forced} if forced else {"language_detection": True}
        )
        return AssemblyAISTTService(
            api_key=os.environ["ASSEMBLYAI_API_KEY"],
            # AssemblyAI puts the speaker label ("A", "B") in `user_id` itself;
            # `SpeakerTagger` reads it from there. No `speaker_format` — the tag
            # is written once, downstream, in the one shape the prompt knows.
            settings=AssemblyAISTTService.Settings(speaker_labels=STT_DIARIZE, **language_settings),
        )

    if STT_DIARIZE:
        logger.info("[stt] diarization unavailable with STT_PROVIDER=litellm — one speaker assumed")

    # The default, and the only one that keeps audio at AU. Batch, so it needs
    # the VADProcessor above to tell it where an utterance ends.
    #
    # An EMPTY language, not an omitted one: pipecat's OpenAISTTService always
    # sends a language parameter (it asserts non-None and would default to
    # English), and on the AU deployment an empty value behaves exactly like
    # omitting it — Whisper auto-detected and transcribed German perfectly.
    # Do NOT reach for "auto" here: the proxy accepts it and returns empty
    # text, which would lose the speech entirely.
    return OpenAISTTService(
        settings=OpenAISTTService.Settings(
            model=os.getenv("MODEL_TRANSCRIBE_LIVE") or os.environ["MODEL_TRANSCRIBE"],
            language=forced or "",
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


def _litellm_chat(messages: list[dict], *, max_tokens: int, metadata: dict) -> str | None:
    """One blocking chat completion against the proxy, for the background folds.

    BLOCKING ON PURPOSE, and called through `asyncio.to_thread`: urllib is in the
    standard library and this container already depends on the proxy being
    reachable. An async HTTP client would be a second connection pool to reason
    about for two calls a minute that nobody is waiting on.

    Shared by `RunningSummary` and `TopicTitle` because they ask the same model
    the same way and differ only in prompt and token budget — the summary's own
    copy of this was the obvious thing for the title to drift away from.

    `SUMMARISE_MODEL` for both, and temperature 0: these are folds, not
    conversation. A title that comes back differently worded each call would
    blur the recorder's title for no reason.
    """
    req = urllib.request.Request(
        f"{LITELLM_BASE_URL}/chat/completions",
        method="POST",
        data=json.dumps(
            {
                "model": SUMMARISE_MODEL,
                "messages": messages,
                "max_tokens": max_tokens,
                "temperature": 0,
                # For Langfuse, through LiteLLM. Ignored by a proxy without it.
                "metadata": metadata,
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
        return _litellm_chat(
            [
                {"role": "system", "content": self._prompt},
                {"role": "user", "content": f"{prior}\n\nNewly spoken:\n{new_text}"},
            ],
            max_tokens=300,
            metadata=self._metadata,
        )


def clean_title(raw: str | None, previous: str | None) -> str | None:
    """Make a model's answer fit on a board, or decide it is not a change.

    Pure, and separated from `TopicTitle` because this is where every shape the
    model can return has to be survived: a quoted title, one wrapped in
    asterisks, one with a full stop, one that is a whole sentence, the literal
    word NONE, or the title it was already given back verbatim — which is the
    COMMON case and the one the prompt asks for.

    Returns None for "nothing to change", so the caller has exactly one test to
    make and the title never re-animates to what it is already showing.

    The caps are the board's, not the model's: four words and 32 characters is
    what fits across a phone in a cradle at a size that can be read without
    focusing. A longer answer is cut rather than rejected — a shortened subject
    still names the subject, and rejecting it would leave the last title up
    while the conversation has moved on.
    """
    if not raw:
        return None

    text = raw.strip()
    # Markdown the model was not asked for, and the quotes it puts round a title
    # because a title looks like a quotation.
    text = re.sub(r"[*_`#]+", " ", text)
    text = text.strip().strip("\"'“”‘’").strip()
    # Trailing punctuation: a board has none, and "Funding round." and
    # "Funding round" are the same title arriving twice.
    text = re.sub(r"[\s.,;:!?\-–—]+$", "", text)
    text = re.sub(r"\s+", " ", text).strip()

    if not text or text.upper() == "NONE":
        return None

    # Four words, then as many of them as fit — dropped whole. A board cut
    # mid-word reads as a rendering fault rather than as a long subject, and a
    # glance cannot tell the two apart.
    words = text.split(" ")[:4]
    while len(words) > 1 and len(" ".join(words)) > 32:
        words.pop()
    text = " ".join(words)[:32].strip()
    # The cut can leave a trailing mark behind.
    text = re.sub(r"[\s.,;:!?\-–—]+$", "", text)

    if not text:
        return None
    # Case-insensitively, because a model that re-capitalises the same subject
    # has not changed it.
    if previous is not None and text.casefold() == previous.casefold():
        return None
    return text


class TopicTitle(FrameProcessor):
    """The live topic title: what is being talked about RIGHT NOW, in 2-4 words.

    WHY THE CONTAINER. The browser has no transcript of its own worth naming —
    it would have to ask the ledger, which trails live speech by 15 to 25
    seconds through the batch capture path, and then poll for it on a phone that
    is already holding a MediaRecorder open and a WebRTC call up. This process
    has the live STT stream, which exists nowhere else, and a data channel to
    the browser that the audio already needs. So the freshest source pushes, and
    the phone makes no extra request. Same three reasons as `RunningSummary`,
    which this sits next to.

    WHY A RECENT WINDOW AND NOT THE SUMMARY. The running summary is the whole
    drive — decisions, open questions, the thread of the argument — and a title
    taken from it would name the drive, which barely changes over forty minutes.
    The board has to answer a different question: what is being said in the last
    minute or two. So this keeps its own short window (`WINDOW_CHARS`) and lets
    the summary keep its own job.

    IT NEVER BLOCKS A TURN. The call runs as a background task and pushes a
    frame when it lands. A title that is a few seconds stale costs a glance
    nothing; a turn that waits on one costs the conversation. One call in flight
    at a time and NO QUEUE, for the same reason `_maybe_fold` has none: queued
    calls would arrive out of order behind a slow model and the newest answer is
    the only one worth having.

    HOW IT REACHES THE SCREEN. `RTVIServerMessageFrame`, which the RTVI observer
    that `PipelineWorker` installs serialises onto the same data channel the
    transcripts use — so this works from anywhere in the pipeline and needs no
    processor of its own downstream.

    INERT WITHOUT A PROMPT. An older web app does not send `titlePrompt`, and a
    degraded connection has no session at all. Then this makes no calls and
    pushes nothing, and the browser simply never shows a board — which is the
    right failure for a decorative surface on a study rig.
    """

    # How much recent speech the model is shown. Enough for a subject to be
    # recognisable, short enough that last quarter-hour cannot outvote the last
    # minute — which is the whole difference between this and the summary.
    WINDOW_CHARS = 900
    # Enough new speech to be worth naming, and never more often than this.
    CALL_AFTER_CHARS = 160
    MIN_GAP_SECONDS = 12
    # A slow talker still gets a title: any new speech at all, after this long.
    CALL_AFTER_SECONDS = 30

    def __init__(self, title_prompt: str | None, metadata: dict | None = None):
        super().__init__()
        self._prompt = (title_prompt or "").strip()
        self._metadata = metadata or {}
        self._title: str | None = None
        self._window = ""
        self._new_chars = 0
        self._last_call = time.monotonic()
        self._task: asyncio.Task | None = None

    @property
    def title(self) -> str | None:
        return self._title

    def note_agent(self, text: str) -> None:
        """Record what the driver actually HEARD.

        Called by `SilenceGate` rather than observed as a frame, for the same
        reason the summary is: the gate is the only place that knows the final
        text, after the sentinel is stripped and a declined turn is dropped.

        It belongs in the window because half of what names a subject is the
        answer — "the Tuesday deadline" is often the agent's phrase for what the
        driver has been circling, and a board built only from the microphone
        would keep missing it.
        """
        if text.strip():
            self._append(f"(you said) {text.strip()}")

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            self._append(frame.text.strip())

        # Pushed on IMMEDIATELY, before anything is decided about it. Nothing
        # downstream waits on the board.
        await self.push_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            self._maybe_name()

    def _append(self, text: str) -> None:
        if not self._prompt or not text.strip():
            return
        self._window = f"{self._window} {text.strip()}".strip()[-self.WINDOW_CHARS :]
        self._new_chars += len(text.strip())

    def _maybe_name(self) -> None:
        elapsed = time.monotonic() - self._last_call
        enough = self._new_chars >= self.CALL_AFTER_CHARS and elapsed >= self.MIN_GAP_SECONDS
        overdue = self._new_chars > 0 and elapsed >= self.CALL_AFTER_SECONDS
        if not (enough or overdue):
            return
        if self._task is not None and not self._task.done():
            return
        # `create_task`, not `asyncio.create_task`, because this task PUSHES A
        # FRAME — the same reason `Offers` uses it. Pipecat's task manager is
        # what keeps that push inside the processor's own lifecycle, and what
        # cancels it cleanly when the pipeline goes down.
        # `_name_topic`, not `_name`: FrameProcessor already owns `_name`, and it
        # is a string — shadowing it fails at the call, not at the definition.
        self._task = self.create_task(self._name_topic(), name="title:call")

    async def _name_topic(self) -> None:
        window, self._new_chars = self._window, 0
        self._last_call = time.monotonic()
        if not window:
            return

        current = self._title or "(none yet)"
        try:
            raw = await asyncio.to_thread(
                _litellm_chat,
                [
                    {"role": "system", "content": self._prompt},
                    {
                        "role": "user",
                        "content": f"Current title: {current}\n\nRecent speech:\n{window}",
                    },
                ],
                max_tokens=16,
                metadata=self._metadata,
            )
        except Exception as err:
            # Logged and dropped. The next trigger retries against a window that
            # still holds this speech, so nothing is lost but one call — and a
            # board is not worth failing a drive over.
            logger.warning(f"[title] naming failed, will retry: {err}")
            return

        title = clean_title(raw, self._title)
        if title is None:
            return

        self._title = title
        logger.info(f"[title] {title}")
        await self.push_frame(RTVIServerMessageFrame(data={"type": "title", "title": title}))


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

    def _fetch(
        self, said: str, answering: str | None = None
    ) -> tuple[list[dict], list[dict], dict | None, str | None, str | None]:
        body: dict = {"ticket": self._ticket, "said": said}
        # The invocation the agent's last turn asked about. The route resolves
        # these words as the answer and settles it BEFORE reading what is still
        # pending, so the question just answered is never put back in front of
        # the model on the turn that answered it. Which words count as yes is
        # decided there, in TypeScript, once — not here.
        if answering:
            body["answering"] = answering
        req = urllib.request.Request(
            f"{WEB_URL}/api/realtime/context",
            method="POST",
            data=json.dumps(body).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as res:
            body = json.loads(res.read())
            return (
                body.get("passages") or [],
                body.get("threads") or [],
                body.get("pending"),
                # Pre-rendered by `buildBoardContext`, not assembled here: the
                # column order, the staleness wording and the prompt budget are
                # one decision, and splitting it across two languages is how the
                # two would drift.
                body.get("board"),
                body.get("settled"),
            )

    def _compose(
        self,
        passages: list[dict],
        pending: dict | None = None,
        threads: list[dict] | None = None,
        board: str | None = None,
    ) -> str | None:
        sections: list[str] = []
        # THE BOARD FIRST, ahead even of where things stand. It is the most
        # concrete thing in the turn — what they committed to, and which column
        # each of those sits in — and it is the only section that can answer
        # "what should I do next" with something they could go and do. Threads
        # are prose about it; passages are quotes underneath that.
        if board:
            sections.append(board)
        # Where things stand next: it is the stable state the dated quotes
        # below are episodes of, and the prompt tells the model to build on it
        # rather than ask for the project again. Mirrored in
        # packages/talkback/src/eval/messages.ts — change one, change both.
        if threads:
            sections.append(
                "Where things stand, from their earlier sessions:\n"
                + "\n\n".join(t.get("text", "") for t in threads if t.get("text"))
            )
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
        #
        # The second ask is worded to be let go of. The route stops sending the
        # action after two asks (MAX_CONFIRMATION_ASKS in repertoire.ts); this
        # is what stops the model spending the repeat at the first pause.
        if pending and pending.get("restatement"):
            ask = (
                "They earlier asked for this, and it has not happened yet because it "
                f"cannot be undone: {pending['restatement']}\n"
                + (
                    "You have already asked about it once. Ask one more time only if they "
                    "have plainly finished a thought; otherwise leave it and it will keep."
                    if (pending.get("askedCount") or 0) > 0
                    else "If they are between thoughts, ask in one short sentence whether to go "
                    "ahead. If they are mid-thought, say nothing and it will keep."
                )
            )
            block = f"{block}\n\n{ask}" if block else ask

        return block

    def ensure_block(self) -> None:
        """Materialise the context block now, if no turn has composed one yet.

        The opening offer needs somewhere to stand: on a reconnect the seed
        summary is the whole difference between "I'm here" and "want to pick
        up where you left off?". A no-op once any real turn has landed — the
        block exists, and the next compose replaces it anyway.
        """
        if self._message is None:
            content = self._compose([], None, [], None)
            if content:
                self._message = {"role": "system", "content": content}
                self._context.add_message(self._message)

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
            # Taken whether or not the fetch below happens or succeeds: these
            # are the ONE set of words that could answer the ask, and the next
            # set cannot.
            answering = (
                self._recorder.take_awaiting_answer() if self._recorder is not None else None
            )

            passages: list[dict] = []
            threads: list[dict] = []
            pending: dict | None = None
            # Initialised alongside the others, and not only inside the try: a
            # degraded drive has no ticket and never enters it, and a fetch that
            # raises leaves it unbound. Either way `_compose` below reads it.
            board: str | None = None
            if self._ticket:
                try:
                    # The search query is what was said, not who said it.
                    passages, threads, pending, board, settled = await asyncio.to_thread(
                        self._fetch, strip_speaker_tag(frame.text), answering
                    )
                    if passages:
                        logger.info(f"[recall] {len(passages)} passage(s) from past drives")
                    if threads:
                        logger.info(f"[recall] {len(threads)} thread(s) from the workspace")
                    if board:
                        logger.info(f"[board] {board.count(chr(10) + '- ')} live task(s) in view")
                    if answering:
                        logger.info(f"[confirm] answer to {answering}: {settled or 'unclear'}")
                    if pending:
                        logger.info(
                            f"[recall] pending confirmation {pending.get('invocationId')}"
                            f" (asked {pending.get('askedCount') or 0}x)"
                        )
                except Exception as err:
                    # Never fatal. An agent that has forgotten the past is worth
                    # far more than one that stops talking, and the capture
                    # ledger is untouched either way.
                    logger.warning(f"[recall] failed, continuing without it: {err}")

            # What the model is about to be asked to answer, for the decision
            # record: this turn is ABOUT the parked action when the ask is in
            # front of it, whether or not the model ends up asking.
            if self._recorder is not None and pending:
                self._recorder.note_pending(pending.get("invocationId"))

            # Composed even when retrieval failed: the running summary is local
            # and still worth putting in front of the model.
            content = self._compose(passages, pending, threads, board)
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

# --- The proactive engine ----------------------------------------------------
#
# The complaint this closes: the companion answered well but never brought
# anything — purely reactive, "too responsive". The engine (`Offers` below)
# creates moments an unprompted turn is allowed in; the model still decides
# whether to take them, via the sentinel as always. The prompt's own offer
# stance (talkback-6) is what makes it take them.

# The FALLBACK for whether offers run. A study arm is a property of the drive,
# not of this container — one container serves every participant — so the
# drive's own `studyCondition.proactiveOffers` from /api/realtime/session
# decides. This only applies when there is no such answer: a degraded
# connection, whose drive is already off the study's record.
PROACTIVE_OFFERS = os.getenv("PROACTIVE_OFFERS", "true").lower() in ("1", "true", "yes")


def offers_enabled(session: dict) -> bool:
    """Whether this drive's condition runs the proactive engine."""
    condition = session.get("studyCondition")
    if session.get("degraded") or not isinstance(condition, dict):
        return PROACTIVE_OFFERS
    return bool(condition.get("proactiveOffers", PROACTIVE_OFFERS))

# How many seconds of quiet may follow a completed, unanswered thought before
# the engine offers a turn, by proactivity level.
#
# Mirrors PROACTIVE_AFTER_SECS in packages/talkback/src/setting.ts — change
# one, change both.
PROACTIVE_AFTER_SECS = {"quiet": 25, "occasional": 12, "forthcoming": 7}

# The two instructions, injected as user-role messages in the driver's slot.
# A user message rather than an append to Recall's block because the resulting
# shape — history, context block, instruction — is the exact shape of every
# normal turn, which keeps it valid behind every provider on the proxy
# (a block-only append would end some payloads with no user message at all).
#
# Mirrors OPENING_NUDGE/SILENCE_NUDGE in packages/talkback/src/prompt.ts —
# change one, change both.
OPENING_NUDGE = (
    "(The drive is just starting and they have not spoken yet. Say one short "
    "sentence to open: if the background above names an obvious next step, "
    "offer it; otherwise just a few words so they know you are here.)"
)
SILENCE_NUDGE = (
    "(An unprompted moment: they have been quiet for {secs} seconds since their "
    "last words. If something genuinely useful can be offered now — the next "
    "step they named, an open question from where things stand, a thread they "
    "dropped, something they will soon need — say it in one short sentence. If "
    "nothing is genuinely useful, reply <silence>.)"
)


class Offers(FrameProcessor):
    """The proactive engine: unprompted turns, offered out of silence.

    WHEN it may fire — three guards, all of them the prompt's own rules made
    mechanical:

    1. Never mid-thought. The timer arms on a final TranscriptionFrame (a
       completed, answered-by-nothing utterance) and cancels the instant
       speech starts again. A pause that is thinking never becomes an
       invitation.
    2. Never twice without a reply in between. Once the agent has spoken —
       opening, answer or offer — nothing further is offered until the driver
       says something. `SilenceGate` reports what each agent turn became; a
       spoken turn sets the flag, the driver's next words clear it.
    3. Declined offers back off. When the model takes the engine's moment and
       answers `<silence>`, nothing was worth saying, so the same interval
       would ask the same question again. The delay doubles, capped, and
       resets on the driver's next words.

    WHAT fires: a user-role instruction (the mirrored templates above) added
    to the context, then an `LLMRunFrame` — the same frame the user aggregator
    pushes to run a normal turn — so the completion, the gate, the recorder
    and the barge-in plumbing are all the normal ones. The recorder is told
    first that the moment is an offer, so an offered turn that speaks is an
    `agent_turn` of kind `proactive_prompt`, and one that declines is an
    `agent_decision` saying so rather than a log line.

    WHETHER it runs at all is the drive's study condition (`offers_enabled`),
    read once per connection.

    WHY A TIMER PER OFFER rather than a loop: each silence is armed fresh
    from the frames that ended it, so the interval always reflects the current
    proactivity level and backoff, and a cancelled timer is simply never
    replaced — no idle wakeups on a drive that never stops talking.
    """

    # The opening turn's grace: long enough for the pipeline to settle and
    # for a driver already talking to cancel it, short enough that "I'm here"
    # is still the first thing that happens.
    OPENING_GRACE_SECS = 2.5
    # A declined offer never waits longer than this to try again.
    BACKOFF_CAP_SECS = 120

    def __init__(
        self,
        context: LLMContext,
        recall: "Recall",
        session: dict,
        recorder: "TurnRecorder | None" = None,
    ):
        super().__init__()
        self._context = context
        self._recall = recall
        self._recorder = recorder
        self._enabled = offers_enabled(session)
        # The setting's proactivity level, arrived via /api/realtime/session —
        # the same value that governs how forthcoming the prompt is allowed to
        # be. Missing (a degraded connection) falls back to the driving
        # default's patience.
        self._delay = PROACTIVE_AFTER_SECS.get(
            session.get("proactivity") or "quiet", PROACTIVE_AFTER_SECS["quiet"]
        )
        self._task: asyncio.Task | None = None
        # True from the moment the agent speaks until the driver's next words.
        self._awaiting_user = False
        # Multiplier on `_delay` after declined offers. 1 is the base.
        self._backoff = 1
        self._opened = False

    # -- state, driven by frames and by SilenceGate --------------------------

    def note_agent_turn(self, spoke: bool) -> None:
        """What an agent turn became, reported by `SilenceGate`.

        Called from the gate rather than observed as a frame because the gate
        is the only place that knows whether anything was actually released to
        the speaker — the same reason `RunningSummary.note_agent` is called
        from there. A declined turn never happened as far as the driver is
        concerned, so it must not count as the "reply" the never-twice rule
        waits for — but it IS a declined offer, so it backs off.
        """
        if not self._enabled:
            return
        if spoke:
            self._awaiting_user = True
            self._cancel()
        else:
            self._backoff = min(self._backoff * 2, max(1, self.BACKOFF_CAP_SECS // self._delay))
            self._arm(self._delay * self._backoff)

    def _cancel(self) -> None:
        if self._task is not None:
            self._task.cancel()
            self._task = None

    def _arm(self, delay: float, opening: bool = False) -> None:
        self._cancel()
        self._task = self.create_task(self._fire(delay, opening), name="offers:timer")

    # -- the offer itself -----------------------------------------------------

    async def _fire(self, delay: float, opening: bool) -> None:
        try:
            await asyncio.sleep(delay)
        except asyncio.CancelledError:
            # Speech started, the agent spoke, or the pipeline went down
            # while we waited. The moment is gone; nothing to clean up.
            raise

        if self._awaiting_user:
            return

        if opening:
            self._opened = True
            instruction = OPENING_NUDGE
            # A reconnect can know where the drive stood: materialise the
            # block from the seed summary so "pick up where you left off?" is
            # possible. A no-op on a drive that already has one.
            self._recall.ensure_block()
        else:
            instruction = SILENCE_NUDGE.replace("{secs}", str(int(delay)))

        # The engine has now had its turn. If the model speaks, the
        # never-twice rule holds until the driver replies; if it declines,
        # note_agent_turn backs off and re-arms.
        if self._recorder is not None:
            self._recorder.note_offer("opening" if opening else "silence_offer")
        self._context.add_message({"role": "user", "content": instruction})
        logger.info(
            f"[offers] {'opening the drive' if opening else f'{int(delay)}s of quiet'} — offering a turn"
        )
        await self.push_frame(LLMRunFrame())

    # -- frame plumbing -------------------------------------------------------

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if self._enabled:
            if isinstance(frame, StartFrame):
                if not self._opened:
                    self._arm(self.OPENING_GRACE_SECS, opening=True)
            elif isinstance(frame, (VADUserStartedSpeakingFrame, UserStartedSpeakingFrame)):
                # Speech beats everything: a cancelled moment is the design
                # working, not a missed opportunity.
                self._cancel()
            elif isinstance(frame, TranscriptionFrame) and frame.text.strip():
                self._backoff = 1
                self._awaiting_user = False
                self._arm(self._delay)
            elif isinstance(frame, (EndFrame, CancelFrame)):
                self._cancel()

        await self.push_frame(frame, direction)

    async def cleanup(self):
        self._cancel()
        await super().cleanup()


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


SPEAKER_TAG = re.compile(r"\[speaker \d+\](?:'s)?\s*", re.IGNORECASE)


def strip_speaker_tags(text: str) -> str:
    """Drop `[Speaker N]` from text bound for TTS.

    The tag is written into transcripts on purpose (see `SpeakerTagger`), and
    a model that has read it on every line copies it into its own reply —
    which ElevenLabs renders as "bracket speaker two". Observed on a
    two-person drive: "[Speaker 2]'s question — whether it'll talk back — is
    for them to test live, not for me to answer." The tag stays in
    `generatedText`; only speech loses it.

    Applied per released frame, so a tag split across frames is only caught
    at the START of a reply, where `SilenceGate` holds an opening `[` until
    the bracket closes. Mid-reply tags are rarer and arrive whole often
    enough; the eval's `speaker tag spoken` check is where the rest show up.
    """
    return SPEAKER_TAG.sub("", text)


@dataclass(frozen=True)
class Cue:
    """What the model is being asked to respond to, and since when.

    `trigger` is one of the `agent_decision_trigger` values. `subject_key` is
    what the moment is about when it is about one thing — the parked
    invocation for a confirmation. `at_ms` is wall clock, the moment the cue
    arose: the driver's final words, or the offer timer firing.
    """

    trigger: str
    subject_key: str | None = None
    at_ms: int | None = None


# Unprompted moments: the engine made them, nobody spoke. A turn taken in one
# is a `proactive_prompt`, whatever it says.
OFFER_TRIGGERS = ("opening", "silence_offer", "agenda", "macro_offer")


def _now_ms() -> int:
    return int(time.time() * 1000)


class TurnRecorder:
    """Writes down what the agent said, for the filter that reads it back —
    and what it chose not to say, for the study.

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

    TWO TABLES, KEPT APART. Every completion the gate sees end becomes an
    `agent_decision` — spoke, declined, or talked over. Only one that reached
    the speaker also becomes an `agent_turn`. A declined turn must never be
    written to `agent_turn`: the echo filter would then discard the driver's
    own words for resembling a sentence the car never played.

    THE CUE. The processors that see a moment arise — `Recall` for the
    driver's words, `Offers` for the timer — tell this object; the gate
    snapshots it when a completion starts, so a later cue cannot relabel a
    turn already in flight.
    """

    def __init__(
        self,
        ticket: str | None,
        started_at_ms: int | None,
        config_version: str | None = None,
    ):
        self._ticket = ticket
        self._started_at_ms = started_at_ms
        # Echoed from /api/realtime/session: the version of the prompt this
        # container is actually running, which a web deploy mid-drive does
        # not change.
        self._config_version = config_version
        self._seq = 0
        self._decision_seq = 0
        self._responding_to: str | None = None
        self._cue = Cue("user_turn")
        # The invocation the last spoken turn asked about, until the driver's
        # next words are sent as its answer — or a later turn moves on.
        self._awaiting_answer: str | None = None
        # Board tools called since the last recorded turn, for `toolCalls` on
        # the turn that reports them.
        self._tool_calls: list[dict] = []

    def note_user(self, text: str) -> None:
        """What the driver just said, told to us from upstream.

        `SilenceGate` cannot read this itself: it sits downstream of the
        aggregator, which consumes the TranscriptionFrame on its way past. So
        the processor that does see it passes it along.
        """
        if text.strip():
            self._responding_to = text
            self._cue = Cue("user_turn", None, _now_ms())

    def note_pending(self, invocation_id: str | None) -> None:
        """The driver's turn carries a parked action to ask about.

        Only a turn the driver started can: the ask arrives with /context,
        which only their words fetch. Keeps the moment's clock — the ask did
        not make the moment, their words did.
        """
        if invocation_id and self._cue.trigger == "user_turn":
            self._cue = Cue("confirmation", invocation_id, self._cue.at_ms)

    def note_offer(self, trigger: str) -> None:
        """The proactive engine is about to run a turn nobody asked for."""
        self._cue = Cue(trigger, None, _now_ms())

    def cue(self) -> Cue:
        return self._cue

    def note_tool_call(self, name: str, latency_ms: int, error: str | None = None) -> None:
        """A tool the agent called; attached to the turn that speaks about it."""
        call: dict = {"name": name, "latencyMs": max(0, latency_ms)}
        if error:
            call["error"] = error[:500]
        self._tool_calls.append(call)

    def take_awaiting_answer(self) -> str | None:
        """The invocation an answer now would settle, handed over once."""
        invocation_id, self._awaiting_answer = self._awaiting_answer, None
        return invocation_id

    def record(
        self,
        spoken: str,
        generated: str,
        *,
        started_ms: int | None = None,
        barged_in: bool = False,
        cue: Cue | None = None,
        metrics: dict | None = None,
    ) -> None:
        """A turn that reached the speaker. Fire and forget: a failure here
        must never cost the driver a reply.

        `started_ms` is the wall clock when the first word was released to
        TTS, which is when speech began. `barged_in` means the person spoke
        over the reply: `spoken` is then what had been released — an upper
        bound on what they heard — and the interruption is the measured end.
        Both reach `agent_turn`, where the transcript page's `interrupted`
        badge and the paper's turn-taking record read them. Before they were
        sent, a reply cut off after one word was filed as a complete turn
        that said "The".

        `metrics` is what the gate saw of the LLM's own timing for this
        completion: `ttftMs`, `promptTokens`, `completionTokens`,
        `requestedModel`, each only when measured.
        """
        if not self._ticket or not self._started_at_ms or not spoken.strip():
            return

        cue = cue or self._cue
        seq, self._seq = self._seq, self._seq + 1
        now = _now_ms()
        # Milliseconds into the drive, on the same clock as `utterance` — which
        # is what lets the two be read as one dialogue, and what the echo filter
        # compares intervals against.
        offset = max(0, (started_ms or now) - self._started_at_ms)
        kind = self._kind(cue, generated if barged_in else spoken)
        payload = {
            "ticket": self._ticket,
            "seq": seq,
            "startOffsetMs": offset,
            "text": spoken,
            "generatedText": generated,
            "kind": kind,
        }
        if barged_in:
            end = max(offset, now - self._started_at_ms)
            payload["endOffsetMs"] = end
            payload["bargedIn"] = True
            # How far into the turn the cut came — what the page shows as "heard".
            payload["truncatedAtMs"] = end - offset
        else:
            # Roughly 14 characters a second of speech. An estimate, and marked
            # as one: the container never learns when playback actually ended.
            payload["endOffsetMs"] = offset + int(len(spoken) / 14 * 1000)
        # Only a turn the driver's words prompted answers them. An offer
        # answers nothing, and filing it against their last line — often
        # minutes old — would make the transcript say it did.
        if self._responding_to and cue.trigger not in OFFER_TRIGGERS:
            payload["respondingToText"] = self._responding_to
        if self._config_version:
            payload["configVersion"] = self._config_version
        latency = self._latency(cue, started_ms or now)
        if latency is not None:
            # From the moment to the first word released: what "did it feel
            # fast" was about. Not the moment to audio — the TTS's own delay
            # happens downstream of anything this container can time per turn.
            payload["totalLatencyMs"] = latency
        for key in ("ttftMs", "promptTokens", "completionTokens", "requestedModel"):
            if metrics and metrics.get(key) is not None:
                payload[key] = metrics[key]
        if self._tool_calls:
            payload["toolCalls"], self._tool_calls = self._tool_calls[:8], []

        # Whatever this turn was, it is now the last thing the driver heard.
        # An ask makes their next words its answer; anything else means their
        # next words answer that instead.
        self._awaiting_answer = cue.subject_key if kind == "confirmation_request" else None

        decision = self._decision(cue, "interrupted" if barged_in else "spoke", latency)
        self._send(payload, decision)

    def record_announcement(self, spoken: str) -> None:
        """A sentence spoken for a tool while it runs — "Let me look that up."

        Written to `agent_turn`, because it reached the speaker and the echo
        filter must know that. NOT a decision, and it does not take the tool
        calls pending for the next turn: the model's decision is the completion
        that called the tool and the one that answers from it, and both are
        recorded by the gate as usual. Nor does it settle an ask — it is not an
        answer to anything.
        """
        if not self._ticket or not self._started_at_ms or not spoken.strip():
            return
        seq, self._seq = self._seq, self._seq + 1
        offset = max(0, _now_ms() - self._started_at_ms)
        payload = {
            "ticket": self._ticket,
            "seq": seq,
            "startOffsetMs": offset,
            "endOffsetMs": offset + int(len(spoken) / 14 * 1000),
            "text": spoken,
            "generatedText": spoken,
            "kind": "reply",
        }
        if self._responding_to:
            payload["respondingToText"] = self._responding_to
        if self._config_version:
            payload["configVersion"] = self._config_version
        self._send(payload, None)

    def decline(self, *, interrupted: bool = False, cue: Cue | None = None) -> None:
        """A completion that reached nobody: the model declined, or the driver
        spoke before its first word. Writes a decision and NO turn.
        """
        if not self._ticket or not self._started_at_ms:
            return
        cue = cue or self._cue
        latency = self._latency(cue, _now_ms()) if not interrupted else None
        self._send(None, self._decision(cue, "interrupted" if interrupted else "declined", latency))

    @staticmethod
    def _kind(cue: Cue, said: str) -> str:
        if cue.trigger in OFFER_TRIGGERS:
            return "proactive_prompt"
        # The ask was in front of the model, but it is told to let the question
        # keep while they are mid-thought — so only a turn that asks something
        # counts as the ask. Lexical and coarse, and lopsided the safe way: a
        # missed ask costs a re-ask; a false one would take the driver's next
        # words as an answer to a question never put.
        if cue.trigger == "confirmation" and "?" in said:
            return "confirmation_request"
        return "reply"

    @staticmethod
    def _latency(cue: Cue, until_ms: int) -> int | None:
        return max(0, until_ms - cue.at_ms) if cue.at_ms else None

    def _decision(self, cue: Cue, outcome: str, latency: int | None) -> dict:
        seq, self._decision_seq = self._decision_seq, self._decision_seq + 1
        started_at_ms = self._started_at_ms or 0
        decision = {
            "ticket": self._ticket,
            "seq": seq,
            "offsetMs": max(0, (cue.at_ms or _now_ms()) - started_at_ms),
            "trigger": cue.trigger,
            "outcome": outcome,
        }
        if self._config_version:
            decision["configVersion"] = self._config_version
        if latency is not None:
            decision["latencyMs"] = latency
        if cue.subject_key:
            decision["subjectKey"] = cue.subject_key
        return decision

    def _send(self, turn: dict | None, decision: dict | None) -> None:
        """Both writes, in ONE task, turn first.

        Sequential on purpose: the decision points at the turn's row, and the
        turn route hands back that id. Two independent tasks would race the
        foreign key; this way a lost turn only costs the decision its pointer.
        """

        async def send() -> None:
            turn_id = None
            if turn is not None:
                try:
                    response = await asyncio.to_thread(self._post, "agent-turn", turn)
                    turn_id = (response or {}).get("id")
                except Exception as err:
                    logger.warning(f"[turn] not recorded, echo filter will be blind: {err}")
            if decision is None:
                return
            if turn_id:
                decision["agentTurnId"] = turn_id
            try:
                await asyncio.to_thread(self._post, "decision", decision)
            except Exception as err:
                logger.warning(f"[decision] not recorded: {err}")

        asyncio.create_task(send())

    def _post(self, route: str, payload: dict) -> dict | None:
        req = urllib.request.Request(
            f"{WEB_URL}/api/realtime/{route}",
            method="POST",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=5) as res:
            raw = res.read()
            return json.loads(raw) if raw else None


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


class BoardTools:
    """The agent's hands on the task board: tool calls, carried to the web app.

    DUMB ON PURPOSE. The tools, their schemas and what each call means all live
    in TypeScript (packages/talkback/src/board-tools.ts, and the planner the
    board page also uses). This registers whatever `/api/realtime/session` sent
    and posts each call back to `/api/realtime/board` verbatim, so there is one
    definition of "move this card" and it is not in Python.

    The result goes back to the model as the tool's answer, and the agent
    speaks from it — so a failure is returned as words ("the board could not
    be reached; nothing was changed") rather than raised, or the model would
    have nothing to say and might claim the change anyway.

    Not cancelled by an interruption: the driver asked for the edit, and
    talking over the confirmation does not take the request back. The write is
    idempotent on `opId` should anything retry it.
    """

    def __init__(self, ticket: str | None, recorder: "TurnRecorder | None" = None):
        self._ticket = ticket
        self._recorder = recorder

    @staticmethod
    def schemas(tools: list[dict]) -> ToolsSchema | None:
        """Pipecat's form of the OpenAI function tools the session sent."""
        functions = []
        for tool in tools or []:
            fn = tool.get("function") or {}
            params = fn.get("parameters") or {}
            if not fn.get("name"):
                continue
            functions.append(
                FunctionSchema(
                    name=fn["name"],
                    description=fn.get("description") or "",
                    properties=params.get("properties") or {},
                    required=params.get("required") or [],
                )
            )
        return ToolsSchema(standard_tools=functions) if functions else None

    async def handle(self, params: FunctionCallParams) -> None:
        started = time.monotonic()
        name = params.function_name
        payload = {
            "ticket": self._ticket,
            "opId": str(uuid.uuid4()),
            "tool": name,
            "arguments": dict(params.arguments or {}),
        }
        error: str | None = None
        try:
            result = await asyncio.to_thread(self._post, payload)
            if not result.get("ok"):
                error = str(result.get("error") or "refused")
        except Exception as err:
            error = str(err)
            result = {"ok": False, "error": "The board could not be reached. Nothing was changed."}
        latency_ms = int((time.monotonic() - started) * 1000)
        logger.info(f"[board] {name} -> {'ok' if result.get('ok') else 'refused'} in {latency_ms}ms")
        if self._recorder is not None:
            self._recorder.note_tool_call(name, latency_ms, error)
        await params.result_callback(result)

    def _post(self, payload: dict) -> dict:
        if not self._ticket:
            return {"ok": False, "error": "No board is connected to this drive. Nothing was changed."}
        req = urllib.request.Request(
            f"{WEB_URL}/api/realtime/board",
            method="POST",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as err:
            return {"ok": False, "error": f"The board refused the request ({err.code}). Nothing was changed."}


class SearchingSound(BaseAudioMixer):
    """The cue a driver hears while a web search runs: two soft rising blips,
    every 1.2 seconds, until the result is back.

    WHY A SOUND AT ALL. A search is the one moment the agent is working and
    audibly doing nothing — the announcement ends, then several seconds of
    silence that in a car cannot be told apart from a dropped connection. The
    cue says "still on it" without words to listen to.

    WHY A MIXER, NOT AUDIO FRAMES. Pushed as frames, the cue would queue in
    line with the announcement's speech and interleave with it chunk by chunk.
    A mixer is summed into whatever the transport is sending at that instant —
    speech or silence — so it can start the moment the call arrives and play
    under the announcement, ducked, rather than after it. And Pipecat marks the
    bot as speaking only for TTS and speech frames, never for a mixer's plain
    output, so the cue cannot hold off the driver's turn or trip interruption.

    SYNTHESISED, NOT A FILE. No sound asset to ship or license, no `soundfile`
    dependency in the image, and it is generated at whatever rate the transport
    runs at, so there is no resampling to get wrong.

    Idle it returns the transport's audio untouched. Only drives that were
    offered a search get one at all (see `build_pipeline`).
    """

    PERIOD_SECS = 1.2
    BLIPS = ((0.0, 660.0), (0.14, 880.0))  # (start, Hz): a rising pair, not an alarm
    BLIP_SECS = 0.12
    # Of full scale. Well under speech, which ElevenLabs delivers near peak.
    LEVEL = 0.12
    # Under the announcement's own words, so the cue never competes with them.
    DUCKED = 0.3
    # Transport audio louder than this is speech. About -36 dBFS.
    SPEECH_PEAK = 500

    def __init__(self):
        super().__init__()
        self._loop: np.ndarray | None = None
        self._pos = 0
        self._active = False
        self._gain = 0.0

    @classmethod
    def synthesise(cls, sample_rate: int) -> np.ndarray:
        """One period of the cue, as float samples in int16 scale."""
        period = np.zeros(int(cls.PERIOD_SECS * sample_rate), dtype=np.float32)
        t = np.arange(int(cls.BLIP_SECS * sample_rate), dtype=np.float32) / sample_rate
        # An 8ms attack and a fast exponential decay: a soft tap, no click.
        envelope = np.minimum(1.0, t / 0.008) * np.exp(-t / 0.03)
        for start_secs, hz in cls.BLIPS:
            start = int(start_secs * sample_rate)
            period[start : start + len(t)] += np.sin(2 * np.pi * hz * t) * envelope
        return period * (cls.LEVEL * 32767)

    @property
    def active(self) -> bool:
        return self._active

    def begin(self) -> None:
        self._active = True

    def end(self) -> None:
        """Stop. The cue fades over one chunk rather than cutting mid-blip."""
        self._active = False

    async def start(self, sample_rate: int):
        self._loop = self.synthesise(sample_rate)

    async def stop(self):
        self._active = False

    async def process_frame(self, frame: MixerControlFrame):
        if isinstance(frame, MixerEnableFrame):
            self._active = frame.enable

    async def mix(self, audio: bytes) -> bytes:
        return self.mix_now(audio)

    def mix_now(self, audio: bytes) -> bytes:
        if self._loop is None or (not self._active and self._gain == 0.0):
            return audio
        out = np.frombuffer(audio, dtype=np.int16)
        if len(out) == 0:
            return audio

        speaking = int(np.abs(out.astype(np.int32)).max()) > self.SPEECH_PEAK
        target = (self.DUCKED if speaking else 1.0) if self._active else 0.0
        # Ramp across the chunk from where the last one ended, so neither
        # ducking nor stopping is a step the ear hears as a click.
        ramp = np.linspace(self._gain, target, len(out), dtype=np.float32)
        positions = (self._pos + np.arange(len(out))) % len(self._loop)
        mixed = out.astype(np.float32) + self._loop[positions] * ramp

        self._gain = target
        # Faded out: the next search starts on its first blip, not mid-period.
        self._pos = 0 if target == 0.0 else (self._pos + len(out)) % len(self._loop)
        return np.clip(mixed, -32768, 32767).astype(np.int16).tobytes()


class WebSearch:
    """The agent's web search: a tool call, carried to the web app, with the
    driver kept informed while it runs.

    DUMB ON PURPOSE, like `BoardTools`: the tool, its schema, the SearXNG
    request and what a result looks like to the model are all TypeScript
    (packages/talkback/src/web-search.ts). This posts the call's arguments to
    `/api/realtime/search` and hands back whatever comes.

    WHAT THE DRIVER HEARS, in order: the call's `announcement` spoken at once —
    the model wrote it, in the language of the conversation — with
    `SearchingSound` starting under it and running until the result is back,
    and then the answer, from the completion Pipecat runs on the result. The
    announcement is spoken HERE rather than left to the model because a model
    that calls a tool often says nothing first, and the driver would sit
    through the search in silence.

    CANCELLED BY AN INTERRUPTION, unlike a board edit. The model waits for this
    result before it answers; if the driver starts talking, what they say next
    is the thing to respond to, and a search they talked over should neither
    keep the cue playing nor come back later as an answer to a moment that has
    passed.
    """

    # Past the web app's own 5s budget, so the route's failure — which says
    # why — arrives before this gives up on it.
    TIMEOUT_SECS = 7
    MAX_ANNOUNCEMENT_CHARS = 160

    def __init__(
        self,
        ticket: str | None,
        sound: SearchingSound | None = None,
        recorder: "TurnRecorder | None" = None,
    ):
        self._ticket = ticket
        self._sound = sound
        self._recorder = recorder

    @classmethod
    def announcement(cls, arguments: dict) -> str:
        """What to say as the search starts. The model's sentence, or a plain one."""
        said = " ".join(str(arguments.get("announcement") or "").split())
        if said:
            return said[: cls.MAX_ANNOUNCEMENT_CHARS]
        query = " ".join(str(arguments.get("query") or "").split())
        return f"Searching the web for {query}." if query and len(query) <= 60 else "Let me look that up."

    async def handle(self, params: FunctionCallParams) -> None:
        started = time.monotonic()
        name = params.function_name
        arguments = dict(params.arguments or {})

        announcement = self.announcement(arguments)
        # Not appended to the context: the model did not generate it as a
        # reply, and the call it came with is already there.
        await params.llm.push_frame(TTSSpeakFrame(announcement, append_to_context=False))
        if self._recorder is not None:
            self._recorder.record_announcement(announcement)
        if self._sound is not None:
            self._sound.begin()

        error: str | None = None
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(self._post, {"ticket": self._ticket, "arguments": arguments}),
                timeout=self.TIMEOUT_SECS,
            )
            if not result.get("ok"):
                error = str(result.get("error") or "refused")
        except asyncio.CancelledError:
            if self._recorder is not None:
                self._recorder.note_tool_call(name, int((time.monotonic() - started) * 1000), "cancelled")
            logger.info("[search] cancelled by the driver talking")
            raise
        except TimeoutError:
            error = "timed out"
            result = {"ok": False, "error": "The search took too long and was abandoned."}
        except Exception as err:
            error = str(err)
            result = {"ok": False, "error": "The search could not be reached."}
        finally:
            if self._sound is not None:
                self._sound.end()

        latency_ms = int((time.monotonic() - started) * 1000)
        # Never the query: it is the participant's question.
        logger.info(f"[search] {'ok' if result.get('ok') else 'failed'} in {latency_ms}ms")
        if self._recorder is not None:
            self._recorder.note_tool_call(name, latency_ms, error)
        await params.result_callback(result)

    def _post(self, payload: dict) -> dict:
        if not self._ticket:
            return {"ok": False, "error": "Search is not available on this connection."}
        req = urllib.request.Request(
            f"{WEB_URL}/api/realtime/search",
            method="POST",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=self.TIMEOUT_SECS) as res:
                return json.loads(res.read() or b"{}")
        except urllib.error.HTTPError as err:
            return {"ok": False, "error": f"The search was refused ({err.code})."}


class DraftRecorder:
    """Posts drafts to the web app, which is what makes them outlive the drive.

    Separate from `TurnRecorder` and deliberately so: a draft was never spoken,
    so it must not reach `agent_turn`. That table is the echo filter's input —
    `withoutEcho` deletes transcript lines matching what the agent said aloud —
    and a draft that only ever existed on screen cannot have been echoed.
    Filing it as a turn would teach the filter to delete the participant's own
    words whenever they resembled a draft they had asked for.
    """

    def __init__(
        self, ticket: str | None, started_at_ms: int | None, first_seq: int = 0
    ):
        self._ticket = ticket
        self._started_at_ms = started_at_ms
        # SEEDED, not zero. `seq` is unique per drive and `recordDraft` resolves
        # a collision by doing nothing, which is right for a retried POST and
        # catastrophic for a reconnect: a second container counting from 0 again
        # would have every draft for the rest of the drive accepted with a 200
        # and silently dropped. `/api/realtime/session` returns `nextDraftSeq`
        # from the ledger so this process carries on where the last one stopped.
        self._seq = first_seq
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
        offers: "Offers | None" = None,
        llm_name: str | None = None,
        # Keyword-only in effect, and LAST, so every existing positional
        # construction of the gate — the tests included — keeps working.
        title: "TopicTitle | None" = None,
    ):
        super().__init__()
        self._summary = summary
        self._title = title
        self._recorder = recorder
        self._drafts = drafts
        self._offers = offers
        # Whose metrics are this completion's. Every upstream service's
        # MetricsFrame passes through here — the STT's included — so they are
        # told apart by the processor that measured them.
        self._llm_name = llm_name
        self._text = ""
        self._spoken = ""
        self._holding = True
        # Wall clock of the first word released to TTS: the turn's start,
        # measured, rather than inferred from when generation ended.
        self._first_spoke_ms: int | None = None
        # Draft suppression, which runs on everything released downstream.
        # `_pending` holds a partial tag straddling two frames; `_in_draft` is
        # true between the tags, where nothing may reach TTS.
        self._pending = ""
        self._in_draft = False
        # Between a completion's start and its end or interruption. An
        # InterruptionFrame outside one is the driver starting to talk while
        # the agent had nothing in flight, which is not a decision about anything.
        self._in_response = False
        # This completion asked for tools rather than (or before) speaking.
        # Its silence is not a decline: the answer is the completion Pipecat
        # runs once the tool's result is in.
        self._calling_tools = False
        # The recorder's cue as it stood when this completion started.
        self._cue: "Cue | None" = None
        self._turn_metrics: dict = {}

    def _reset(self) -> None:
        """Back to the state before a completion: holding, nothing spoken."""
        self._text = ""
        self._spoken = ""
        self._holding = True
        self._first_spoke_ms = None
        self._pending = ""
        self._in_draft = False
        self._in_response = False
        self._calling_tools = False
        self._cue = None
        self._turn_metrics = {}

    def _note_metrics(self, frame: MetricsFrame) -> None:
        """Keep this completion's LLM timing and token counts.

        Pipecat measures them and pushes them downstream as frames, which
        nothing read: the latency columns on `agent_turn` were always empty.
        The LLM's frames arrive between its response start and end, so the
        reset at start is what keeps one turn's numbers off the next.
        """
        for data in frame.data:
            if self._llm_name and data.processor != self._llm_name:
                continue
            if isinstance(data, TTFBMetricsData):
                self._turn_metrics["ttftMs"] = int(data.value * 1000)
            elif isinstance(data, LLMUsageMetricsData):
                self._turn_metrics["promptTokens"] = data.value.prompt_tokens
                self._turn_metrics["completionTokens"] = data.value.completion_tokens
            if data.model:
                self._turn_metrics["requestedModel"] = data.model

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
        if self._first_spoke_ms is None:
            self._first_spoke_ms = int(time.time() * 1000)
        if self._summary is not None:
            self._summary.note_agent(text)
        if self._title is not None:
            self._title.note_agent(text)
        # ACCUMULATE ONLY. This runs per released fragment as the reply streams,
        # so recording here writes a row per word — "Yes", ",", " I", " can" —
        # which is worse than no rows at all: the echo filter would then be
        # matching the ledger against single tokens. The turn is written once,
        # on LLMFullResponseEndFrame.
        self._spoken += text

    def _could_become_sentinel(self, text: str) -> bool:
        """Whether `text` is still a viable prefix of the sentinel.

        Also true for an unclosed `[`: a `[Speaker N]` tag the model copied
        from its transcript, arriving a token at a time. A spoken reply opens
        with neither `<` nor `[`, so holding costs real replies nothing, and
        `strip_speaker_tags` takes the tag out once the bracket closes.
        """
        candidate = re.sub(r"[.\"'`*]", "", text.strip().lower())
        if not candidate:
            return True
        if candidate.startswith("[") and "]" not in candidate:
            return True
        return any(
            form.startswith(candidate) for form in (SILENCE_TOKEN, SILENCE_TOKEN.strip("<>"))
        )

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMFullResponseStartFrame):
            self._reset()
            self._in_response = True
            if self._recorder is not None:
                self._cue = self._recorder.cue()
        elif isinstance(frame, MetricsFrame):
            self._note_metrics(frame)
        elif isinstance(frame, FunctionCallsStartedFrame):
            self._calling_tools = True
            logger.info(f"[turn] calling {', '.join(c.function_name for c in frame.function_calls)}")
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
                released = strip_speaker_tags(self._for_speech(clean_reply(self._text)))
                if released:
                    self._spoke(released)
                    await self.push_frame(LLMTextFrame(text=released), direction)
                return
            # Already streaming. Strip any sentinel the model tacked on mid-reply
            # — small models emit one alongside a real sentence often enough that
            # `clean_reply` was written for it.
            tail = strip_speaker_tags(self._for_speech(frame.text.replace(SILENCE_TOKEN, "")))
            if tail:
                self._spoke(tail)
                await self.push_frame(LLMTextFrame(text=tail), direction)
            return
        elif isinstance(frame, InterruptionFrame):
            # The person spoke over the reply. Pipecat cancels the generation
            # and the audio; this is the one moment the container knows for
            # certain that playback stopped, so the turn is written NOW — what
            # had been released is the most they can have heard — rather than
            # on an End frame that, after a cancellation, may never arrive.
            if self._spoken.strip():
                logger.info(f"[turn] interrupted after {self._spoken.strip()!r}")
                if self._recorder is not None:
                    self._recorder.record(
                        self._spoken,
                        self._text,
                        started_ms=self._first_spoke_ms,
                        barged_in=True,
                        cue=self._cue,
                        metrics=self._turn_metrics,
                    )
            elif self._in_response and self._recorder is not None:
                # Talked over before a word came out — or while a decline was
                # still being held. Nothing reached the speaker, so no turn;
                # but the moment was there and the driver took it back, which
                # is what efficient dismissal looks like from the inside.
                self._recorder.decline(interrupted=True, cue=self._cue)
            # Partial words or none: either way the driver heard the agent try,
            # which is what the never-twice rule keys on, not how much of it
            # landed. A turn interrupted before its first word never reached
            # the speaker at all, so it counts as not having happened.
            if self._offers is not None:
                self._offers.note_agent_turn(bool(self._spoken.strip()))
            self._reset()
        elif isinstance(frame, LLMFullResponseEndFrame):
            if self._holding:
                # Nothing was released. A real reply stops being held on its
                # first frame, so what is here is the sentinel, a prefix of it
                # (a decline cut off mid-token), an unclosed `[`, or nothing —
                # and none of those is speech. The branch that used to release
                # "a reply that is genuinely just 'sil'" is gone: the one time
                # it fired, on a two-person drive, the reply was an interrupted
                # `<silence>` and the car heard "sil".
                if is_silence(self._text):
                    logger.info(f"[silence] declined turn suppressed: {self._text.strip()!r}")
                elif self._text.strip():
                    logger.info(f"[silence] truncated decline suppressed: {self._text.strip()!r}")

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
            # that actually reached the speaker. An interrupted turn was already
            # written above and `_reset` emptied `_spoken`, so this cannot
            # write it twice.
            #
            # A decline writes its DECISION instead — the silence the agent
            # chose, which used to exist only as the log line above.
            if self._recorder is not None and self._spoken.strip():
                self._recorder.record(
                    self._spoken,
                    self._text,
                    started_ms=self._first_spoke_ms,
                    cue=self._cue,
                    metrics=self._turn_metrics,
                )
            elif self._recorder is not None and self._in_response and not self._calling_tools:
                self._recorder.decline(cue=self._cue)
            # The proactive engine needs the same fact the summary does: what
            # the turn BECAME. A spoken turn (including a declined-looking one
            # that released words) sets the awaiting-reply rule; a decline
            # re-arms with backoff. Reported from here for the same reason as
            # `note_agent` — this is the only place that knows.
            # A completion that only called a tool has not finished its turn —
            # the reply comes from the next one — so it neither blocks the
            # engine as a spoken turn nor backs it off as a declined one.
            if self._offers is not None and not (self._calling_tools and not self._spoken.strip()):
                self._offers.note_agent_turn(bool(self._spoken.strip()))
            self._reset()

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
    # Tools need a ticket to act with and a real session to have been offered
    # them; a degraded connection gets neither.
    tools_allowed = bool(ticket) and not session.get("degraded")
    # Which offered tool is the web search, named by the session rather than
    # known here. Only a drive that has one gets the cue mixed into its output:
    # a mixer changes how the transport paces audio, and a drive without search
    # should run exactly as it did before search existed.
    search_tool = session.get("webSearchTool") if tools_allowed else None
    searching_sound = SearchingSound() if search_tool else None
    transport = SmallWebRTCTransport(
        webrtc_connection=connection,
        # NO `vad_analyzer` here. Pipecat 1.7 removed that field from
        # TransportParams, and pydantic's default `extra` policy is *ignore* —
        # so passing it raises nothing, changes nothing, and the bot connects
        # perfectly and then never hears a word. VAD is a pipeline stage now.
        params=TransportParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            audio_out_mixer=searching_sound,
        ),
    )

    stt = build_stt(session.get("sttLanguage"))

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

    # The tools, only where the session offered them — board tools for a person
    # whose board is on, the web search where an instance is configured — on a
    # connection with a ticket to act with. The prompt the session composed
    # says the same, so the model is never told it has hands it does not have.
    tools = BoardTools.schemas(session.get("tools") or []) if tools_allowed else None
    messages = [{"role": "system", "content": session.get("systemPrompt") or FALLBACK_SYSTEM_PROMPT}]
    context = LLMContext(messages, tools=tools) if tools else LLMContext(messages)

    # Seeded from the ledger on connect so a mid-drive reconnect — a tunnel, a
    # dropped socket — does not restart the conversation with no idea what the
    # last twenty minutes were about. After this the live STT stream owns it and
    # the ledger is not read for this purpose again.
    summary = RunningSummary(
        summary_prompt=session.get("summaryPrompt") or "",
        seed=session.get("driveSummary"),
        metadata=litellm_metadata("talkback.summary", session, capture_session_id),
    )
    # The live topic title on the recorder. Its own short window of recent
    # speech rather than the summary above, because the title answers "what
    # now" and the summary answers "what so far" — see the class. Inert when the
    # web app sends no `titlePrompt`.
    title = TopicTitle(
        session.get("titlePrompt"),
        metadata=litellm_metadata("talkback.title", session, capture_session_id),
    )
    # Offsets are measured against the drive's own start, the same clock
    # `utterance` uses — which is what lets the two tables be read as one
    # dialogue, and what the echo filter compares intervals against.
    recorder = TurnRecorder(
        ticket, session.get("startedAtEpochMs"), session.get("configVersion")
    )
    if tools:
        board_tools = BoardTools(ticket, recorder)
        web_search = WebSearch(ticket, searching_sound, recorder)
        for schema in tools.standard_tools:
            if schema.name == search_tool:
                # Cancellable, and so synchronous: the model waits for the
                # result to answer from. See `WebSearch`.
                llm.register_function(schema.name, web_search.handle, cancel_on_interruption=True)
            else:
                llm.register_function(schema.name, board_tools.handle, cancel_on_interruption=False)
        logger.info(f"[tools] {', '.join(s.name for s in tools.standard_tools)}")
    drafts = DraftRecorder(
        ticket,
        session.get("startedAtEpochMs"),
        # Absent from an older web deploy, and from a degraded session call —
        # both mean "no drafts known", which is what 0 says.
        first_seq=int(session.get("nextDraftSeq") or 0),
    )
    # A SECOND analyzer, deliberately, not the same instance: this one drives
    # turn completion and interruption in the aggregator, and the two keep
    # independent state.
    aggregator = LLMContextAggregatorPair(
        context,
        user_params=LLMUserAggregatorParams(
            vad_analyzer=silero(),
            user_turn_stop_timeout=user_turn_stop_timeout_secs(),
        ),
    )

    # The proactive engine. After Recall so it can ask it to materialise the
    # context block, and before the user aggregator so the `LLMRunFrame` it
    # pushes to run an unprompted turn flows into the aggregator's own run
    # path — the same one a normal turn takes.
    recall = Recall(context, summary, ticket, recorder, drafts)
    offers = Offers(context, recall, session, recorder)
    logger.info(f"[study] condition {session.get('studyCondition') or 'none (degraded)'}")

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
            # After the summary and before Recall: both read the same
            # transcription frame, and neither waits on the other.
            title,
            recall,
            offers,
            aggregator.user(),
            llm,
            # Between the LLM and TTS deliberately: the aggregator downstream
            # still records what the model generated, so a declined turn is
            # visible in the context as a turn that happened, while never
            # reaching the speaker.
            SilenceGate(summary, recorder, drafts, offers, llm_name=llm.name, title=title),
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

# A hard ceiling on simultaneous pipelines. Each connection holds a live STT +
# LLM + TTS chain and PCM buffers in memory, and a connection that never fires
# `closed` (a vanished client) leaks all of it. This deployment serves one
# driver at a time; sixteen is already generous, and beyond it the answer is
# 503 rather than an OOM that takes the current drive down with it.
MAX_CONNECTIONS = 16

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
    # Malformed offers answer 400, not a 500 with a KeyError stack: this
    # endpoint is publicly routed, and an unauthenticated caller poking at it
    # should not be able to fill the logs with tracebacks.
    sdp = (request or {}).get("sdp")
    kind = (request or {}).get("type")
    if not sdp or not kind:
        return JSONResponse({"error": "missing sdp or type"}, status_code=400)

    pc_id = request.get("pc_id")

    if pc_id and pc_id in connections:
        connection = connections[pc_id]
        await connection.renegotiate(sdp=sdp, type=kind, restart_pc=request.get("restart_pc", False))
        return connection.get_answer()

    if len(connections) >= MAX_CONNECTIONS:
        logger.warning("refusing offer: %d connections already open", len(connections))
        return JSONResponse({"error": "server busy"}, status_code=503)

    connection = SmallWebRTCConnection(ice_servers=ICE_SERVERS)
    await connection.initialize(sdp=sdp, type=kind)

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
        if not sdp:
            # An empty candidate (some browsers send one when a port check
            # fails) would raise inside aiortc's parser and 500 the whole
            # PATCH — taking the browser's remaining candidates with it.
            continue
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
