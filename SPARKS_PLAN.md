# Implementation plan: sparks, metacognitive monitoring on top of floor control

A work plan for a coding agent with **only this repository**, and for Anton. It turns the
concept of the paper draft ("ambient conversational spark") into code on top of the
floor-control work (`0e38399`, talkback-20).

Facts below were checked against branch `floor-control` at `0e38399` plus the uncommitted
recorder UI (`topic-list.tsx`, `conversation-view.tsx`) on 17 Oct 2026. File paths and line
numbers drift, so re-check each "current state" claim before you build on it.

> **Status, 19 Oct 2026.** Phases 1–5 are built (talkback-21). The study design in §6 is
> **superseded**: the Prolific between-subjects study (PROLIFIC.md) is parked, and sparks
> become the main feature of a one-week field deployment in which the person chooses what to
> keep ("Keep or hand over", talkback-22). What was built for it, and how it is evaluated, is
> §6a; TALKBACK.md "talkback-22: keeping" has the implementation.

---

## 1. The idea in one paragraph

Floor control lets the person decide **when** the agent speaks: Lock, Normal, Poke. Sparks let
them see **what they actually hold** and pull the right question at the right time. For every
subject of a drive, the user's side of the conversation computes a few signals: whose words
the subject is built on, whether they settled it, how sure they sounded, and whether it is
fading. From those it suggests **sparks**: short prompts such as "Say it back in your own
words", which the person pulls and the agent then asks. The agent never volunteers a spark.
It stays an offer, it is pulled through the poke the person already uses, and it is a
question back to them, never an answer. That is the design principle in code: relieve what
they hold, never relieve them of the thinking, and let them see which is which.

**Research claim to evaluate:** making visible where the thinking in a subject came from (you or
the AI), plus spoken confidence cues, and letting people pull retrieval prompts from that,
improves their metacognitive accuracy: how well their confidence about what they know
matches what they recall days later.

---

## 2. Terms

| Term | Meaning |
|---|---|
| **Subject** | A section of the live conversation, named by `TopicTitle` (bot.py), held in `Conversation.sections` (`apps/web/src/lib/talkback/conversation.ts`). |
| **Ordinal** | NEW. The subject's number in the order it first came up in this drive (1, 2, 3…). It is the only identifier that leaves the participant's account; titles never do. |
| **Cue** | A raw count from one user turn: pauses ≥ 2 s inside the turn, filler words, self-repairs, hedges. |
| **Signal** | Per subject, derived from cues and turns: `agentShare`, `settled`, `hesitation`, `fade`. |
| **Spark** | A suggested prompt for a subject, of one of four kinds (§3.3). Shown, pulled, then asked by the agent. |
| **Spark poke** | A poke that carries `{ kind, ordinal }`. It rides the existing poke machinery: always answered, re-run on decline, fixed fallback. |

---

## 3. Design decisions (settled here; change only with Anton)

### 3.1 Where each piece is computed

| Piece | Where | Why |
|---|---|---|
| Ordinals, subject segments (offsets on the utterance clock) | **Container** (`TopicTitle`) | It names subjects and knows the utterance clock. This also makes subjects survive a reload. |
| Pause cues (gaps inside a user turn) | **Container** (`PauseMarker` → `TurnFeed`) | Only the container has VAD timing. |
| Text cues (self-repairs, hedges, fillers) | **Browser**, shared TS in `@voicemural/shared` | The text is already there. One implementation is shared with the worker's metrics. |
| `settled` (did they state a decision or next step?) | **Container**, one small model call when a subject is left | It needs language understanding and must be live. The worker's extraction is too slow (15-25 s plus batches of 8) and its topics are not the live subjects. |
| Signals and spark rules | **Browser**, pure functions | Testable in vitest, instant, and explainable on screen. |
| Asking the spark | **Container** (spark poke → nudge) | Reuses Floor/`_start`/SilenceGate. |

### 3.2 Signals, per subject

- `userWords`, `agentWords`. `agentShare = agentWords / (userWords + agentWords)`, shown when
  there are at least 40 words in total.
- `settled: boolean | null`, from the container's check. Null means not judged yet.
- `hesitation`: per 100 user words, (pauses ≥ 2 s + fillers + self-repairs + hedges). Low,
  mid or high, against the person's own running median for the drive, never against other
  people.
- `fade`: a 0-1 score from a fixed formula: agent share, unsettled, visited once, and
  subjects or minutes since last touched. It ranks sparks. It is not shown as a number.

