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
  TTS         ElevenLabs over its streaming websocket.
  summary     A rolling summary of the drive, folded in the background off the
              live STT stream — see `RunningSummary` for why it lives here and
              not in the ledger.

WHAT IS FETCHED, NOT DUPLICATED
  /api/realtime/session   the system prompt, the summary instruction, a seed
                          summary for reconnects, and the drive's start time.
                          Once per connection.
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


# The base prompt, used ONLY when /api/realtime/session cannot be reached.
#
# Deliberately not a copy of the real one. A silent partial copy that drifts is
# worse than an obviously degraded stand-in: this one announces itself, so a
# transcript recorded under it is still distinguishable months later when
# somebody is trying to work out why a drive reads oddly.
FALLBACK_SYSTEM_PROMPT = """You are a quiet companion riding along while someone drives and thinks aloud.

You are running in a DEGRADED mode: the service that supplies your instructions and your memory could not be reached, so you have no access to anything they have said before.

Answer direct questions briefly, in one sentence, under 25 words. Otherwise reply with exactly: <silence>

Never claim to remember anything. You cannot check the transcript right now, and saying otherwise would invent their own past back at them."""


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

        return AssemblyAISTTService(api_key=os.environ["ASSEMBLYAI_API_KEY"])

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

    def __init__(self, summary_prompt: str, seed: str | None):
        super().__init__()
        self._prompt = summary_prompt
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
    ):
        super().__init__()
        self._recorder = recorder
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

            passages: list[dict] = []
            pending: dict | None = None
            if self._ticket:
                try:
                    passages, pending = await asyncio.to_thread(self._fetch, frame.text)
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
    ):
        super().__init__()
        self._summary = summary
        self._recorder = recorder
        self._text = ""
        self._spoken = ""
        self._holding = True

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
        elif isinstance(frame, LLMTextFrame):
            self._text += frame.text
            if self._holding:
                if self._could_become_sentinel(self._text):
                    # Still might be a decline — say nothing yet.
                    return
                # It cannot be. Release everything held so far as one frame and
                # stream normally from here.
                self._holding = False
                released = clean_reply(self._text)
                if released:
                    self._spoke(released)
                    await self.push_frame(LLMTextFrame(text=released), direction)
                return
            # Already streaming. Strip any sentinel the model tacked on mid-reply
            # — small models emit one alongside a real sentence often enough that
            # `clean_reply` was written for it.
            tail = frame.text.replace(SILENCE_TOKEN, "")
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
                    remainder = clean_reply(self._text)
                    if remainder:
                        self._spoke(remainder)
                        await self.push_frame(LLMTextFrame(text=remainder), direction)
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
) -> PipelineWorker:
    """Assemble one drive's pipeline.

    `session` is the bootstrap from `/api/realtime/session` — the prompt, the
    summary instruction and any seed summary. Fetched once by the caller rather
    than here so a renegotiation does not pay for it again.
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
    )
    # Offsets are measured against the drive's own start, the same clock
    # `utterance` uses — which is what lets the two tables be read as one
    # dialogue, and what the echo filter compares intervals against.
    recorder = TurnRecorder(ticket, session.get("startedAtEpochMs"))
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
            # Before Recall: the summary must see this turn's speech, and Recall
            # reads the summary when it composes the block.
            summary,
            Recall(context, summary, ticket, recorder),
            aggregator.user(),
            llm,
            # Between the LLM and TTS deliberately: the aggregator downstream
            # still records what the model generated, so a declined turn is
            # visible in the context as a turn that happened, while never
            # reaching the speaker.
            SilenceGate(summary, recorder),
            tts,
            transport.output(),
            aggregator.assistant(),
        ]
    )

    # PipelineWorker, not the PipelineTask/PipelineRunner pair — those are
    # deprecated since 1.3.0 and removed in 2.0.0. Metrics stay on: they are the
    # only per-stage timing this path has, and silence is its hardest failure.
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
    ticket = (request.get("requestData") or {}).get("ticket")

    # Once per connection, not per turn. Off the event loop because it makes a
    # blocking HTTP call that itself waits on a model call for the seed summary,
    # and stalling the loop here would stall every other drive on this container.
    session = await asyncio.to_thread(fetch_session, ticket)

    worker = build_pipeline(connection, ticket, session)

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
