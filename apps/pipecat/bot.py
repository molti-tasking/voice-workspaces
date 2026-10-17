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
import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import time
import urllib.error
import urllib.request
import uuid
from collections.abc import Callable
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
    BotStartedSpeakingFrame,
    BotStoppedSpeakingFrame,
    CancelFrame,
    EndFrame,
    ErrorFrame,
    Frame,
    InputAudioRawFrame,
    InterruptionFrame,
    LLMContextFrame,
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
    TTSUpdateSettingsFrame,
    UserStartedSpeakingFrame,
    UserStoppedSpeakingFrame,
    VADUserStartedSpeakingFrame,
    VADUserStoppedSpeakingFrame,
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
from pipecat.turns.user_start import MinWordsUserTurnStartStrategy
from pipecat.turns.user_turn_strategies import UserTurnStrategies
# The board's one wire to the browser. The RTVI observer that PipelineWorker
# installs turns this frame into a `server-message` on the data channel the
# transcripts already use, so it can be pushed from anywhere in the pipeline.
from pipecat.processors.frameworks.rtvi import RTVIServerMessageFrame
# And the wire back. A `client-message` from the browser arrives as this frame,
# pushed by the RTVI processor at the head of the pipeline; the answer goes out
# as a response tied to it, which is what lets the browser `await` the request.
from pipecat.processors.frameworks.rtvi import RTVIClientMessageFrame, RTVIServerResponseFrame
from pipecat.services.elevenlabs.tts import ElevenLabsTTSService
from pipecat.transcriptions.language import Language
from pipecat.services.llm_service import FunctionCallParams
from pipecat.services.openai.llm import OpenAILLMService
from pipecat.services.openai.stt import OpenAISTTService
from pipecat.transports.base_transport import TransportParams
from pipecat.transports.smallwebrtc.connection import IceServer, SmallWebRTCConnection
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
# Comma-separated. Empty disables ICE servers entirely, which is the right
# setting for a purely local run and wrong for anything else. The default is a
# public STUN server: it learns this container's IP and nothing about the
# participant — no audio and no transcript passes through it — but point it at
# AU infrastructure if even that is worth avoiding.
#
# STUN IS NOT ENOUGH FROM A PHONE, which is what TURN_URLS below is for. This
# variable is STUN only now; a `turn:` URL here carries no credential and coturn
# answers 401 to the allocation, so it would gather no relay candidate while
# looking configured.
STUN_SERVERS = [
    s.strip() for s in os.getenv("ICE_SERVERS", "stun:stun.l.google.com:19302").split(",") if s.strip()
]

# THE RELAY. Read the note above first; this is the half that makes talk-back
# work from a car rather than from a desk.
#
# STUN gets a path whenever one side can be hole-punched. A mobile carrier is
# the case where neither can: carrier-grade NAT is typically symmetric, so the
# mapping the phone learns from STUN is not the mapping this container sends to.
# No candidate pair forms, ICE sits in `checking`, and 60 seconds later the log
# says "Timeout establishing the connection to the remote peer" — which reads
# like a network blip and is not one. Meanwhile the pipeline runs perfectly:
# the model composes an opening line, ElevenLabs synthesises it, and it is
# spoken into a transport with nowhere to send it. The only symptom is silence.
# A drive on 18 Sep 2026 from a Telekom mobile connection is what this is.
#
# A relay is the only fix. There is no STUN configuration that reaches a
# symmetric NAT, because the problem is not discovery.
#
# The URLs are credentialed at USE time, not here:
#
#   TURN_URLS=turn:voice.example.com:3478,turn:voice.example.com:3478?transport=tcp
#   TURN_SECRET=<the same static-auth-secret coturn holds>
#
# NOTE the credential does NOT go in the URL. aiortc reads the username and
# password off the RTCIceServer object and its URI parser rejects a host
# containing `:` outright, so the `turn:user:pass@host:port` form that this
# comment used to recommend raises ValueError inside /offer and 500s the
# handshake. It was never exercised because TURN was never deployed.
TURN_URLS = [s.strip() for s in os.getenv("TURN_URLS", "").split(",") if s.strip()]
TURN_SECRET = os.getenv("TURN_SECRET", "")
# coturn checks expiry when an allocation is made AND when it is refreshed, so a
# credential that dies mid-drive drops the audio rather than merely refusing a
# new call. Twelve hours outlives any drive.
TURN_TTL_SECONDS = int(os.getenv("TURN_TTL_SECONDS") or 12 * 60 * 60)


def turn_credentials(now: float | None = None) -> tuple[str, str]:
    """coturn's REST-API credential: an expiry-stamped name, HMAC'd.

    Must stay byte-identical to `mintTurnCredentials` in
    packages/shared/src/turn-credentials.ts — the browser and this container
    authenticate to the same coturn with the same secret, and a mismatch fails
    silently on whichever side got it wrong: coturn answers 401, that peer
    gathers no relay candidate, and the call degrades back to the exact silent
    timeout the relay was added to fix.

    The label is random rather than anything about the participant: it is
    written to coturn's log for every allocation and travels in the SDP, and
    coturn itself only ever reads the expiry back out.
    """
    expiry = int((now if now is not None else time.time())) + TURN_TTL_SECONDS
    username = f"{expiry}:{secrets.token_hex(6)}"
    digest = hmac.new(TURN_SECRET.encode(), username.encode(), hashlib.sha1).digest()
    return username, base64.b64encode(digest).decode()


def ice_servers() -> list[IceServer]:
    """STUN as configured, plus a freshly credentialed relay when there is one.

    Both, not either. A direct path costs no relay bandwidth and is lower
    latency, so TURN is the fallback ICE falls back TO rather than a
    replacement — offering only the relay would push every drive through it,
    including the ones on a LAN that never needed it.

    Built per connection because the credential expires. aiortc uses at most one
    STUN and one TURN server whatever it is given, so order matters: the first
    of each wins.
    """
    servers = [IceServer(urls=url) for url in STUN_SERVERS]

    if TURN_URLS and TURN_SECRET:
        username, credential = turn_credentials()
        servers.extend(
            IceServer(urls=url, username=username, credential=credential)
            for url in TURN_URLS
        )
    elif TURN_URLS or TURN_SECRET:
        # Half-configured is the likelier of the two deployment mistakes, and it
        # is invisible from the outside: the call still connects from a desk.
        logger.warning(
            "TURN is half-configured — %s is set and the other is not. "
            "No relay will be offered, and talk-back will fail from a mobile network.",
            "TURN_URLS" if TURN_URLS else "TURN_SECRET",
        )

    return servers

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
# identity, the profile stanza and the output contract, and /api/realtime/context
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
# LANGFUSE_BASE_URL is what the v4+ SDKs read; LANGFUSE_HOST is the v3 spelling,
# still accepted by the Python SDK and still what this repo's compose files set,
# so it stays as the fallback rather than a breaking rename.
LANGFUSE_BASE_URL = (
    os.getenv("LANGFUSE_BASE_URL")
    or os.getenv("LANGFUSE_HOST")
    or "https://cloud.langfuse.com"
).rstrip("/")
# Langfuse v4's first-class environment separation. Unset means the project's
# `default` environment, which is where a drive belongs unless somebody has
# deliberately split staging out — so no default is invented here.
LANGFUSE_ENVIRONMENT = os.getenv("LANGFUSE_TRACING_ENVIRONMENT", "")

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

        from opentelemetry import trace

        # Langfuse authenticates OTLP with HTTP Basic over the key pair, not a
        # bearer token — the same credentials as its SDKs, encoded per RFC 7617.
        auth = base64.b64encode(
            f"{LANGFUSE_PUBLIC_KEY}:{LANGFUSE_SECRET_KEY}".encode()
        ).decode()

        # Pipecat stamps `deployment.environment` on the resource from
        # ENVIRONMENT, defaulting to "development" — which nothing here sets, so
        # every drive was labelled development whatever Langfuse was told. Keep
        # it in step with the Langfuse environment (or Langfuse's own
        # `default`); an ENVIRONMENT set deliberately still wins.
        os.environ.setdefault("ENVIRONMENT", LANGFUSE_ENVIRONMENT or "default")

        setup_tracing(
            service_name=os.getenv("LANGFUSE_SERVICE_NAME", "voicemural-talkback"),
            exporter=OTLPSpanExporter(
                endpoint=f"{LANGFUSE_BASE_URL}/api/public/otel/v1/traces",
                headers={"Authorization": f"Basic {auth}"},
            ),
        )
        # After `setup_tracing`, which is what installs the provider. Its
        # exporter only reads spans when they END, so attributes this sets at
        # START are on everything exported.
        trace.get_tracer_provider().add_span_processor(drive_attributes_processor())
        TRACING_ENABLED = True
        logger.info(
            f"[tracing] exporting to Langfuse at {LANGFUSE_BASE_URL}"
            + (f" (environment {LANGFUSE_ENVIRONMENT})" if LANGFUSE_ENVIRONMENT else "")
        )
    except Exception as exc:  # noqa: BLE001 — see the docstring
        logger.warning(f"[tracing] disabled, could not reach OpenTelemetry: {exc}")

    return TRACING_ENABLED


# The drive attributes every span needs, not just the trace: what Langfuse
# filters and aggregates observations by. Trace-level keys (name, tags) stay on
# the root, where they mean something.
PROPAGATED_SPAN_KEYS = (
    "session.id",
    "langfuse.session.id",
    "langfuse.version",
    "langfuse.environment",
    "voicemural.degraded",
)


def drive_attributes_processor():
    """A span processor that copies a drive's attributes onto every span in it.

    WHY. Pipecat 1.7.0 puts `additional_span_attributes` on the root
    `conversation` span ONLY (`TurnTraceObserver.start_conversation_tracing`),
    so the `llm` generations — the spans that carry cost — had no `session.id`,
    no version and no environment: a session's cost did not add up, and an
    evaluator pointed at generations could not filter by prompt version.
    Pipecat builds its parent contexts by hand, so attribute propagation from
    the outside cannot reach them; a processor sees every span start.

    HOW. Several drives share one tracer provider (one container, many
    connections), so nothing here is per process. Each `conversation` span is
    remembered by its trace id when it starts; its attributes are set just
    after, so they are read when a CHILD starts — always later — and copied
    across. Forgotten when the conversation ends.

    Built by a function so the OpenTelemetry import stays deferred, like the
    rest of tracing.
    """
    from opentelemetry.sdk.trace import SpanProcessor

    class DriveAttributes(SpanProcessor):
        def __init__(self) -> None:
            self._roots: dict[int, object] = {}

        def on_start(self, span, parent_context=None) -> None:
            trace_id = span.get_span_context().trace_id
            if span.name == "conversation":
                self._roots[trace_id] = span
                return
            root = self._roots.get(trace_id)
            if root is None:
                return
            attributes = root.attributes or {}
            for key in PROPAGATED_SPAN_KEYS:
                if key in attributes:
                    span.set_attribute(key, attributes[key])

        def on_end(self, span) -> None:
            if span.name == "conversation":
                self._roots.pop(span.get_span_context().trace_id, None)

        def shutdown(self) -> None:
            self._roots.clear()

        def force_flush(self, timeout_millis: int = 30000) -> bool:
            return True

    return DriveAttributes()


def drive_span_attributes(session: dict, capture_session_id: str | None) -> dict:
    """Every span of one drive carries these.

    Split out of `build_pipeline` so it can be read — and tested — without
    standing up a transport, an STT and a TTS service first. The keys are the
    contract between this container and the Langfuse project; getting one of
    them wrong does not fail a drive, it just quietly makes the drive
    unfindable months later, which is exactly the failure a test is for.
    """
    return {
        # A degraded drive ran on FALLBACK_SYSTEM_PROMPT and knows nothing
        # about the person. Its replies are thin BY DESIGN, and without this
        # they look like a model regression months later.
        "voicemural.degraded": bool(session.get("degraded")),
        # THE LANGFUSE-SPECIFIC KEYS, and they are what make a trace
        # findable rather than merely present. Spelled as Langfuse v4 spells
        # them — see `LangfuseOtelSpanAttributes` in the SDKs, which is the
        # one list both the Python and the JS SDK emit against.
        #
        # Pipecat's own spans name themselves `llm`/`stt`/`tts` and leave the
        # TRACE unnamed, so without this every drive lists as a blank row —
        # 97 observations of real content behind nothing you can search for.
        # `conversation_id`, which `build_pipeline` passes to PipelineWorker,
        # groups spans into one trace; it does NOT populate Langfuse's session,
        # which reads the attribute below.
        "langfuse.trace.name": "drive",
        # The ledger's own key, so a trace opens straight onto the drive it
        # came from — the same id in `capture_session`, `utterance` and
        # `agent_turn`. Empty string rather than None: OTel drops an
        # attribute with a null value and the field would silently vanish.
        #
        # `session.id` is the v4 spelling and it is on EVERY span, not just
        # the root — copied there by `drive_attributes_processor`, because
        # Pipecat sets these on the root alone — which is what makes a
        # session's cost the sum of the generations that incurred it.
        "session.id": capture_session_id or "",
        # The v3 spelling of the same thing. Langfuse still accepts it
        # (`TRACE_COMPAT_SESSION_ID` in the SDKs) and a self-hosted server
        # that has not been upgraded to v4 yet reads only this one. Drop it
        # once every target host is on v4.
        "langfuse.session.id": capture_session_id or "",
        # Tags render as filter chips, which is how you find the degraded
        # drives without reading them.
        "langfuse.trace.tags": [
            "degraded" if session.get("degraded") else "full",
        ],
        # The prompt version this drive ran under. It already rides in the
        # LiteLLM metadata, which only helps if the proxy happens to run a
        # Langfuse callback; as a span attribute it is on the drive's own
        # spans unconditionally, and it is the same key and the same value
        # the eval harness sets (`version` in eval/langfuse.ts) — which is
        # what lets one filter show drives and eval runs side by side.
        "langfuse.version": str(session.get("configVersion") or "fallback"),
        # Langfuse v4's environment separation. Only set when configured:
        # an empty value is not the same as "default" and would be rejected.
        **(
            {"langfuse.environment": LANGFUSE_ENVIRONMENT}
            if LANGFUSE_ENVIRONMENT
            else {}
        ),
    }


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
# OFF by default since 14 Oct 2026. On a one-person drive Deepgram split the
# driver into "[Speaker 2]" and "[Speaker 1]" halfway through, and the prompt
# tells the agent that talk between people is theirs and to stay out of it.
# Turn it on for drives with passengers.
STT_DIARIZE = os.getenv("STT_DIARIZE", "false").lower() in ("1", "true", "yes")

# Whether Deepgram keeps the fillers — "um", "uh", "äh" — that it otherwise
# drops (talkback-21). They are half of how unsure somebody sounded, and the
# recorder counts them per subject for its hesitation signal, then leaves them
# out of the text it shows. They ALSO reach the model, which the prompt tells
# to read as hesitation and never answer. OFF by default: whether production
# keeps them is an open decision of the study (SPARKS plan §10). Deepgram only;
# Whisper and AssemblyAI have no such switch, and the signal there degrades to
# pauses, self-repairs and hedges. Read at connect, like the rest — recreate
# the container after changing it (`docker compose up -d` keeps the old .env).
STT_FILLER_WORDS = os.getenv("STT_FILLER_WORDS", "false").lower() in ("1", "true", "yes")

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


