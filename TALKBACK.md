# Talk-back — realtime duplex voice

Working notes for the feature that lets VoiceMural speak back. Written to be
picked up cold. Last updated 2026-08-18.

> **Talk-back now runs on LiveKit Agents.** A hand-rolled WebSocket service, two
> AudioWorklets, an energy VAD, a barge-in guard and a TTS chunker were deleted
> in favour of it. Everything below about MODELS, RETRIEVAL, THE LEDGER and the
> PROMPT still applies; anything describing worklets, `apps/realtime`, PCM
> framing or barge-in thresholds is history, kept because the failures are worth
> not repeating.

The full design lives at `~/.claude/plans/we-want-the-system-buzzing-seal.md`.
This file is the state of play: what is decided, what is measured, what is
built, and what to do next.

---

## What this is

Today the system is one-directional: the user speaks while driving, 10s chunks
go to Whisper, an append-only `utterance` ledger accumulates, and a batch
extractor folds it into a workspace. The system never speaks.

But the paper is *about* the system's turns. `mode` governs "turn-taking and
elicitation; what the system does with silence". `persona` governs "register and
content of **the system's turns**". The seeded `interview` mode already carries
`oneQuestionAtATime`, `immediateFeedback`, `silenceBeforePromptMs: 4000`. All of
it is data in `packages/db/src/seed.ts` with no engine behind it, and the
`invocation` table — which `Notes.md` names as the dependent variable — is
written by nothing.

We are building that engine.

## Decisions (locked — do not re-open)

| | |
|---|---|
| Latency model | Realtime duplex, LiteLLM Whisper + perceptual measures |
| GPU | Separate `MODEL_TRANSCRIBE_LIVE` role |
| Entry | **Always on** — arms with the recording, no gesture, no wake word |
| TTS | LiteLLM `/audio/speech`, self-hosted Piper |
| Surface | Inside `/record`, eyes-free |
| Tools | Corpus search + repertoire capabilities + web search |

## The commitment everything follows from

**The ledger is durable; the conversation is ephemeral.**

The capture path — `MediaRecorder` → IndexedDB → `/chunks` → `audio_chunk` →
worker sweep → `utterance` — must not gain a single new dependency. Kill the
realtime container mid-drive and the timer keeps counting, chunks keep
uploading, the transcript fills in. **That is the acceptance criterion for the
whole feature.**

Three corollaries that are easy to violate:

1. **Live ASR text is never written to `utterance`.** The chunk pipeline already
   transcribes that speech; writing both gives two divergent transcripts of one
   drive.
2. **Live audio is never buffered to IndexedDB.** Replaying 10-minute-old
   conversational audio after a tunnel produces an absurd reply to a question
   nobody remembers asking.
3. **Agent turns never enter `utterance`.** They go in a separate `agent_turn`
   table — see "Landmines" below.

---

## 🔴 Blocked on infrastructure

**1. `/audio/speech` is down on the proxy.** Every model — self-hosted Piper and
hosted `tts-1` alike — returns 500, while `/chat/completions` answers 200. It
has been that way since 2026-08-14. **Nothing can speak until this is fixed**;
the TTS code is written and unit-tested but has never run against a working
route. Re-check with `pnpm spike:talkback`.

**2. The live ASR deployment**, below. Not blocking correctness, but it is the
difference between a ~1.6s turn and a ~11s one during a drive.

## The one blocking infrastructure ask (latency)

**A second Whisper deployment for the live path.**

`transcribe.chunk` runs at `batchSize: 4` continuously during a drive, so a live
turn queues behind it. Measured: **1.7s idle → 7.9–10.2s during a drive.**

| Fix | Saving |
|---|---|
| A dedicated live ASR deployment (`MODEL_TRANSCRIBE_LIVE`) | **−8.4s** |
| A smaller model on it (distil-large-v3 / small) | **−1.3s** |

Together: **11.2s → ~1.6s**, which is inside what a backchannel can cover.

`large-v3` runs at RTF 0.35 here and live ASR is a working copy that is never
written to the ledger — quality matters far less than latency. The ledger keeps
`large-v3` unchanged.

Until this lands, Phase 1 (live transcript) works fine; Phase 2 (conversation)
will feel broken.

---

## Phase 0 — measured, done

`pnpm spike:talkback` (`scripts/spike-talkback.mjs`). Re-runnable as
infrastructure changes; it prints a per-stage budget and says plainly what is
too slow. Flags: `--runs N`, `--contention N`, `--skip-contention`.

| Stage | Planned | Measured |
|---|---|---|
| ASR, 5s turn, idle GPU | 300–900ms | **1.7–1.8s** (fixed 728ms + 217ms/s, RTF 0.35) |
| ASR, 5s turn, during a drive | — | **7.9–10.2s** |
| LLM TTFT (streamed, warm) | 250–700ms | **221–293ms** ✅ |
| TTS TTFB, clause-chunked Piper | 150–600ms | **465ms** ✅ |
| **Total during a drive** | ~1.6–2.2s | **11.2s** ❌ |

### Findings that shape the build

- **TTS is solved: `cavi/piper-en_US-ryan-high`** (Danish:
  `cavi/piper-da_DK-talesyntese-medium`). Self-hosted, ~$0 vs ~$100/1M chars on
  ElevenLabs turbo, audible quality tradeoff.
  - **The voice is baked into the model id.** There is no `cavi/piper` and no
    voice parameter — `speak()` sends none. Choosing a voice = choosing a model.
  - **~61ms fixed + 12.5ms/char** — almost entirely marginal, the opposite of
    hosted `tts-1` (634ms fixed + 7.1ms/char). Time-to-first-audio is therefore
    **a choice**, set by how much text goes in the first request.
  - Hosted fallbacks work (`tts-1`, `openai/tts-1-hd`, `openai/gpt-4o-mini-tts`)
    but every agent reply quotes the participant back to them, so routing that to
    OpenAI contradicts `.env.example` and is an ethics-form line item.
- **`Content-Type` is `audio/mpeg` for every `response_format`**, while the bytes
  correctly honour the request (pcm 91KB / wav 85KB / mp3 16KB, same input).
  **Decode by what was requested, never by the header.**
- **`GET /models` returns 401** for a key that inference accepts. Model discovery
  must probe names directly. The worker's existing `preflightLiteLLM` model-list
  check cannot work against this proxy either.
- **`stream_options.include_usage` works** ✅ — token counts on the final chunk.
- **`x-litellm-response-cost` is absent on streamed calls.** Leave `costUsd`
  undefined; never derive from tokens (half the models are self-hosted with no
  price table).
- **`gemma3:12b` accepts `tools` without erroring and never calls one** — answers
  in prose. Hence `converse` is its own role with no fallback.
- **Cold start is real**: first LLM call 62s, warm 227ms. The first turn of a
  drive pays it.
- ⚠️ **The `/audio/speech` route went down mid-session** — 500 for every model
  including hosted, while `/chat/completions` stayed 200. Transient, but it means
  TTS is a single point of failure for the agent's voice and it failed within an
  hour of first use. Phase 2 needs an explicit degradation path: the agent goes
  quiet, capture untouched.

### Still unmeasured — needs a browser and a car

1. **Bluetooth HFP.** Playing TTS with the mic open can flip the car link to HFP
   narrowband (8/16kHz). With talk-back **always on**, that would degrade the
   verbatim ledger on *every* drive, silently. Log
   `stream.getAudioTracks()[0].getSettings()` before and during playback, in the
   actual car. If sampleRate drops, that finding reshapes the deployment.