Every signal ships with a one-line reason in plain words ("mostly Souffleur's words"), and
no score is shown without one.

### 3.3 Spark kinds (four, fixed)

| Kind | Rule (first match wins, one spark per subject) | Question the agent asks (gist) |
|---|---|---|
| `say_back` | `agentShare ≥ 0.6` and they have not restated it since | "In your own words: where did you land on {subject}?" |
| `decide` | `settled === false` and ≥ 60 user words | "If you had to decide on {subject} now, what would it be?" |
| `unsure` | `hesitation` high for this subject | "What is making you unsure about {subject}?" |
| `revisit` | not current, `fade` in the top three, never returned to | "Want to go back to {subject}? What was still open?" |

At most three sparks are shown at once, ranked by `fade`. A spark that has been pulled is
done for that subject and drive.

### 3.4 The rules that keep it an offer

1. The agent **never raises a spark unasked**, in either floor mode. Eval cases enforce this.
2. A spark is a **question back to them**. The agent must not answer it itself (eval: no
   decision, no summary of their position).
3. Under **Lock**, sparks appear quietly on screen. There is no sound and no speech.
4. **While moving, nothing on screen is required**: `/study` says never to touch or read the
   phone while driving. In the car, sparks are reached by voice only (§5, phase 4). On-screen
   sparks are for parked, walking and dishes-type use, and for after the drive.

### 3.5 Privacy (this is what `/study` promises)

| Data | Stored | Exported to researchers |
|---|---|---|
| Subject titles, turn text | Container memory; titles also in a new `drive_subject.title` | **Never** (same rule as workspace titles and `capture_session.title`) |
| Ordinal, subject segments (offsets), signal counts, spark kinds shown and pulled | New tables (§4) | Yes: counts, ids, enums and offsets only |
| Recall probe: confidence, self-rated accuracy, provenance | New table (§4) | Yes: numbers and enums |
| Recall probe: their own words | **Not stored** | No |

The recall probe is a new instrument, and **the `/study` sheet must change before any
participant sees it**. It currently promises "three numbers after each drive" (§7).

---

## 4. Data model (migration 0025, additive)

1. **`drive_subject`**: `id`, `capture_session_id`, `ordinal` (unique per session), `title`
   (content, never exported), `first_offset_ms`, `created_at`. It is written by the container
   when a NEW subject is named (not on a return), through a new `POST /api/realtime/subject`
   (ticket auth, like `/api/realtime/title`).
2. **`drive_subject_segment`**: `(drive_subject_id, start_offset_ms, end_offset_ms)`, one row per
   visit. It is written when a subject is left and at the end of the drive. It is what lets the
   recall page show a subject's own speech later: utterances plus `agent_turn` rows in those
   ranges.
3. **`subject_signal`**: `drive_subject_id`, `user_words`, `agent_words`, `pauses`, `fillers`,
   `self_repairs`, `hedges`, `settled` (nullable boolean), `fade` (real), `sparks_shown`
   (`spark_kind[]`), `sparks_pulled` (`spark_kind[]`), `final` (boolean). It is posted by the
   browser at Stop, and on page hide as a best effort, through `POST /api/study/subject-signals`
   (session auth, ownership re-resolved as in `/api/study/response`). The last write wins.
4. **`spark_kind`** enum: `say_back | decide | unsure | revisit`.
5. **`agent_decision.spark_kind`**: a nullable `spark_kind` column. The trigger **stays `poke`**,
   so `forced_poke`, the retry, the fallback and the eval checks all keep working. The decision's
   `subjectKey` becomes `s{ordinal}` for spark pokes: an id, never a phrase.
6. **`recall_probe`**: `id`, `user_id`, `drive_subject_id`, `due_at`, `answered_at`,
   `confidence` (1-7), `self_accuracy` (1-7), `provenance` (`mine | souffleur | both | unsure`),
   `delay_days`. There is no text column.

Export v4 (`apps/worker/src/study/export.ts`) gains records `drive_subject` (ordinal and
offsets only), `subject_signal` and `recall_probe`, plus `sparkKind` on decisions. Seed
`SECRET` into `drive_subject.title` in `export.test.ts` and assert it never appears.

---

## 5. Phases

Each phase is shippable on its own. **Phase 0 is Anton's.**

### Phase 0: land the current recorder UI

Commit the uncommitted `topic-list.tsx`, `conversation-view.tsx`, `use-reduced-motion.ts`
and the panel changes on `floor-control`, so every later phase builds on a clean tree.