def interrupt_min_words() -> int:
    """How many transcribed words it takes to cut the agent off mid-reply.

    The 21 Sep 2026 drive answered "why don't you answer, you are always
    stuck": it was not stuck, it was being interrupted by itself. The agent
    said "The most pressing things", the phone's speaker put that back into
    the microphone, Deepgram transcribed the echo as "[Speaker 2] Most price
    of", and the default VAD start strategy treated the first sound of it as
    the driver talking — broadcast an interruption, cancelled the reply four
    words in. Every reply on that drive is cut off the same way.

    So a user turn is no longer started by the VAD at all. It starts from the
    TRANSCRIPT: one word while the agent is quiet (which is when a word is
    unambiguously theirs), and this many while it is speaking, so an echo
    fragment or a "mm" does not count as a barge-in but "stop, that's wrong"
    does. Four by default: the echo fragments seen were one to three words.
    Clamped to 1-10; `INTERRUPT_MIN_WORDS` tunes it without a rebuild.
    """
    try:
        value = int(os.getenv("INTERRUPT_MIN_WORDS") or 4)
    except ValueError:
        value = 4
    return max(1, min(10, value))


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

    3.0 by default, since 14 Oct 2026; it was 2.0. The theory was that ending
    a turn early does not make the agent talk over a thinker — the completion
    still runs through the prompt's "mid-thought, reply <silence>" rule — and
    on the "Tone of Voice" drive that theory failed: the person talked in long
    stretches with pauses, the agent answered fragment after fragment ("the
    words I say? But can you maybe also just, like,"), and they said so twice.
    Only the case where the turn model judged them MID-SENTENCE waits on this;
    a pause the model hears as an ending is still answered at once, which is
    what Lock on the recorder is for. Clamped to 1-5s;
    `USER_TURN_STOP_TIMEOUT_SECS` tunes it without a rebuild (but with
    --force-recreate).
    """
    try:
        value = float(os.getenv("USER_TURN_STOP_TIMEOUT_SECS") or 3.0)
    except ValueError:
        value = 3.0
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
                # Forwarded as a query parameter. See STT_FILLER_WORDS.
                **({"extra": {"filler_words": "true"}} if STT_FILLER_WORDS else {}),
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


class LanguageFollower(FrameProcessor):
    """Tells TTS which language it is speaking, on an auto-detect drive.

    THE ACCENT. ElevenLabs voices are multilingual, but without a
    `language_code` the model guesses from the text, and every voice speaks
    every language with the accent of the person it was made from. The pilots
    heard Danish, German and Spanish all spoken as an American would. A PINNED
    drive fixes that at connect (`ttsLanguage` / `ttsVoiceId` from
    /api/realtime/session); this does the same for an auto-detect one, from
    what STT reports it heard.

    STABLE, NOT TWITCHY. A switch reconnects the ElevenLabs websocket (the
    language is a URL field), so it happens only when the last WINDOW final
    transcripts agree on a language that differs from the current one. One
    English name in a German sentence changes nothing.

    THE VOICE follows too, by the rule `voiceFor` in voice.ts states: keep the
    chosen voice if it is native to the new language or nothing native exists;
    otherwise swap to the native one. `nativeVoices` is that catalogue, handed
    over by the session so there is one copy of it.

    The fixed phrases (`AnswerGuard`, `KeepAlive`) are told as well, so a
    Danish drive hears "Undskyld" rather than "Sorry".
    """

    WINDOW = 2

    def __init__(
        self,
        tts,
        *,
        chosen_voice: str,
        native_voices: dict | None,
        pinned: bool,
        on_change=None,
    ):
        super().__init__()
        self._tts = tts
        self._chosen = chosen_voice
        self._native = native_voices or {}
        self._pinned = pinned
        self._on_change = on_change or []
        self._recent: list[str] = []
        self._current: str | None = None
        self._voice = chosen_voice

    @staticmethod
    def _base(language) -> str | None:
        if language is None:
            return None
        code = str(getattr(language, "value", language)).lower()
        return code.split("-")[0] or None

    def _voice_for(self, language: str) -> str:
        if self._chosen in self._native.values():
            # The chosen voice is a native speaker of SOME language: keep it
            # only for that one.
            chosen_language = next(k for k, v in self._native.items() if v == self._chosen)
            if chosen_language == language:
                return self._chosen
        return self._native.get(language, self._chosen)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        await self.push_frame(frame, direction)

        if self._pinned or not isinstance(frame, TranscriptionFrame):
            return
        language = self._base(getattr(frame, "language", None))
        if language is None:
            return
        self._recent = (self._recent + [language])[-self.WINDOW :]
        if len(self._recent) < self.WINDOW or len(set(self._recent)) != 1:
            return
        if language == self._current:
            return

        voice = self._voice_for(language)
        logger.info(
            f"[tts] language → {language}"
            f"{f' (voice {voice})' if voice != self._voice else ''}"
        )
        self._current = language
        delta = ElevenLabsTTSService.Settings(language=Language(language))
        if voice != self._voice:
            delta.voice = voice
            self._voice = voice
        await self.push_frame(TTSUpdateSettingsFrame(delta=delta, service=self._tts))
        for callback in self._on_change:
            callback(language)


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


def parse_settled(raw: str | None) -> bool | None:
    """SETTLED or OPEN, however the model dressed it; None for anything else."""
    word = re.sub(r"[^A-Za-z]", "", (raw or "").split()[0] if (raw or "").split() else "").upper()
    if word == "SETTLED":
        return True
    if word == "OPEN":
        return False
    return None


def parse_seeded_titles(raw: object) -> list[tuple[str, int | None]]:
    """The sections a reconnecting browser already has, checked.

    Each is a bare title (an older web app) or `{"title": ..., "ordinal": n}`;
    anything else is dropped. The current subject is last, as sent.
    """
    seeded: list[tuple[str, int | None]] = []
    for entry in raw[-40:] if isinstance(raw, list) else []:
        title = entry.get("title") if isinstance(entry, dict) else entry
        if not isinstance(title, str) or not title.strip():
            continue
        ordinal = entry.get("ordinal") if isinstance(entry, dict) else None
        if isinstance(ordinal, bool) or not isinstance(ordinal, int) or ordinal < 1:
            ordinal = None
        seeded.append((title.strip()[:64], ordinal))
    return seeded


class TurnFeed:
    """The turns, as the recorder's two panels show them.

    The recorder used to show no turns at all — a title, and the trail of the
    ones before it — because reading in a car cradle was the one thing the
    person could not do. The study has moved to who has the floor, and the
    screen with it: one panel for what the agent said, one for what they said,
    in sections by subject, so both sides of the turn-taking are visible at a
    glance. This is what feeds them.

    LIVE ASR, AND ONLY TO THE SCREEN. These are the same words the agent hears
    — the only transcript that exists while it is being spoken — and they go to
    the browser over the data channel and nowhere else. The ledger is still
    `utterance`, from the chunk pipeline, and nothing here writes it.

    ONE OBJECT FOR BOTH SIDES, because a turn ends when the other side starts:
    a reply closes their bubble and their next words close the agent's. Ids
    carry a per-connection prefix, so a reconnect's turn 1 is never mistaken
    for the first connection's.

    `mark` serves `TopicTitle`: the first turn heard since the last naming
    call. When the title changes, the turns from there on are the ones that
    changed it, and the browser moves them into the new section rather than
    leaving the first sentences of a new subject under the old one.
    """

    def __init__(self):
        self._connection = uuid.uuid4().hex[:6]
        self._seq = 0
        self._user: dict | None = None
        self._agent: dict | None = None
        self._since_mark: str | None = None
        # When that first turn since the mark was heard, wall clock ms — where
        # a new subject's visit begins (`TopicTitle`).
        self._since_mark_ms: int | None = None
        self.last_mark_ms: int | None = None
        # A pause measured before their next turn has opened: the thinking
        # before they spoke, counted on that turn when it does.
        self._pause_before = 0

    def _open(self, kind: str) -> dict:
        self._seq += 1
        return {"type": kind, "id": f"{self._connection}-{self._seq}", "text": ""}

    def _noted(self, turn: dict) -> None:
        if self._since_mark is None:
            self._since_mark = turn["id"]
            self._since_mark_ms = _now_ms()

    def user(self, text: str) -> dict | None:
        """Their words, joined onto the turn they are still in. The message to push."""
        text = strip_speaker_tags(text).strip()
        if not text:
            return None
        self._agent = None
        if self._user is None:
            self._user = self._open("user")
            if self._pause_before:
                self._user["pausesBefore"] = self._pause_before
                self._user["pauses"] = self._pause_before
                self._pause_before = 0
        self._noted(self._user)
        self._user["text"] = f"{self._user['text']} {text}".strip()
        return dict(self._user)

    def note_pause(self, gap_secs: float) -> None:
        """They stopped for `gap_secs` and started again (`PauseMarker`).

        Counted on the turn it falls in, for the recorder's hesitation signal:
        inside an open turn it is a pause in the middle of what they were
        saying; before one, the thinking before they said it. The two count the
        same in v1 and are sent apart (`pausesBefore`) so the study can tell.
        A count, never the length: the signal is how often, not how long.
        """
        if self._user is None:
            self._pause_before += 1
        else:
            self._user["pauses"] = self._user.get("pauses", 0) + 1

    def end_user(self) -> None:
        self._user = None

    def agent(self, text: str) -> dict | None:
        """What reached the agent's speaker, joined onto its open turn."""
        if not text:
            return None
        self._user = None
        if self._agent is None:
            self._agent = self._open("agent")
            self._pause_before = 0
        self._noted(self._agent)
        self._agent["text"] += text
        return dict(self._agent)

    def interrupt_agent(self) -> dict | None:
        """Close the agent's turn as cut off. The message to push, if any."""
        turn, self._agent = self._agent, None
        if turn is None or not turn["text"].strip():
            return None
        return {**turn, "interrupted": True}

    def end_agent(self) -> None:
        self._agent = None
        # The quiet after a reply is not a pause in their thought.
        self._pause_before = 0

    @property
    def agent_open(self) -> bool:
        return self._agent is not None

    def mark(self) -> str | None:
        """The first turn heard since the last mark, and start counting again.
        When it was heard is left in `last_mark_ms`."""
        first, self._since_mark = self._since_mark, None
        self.last_mark_ms, self._since_mark_ms = self._since_mark_ms, None
        return first


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

    AND KEPT, as the drive's name. Each new title is also posted to
    `/api/realtime/title`, which stores it on `capture_session.title`, so the
    drive is listed by what it was about rather than only by its date ("I can
    not view my past transcripts easily", 7 Oct 2026). After the push, off the
    event loop, and never awaited by a turn; a 409 means the drive has ended,
    and stops it.

    AND THE SECTIONS OF THE RECORDER'S PANELS (talkback-20). Every turn is
    filed under the title it was said in, so a subject the conversation comes
    BACK to must come back under the same name, or one subject ends up in two
    sections. The model is shown this drive's earlier titles and asked to
    return one verbatim when the speech has gone back to it; an answer that
    matches one, in any case, is taken as that title exactly. Each title
    message also says from which turn the new subject began (`rehomeFrom`),
    so the browser can move the sentences that changed the subject into it.

    And it is where the person's side of the panels comes from: it sees every
    final transcript already, and the turns are numbered by the same `TurnFeed`
    the title's `rehomeFrom` points into.

    AND THE SUBJECTS OF THE DRIVE, KEPT (talkback-21). Every new subject gets
    an ORDINAL — 1, 2, 3, in the order it first came up — carried on its title
    message, and a return keeps the one it had. The ordinal is the only name
    for a subject that leaves the participant's account: a spark the person
    pulls names its subject by it, and the decision it becomes is filed under
    `s{ordinal}`. Each turn of the talk is also posted to
    `/api/realtime/subject` — the visit opened on the subject it turned to, and
    closed on the one it left — so the drive's subjects survive a reload and
    the recall probe can find a subject's own speech days later. Titles never
    reach a log line: the log says `s3`.

    AND WHETHER IT WAS SETTLED. When the talk leaves a subject, one more call
    (`SETTLED_PROMPT`, sent by the web app as `settledPrompt`) is asked whether
    the person stated a decision or a next step on it, over that visit's own
    speech, and the answer goes to the recorder as `{"type": "state",
    "ordinal": n, "settled": bool}`. Off the turn path like the naming, one per
    subject left; inert without the prompt. The drive's LAST subject is never
    judged: it is never left, and at Stop there is nobody to tell.
    """

    # How many earlier titles the model is shown. A drive rarely has more
    # subjects than this, and the list is part of every naming call.
    EARLIER_SHOWN = 16

    # How much recent speech the model is shown. Enough for a subject to be
    # recognisable, short enough that last quarter-hour cannot outvote the last
    # minute — which is the whole difference between this and the summary.
    WINDOW_CHARS = 900
    # Enough new speech to be worth naming, and never more often than this.
    CALL_AFTER_CHARS = 160
    MIN_GAP_SECONDS = 12
    # A slow talker still gets a title: any new speech at all, after this long.
    CALL_AFTER_SECONDS = 30
    # How much of a visit's speech the settled check is shown: its most recent
    # part, which is where a decision lands.
    SETTLED_WINDOW_CHARS = 1500

    # ONCE PER FINISHED TURN of theirs, as well (14 Oct 2026). The thresholds
    # above name the subject every twelve seconds at best, and the recorder
    # files every turn under the subject it was said in: on a drive that moved
    # between subjects faster than that, the first sentences of each new one
    # landed under the old heading ("You put everything on a tone of voice").
    # Naming at the end of each turn makes `rehomeFrom` one turn, not twelve
    # seconds of them. Below this much new speech a turn is a "yes".
    CALL_AFTER_TURN_CHARS = 20

    def __init__(
        self,
        title_prompt: str | None,
        metadata: dict | None = None,
        ticket: str | None = None,
        feed: TurnFeed | None = None,
        titles: list | None = None,
        started_at_ms: int | None = None,
        settled_prompt: str | None = None,
    ):
        super().__init__()
        self._prompt = (title_prompt or "").strip()
        self._settled_prompt = (settled_prompt or "").strip()
        self._started_at_ms = started_at_ms
        # What was said on the current visit, for the settled check.
        self._visit_text = ""
        self._metadata = metadata or {}
        self._ticket = ticket
        self._feed = feed
        # Set once the web app refuses a title because the drive is over.
        self._drive_ended = False
        # Seeded from the browser on a reconnect: the sections it already has,
        # the current one last. This process starts knowing nothing, and
        # without them a subject from before the tunnel would come back under a
        # new name and a second section.
        # Whether the VAD hears them right now, as last told to the browser.
        # Deduplicated here because two VADs report it — the pipeline's own and
        # the aggregator's, whose copies come back upstream.
        self._hearing_them = False
        # Each subject's ordinal, by its folded title. Seeded with the
        # browser's own numbers on a reconnect, so a subject keeps the one its
        # sparks and its stored row already have.
        self._ordinals: dict[str, int] = {}
        seeded: list[str] = []
        for title, ordinal in parse_seeded_titles(titles):
            seeded.append(title)
            self._ordinals[title.casefold()] = ordinal or max(self._ordinals.values(), default=0) + 1
        self._title: str | None = seeded[-1] if seeded else None
        self._earlier: list[str] = []
        for earlier in seeded[:-1]:
            self._remember(earlier)
        # Where the current visit began, as an offset into the drive. A
        # reconnect starts a new visit to the subject it was on.
        self._visit_start: int | None = self._offset(_now_ms()) if self._title else None
        # When they first spoke on this connection, for the visit of a first
        # title, which names what was said before it.
        self._first_speech_ms: int | None = None
        self._window = ""
        self._new_chars = 0
        self._last_call = time.monotonic()
        self._task: asyncio.Task | None = None
        # A turn ended while a call was in flight: name again when it lands,
        # so that turn is not filed by whichever call happens next.
        self._again = False

    @property
    def title(self) -> str | None:
        return self._title

    def ordinal_of(self, title: str | None) -> int | None:
        return self._ordinals.get(title.casefold()) if title else None

    def title_for(self, ordinal: int) -> str | None:
        """The title of subject `ordinal`, if this drive has one — what a
        spark the person pulled is about."""
        if self._title is not None and self.ordinal_of(self._title) == ordinal:
            return self._title
        return next((t for t in self._earlier if self.ordinal_of(t) == ordinal), None)

    def _offset(self, wall_ms: int | None) -> int | None:
        if wall_ms is None or not self._started_at_ms:
            return None
        return max(0, wall_ms - self._started_at_ms)

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

    def _remember(self, title: str) -> None:
        """Keep `title` among the earlier ones, once, most recent last."""
        folded = title.casefold()
        self._earlier = [t for t in self._earlier if t.casefold() != folded]
        self._earlier.append(title)

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            if self._first_speech_ms is None:
                self._first_speech_ms = _now_ms()
            self._append(frame.text.strip())
        elif isinstance(frame, (EndFrame, CancelFrame)):
            # The drive's last visit, closed as a best effort: Stop usually
            # ends the session first, and then the write is refused and the
            # reader closes it at the drive's end.
            self._close_visit(self._offset(_now_ms()))
        elif isinstance(frame, UserStoppedSpeakingFrame):
            # The aggregator's end of their turn, coming back upstream. Not its
            # START: a turn starts on words, so that frame arrives after the
            # transcript it was started by and would split it off its own turn.
            if self._feed is not None:
                self._feed.end_user()
            self._maybe_name(turn_ended=True)

        # Pushed on IMMEDIATELY, before anything is decided about it. Nothing
        # downstream waits on the board.
        await self.push_frame(frame, direction)

        # WHO IS TALKING, for the recorder to light their panel. The VAD, not
        # the turn: a turn starts on their first transcribed word and ends two
        # seconds after their last, which on the screen reads as lag at both
        # ends. The agent's side needs nothing from here — the browser already
        # hears its audio start and stop.
        if self._feed is not None and isinstance(
            frame, (VADUserStartedSpeakingFrame, VADUserStoppedSpeakingFrame)
        ):
            hearing = isinstance(frame, VADUserStartedSpeakingFrame)
            if hearing != self._hearing_them:
                self._hearing_them = hearing
                await self.push_frame(
                    RTVIServerMessageFrame(data={"type": "speaking", "who": "user", "speaking": hearing})
                )

        if isinstance(frame, TranscriptionFrame) and frame.text.strip():
            if self._feed is not None:
                message = self._feed.user(frame.text)
                if message is not None:
                    await self.push_frame(RTVIServerMessageFrame(data=message))
            self._maybe_name()

    def _append(self, text: str) -> None:
        if not self._prompt or not text.strip():
            return
        self._window = f"{self._window} {text.strip()}".strip()[-self.WINDOW_CHARS :]
        self._new_chars += len(text.strip())
        if self._settled_prompt:
            self._visit_text = f"{self._visit_text}\n{text.strip()}".strip()[
                -self.SETTLED_WINDOW_CHARS :
            ]

    def _maybe_name(self, turn_ended: bool = False) -> None:
        elapsed = time.monotonic() - self._last_call
        if turn_ended:
            due = self._new_chars >= self.CALL_AFTER_TURN_CHARS
        else:
            enough = self._new_chars >= self.CALL_AFTER_CHARS and elapsed >= self.MIN_GAP_SECONDS
            overdue = self._new_chars > 0 and elapsed >= self.CALL_AFTER_SECONDS
            due = enough or overdue
        if not due:
            return
        if self._task is not None and not self._task.done():
            if turn_ended:
                self._again = True
            return
        # `create_task`, not `asyncio.create_task`, because this task PUSHES A
        # FRAME — the same reason `Offers` uses it. Pipecat's task manager is
        # what keeps that push inside the processor's own lifecycle, and what
        # cancels it cleanly when the pipeline goes down.
        # `_name_topic`, not `_name`: FrameProcessor already owns `_name`, and it
        # is a string — shadowing it fails at the call, not at the definition.
        self._task = self.create_task(self._name_topic(), name="title:call")

    async def _name_topic(self) -> None:
        await self._name_once()
        # A turn ended while this call ran: name again for it, now. Not in a
        # `finally`, so a cancelled pipeline does not start a call on its way
        # down.
        if self._again:
            self._again = False
            self._task = None
            self._maybe_name(turn_ended=True)

    async def _name_once(self) -> None:
        window, self._new_chars = self._window, 0
        self._last_call = time.monotonic()
        # Taken with the window: these are the turns this call is about.
        rehome_from = self._feed.mark() if self._feed is not None else None
        if not window:
            return

        current = self._title or "(none yet)"
        earlier = ""
        if self._earlier:
            shown = self._earlier[-self.EARLIER_SHOWN :]
            earlier = "Earlier titles: " + "; ".join(shown) + "\n\n"
        try:
            raw = await asyncio.to_thread(
                _litellm_chat,
                [
                    {"role": "system", "content": self._prompt},
                    {
                        "role": "user",
                        "content": f"Current title: {current}\n\n{earlier}Recent speech:\n{window}",
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

        # A subject come back: the earlier title exactly, whatever case the
        # model returned it in, because the browser finds its section by it.
        returned = next((t for t in self._earlier if t.casefold() == title.casefold()), None)
        if returned is not None:
            title = returned
        else:
            self._ordinals[title.casefold()] = max(self._ordinals.values(), default=0) + 1
        ordinal = self._ordinals[title.casefold()]
        # The ordinal, never the title: no subject's name reaches the log.
        logger.info(f"[title] {'back to ' if returned is not None else ''}s{ordinal}")

        # The visit: from the turn that changed the subject, or — for the
        # first title, which names everything said before it — from their
        # first words.
        now = _now_ms()
        start_ms = self._feed.last_mark_ms if self._feed is not None else None
        if self._title is None and self._first_speech_ms is not None:
            start_ms = min(start_ms or now, self._first_speech_ms)
        start = self._offset(start_ms or now)
        left = self._title
        self._close_visit(start)
        # Judged on what was said while it was current. The speech that changed
        # the subject is in there too: a few words of the next one do not make
        # the last one settled.
        if left is not None and self._settled_prompt and self._visit_text:
            left_ordinal = self.ordinal_of(left)
            if left_ordinal is not None:
                self.create_task(
                    self._judge(left_ordinal, left, self._visit_text), name="title:settled"
                )
        # A first title names everything said before it, so that speech stays.
        if left is not None:
            self._visit_text = ""

        if left is not None:
            self._remember(left)
        self._earlier = [t for t in self._earlier if t.casefold() != title.casefold()]
        self._title = title
        self._visit_start = start

        message: dict = {"type": "title", "title": title, "ordinal": ordinal}
        if rehome_from is not None:
            message["rehomeFrom"] = rehome_from
        await self.push_frame(RTVIServerMessageFrame(data=message))
        if self._ticket and not self._drive_ended:
            await asyncio.to_thread(self._save, title)
            if start is not None:
                self._post_visit({"ordinal": ordinal, "title": title, "startOffsetMs": start})

    async def _judge(self, ordinal: int, title: str, said: str) -> None:
        """Ask whether subject `ordinal` was settled, and tell the recorder."""
        try:
            raw = await asyncio.to_thread(
                _litellm_chat,
                [
                    {"role": "system", "content": self._settled_prompt},
                    {"role": "user", "content": f"Subject: {title}\n\nWhat was said:\n{said}"},
                ],
                max_tokens=4,
                metadata=self._metadata,
            )
        except Exception as err:
            # Dropped: a mark nobody sees is not worth a retry.
            logger.warning(f"[title] s{ordinal} not judged: {type(err).__name__}")
            return
        settled = parse_settled(raw)
        if settled is None:
            return
        logger.info(f"[title] s{ordinal} {'settled' if settled else 'open'}")
        await self.push_frame(
            RTVIServerMessageFrame(data={"type": "state", "ordinal": ordinal, "settled": settled})
        )

    def _close_visit(self, end: int | None) -> None:
        """Close the visit to the current subject at `end`. Off the loop."""
        if self._title is None or self._visit_start is None or end is None:
            return
        ordinal = self.ordinal_of(self._title)
        if ordinal is None or not self._ticket or self._drive_ended:
            return
        payload = {
            "ordinal": ordinal,
            "title": self._title,
            "startOffsetMs": self._visit_start,
            "endOffsetMs": max(end, self._visit_start),
        }
        self._visit_start = None

        async def send() -> None:
            await asyncio.to_thread(self._post_visit, payload)

        asyncio.create_task(send())

    def _post_visit(self, visit: dict) -> None:
        """Keep a visit to a subject. Logged by ordinal and dropped on failure:
        the next turn of the talk writes the next one, and a 409 means the drive
        has ended."""
        if self._drive_ended:
            return
        req = urllib.request.Request(
            f"{WEB_URL}/api/realtime/subject",
            method="POST",
            data=json.dumps({"ticket": self._ticket, **visit}).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=5):
                pass
        except urllib.error.HTTPError as err:
            if err.code == 409:
                self._drive_ended = True
            logger.warning(f"[title] s{visit['ordinal']} not kept ({err.code})")
        except Exception as err:
            logger.warning(f"[title] s{visit['ordinal']} not kept: {type(err).__name__}")

    def _save(self, title: str) -> None:
        """Keep `title` as the drive's name. Logged and dropped on failure: the
        next title will try again, and a name is not worth a drive."""
        req = urllib.request.Request(
            f"{WEB_URL}/api/realtime/title",
            method="POST",
            data=json.dumps({"ticket": self._ticket, "title": title}).encode(),
            headers={"Content-Type": "application/json"},
        )
        try:
            with urllib.request.urlopen(req, timeout=5):
                pass
        except urllib.error.HTTPError as err:
            if err.code == 409:
                self._drive_ended = True
            logger.warning(f"[title] not saved ({err.code})")
        except Exception as err:
            logger.warning(f"[title] not saved: {err}")


class PauseMarker(FrameProcessor):
    """Tells the model where they stopped to think, in the one channel it has.

    THE AGENT ONLY EVER GETS WORDS. Asked on 14 Oct 2026 whether it could hear
    "the tone of voice, the breaks I make", it said — truthfully — "I only read
    the words you say". Tone needs a model that takes audio. The breaks do not:
    the VAD has been timing them all along, and a long pause in the middle of
    a stretch of speech is exactly the cue for "still thinking, do not answer
    yet" that the prompt asks the model to respect from words alone.

    So when they start again after `MIN_PAUSE_SECS` or more of their own
    silence, the next transcript reaches the model as "(pause 4s) and then…".
    Only gaps between THEIR speech: an agent turn in between resets the clock,
    because the quiet after a reply is not a pause in their thought.

    LAST BEFORE THE USER AGGREGATOR, so only the model's context sees the mark.
    The summary, the title, recall, the turn record and the screen all read the
    transcript upstream of here, clean. And only while the agent is quiet,
    which is also what keeps it out of the aggregator's barge-in rule: that
    counts words while the agent speaks, and the mark is never added then.

    The format is described to the model in `prompt.ts` (WHAT YOU CAN SEE) —
    change one, change the other.

    AND COUNTED FOR THE RECORDER (talkback-21): each pause is also told to the
    `TurnFeed`, which counts it on the turn it fell in, for the sparks'
    hesitation signal. Counted when it is measured, so a pause whose words
    never came still counts: they stopped, and started again.
    """

    MIN_PAUSE_SECS = 2.0
    # A pause whose words never came (a cough the VAD took for speech) is not
    # carried onto speech this much later.
    STALE_SECS = 10.0

    def __init__(self, feed: TurnFeed | None = None):
        super().__init__()
        self._feed = feed
        # When their last stretch of speech ended, if nothing has been said by
        # anyone since.
        self._quiet_since: float | None = None
        # A pause measured at the start of new speech, waiting for its words.
        self._pause: tuple[float, float] | None = None

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        now = time.monotonic()
        if direction == FrameDirection.DOWNSTREAM and isinstance(frame, VADUserStoppedSpeakingFrame):
            self._quiet_since = now
        elif direction == FrameDirection.DOWNSTREAM and isinstance(frame, VADUserStartedSpeakingFrame):
            if self._quiet_since is not None:
                gap = now - self._quiet_since
                if gap >= self.MIN_PAUSE_SECS:
                    self._pause = (gap, now)
                    if self._feed is not None:
                        self._feed.note_pause(gap)
            self._quiet_since = None
        elif isinstance(frame, BotStartedSpeakingFrame):
            self._quiet_since = None
            self._pause = None
        elif isinstance(frame, TranscriptionFrame) and frame.text.strip() and self._pause:
            gap, at = self._pause
            self._pause = None
            if now - at <= self.STALE_SECS:
                frame.text = f"(pause {round(gap)}s) {frame.text}"

        await self.push_frame(frame, direction)


class AgentFeed(FrameProcessor):
    """Sends the agent's side of the conversation to its panel on the recorder.

    BETWEEN THE GATE AND THE TTS, because that is the one place that sees
    exactly what reaches the speaker: text `SilenceGate` released (never a
    `<silence>`, never a draft body) and every sentence the container speaks
    with no completion behind it — the acknowledgement, a poke's last line, the
    keep-alive while a search runs — which arrive as `TTSSpeakFrame`.

    THROTTLED, because a reply streams a few characters at a time and every
    message re-renders the panel on a phone that is also holding a call up and
    a recorder open (the cost `use-pipecat.ts` describes for the old exchange).
    A message goes on a sentence end or every `THROTTLE_SECS`, and whatever is
    left is flushed when the completion ends. The text is the whole turn so far
    each time, so a dropped message costs nothing the next one does not carry.
    """

    THROTTLE_SECS = 0.3
    SENTENCE_END = (".", "!", "?", "…", ":", ";")

    def __init__(self, feed: TurnFeed):
        super().__init__()
        self._feed = feed
        self._last_push = 0.0
        self._pending: dict | None = None
        self._in_response = False
        self._speaking = False

    async def _send(self, message: dict | None) -> None:
        if message is None:
            return
        self._pending = None
        self._last_push = time.monotonic()
        await self.push_frame(RTVIServerMessageFrame(data=message))

    async def _said(self, text: str, *, flush: bool = False) -> None:
        message = self._feed.agent(text)
        if message is None:
            return
        due = time.monotonic() - self._last_push >= self.THROTTLE_SECS
        if flush or due or text.rstrip().endswith(self.SENTENCE_END):
            await self._send(message)
        else:
            self._pending = message

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if direction == FrameDirection.DOWNSTREAM:
            if isinstance(frame, LLMFullResponseStartFrame):
                self._in_response = True
            elif isinstance(frame, LLMTextFrame):
                await self._said(frame.text)
            elif isinstance(frame, TTSSpeakFrame):
                await self._said(frame.text, flush=True)
            elif isinstance(frame, LLMFullResponseEndFrame):
                self._in_response = False
                await self._send(self._pending)
            elif isinstance(frame, InterruptionFrame):
                # Only a turn that was still going can have been cut off: the
                # aggregator broadcasts an interruption at the start of every
                # turn of theirs, including after a reply that finished.
                if self._speaking or self._in_response:
                    self._pending = None
                    await self._send(self._feed.interrupt_agent())
                else:
                    self._feed.end_agent()
                self._in_response = False
        elif isinstance(frame, BotStartedSpeakingFrame):
            self._speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._speaking = False
            # The audio has finished and nothing more is being generated: the
            # turn is over, and the next thing the agent says is a new one.
            # Not on a stop mid-reply — TTS can run dry between two sentences
            # of a slow completion, and that is one turn with a pause in it.
            if not self._in_response:
                await self._send(self._pending)
                self._feed.end_agent()

        await self.push_frame(frame, direction)


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
        # Which screen they have open, as the line `/context` renders it
        # (`renderScreen` in screen.ts). Held here rather than widening the
        # `_fetch` tuple; None until the first fetch, and from an older web
        # deploy that sends no such field.
        self._screen: str | None = None
        # The date and time where they are, as of their words (`renderLocalTime`
        # in clock.ts). Held the same way, for the same reasons.
        self._now: str | None = None

    def _fetch(
        self, said: str, answering: str | None = None
    ) -> tuple[
        list[dict], list[dict], dict | None, str | None, str | None, str | None
    ]:
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
            self._screen = body.get("screen")
            self._now = body.get("now")
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
                # Same, from `buildDraftContext`: the handles the model needs to
                # revise a draft are derived from row ids this process never
                # sees. Absent from an older web deploy, which reads as "no
                # drafts" — the container then writes new drafts, which is
                # exactly the behaviour before this existed.
                body.get("drafts"),
            )

    def _compose(
        self,
        passages: list[dict],
        pending: dict | None = None,
        threads: list[dict] | None = None,
        board: str | None = None,
        drafts: str | None = None,
    ) -> str | None:
        sections: list[str] = []
        # The time where they are, ahead even of the screen: the agent has no
        # clock of its own, and on 7 Oct 2026 it made one up ("It's 10:14 AM",
        # twice, at ten). Mirrored in packages/talkback/src/eval/messages.ts.
        if self._now:
            sections.append(self._now)
        # Which screen they have open, first and in one line: it is not
        # background about their work but a fact about right now, and it is
        # what grounds any direction about the app. Mirrored in
        # packages/talkback/src/eval/messages.ts — change one, change both.
        if self._screen:
            sections.append(self._screen)
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
        # The drafts come after the quotes and before the drive summary. They
        # are THIS drive's own output — not dated material from past ones — so
        # they sit with the current drive; and the summary still has to be last,
        # because it is what "that", "the second one" and "what I just said"
        # resolve against. Mirrored in packages/talkback/src/eval/messages.ts —
        # change one, change both.
        if drafts:
            sections.append(drafts)
        summary = self._summary.summary
        if summary and summary.strip():
            sections.append(f"So far in this drive:\n{summary.strip()}")

        if not sections and not pending:
            return None

        block = "\n\n".join(sections) if sections else ""
        if block:
            block += "\n\nThat is background. Answer what was just said to you, and use it to say which thing you mean."

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
            content = self._compose([], None, [], None, None)
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
            drafts: str | None = None
            if self._ticket:
                try:
                    # The search query is what was said, not who said it.
                    passages, threads, pending, board, settled, drafts = await asyncio.to_thread(
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
                    if drafts:
                        logger.info(f"[draft] {drafts.count(chr(10) + 'draft ')} draft(s) in view")
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
            content = self._compose(passages, pending, threads, board, drafts)
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
# Mirrors PROACTIVE_AFTER_SECS in packages/talkback/src/profile.ts — change
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

# --- Words the container puts in the model's mouth ---------------------------
#
# Everything below is spoken with no completion behind it, so every one of them
# is written to `agent_turn` when it is said: the agent's voice reaches the
# microphone and is transcribed like any other sound, and `withoutEcho` tells
# those lines from the driver's by comparing against that table. A phrase that
# is spoken and not recorded comes back as the participant's own words.
#
# Mirrors ANSWER_RETRY_NUDGE / ANSWER_ACKNOWLEDGEMENTS / SEARCH_WAIT_PHRASES in
# packages/talkback/src/prompt.ts — change one, change both.
ANSWER_RETRY_NUDGE = (
    "(They have just answered the question YOU asked them. <silence> is not "
    "available on this turn: act on their answer and say in one short sentence "
    "what you are doing. If you cannot tell what they meant, ask one short "
    "question instead — but say something.)"
)
ANSWER_ACKNOWLEDGEMENTS = {
    "en": "Sorry, I lost that. Say it again.",
    "de": "Entschuldige, das ist mir entgangen. Sag es noch mal.",
    "da": "Undskyld, det gik mig forbi. Sig det igen.",
    "es": "Perdona, se me ha escapado. Dilo otra vez.",
}
SEARCH_WAIT_PHRASES = {
    "en": ("Still looking that up.", "Bear with me, I am still searching."),
    "de": ("Ich suche noch.", "Hab ein bisschen Geduld, ich suche noch."),
    "da": ("Jeg leder stadig efter det.", "Et øjeblik, jeg søger stadig."),
    "es": ("Todavía lo estoy buscando.", "Un momento, sigo buscando todavía."),
}
FALLBACK_PHRASE_LANGUAGE = "en"

# --- The floor: Lock, Normal and Poke ----------------------------------------
#
# Mirrors POKE_NUDGE / POKE_RETRY_NUDGE / POKE_FALLBACKS / FLOOR_OPEN_NOTE in
# packages/talkback/src/prompt.ts — change one, change both. The fallbacks are
# spoken with no completion behind them, so they follow the rules above: no
# question mark, at most twelve words, and enough words for the echo filter.
POKE_NUDGE = (
    "(They tapped to hear from you now — a poke, the way you would nudge someone "
    "sitting next to you. They may have been talking for a while without you. "
    "<silence> is not available on this turn. If they said something you have not "
    "answered yet, respond to the most recent thing that wants a response; "
    "otherwise say the one most useful thing you can see — the next step they "
    "named, an open question from where things stand, the obvious objection. One "
    "or two short sentences, and never repeat what you said last.)"
)
POKE_RETRY_NUDGE = (
    "(They poked you to hear from you, and <silence> is not available. Say one "
    "short sentence: your take on what they said last, or the next step you can see.)"
)
POKE_FALLBACKS = {
    "en": "I'm listening, nothing to add on that yet.",
    "de": "Ich höre zu, dazu habe ich gerade nichts hinzuzufügen.",
    "da": "Jeg lytter med, jeg har ikke noget at tilføje endnu.",
    "es": "Te escucho, de momento no tengo nada que añadir.",
}
FLOOR_OPEN_NOTE = (
    "(They have unlocked you: you may reply again from their next words. Do not "
    "work back through what they said while you were locked — respond only to "
    "what they say next, if it wants a reply.)"
)

# --- Sparks: a question about one subject, pulled by the person --------------
#
# Mirrors SPARK_NUDGES / SPARK_RETRY_NUDGE / SPARK_FALLBACKS in
# packages/talkback/src/prompt.ts — change one, change both. `{subject}` is the
# subject's title, which this container holds (`TopicTitle`); the browser sends
# only the kind and the ordinal. The fallbacks are spoken with no completion
# behind them, so they are recorded like the rest — but unlike a poke's they
# are QUESTIONS, on purpose: a spark is a question they pulled, and their reply
# is then an answer `AnswerGuard` keeps from being met with silence.
SPARK_KINDS = ("say_back", "decide", "unsure", "revisit")
_SPARK_TAIL = (
    "<silence> is not available on this turn. One or two short sentences with a "
    "single question back to them: do not answer it yourself, do not summarise their "
    "position or what was said first, and add no view of your own.)"
)
SPARK_NUDGES = {
    "say_back": (
        '(They pulled a spark about "{subject}": ask them to say, in their own words, '
        "where they landed on it. " + _SPARK_TAIL
    ),
    "decide": (
        '(They pulled a spark about "{subject}": ask them what they would decide on it '
        "if they had to decide now. " + _SPARK_TAIL
    ),
    "unsure": (
        '(They pulled a spark about "{subject}": ask them what is making them unsure '
        "about it. " + _SPARK_TAIL
    ),
    "revisit": (
        '(They pulled a spark about "{subject}": ask, in one question, whether they want '
        "to go back to it and what was still open there. " + _SPARK_TAIL
    ),
}
SPARK_RETRY_NUDGE = (
    '(They pulled a spark about "{subject}" for you to ask them, and <silence> is '
    "not available. Ask its question now, in one short sentence, and do not answer "
    "it yourself.)"
)
SPARK_FALLBACKS = {
    "say_back": {
        "en": "In your own words: where did you land on {subject}?",
        "de": "In deinen eigenen Worten: Wo bist du bei {subject} gelandet?",
        "da": "Med dine egne ord: hvor endte du med {subject}?",
        "es": "Con tus propias palabras: ¿dónde llegaste con {subject}?",
    },
    "decide": {
        "en": "If you had to decide on {subject} now, what would it be?",
        "de": "Wenn du bei {subject} jetzt entscheiden müsstest, was wäre es?",
        "da": "Hvis du skulle beslutte {subject} nu, hvad ville det så være?",
        "es": "Si tuvieras que decidir {subject} ahora, ¿qué sería?",
    },
    "unsure": {
        "en": "What is making you unsure about {subject}?",
        "de": "Was macht dich bei {subject} unsicher?",
        "da": "Hvad gør dig usikker på {subject}?",
        "es": "¿Qué te hace dudar sobre {subject}?",
    },
    "revisit": {
        "en": "Back to {subject}: what was still open there?",
        "de": "Zurück zu {subject}: Was war da noch offen?",
        "da": "Tilbage til {subject}: hvad var stadig åbent der?",
        "es": "Volviendo a {subject}: ¿qué quedaba abierto?",
    },
}


def spark_text(template: str, subject: str) -> str:
    """A spark's text with its subject filled in. `replace`, not `format`: a
    title with a brace in it must not be taken for a placeholder."""
    return template.replace("{subject}", subject)


def spark_fallback(kind: str, subject: str, language: str | None) -> str:
    phrases = SPARK_FALLBACKS[kind]
    return spark_text(phrases.get(language or "", phrases[FALLBACK_PHRASE_LANGUAGE]), subject)


def parse_spark(data: object) -> tuple[str, int] | None:
    """The spark a poke carries, checked: `{"kind": ..., "ordinal": n}` or None.

    The browser is the boundary: an older one sends a bare poke, and anything
    malformed is a plain poke rather than an error — the tap still deserves a
    turn.
    """
    if not isinstance(data, dict):
        return None
    kind, ordinal = data.get("kind"), data.get("ordinal")
    if kind not in SPARK_KINDS or isinstance(ordinal, bool) or not isinstance(ordinal, int):
        return None
    if ordinal < 1:
        return None
    return kind, ordinal


def phrase_language(session: dict) -> str:
    """Which language the fixed phrases above are said in.

    The drive's own `sttLanguage`, which is a property of the recording rather
    than of this container. Null — auto-detect — starts in English and is
    then moved by `LanguageFollower` once STT has heard what is being spoken.
    """
    language = (session or {}).get("sttLanguage")
    return language if language in ANSWER_ACKNOWLEDGEMENTS else FALLBACK_PHRASE_LANGUAGE


def answer_acknowledgement(language: str | None) -> str:
    return ANSWER_ACKNOWLEDGEMENTS.get(language or "", ANSWER_ACKNOWLEDGEMENTS[FALLBACK_PHRASE_LANGUAGE])


def poke_fallback(language: str | None) -> str:
    return POKE_FALLBACKS.get(language or "", POKE_FALLBACKS[FALLBACK_PHRASE_LANGUAGE])


def search_wait_phrase(language: str | None, index: int) -> str | None:
    """The nth keep-alive, or None once the list is spent and we fall silent."""
    phrases = SEARCH_WAIT_PHRASES.get(language or "", SEARCH_WAIT_PHRASES[FALLBACK_PHRASE_LANGUAGE])
    return phrases[index] if 0 <= index < len(phrases) else None


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
        floor: "Floor | None" = None,
    ):
        super().__init__()
        self._context = context
        self._recall = recall
        self._recorder = recorder
        # Who may talk. An unprompted turn is the one kind the person never
        # asked for, so it is the first thing a Lock takes away.
        self._floor = floor
        self._enabled = offers_enabled(session)
        # The profile's proactivity level, arrived via /api/realtime/session —
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

        # The drive is over. The timer is armed from the driver's last words
        # and cancelled by an EndFrame, and on the first formative pilot
        # neither happened in time: Stop ends the capture session over HTTPS,
        # the peer connection follows only when ICE gives up, and 52 seconds
        # after `ended_at` this fired and offered to look something up in a
        # room where the recording had stopped. Checked HERE rather than only
        # at the write, because the failure is the turn being TAKEN — spoken
        # aloud, and offering something she had already agreed to.
        if self._recorder is not None and self._recorder.session_ended:
            logger.info("[offers] the drive has ended — no unprompted turn")
            return

        # Locked: they have said only they speak. Checked here, where the turn
        # would be taken, rather than by not arming — the lock can come and go
        # while a timer waits, and a timer armed under Normal must not speak
        # into a Lock pressed since. Not even the opening: a drive that starts
        # locked starts in silence, which is what the remembered mode means.
        if self._floor is not None and self._floor.locked:
            logger.info("[offers] locked — no unprompted turn")
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


class AnswerGuard(FrameProcessor):
    """Refuses to let an answer the agent ASKED FOR go unanswered.

    THE FAILURE IT CLOSES, observed on the first formative pilot (19 Sep 2026).
    The agent asked "Soll ich die genauen Zeiten für einen davon suchen?", the
    participant said "Ja.", and the model returned `<silence>` — recorded,
    faithfully, as `user_turn -> declined`. Forty seconds of nothing followed,
    she asked "Und dann?", that was declined too, and she stopped the
    recording. Her own words afterwards: "ist jetzt die App ausgegangen?"

    This is the most expensive failure the system has, because the person is
    waiting on a commitment they have already made and a screenless interface
    gives them no way to tell waiting from broken. The defect is upstream of
    `SilenceGate`: the model genuinely answered `<silence>`, and nothing in the
    prompt or the container said it could not.

    WHAT THIS DOES. `TurnRecorder` remembers that the last SPOKEN turn ended in
    a question. When the gate then sees a completion decline a `user_turn` in
    that state, it does not write the decline: it asks here for one re-run with
    `ANSWER_RETRY_NUDGE`, which takes the sentinel off the table for that
    completion. If the re-run declines as well, the gate speaks
    `ANSWER_ACKNOWLEDGEMENTS` — a fixed sentence, in the drive's language —
    rather than nothing.

    ONE DECISION PER MOMENT. The refused completion writes no `agent_turn`
    (nothing was spoken) and no `agent_decision` either: the driver's words were
    one opportunity to speak, and the turn that finally speaks — or the
    acknowledgement — is what that opportunity became. Writing the refusal
    too would make the log say the agent was given two moments where it had one.

    WHY A PROCESSOR. The re-run is the same mechanism `Offers` uses for an
    unprompted turn: a user-role message added to the context, then an
    `LLMRunFrame` pushed from a point upstream of the user aggregator, so the
    completion, the gate, the recorder and the barge-in plumbing are all the
    normal ones. Nothing about it is conditional on the study arm — unlike
    `Offers`, this is a correctness guard and runs on every drive.
    """

    # A beat before the re-run, so the declined completion has finished
    # travelling the pipeline — the assistant aggregator sits at the very end —
    # before a second one starts behind it.
    SETTLE_SECS = 0.1

    def __init__(self, context: LLMContext, session: dict | None = None):
        super().__init__()
        self._context = context
        self._language = phrase_language(session or {})
        # True between asking for the re-run and the turn it produces. One per
        # moment: a second decline is answered with words, not a third try.
        self._retrying = False
        # True once the re-run's completion has actually been started. Pipecat
        # can run its own second inference for the same user turn in between,
        # and a decline from THAT is not the re-run declining — it used to be
        # answered with the acknowledgement while the re-run was still to come
        # ("Sorry, I lost that" twice on the 27 Sep 2026 evaluation drive).
        self._retry_started = False
        # What the re-run is told. The answer guard's own nudge, unless the
        # moment being forced is a poke — see `Floor`.
        self._nudge = ANSWER_RETRY_NUDGE

    @property
    def retrying(self) -> bool:
        return self._retrying

    @property
    def retry_started(self) -> bool:
        """Whether the completion now running can be the re-run itself."""
        return self._retrying and self._retry_started

    @property
    def acknowledgement(self) -> str:
        return answer_acknowledgement(self._language)

    @property
    def poke_fallback(self) -> str:
        """What a poke ends in when its re-run declines too, in the drive's language."""
        return poke_fallback(self._language)

    def spark_fallback(self, kind: str, subject: str) -> str:
        """What a spark ends in when its re-run declines too: its question, fixed."""
        return spark_fallback(kind, subject, self._language)

    def request_retry(self, nudge: str = ANSWER_RETRY_NUDGE) -> None:
        """Run this turn again, from the gate's frame handler.

        Synchronous on purpose: the gate calls it while handling the declined
        completion's end frame, and the work happens on a task afterwards.

        `nudge` is what the re-run is told. The same machinery forces a poke —
        a moment the person asked for with a tap rather than an answer — and
        "they have just answered the question YOU asked" would be false there.
        """
        if self._retrying:
            # Already asked for; one re-run per moment.
            return
        self._retrying = True
        self._retry_started = False
        self._nudge = nudge
        self.create_task(self._retry(), name="answers:retry")

    def settled(self) -> None:
        """The moment is over — something was spoken, or the driver moved on."""
        self._retrying = False
        self._retry_started = False

    async def _retry(self) -> None:
        await asyncio.sleep(self.SETTLE_SECS)
        # Pipecat's own end-of-turn inference may have spoken in the meantime.
        # Re-running then would answer the same words twice.
        if not self._retrying:
            logger.info("[answer] settled before the re-run — not re-running")
            return
        self._context.add_message({"role": "user", "content": self._nudge})
        logger.info(
            "[answer] a declined poke — re-running the turn"
            if self._nudge is not ANSWER_RETRY_NUDGE
            else "[answer] a declined answer to our own question — re-running the turn"
        )
        self._retry_started = True
        await self.push_frame(LLMRunFrame())

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        # New words are a new moment, whatever became of the last one. Without
        # this a retry abandoned by a barge-in would leave the flag set and the
        # NEXT decline would be answered with the acknowledgement.
        if isinstance(frame, TranscriptionFrame) and frame.text.strip() and self._retrying:
            self.settled()
        await self.push_frame(frame, direction)


class Floor(FrameProcessor):
    """Who may talk: the person's Lock, Normal and Poke, made mechanical.

    WHAT IT IS FOR. Until talkback-20 whether the agent spoke was the model's
    call alone, every turn, with `<silence>` as its only restraint. The study
    has moved to exactly that question — who decides when the system talks —
    so the person now has three controls on the recorder:

    - LOCK: only they speak. Their words still reach the context (and the
      summary, the title, recall), but the model is never asked to reply, and
      a reply in progress is cut off where it stands.
    - NORMAL: what there was before. Every turn is the model's to take.
    - POKE: one turn from the agent, now, in either mode — the way you would
      nudge somebody sitting next to you. Under Lock the lock stays on.

    WHY IN THE CONTAINER, NOT THE PROMPT. A lock the model is asked to honour
    is a lock that holds most of the time. This one holds by construction:
    the completion is never started.

    WHERE IT SITS: between the user aggregator and the LLM, because that is the
    one place every turn passes on its way to being generated — the person's
    words (`LLMContextFrame` pushed by the aggregator), an offer's or the answer
    guard's run (an `LLMRunFrame` the aggregator turns into the same frame), and
    a poke, which this pushes itself. Dropping that frame under Lock costs
    nothing: the aggregator has already written their words into the context,
    so the next turn the agent IS given sees all of them. A tool's follow-up is
    the one completion that does not pass here — the assistant aggregator sends
    it UPSTREAM from the end of the pipeline — which is what `FloorUpstream`,
    downstream of the LLM, is for.

    A POKE IS ITS OWN MOMENT (trigger `poke`), never a relabelled user turn: a
    poke is the person handing the agent the floor on purpose, and the study
    needs that apart from their words. When nobody is talking it runs at once.
    When they are mid-sentence it is ARMED and runs when they finish — under
    Lock on the very completion their words would have started, under Normal
    only if the turn their words started declined, because a reply that
    reached the speaker is what the poke asked for. When the agent is already
    speaking it does nothing: it is already talking.

    ALWAYS ANSWERED. A poked completion that declines is refused and re-run by
    `AnswerGuard`, then ends in a fixed line — the same promise the guard makes
    for an answer the agent asked for. See `SilenceGate`.

    A POKE CAN CARRY A SPARK (talkback-21): `{"spark": {"kind": ..., "ordinal":
    n}}`, a question about one subject the person pulled from the recorder.
    It is a poke in every way — the same arming, the same forced re-run, the
    same `poke` trigger — except for what the model is told: `SPARK_NUDGES`
    for that subject instead of `POKE_NUDGE`, and the decision is marked with
    the kind and `s{ordinal}`. The title is looked up here, from the ordinal;
    an ordinal this drive has no subject for is a plain poke.

    The browser sends `floor` ({"floor": "open" | "locked"}) and `poke` as RTVI
    client requests and gets the floor now in force back in the response,
    which is how the toggle on the recorder shows the lock the agent is
    actually under rather than the one that was tapped. Every change is
    written to `floor_event` as the container applied it.
    """

    # A poke that has started but whose completion never reports back — an LLM
    # error travels upstream and the gate never sees an end — is given up on
    # after this, rather than holding a lock open for one turn forever.
    RUN_TIMEOUT_SECS = 30.0
    # How often an armed poke looks to see whether the person has finished.
    ARMED_POLL_SECS = 0.25
    # An armed poke whose turn never produced a completion — a cough the VAD
    # took for speech, words the STT returned nothing for — fires by itself
    # after this much quiet. Longer than the aggregator's own end-of-turn wait,
    # so a real turn always reaches the LLM first and the poke rides on it.
    ARMED_SETTLE_MARGIN_SECS = 1.0
    # And is dropped if they never stop talking for this long.
    ARMED_GIVE_UP_SECS = 90.0

    def __init__(
        self,
        context: LLMContext,
        recorder: "TurnRecorder | None" = None,
        *,
        locked: bool = False,
        subject_title: Callable[[int], str | None] | None = None,
    ):
        super().__init__()
        self._context = context
        self._recorder = recorder
        # What a spark's ordinal names: `TopicTitle.title_for`.
        self._subject_title = subject_title
        # The mode the device remembered, applied before the first word so the
        # opening offer cannot race it. Written as `at_connect` on StartFrame.
        self._locked = locked
        # None, "armed" (waiting for them to finish) or "running".
        self._poke: str | None = None
        # The spark the pending poke carries: (kind, ordinal, title), or None.
        self._spark: tuple[str, int, str] | None = None
        # The person is talking: VAD hears them, or the aggregator's turn is
        # still open. Either one; the aggregator's ends seconds after the VAD's.
        self._vad_speaking = False
        self._user_turn = False
        # The agent's audio is playing, from the output transport's own frames.
        self._bot_speaking = False
        # A completion has been asked for and has not ended.
        self._generating = False
        self._waiter: asyncio.Task | None = None
        self._watchdog: asyncio.Task | None = None

    # -- state the rest of the pipeline reads --------------------------------

    @property
    def locked(self) -> bool:
        return self._locked

    @property
    def floor(self) -> str:
        return "locked" if self._locked else "open"

    def allows_upstream_run(self) -> bool:
        """Whether a completion asked for from downstream (a tool's follow-up)
        may run: always under Normal, and under Lock only inside a poke."""
        return not self._locked or self._poke == "running"

    def note_generating(self, generating: bool) -> None:
        """A completion started or ended, as `FloorUpstream` saw it."""
        self._generating = generating

    @property
    def _user_busy(self) -> bool:
        return self._vad_speaking or self._user_turn

    # -- what SilenceGate reports --------------------------------------------

    def note_outcome(self, outcome: str, *, spoke: bool = False) -> None:
        """What a turn became: "spoke", "declined" or "interrupted".

        Spoken ends any poke — a reply reaching the speaker is what it asked
        for, whoever started the turn. Declined matters only to an ARMED poke
        under Normal: their own turn passed up the moment, so the poke takes it.
        Interrupted before a word came out puts a running poke back to armed:
        they started talking over a reply that had not begun, which is them
        finishing their sentence, not them taking the poke back.
        """
        self._generating = False
        if outcome == "spoke":
            if self._poke is not None:
                logger.info("[floor] the poke was answered")
            self._clear_poke()
        elif outcome == "interrupted":
            if self._poke == "running":
                if spoke:
                    self._clear_poke()
                else:
                    # Back to armed, still carrying its spark.
                    spark = self._spark
                    self._clear_poke()
                    self._spark = spark
                    self._arm()
        elif outcome == "declined":
            if self._poke == "armed" and not self._user_busy and not self._bot_speaking:
                self._run_soon()
            elif self._poke == "running":
                # Only without an answer guard to force it; with one, a declined
                # poke is refused and re-run and this is never called for it.
                self._clear_poke()

    # -- the requests --------------------------------------------------------

    async def _set(self, locked: bool) -> None:
        if locked == self._locked:
            # The browser re-sends its floor after every connect; the same
            # floor again is no change and no row.
            return
        self._locked = locked
        if self._recorder is not None:
            self._recorder.record_floor(self.floor)
        if locked:
            logger.info("[floor] locked — only they speak")
            if self._recorder is not None:
                self._recorder.clear_question()
            # Before the interruption, so the gate reporting it finds no poke
            # to put back.
            self._clear_poke()
            if self._bot_speaking or self._generating:
                # Cut off where it stands. The gate records it the way it
                # records a barge-in, and `floor_event` at the same offset is
                # what tells a lock from a voice.
                await self.broadcast_interruption()
                self._generating = False
        else:
            logger.info("[floor] open — the agent may talk back")
            self._context.add_message({"role": "user", "content": FLOOR_OPEN_NOTE})

    def _resolve_spark(self, spark: tuple[str, int] | None) -> tuple[str, int, str] | None:
        """The spark with its subject's title, or None for a plain poke."""
        if spark is None or self._subject_title is None:
            return None
        kind, ordinal = spark
        title = self._subject_title(ordinal)
        if not title:
            logger.info(f"[floor] a {kind} spark for s{ordinal}, which this drive has not named — a plain poke")
            return None
        return kind, ordinal, title

    async def _poke_request(self, spark: tuple[str, int] | None = None) -> str:
        """Handle a tap on Poke, or on a spark. Returns what became of it, for
        the browser."""
        if self._recorder is not None:
            self._recorder.record_floor("poke")
        if self._bot_speaking:
            logger.info("[floor] poked while speaking — nothing to do")
            return "speaking"
        if self._poke is not None:
            # One poke at a time: a second tap while the first is waiting or
            # running asks for nothing the first is not already getting.
            return self._poke
        self._spark = self._resolve_spark(spark)
        if self._user_busy or self._generating:
            self._arm()
            logger.info("[floor] poked mid-turn — waiting for them to finish")
            return "armed"
        if not self._start():
            return "ended"
        self._push_soon()
        return "fired"

    # -- the poke itself ------------------------------------------------------

    def _start(self) -> bool:
        """Make the moment: the cue, the nudge, the state. False once the drive
        has ended — the same check `Offers` makes where its turn is taken."""
        if self._recorder is not None and self._recorder.session_ended:
            logger.info("[floor] the drive has ended — not poking")
            self._clear_poke()
            return False
        self._cancel(self._waiter)
        self._waiter = None
        if self._spark is not None:
            kind, ordinal, title = self._spark
            if self._recorder is not None:
                self._recorder.note_offer(
                    "poke", subject_key=f"s{ordinal}", spark_kind=kind, spark_subject=title
                )
            nudge = spark_text(SPARK_NUDGES[kind], title)
            logger.info(f"[floor] a {kind} spark for s{ordinal}")
        else:
            if self._recorder is not None:
                self._recorder.note_offer("poke")
            nudge = POKE_NUDGE
        self._context.add_message({"role": "user", "content": nudge})
        self._poke = "running"
        self._generating = True
        self._cancel(self._watchdog)
        self._watchdog = self.create_task(self._give_up_running(), name="floor:watchdog")
        logger.info("[floor] poked — one turn")
        return True

    def _push_soon(self) -> None:
        self.create_task(self.push_frame(LLMContextFrame(context=self._context)), name="floor:poke")

    def _run_soon(self) -> None:
        if self._start():
            self._push_soon()

    def _arm(self) -> None:
        self._poke = "armed"
        self._cancel(self._waiter)
        self._waiter = self.create_task(self._await_quiet(), name="floor:armed")

    async def _await_quiet(self) -> None:
        """Fire an armed poke that nothing else picked up, once they are done.

        Polled rather than event-driven because "done" is the conjunction of
        three things that end in no fixed order — their VAD, their turn, any
        completion in flight — and a quarter-second tick is cheaper to reason
        about than every interleaving of their frames.
        """
        settle = user_turn_stop_timeout_secs() + self.ARMED_SETTLE_MARGIN_SECS
        quiet = waited = 0.0
        while self._poke == "armed" and waited < self.ARMED_GIVE_UP_SECS:
            await asyncio.sleep(self.ARMED_POLL_SECS)
            waited += self.ARMED_POLL_SECS
            if self._user_busy or self._generating or self._bot_speaking:
                quiet = 0.0
                continue
            quiet += self.ARMED_POLL_SECS
            if quiet >= settle:
                self._waiter = None
                if self._start():
                    await self.push_frame(LLMContextFrame(context=self._context))
                return
        if self._poke == "armed":
            logger.info("[floor] they never finished — the poke lapses")
            self._poke = None
            self._spark = None

    async def _give_up_running(self) -> None:
        await asyncio.sleep(self.RUN_TIMEOUT_SECS)
        if self._poke == "running":
            logger.warning("[floor] the poked turn never reported back — giving up on it")
            self._poke = None
            self._spark = None
            self._generating = False

    def _clear_poke(self) -> None:
        self._poke = None
        self._spark = None
        self._cancel(self._waiter)
        self._cancel(self._watchdog)
        self._waiter = self._watchdog = None

    @staticmethod
    def _cancel(task: "asyncio.Task | None") -> None:
        if task is not None and task is not asyncio.current_task():
            task.cancel()

    # -- frame plumbing -------------------------------------------------------

    async def _answer(self, request: RTVIClientMessageFrame, data: dict) -> None:
        await self.push_frame(RTVIServerResponseFrame(client_msg=request, data=data))

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, RTVIClientMessageFrame) and frame.type in ("floor", "poke"):
            data = frame.data if isinstance(frame.data, dict) else {}
            if frame.type == "floor":
                wanted = data.get("floor")
                if wanted in ("open", "locked"):
                    await self._set(wanted == "locked")
                await self._answer(frame, {"floor": self.floor})
            else:
                result = await self._poke_request(parse_spark(data.get("spark")))
                await self._answer(frame, {"poke": result, "floor": self.floor})
            # Consumed: nothing downstream has any use for the request.
            return

        if isinstance(frame, StartFrame):
            if self._recorder is not None:
                self._recorder.record_floor(self.floor, at_connect=True)
        elif isinstance(frame, LLMContextFrame) and direction == FrameDirection.DOWNSTREAM:
            if self._locked and self._poke != "running":
                if self._poke == "armed":
                    # Their turn has ended and asked for a reply; the poke they
                    # tapped while talking takes this completion as its own.
                    if not self._start():
                        return
                else:
                    logger.info("[floor] locked — their words are kept, no reply asked for")
                    return
            self._generating = True
        elif isinstance(frame, VADUserStartedSpeakingFrame):
            self._vad_speaking = True
        elif isinstance(frame, VADUserStoppedSpeakingFrame):
            self._vad_speaking = False
        elif isinstance(frame, UserStartedSpeakingFrame):
            self._user_turn = True
        elif isinstance(frame, UserStoppedSpeakingFrame):
            self._user_turn = False
        elif isinstance(frame, BotStartedSpeakingFrame):
            self._bot_speaking = True
        elif isinstance(frame, BotStoppedSpeakingFrame):
            self._bot_speaking = False
        elif isinstance(frame, ErrorFrame):
            # A completion that failed sends this upstream and never an end, so
            # without it an armed poke would wait on a generation that is gone.
            self._generating = False
            if self._poke == "running":
                self._clear_poke()
        elif isinstance(frame, (EndFrame, CancelFrame)):
            self._clear_poke()

        await self.push_frame(frame, direction)

    async def cleanup(self):
        self._clear_poke()
        await super().cleanup()


class FloorUpstream(FrameProcessor):
    """The second half of the lock, between the LLM and `SilenceGate`.

    A tool's result comes back as an `LLMContextFrame` pushed UPSTREAM by the
    assistant aggregator at the very end of the pipeline, and reaches the LLM
    without passing `Floor`. Board tools are not cancelled by an interruption,
    so without this a card moved just before a Lock would still be announced
    after it. Under Lock the follow-up is dropped — the tool has run and its
    result is in the context; only the sentence about it goes unsaid — unless a
    poke is the turn that called it.

    It is also where `Floor` learns that a completion has ended, since the
    LLM's own frames come out here and never pass back through it.
    """

    def __init__(self, floor: Floor):
        super().__init__()
        self._floor = floor

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)

        if isinstance(frame, LLMContextFrame) and direction == FrameDirection.UPSTREAM:
            if not self._floor.allows_upstream_run():
                logger.info("[floor] locked — a tool's follow-up is not spoken")
                return
            self._floor.note_generating(True)
        elif isinstance(frame, LLMFullResponseStartFrame):
            self._floor.note_generating(True)
        elif isinstance(frame, (LLMFullResponseEndFrame, InterruptionFrame)):
            self._floor.note_generating(False)

        await self.push_frame(frame, direction)


