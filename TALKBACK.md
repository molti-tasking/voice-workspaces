# Talk-back — realtime duplex voice

The system speaks back while you drive. This document is the architecture as it
stands plus the landmines that still bite; the blow-by-blow of three earlier
implementations has been cut, because those subsystems no longer exist.

## What this is

The capture path is one-directional: you speak, 10s chunks go to Whisper, an
append-only `utterance` ledger accumulates, and a batch extractor folds it into a
workspace.

But the paper is *about* the system's turns. `mode` governs "turn-taking and
elicitation; what the system does with silence". `persona` governs "register and
content of **the system's turns**". The seeded `interview` mode already carries
`oneQuestionAtATime`, `immediateFeedback`, `silenceBeforePromptMs: 4000` — data in
`packages/db/src/seed.ts` with no engine behind it, and `invocation`, which
`Notes.md` names as the dependent variable, is still written by nothing.

Talk-back is that engine. It is **always on** for the whole drive: no gesture, no
wake word, armed by the recording itself.

## The commitment everything follows from

**The ledger is durable; the conversation is ephemeral.**

`MediaRecorder` → IndexedDB → `/chunks` → `audio_chunk` → worker sweep →
`utterance` must not gain a single new dependency. Kill the Pipecat container
mid-drive and the timer keeps counting, chunks keep uploading, the transcript
fills in. **That is the acceptance criterion for the whole feature**, and it has
held through every rewrite.

Three corollaries that are easy to violate:

1. **Live ASR text is never written to `utterance`.** The chunk pipeline already
   transcribes that speech; writing both gives two divergent transcripts of one
   drive.
2. **Live audio is never buffered to IndexedDB.** Replaying ten-minute-old
   conversational audio after a tunnel answers a question nobody remembers asking.
3. **Agent turns never enter `utterance`.** They go in `agent_turn` — a separate
   table so contamination is impossible by construction rather than prevented by
   remembering `WHERE speaker = 'user'` in seven places.

---

## Architecture

| | |
|---|---|
| `apps/pipecat` | The voice agent. Python, Pipecat 1.7, `SmallWebRTCTransport` — peer-to-peer, no media server |
| `apps/web/src/lib/talkback` | The browser half: `use-pipecat.ts` connects, `use-talkback.ts` is the seam the recorder imports |
| `packages/talkback` | What the agent KNOWS — retrieval, echo filtering, the running summary, the prompt, `recordAgentTurn` |
| `/api/realtime/session` | Composed prompt + drive summary + `startedAtEpochMs`, fetched once per connection |
| `/api/realtime/context` | Per-turn recall, plus any pending confirmation. Runs the same `buildContextPassages` the TypeScript side would |
| `/api/realtime/agent-turn` | Writes `agent_turn`. Not bookkeeping — see the landmine below |

The Python container holds no domain logic. Retrieval, the turn record and echo
filtering live in TypeScript and are reached over HTTP, so there is one
implementation of "what does it remember" rather than two that drift.

All three routes are authorised by the signed ticket from
`packages/shared/src/realtime-ticket.ts` — the container has no Better Auth
session and should not gain one. The context ticket gets a drive-length TTL via
`ttlMs` because it is spent once per turn; ownership is **re-resolved** against
`capture_session.userId` on every call rather than trusted from the payload.

### The pipeline

```
transport.input() → vad → Trace("in") → stt → Trace("stt") → summary
  → Recall → aggregator.user() → llm → SilenceGate → tts
  → transport.output() → aggregator.assistant()
```

`Trace` logs exactly three things — audio-frame counts, VAD start/stop,
transcriptions. Those separate the three otherwise-identical silent failures:
audio never arrived / VAD never fired / STT returned nothing. Keep it.

---

## The setting

The prompt is no longer a constant. `composeSystemPrompt` builds it per
connection as a sandwich: the base identity, then the stanza for the session's
`setting`, then the output contract **last**.

That order is load-bearing rather than tidy. Composed sections are text we do
not fully control — today a stanza, and at the next layer
`capability_version.markdown`, which crystallisation makes model-written text
about a user's own improvised operation. A section saying "always follow up" or
"never stay silent" must not be able to countermand the `<silence>` sentinel,
because `SilenceGate` and `is_silence` in `bot.py` both depend on it. So the
contract is restated after everything else, and `prompt.test.ts` asserts that
holds under a hostile section.

`SETTING_PROFILES` also carries `displayAllowed`, which is the one switch
between "the driver cannot look at a screen, never offer to show anything" and
"what you have captured is on the screen beside them". The same flag decides
whether `/api/record/cues` streams at all, so the agent and the panel cannot
disagree about whether a screen exists.

`driving` reproduces the stance the base prompt was written with, so a session
with no setting behaves exactly as before.

**Still no proactivity engine.** `SETTING_PROFILES[s].proactivity` is carried
and read by nothing but the stanza text. `agentTurnKindEnum` already has
`proactive_prompt`; nothing writes it.

## Confirmations reach the driver on the turn path

