# Pilot 01, and what it changed

One formative pilot, 19 September 2026: a first-time user, German, seated
indoors, five minutes and forty-four seconds. `capture_session`
`8e14deb1-81aa-494b-97ce-7a3b02a88301`, `setting = driving`,
`stt_language = de`, prompt `talkback-12`, study condition
`{agendaOffers: false, proactiveOffers: true, voiceMacroOffers: false}`.

**Nothing in that session failed.** No turn carries an error, the relay held,
and the ledger ran to 3.7s before Stop. Everything below was behaviour working
as written, where what was written was wrong.

| Measure | Value |
|---|---|
| Agent turns | 15 (14 `reply`, 1 `proactive_prompt`) |
| Turn opportunities that produced no speech | 17 of 32 distinct (53%) |
| `total_latency_ms`, no tool call | median 1349 ms |
| `total_latency_ms`, with a tool call | median 8416 ms |
| Tool execution itself | `add_task` 48–52 ms, `search_web` 651–766 ms |
| Turn errors | 0 |

---

## 1. What shipped

Each of these has its own commit, with the failure it closes in the message.

| | What it was | Where it lives now |
|---|---|---|
| P0.1 | The agent asked a question, was told "Ja.", and answered `<silence>` | `AnswerGuard` in `bot.py`, the WHEN TO SPEAK rule in `prompt.ts` (talkback-13) |
| P0.2 | A `silence_offer` fired 52s after `ended_at` and spoke into a stopped drive | `resolveLiveSession`, `TurnRecorder.session_ended`, the client's `teardown` |
| P0.3 | Tool turns took 8.4s against 1.3s, silent throughout | `KeepAlive` in `bot.py`, `SEARCH_WAIT_PHRASES` in `prompt.ts` |
| P1.1 | `resolved_model`, `asr_ms`, `speak_ttfb_ms` empty; the end of speech guessed | `Playback` in `bot.py`, `agent_turn.end_offset_measured` |
| P1.2 | 16 of 48 decision rows shared an `offset_ms` with another | `agent_decision.opportunity_seq` / `attempt`, and the counting rule in the schema |
| P1.3 | The best material came after `ended_at` and only exists on camera | the debrief window on `/record`, `capture_session.debrief_*_offset_ms` |
| P2.1 | Two `create_topic` ops titled "Montag", 3ms apart | `withBoardLock` |
| P2.2 | A German drive's blocks and summary came out half in English | `segmentsLanguage`, `summaryPromptFor` (PROMPT_VERSION "6") |
| P2.3 | "Fitnessstudio schafft **er** …" — a gender from nothing | the no-gender rule in the extraction prompt |

---

## 2. Proper nouns: half established, half not

`workspace_op` seq 203 recorded Altenholz as "Alkenholz". Seq 190 recorded her
question about when to leave with a time buffer as *"When can board at 'de
Bost' street in Hamburg?"*. The question was which stage introduced each.

**Seq 190 is the extractor, and is fixed.** This can be settled from the code
without the database. The ledger is transcribed by Whisper with the drive's own
language forced (`transcribe-chunk.ts` passes `language: stt_language`), and
Whisper transcribes — it does not translate. So an English sentence in
`workspace_op` on a German drive cannot have arrived from the ledger in
English: the extractor wrote it, because nothing had told it which language to
write in. That is exactly the P2.2 defect. A model rewriting a sentence into
another language is also re-rendering the proper nouns in it, which is the most
likely source of "de Bost". **Re-check this example on the next German drive
under `PROMPT_VERSION` "6" before concluding anything about ASR from it.**

**Seq 203 is not established.** A single-consonant substitution inside an
otherwise intact German word is characteristic of ASR rather than of a model
copying text it can see, but that is an argument, not evidence. This settles
it:

```sql
\set sid '8e14deb1-81aa-494b-97ce-7a3b02a88301'
select start_offset_ms, text
from utterance
where capture_session_id = :'sid' and text ilike '%enholz%'
order by start_offset_ms;
```

If the ledger already says "Alkenholz", this is not a task — it is a known
limit of Whisper on a German place name, and belongs in the paper's threats to
validity rather than in a backlog. If the ledger says "Altenholz" and the op
says "Alkenholz", the extractor mangled a proper noun it could see, which is a
different and more serious problem.

Nothing exports transcript text (see §4.1 of `EVALUATION_PLAN.md`), so this
query is the check, not a dashboard.

---

## 3. Not tasks, but worth having written down

**The setting was `driving` for a session conducted on a sofa.** That was
deliberate — the three sessions that followed used `desk` and `hands_busy` —
and it means this session tested the driving profile: 25-word cap, pauses
treated as thinking, forthcomingness sparing. Much of the silence in it is that
profile behaving correctly under a false premise. Nothing to fix, and a lot to
be careful about when reading the numbers above. In particular, the 53% figure
is a driving-profile number from a sofa.

**The opening was offered and declined.** The first decision row is
`opening -> declined` at offset 4009 ms after 399 ms of deliberation. The
machinery ran; the model chose silence; the participant then could not start
unaided and twice asked what she was supposed to do.

**An experiment that should happen before an opening turn is built.** Run the
same task once with `agendaOffers: true` and see whether a first-time user can
begin without help. It is cheaper than any of the work above, and it may change
what P0.1's rule needs to say — the answer guard makes the agent finish what it
starts, but nothing yet makes it start.

**A flake to watch, not introduced here.** Running the whole suite with turbo's
packages in parallel against one Postgres, `classify-utterance.test.ts >
records an improvised operation with no capability behind it` failed once and
then passed on every repeat. It is a cross-package interference, not a
regression; if it recurs, the fix is per-package isolation of the test user
rows rather than a retry.