2. **WebSocket through Coolify's Traefik**, including 10 minutes idle.

---

## Phase 1 — in progress

### Done: `packages/llm`

Full monorepo typecheck clean, 50 tests passing (`cd packages/llm && npx vitest run`).

| File | What and why |
|---|---|
| `src/config.ts` | Four new roles: `transcribe_live`, `converse`, `speak`, `embed`. `ROLE_FALLBACK` maps `transcribe_live → transcribe`. **`converse` deliberately has no fallback to `fast`** — gemma3:12b would silently refuse to call tools. Adds `hasModelFor()` / `envVarFor()` so a service can degrade a feature instead of failing to start. |
| `src/chat-stream.ts` | `chatStream()` async generator. SSE parsing that buffers across chunk boundaries and decodes with `{stream: true}` (a `ü` split across two reads is real in this corpus). Tool-call delta assembly keyed by index, parsed once at the end, malformed JSON recorded as `parseError` rather than thrown. Yields `tool_call_start` as soon as the name is known so the UI can react before arguments finish. |
| `src/speak.ts` | `speak()` returns `res.body` **unread** — never buffer, that is the whole point. Reports the format *requested*, not `Content-Type`. Plus `splitForSpeech()` and `findSpeechGaps()`. |
| `src/transcribe.ts` | Takes `role?: "transcribe" \| "transcribe_live"`. Separate span names so live latency is not averaged into the ledger's. |
| `src/index.ts` | Exports the new modules. |

**`splitForSpeech` — read this before touching it.** Two constraints pull
against each other:

1. Time-to-first-audio wants a *small* opening chunk (~40 chars ≈ 500ms).
2. No gaps afterwards wants chunks that do not grow too fast. Chunk N+1 is
   synthesised while chunk N plays, so it has `70ms × len(N)` to finish in and
   needs `12.5ms × len(N+1)`.

A naive greedy split produced `"Right,"` (6 chars, ~0.4s of audio) followed by a
191-char chunk (~2.4s to synthesise) — a two-second hole immediately after the
agent starts talking, **worse than simply having started later**. So chunks ramp
(`CHUNK_GROWTH = 3.5`, below the measured 5.6× synthesis-vs-playback ratio) with
a `minChunkChars` floor. `findSpeechGaps()` asserts the property directly so a
tuning change cannot quietly reintroduce the stall.

Also plumbed: `scripts/spike-talkback.mjs`, `spike:talkback` in `package.json`,
new vars in `turbo.json` `globalEnv`, and a documented talk-back section in
`.env.example`.

### Done: `packages/telemetry`

`logger.ts`, `analytics.ts` and `ai-analytics.ts` moved out of `apps/worker` so
both services share them. The point is `installGenerationSink()`: a service that
forgets to install one makes every model call silently unobserved. Worker
imports updated; behaviour unchanged.

> Trap this surfaced: `report-sessions.test.ts` mocked `"../analytics"` by path,
> so the move silently disarmed the mock and six tests began asserting against
> real analytics. It was invisible until Postgres came up, because those tests
> **skip themselves when the database is down**. Any future module move needs a
> `grep -rn 'vi.mock' ` pass, and a green suite with Postgres down means nothing.

### Done: `apps/realtime` (Phase 1 service)

Verified end to end against the real proxy and a real session row — 9/9 probes,
including a full `hello → audio → transcript` round trip in **1005ms**.