### Phase 1: signals on screen (browser only, no spark yet) · ~1 day

- `packages/shared/src/speech-cues.ts` (new):
  - move `isSelfRepair` from `apps/worker/src/study/steerability.ts`, and re-export it there so
    the worker's metrics stay identical;
  - add `countHedges(text)` ("maybe", "I think", "probably", "not sure", "vielleicht",
    "ich glaube"…) and `countFillers(text)` ("um", "uh", "äh", "ähm"; zero until fillers are on,
    phase 3);
  - tests in the style of `steerability.test.ts`.
- `apps/web/src/lib/talkback/conversation.ts`:
  - export `Turn`;
  - add `firstAt` and `lastAt` to `Section`, stamped in the store's `dispatch` from
    `Date.now()` so the reducer stays pure;
  - add optional `ordinal`, set when a `title` message carries one (phase 2 sends it). Until
    then, use local order.
- `apps/web/src/lib/talkback/signals.ts` (new): `signalsFor(section, drive)` and
  `sparksFor(sections)` as pure functions, implementing §3.2 and §3.3, with tests in the style of
  `conversation.test.ts` (`fold(...)` helpers).
- UI in `topic-list.tsx`:
  - per subject, a thin two-tone provenance bar (yours / Souffleur's), a settled or open mark,
    and the reason line under the chosen subject;
  - no numbers on screen;
  - inside `ph-no-capture`, as today.

**Done when** the signals render live on a pilot drive, vitest passes, and nothing is posted
anywhere yet.

### Phase 2: spark pokes · ~2 days

- **Browser**:
  - `use-pipecat.ts` poke: `sendClientRequest("poke", { spark: { kind, ordinal } })`.
    `Talkback.poke(spark?)`;
  - spark chips above the user panel in `conversation-view.tsx`, at most three, each ≥ 44 px.
    A tap sends a spark poke and shows the existing `POKE_NOTES`;
  - a pulled spark is greyed out for the rest of the drive.
- **Container (`bot.py`)**:
  - `TopicTitle` assigns ordinals to new titles and puts `"ordinal": n` in the title message.
    On reconnect, the browser sends `titles` as `[{title, ordinal}]`; update the parsing at
    bot ~5180;
  - `TopicTitle` POSTs a new subject to `/api/realtime/subject`, and segments when a subject is
    left or the drive ends;
  - `Floor.process_frame` passes `data.get("spark")` to `_poke_request(spark)`.
    `self._spark` lives beside `self._poke` and is cleared wherever `_clear_poke()` runs;
  - `_start()` picks the nudge: `SPARK_NUDGES[kind].format(subject=title_for(ordinal))` instead
    of `POKE_NUDGE`, and calls `note_offer("poke", subject_key=f"s{ordinal}",
    spark_kind=kind)`;
  - `SilenceGate`'s fallback for a declined spark poke is `SPARK_FALLBACKS[kind][language]`
    (the question itself, fixed), not "I'm listening". Each fixed line must clear the echo
    filter's `MIN_WORDS` (TALKBACK.md landmine: "a sentence the container speaks with no
    completion behind it…");
  - `TurnRecorder._decision` adds `sparkKind`.
- **Web routes**: `/api/realtime/subject` (new), and `sparkKind` on `/api/realtime/decision`.
- **Prompt, talkback-21** (`packages/talkback/src/prompt.ts`, mirrored in bot.py):
  - `SPARK_NUDGES`, `SPARK_RETRY_NUDGE` and `SPARK_FALLBACKS`;
  - a "WHEN THEY PULL A SPARK" stanza: ask the question about that subject in one or two
    sentences, do not answer it, do not summarise their position first;
  - bump `TALKBACK_CONFIG_VERSION` with a doc paragraph;
  - update the pins in `prompt.test.ts` and `test_bot.py`.
- **Eval** (`packages/talkback/src/eval/cases.ts`): one case per kind in EN and one per kind in
  DE (`poke: { spark }`), expecting `turn: "speak"` and a question about the subject, and failing
  on content that answers it. Add a "never volunteer" case: Normal mode with a fading subject,
  where the agent must not raise it.

**Done when** pytest passes in the container, `pnpm talkback:eval --strict --runs 3` passes
with the new cases, and a live drive works: pull each kind, then Lock, then spark again.

### Phase 3: speech cues · ~1 day

- **Pauses**: `PauseMarker` already measures gaps ≥ 2 s. It should also call
  `feed.note_pause(gap)` so `TurnFeed` counts pauses on the open user turn and sends
  `"pauses": n` with the user message. Pauses before the turn (the person thinking before
  speaking) and pauses inside it count the same in v1, but record them separately.
- **Fillers**: when `STT_PROVIDER=deepgram`, set `filler_words=true` through the settings'
  `extra` (forwarded as a query parameter). The browser counts them (phase 1 helper) and
  **strips them from the displayed text**. The model's context keeps them, so add one line to
  the prompt saying fillers are hesitation and not words to answer. Bump the prompt version.
  Recreate the container (TALKBACK.md landmine: `docker compose up -d` does not reread `.env`).
  The Whisper path has no fillers, so the signal degrades to pauses, repairs and hedges.
- **Settled**: on a subject change in `TopicTitle`, and at the end of the drive, make one call
  with the left subject's window and `SETTLED_PROMPT` (in `packages/talkback/src/title.ts`, like
  `TITLE_PROMPT`). The answer is `SETTLED` or `OPEN`; send `{"type":"state","ordinal":n,
  "settled":bool}`. The browser's `parseServerMessage` accepts it. Use `SUMMARISE_MODEL`,
  `max_tokens` 4 and temperature 0.