def extract_drafts(reply: str) -> tuple[str, list[dict]]:
    """Split a completion into what is spoken and what is kept.

    Ported from `extractDrafts` in the TypeScript prompt module, with the same
    tolerance: a model that forgets the closing tag has still obviously written
    a draft, so an unterminated block runs to the end of the completion rather
    than being thrown away over seven missing characters.

    Returns (speech, drafts) where each draft is {"title", "text"} plus
    {"revises": handle} when the tag named a draft it replaces, and
    {"topic": name} when it named the topic it belongs to. The key is
    ABSENT on a new draft rather than empty, which is how the write path tells
    "this is new" from "this replaces something" without a sentinel value.
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
        attributes = rest[open_at:open_end]
        title_match = re.search(r'title\s*=\s*"([^"]*)"', attributes)
        title = title_match.group(1).strip() if title_match else ""
        revises_match = re.search(r'revises\s*=\s*"([^"]*)"', attributes)
        revises = revises_match.group(1).strip() if revises_match else ""
        topic_match = re.search(r'topic\s*=\s*"([^"]*)"', attributes)
        topic = topic_match.group(1).strip() if topic_match else ""

        close_at = rest.find(DRAFT_CLOSE, open_end)
        body = rest[open_end + 1 :] if close_at == -1 else rest[open_end + 1 : close_at]
        if body.strip():
            draft = {"title": title, "text": body.strip()}
            # Only when non-empty: `revises=""` is a model filling in the
            # attribute it was shown rather than naming a draft.
            if revises:
                draft["revises"] = revises
            # Which of their topics it is filed on, by name. Same rule: only
            # when named.
            if topic:
                draft["topic"] = topic
            drafts.append(draft)
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

    `opportunity` numbers the MOMENT, and it is here rather than on the
    recorder because a completion is labelled with the cue as it stood when the
    completion started — so a cue that has since moved on must still be able to
    say which moment it was. Pipecat runs inference more than once inside a
    user turn (see the counting rule on `agent_decision` in the schema), and
    without this the log cannot be counted without collapsing rows by hand.
    """

    trigger: str
    subject_key: str | None = None
    at_ms: int | None = None
    opportunity: int = 0
    # A poke that carries a spark: which kind, and the subject's title for the
    # re-run and the fixed last line. The title stays in this process — only
    # `spark_kind` and `subject_key` ("s3") are ever written down.
    spark_kind: str | None = None
    spark_subject: str | None = None