| File | What |
|---|---|
| `src/index.ts` | HTTP `/healthz` (DB round-trip, like web's `/api/health`), WS upgrade, ticket verification, origin check, heartbeat, graceful shutdown |
| `src/conversation.ts` | Transport-free turn logic: segments audio by client VAD boundaries, transcribes with `role: "transcribe_live"`, sends text back |
| `src/wav.ts` | 44-byte header over PCM16 — no encoder, no muxer, no native dependency |
| `src/preflight.ts` | Reports which model roles are configured. Does **not** check `GET /models`: that route 401s on this proxy for a key inference accepts |
| `packages/shared/src/realtime.ts` | Protocol schemas. Deliberately not in `contracts.ts`, which carries the capture seam and is a two-person decision |
| `packages/shared/src/realtime-ticket.ts` | HMAC sign/verify + replay guard. Own export path (like `./storage`) because it uses `node:crypto` and the barrel reaches the browser |
| `apps/web/src/app/api/realtime/ticket/route.ts` | Mints tickets; the one place with both a session and the signing secret |
| `apps/realtime/Dockerfile` | Derived from the worker's. **No storage volume** — nowhere to write audio is what keeps "ephemeral" true |
| `docker-compose.prod.yml` | `realtime` service, explicit Traefik labels on `PathPrefix(/rt)` with priority above web's router, `stop_grace_period: 20s` |
| `scripts/dev-proxy.mjs` | One origin in dev: `/rt` → :3001, rest → :3000, upgrades included. `pnpm dev:proxy`, `pnpm tunnel:talkback` |

**Two bugs that only running it found**, both worth not reintroducing:

1. **The handshake race.** `onConnection` awaited the ownership query before
   registering the `message` listener, and `ws` drops messages with no listener
   attached — so the client's `hello` (sent instantly on open) was lost whenever
   the database answered slower than the network, i.e. almost always. Ownership
   is now resolved *before* `handleUpgrade`; everything after it is synchronous.
2. **The heartbeat leak.** The interval was cleared only on `close`, but a
   half-open socket — a killed tab, a phone entering a tunnel — may never emit
   `close`, so the timer pinged and re-terminated a dead socket forever. It now
   clears itself in the terminate branch.

Verified rejections: no ticket → 401, garbage → 401, forged payload with a valid
signature → 401, expired → 401, foreign origin → 403, non-`/rt` path refused,
ticket single-use → second attempt 401, database down → 503.

### Done: the client tap and the `/record` wiring

| File | What |
|---|---|
| `apps/web/src/lib/recorder/mic-bus.ts` | ~6-line pub/sub for the live `MediaStream`. The *entire* coupling between capture and talk-back |
| `apps/web/src/lib/recorder/use-recorder.ts` | Two `publishStream` calls, plus `currentSessionId` on the state. Nothing else changed |
| `apps/web/public/worklets/pcm-tap.js` | Resample → 16kHz, 512-sample frames, pre-roll ring, energy+ZCR VAD, endpointing |
| `apps/web/src/lib/talkback/use-talkback.ts` | Ticket fetch, socket, reconnect backoff, worklet wiring. Whole lifecycle in ONE effect |
| `apps/web/src/lib/talkback/pcm-tap.test.ts` | 16 tests over the worklet, run in Node with the audio globals stubbed |
| `apps/web/src/app/record/recorder-client.tsx` | Ring swells with the voice, live transcript, `talk offline` pill |

The worklet is loaded by URL so nothing can import it, which made it the least
observable code in the system — and, being signal processing, the easiest to get
quietly wrong. **Four bugs found by testing it in Node**, all silent:

1. **The opening frame was sent twice.** Every sample goes to both the frame
   buffer and the pre-roll ring, so the frame that triggered detection appeared
   in the pre-roll *and* as the first audio message — a 32ms stutter at the head
   of every turn.
2. **A zero-crossing floor of 0.02 rejected most voices.** That is a 320Hz
   crossing rate, above a male fundamental. Replaced with pre-emphasis on the
   detection path only: a first difference is a +6dB/octave high-pass, so 45Hz
   road rumble is attenuated ~20dB relative to speech, separating them by
   frequency instead of by crossing rate. Whisper still gets full-band audio.
3. **`tooShort` could never fire.** Duration included the 300ms pre-roll and the
   ~600ms endpoint hold, so a 50ms cough reported ~950ms. Speech frames are now
   counted separately from captured audio.
4. **The test signal was wrong, not the detector.** An 85Hz "voice" built from
   harmonics to 5×f0 tops out at 425Hz — a rumble, not a voice. Tuning the
   detector to accept it would have meant accepting road noise. The generator is
   now formant-based (500/1500/2500Hz), which is what actually distinguishes
   speech from rumble at any fundamental.

Verified at 48k, 44.1k, 32k and 16k input rates — iOS picks the rate, and
44.1kHz exercises the non-integer resampling path.

### Done: Phase 2, text half — it replies

The system now takes turns. It does not yet *speak* them: the proxy's
`/audio/speech` route has been returning 500 for every model since 2026-08-14,
so voice is wired but untestable. Replies appear as text under the button.

| File | What |
|---|---|
| `packages/db/src/schema.ts` + `drizzle/0003_*.sql` | `agent_turn` — a separate table, see the long comment there for why |
| `apps/realtime/src/prompt.ts` | The system prompt, the `<silence>` sentinel, history windowing. Pure |
| `apps/realtime/src/conversation.ts` | `reply()` and `abortTurn()`: streamed generation, barge-in, turn recording |
| `apps/realtime/src/agent-turns.ts` | Persistence. Never throws — a lost row must not take talk-back down |
| `packages/shared/src/realtime.ts` | `turn_start` / `turn_delta` / `turn_end` / `turn_aborted`, and client `barge_in` |

**The default is silence.** Talk-back is armed for a whole drive with no gesture
to enter it, so the failure mode is not being unhelpful — it is talking over
somebody who is thinking. The prompt answers direct questions and otherwise
emits `<silence>`. Verified against the real model, 8/8:

| Said to it | Behaviour |
|---|---|
| "should I cut the field study?" | answers |
| "cut scope or push the deadline?" | answers |
| "remind me what I said about the deadline" | deflects — cannot check |
| "when is the submission due?" | deflects — cannot check |
| trailing off, self-correcting, mid-sentence, muttering | silent |

> **The prompt bug worth remembering.** Asked "remind me what I said about the
> deadline earlier", the model answered **"You said it was Friday."** It has no
> memory and no retrieval — it invented that. In a study about someone's own
> thinking, confabulating their past is worse than saying nothing, so the prompt
> now separates *recall* (deflect) from *judgement* (answer).
>
> Fixing that then over-corrected: "what do you think?" started returning "I
> cannot check." A pass/fail on "did it say anything" counted that as success —
> the check now asserts answer vs deflect vs silence separately, which is the
> only reason it was caught.

Barge-in works in both directions: the client stops locally and reports
`playedMs`, and the server also aborts generation the moment a new utterance
starts, so a lost `barge_in` message cannot leave the model generating into a
conversation that has moved on.

**`agent_turn.text` is what was HEARD, not what was generated.** With no
playback yet, an interrupted turn records `text: ""` and the full
`generatedText` — putting the generated words in the "heard" column would be a
lie, and how far into a reply someone interrupts is the turn-taking data the
whole `mode` abstraction rests on.

### Done: recall, and a voice

**It can read the corpus.** `apps/realtime/src/retrieval.ts` runs on every turn:
the whole of the current drive from the ledger, plus a lexical search across
every past recording, widened into readable ±20s windows and labelled "earlier
today" / "last week". Measured 3–7ms against a 521-utterance corpus, with a GIN
index (`0004_magical_gateway.sql`) so it stays that way.

**Retrieval is always-on, not a tool.** `MODEL_CONVERSE` accepts a `tools`
parameter and then never calls one, so a tool-gated lookup would present as an
agent that silently refuses to check. And a second round trip would roughly
double the wait before the first word. Phase 4 swaps in tool-driven retrieval
with a tool-capable model; the function signatures here are the ones a tool
would wrap.

Verified end to end against the real corpus and model:

| Asked | Answered |
|---|---|
| "what has happened so far?" | *"You said you were going to make a tablecloth…"* |
| "summarize the last discussion" | *"You asked to summarize the latest discussions earlier today."* |
| "what did I say about the deadline?" | *"I cannot find that in the transcript."* ✅ |

The last row is the one that matters: "deadline" is genuinely absent from the
corpus, and an earlier prompt confabulated *"You said it was Friday."*

Stopwords are stripped before searching (`contentWords`). Without that, "what
did I say about the deadline" also searches for "what" and "did", which match
nearly every utterance ever recorded and bury the one word that mattered. A
question made entirely of stopwords — "what do you think?" — retrieves nothing
at all, deliberately: unrelated transcript presented as relevant context is
worse than no context.

**It speaks, via the browser** (`speak-local.ts`). A stopgap while
`/audio/speech` is down, sentence-by-sentence as the reply streams. Better than
the plan in two ways — instant, and nothing leaves the device — and worse in the
two that matter for the study: the voice is whatever the OS has, so `persona`
stops being a controlled variable, and playback progress is too coarse for
honest barge-in truncation.

> **Half-duplex while it talks.** The browser's synthesis plays through the same
> speaker the microphone hears, with no reference signal for echo cancellation,
> so without gating the mic the system hears itself and interrupts itself one
> word in. Genuine barge-in therefore does not work while it speaks. This goes
> away with server TTS: audio played through Web Audio in the page IS a
> reference signal Chrome's AEC can cancel against.

### 🔴 The self-conversation bug, and what it cost

Speaking a reply aloud put the system's own voice into the **verbatim ledger**.
The browser plays it through the speaker, the `MediaRecorder` hears it, Whisper
transcribes it, and it lands in `utterance` indistinguishable from the driver.
Retrieval then fed those lines back as "what you said earlier", and the agent
began quoting its own inventions to the user as their own memory — a real
session has it asserting *"Last week, you said you wanted to build some software
as part of your PhD"*, which the user never said.

This was landmine #4 in this very document. The `agent_turn` table stopped agent
turns being *written* to the ledger; nothing stopped them arriving *acoustically*.

**Fixed on the read side, never by mutating the ledger** (`echo.ts`), following
the asymmetry Notes.md sets out — a blemished record is acceptable, a destroyed
one is not:

- Asymmetric containment against what the agent actually **spoke** (`agent_turn.text`,
  not `generatedText` — an interrupted reply was never played, so it cannot echo).
  Asymmetric because echo arrives as a short mangled fragment of a long reply,
  which a symmetric score like Jaccard would miss.
- Runs of near-identical lines collapse. Not all of that is echo: Whisper's
  signature failure on quiet audio is repeating a plausible sentence, and
  "I'm going to show you how to build a real world computer" four times over a
  quiet minute reads to the model as the driver's preoccupation.
- Threshold set high (0.75). A false positive hides something the driver really
  said, which is worse than letting one echoed line through.

On the real session: **14 ledger lines → 6** after filtering.

> **A bug inside the fix, worth not repeating.** The first version returned kept
> *strings*, and the caller filtered its rows by membership in that set — so both
> copies of a repeated line matched the single kept string and came back. The
> dedupe silently did nothing. `keptIndices` now works by POSITION, and a test
> pins it.

**Muting the recorder is not the answer** and should not be attempted: it would
put holes in the verbatim record, and a driver talking over the reply would be
lost entirely. Server TTS improves this properly — audio played through Web Audio
in the page IS a reference signal Chrome's AEC can cancel against.

### `MODEL_CONVERSE` is `anthropic/claude-sonnet-5`

Measured on identical retrieved context:

| Model | Reply | |
|---|---|---|
| `cavi/gemma3:12b` | *"You said you want to learn about all the work done previously, and you're going to show how to build a real-world computer."* | 3415ms |
| `anthropic/claude-sonnet-5` | *"I don't have anything solid to summarize — the recordings are garbled and don't lay out an actual discussion, just fragments. If there's a specific topic you're trying to recall, tell me and I'll check."* | 2577ms |

gemma restates transcription artefacts as fact; Sonnet recognises the transcript
is unusable. It is also **faster**, because the bottleneck is prompt processing on
a small self-hosted model, not the network.

No privacy change: `MODEL_REASONING` already sends transcript to Anthropic for
workspace extraction. It does cost more — this runs per conversational turn where
extraction batches eight utterances — so watch spend on a long deployment.

### 🔴 Whisper repetition loops, and why they cascaded

A real session lost three consecutive chunks to this:

> "Right before that you'd also asked whether you could talk through all the
> previous work you'd done, but **the Transc. is the first of its kind, and the
> Transc. is the first of its kind, and …**" *(×28, then continuing into the
> next two chunks)*