**Done when** the panel's hesitation and settled marks change during a drive as expected, and
pytest covers `note_pause`, the state message and the filler stripping.

### Phase 4: sparks by voice (the driving case) · ~1 day

- The browser sends the current top sparks to the container whenever they change:
  `sendClientRequest("sparks", [{kind, ordinal}])`. The container keeps the latest list.
- The prompt adds: if they ask for a spark ("anything I should check?", "spark", "frag mich
  was"), ask the top one. Never otherwise.
- Eval: an ask-for-a-spark case per language, plus the "never volunteer" case from phase 2 run
  again with the list in context.

**Done when** a drive with the phone untouched can pull a spark by voice.

### Phase 5: persistence, recall probe, study arm · ~2-3 days

- Migration 0025 (§4), the routes, and export v4 with sentinel tests.
- The browser posts `subject_signal` at Stop, and on `visibilitychange` to hidden as a best
  effort.
- **Recall probe** (`/recall`, session auth):
  - **Selection**: 48 h after a drive, pick up to three of its subjects: every pulled one (up
    to two) plus a random sample of the rest. Store them as `recall_probe` rows with `due_at`.
  - **Delivery**: a card on non-recording screens when a probe is due (`canShowSurvey` rules:
    never on `/record`, never while recording). There is no push.
  - **Flow per subject**:
    1. show the title only, then ask "How well do you remember where you landed?" (1-7);
    2. "Say it or type it to yourself" (not stored);
    3. reveal their own speech for that subject, from `drive_subject_segment` ranges over
       `utterance` plus `agent_turn`;
    4. "How close was your recall?" (1-7);
    5. "Whose idea was this mostly?" (mine / Souffleur's / both / not sure).
  - The provenance answer validates the word-share proxy.
- **Study arm**:
  - `StudyCondition.sparks: z.boolean().default(false)` (`packages/shared/src/contracts.ts`);
  - update the pinned defaults in `contracts.test.ts`;
  - add `sparks` to `TOGGLEABLE` in `condition-store.ts` for pilots;
  - the browser needs the drive's condition, which nothing reads today, so return it from
    `POST /api/capture-sessions` and hold it in the recorder;
  - **With the arm off**: signals are still computed and persisted (needed to test whether they
    predict recall), but no spark chips are shown and there are no spark pokes. A plain poke
    still works.
- **Metrics**: a `sparks` group in `metrics.ts` (pulled per drive, by kind; signal summaries).
  Bump `METRICS_VERSION`, which was missed when `floorControl` was added.

**Done when** export v4 contains no titles (sentinel), a probe can be answered end to end on
fixtures, and `study:condition --set '{"sparks":true}'` flips the next drive.

### Phase 6: pilot · 1 week

- Anton for a few drives (autobiographical, reported separately).
- Two colleagues, one per order.
- Check:
  - sparks fire at a sensible rate (aim for 1-3 per drive);
  - the reasons read as offers, not verdicts;
  - recall probes arrive and get answered;
  - export v4 is clean.
- Tune the §3.2 and §3.3 thresholds **before** the study, then freeze them (a version
  constant in `signals.ts`, exported).

---

## 6. Study design (evaluation)

- **Design**: within each person, two blocks of about five to seven days, `sparks` off and on.
  Each person is randomly assigned an order (off→on or on→off), in equal numbers. Floor control
  is available in both blocks. That makes it one variable, which the focus group asked for.
- **Task**: the same general instruction in both blocks ("think through your open work
  projects on your commute or chores"), with free choice of subjects.
- **Participants**: about 12-16, beyond the colleague group if possible (the focus group's
  "who is the target group?").
- **Primary measures** (per subject, from the recall probe):
  - metacognitive bias: mean confidence minus self-rated accuracy;
  - sensitivity: how well confidence separates good from poor recall (AUROC);
  - both compared within each person, off vs on.
- **Secondary measures**:
  - recall accuracy;
  - the provenance answer against `agentShare` (does the proxy hold?);
  - sparks pulled per drive and per kind;
  - `floor_control` and `thinking_moved` ratings.
- **Analysis**: per-person patterns first, as in the analysis board on the canvas. Then a
  mixed model with person as a random effect, and order as a check.

## 6a. The field week with Keep (19 Oct 2026; supersedes §6)

- **The feature.** On a `chosen` day the person keeps the subjects they want to hold in their
  own head — a tap on Keep in their panel, or "keep this one" said aloud — and Souffleur holds
  the rest. Sparks are offered only on kept subjects. On a `suggested` day the signals pick, as
  in phases 1–5. The motivation to remember is theirs, not pushed on them.
- **Design.** One week per person, `sparkSelection: "alternate"`: the mode flips by calendar
  day in `STUDY_TIME_ZONE` from `alternateFrom`, and `alternateStart` is counterbalanced across
  people. Each drive is frozen to its day's mode. Set per person with
  `pnpm study:condition --user <id> --set '{"sparks":true,"sparkSelection":"alternate","alternateFrom":"2026-10-27","alternateStart":"chosen"}'`.
- **What is recorded.** `subject_signal.kept / kept_via / kept_at`; recall probes prefer kept
  subjects (up to two) and still draw one Souffleur held. Export v5, metrics v3
  (`sparksByMode`).
- **Qualitative core.** The end-of-week questionnaire `/survey/week` (adapted IMI items on
  choosing, incident questions, preferred mode, interview opt-in; `pnpm study:week`), then an
  interview or focus group. `/my-week` shows each person their own week to remember it by.
- **Before anyone starts.** Ethics amendment for keeping, the questionnaire and the interview;
  fill the placeholders on `/study`; one pilot day in each mode.

---

## 7. Before any participant (Anton)

1. **Update `/study`**: the recall probe and what it stores (numbers only; your own words stay
   unrecorded). Its "three numbers" sentences are hard-coded text (`study/page.tsx` ~l.99,
   135, 152).
2. Ethics and consent amendment for the probe and the new arm.
3. Fix the stale parts of EVALUATION_PLAN.md: §5.3, §9.3 and T3.1 still describe the removed
   debrief window, and the §8 item 5 still names the cue panel.

---

## 8. Definition of done (every phase)

As in EVALUATION_PLAN.md §8:
- typecheck and tests with Postgres up, checking the counts so nothing silently skipped;
- migrations generated and applied;
- pytest inside the container for bot.py;
- prompt changes: version bumped and `--strict --runs 3`;
- mirrored constants identical in `prompt.ts` and bot.py;
- a live drive through the real container;
- **plus**: no subject title in any export or log line (sentinel tests), and no spark spoken
  that the person did not pull (eval).

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Word share is not authorship (the agent rephrases their idea) | The probe's provenance question validates it. Present it as "words", never as "ideas". |
| "You sounded unsure" feels like being judged | Reasons are worded as offers. Compared only against their own median. Pilot wording first. |
| Sparks while driving pull attention to the screen | Voice pull (phase 4). Nothing on screen is needed while moving. |
| Subjects lost on reload | `drive_subject` and segments are written by the container (phase 2). |
| Scope creep | Phases ship separately. Phases 1-2 alone are a demo. Phases 1-5 are needed for the study. |
| Timeline | Build about 8-10 working days, pilot 1 week, study 2-3 weeks. The next IMWUT round (1 Feb) is realistic; 1 Nov is not. |

---

## 10. Open decisions for Anton

1. Are the four spark kinds right, or should one be swapped (e.g., a "recollector":
   "what was I on before this?", from the focus group)?
2. Recall probe delay: 48 h (proposed) or 7 days?
3. Turn on Deepgram filler words in production, given that fillers then also reach the model
   (prompt note in phase 3)?
4. Is the study's setting the commute only, or any hands-busy moment? This decides whether
   phase 4 is required.
