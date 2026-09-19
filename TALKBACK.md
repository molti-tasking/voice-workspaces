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
  → title → Recall → aggregator.user() → llm → SilenceGate → tts
  → transport.output() → aggregator.assistant()
```

`title` (`TopicTitle`) names what is being talked about **right now** in two to
four words, off its own short window of recent speech rather than the
whole-drive summary, and pushes each change to the browser as an
`RTVIServerMessageFrame` over the data channel the audio already needs. The
recorder shows it as a plain title that blurs across when the subject changes.
It never blocks a turn, and it is inert unless
`/api/realtime/session` sent a `titlePrompt`.

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

### How forthcoming: talkback-4

`talkback-3` said "answer when clearly addressed, otherwise nothing", and on the
road that produced a companion that declined a loose "right?", asked what you
meant instead of answering, and let a finished thought pass without a word —
which reads as not listening. `talkback-4` keeps the length discipline and puts
the engagement back: a question is always answered on its most likely reading,
a landed thought may earn one sentence, a stuck person one push. Mid-thought is
still silence, and "never twice in a row without a reply" is now stated.

HOW OFTEN is the setting's business. `SETTING_PROFILES[s].proactivity` finally
has a reader: `composeSystemPrompt` appends `PROACTIVITY_STANZAS[level]` after
the setting stanza — `quiet` in a car, `occasional` walking, `forthcoming` at a
sink or a desk. None of the three lengthens a reply; the cap is the setting's.
The sandwich is now identity → setting → proactivity → contract, and
`prompt.test.ts` pins that order.

### talkback-6: the offer, and the engine that makes it possible

`talkback-5` was still purely reactive — it answered well, but it never brought
anything, which on the road reads as "helpful only when asked". `talkback-6`
adds the fifth way to earn a turn: the unprompted **offer**, one sentence when
you can see the useful thing before they ask for it — the next step they named,
the open question from WHERE THINGS STAND, the thing they will need in ten
minutes. The prompt defines helpful narrowly on purpose: *the right sentence at
the right moment, not a longer answer*, or "more proactive" decays into "talks
more".

The engine that makes the offer possible is `Offers` in `bot.py`, the "proactive
engine" this section used to say did not exist. It does not decide what to say;
it decides when saying something unprompted is even allowed, by making the
prompt's own rules mechanical:

- **Never mid-thought.** The timer arms on a completed, unanswered final
  transcript and cancels the instant speech starts again.
- **Never twice without a reply.** `SilenceGate` reports what each agent turn
  became — the same call the running summary gets — and a spoken turn blocks
  further offers until the driver answers.
- **Declined offers back off.** When the model takes the engine's moment and
  answers `<silence>`, nothing was worth saying; the delay doubles (capped at
  120s) rather than asking the same question every interval, and resets on the
  driver's next words.

The patience is the proactivity level's own: 25s `quiet` (driving), 12s
`occasional` (walking), 7s `forthcoming` (sink or desk) —
`PROACTIVE_AFTER_SECS`, mirrored between `setting.ts` and `bot.py`, so the
engine can never be more forthcoming than the prompt has already told the model
to be. One more turn exists: the **opening**, one short line ~2.5s after connect
("I'm here", or on a reconnect, seeded from the drive summary, "want to pick up
where you left off?"), armed once per connection and cancelled by speech.

Mechanically, an offered turn is a user-role instruction (`OPENING_NUDGE` /
`SILENCE_NUDGE`, mirrored from `prompt.ts`) added where the driver's words would
sit, followed by an `LLMRunFrame` — the same frame the user aggregator pushes —
so the completion runs through the ordinary gate, recorder, drafts and barge-in
plumbing. An offered turn that speaks is an `agent_turn` like any other; one
that declines leaves nothing but the `[offers]` log line. The templates keep
the sentinel available, so every unprompted turn is optional all the way down.
`PROACTIVE_OFFERS=false` restores the purely reactive behaviour for a study arm.
The eval suite covers the engine's turns (`offer-*` cases in `cases.ts`), with
the nudge standing in the driver's slot exactly as the container places it.

### talkback-12: the agent can see, and change, what it wrote down

Up to `talkback-11` the agent could write a draft and then had no idea it had.
Asked to change one it wrote a SECOND card from whatever it remembered of the
conversation, and the person was left with two, neither marked as superseding
the other — on the one lane of the screen they had asked for by name. On the
17 Sep 2026 drive the participant said so out loud: *"I wanted you to have
updated the evaluation use case prompt, but instead you just gave me updated
use case prompt."*

`talkback-12` puts this drive's drafts in the turn, each with a short handle, and
adds `revises="…"` to the keep section of `OUTPUT_CONTRACT`: the whole new text,
against a named draft, which the write path turns into the next VERSION of it.
The rules are narrow on purpose — only a draft they asked to change, only one
whose text is actually visible, anything else is a new draft, and never a handle
spoken aloud. See "Drafts" below for the mechanism, and
`draft-revise-when-asked` / `draft-new-when-different` /
`draft-seen-not-rewritten` in `cases.ts` for what it is held to.

### Which voice

Three ElevenLabs voices are offered on the recorder, from the catalogue in
`packages/talkback/src/voice.ts` — code, not env, so the choice is recoverable
per recording. It is stored on `capture_session.voice_id` at start, immutable
for the drive like the setting, and handed to the container by
`/api/realtime/session` as `voiceId`. The container never picks: it uses what
it is given, or `ELEVENLABS_VOICE_ID` when a session carries no choice (every
recording from before this existed, and every degraded connection). That env
var therefore stays required — set it to one of the catalogue ids.

The labels are placeholders ("Voice A/B/C") until someone has listened; the id
is the identity, rename freely. Adding a voice is one line in the catalogue and
no migration.

### Who is talking

Once the live STT hears a **second voice**, `SpeakerTagger` in `bot.py`
prefixes every transcript from then on with `[Speaker N]`, numbered in order
of first appearance so Speaker 1 is the driver. The tag is written into the
text on purpose — it is the one thing that reaches the LLM, the running
summary, the topic title's window and `agent_turn.respondingToText` alike.
`Recall` strips it before searching the ledger. A one-person drive is byte-for-byte what it was before:
nothing is tagged until there are two.

The prompt has a section for it: a conversation between the people in the car
is theirs, and the system speaks only when one of them addresses it — and then
to the one who asked.

**Only the hosted providers can tell.** Deepgram (`diarize=true`) labels every
word with a speaker index; AssemblyAI (`speaker_labels=true`) labels each turn
and puts it in `user_id`. Whisper through LiteLLM returns text and nothing else,
so on the default provider `STT_DIARIZE` is a no-op that logs once at connect.
Turn it off with `STT_DIARIZE=false`. The **ledger has no speakers**:
`utterance` is transcribed by batch Whisper, so speaker identity exists only on
the live path. A field study with passengers wants that asymmetry in the
ethics form and the limitations section both.

## Memory: recall by meaning, and where things stand

Recall used to be one thing: a lexical search over `utterance`, widened into a
20-second window around each hit. It still is, and it still runs first — an
exact name, project or number is what people most often ask to be reminded of,
and a word match is never a false friend. But it cannot find a paraphrase, and
it cannot answer "where were we on the field study", because that is a folded
state and has no lexical form in the ledger.

With `MODEL_EMBED` set, the worker builds a **memory index** (`memory_entry`)
with two kinds of row:

- **passage** — every ended drive, cut by `cutPassages` into stretches of ~40s
  or ~700 characters (a gap of 15s starts a new one), echo- and
  hallucination-filtered at index time so a read never cleans it again, and
  embedded once. Ended drives only: the live drive is the container's running
  summary, and a cut over a finished drive is final.
- **topic** — every live workspace topic rendered by `renderTopicForMemory` as
  `Topic: … / - claim / - Open: … / - Next: …`, hashed, and re-embedded only
  when the hash changes. The index always holds the CURRENT state of a topic
  and never a history; history is what passages are for.

On each turn `/api/realtime/context` runs both arms in parallel
(`buildTurnContext`): lexical over the ledger, and one embedding of what was
said against the index. Passages are merged lexical-first (`mergePassages`);
the two nearest topics come back as **threads**. The container puts threads
FIRST in its block — stable state before dated quotes — and `talkback-5` tells
the model to treat them as the person's own notes: never ask for a project it
already describes, and say so in one sentence when what was just said settles
an open question or contradicts a claim. That is the "stop making me explain
it again" requirement, met by the workspace the paper already builds.

Three properties worth holding onto:

- **Off without `MODEL_EMBED`**, and off is exactly the lexical route it
  replaced. No fallback role: a chat model is not an embedder.
- **Bounded on the hot path.** The query embedding has a 700ms timeout
  (`MEMORY_QUERY_TIMEOUT_MS`); on timeout or error the turn proceeds
  lexical-only with a warning. A cold self-hosted embedder shows up here first.
  Both searches are relevance-gated by cosine distance, so a question about
  nothing in particular gets nothing, as lexical search already does.
- **Derived, never authoritative.** Everything in `memory_entry` rebuilds from
  `utterance` and `workspace_op`; `pnpm memory:reindex` does it. The vector
  column is untyped so a model change is a re-index, not a migration — the
  cost is an exact scan instead of an HNSW index, which at one passage per 40s
  of speech is a few thousand rows for a whole study.

```sh
pnpm memory:status               # rows per user, models in use, drives waiting
pnpm memory:reindex              # after a MODEL_EMBED change
pnpm memory:show --user <id>     # the topic texts as the model reads them
```

**Ethics.** A hosted embedding model receives every passage and every query;
a self-hosted one keeps them at AU. Same line as `STT_PROVIDER`.

## Drafts: text you keep rather than hear

Ask for something to take away — "draft me an email to William", "write me a
prompt for that", "note that down" — and the model wraps it in `<draft
title="...">...</draft>`. The body is never spoken. It is stored and shown with
a Copy button. Ask to change it — "make it shorter", "warmer", "fix the name" —
and it comes back as `<draft revises="3f9a2c" …>`, a new VERSION of the same
draft rather than a second card.

The tags are declared in `OUTPUT_CONTRACT`, so they sit in the same
last-and-wins section as the `<silence>` sentinel and a composed stanza cannot
countermand them. `extractDrafts` (`prompt.ts`) and `extract_drafts` (`bot.py`)
are mirrors of each other; change one and change the other. Both sides have
their own copies of the same cases — `prompt.test.ts` and the Drafts section of
`test_bot.py` — so a change to one that is not ported fails on the other.

**Two paths, for two different failures.** `SilenceGate._for_speech` strips the
block from the *stream*, tag-safe across frame boundaries, so a body split as
`<dr` / `aft ti` / `tle="X">` never reaches TTS. Extraction then runs on the
*whole* completion at `LLMFullResponseEndFrame`, where a malformed or
unterminated tag can still be recovered. Holding the completion to split it
once would cost the full generation time on every turn — the trade `SilenceGate`
already refused.

**`agent_draft`, not `agent_turn`.** A draft was never spoken, so the echo
filter must never see it. `withoutEcho` deletes transcript lines matching what
the agent said aloud; filing a draft as a turn would teach it to delete the
participant's own words whenever they resembled something they had asked for.

**Durable on purpose.** The container POSTs to `/api/realtime/draft`
(ticket-authorised, ownership re-resolved), and both readers come from
Postgres — the live panel via `/api/record/cues`, and `/sessions/[id]`
afterwards. That matters most for `driving`, where `displayAllowed` is false and
the cue stream never opens: a draft asked for at 110 km/h is written, stored,
and waiting at the desk. It is also the one panel that is tappable, which the
cue panel's no-tap rule explicitly is not — there is no voice equivalent of
"put this on my clipboard".

### Versions

A draft is not one row. `agent_draft` is its IDENTITY — the drive, the offset,
the container's `seq` — and is never updated; `agent_draft_version` holds every
version, append-only, one row each. The same split as `capability` /
`capability_version`, and it is what makes a rewrite the SAME draft rather than
a second card claiming to be just as current.

**The agent owns the major, the person owns the minor.** v1.0 is what the agent
first wrote, the person editing it gives v1.1, an agent rewrite gives v2.0,
editing that gives v2.1. So the label on a card says, with nothing else
consulted, how many times the model tried and how much hand editing each attempt
needed.

**The newest version is always the current one.** A restore does not rewind: it
appends a copy of the chosen version with the next number and a note of where it
came from, so restoring v1.1 while at v1.3 gives v1.4 "restored from v1.1". The
record stays append-only and "what did they end up with" is
`order by (major, minor) desc limit 1` — never by `createdAt`, because the web
app and the container keep different clocks.

Both writers go through `appendDraftVersion`, which takes a row lock on the
lineage joined to `capture_session` (ownership and the read-then-append in one
transaction). It answers `unchanged` before `conflict`, so a double-submit costs
nothing rather than raising a conflict over a difference that does not exist. A
person's edit sends the version it was aimed at; a 409 hands back the head and
the editor keeps what was typed.

Editing, history and Restore live on `/sessions/[id]`. `/record` shows only
`v2.1 · 14:32` — enough that a rewrite landing in the same card is visible, and
nothing more, because that panel only exists where the hands are elsewhere.

### Handles, and `revises`

`/api/realtime/context` shows the agent the drafts from THIS drive
(`draft-context.ts`): a one-line listing of up to six, then as many bodies as fit
in 2000 characters, newest first. A body that does not fit is skipped whole and
marked "text not shown" — a truncated body is worse than none, because the model
cannot tell it is truncated and would rewrite the draft deleting the half it
never saw.

Each draft carries a six-hex-character handle derived from its LINEAGE id, so it
survives every rewrite and nothing is stored for it. To change a draft the model
writes the whole new text as `<draft revises="3f9a2c" title="…">`, and the route
resolves the handle against that drive's own drafts. Exactly one match becomes
the next version; none or several writes a NEW draft instead — the stance
`fold.ts` takes for a `revise_block` naming a block it cannot find. Losing the
link costs a version number; guessing wrong overwrites text somebody spent a
drive on.

The prompt says twice that a handle is never spoken: "three eff nine ay two see"
read to a driver is the `<silence>` failure again. `draft-seen-not-rewritten`
in the eval checks it.

`revises` is ABSENT on a new draft rather than empty, which is what lets an
older container and a newer web app — or the reverse — run together in either
deploy order.

### `seq` is seeded, not counted from zero

`DraftRecorder` numbers drafts with its own counter, and `agent_draft` is unique
on `(session, seq)` so a retried POST cannot leave two copies on the screen.
That idempotency is exactly what made a RECONNECT silent: a second container
counting from 0 again collided with rows the drive already had, and every draft
for the rest of the drive was accepted with a 200, logged as "stored", and
dropped. `/api/realtime/session` now returns `nextDraftSeq` from the ledger and
the container starts there.

## Web search

Ask something current — "when is the CHI deadline?", "look up what Pipecat's
latest release is" — and the agent searches a SearXNG instance and answers in a
sentence, naming the site. Off unless `SEARXNG_URL` is set (web app only); then
`/api/realtime/session` composes `webSearchSection()` — which carries today's
date, the only place the prompt does — into the prompt, offers
`search_web`, and names it in `webSearchTool` so the container can route it
without a tool name hard-coded in Python.

**What the driver hears, in order.** The call's `announcement` — a sentence the
model writes as a tool argument, in the language of the conversation — spoken
the moment the call arrives; `SearchingSound`, two soft rising blips every 1.2s,
starting under it and running until the result is back; then the answer, from
the completion Pipecat runs on the result. The announcement is an argument
rather than something the model says first because a model calling a tool
frequently says nothing, and the search would be dead air — which in a car
sounds like a dropped connection.

**The cue is a mixer, not frames.** Queued as audio frames it would interleave
with the announcement chunk by chunk. `SearchingSound` is summed into whatever
the transport sends, ducked to 30% under speech, faded over one chunk when it
stops. Pipecat marks the bot as speaking only for TTS and speech frames, so the
cue never holds off the driver's turn. Only drives offered search get a mixer:
it changes how the output transport paces audio.

**Cancelled by an interruption**, unlike a board edit. The model waits for the
result; if the driver starts talking, their words are what to answer, and a
search they talked over neither keeps the cue going nor comes back later.

**The announcement is an `agent_turn`**, because it reached the speaker and the
echo filter must know. It writes no `agent_decision` and does not take the
turn's `toolCalls` — the decisions are the completion that called the tool and
the one that answers, as for a board edit. `search_web` appears in the answering
turn's `toolCalls` with its latency, or `cancelled`.

**What reaches the model** is `searchResultForModel`: at most two direct
answers and five results as site, title and a 280-character snippet — no URLs,
since it must never read one out and prompt size is the biggest lever on
time-to-first-word. Failures come back as `ok: false` with a sentence to say.
The route gives SearXNG 5s; the container gives the route 7s.

**What leaves.** The query, which is the participant's question in the model's
words, goes to the instance and on to its engines. It is never logged, on
either side. A study that uses this needs it on the information sheet.

Setup failures look like search failures: a 403 is an instance without `json`
in `search.formats`, a 429 its bot limiter. The web log says which
(`[search] SearXNG answered 403`).

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

**STUN gets you as far as a desk, and no further.** Talk-back ran for months on
STUN alone because every test was a laptop on Wi-Fi, where hole-punching works.
The first drive on mobile data — 18 Sep 2026, Telekom — recorded four utterances
and heard nothing back. Carrier-grade NAT is typically symmetric, so the mapping
the phone learns from STUN is not the mapping the container sends to; no
candidate pair forms and ICE sits in `checking` until `Timeout establishing the
connection to the remote peer` about a minute later.

Three things make that hard to read. Nothing in the log names NAT. The pipeline
runs *perfectly* — the model composes an opening line, ElevenLabs synthesises it,
and it is spoken into a transport with nowhere to send it. And capture is
unaffected, because chunks upload over HTTPS on a different path entirely, so the
transcript fills on screen and the drive looks recorded and merely mute. The tell
is in the bot's own LLM context: no user message in it at all, only the silence
prompts.

The fix is the `coturn` service in `docker-compose.prod.yml`, and it is a relay
or nothing — no STUN configuration reaches a symmetric NAT, because the problem
is not discovery. `[ice] answer candidates:` in the container log now says which
path was actually offered; `relay=` in that line is the thing to look for, and a
`turn:` URL in `ICE_SERVERS` is NOT it (that variable is STUN only — a relay
needs a credential, which aiortc reads off the server object and not out of the
URL).

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
participant's words. Record **once per turn** — on `LLMFullResponseEndFrame`, or
on `InterruptionFrame` when the person spoke over it — never per text frame, and
never for a turn `SilenceGate` declined.

**Two people talking, and the record could not say so.** A seven-minute advisor
conversation (9 Sep 2026) produced five agent turns: "The", "So", "There",
"<sil", and one that narrated its own rule aloud, speaker tag included. The
fragments were replies cut off by the next speaker, but `TurnRecorder` never
sent `bargedIn`, so they were filed as complete turns and the `interrupted`
badge on `/sessions/[id]` could never light; "<sil" was an interrupted
`<silence>` that the gate's end-of-response fallback released to TTS.
`SilenceGate` now records on `InterruptionFrame` with `bargedIn` and
`truncatedAtMs`, drops a held partial sentinel instead of speaking it, holds a
reply that opens with `[` until the bracket closes, and strips `[Speaker N]`
from speech (`strip_speaker_tags`; the tag stays in `generatedText`). The
"spoke Xs" on an uninterrupted turn is still `len(text) / 14` — the container
never learns when playback ended — and the page shows it as `~`. The narrated
rule itself is a prompt failure; `two-people-narrated-rule` in `cases.ts` and
the `narrated decision` check in `checks.ts` hold the line there.

**`DEEPGRAM_UTTERANCE_END_MS` below 1000 kills live STT outright.** Deepgram
refuses the websocket with a bare `400 Unexpected error when initializing
websocket connection`, and the drive then looks exactly like a dead microphone:
the transport connects, VAD fires, `[in]`/`[stt]` audio frames climb, and no
transcript ever arrives, so the agent never answers. Measured against the live
API — 999 refused, 1000 accepted. Tuning it down for latency is the obvious
thing to try and it costs the whole conversation. `deepgram_utterance_end_ms()`
now clamps and warns, so the value can only make replies slower, never absent.

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

Two dials worth knowing: `DEEPGRAM_UTTERANCE_END_MS` (700 since 11 Sep 2026,
lowered from 1000 with the same trade it always had) is part of that
0.66s, and prompt size moves LLM TTFB more than anything else — 0.36s on a short
prompt against 2.2s with full recall injected.

**The largest term was the model, and it moved (11 Sep 2026).** "Responses are
too slow" re-opened the `MODEL_CONVERSE` question, and the eval harness settled
it with data rather than the 2025 note: on the talkback-6 prompt, 22 cases, one
run each, `cavi/medium` took 214ms for a full turn where
`anthropic/claude-sonnet-5` took 1943ms — and was *better* on the deterministic
checks (21/22 vs 19/22; sonnet spoke a speaker tag and broke the word cap)
while weaker on judged grounding (4.38 vs 4.95 — it invents opinion
justification and restates garble rather than flagging it). The one
hallucination that matters most, inventing transcript content, both decline.
Live default is the fast model; the reports live in this decision's history,
and `pnpm talkback:eval` re-runs it whenever the prompt moves.

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

## Evaluating the prompt

The prompt is data the paper depends on, and until now the only way to test a
change was to drive. There are now three layers, cheapest first.

**1. Unit tests** (`prompt.test.ts`) pin the composition: contract last,
proactivity between setting and contract, the sentinel surviving a hostile
section. Free, instant, and they say nothing about what the model does.

**2. The eval harness** — `pnpm talkback:eval` — runs the real conversation
model over a fixed set of turns in `packages/talkback/src/eval/cases.ts`, each
built exactly as `bot.py` builds one (`messages.ts` ports `Recall._compose`,
and a test pins the port). Two verdicts per turn:

- *Deterministic checks* (`checks.ts`): spoke or stayed silent as expected,
  under the setting's word cap, no preamble, no markdown, one question at most,
  mentions what it must and never what it must not. A failure here is a defect.
- *An LLM judge* (`judge.ts`): `MODEL_REASONING` scores the turn 1–5 on
  turn-decision, brevity, grounding and register with a one-line reason. A low
  score here is a question, not a defect — read the reply.

```sh
pnpm talkback:eval                                   # current prompt, all cases
pnpm talkback:eval --base candidate.md --label c7    # a candidate base prompt
pnpm talkback:eval --only stuck,passenger-aside --runs 3
pnpm talkback:eval --out report.json --strict        # exit 1 on any check failure
```

`--base` swaps the base prompt for a file's contents and leaves the setting
stanzas and the contract alone — that is the iteration loop. No temperature is
sent, as the container sends none, so `--runs 3` shows how wide the sampling is
before one failure is read as a regression. **Add real turns.** When a drive
turns up a behaviour worth keeping or losing, put the actual words in
`cases.ts`; the suite is a regression suite, not a benchmark.

**3. Langfuse, over live turns.** With `LANGFUSE_PUBLIC_KEY` and
`LANGFUSE_SECRET_KEY` set, `bot.py` exports Pipecat's OpenTelemetry spans to
Langfuse (`setup_langfuse_tracing`): one trace per drive, named by setting,
with `session.id` = the capture session, `langfuse.version` = the prompt
version, and the LLM span of every turn carrying the serialised messages — the
composed prompt, the context block, what was said — and the completion. That
is exactly what a judge needs to see. The attributes are built in one place,
`drive_span_attributes`, and tested there.

The host is `LANGFUSE_BASE_URL`, with the older `LANGFUSE_HOST` still accepted.
`LANGFUSE_TRACING_ENVIRONMENT` maps onto Langfuse's environment separation and
is unset by default — set it for both the container and the harness, or not at
all, because a drive and an eval run in different environments cannot be
compared. `session.id` is the current spelling of the session key and rides on
every span, so a session's cost is the sum of the generations under it;
`langfuse.session.id`, the older spelling, is sent alongside it for a
self-hosted server that has not been upgraded yet and can be dropped once
every target host is on v4.

Separately, every LiteLLM request from the container carries `metadata`
(`session_id`, `tags` with the `configVersion` and `setting:<s>`, `version`),
so the proxy's own request log attributes spend per drive and per prompt
version, and any callback the proxy is configured with sees the same keys.

*Is an LLM-as-judge in Langfuse reasonable?* Yes, with a clear view of what it
can and cannot see. Set up an evaluator on the container's LLM
generations (filter by tag `talkback-4`, by `langfuse.version`, or by trace
name) with `JUDGE_PROMPT`
from `judge.ts` as the template — one copy of the rubric, pasted — mapping
`{{input}}` to the generation's messages and `{{output}}` to its completion.
The judge can then score grounding against exactly what the model saw, and it
sees `<silence>` as a decision. Note that an observation evaluator reads one
observation and cannot reach its siblings or children, so every variable it
needs has to be on the observation it is pointed at. Compare score distributions across versions as
the prompt moves; that is the "improve over time" loop, and it needs no
instrumentation beyond what is here.

What it cannot judge is **timing**. A live turn's quality depends on when it
arrived — 400ms after a landed thought, or three seconds into the next one —
and neither the transcript nor the span carries that. `agent_turn`'s latency
columns are the record; read them alongside. It judges what the model
produced, not what was heard: the STT's mistakes are upstream. And it reads
participants' speech on whatever hosts Langfuse — the spans already do, so this
adds no new flow, but the ethics form should name it, and self-hosting is how
the line is avoided.

The harness closes the loop from the other side. With the same keys set, each
evaluated turn is exported through the Langfuse SDK (`@langfuse/tracing` with
`@langfuse/otel`) as a trace in one session (the run id) tagged `talkback-eval`
and the label: a root observation carrying the turn's input and the reply, the
reply generation and the judge's generation beneath it, and the check result
and the four scores against that root observation. Live drives and offline runs
then sit in one project under one rubric and one `version` field. Without the
keys nothing is exported and the run says so once.

That used to be one hand-built POST per turn to `/api/public/ingestion`. Two
things changed with it. Overall input and output now live on the **root
observation** — Langfuse's trace-level `input`/`output` are deprecated, so an
evaluator should be pointed at the root observation rather than at the trace.
And the session, tags and version are propagated into every child span rather
than set on the trace alone, which is what makes a session's cost add up.
Delivery is now batched: `flushLangfuse` at the end of a run is what gets the
tail of it out, where the old POST-per-turn needed no such step.

**Not built, deliberately:** a Langfuse *dataset* of the cases with dataset
runs. It is the natural next step once the case set stabilises, but today the
cases change with every drive and a file in the repo is the right home.

## Deploying the relay (coturn)

Nothing here is automatic. The `coturn` service ships in
`docker-compose.prod.yml`, but it starts with an empty secret and the app only
offers a relay once both halves are set — so a deploy that skips this looks
exactly like the deploy before it, right down to working from a desk.

**In Coolify, on this resource's environment variables:**

```
TURN_SECRET=<openssl rand -hex 32>
TURN_URLS=turn:voice.example.com:3478,turn:voice.example.com:3478?transport=tcp
```

`TURN_URLS` uses the same hostname Traefik already serves, because its DNS
already points at this host — coturn answers on 3478 beside Traefik's 443, not
through it. `TURN_REALM`, `TURN_TTL_SECONDS`, `TURN_MIN_PORT` and
`TURN_MAX_PORT` have working defaults.

**On the host firewall, and in the cloud provider's firewall if there is one:**

```
3478/udp   3478/tcp   49160-49179/udp
```

The relay range is the one place a partial configuration bites quietly: coturn
will accept the allocation, hand out a port nothing can reach, and the call
fails the same way it failed without TURN at all.

**A rebuild is not needed.** This was the point of moving ICE to
`/api/realtime/ice`: the browser fetches its configuration per connection rather
than reading a `NEXT_PUBLIC_` value inlined at build time, so TURN can be
repointed with a restart. `NEXT_PUBLIC_ICE_SERVERS` is only the fallback for when
that route cannot be reached.

**Confirming it works**, in descending order of how much it tells you:

1. `[ice] answer candidates:` in the pipecat log should list `relay=` alongside
   `host=` and `srflx=`. If TURN is configured and no relay appears, the line
   below it says so explicitly — that is a rejected credential or blocked UDP,
   not a browser problem.
2. `[talkback:pipecat] ICE: n server(s), relay available` in the phone's console.
3. A drive from mobile data with Wi-Fi switched off. This is the only test that
   would have caught the original fault, and it is worth doing on the carrier
   the study's participants actually use.

**What passes through it.** Only the calls that could not find a direct path —
the candidate pair still prefers a direct one, so a drive on home Wi-Fi is
unaffected. It runs on this host, so relayed audio reaches no third party, which
is the same line `STT_PROVIDER` and `LANGFUSE_HOST` are drawn on.

**What it is not.** coturn is a packet forwarder running inside your network, so
the `--denied-peer-ip` flags in the compose file are load-bearing: without them
an authenticated client can ask the relay to send to the database, the internal
Docker networks, or the cloud metadata endpoint. Do not drop them when adding a
peer range.

## Testing locally

```sh
pnpm talkback:up        # postgres + pipecat
pnpm talkback:logs      # follow the container
pnpm dev                # web + worker
```

`.env` needs both halves of the switch — `TALKBACK_ENABLED` and
`NEXT_PUBLIC_TALKBACK_ENABLED`, same value — plus `ELEVENLABS_API_KEY` and
`ELEVENLABS_VOICE_ID`, which `bot.py` reads with `os.environ[...]` and so crashes
without. The voice id is the fallback; the per-session choice comes from the
recorder (see "Which voice").

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

The container's own decisions — `SilenceGate`, `TurnRecorder` — have pytest
tests in `apps/pipecat/test_bot.py`. They need Pipecat, which is installed
only in the image, so they run inside the container:

```sh
docker cp apps/pipecat/. voice-workspace-pipecat-1:/tmp/pipecat-tests/
docker exec -u 0 voice-workspace-pipecat-1 sh -c \
  'pip install -q -r /tmp/pipecat-tests/requirements-dev.txt && chown -R 1001 /tmp/pipecat-tests'
docker exec -w /tmp/pipecat-tests voice-workspace-pipecat-1 python -m pytest -q
```

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
- **No proactivity engine.** The prompt is now forthcoming per setting, but
  nothing writes `agent_turn.kind = 'proactive_prompt'` and there is no
  silence timer in `bot.py`: the model can only speak on a turn the VAD gave
  it. The seeded `interview` mode still carries `silenceBeforePromptMs: 4000`
  with no engine behind it (and 4s is too eager for a car by this document's
  own argument — raise it when the engine lands). When it does, it should read
  `SETTING_PROFILES[s].proactivity`, which the prompt now also reads.

  **What it should be**, from the 9 Sep 2026 advisor discussion
  (`Meeting_Notes.md`): session-level, not a silence timer inside a thought.
  Three turns nobody asks for — an opening ("last time you were on X; the
  intro of Y has not come up"), a transition when a topic lands, sized to the
  time left ("that's landed — the next five-minute one is Z"), and a recap on
  re-entry. It OFFERS and never assigns ("I am the one who prompts. You don't
  prompt me."), and a declined offer is not repeated. Inputs that exist: the
  threads the memory index already serves, and per-topic recency in
  `trajectory.ts`. Inputs that do not: an expected drive length (learnable
  from past `capture_session` durations), and what a paper should cover, so
  "you haven't talked about the intro" is computable.
- **Speakers only on the live path, and only hosted.** Diarization needs
  Deepgram or AssemblyAI; the Whisper default hears one voice, and the ledger
  always does. A voice-print approach on AU hardware (pyannote) would close
  both gaps and is a real dependency to weigh, not a flag.
- **Voice labels are placeholders.** `voice.ts` names them A/B/C; nothing here
  can ask ElevenLabs for their names. Listen, rename, keep the ids.
- **Mode switching by voice is unbuilt.** A `switch to sceptical` direction is
  classified and recorded like any other, but nothing acts on it: the container
  fetches `/session` once per connection and never re-reads the prompt.
- **Memory has no explicit "decisions" type.** Threads are the workspace's
  topics, whose `claim` blocks carry decisions alongside ideas and
  conclusions. If drives show the model needing the distinction, the extractor
  is where to add it, not the index.
- **No cross-topic contradiction detection.** The index can say where each
  topic stands; nothing yet compares topics, or papers, against each other.
  That is the proactive-thread-tracking item, and it also needs the
  proactivity engine to deliver anything unasked.
- **Deepgram mishears accented English** — "I'm not so well, it's very late"
  became "I'm not so well at very late", on `language=en`. The live path now
  auto-detects (`multi` on Deepgram; see `STT_LANGUAGE` in .env.example), which
  also fixed what the hard-coding was hiding: a specific Deepgram language does
  not mishear other languages, it returns NOTHING for them — a German sentence
  came back an empty transcript with `en` and as perfect German with `multi`.
  Whether `multi` also hears accented English better is the open question;
  worth checking on a Danish/English drive.
- **Repetition degeneration still reaches retrieval.** The worker detects and
  "repairs" it, but repaired invented text is still invented.
- **Bluetooth HFP is unmeasured.** Playing TTS with the mic open may flip the
  link to narrowband and degrade the ledger on *every* drive. Needs a car.