Whisper degenerates on quiet, unclear or truncated audio: rather than returning
little, it locks onto a phrase and repeats it. Hundreds of words the driver never
said, written into the append-only ledger.

**Why it cascaded is the important part.** `transcribe-chunk.ts` feeds the
previous chunk's tail to Whisper as a continuity prompt — a good feature, it
measurably fixes words split across a boundary. But a chunk that loops seeds the
*next* chunk with its own loop, and the failure sustains itself for the rest of
the drive.

Talk-back made this much more likely: the agent's spoken reply is overheard,
lands truncated at a chunk edge ("…but the Transc."), and that fragment is
exactly the kind of input Whisper loops on.

Repaired in `packages/llm/src/transcript-repair.ts`, at the ASR boundary rather
than in any one caller — the live conversation path loops the same way and would
otherwise answer a question nobody asked:

- Immediately repeated runs collapse to one occurrence. Only exact runs, and only
  at three or more: people repeat themselves, and the ledger is meant to hold
  that. "no, no, I disagree" survives.
- `degenerate` is reported on the result so a mostly-artefact chunk is not
  carried forward as the next chunk's prompt.
- `repetition_ratio` goes to observability. How often the ASR degenerates, and on
  what audio, is a finding about the corpus rather than only an operational detail.

**Existing data still contains the loops.** Retrieval collapses them on read, so
talk-back is unaffected. Workspace extraction is not: `loadPendingSegments` will
feed them to the extractor as though they were speech. Repairing that on read
changes extractor inputs, which changes `computeInputHash`, which invalidates the
whole extraction cache — the same deliberate, own-PR decision as a
`PROMPT_VERSION` bump. Not done unilaterally.

### Done: real voice, through Web Audio — and full-duplex barge-in

Synthesis moved server-side and now streams over the socket as binary PCM,
played through a Web Audio worklet. Three things fall out of that one change.

**Echo cancellation works again.** Audio rendered through Web Audio *in the
page* is part of the render stream, which is the reference signal Chrome's AEC
subtracts from the microphone. `speechSynthesis` provides no such reference,
which is why the stopgap had to gate the mic shut. **The half-duplex gate is
gone** — the mic stays open while the agent speaks.

**Barge-in is honest.** The player counts consumed samples, so `playedMs` is
what was actually *heard*, not what was scheduled. `heardText()` truncates at a
clause boundary, and `agent_turn.text` records that while `generatedText` keeps
the whole reply. The conversation also continues from what was heard — feeding
the model the full reply would have it referring to sentences that were cut off.

**Providers are swappable by env** (`TTS_PROVIDER`):

| | |
|---|---|
| `litellm` *(default)* | Piper today, Kokoro-82M when deployed. AU hardware, $0, one voice for every participant — which is what `persona` needs to be a controlled variable |
| `elevenlabs` | The realism benchmark, called directly (an OpenAI-shaped envelope has nowhere to put `optimize_streaming_latency` or PCM output). Sends the agent's words to a US vendor. ~$0.60/drive |
| `synthetic` | A speech-shaped buzz generated locally. **Not a voice** — it exists so the audio path is testable when no provider is reachable |

> **Why `synthetic` exists.** `/audio/speech` has 500'd for every model since
> 2026-08-14 and there is no ElevenLabs key, so the audio path — WAV header
> stripping, binary framing, sample-rate declaration, the ring buffer, consumed-
> sample accounting — could not be exercised at all. Rather than ship a pipeline
> that has never carried a sample, this makes it verifiable today; real audio
> travels the identical code. It is never a fallback: a study must not record
> someone listening to a buzz, so it has to be named explicitly.

Verified with it: frames stream rather than arriving as one blob, the declared
rate is non-zero, per-clause durations sum to the total within 5ms (a mismatch
would make every barge-in truncation silently wrong), and abort stops synthesis
mid-reply.

**Streaming STT is deliberately NOT done.** Deepgram or AssemblyAI would take the
8–10s ASR to ~300ms, but it means shipping raw participant audio — biometric data
under GDPR — to a US vendor. That is an ethics decision, not an engineering one.
`MODEL_TRANSCRIBE_LIVE` is the switch; self-hosted NVIDIA Parakeet is the
option that keeps it on AU hardware.

### 🔴 The self-interruption bug

Moving to server TTS restored echo cancellation, so the half-duplex gate came
off — and nothing replaced it. AEC removes most of the agent's voice from the
microphone but not all of it, and at the normal VAD threshold that residue reads
as speech: the system heard itself, called it a barge-in, and cut itself off a
word into every reply.

The plan had specified a barge-in guard for exactly this and it was skipped.

**The fix is not muting** — that removes genuine barge-in, which is the point of
full duplex. While the agent is audible the tap requires a much stronger and
more sustained signal, set from measurement:

| pre-emphasised frame RMS | p50 | p90 | max |
|---|---|---|---|
| full speech | 0.0261 | 0.0468 | 0.0504 |
| echo residue (~12% amplitude) | 0.0031 | 0.0056 | 0.0061 |

They separate cleanly between 0.010 and 0.020, so the guard threshold is
**0.012** — roughly 2× headroom over the loudest residue observed, and well
under the median of real speech.

Two mistakes made getting there, both caught by tests rather than by ear:

1. **Scaling the noise floor instead of using an absolute value.** A 3.5×
   multiplier on an adaptive floor computed to 0.047 — above the 90th percentile
   of real speech — so nothing could interrupt at all. The floor is small and
   moves; scaling it is not a stable way to set a threshold.
2. **Requiring consecutive frames.** Speech has a syllable envelope that dips
   several times a second, so ten unbroken frames is something real speech
   essentially never produces. Evidence now accumulates on speech and decays on
   silence, so a sustained voice builds through its own gaps while an isolated
   burst of residue does not.