# Unprompted moments: the engine made them, nobody spoke. A turn taken in one
# is a `proactive_prompt`, whatever it says.
OFFER_TRIGGERS = ("opening", "silence_offer", "agenda", "macro_offer")


class Playback:
    """When the speaker actually started and stopped, for ONE spoken turn.

    WHY IT EXISTS. `end_offset_ms` was `len(text) / 14` — about fourteen
    characters a second — because the container never learned when playback
    ended. On the first formative pilot that overstated the agent's measured
    speech by about 8%, and `/sessions/[id]` showed every duration with a `~`
    because it could not honestly do otherwise.

    It can be measured. The output transport pushes `BotStartedSpeakingFrame`
    and `BotStoppedSpeakingFrame` BOTH ways when audio actually starts and
    stops, so `SilenceGate` — upstream of it — sees them without a second
    processor. The catch is that they arrive after `LLMFullResponseEndFrame`,
    which is where a turn is written, so the write waits on this rather than
    moving.

    ONLY A MATCHED PAIR COUNTS. A stop with no start of its own is ignored:
    the keep-alive speaks while the answer is still generating, and one
    continuous speaking run over both would otherwise end the answer's turn at
    the filler's last word. The waiter times out instead and the estimate
    stands, which is the conservative wrong answer rather than the confident
    one.
    """

    def __init__(self):
        self._stopped = asyncio.Event()
        self.started_ms: int | None = None
        self.stopped_ms: int | None = None

    def started(self, at_ms: int) -> None:
        if self.started_ms is None:
            self.started_ms = at_ms

    def stopped(self, at_ms: int) -> None:
        # First stop wins, and only after a start we saw. Both guards are about
        # a later turn's audio landing on a turn already written.
        if self._stopped.is_set() or self.started_ms is None:
            return
        self.stopped_ms = at_ms
        self._stopped.set()

    def abandon(self) -> None:
        """Stop anything waiting. The drive ended, or the driver talked over it."""
        self._stopped.set()

    async def wait(self, timeout: float) -> None:
        try:
            await asyncio.wait_for(self._stopped.wait(), timeout)
        except (TimeoutError, asyncio.TimeoutError):
            # Not an error worth a line: a turn whose audio was merged into a
            # neighbouring one still has an estimate, and the row says which.
            pass