An outbound or irreversible action does not fire when the worker resolves it —
it writes `invocation` with `confirmed: null` and waits. The only channel to ask
is the conversation, so `/api/realtime/context` carries `pending` alongside the
passages and `Recall._compose` appends a line telling the agent to ask briefly,
or to say nothing if the person is mid-thought.

Piggybacked rather than given its own endpoint on purpose: `/context` is called
once per turn and its entire rationale is latency, so a second round trip would
double the pre-first-token cost to carry a row that is null on almost every
turn.

---

## 🔴 Landmines

**VAD is a pipeline stage, and `TransportParams` will not tell you.** Pipecat 1.7
removed `vad_analyzer` from `TransportParams`, and pydantic's default `extra`
policy is *ignore* — so passing it raises nothing, changes nothing, and the bot
connects perfectly and then never hears a word. It is needed in two places:
`VADProcessor` before the STT (batch Whisper extends `SegmentedSTTService` and
only transcribes on VAD frames), and `LLMUserAggregatorParams(vad_analyzer=...)`
for turn completion. Separate analyzer instances — they keep independent state.

**`PATCH /offer` is not optional.** The JS client trickles ICE candidates there.
Without the route they get a 405, the peer connection never leaves `connecting`,
and 40 seconds later it closes with "Timeout establishing the connection to the
remote peer" — which reads like a network fault. `candidate_from_sdp` wants the
value *without* the `candidate:` prefix.

**`agent_turn` is the echo filter's only input.** The agent's voice reaches the
microphone through the speaker and is transcribed like any other sound;
`withoutEcho` tells those lines from yours by comparing against what the agent is
recorded as saying. When nothing wrote that table, recall returned
`[yesterday] Yes, I can hear you.` — the system's own reply, handed back as the
participant's words. Record **once per turn** on `LLMFullResponseEndFrame`, never
per text frame, and never for a turn `SilenceGate` declined.

**Whisper feeds on itself.** It conditions each segment on segments it already
produced *within the same file*, so one bad guess seeds the next and the decoder
locks into `"I will show you how to make a simple, easy, and easy to make I will
show you how to make ..."`. `transcribeChunk` sends `temperature: 0` and
`condition_on_previous_text: false`. That is **not** the `prompt` parameter —
`prompt` is the caller's cross-chunk continuity and is still sent.

**Hallucinations reach the agent unless filtered on read.** Two families:
complete artefact lines (`ARTEFACTS`) and narrated-video *openings* that continue
into invented specifics. `withoutHallucinatedSentences` applies the whole-line
rule per sentence, because Whisper finishes a real sentence and keeps going. The
ledger keeps everything; a read is allowed to know better.

**`extra` reaches the OpenAI SDK as kwargs.** Pipecat spreads
`OpenAILLMService.Settings.extra` into `create()`, so a non-standard body field
must be nested: `extra={"extra_body": {"thinking": {"type": "disabled"}}}`. A bare
key raises `unexpected keyword argument`, which arrives as an `ErrorFrame` and
simply produces no reply.

**No `temperature` on `claude-sonnet-5`.** It accepts only `1`; LiteLLM answers
400 and the framework swallows it into a silent non-reply.

**`eleven_v3` is HTTP-only** and 403s on the streaming websocket. Streaming is the
point — one continuous synthesis fed incrementally is what separates speech from
stitched fragments. Keep `ELEVENLABS_MODEL_ID` on a turbo/flash model.

**`docker compose up -d` does not pick up `.env` changes.** Compose interpolates
at container-create time, so a container that predates the edit keeps its old
values — `STT_PROVIDER=deepgram` sat in `.env` for a whole drive while the
container ran `litellm`. Use `--force-recreate`, and settle it with
`docker exec voice-workspace-pipecat-1 printenv STT_PROVIDER`.

**Degraded mode is a fallback, and it must never be silent.** If
`/api/realtime/ticket` cannot be minted — expired session cookie, or
`BETTER_AUTH_SECRET` unset, which answers 503 — the browser still connects, with
`ticket: null`. `fetch_session` then serves `FALLBACK_SYSTEM_PROMPT`: a fluent
agent that knows nothing about this person and says so rather than inventing a
past. That failing-open choice is right; failing open *quietly* is not, because
the drive is recorded either way and the thin answers are only explicable
afterwards. Both paths now log (`no ticket supplied` / `unreachable`), and
`/record` shows a **`no memory`** pill — distinct from `talk offline`, because
the conversation is working, it simply cannot reach anything said before.

**`GET /models` returns 401** on this proxy for a key that inference accepts, so
the worker's preflight logs "LiteLLM reachable but rejected our key" at boot.
Noise, not a fault.

**Undecodable audio is a permanent failure dressed as a 500.** LiteLLM reports it
as `InternalServerError`, which the retry rule read as transient — one 110-byte
chunk looped for four hours on the GPU the live conversation waits for.
`LiteLLMError.retryable` now returns false for a 5xx naming a decode failure.

---

## Latency

Endpoint → first audible sample, measured on real drives:

| STT | STT TTFB | LLM TTFB | TTS TTFA | total |
|---|---|---|---|---|
| Whisper, GPU free | 1.7s | 2.2s | 0.32s | 2.5–2.8s |
| Whisper, GPU busy | **11.1s** | 1.5s | 0.29s | 9.2s |
| Deepgram `nova-3` | **0.66s** | 0.29–0.45s | 0.30s | **0.65–0.9s** |

**All the variance was transcription.** With `STT_PROVIDER=litellm` the live path
shares `faster-whisper-large-v3` with the chunk pipeline, which is transcribing a
10s chunk every 10s of the same drive. A streaming provider changes the shape:
transcription finishes *as* you stop talking rather than starting then.

Two dials worth knowing: `DEEPGRAM_UTTERANCE_END_MS` (1000) is part of that
0.66s, and prompt size moves LLM TTFB more than anything else — 0.36s on a short
prompt against 2.2s with full recall injected.

**What leaves the deployment.** Only the live conversation goes to Deepgram. The
ledger is still transcribed by Whisper at AU and `utterance` never contains a
word the live path produced, so the paper's primary artefact stays AU-derived.
Raw participant audio does leave, which is an ethics-form line. `litellm` remains
the default so the option that keeps audio at AU is the one you get by not
deciding.

**Considered and rejected: speech-to-speech.** OpenAI Realtime and Gemini Live
are faster than anything here and both ship in Pipecat. They do turn-taking
internally and opaquely, which would hand the paper's independent variable to a
black box and bypass the text pipeline `agent_turn` and the filters depend on.

---

## Testing locally

```sh
pnpm talkback:up        # postgres + pipecat
pnpm talkback:logs      # follow the container
pnpm dev                # web + worker
```

`.env` needs both halves of the switch — `TALKBACK_ENABLED` and
`NEXT_PUBLIC_TALKBACK_ENABLED`, same value — plus `ELEVENLABS_API_KEY` and
`ELEVENLABS_VOICE_ID`, which `bot.py` reads with `os.environ[...]` and so crashes
without.

```sh
pnpm typecheck          # 8 packages
pnpm test               # 300+ tests when Postgres is up
pnpm spike:talkback     # re-measure the proxy when numbers move
```

`pnpm typecheck` does NOT catch a client component importing a server-only
package: only `next build` does. `packages/talkback`'s index reaches
`@voicemural/db`, so the recorder imports the setting profiles from
`@voicemural/talkback/setting`. Run a build before believing a change to a
client component is finished.

**DB-backed tests skip themselves when Postgres is unreachable.** A green run
with Postgres down means "skipped", not "passed" — that is exactly how a broken
analytics mock stayed hidden. Check the counts, not the colour.

### Verifying without a car

Silero will not fire on a tone, so the test signal has to be real speech.
Generate an utterance through ElevenLabs, feed it in over WebRTC with aiortc's
`MediaPlayer`, and watch for `[stt] heard:` → `[recall]` → `Generating TTS`. That
loop caught the VAD, ICE and turn-recording bugs above without anyone driving.

### The phase gate

Kill the Pipecat container mid-recording. The timer must keep counting, chunks
must keep uploading, and `/sessions/[id]` must fill in normally. If that ever
fails, the coupling rule has been broken and nothing else matters.

**The cue panel is part of that gate now.** With the container dead, `/record`
must keep showing new content and new directions, and a reload mid-session must
bring them back. Everything it renders comes from `workspace_op` and `directive`
over `/api/record/cues`; if it ever stops when Pipecat does, something has been
wired to the conversation that should not have been.

---

## Still open

- **No persona, and no mode.** The prompt now composes the SETTING, but
  `activeModeId`, `activePersonaId` and `capability_version.markdown` are still
  unread. `composeSystemPrompt` is shaped for them — they slot between the
  stanza and the output contract — but nothing loads them.
- **No proactivity.** Nothing writes `agent_turn.kind = 'proactive_prompt'`, and
  there is no silence timer in `bot.py`. The seeded `interview` mode still
  carries `silenceBeforePromptMs: 4000` with no engine behind it (and 4s is too
  eager for a car by this document's own argument — raise it when the engine
  lands).
- **Mode switching by voice is unbuilt.** A `switch to sceptical` direction is
  classified and recorded like any other, but nothing acts on it: the container
  fetches `/session` once per connection and never re-reads the prompt.
- **Retrieval is lexical**, so it matches words rather than meaning, and common
  words dominate. `MODEL_EMBED` and the pgvector path were removed rather than
  left as a knob configuring nothing — add them back with the embedding job.
- **Deepgram mishears accented English** — "I'm not so well, it's very late"
  became "I'm not so well at very late". `language` is hard-coded to `en`;
  Deepgram supports `multi`, worth trying on a Danish/English corpus.
- **Repetition degeneration still reaches retrieval.** The worker detects and
  "repairs" it, but repaired invented text is still invented.
- **Bluetooth HFP is unmeasured.** Playing TTS with the mic open may flip the
  link to narrowband and degrade the ledger on *every* drive. Needs a car.