Also: an 8-frame grace period at the start of playback, when the canceller has
not yet adapted and self-interruption is likeliest, and the noise floor stops
adapting while the agent talks — otherwise it climbs to meet the agent's voice
and then sits too high to hear the driver afterwards.

### 🔴 Truncated into silence by thinking tokens

The single reason talk-back appeared mute after switching to Sonnet.

`claude-sonnet-5` spends completion tokens on extended reasoning *before* it
emits any text. With `maxTokens: 120` — sized for a one-sentence spoken reply —
the whole budget went to reasoning: `finish_reason: "length"`, 120 tokens used,
**zero characters of text**. Downstream that is indistinguishable from a model
choosing not to speak, so the turn was logged as withheld and no audio was ever
requested. Nothing said "truncated".

`disableThinking` now goes out on conversational turns, which also removes
**~1.4s per turn** (3274ms → 1884ms measured), and `chatStream` emits an
explicit error when a response returns truncated with no text.

### 🔴 Synthesised audio thrown away

The server sent `turn_end` *before* it began speaking. The client used
`turn_end` to decide whether the server had produced audio, saw none yet, fired
the browser fallback and cleared the turn id — after which every ElevenLabs
frame arrived for a turn the client no longer recognised and was dropped.

Symptom: the real voice generated perfectly, the bad voice heard. `turn_end` now
comes after the audio.

### Synthesis overlaps generation

`speakTurn` was only invoked once the whole reply existed, so its clause
pipelining never actually overlapped anything: ASR 1.5s → generation 3.07s →
TTS 0.73s = **5.3s before a sound**. `createTurnSpeaker` now takes token deltas
and synthesises each clause the moment it is complete.

> The first attempt emitted only when `splitForSpeech` returned two or more
> chunks — but a single finished sentence is one chunk, so nothing was spoken
> until generation ended, which is the exact delay it existed to remove. It now
> emits at the last clause boundary in the buffer, and a test pins it.

### 🔴 Why playback sounded chopped

Two bugs, both in the streaming split rather than the player.

**Fragmentation.** `push()` called `splitForSpeech` on every token delta, and
that function always makes its FIRST chunk small — so it emitted `"Honestly,"`
and then `"I don't have"` as separate synthesis requests. Each unit is
synthesised independently, with its own prosody and its own arrival gap, so the
reply played back as disconnected chunks of words.

Units are now deliberately uneven: the **opener** may be a clause (it sets
time-to-first-audio, and starting a sentence and carrying on sounds natural),
but **everything after it is a whole sentence**, minimum 140 characters. By then
audio is already playing, so size costs nothing and larger units sound
continuous. Later units never split at a comma — a comma seam mid-speech is
audible; a sentence boundary is not, because the voice pauses there anyway.

**Duplicated text.** On the iteration that announced the turn, the accumulated
text was pushed AND the same delta pushed again — so `"Can't weigh that"` was
synthesised as `"Can't weigh thatigh that"`. Visible in the new `spoke` logs
within a minute of adding them.

Measured after: one unit of 78 characters, 4.4s of audio, no seam. The reply
also dropped from 13.4s to 4.4s.

### Transparency

Nothing about the audio path was observable, which is why these took so long.

**Server** logs one `spoke` line per synthesis unit:

```
spoke  unit=1  chars=78  audioMs=4400  synthMs=2241  aheadMs=2159
```

- `chars` well under ~40 on anything but unit 1 means fragmentation is back.
- `aheadMs` going negative means synthesis is losing the race with playback, and
  the buffer will run dry between units — audible as a stutter at every seam.

**Browser** console reports `[talkback] speaking (24000Hz)`, `audio complete`,
and an explicit warning on underrun — the buffer running dry mid-reply, which is
otherwise completely invisible and is the most likely cause of chopped audio.

### The transcript is a conversation now

`/sessions/[id]` interleaves `utterance` and `agent_turn` on the same session
clock and styles them as a dialogue: driver left, agent right in blue, **every
agent generation its own row**, never merged.

This matters beyond convenience. The agent's own voice echoes into the ledger
through the microphone, so a line of transcript may BE the agent — seeing its
turns explicitly is what makes that legible. Each agent row also carries what
the turn cost (`heard in`, `first word`, `audio`, `spoke`) and the resolved
model, because a live conversation is not replayable and those columns are the
only record it happened.

An interrupted turn shows what was heard normally and what was generated but
never reached the driver **struck through** — hiding it would make a truncated
turn look complete, and the gap between the two is the turn-taking data.

### Next, in order

1. ~~**`apps/realtime`**~~ — done, see above. Original notes kept below for the
   reasoning behind each decision.

   <details><summary>Design notes</summary>

   New service (copy `apps/worker/Dockerfile` nearly
   verbatim: same tsx-from-source, same uid 1001, same node_modules COPY list
   plus the guard loop).
   - Raw `ws`, not socket.io. New dependency.
   - **Auth: a signed ticket, not the cookie.** New
     `apps/web/src/app/api/realtime/ticket/route.ts` using the existing
     `currentUserId(req)` from `apps/web/src/lib/session.ts`, returning an HMAC
     over `{userId, captureSessionId, jti, exp: now+60s}` signed with
     `BETTER_AUTH_SECRET`. Realtime verifies with the shared secret — no DB round
     trip, no Better Auth dependency, works in dev where ports differ.
   - **Bind the ticket to `captureSessionId` and re-resolve ownership on
     reconnect**: `onLinkAccount` in `apps/web/src/lib/auth.ts` deletes the guest
     user row on upgrade, leaving a socket holding a dangling `userId`.
   - Compose: `depends_on: migrate`, `stop_grace_period: 20s`, healthcheck on
     `:3001/healthz` doing `select 1`, **no `audio-data` volume** (live PCM stays
     in memory — that is what makes "ephemeral" enforced rather than asserted).
   - **Explicit Traefik labels**, not `SERVICE_FQDN_REALTIME_3001` — Coolify's
     magic FQDN renders `https://host:3001`, the same trap the compose file
     already documents for `BETTER_AUTH_URL`. Route `PathPrefix(/rt)`.
   - **App-level ping/pong at 15s.** Idle-timeout behaviour on a Coolify-managed
     Traefik is not something to discover on the motorway.
   - **Call `installGenerationSink()` at boot**, as `apps/worker/src/index.ts`
     does, or every talk-back model call is silently unobserved. Cleanest: move
     `apps/worker/src/{ai-analytics,analytics,logger}.ts` into a
     `packages/telemetry` imported by both.
   - `scripts/dev-proxy.mjs` on `:3100` forwarding `/rt` → `:3001` and the rest
     → `:3000`, so dev, tunnel and prod all mean "same origin, `/rt` prefix".
     `pnpm tunnel` currently points at `:3000` only.

   </details>