def _now_ms() -> int:
    return int(time.time() * 1000)


def _ends_in_question(said: str) -> bool:
    """Whether a spoken turn ended by asking something.

    Lexical and coarse, like `TurnRecorder._kind`'s test for a confirmation
    ask, and lopsided the same safe way: a missed question costs nothing beyond
    the behaviour that already existed, while a false positive only makes the
    agent try harder to answer the driver's next words. The trailing characters
    stripped are what a model puts after the mark — a closing quote from a
    reply it wrapped, an asterisk — never punctuation of its own.
    """
    return said.strip().rstrip("\"'`*)] ").endswith("?")


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
        # Moments, and where the decisions for the current one have got to.
        # `_attempt` counts completions within a moment rather than being
        # derived from `_decision_seq`, because not every completion writes a
        # decision — a refused decline writes none at all.
        self._opportunity = 0
        self._decided_opportunity: int | None = None
        self._attempt = 0
        self._cue = Cue("user_turn")
        # Set the first time the web app refuses a write because the drive is
        # over. The container has no other way to learn it: Stop on `/record`
        # ends the session over HTTPS, and the WebRTC peer connection closing
        # behind it is an ICE timeout away — tens of seconds, on the pilot 52
        # of them, which is long enough for a silence timer to fire and speak
        # into a room where the recording has stopped.
        self._session_ended = False
        # The invocation the last spoken turn asked about, until the driver's
        # next words are sent as its answer — or a later turn moves on.
        self._awaiting_answer: str | None = None
        # Whether the last turn that actually REACHED THE SPEAKER ended by
        # asking something. Broader than `_awaiting_answer`, which only knows
        # about a parked invocation: this covers a question the model asked in
        # free text, which is most of them, and is what `AnswerGuard` keys on.
        self._asked_question = False
        # The moment `AnswerGuard` had to force, if any. See `note_forced_answer`.
        self._forced_opportunity: int | None = None
        # The same mark for a poke, kept apart from it. See `note_forced_poke`.
        self._forced_poke_opportunity: int | None = None
        # `floor_event.seq`, per connection like the others.
        self._floor_seq = 0
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
            self._cue = Cue("user_turn", None, _now_ms(), self._new_opportunity())

    def note_pending(self, invocation_id: str | None) -> None:
        """The driver's turn carries a parked action to ask about.

        Only a turn the driver started can: the ask arrives with /context,
        which only their words fetch. Keeps the moment's clock — the ask did
        not make the moment, their words did.
        """
        if invocation_id and self._cue.trigger == "user_turn":
            # The SAME moment, relabelled: the ask did not make it, their words
            # did — which is why the clock and the opportunity both carry over.
            self._cue = Cue(
                "confirmation", invocation_id, self._cue.at_ms, self._cue.opportunity
            )

    def note_offer(
        self,
        trigger: str,
        subject_key: str | None = None,
        spark_kind: str | None = None,
        spark_subject: str | None = None,
    ) -> None:
        """The proactive engine is about to run a turn nobody asked for — or a
        poke is, and if it carries a spark, which one and about what."""
        self._cue = Cue(
            trigger,
            subject_key,
            _now_ms(),
            self._new_opportunity(),
            spark_kind=spark_kind,
            spark_subject=spark_subject,
        )

    def _new_opportunity(self) -> int:
        """The next moment the agent is given. See `Cue.opportunity`."""
        self._opportunity += 1
        return self._opportunity

    def cue(self) -> Cue:
        return self._cue

    @property
    def session_ended(self) -> bool:
        """Whether the drive this container is talking into has been stopped.

        Learned from the web app refusing a write, and read by everything that
        would otherwise start a turn. One refusal is enough: `ended_at` is
        never unset, so nothing can put the drive back.
        """
        return self._session_ended

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

    def note_forced_answer(self) -> None:
        """This moment's first completion declined an answer the agent asked for.

        MEASUREMENT ONLY. It changes nothing about what is spoken or when:
        `AnswerGuard` still refuses the decline, the re-run still decides what
        the moment became, and there is still exactly one decision for it. What
        this adds is a mark ON that decision saying the moment needed forcing.

        Without it the guard is invisible in the ledger by construction — the
        refused completion writes nothing, and a re-run that speaks looks
        exactly like a first completion that spoke. The study's
        unanswered-answer count has a target of ZERO, and a number that can
        never be anything else measures nothing. This is what makes it
        countable, and it is why `agent_decision.forced_answer` exists.
        """
        self._forced_opportunity = self._cue.opportunity

    def note_forced_poke(self) -> None:
        """This moment's first completion declined a POKE.

        The twin of `note_forced_answer`, and deliberately not the same mark:
        `forced_answer` feeds the unanswered-answer count, which reads it
        without looking at the trigger and whose target is zero. A poke the
        model would have let pass is a different finding — how often being
        asked to speak finds the agent with nothing to say — and it lands in
        `agent_decision.forced_poke`.
        """
        self._forced_poke_opportunity = self._cue.opportunity

    def clear_question(self) -> None:
        """Forget that the last spoken turn asked them anything.

        Called when they LOCK the agent. Whatever it asked, they have just said
        they are not talking to it: without this, the first words after an
        unlock — five minutes and another subject later — would be taken as
        the answer, and `AnswerGuard` would refuse to let the agent stay quiet
        about a question nobody remembers. The parked ask goes too, so their
        locked monologue is never sent to `/context` as a yes or a no.
        """
        self._asked_question = False
        self._awaiting_answer = None

    def record_floor(self, kind: str, at_connect: bool = False) -> None:
        """Who may talk changed, and the container has applied it.

        `kind` is a `floor_event_kind`: "locked", "open" or "poke". Fire and
        forget like every other write here: the lock holds in this process
        whether or not its row lands, and a tap must never wait on Postgres.
        """
        if not self._ticket or not self._started_at_ms or self._session_ended:
            return
        seq, self._floor_seq = self._floor_seq, self._floor_seq + 1
        payload: dict = {
            "ticket": self._ticket,
            "seq": seq,
            "offsetMs": max(0, _now_ms() - self._started_at_ms),
            "kind": kind,
        }
        if at_connect:
            payload["atConnect"] = True
        if self._config_version:
            payload["configVersion"] = self._config_version

        async def send() -> None:
            try:
                await asyncio.to_thread(self._post, "floor", payload)
            except Exception as err:
                logger.warning(f"[floor] not recorded: {err}")

        asyncio.create_task(send())

    @property
    def awaiting_question_answer(self) -> bool:
        """Whether the driver's next words answer a question the agent asked.

        Read by `SilenceGate`, which refuses to record a decline in this state.
        Not consumed here: the gate may look at it more than once within a
        moment, and it is cleared by the next turn that reaches the speaker
        rather than by being read.
        """
        return self._asked_question

    def record(
        self,
        spoken: str,
        generated: str,
        *,
        started_ms: int | None = None,
        barged_in: bool = False,
        cue: Cue | None = None,
        metrics: dict | None = None,
        playback: "Playback | None" = None,
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

        `metrics` is what the gate saw of this turn's timing: `ttftMs`,
        `promptTokens`, `completionTokens`, `requestedModel`, `resolvedModel`
        and `asrMs`, each only when measured.

        `playback` is the speaker's own account of the turn, and it is not
        ready yet: `BotStoppedSpeakingFrame` arrives after the completion ends.
        The row is composed now — the seq is taken here, so ordering holds —
        and POSTED once playback settles or a bounded wait gives up, whichever
        comes first. `end_offset_ms` is then measured rather than the old
        `len(text) / 14`, and `end_offset_measured` says which it was.
        """
        if not self._ticket or not self._started_at_ms or not spoken.strip():
            return
        # Nothing is written into a drive that has been stopped — not a turn,
        # not a decision. The row would corrupt every count and duration taken
        # from that session, and the web app refuses it anyway; this keeps the
        # container from spending a request per turn finding that out.
        if self._session_ended:
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
            # Measured, and it always was: the interruption is the one moment
            # the container knows for certain that playback stopped. Said on
            # the row rather than left to a reader to infer from `bargedIn`,
            # so the column means one thing everywhere.
            payload["endOffsetMeasured"] = True
        else:
            # Roughly 14 characters a second of speech. Still the FALLBACK, and
            # now marked as one on the row rather than only in a comment: it
            # stands when the transport never reported a matched start and stop
            # for this turn. See `Playback`.
            payload["endOffsetMs"] = offset + int(len(spoken) / 14 * 1000)
            payload["endOffsetMeasured"] = False
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
        for key in (
            "ttftMs",
            "promptTokens",
            "completionTokens",
            "requestedModel",
            # What the proxy answered WITH, which is not what was asked for: an
            # alias resolves, a fallback fires, and only the response says so.
            "resolvedModel",
            # The transcription's own time to first byte. Measured on the STT
            # service's metrics rather than inferred, and by far the largest
            # term in how fast a turn feels (TALKBACK.md → Latency).
            "asrMs",
        ):
            if metrics and metrics.get(key) is not None:
                payload[key] = metrics[key]
        if self._tool_calls:
            payload["toolCalls"], self._tool_calls = self._tool_calls[:8], []

        # Whatever this turn was, it is now the last thing the driver heard.
        # An ask makes their next words its answer; anything else means their
        # next words answer that instead.
        self._awaiting_answer = cue.subject_key if kind == "confirmation_request" else None
        # The same fact, without a parked invocation behind it. Measured on
        # what was SPOKEN rather than on `generatedText`: a question the driver
        # never heard — cut off before its first word, or inside a draft block
        # — is not one they can be answering. This is also how the flag CLEARS:
        # the next turn that reaches the speaker overwrites it, so a turn that
        # answers plainly ends the obligation without anything having to
        # remember to.
        self._asked_question = _ends_in_question(spoken)

        decision = self._decision(cue, "interrupted" if barged_in else "spoke", latency)
        # A barge-in has its end already, measured at the interruption, so it
        # waits for nothing.
        self._send(
            payload,
            decision,
            playback=None if barged_in else playback,
            first_word_ms=started_ms,
        )

    def record_announcement(self, spoken: str, kind: str = "reply") -> None:
        """A sentence spoken for a tool while it runs — "Let me look that up."

        Written to `agent_turn`, because it reached the speaker and the echo
        filter must know that. NOT a decision, and it does not take the tool
        calls pending for the next turn: the model's decision is the completion
        that called the tool and the one that answers from it, and both are
        recorded by the gate as usual. Nor does it settle an ask — it is not an
        answer to anything.

        `kind` tells the announcement from the keep-alive that follows it: the
        announcement is the model's own sentence and reads as a reply, while a
        keep-alive is `backchannel` — this container's words, carrying no
        content, and something the analysis will want to exclude from a turn
        count without having to match on the text.
        """
        if not self._ticket or not self._started_at_ms or not spoken.strip():
            return
        if self._session_ended:
            return
        seq, self._seq = self._seq, self._seq + 1
        now = _now_ms()
        offset = max(0, now - self._started_at_ms)
        payload = {
            "ticket": self._ticket,
            "seq": seq,
            "startOffsetMs": offset,
            "endOffsetMs": offset + int(len(spoken) / 14 * 1000),
            # This path has no `Playback` to wait on — it is spoken from inside
            # a tool handler, nowhere near the gate — so the end is the old
            # estimate, and the row says so rather than looking measured.
            "endOffsetMeasured": False,
            "text": spoken,
            "generatedText": spoken,
            "kind": kind,
        }
        if self._responding_to:
            payload["respondingToText"] = self._responding_to
        if self._config_version:
            payload["configVersion"] = self._config_version
        # The one timing this path really has, and the one that matters most:
        # from the driver's words to the first thing they hear back. It was
        # null on all three announcements of the first pilot, which is why the
        # session's median latency read as the second round trip only.
        latency = self._latency(self._cue, now)
        if latency is not None:
            payload["totalLatencyMs"] = latency
        self._send(payload, None)

    def decline(self, *, interrupted: bool = False, cue: Cue | None = None) -> None:
        """A completion that reached nobody: the model declined, or the driver
        spoke before its first word. Writes a decision and NO turn.
        """
        if not self._ticket or not self._started_at_ms or self._session_ended:
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
        # Attempts within a moment are contiguous in time, so one counter is
        # enough — no bookkeeping that grows with the drive.
        if cue.opportunity == self._decided_opportunity:
            self._attempt += 1
        else:
            self._decided_opportunity = cue.opportunity
            self._attempt = 0
        decision = {
            "ticket": self._ticket,
            "seq": seq,
            "offsetMs": max(0, (cue.at_ms or _now_ms()) - started_at_ms),
            "opportunitySeq": cue.opportunity,
            "attempt": self._attempt,
            "trigger": cue.trigger,
            "outcome": outcome,
        }
        # Whether `AnswerGuard` had to force this moment. See
        # `note_forced_answer`: the refused completion writes nothing, so
        # without a mark here the guard firing leaves no trace at all.
        if self._forced_opportunity is not None and cue.opportunity == self._forced_opportunity:
            decision["forcedAnswer"] = True
            self._forced_opportunity = None
        if (
            self._forced_poke_opportunity is not None
            and cue.opportunity == self._forced_poke_opportunity
        ):
            decision["forcedPoke"] = True
            self._forced_poke_opportunity = None
        if self._config_version:
            decision["configVersion"] = self._config_version
        if latency is not None:
            decision["latencyMs"] = latency
        if cue.subject_key:
            decision["subjectKey"] = cue.subject_key
        if cue.spark_kind:
            decision["sparkKind"] = cue.spark_kind
        return decision

    # How long a turn's row waits for the speaker to finish before it is
    # written with the estimate instead. The spoken part of the turn plus a
    # margin, clamped: a wait that outlived the drive would cost the echo
    # filter a row, which is a far worse failure than an estimated duration.
    PLAYBACK_WAIT_MIN_SECS = 3.0
    PLAYBACK_WAIT_MAX_SECS = 20.0

    def _send(
        self,
        turn: dict | None,
        decision: dict | None,
        playback: "Playback | None" = None,
        first_word_ms: int | None = None,
    ) -> None:
        """Both writes, in ONE task, turn first.

        Sequential on purpose: the decision points at the turn's row, and the
        turn route hands back that id. Two independent tasks would race the
        foreign key; this way a lost turn only costs the decision its pointer.

        `playback` delays the POST until the speaker has finished, so the row
        can carry a measured end. Bounded, and the fallback is the row that
        would have been written anyway.
        """

        async def send() -> None:
            turn_id = None
            if turn is not None and playback is not None:
                spoken_secs = len(turn.get("text") or "") / 14
                await playback.wait(
                    min(
                        self.PLAYBACK_WAIT_MAX_SECS,
                        max(self.PLAYBACK_WAIT_MIN_SECS, spoken_secs + 3.0),
                    )
                )
                if playback.stopped_ms is not None and self._started_at_ms:
                    end = max(turn["startOffsetMs"], playback.stopped_ms - self._started_at_ms)
                    turn["endOffsetMs"] = end
                    turn["endOffsetMeasured"] = True
                if playback.started_ms is not None and first_word_ms is not None:
                    # From the first word released to TTS to the first audible
                    # sample: the part of the wait that happens downstream of
                    # anything the gate can time for itself.
                    turn["speakTtfbMs"] = max(0, playback.started_ms - first_word_ms)
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
        try:
            with urllib.request.urlopen(req, timeout=5) as res:
                raw = res.read()
                return json.loads(raw) if raw else None
        except urllib.error.HTTPError as err:
            # 409 is the web app saying this drive has ended. It is the only
            # signal the container gets: Stop closes the session over HTTPS and
            # the peer connection follows whenever ICE notices, which on the
            # pilot was 52 seconds later. Remembered rather than merely
            # reported, so the NEXT turn is not attempted at all.
            if err.code == 409:
                if not self._session_ended:
                    logger.warning(
                        "[turn] the drive has ended; nothing further will be spoken or recorded"
                    )
                self._session_ended = True
            raise


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


class KeepAlive(FrameProcessor):
    """A word, while a turn the agent has already announced runs long.

    WHAT IT ANSWERS. On the first formative pilot (19 Sep 2026) turns that
    called a tool took a median of 8416ms where turns that did not took 1349,
    and the tool itself never took more than 766. The gap is not the lookup: it
    is the second model round trip, composing the answer once the result is
    back, and through all of it the car is silent. The participant asked for
    exactly this in her debrief, unprompted — a placeholder before a lookup,
    and a periodic one during a long one. The first half already existed
    (`WebSearch` speaks the model's own announcement); this is the second.

    WHAT IT IS KEYED ON. The turn, not the tool call. Stopping when the search
    result came back would fall silent at the precise moment the silence
    starts. So it is armed when a tool announces itself and disarmed by the
    agent actually speaking — an `LLMTextFrame` released by `SilenceGate`,
    which sits directly upstream of this — or by the driver talking over it.

    IT IS SPOKEN, SO IT IS RECORDED. Not optional: the agent's voice reaches
    the microphone and is transcribed like any other sound, and `withoutEcho`
    tells those lines from the driver's by comparing against `agent_turn`. A
    filler that is not in that table comes back as the participant's own words.
    Written as `backchannel`, the kind the schema has carried unused since it
    was written, so a turn count can exclude it without matching on text.

    IT RUNS OUT. Two phrases and then silence, because a system that keeps
    announcing that it is still working is worse than one that is simply quiet
    — and `SEARCH_WAIT_PHRASES` being the limit is what makes that legible.
    """

    # Long enough that an ordinary turn never reaches it (the median without a
    # tool call is 1.3s, and with one the announcement has already been said),
    # short enough to land inside the 8.4s a tool turn actually took.
    AFTER_SECS = 6.0

    def __init__(self, language: str | None = None, recorder: "TurnRecorder | None" = None):
        super().__init__()
        self._language = language
        self._recorder = recorder
        self._task: asyncio.Task | None = None

    def begin(self) -> None:
        """A tool has announced itself. Start counting from now."""
        self.end()
        self._task = self.create_task(self._wait(), name="keepalive:timer")

    def end(self) -> None:
        """The agent spoke, the driver spoke, or the pipeline went down."""
        if self._task is not None:
            self._task.cancel()
            self._task = None

    async def _wait(self) -> None:
        index = 0
        while True:
            await asyncio.sleep(self.AFTER_SECS)
            phrase = search_wait_phrase(self._language, index)
            if phrase is None:
                # The list is the limit. Fall silent rather than nag.
                self._task = None
                return
            index += 1
            logger.info(f"[keepalive] still working after {self.AFTER_SECS:.0f}s — {phrase!r}")
            # `append_to_context=False`, like the announcement it follows: the
            # model did not write this and it says nothing about the
            # conversation, so putting it in the context would only crowd out
            # what did.
            await self.push_frame(TTSSpeakFrame(phrase, append_to_context=False))
            if self._recorder is not None:
                self._recorder.record_announcement(phrase, kind="backchannel")

    async def process_frame(self, frame: Frame, direction: FrameDirection):
        await super().process_frame(frame, direction)
        # Speech from the gate means the wait is over — which is the whole
        # reason this sits downstream of it. An `LLMFullResponseEndFrame` is
        # deliberately NOT a stop: on a tool-calling turn the first completion
        # ends before the tool has even answered, and stopping there would give
        # up exactly when the long part begins.
        if isinstance(frame, (LLMTextFrame, InterruptionFrame, EndFrame, CancelFrame)):
            self.end()
        await self.push_frame(frame, direction)

    async def cleanup(self):
        self.end()
        await super().cleanup()


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
    # Searches one moment may run. The prompt allows one retry with fewer
    # words and then a plain "found nothing", and the model does not keep to
    # it: on 7 Oct 2026 one question ("Through design again.") ran four
    # searches back to back, each announced aloud, and the driver sat through
    # five "I'm searching…" lines in ten seconds. A rule the model can ignore
    # is enforced here, where it cannot.
    MAX_PER_MOMENT = 2
    OVER_LIMIT_ERROR = (
        "Not searched: you have already searched twice for this. Answer from what "
        "those searches returned, or say plainly that they did not find it."
    )

    def __init__(
        self,
        ticket: str | None,
        sound: SearchingSound | None = None,
        recorder: "TurnRecorder | None" = None,
        keepalive: "KeepAlive | None" = None,
    ):
        self._ticket = ticket
        self._sound = sound
        self._recorder = recorder
        self._keepalive = keepalive
        # The moment the searches below were counted in, and how many it has
        # run. Keyed on the recorder's opportunity number, which moves on with
        # the driver's next words or an offer — never with the tool loop.
        self._moment: int | None = None
        self._searches = 0

    @classmethod
    def announcement(cls, arguments: dict) -> str:
        """What to say as the search starts. The model's sentence, or a plain one."""
        said = " ".join(str(arguments.get("announcement") or "").split())
        if said:
            return said[: cls.MAX_ANNOUNCEMENT_CHARS]
        query = " ".join(str(arguments.get("query") or "").split())
        return f"Searching the web for {query}." if query and len(query) <= 60 else "Let me look that up."

    def _over_limit(self) -> bool:
        """Count this search against its moment; True once the moment is spent.

        Without a recorder there is no moment to count in, so nothing is
        limited — the tests that build a bare `WebSearch` rely on that.
        """
        if self._recorder is None:
            return False
        moment = self._recorder.cue().opportunity
        if moment != self._moment:
            self._moment, self._searches = moment, 0
        self._searches += 1
        return self._searches > self.MAX_PER_MOMENT

    async def handle(self, params: FunctionCallParams) -> None:
        started = time.monotonic()
        name = params.function_name
        arguments = dict(params.arguments or {})

        if self._over_limit():
            # Silently, and before anything is spoken: the announcement is the
            # part of a runaway search loop the driver actually hears.
            logger.info(f"[search] declined: over {self.MAX_PER_MOMENT} searches this moment")
            if self._recorder is not None:
                self._recorder.note_tool_call(name, 0, "over the per-moment limit")
            await params.result_callback({"ok": False, "error": self.OVER_LIMIT_ERROR})
            return

        announcement = self.announcement(arguments)
        # Not appended to the context: the model did not generate it as a
        # reply, and the call it came with is already there.
        await params.llm.push_frame(TTSSpeakFrame(announcement, append_to_context=False))
        if self._recorder is not None:
            self._recorder.record_announcement(announcement)
        if self._sound is not None:
            self._sound.begin()
        # From HERE, not from the search returning: what the driver waits
        # through is the whole turn, and most of it is the model composing an
        # answer after the result is already in. `KeepAlive` stops itself when
        # the agent finally speaks.
        if self._keepalive is not None:
            self._keepalive.begin()

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
            # The handle of the draft this replaces, when the model named one.
            # The web app resolves it against THIS drive's drafts and falls open
            # to a new draft if it matches none or more than one, so a
            # hallucinated handle costs a version link and never a draft.
            if draft.get("revises"):
                payload["revises"] = draft["revises"]
            if draft.get("topic"):
                payload["topic"] = draft["topic"]
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
        answers: "AnswerGuard | None" = None,
        stt_name: str | None = None,
        resolved_model: Callable[[], str] | None = None,
        floor: "Floor | None" = None,
    ):
        super().__init__()
        self._summary = summary
        self._title = title
        self._answers = answers
        # Told what each turn became, as the proactive engine is: a poke ends
        # when something reaches the speaker, and waits on through a decline.
        self._floor = floor
        self._recorder = recorder
        self._drafts = drafts
        self._offers = offers
        # Whose metrics are this completion's. Every upstream service's
        # MetricsFrame passes through here — the STT's included — so they are
        # told apart by the processor that measured them.
        self._llm_name = llm_name
        # The STT's, told apart the same way. Its time to first byte is the
        # largest term in how fast a turn feels (TALKBACK.md → Latency) and the
        # `asr_ms` column has been empty since it was written.
        self._stt_name = stt_name
        # What the proxy ANSWERED with. Pipecat keeps it on the service, off
        # `chunk.model`, which is the only place the resolution behind an alias
        # or a fallback is visible; the metrics frame carries the requested
        # name and cannot say. Read at the end of a completion rather than
        # stored, so it is this turn's answer.
        self._resolved_model = resolved_model
        # The STT measures BEFORE a completion starts, so this cannot live in
        # `_turn_metrics`, which `_reset` empties on every LLMFullResponseStart.
        # The most recent transcription is the one that prompted this turn.
        self._asr_ms: int | None = None
        # The speaker's own account of the turn being spoken right now. NOT
        # cleared by `_reset`: the stop frame arrives after the completion ends,
        # and the row waits for it. A new turn's first released word replaces it.
        self._playback: Playback | None = None
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
        # The moment whose reply has already reached the speaker, when that
        # reply did not hand over to a tool. See `_superseded`.
        self._answered_opportunity: int | None = None
        # This completion answers a moment that has already been answered, so
        # nothing of it is released. Pipecat runs inference more than once in
        # one user turn (see the counting rule on `agent_decision`); when the
        # first already had the whole sentence, BOTH spoke — on the 27 Sep 2026
        # drive "and then I come back, then it's suddenly empty" got two replies
        # in a row, the second restating the first. The second dispatch still
        # runs, as the schema requires; it is just not spoken.
        self._superseded = False
        # Whether the completion now running is `AnswerGuard`'s re-run.
        self._is_retry = False
        # The moment whose completion called a tool. An answer acted on with a
        # tool HAS been acted on, so the completion after the tool may be
        # silent: on 14 Oct 2026 the agent added two tasks to the board for a
        # "yes", its follow-up said nothing, and the guard took that for
        # ignoring the answer — "Sorry, I lost that. Say it again." after doing
        # exactly what it was asked. Not cleared by `_reset`, for the reason
        # `_answered_opportunity` is not: the follow-up is a new completion.
        self._acted_opportunity: int | None = None

    def _record_drafts(self, text: str) -> None:
        """Send the drafts in `text` to be kept, and mark them on the turn.

        Marked as tool calls so the turn that wrote a draft can be told from
        one that only said it had: on the 27 Sep 2026 drive two turns wrote
        drafts and seven more claimed to, and the transcript showed all nine
        alike, with no timing next to any of them.
        """
        _, drafts = extract_drafts(text)
        if not drafts:
            return
        self._drafts.record(drafts)
        if self._recorder is not None:
            for draft in drafts:
                self._recorder.note_tool_call(
                    "revise_draft" if draft.get("revises") else "write_draft", 0
                )

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
        self._superseded = False
        self._is_retry = False

    def _note_metrics(self, frame: MetricsFrame) -> None:
        """Keep this turn's timing and token counts.

        Pipecat measures them and pushes them downstream as frames, which
        nothing read: the latency columns on `agent_turn` were always empty.
        The LLM's frames arrive between its response start and end, so the
        reset at start is what keeps one turn's numbers off the next.

        The STT's arrive BEFORE any of that, since transcription is what
        produces the turn in the first place — so its measurement is held
        outside `_turn_metrics` and attached to whatever turn follows it.
        """
        for data in frame.data:
            if self._stt_name and data.processor == self._stt_name:
                if isinstance(data, TTFBMetricsData):
                    # A negative time to first byte is a clock artefact, not a
                    # measurement: "heard in -148ms" was on the transcript
                    # page on 28 Sep 2026. No number beats a wrong one.
                    measured_ms = int(data.value * 1000)
                    self._asr_ms = measured_ms if measured_ms >= 0 else None
                continue
            if self._llm_name and data.processor != self._llm_name:
                continue
            if isinstance(data, TTFBMetricsData):
                self._turn_metrics["ttftMs"] = int(data.value * 1000)
            elif isinstance(data, LLMUsageMetricsData):
                self._turn_metrics["promptTokens"] = data.value.prompt_tokens
                self._turn_metrics["completionTokens"] = data.value.completion_tokens
            if data.model:
                self._turn_metrics["requestedModel"] = data.model

    def _measured(self) -> dict:
        """This turn's numbers, as they stand at the moment it is written."""
        measured = dict(self._turn_metrics)
        if self._asr_ms is not None:
            measured["asrMs"] = self._asr_ms
        if self._resolved_model is not None:
            resolved = self._resolved_model()
            if resolved:
                measured["resolvedModel"] = resolved
        return measured

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
            # A fresh account of the speaker for THIS turn. Anything the last
            # turn's row was still waiting on is now its own business — it
            # holds its own reference and times out on its own.
            self._playback = Playback()
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

        # Whether this frame ends in a re-run rather than a decline. A local,
        # not state: it is decided and acted on within one frame, and `_reset`
        # runs in between.
        retry = False
        # What the re-run is told: the answer guard's nudge, or the poke's.
        retry_nudge: str | None = None

        if isinstance(frame, LLMFullResponseStartFrame):
            self._reset()
            self._in_response = True
            if self._recorder is not None:
                self._cue = self._recorder.cue()
            self._superseded = (
                self._cue is not None
                and self._cue.opportunity > 0
                and self._cue.opportunity == self._answered_opportunity
            )
            self._is_retry = self._answers is not None and self._answers.retry_started
        elif isinstance(frame, MetricsFrame):
            self._note_metrics(frame)
        elif isinstance(frame, (BotStartedSpeakingFrame, BotStoppedSpeakingFrame)):
            # The output transport pushes these BOTH ways when audio actually
            # starts and stops, which is why the measured end needs no
            # processor of its own downstream of the TTS. See `Playback`.
            if self._playback is not None:
                if isinstance(frame, BotStartedSpeakingFrame):
                    self._playback.started(_now_ms())
                else:
                    self._playback.stopped(_now_ms())
        elif isinstance(frame, (EndFrame, CancelFrame)):
            # The drive is going down. Release the row that is waiting on the
            # speaker rather than letting its task die with the estimate
            # unwritten: a lost turn is what blinds the echo filter.
            if self._playback is not None:
                self._playback.abandon()
        elif isinstance(frame, FunctionCallsStartedFrame):
            self._calling_tools = True
            if self._cue is not None:
                self._acted_opportunity = self._cue.opportunity
            # A tool that runs has effects, and its result must be spoken, so a
            # completion that calls one is never the duplicate of anything.
            self._superseded = False
            self._answered_opportunity = None
            logger.info(f"[turn] calling {', '.join(c.function_name for c in frame.function_calls)}")
        elif isinstance(frame, LLMTextFrame):
            self._text += frame.text
            if self._superseded:
                return
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
                        metrics=self._measured(),
                    )
                # Its end is the interruption, measured; nothing waits on the
                # speaker, and nothing may later claim this turn stopped later.
                if self._playback is not None:
                    self._playback.abandon()
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
            if self._floor is not None:
                self._floor.note_outcome("interrupted", spoke=bool(self._spoken.strip()))
            # A draft whose closing tag had already arrived is finished, and the
            # interruption cannot have been about it — its body is never spoken,
            # so the person talking over the reply is the ordinary case while
            # one is written. It used to be dropped with the rest of the text
            # while the model's history said it had been written.
            if self._drafts is not None and DRAFT_CLOSE in self._text and not self._superseded:
                self._record_drafts(self._text[: self._text.rindex(DRAFT_CLOSE) + len(DRAFT_CLOSE)])
            self._reset()
        elif isinstance(frame, LLMFullResponseEndFrame) and self._superseded:
            logger.info(
                f"[turn] already answered this moment, not speaking again: {self._text.strip()!r}"
            )
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
                self._record_drafts(self._text)
            # ONE row per turn, written here because this is the only point that
            # knows the whole reply. A suppressed turn leaves `_spoken` empty and
            # records nothing — the echo filter must only ever learn about audio
            # that actually reached the speaker. An interrupted turn was already
            # written above and `_reset` emptied `_spoken`, so this cannot
            # write it twice.
            #
            # A decline writes its DECISION instead — the silence the agent
            # chose, which used to exist only as the log line above.
            spoke = bool(self._spoken.strip())
            if spoke and not self._calling_tools and self._cue is not None:
                self._answered_opportunity = self._cue.opportunity
            if self._recorder is not None and spoke:
                if self._answers is not None:
                    self._answers.settled()
                self._recorder.record(
                    self._spoken,
                    self._text,
                    started_ms=self._first_spoke_ms,
                    cue=self._cue,
                    metrics=self._measured(),
                    playback=self._playback,
                )
            elif self._recorder is not None and self._in_response and not self._calling_tools:
                if self._answers is not None and self._answers.retrying and not self._is_retry:
                    # Declined while the re-run is still to come — Pipecat's own
                    # second inference for the same words. The re-run decides
                    # what this moment became; this completion decides nothing.
                    logger.info("[answer] declined ahead of the re-run — waiting for it")
                    # Not a decline either, for the proactive engine; asking
                    # again is a no-op while the re-run is pending.
                    retry = True
                elif self._answers is not None and self._is_retry:
                    # The re-run declined as well. Say the fixed sentence rather
                    # than nothing: they answered a question the agent asked, and
                    # a second silence is the failure this guard exists for. It
                    # reaches the speaker, so it is a turn like any other — and
                    # it is the decision this moment produced.
                    self._answers.settled()
                    # A poke is not an answer they gave, so "I lost that" would
                    # be false: it gets its own line, which hands the turn back.
                    # A spark's is its question, fixed, about its subject.
                    spark = (
                        self._cue is not None
                        and self._cue.trigger == "poke"
                        and self._cue.spark_kind is not None
                        and self._cue.spark_subject is not None
                    )
                    if spark:
                        spoken = self._answers.spark_fallback(
                            self._cue.spark_kind, self._cue.spark_subject
                        )
                        # Not the line itself: it carries the subject's title.
                        logger.info(
                            f"[answer] re-run declined too, asking the {self._cue.spark_kind} spark itself"
                        )
                    else:
                        spoken = (
                            self._answers.poke_fallback
                            if self._cue is not None and self._cue.trigger == "poke"
                            else self._answers.acknowledgement
                        )
                        logger.info(f"[answer] re-run declined too, acknowledging: {spoken!r}")
                    # `append_to_context` left at its default, unlike the search
                    # announcement: the model did not write this one, but it
                    # DID say it, and a next turn that cannot see it would
                    # answer as if the driver had been met with silence again.
                    await self.push_frame(TTSSpeakFrame(spoken), direction)
                    # Spoken by the same TTS as any other turn, so its end is
                    # measurable the same way.
                    self._playback = Playback()
                    self._recorder.record(
                        spoken,
                        spoken,
                        started_ms=_now_ms(),
                        cue=self._cue,
                        metrics=self._measured(),
                        playback=self._playback,
                    )
                    spoke = True
                    if self._cue is not None:
                        self._answered_opportunity = self._cue.opportunity
                elif (
                    self._answers is not None
                    and self._cue is not None
                    and self._cue.trigger == "user_turn"
                    and self._recorder.awaiting_question_answer
                    # Already acted on with a tool: see `_acted_opportunity`.
                    and self._cue.opportunity != self._acted_opportunity
                ):
                    # An answer to the agent's own question, declined. Refuse
                    # it: no turn (nothing was spoken) and NO decision either —
                    # their words were one moment to speak, and what that moment
                    # became is decided by the re-run, not by this completion.
                    #
                    # The moment is MARKED, though, or the guard would be
                    # invisible in the ledger and the study's unanswered-answer
                    # count could never be anything but zero.
                    self._recorder.note_forced_answer()
                    retry = True
                elif (
                    self._answers is not None
                    and self._cue is not None
                    and self._cue.trigger == "poke"
                ):
                    # They tapped Poke to hear from the agent, and the model
                    # declined. Refused exactly as a declined answer is — no
                    # turn, no decision, one re-run — because a poke met with
                    # silence is the same failure: they did something and
                    # cannot tell waiting from broken. Marked on its own column
                    # so it never counts as an unanswered answer.
                    self._recorder.note_forced_poke()
                    retry = True
                    retry_nudge = (
                        spark_text(SPARK_RETRY_NUDGE, self._cue.spark_subject)
                        if self._cue.spark_kind and self._cue.spark_subject
                        else POKE_RETRY_NUDGE
                    )
                else:
                    self._recorder.decline(cue=self._cue)
            # The proactive engine needs the same fact the summary does: what
            # the turn BECAME. A spoken turn (including a declined-looking one
            # that released words) sets the awaiting-reply rule; a decline
            # re-arms with backoff. Reported from here for the same reason as
            # `note_agent` — this is the only place that knows.
            # A completion that only called a tool has not finished its turn —
            # the reply comes from the next one — so it neither blocks the
            # engine as a spoken turn nor backs it off as a declined one. Nor
            # has a refused decline: the re-run is still to come, and backing
            # the engine off now would arm an offer over the top of it.
            if (
                self._offers is not None
                and not retry
                and not (self._calling_tools and not spoke)
            ):
                self._offers.note_agent_turn(spoke)
            # The floor needs the same fact, on the same conditions: a refused
            # decline is not an outcome (the re-run is), and a completion that
            # only called a tool has not finished its turn.
            if (
                self._floor is not None
                and not retry
                and not (self._calling_tools and not spoke)
            ):
                self._floor.note_outcome("spoke" if spoke else "declined")
            self._reset()

        await self.push_frame(frame, direction)

        # AFTER the declined completion has gone downstream, so the assistant
        # aggregator at the end of the pipeline has closed this turn before the
        # next one starts behind it. `AnswerGuard` adds its own beat on top.
        if retry and self._answers is not None:
            if retry_nudge is not None:
                self._answers.request_retry(retry_nudge)
            else:
                self._answers.request_retry()