2. **Client PCM tap** — `apps/web/src/lib/recorder/mic-bus.ts` (~6-line pub/sub).
   `use-recorder.ts` gains **exactly two calls**: `publishStream(stream)` after
   `streamRef.current = stream` (~line 294) and `publishStream(null)` in `stop()`
   after tracks stop (~line 349). Nothing else in that file changes.
   - **Never call `getUserMedia` a second time** — one track feeds both
     `MediaRecorder` and a `MediaStreamAudioSourceNode` fine; a second call can
     renegotiate the track and perturb the running recorder.
   - `AudioWorklet` at `apps/web/public/worklets/pcm-tap.js` (plain JS, fetched
     by URL). Resample **inside the worklet**; do not trust
     `new AudioContext({sampleRate: 16000})` — iOS pins to the hardware rate.
   - 512-sample frames @16kHz (32ms, exactly Silero's frame), 300ms pre-roll ring
     buffer prepended when an utterance opens.
   - Phase 1 VAD: energy + zero-crossing in the worklet, ~50 lines, zero bytes
     downloaded. Ship it behind a `VadEngine` interface; Silero comes in Phase 2.

3. **Live transcript in `/record`** — echo recognised text back and show it. No
   LLM, no TTS. Independently useful: the app currently fakes liveness with
   `router.refresh()` every 4s. Behind `TALKBACK_ENABLED`.

4. **Phase gate (do not skip):** kill the realtime process mid-recording and
   verify the timer keeps counting, chunks keep uploading, and `/sessions/[id]`
   fills in normally.

Phases 2–7 (it talks / mode+persona govern / capability invocation / retrieval /
web search + outlets / latency) are detailed in the plan file.

---

## Landmines, ranked

1. **Bluetooth HFP degrades the verbatim ledger on every drive** now that
   talk-back is always on. Measure in the car; log `getSettings()` into
   `capture_session.deviceInfo` at recording start, first agent turn, and end.
2. **Whisper GPU contention** — the blocking ask above.
3. **`PROMPT_VERSION` bump invalidates the whole extraction cache.** Making the
   extractor conversation-aware (so "Yes, exactly." is not folded as a standalone
   thought) requires it. That regenerates the workspace and re-pays every model
   call against `MODEL_REASONING`. Its own PR, deliberately, after a dry-run
   `pnpm workspace:rebuild`. Never riding along with a feature commit.
4. **Agent words reaching `loadPendingSegments`.** `utterance.chunkId` is
   NOT NULL and there is no speaker column; seven readers would silently include
   agent speech — nastiest being the Whisper prompt-carryover in
   `transcribe-chunk.ts`, which would feed the agent's words to Whisper as
   context for the user's next chunk. Solved structurally by a separate
   `agent_turn` table. Keep a regression test anyway.
5. **Never write live-ASR user text into `utterance`.**
6. **Never buffer live audio to IndexedDB.**
7. **onnxruntime-web bytes on mobile data** (Phase 2) — lazy-load, self-host
   under `public/ort/`, pin `ort.env.wasm.wasmPaths`, keep it off the plain
   recorder path. Extend `isStaticAsset()` in `sw.js`, do **not** add to
   `PRECACHE`.
8. **`MODEL_FAST` cannot call tools** — hence the separate `converse` role.
9. **Traefik/Coolify idle timeouts on WS.**
10. **`installGenerationSink()` in `apps/realtime`**, or nothing is observed.
11. **Every push to main redeploys and kills live conversations.** For a
    longitudinal study each deploy is a data event worth recording.
12. **Guest→account upgrade mid-drive** deletes the guest user row.

## Where the determinism discipline does *not* apply

`extraction` exists so the workspace is rebuildable without network calls. **A
live conversation is not replayable** — wall-clock timing, VAD outcomes, network
jitter, a sampler above temperature 0. Routing talk-back calls through
`extraction` would poison a cache whose entire value is that a replay makes no
calls. Persist `agent_turn` and `invocation` rows instead; that is the paper's
data.

---

## Testing locally

```sh
docker compose up -d && pnpm db:migrate     # Postgres

# BOTH flags, same value — server and browser halves of one switch.
TALKBACK_ENABLED=true NEXT_PUBLIC_TALKBACK_ENABLED=true pnpm dev
```

Then open `/record`, press Record, and talk. The ring swells with your voice and
what the system heard appears under the button, a second or so after you stop.

Without a microphone, or to check the auth surface, use the probe:

```sh
pnpm --filter @voicemural/realtime probe
```

It checks every path that must REFUSE a connection (those are the ones that fail
open and still look fine), then does a real round trip: opens a socket, streams
PCM in frames the way the browser tap does, and waits for a transcript back.
Expect `9/9 passed`. It reuses a capture session from the database or creates a
throwaway, so the recorder need not have run first. `RT_BASE=…` points it
elsewhere.

### 🔴 The phase gate — run this before trusting any of it

The whole feature rests on capture being independent. Prove it, do not assume it:

1. Start recording in `/record` and let a few chunks upload.
2. **Kill the realtime process** (Ctrl-C its pane, or `docker compose stop realtime`).
3. Confirm the elapsed timer keeps counting, chunks keep uploading, and the
   `talk offline` pill appears — nothing else changes.
4. Stop recording and open `/sessions/[id]`. The transcript must be complete,
   with no gap where the socket died.

If anything about capture changes when realtime dies, that is a release
blocker — not a talk-back bug.

Still unverified in a real browser: I have run the worklet only in Node with the
audio globals stubbed. Microphone permissions, the AudioContext gesture
requirement, and iOS's suspend-on-background behaviour need a real device.

The probe checks every path that must REFUSE a connection (those are the ones
that fail open and still look fine), then does a real round trip: opens a
socket, streams PCM in frames the way the browser tap will, and waits for a
transcript back from Whisper. Expect `9/9 passed`.

It reuses a capture session from the database, or creates a throwaway if there
are none — so it does not need the recorder to have run first. Point it
elsewhere with `RT_BASE=http://127.0.0.1:3002`.

A 440Hz tone is not speech, so whatever Whisper reports ("Thank you." is
typical) is a hallucination. The point is that audio flows both ways and how
long it takes: ~1.2s against the shared ASR deployment, idle.

## Commands

```sh
pnpm spike:talkback                    # re-measure the proxy; prints the budget
pnpm spike:talkback --runs 5           # more samples
MODEL_SPEAK=cavi/piper-en_US-ryan-high pnpm spike:talkback

pnpm typecheck                         # 8 packages
pnpm test                              # 201 tests, none skipped, when Postgres is up

pnpm dev:proxy                         # :3100 → /rt to realtime, rest to Next
pnpm tunnel:talkback                   # cloudflared at :3100, for a real phone
```

**DB-backed tests skip themselves when Postgres is unreachable.** A green run
with Postgres down means "skipped", not "passed" — that is exactly how the
`report-sessions.test.ts` mock breakage stayed hidden. Always check the counts:
201 passing and 0 skipped is the healthy number.

---

## 🔴 Worklet changes never reached the browser

The service worker caches `/worklets/` **cache-first**, alongside genuinely
immutable things like fingerprinted `/_next/static/`. But the worklets are served
from a fixed path and change content — so once a browser had run the app, it kept
serving the first `pcm-tap.js` it ever saw, forever.

Several rounds of microphone-tap fixes shipped and **none of them ran**. The
self-interruption guard, the threshold measurements, the evidence accumulator —
all of it was sitting in the repo while the browser played back the original
version. Symptom: fixes that verifiably work in tests appear to do nothing.

`WORKLET_VERSION` in `use-talkback.ts` now goes into the query string, so each
revision is a distinct URL: the cache still works offline and updates still land.
**Bump it whenever either worklet changes.**

## Suspect lines are marked in the transcript

Two kinds of line in the ledger were never said by the driver, and both used to
read as speech:

- **Whisper artefacts.** On silence it returns a fluent sentence from its
  training distribution, which is largely YouTube — a real drive produced
  *"Thank you so much for watching, and I'll see you in the next video."*
  `isLikelyHallucination` matches whole lines only, and deliberately narrowly:
  marking real speech as fabricated is the worse error.
- **The agent's own voice**, arriving through the microphone. Matched by
  containment against the turn's spoken text AND by overlapping the interval it
  was speaking — both, because a genuine interruption also overlaps and must not
  be hidden.

Both are shown dimmed with an explanation rather than removed. The ledger keeps
everything; the marking is on read.


---

## The migration to LiveKit Agents

### Why

The hand-rolled stack failed on the two things that decide whether a voice agent
is usable, and no amount of tuning fixed either:

- **It interrupted itself.** The mic hears the agent through the speaker, and
  gating on signal energy cannot reliably separate echo residue from speech. Two
  rounds of measured thresholds, an evidence accumulator and a grace period all
  failed in real use.
- **It sounded chopped.** Every clause was a separate HTTP synthesis, and
  ElevenLabs plans prosody per request — so the output was independent
  recordings stitched together. That is not a buffering bug and no buffering fix
  could have solved it.

Both are solved problems. LiveKit is WebRTC-native, so echo cancellation is the
browser's real AEC against the actual render stream; interruption is gated on
transcribed WORDS (`turnHandling.interruption.minWords`) rather than on signal
energy; and the ElevenLabs plugin feeds text into ONE continuous websocket
synthesis, which is what removes the seams.

Pipecat was considered first and rejected on one fact: it is Python-only, and
this repo is TypeScript end to end. LiveKit Agents has a Node SDK, so the
migration adds no second runtime.

### Shape

| | |
|---|---|
| `apps/agent` | The LiveKit agent. `defineAgent({ prewarm, entry })`, Silero VAD, Whisper + Sonnet through LiteLLM (`baseURL`), ElevenLabs TTS |
| `docker-compose.livekit.yml` | Self-hosted LiveKit — a single Go binary, no database. Audio stays on AU infrastructure |
| `/api/realtime/livekit-token` | Mints a join token. **One room per drive**, named `drive-<captureSessionId>`, which is how the agent knows which drive it joined without trusting the client |
| `use-talkback.ts` | ~130 lines of LiveKit client, down from ~450 of hand-rolled audio |

**The capture path did not move.** The recorder still owns the microphone and
still writes `audio_chunk`/`utterance`; the client publishes the SAME
`MediaStreamTrack` into the room rather than calling `getUserMedia` again. Kill
the agent mid-drive and capture is untouched — still the acceptance criterion.

### What carried over unchanged

The prompt, the silence-by-default stance, retrieval with echo filtering, and
the `agent_turn` record. None of those were the problem; only the plumbing was.
Retrieval hangs off `onUserTurnCompleted`, which injects the transcript before
the LLM call — still on every turn rather than as a tool, for the same reasons.

### What to watch

`AgentFalseInterruption` fires when the session starts treating something as an
interruption and then changes its mind. That is precisely the failure that made
the old stack unusable, so it is logged with a hint. **If those lines appear in a
drive, raise `minWords` or `minDuration`** — that dial is now one number in one
place rather than a threshold derived from RMS measurements.

---

## Pipecat, alongside LiveKit

Both frameworks solve the same problem — echo cancellation, turn detection,
interruption, continuous TTS — and after the hand-rolled stack the only claim
worth making is one you can hear. So both are deployed at once and switched with
a single env var, rather than one replacing the other.

### Running them side by side

```bash
pnpm talkback:up            # postgres + livekit + pipecat
pnpm talkback:logs          # follow the pipecat container
```

Then in `.env`:

```bash
NEXT_PUBLIC_TALKBACK_BACKEND=livekit   # or pipecat
NEXT_PUBLIC_PIPECAT_URL=http://localhost:7860
```

It is read at build time like the other `NEXT_PUBLIC_` flags, so switching needs
a dev-server restart, not just a reload. The `/record` screen shows which one is
live as a pill next to `awake` — **judging one and attributing the verdict to
the other would waste the whole exercise.**

### What is held constant, deliberately

| | |
|---|---|
| transport | WebRTC on both sides, so both get the browser's real echo canceller. A WebSocket transport for Pipecat would lose that and make it look worse for a reason that has nothing to do with Pipecat |
| STT | Whisper through LiteLLM, VAD-segmented |
| LLM | `MODEL_CONVERSE` through LiteLLM, **no `temperature`** — `claude-sonnet-5` accepts only `1`, LiteLLM answers 400, and both frameworks swallow it into a silent non-reply |
| TTS | ElevenLabs streaming websocket, `eleven_turbo_v2_5`. **Not `eleven_v3`** — it is HTTP-only and 403s on the websocket |
| endpointing | Silero, `stop_secs: 0.5` ≈ LiveKit's `minDelay` |
| prompt | `apps/pipecat/bot.py` reads `SYSTEM_PROMPT` out of `apps/agent/src/prompt.ts` at runtime rather than copying it, so the two cannot drift. A prompt difference would silently become the thing being compared |

### The one honest asymmetry

LiveKit lets the client publish the recorder's existing `MediaStreamTrack`.
The Pipecat JS client owns capture through its `MediaManager` and accepts only a
**device** id, so a second `getUserMedia` is unavoidable without subclassing
internals the package does not export — not worth it for a backend that is meant
to be deleted if it loses.

It is pinned to the recorder's own device, and `use-pipecat.ts` compares the
recorder track's `getSettings()` before and after and warns to the console if
`sampleRate`, `channelCount` or `echoCancellation` moved. **A silent narrowband
downgrade of the ledger matters more than the comparison does**, so make it
visible rather than assume it away.

### What is deliberately NOT in the Python side

Retrieval, the `agent_turn` record and echo filtering stay in TypeScript. They
are identical for both frameworks, so they cannot discriminate between them, and
a second implementation would only be a second thing to keep in sync. This
container exists to judge the **conversation**: latency, interruption, and
whether the voice sounds like speech rather than stitched fragments.

### Deciding

Pick on: time to first audio, whether it interrupts itself, whether interrupting
it works, and whether a reply sounds continuous. Then delete the loser —
`apps/pipecat`, `docker-compose.pipecat.yml`, `use-pipecat.ts` and the backend
switch on one side, or `apps/agent`, `docker-compose.livekit.yml`,
`use-livekit.ts` and `/api/realtime/livekit-token` on the other. Two live audio
stacks is a maintenance cost that only pays while the question is open.

### Not yet verified: the container itself

`bot.py` is verified against the real `pipecat-ai==1.7.0` API — imports, the
prompt parse, and a full `build_pipeline()` with no deprecated calls. The
**container has never been started**, because the machine ran out of disk
(7 GiB free of 460) and the build failed at the export step:

```
failed to solve: Internal: write /var/lib/buildkit/...: input/output error
```

So before trusting any of it, reclaim disk and then:

```bash
pnpm talkback:up
curl localhost:7860/healthz     # {"ok":true,"backend":"pipecat",...}
```

Only after that does hearing the two backends against each other mean anything.

### 🔴 The missing PATCH route — why Pipecat "just didn't answer"

First real drive on Pipecat: nothing. The browser logged only
`[talkback:pipecat] could not connect undefined`, and the container logged

```
"PATCH /offer HTTP/1.1" 405 Method Not Allowed
Timeout establishing the connection to the remote peer. Closing.
```

The JS client **trickles ICE candidates to `PATCH /offer`**, and `bot.py` only
defined `POST`. So every candidate was rejected, the peer connection never left
`connecting`, and 40 seconds later it closed with a message that reads like a
network fault rather than a missing route. Everything upstream — CORS, env,
`/healthz`, the model config — was fine and checked out clean, which is exactly
what made it hard to see.

The fix is a `@app.patch("/offer")` handler that converts the browser's
`{candidate, sdp_mid, sdp_mline_index}` into an aiortc candidate via
`candidate_from_sdp` (**which wants the value WITHOUT the `candidate:` prefix**)
and passes it to `connection.add_ice_candidate`.

Verified with a real handshake from inside the container rather than by eye:
`POST /offer` 200 → `PATCH /offer` 200 → **`ICE STATE: completed`**, and the
server logging `Adding remote candidate ... Connection state changed to:
connected`. Before the fix that same probe timed out at `connecting`.

**Two lessons worth keeping.** A healthy `/healthz` says nothing about whether
signalling works — only an actual peer connection does, so test that. And the
browser-side error said `undefined` because Next's log bridge does not serialise
an `Error`: flatten it to a string at the call site, or the one message that
would have pointed here says nothing at all.

### 🔴 The VAD that was silently discarded

With signalling fixed, Pipecat connected perfectly — peer connection
established, audio track replaced, data channel open, client ready, pipeline
ready — and then heard nothing at all. No VAD, no transcription, no reply.

**`TransportParams` in Pipecat 1.7 has no `vad_analyzer` field**, and pydantic's
default `extra` policy is *ignore*. So

```python
TransportParams(audio_in_enabled=True, vad_analyzer=SileroVADAnalyzer(...))
```

raises nothing, warns nothing, and throws the analyzer away. Every symptom
points at the network, because the connection genuinely is healthy.

VAD is a **pipeline stage** in 1.7, and it is needed in two distinct places:

```python
vad = VADProcessor(vad_analyzer=silero())        # 1. before the STT
aggregator = LLMContextAggregatorPair(
    context,
    user_params=LLMUserAggregatorParams(vad_analyzer=silero()),   # 2. turn-taking
)
Pipeline([transport.input(), vad, stt, aggregator.user(), llm, tts, ...])
```

The first is not optional with batch Whisper: `OpenAISTTService` extends
`SegmentedSTTService`, which transcribes **only** on
`VADUserStartedSpeakingFrame`/`VADUserStoppedSpeakingFrame`. Without a
`VADProcessor` upstream it sits on a live audio stream and never sends one
request. The second drives turn completion and interruption in the aggregator.
Give them **separate analyzer instances** — they keep independent state.

**How it was found, and the lesson.** A `Trace` FrameProcessor was inserted at
two points in the pipeline, logging exactly three things: audio-frame counts (on
the hundreds), VAD start/stop, and transcriptions. Those three separate the
otherwise identical failures — audio never arrived / VAD never fired / Whisper
returned nothing. It is still in the pipeline, and worth keeping.

Verified without a human by generating a real utterance through ElevenLabs and
feeding it in over WebRTC via `MediaPlayer` — Silero will not fire on a tone, so
the test signal has to be actual speech. First green run:

| stage | measured |
|---|---|
| STT TTFB | 3.4s cold, then 1.3s, then 0.13s |
| LLM TTFB | 2.2s |
| TTS TTFB / TTFA | 0.32s / 0.39s |

and `Generating TTS [Yeah, I can hear you.]`.

---

## Recall for both backends, and where the delay actually is

### One retrieval, two frameworks

Pipecat could converse but remembered nothing, because retrieval lived inside
`apps/agent`. Rather than write it twice, it moved to **`packages/talkback`**
(`retrieval.ts`, `context.ts`, `echo.ts`), and the Python side reaches the very
same `buildContextMessage` through a new **`POST /api/realtime/context`**.

Two implementations would have been two things to keep correct — and while the
backends are being compared, a difference in what they remember would read as a
property of the framework rather than as a bug in the copy.

Authorised by the existing signed ticket, since the Python container has no
Better Auth session and should not gain one. Two details worth keeping:

- **`issueTicket` grew a `ttlMs` option.** The 60s default is short because a
  handshake ticket rides in a URL query parameter, where proxies log it. The
  context ticket never does — it is a POST body — and it is spent once per turn
  for a whole drive, so it gets 3 hours. The default is unchanged, and tests pin
  both.
- **Not single-use.** A replay guard here would kill the second turn of every
  drive. Ownership is instead RE-RESOLVED against `capture_session.userId` on
  every call, which also covers a guest upgraded mid-drive.

In `bot.py` this is a `Recall` processor sitting on the transcription before the
aggregator builds the user message, so the system message is already in context
when the LLM runs. It costs ~120ms and **fails open**: an agent that has
forgotten the past is worth more than one that stops talking.

### 🔴 The agent was being told things nobody said

Retrieval was feeding Whisper's invented sign-offs to the model as the driver's
own words — `isLikelyHallucination` existed but was wired **only into the
transcript view**, never into what reaches the agent. This affected BOTH
backends and is a large part of why replies felt untethered.

The line-level check was not enough on its own: Whisper finishes a real sentence
and keeps going, so one `utterance` arrives as

> Hey, can you summarize the previous discussions? Thank you for watching the video today.

which is mostly genuine, and dropping the whole line loses a real question. So
`withoutHallucinatedSentences` applies the same whole-line rule **per sentence**
— a sentence being the unit Whisper actually fabricates in. Measured against the
real corpus, `watching` / `Amara` / `next video` / `subscribe` all disappeared
from what the agent sees, and the genuine question survived.

Still read-side only. The ledger keeps everything; a read is allowed to know
better.

**Not fixed:** repetition degeneration (`"I'm going to make a cake that is easy
to make"` ×N) is a different failure — the worker detects and repairs it, but
the repaired text is still fabricated, and it still reaches retrieval.

### Where the 2–9 seconds go

Endpoint → first audio, measured on a real drive:

| | STT | LLM | TTS | total |
|---|---|---|---|---|
| GPU idle | 1.7s | 2.2s | 0.32s | **2.5–2.8s** |
| GPU busy | **11.1s** | 1.5s | 0.29s | **9.2s** |

**The variance is entirely ASR, and it is the Phase 0 finding arriving on
schedule.** `MODEL_TRANSCRIBE_LIVE` is unset, so live transcription uses
`faster-whisper-large-v3` — the same deployment the chunk pipeline is hammering
every 10 seconds during the very same drive. Setting it to a second, smaller
deployment remains the single highest-value change available, and it is an
infrastructure ask, not a code change.

Thinking tokens are now disabled on the Pipecat LLM to match the LiveKit side.
**It made no measurable difference here** — 2.16s versus 2.20s — so LLM TTFB
through LiteLLM is simply ~2s. It is kept because it costs nothing and keeps the
two backends comparable, not because it bought anything.

It must be written `extra={"extra_body": {"thinking": ...}}`. Pipecat spreads
`extra` as keyword arguments into the OpenAI SDK's `create()`, so a bare
`thinking` key raises `unexpected keyword argument` — which surfaces as an
`ErrorFrame` and simply produces no reply at all.