def build_pipeline(
    connection: SmallWebRTCConnection,
    ticket: str | None = None,
    session: dict | None = None,
    capture_session_id: str | None = None,
    *,
    locked: bool = False,
    titles: list | None = None,
) -> PipelineWorker:
    """Assemble one drive's pipeline.

    `locked` and `titles` come from the browser with the offer: the floor it
    remembers, applied before the first word, and the sections it already has,
    so a reconnect files a returning subject where it was. See `Floor`,
    `TopicTitle`.

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
    #
    # `ttsVoiceId` over `voiceId`: on a drive pinned to a language the catalogue
    # has a native speaker for, the session swaps that speaker in (`voiceFor`
    # in voice.ts). Absent from an older web deploy, which means the choice.
    voice = session.get("ttsVoiceId") or session.get("voiceId") or FALLBACK_VOICE_ID
    # WHICH LANGUAGE it is speaking. Unset, ElevenLabs guesses from the text and
    # speaks it with the voice's own (English) accent. Only the *_v2_5 models
    # accept a language_code; Pipecat warns and drops it for any other.
    tts_language = session.get("ttsLanguage")
    logger.info(
        f"[tts] voice {voice}{'' if session.get('voiceId') else ' (fallback)'}"
        f", language {tts_language or 'auto (follows STT)'}"
    )

    tts = ElevenLabsTTSService(
        api_key=os.environ["ELEVENLABS_API_KEY"],
        settings=ElevenLabsTTSService.Settings(
            voice=voice,
            model=os.getenv("ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5"),
            language=Language(tts_language) if tts_language else None,
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
    # Both sides of the conversation, for the recorder's panels: their words
    # from the title processor, which already sees every transcript, and what
    # reached the speaker from `AgentFeed`. One numbering for both.
    feed = TurnFeed()
    title = TopicTitle(
        session.get("titlePrompt"),
        metadata=litellm_metadata("talkback.title", session, capture_session_id),
        ticket=ticket,
        feed=feed,
        titles=titles,
        started_at_ms=session.get("startedAtEpochMs"),
        settled_prompt=session.get("settledPrompt"),
    )
    # Offsets are measured against the drive's own start, the same clock
    # `utterance` uses — which is what lets the two tables be read as one
    # dialogue, and what the echo filter compares intervals against.
    recorder = TurnRecorder(
        ticket, session.get("startedAtEpochMs"), session.get("configVersion")
    )
    # Who may talk. Built before the engine, which must not offer a turn into a
    # Lock. See `Floor`.
    floor = Floor(context, recorder, locked=locked, subject_title=title.title_for)
    # Says something while a turn that has already announced itself runs long.
    # Its own processor because it needs a position in the pipeline (it speaks)
    # and a task to count on; it sits between the gate and the TTS, so the
    # gate's first released word disarms it on the way past.
    keepalive = KeepAlive(phrase_language(session), recorder)
    if tools:
        board_tools = BoardTools(ticket, recorder)
        web_search = WebSearch(ticket, searching_sound, recorder, keepalive)
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
            # Words start a turn, not sound: see `interrupt_min_words`. The
            # stop side keeps the default turn analyzer.
            user_turn_strategies=UserTurnStrategies(
                start=[MinWordsUserTurnStartStrategy(min_words=interrupt_min_words())],
            ),
        ),
    )

    # The proactive engine. After Recall so it can ask it to materialise the
    # context block, and before the user aggregator so the `LLMRunFrame` it
    # pushes to run an unprompted turn flows into the aggregator's own run
    # path — the same one a normal turn takes.
    recall = Recall(context, summary, ticket, recorder, drafts)
    offers = Offers(context, recall, session, recorder, floor)
    # Not conditional on anything: a declined answer to the agent's own
    # question is a defect in every study arm. Sits next to `Offers` because it
    # re-runs a turn by the same route — a message on the context and an
    # LLMRunFrame from upstream of the user aggregator.
    answers = AnswerGuard(context, session)

    def _phrases_follow(language: str) -> None:
        if language in ANSWER_ACKNOWLEDGEMENTS:
            answers._language = language
            keepalive._language = language

    language_follower = LanguageFollower(
        tts,
        chosen_voice=voice,
        native_voices=session.get("nativeVoices"),
        # A pinned drive already told TTS at connect; nothing to follow.
        pinned=bool(tts_language),
        on_change=[_phrases_follow],
    )
    logger.info(f"[study] condition {session.get('studyCondition') or 'none (degraded)'}")

    pipeline = Pipeline(
        [
            transport.input(),
            vad,
            Trace("in"),
            stt,
            # Before the trace, so the log shows the tag the model will see.
            SpeakerTagger(),
            # Before anything that speaks, so a language switch reaches TTS
            # before the reply to the words that caused it.
            language_follower,
            Trace("stt"),
            # Before Recall: the summary must see this turn's speech, and Recall
            # reads the summary when it composes the block.
            summary,
            # After the summary and before Recall: both read the same
            # transcription frame, and neither waits on the other.
            title,
            recall,
            offers,
            answers,
            # Last before the aggregator, so only the model sees the marks.
            PauseMarker(feed),
            aggregator.user(),
            # Between the aggregator and the LLM: every turn passes here on its
            # way to being generated, and under Lock none is.
            floor,
            llm,
            # The lock's other half: a tool's follow-up comes back upstream from
            # the end of the pipeline and never passes `floor`.
            FloorUpstream(floor),
            # Between the LLM and TTS deliberately: the aggregator downstream
            # still records what the model generated, so a declined turn is
            # visible in the context as a turn that happened, while never
            # reaching the speaker.
            SilenceGate(
                summary,
                recorder,
                drafts,
                offers,
                llm_name=llm.name,
                title=title,
                answers=answers,
                stt_name=stt.name,
                # Not `MODEL_CONVERSE`: Pipecat keeps what the proxy actually
                # answered with off `chunk.model`, and an alias or a fallback
                # makes the two differ. Read per turn, at the end of it.
                resolved_model=llm.get_full_model_name,
                floor=floor,
            ),
            keepalive,
            # After everything that decides what is said, before the voice that
            # says it: exactly what reaches the speaker, on its way to the panel.
            AgentFeed(feed),
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
        additional_span_attributes=drive_span_attributes(session, capture_session_id),
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


def log_candidates(label: str, answer: dict) -> None:
    """Say what path this container is actually offering the browser.

    The single most useful line in the log when a call goes silent, and it was
    missing for the whole of the drive that motivated it. Without it a failed
    call leaves only "Timeout establishing the connection to the remote peer",
    which is a symptom shared by every possible cause, and the remote
    candidates — which say what the PHONE could offer and nothing about this
    side.

    Read it as: `host` only means no STUN answered and nothing outside this
    host's network can reach it; `srflx` means STUN worked and a direct path is
    possible where NAT allows one; `relay` means coturn issued an allocation and
    the call will work even from a mobile carrier. No `relay` line when TURN_URLS
    is set means the credential was rejected or UDP to coturn is blocked, and
    the next mobile drive will be silent.
    """
    kinds: dict[str, int] = {}
    for line in (answer.get("sdp") or "").splitlines():
        if not line.startswith("a=candidate:"):
            continue
        # "a=candidate:<foundation> <component> <proto> <priority> <ip> <port> typ <type> ..."
        fields = line.split()
        if "typ" not in fields:
            continue
        kind = fields[fields.index("typ") + 1]
        kinds[kind] = kinds.get(kind, 0) + 1

    logger.info(
        "[ice] %s candidates: %s",
        label,
        ", ".join(f"{k}={n}" for k, n in sorted(kinds.items())) or "NONE",
    )
    if "relay" not in kinds and TURN_URLS:
        logger.warning(
            "[ice] TURN is configured but no relay candidate was gathered — "
            "check the coturn credential and that UDP to %s is open. "
            "Calls from a mobile network will time out.",
            ", ".join(TURN_URLS),
        )


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
        answer = connection.get_answer()
        log_candidates("answer (renegotiated)", answer)
        return answer

    if len(connections) >= MAX_CONNECTIONS:
        logger.warning("refusing offer: %d connections already open", len(connections))
        return JSONResponse({"error": "server busy"}, status_code=503)

    connection = SmallWebRTCConnection(ice_servers=ice_servers())
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
    # The floor the device remembers, and the sections the screen already has.
    # Display state, so unauthenticated is fine — bounded, because this route
    # is public and a list is a list someone could make long.
    locked = request_data.get("floor") == "locked"
    # Bare titles from an older web app, `{title, ordinal}` from a newer one.
    # Checked by `parse_seeded_titles` in `TopicTitle`.
    titles = request_data.get("titles") if isinstance(request_data.get("titles"), list) else None

    # Once per connection, not per turn. Off the event loop because it makes a
    # blocking HTTP call that itself waits on a model call for the seed summary,
    # and stalling the loop here would stall every other drive on this container.
    session = await asyncio.to_thread(fetch_session, ticket)

    worker = build_pipeline(
        connection, ticket, session, capture_session_id, locked=locked, titles=titles
    )

    async def run():
        await WorkerRunner(handle_sigint=False).run(worker)

    background_tasks.add_task(run)

    answer = connection.get_answer()
    log_candidates("answer", answer)
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
