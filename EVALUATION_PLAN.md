# Research plan: make VoiceMural ready for the field study

A work plan for a coding agent that has **only this repository**. Everything you need from the
research side is summarised here; do not go looking for the paper or the cited literature.

Facts below were checked against `develop` at commit `c0bf9e8` (13 Sep 2026). File paths and
line numbers drift, so re-check each "current state" claim before you build on it.

---

## 1. Goal

VoiceMural is going into a **longitudinal field deployment**. Each participant records about 10
days of ordinary commutes. Postgres is the measurement record for that study. Anything not
written there during a drive cannot be recovered afterwards.

This plan makes the system able to measure three research threads, and to vary some behaviour
between participants or study phases:

- **A. Human-AI interaction guidelines specific to voice.** An established set of 18 guidelines
  (§3.1) was written for products with screens. Voice assistants fit them worst. VoiceMural works
  with no screen and with the user's attention on another task, so it can show what each
  guideline means in that situation.
- **B. Metacognitive support.** The system helps the user plan, check their own thinking, and
  manage their time (§3.2), without adding load while they drive.
- **C. Macros as automation strategy.** The system spots operations the user improvises again
  and again and offers to turn them into reusable capabilities. Whether the user accepts is a
  decision about what to automate, and we want to measure that decision.

Work in tier order. **Tier 0 and Tier 1 must be done before the first participant starts.**
Tier 2 holds the behaviours the study varies. Tier 3 holds the measures.

> **Pilot 01 changed what this plan measures.** See §9 for the failures and
> §10 for the reframing. The short version: the system ran without a single
> error and failed the participant anyway, because everything this plan
> measured was a property of the system rather than of the person using it.
>
> The measures now run in four groups — system behaviour, steerability,
> thinking, relief — under one principle:
>
> > **Relieve what they are HOLDING. Never relieve them of the THINKING.**
>
> Throughput is not the goal, and neither is relief on its own: a system that
> did the thinking would score beautifully on mental load. A system that writes
> many items to the board and never brings them back has failed; so has one
> that leaves the person with nothing left to think about.

---

## 2. Orientation

### 2.1 Read these first, in this order

1. `README.md`: architecture, the capture path, the data model rules, commands.
2. `TALKBACK.md`: the live voice agent. Covers the prompt layers, the proactive "offers", memory,
   drafts, confirmations, the eval harness, and **a list of known pitfalls in the voice stack
   (its "Landmines" section)**.
3. `Notes.md`: the design idea. Capability types (mode, persona, action, rule); direction versus
   content; macro "crystallisation".
4. `apps/web/src/app/study/page.tsx`: the participant information sheet. It holds the promises
   the study makes, and several are not built yet (§4).
5. `packages/db/src/schema.ts`: its header comments explain why every table is shaped the way it
   is.

### 2.2 System in one screen

| Unit | Role |
|---|---|
| `apps/web` | Next.js app. Recorder PWA (`/record`), workspace, board, timeline, repertoire, session transcript (`/sessions/[id]`), `/study`, and all API routes |
| `apps/worker` | pg-boss jobs: transcribe chunk, classify utterance (content vs direction), extract workspace, invoke capability, detect macros, index memory, idle sweep |
| `apps/pipecat/bot.py` | Python voice agent (Pipecat, peer-to-peer WebRTC). Key classes: `RunningSummary`, `Recall`, `Offers` (unprompted turns), `TurnRecorder`, `SilenceGate` |
| `packages/db` | Drizzle schema, migrations, queries (`repertoire.ts`, `workspace.ts`, `board.ts`, …) |
| `packages/talkback` | Everything the agent knows: `prompt.ts`, `setting.ts`, `context.ts`, `agent-turns.ts`, `memory-search.ts`, `board-context.ts`, and `eval/` |
| `packages/workspace` | Pure logic: extraction prompt and parser, op-log fold, board and `judge()`, trajectory, classifier prompt, macro miner |
| `packages/shared` | Zod contracts, analytics event types, the lexical directive gate |

There are two separate audio paths:
- **Ledger path.** 10-second chunks, batch Whisper, append-only `utterance` rows, then
  classification and workspace extraction.
- **Live path.** The browser talks over WebRTC to the Pipecat container, which uses the web app's
  `/api/realtime/*` routes for session setup, per-turn context and turn records.

### 2.3 Running it

```bash
cp .env.example .env
docker compose up -d        # Postgres (pgvector); pg-boss lives in the same DB
pnpm install
pnpm db:migrate
pnpm db:fixtures            # demo sessions; the UI renders without any model keys
pnpm dev                    # web :3000 + worker
```

**Live voice agent.**
- `pnpm talkback:up` starts it; `pnpm talkback:logs` follows the container.
- `.env` must set both `TALKBACK_ENABLED` and `NEXT_PUBLIC_TALKBACK_ENABLED`, plus
  `ELEVENLABS_API_KEY` and `ELEVENLABS_VOICE_ID`.
- Real model calls need `LITELLM_BASE_URL` and `LITELLM_API_KEY`.
- **With no model keys**, you can still do schema work, UI work, unit tests and fixtures.

**Board page.** It is hidden per user until you run
`UPDATE "user" SET board_enabled_at = now() WHERE id = '…'`.

**Checks.**

| What | Command | Watch out for |
|---|---|---|
| Types | `pnpm typecheck` | Misses client components that import server-only packages. Run `pnpm build` too. |
| Unit tests | `pnpm test` | **Run with Postgres up.** DB tests skip themselves silently; check the counts, not the colour. |
| `bot.py` tests | pytest, inside the container | Command is in `TALKBACK.md` → "Testing locally". |
| Prompt eval | `pnpm talkback:eval` | Needs LiteLLM keys. |
| Container env | `docker compose up -d --force-recreate` | Without `--force-recreate`, `.env` changes are not picked up. |

**`packages/workspace/src/extract.ts` looks binary to grep.** Use `grep -a`.

---

## 3. Research concepts the tasks refer to

### 3.1 The 18 human-AI interaction guidelines (G1–G18)

| # | Guideline | # | Guideline |
|---|---|---|---|
| G1 | Make clear what the system can do | G10 | Scope services when in doubt (disambiguate or degrade gracefully) |
| G2 | Make clear how well the system can do it | G11 | Make clear why the system did what it did |
| G3 | Time services based on the user's current task and environment | G12 | Remember recent interactions |
| G4 | Show contextually relevant information | G13 | Learn from user behaviour |
| G5 | Match relevant social norms | G14 | Update and adapt cautiously |
| G6 | Mitigate social biases | G15 | Encourage granular feedback |
| G7 | Support efficient invocation | G16 | Convey the consequences of user actions |
| G8 | Support efficient dismissal | G17 | Provide global controls |
| G9 | Support efficient correction | G18 | Notify users about changes |

**Audit of the current code:**
- **Strong:** G3 (setting profiles, offer rules, surveys blocked while recording), G4, G12, G14.
- **Partial:** G1, G5, G6, G7, G8 (dismissals not stored), G13, G15.
- **Weak or regressed:** G2, G9, G10, G11, G16, G17, G18.

The tasks below fix the gaps the study needs.

**Design idea: deferred guideline satisfaction.** While driving there is no screen, so G11
("why"), G16 and G18 cannot be met in the moment. Each gets two forms:
- a **spoken form** now, one clause at most;
- a **desk form** later, on `/sessions/[id]` or the workspace pages.

`SETTING_PROFILES[s].displayAllowed` already decides which form applies.

### 3.2 Metacognition terms

- **Planning:** clarifying goals and breaking work into steps. For example, an agenda at the
  start of a drive.
- **Self-evaluation:** prompts that make users reflect on their own thinking or on AI output.
- **Self-management:** managing time, setting and workflow. For example, "this topic has landed,
  the next five-minute topic is Z".
- **Fading:** support prompts should decrease as the user internalises the strategy, over days
  and not only within one drive.
- **Processing fluency:** fast, fluent output inflates confidence in it. **Design tension:** the
  prompt tells the agent *"Commit to a view; a hedge is a wasted sentence"*, and a fluent voice
  talking to a driver who cannot check anything invites over-trust (G2). The fix is not hedging.
  It is **naming the source in one clause** ("from Tuesday's drive…") (T2.2).
- **Calibration:** whether a user's confidence in AI output matches its actual accuracy.
- **Attention investment:** a user automates only when the expected saving beats the cost of
  setting up the automation. A macro proposal shows up at the moment that trade-off is visible.

**Constraint from the advisor's feedback (9 Sep):** *"I am the one who prompts. You don't prompt
me."* Unprompted support must **offer and never assign**. A declined offer must not come back.

---

## 4. Hard constraints for every task

1. **Privacy boundary** (promised on `/study`). "No one on the research team listens to your
   drives or reads your transcripts." What researchers see is **counts and timings**. The only
   content that reaches researchers is:
   - the post-drive debrief,
   - anything the participant marks as shareable (**not built**),
   - what they show in the exit interview.

   Any export, event or dashboard that leaks transcript, agent-turn or workspace **text** breaks
   the study.
2. **The ledger never depends on the conversation.** Kill the Pipecat container mid-recording:
   - the timer, chunk uploads, `/sessions/[id]` and the cue panel on `/record` must keep working;
   - live ASR text never goes into `utterance`;
   - agent speech never goes into `utterance`.
3. **Append-only record.** `utterance.text` is never changed. Human corrections go to
   `kindOverride` or to `workspace_op` rows with `via: "user"`. `capability_version` is
   append-only. Declined `macro_proposal` rows are kept.
4. **Separate tables by construction.** `agent_turn` is the echo filter's only input
   (`withoutEcho` in `packages/talkback/src/echo.ts`). Never put rows for turns that were not
   spoken into it. Add a new table instead.
5. **Per-session values are fixed at session start.** `capture_session.setting` and
   `capture_session.voiceId` never change after insert (`apps/web/src/app/api/capture-sessions/route.ts`).
   Study conditions follow the same rule.
6. **Prompt layering.** `composeSystemPrompt` (`packages/talkback/src/prompt.ts`) builds, in
   order: identity → setting → proactivity → [new sections] → `OUTPUT_CONTRACT`. **The contract
   must stay last.** `prompt.test.ts` enforces this with a hostile section.
7. **Mirrored code must stay in sync:**
   - `PROACTIVE_AFTER_SECS` in `setting.ts` and `bot.py`;
   - `OPENING_NUDGE` and `SILENCE_NUDGE` in `prompt.ts` and `bot.py`;
   - `extractDrafts` and `extract_drafts`;
   - `Recall._compose` in `bot.py` and `packages/talkback/src/eval/messages.ts`.

   Change one side, change the other.
8. **Version bumps.**

   | Change | Bump | Also |
   |---|---|---|
   | Talk-back prompt | `TALKBACK_CONFIG_VERSION` (`prompt.ts`, now `"talkback-12"`) | |
   | Extraction prompt or input | `PROMPT_VERSION` (`packages/workspace/src/extract.ts`, now `"4"`) | Update the fingerprint test in `extract.test.ts` |
   | Classifier or macro prompt | `CLASSIFY_PROMPT_VERSION` / `MACRO_PROMPT_VERSION` | |
9. **Every new spoken behaviour gets eval cases** in `packages/talkback/src/eval/cases.ts`, and
   `pnpm talkback:eval --strict` must pass.
10. **Client bundles.** Client components import setting profiles from
    `@voicemural/talkback/setting`, never from the package index, because the index pulls in the
    Postgres driver.
11. **Schema changes** are additive Drizzle migrations (`pnpm db:generate`, then
    `pnpm db:migrate`). `packages/db` and `packages/shared` are shared contracts, so keep changes
    minimal and explain them in the commit.
12. **Match the house style.** Comments explain *why*, often at length. Follow that.
13. **Git.**
    - Branch from `develop`, one branch per task or small group of tasks.
    - The working tree may contain the maintainer's uncommitted work (at the time of writing:
      timeline agent turns in `packages/db/src/workspace.ts`, `apps/web/src/app/timeline/*`,
      `apps/web/src/components/agent-turn-bubble.tsx`, `apps/web/src/app/sessions/[id]/transcript.tsx`).
      Do not revert it, and do not fold it into your commits.
    - Commit only when asked.

---

## 5. Ask the maintainers before building

Do not settle these yourself:

1. **Which Tier 2 behaviours become study conditions** (at most two), and the assignment design:
   phases per participant, and in which order. The study already uses phases; see
   `user.board_enabled_at` and the undisclosed repertoire phase described in the `/study` header
   comment.
2. **Promises on `/study` that are not built.**
   - "Interview me": modes and personas are never loaded into the prompt.
   - "Make a diary entry": rules never fire.
   - "Send it to the doc": outlets are not implemented.

   Build them, or remove them from the page?
3. **Debrief format.** `/study` says three fixed questions appear after Stop and are **answered
   aloud** (T3.1). Are on-screen ratings allowed as well, e.g. for confidence and calibration?
4. **"Mark as shareable".** It is promised but has no mechanism. Is it needed for the study?

---

## 6. Tasks

Each task lists **Why**, **Now** (verified current state), **Change**, and **Done when**.

### Tier 0: fix what would make study data invalid

#### T0.1 Record every turn decision, including silences

- **Why:**
  - A silence the agent chose and a declined offer are data for G3 and G8.
  - The rule "a declined offer is never repeated" needs a stored record.
- **Now:**
  - `SilenceGate` turns a `<silence>` reply into nothing but a log line.
  - `Offers` (`bot.py`, class at ~L1012) logs `[offers]` only.
  - `TurnRecorder.record` (~L1245) returns early when nothing was spoken.
- **Change:**
  1. New table `agent_decision`, append-only, with:
     - `captureSessionId`, `seq`, `offsetMs`
     - `trigger`: `user_turn | opening | silence_offer | confirmation | macro_offer | agenda`
     - `outcome`: `spoke | declined | interrupted | error`
     - `configVersion`, `latencyMs`
     - optional `subjectKey` (topic or proposal id, for "never repeat")
     - optional `agentTurnId`
  2. New ticket-authorised route `apps/web/src/app/api/realtime/decision/route.ts`. Copy the
     auth and ownership re-resolution from `apps/web/src/app/api/realtime/agent-turn/route.ts`.
  3. `bot.py` posts to it fire-and-forget, in the style of `TurnRecorder._post`.
- **Done when:**
  - pytest covers a declined user turn, a declined offer and an interrupted turn.
  - A local session shows the rows.
  - `agent_turn` gets no rows for silences.
  - Echo filter tests are unchanged.

#### T0.2 Fill the empty `agent_turn` fields

- **Why:** analysis must tell unprompted turns from replies, and must know which prompt version
  produced each turn.
- **Now:**
  - The `agent_turn` schema has `kind` (`reply | proactive_prompt | confirmation_request | backchannel`),
    `configVersion`, model and latency columns.
  - The route's Zod `Body` accepts latency and `resolvedModel` fields, but **not `kind` or
    `configVersion`**.
  - `TurnRecorder.record` sends none of these, so `kind` is always `reply`.
  - `/api/realtime/session` already returns `configVersion` to the container.
- **Change:**
  1. Add `kind` and `configVersion` to the route body and to `recordAgentTurn`
     (`packages/talkback/src/agent-turns.ts`).
  2. In `bot.py`, pass the kind from `Offers` (opening and silence nudges → `proactive_prompt`)
     and from the confirmation path (T0.3).
  3. Send the latency values the pipeline already measures.
- **Done when:** an offered turn is stored with `kind='proactive_prompt'` and the session's
  `configVersion`, and pytest covers both.

#### T0.3 Settle spoken confirmations

- **Why:**
  - Actions that are outbound or cannot be undone wait for a spoken yes or no.
  - Right now the answer is never recorded, and the same ask is re-injected on every turn of the
    drive.
- **Now:**
  - The context route `apps/web/src/app/api/realtime/context/route.ts` returns `pending` from
    `pendingConfirmation(sessionId)` (`packages/db/src/repertoire.ts:322`), including
    `invocationId`.
  - `bot.py` `Recall` appends an ask (log line `[recall] pending confirmation …`, ~L924).
  - `settleInvocation(id, confirmed)` (`repertoire.ts:343`) is **called only from tests**.
- **Change:**
  1. When a spoken turn carried a pending ask, record it as `kind='confirmation_request'`
     together with the `invocationId`.
  2. Resolve the user's next final transcript as yes, no, or unclear. Unclear leaves it pending.
     Settle through a new ticket-authorised route that calls `settleInvocation`.
  3. Cap re-asking at one repeat per session, using `agent_decision` rows.
  4. Say in a comment what happens to invocations still pending at session end, then implement it.
- **Done when:**
  - DB tests: yes → `confirmed=true`; no → `false`; a pending item is no longer offered after
    settling.
  - Eval case `pending-confirmation` still passes, plus a new "asked once already" case.

#### T0.4 Keep directions out of the workspace

- **Why:**
  - The classifier prompt (`packages/workspace/src/classify.ts`) says a direction "drops out of
    the workspace".
  - The extractor does not do this, so commands like "mark this" can become claims or tasks, and
    the workspace no longer matches the classifier's own description.
- **Now:**
  - `loadPendingSegments` (`packages/db/src/workspace.ts`) already returns
    `kind: kindOverride ?? kind`.
  - `apps/worker/src/jobs/extract-workspace.ts` and `extract.ts` never read it.
  - Classification runs on each chunk (~20s). Extraction runs in batches of 8 (~60s). So a
    segment can still be `unclassified` when extraction reaches it.
- **Change:**
  1. Exclude `direction` segments from the extraction input.
  2. Handle `unclassified` without a race: wait for classification, with a timeout after which
     the segment counts as content. Document the choice.
  3. A later `kindOverride` does not rewrite past workspace ops. State that in a comment.
  4. Bump `PROMPT_VERSION` and the fingerprint.
  5. **Do not re-run extraction over existing data without asking.** It costs model calls and
    changes people's workspaces.
- **Done when:** worker tests show a direction segment is never sent to the model and an
  unclassified segment is sent after the timeout.

#### T0.5 Restore board correction (G9)

- **Why:** the drag-and-drop change (`de8e643`) removed the per-card buttons.
  - "Not a task" (retire) can no longer be reached.
  - Nothing works by touch or keyboard.
- **Now:**
  - The API still supports retiring: `apps/web/src/app/api/board/cards/[blockId]/route.ts`.
  - The old component is at `git show de8e643^:apps/web/src/app/board/card-actions.tsx`.
  - The `board-surface.tsx` comment still calls the buttons the primary path.
- **Change:**
  1. Put the actions back next to drag and drop, in `board-card.tsx` or `board-surface.tsx`.
  2. Keep the optimistic revert and the error line that shows when saving fails.
- **Done when:**
  - A keyboard-only user can move and retire a card.
  - `board_card_moved` and `board_card_retired` events still fire.
  - `pnpm build` passes.

#### T0.6 Participant identity

- **Why:** the analysis has to join PostHog events and exports to participants without using
  names or emails.
- **Now:**
  - `study_participant_id` is declared in `packages/shared/src/analytics.ts:327` and never set.
  - Person properties are recomputed in `apps/worker/src/jobs/sweep.ts` (~L360).
- **Change:**
  1. Add a nullable `user.study_participant_id` column, set by the researcher the same way as
     `board_enabled_at`.
  2. Include it in the person properties.
- **Done when:** after setting the column, the sweep's person-property update carries the id.

### Tier 1: study conditions and export

#### T1.1 Study conditions per participant, fixed per session

- **Why:**
  - Conditions must vary per participant and per phase, not per container.
  - Every drive must record which condition it ran under.
- **Now:**
  - `PROACTIVE_OFFERS` is a global env var (`bot.py:981`, `.env.example`, both compose files).
- **Change:**
  1. Add `user.study_condition` (jsonb, researcher-set) and `capture_session.study_condition`
     (jsonb). Copy it at session insert in `apps/web/src/app/api/capture-sessions/route.ts` and
     never update it (constraint 5).
  2. Put a Zod schema in `packages/shared/src/contracts.ts`. **Every default reproduces today's
     behaviour.** Fields:
     - `proactiveOffers: boolean`
     - `spokenProvenance: boolean` (T2.2)
     - `clarificationPolicy: "best_guess" | "one_short_question"` (T2.6)
     - `fading: { enabled: boolean, halfLifeSessions?: number }` (T2.7)
     - `voiceMacroOffers: boolean` (T2.8)
     - `agendaOffers: boolean` (T2.5)
  3. `/api/realtime/session` returns the session's condition.
  4. `bot.py` reads it per connection. `PROACTIVE_OFFERS` remains only as a fallback when the
     session call fails.
  5. For phase changes, set `user.study_condition`. New sessions pick it up and old sessions
     keep theirs.
- **Done when:** two users with different conditions, served by the same container, get
  different offer behaviour, and each `capture_session` row shows its own condition.

#### T1.2 Condition-driven prompt sections

- **Change:**
  - `composeSystemPrompt` takes the condition and adds sections for provenance and clarification
    policy between proactivity and `OUTPUT_CONTRACT`.
  - Bump `TALKBACK_CONFIG_VERSION`.
  - Pass the condition through `pnpm talkback:eval` (a `--condition` flag or per-case field), so
    each arm can be tested.
- **Done when:**
  - `prompt.test.ts` pins the new order.
  - The hostile-section test still passes.
  - The eval runs for both clarification policies.

#### T1.3 Study export that respects privacy

- **Why:** the analysis needs one reproducible file per participant, and the privacy boundary
  (constraint 1) must hold.
- **Change:**
  1. `apps/worker/src/scripts/study-admin.ts` plus a root script `study:export`, following the
     `workspace:*` / `memory:*` scripts in `package.json`.
  2. Output is JSONL of **counts, timings, ids, enums and lengths** from:
     - `capture_session` (setting, condition, durations, `endedBy`)
     - `utterance` (offsets, kind, word count; **no text**)
     - `agent_turn` (kind, offsets, bargedIn, truncatedAtMs, latency, word counts; **no text**)
     - `agent_decision`, `directive` (verb and capability id; **no restatement text**)
     - `invocation`, `macro_proposal` (status, timings, channel; the name only, since `/study`
       says capability names are seen)
     - `capability_version` counts
     - `workspace_op` (type, `via`, counts; no text)
     - board `judge()` outcomes
     - debrief responses (T3.1, which are content by design)
  3. A `--include-text` flag exists **only** for the researcher's own pilot account, and prints a
     warning.
- **Done when:**
  - A test asserts that the default export contains no free-text field from those tables.
  - It runs against `pnpm db:fixtures` data.

### Tier 2: behaviours the study can vary

Build only what the maintainers choose (§5.1), but keep **T2.1 and T2.4** regardless, because
they are correctness fixes.

**Thread A: voice-specific guidelines**

- **T2.1 Spoken undo (G9).**
  - A "scratch that" or "undo" direction reverts the most recent invocation in the session (set
    `invocation.reverted=true`, which nothing writes today).
  - Or, if the last derived change was a workspace op from speech, it retires that op with
    `via:"user"`.
  - The agent confirms in at most five words.
  - Code: `apps/worker/src/jobs/invoke-capability.ts`, `classify-utterance.ts`. Add an eval case.
- **T2.2 Spoken provenance (G2, G11; condition `spokenProvenance`).**
  - Recalled passages and threads carry their drive date into the context block.
  - A prompt section asks for a one-clause source when the reply relies on memory, and for no
    hedging.
  - Code: `packages/talkback/src/context.ts`, `bot.py` `Recall._compose`,
    `eval/messages.ts` (mirror). Add eval cases for "attributes" and "does not invent a date".
- **T2.3 "What can you do?" by voice (G1).**
  - Send the user's live, non-retired capabilities (name plus restatement) as context when asked.
  - Add an eval case.
- **T2.4 Explanations at the desk (deferred G11, G16, G18).**
  - `/sessions/[id]`: show each agent turn's kind and trigger, and the silences it chose (from
    `agent_decision`). Coordinate with the maintainer's uncommitted `transcript.tsx` and
    `agent-turn-bubble.tsx` work.
  - Workspace blocks: link to their source utterances. `spans` already stores them; today
    `apps/web/src/app/workspace/topic-card.tsx` shows only a count.
  - Repertoire: say the consequence, e.g. "declined; won't be offered again".

**Thread B: metacognitive support**

- **T2.5 Agenda offers (self-management; condition `agendaOffers`).** Three unprompted turns:
  - an **opening** ("last time you were on X; Y hasn't come up");
  - a **recap on re-entering** a topic;
  - a **transition** when a topic has landed, sized to the time left.

  Details:
  - Inputs: threads (`packages/talkback/src/memory-search.ts`), topic recency
    (`packages/workspace/src/trajectory.ts`), expected drive length (median of the user's past
    `capture_session` durations).
  - They offer and never assign. Each is recorded in `agent_decision` with a `subjectKey`. **A
    declined subject is never offered again, across sessions.**
  - They run through the existing `Offers` gate: never mid-thought, never twice without a reply.
  - `agent_turn.kind='proactive_prompt'`.
  - Add eval cases.
- **T2.6 Clarification policy (G10; condition `clarificationPolicy`).**
  - `best_guess`: today's prompt, which answers the most likely reading.
  - `one_short_question`: when ambiguous, ask one short question with at most three options.
  - Add eval cases for both.
- **T2.7 Fading (condition `fading`).**
  - Offer and agenda patience grows with the participant's cumulative number of spoken
    unprompted turns across sessions (from `agent_turn`).
  - The within-drive backoff in `Offers` stays.
  - Compute the level on the web side and return it in `/api/realtime/session`, so `bot.py`
    holds no study logic.

**Thread C: macros as automation strategy**

- **T2.8 Offer macros by voice (G13, G18; condition `voiceMacroOffers`).**
  - **Now:**
    - `apps/worker/src/jobs/detect-macros.ts` writes `macro_proposal` with a replay-preview
      artifact.
    - Accepting or declining happens only on `/repertoire` through
      `apps/web/src/app/api/repertoire/proposals/[id]/route.ts`, which calls
      `acceptMacroProposal` and `declineMacroProposal` (`packages/db/src/repertoire.ts`).
  - **Change:**
    1. At a pause or near session end, put the open proposal into the turn context, the same way
       pending confirmations are delivered.
    2. The agent says, in one sentence, "You keep doing X — want that as a thing?", then one
       sentence on what it would have produced.
    3. Yes or no goes through a ticket-authorised route to the same db functions.
    4. Add `macro_proposal.decided_via` (`voice | desk`).
    5. Offer it once only, recorded in `agent_decision` with the proposal id as `subjectKey`.
  - **Done when:** DB tests pass for accept and decline by voice, and eval cases cover the offer
    and the decline.
- **T2.9 Measures of automation decisions.** Add the following to the export (T1.3) as derived
  fields:
  - time from proposal to decision, and the channel;
  - invocations and reverts of the resulting capability in the next N sessions;
  - number of capability versions.

### Tier 3: measures

- **T3.1 Post-drive debrief (promised on `/study`).**
  - After Stop on `/record`, show the three questions (`QUESTIONS` in `study/page.tsx`; move them
    to a shared constant).
  - Keep the recording open for the spoken answers, up to about 90 seconds or until a "done"
    tap.
  - Mark the window as the debrief, e.g. `capture_session.debrief_started_offset_ms` and
    `debrief_ended_offset_ms`, so utterances in it are the content channel researchers may read
    while the drive itself stays private.
  - The idle sweep's automatic close must still work.
  - Any on-screen ratings wait for decision §5.3.
- **T3.2 Calibration probe (only if approved, §5.3).**
  - At the desk, show k extracted blocks from the last drive. The participant answers "I
    said/meant this: yes/no" plus a 1–5 confidence rating.
  - Store only the answers and ratings, and export them. Calibration is the correlation between
    confidence and correctness.
  - It goes through `canShowSurvey` (`apps/web/src/lib/analytics/surveys.ts`), so it is never
    shown while recording.
- **T3.3 Behavioural reliance, already built.** `judge()` in `packages/workspace/src/board.ts`
  labels each speech-driven task move as kept, reversed, corrected, and so on. Make sure T1.3
  exports it.
  - **Imported cards are not in the denominator.** `/board/import` lets a participant bring in a
    board they already keep (Trello, Jira, Notion, a list), and those ops carry a fourth `via`,
    `"import"`. `judge()` skips them exactly as it skips a person's own move: an imported card
    nobody touched for two drives is not an accepted machine-made transition. Everything speech
    or the agent does to an imported card *afterwards* is judged normally, which is the reason to
    offer the import at all — it puts real work on the board before drive one, so the acceptance
    measure has something to measure in the first week rather than the third.
  - The export needs no change for it: `workspace_op.via` already comes through verbatim, so
    `"import"` appears as a fourth value and imported adds appear as `board_transition` rows with
    `outcome: null`. The analysis should filter on `via` rather than assume three values.

---

## 7. Out of scope

Reflexive (voice) authoring of capabilities, rules firing, `to-doc` outlets, and speaker
diarisation on institution hardware. All are real gaps, but none is needed for the three threads,
unless §5.2 decides otherwise.

---

## 8. Definition of done (all tasks)

1. `pnpm typecheck`, `pnpm build`, and `pnpm test` with Postgres up and test counts checked.
2. Migrations generated and applied, and `pnpm db:fixtures` still renders `/workspace`, `/board`,
   `/repertoire`, `/timeline` and `/sessions/[id]`.
3. `bot.py` changes have pytest coverage and pass inside the container.
4. Prompt changes: version bumped, `pnpm talkback:eval --strict --runs 3` passes with the new
   cases.
5. **Ledger independence check:** kill the Pipecat container mid-recording, and recording, upload,
   the cue panel and the session page keep working.
6. **End-to-end check for Tier 0 and Tier 1** (desk setting, one test user with a non-default
   condition):
   - a declined offer writes `agent_decision`;
   - a spoken offer writes `agent_turn.kind='proactive_prompt'`;
   - a spoken "yes" settles a pending invocation;
   - `study:export` contains no transcript text.

---

## 9. After Pilot 01 (19 Sep 2026)

One formative session, `capture_session 8e14deb1`, with a first-time user. **The system ran
without a single error and failed the participant at three separate moments.** That is the
finding, and it is the reason this section exists: every measure in §6 was a property of the
system — latency, turn counts, decline rate, error rate — and all of them were healthy.

### 9.1 What happened, and what has been done about it

| What the participant experienced | Why | Fixed by |
|---|---|---|
| Answered a yes/no question with "Ja." and got **40.4 s of dead air** | Nothing modelled "a question is open", so one word read as a backchannel and the model replied `<silence>` — which the gate correctly suppressed | `TurnRecorder` tracks the open question; the driver's next words are an `answer` cue; `AnswerGuard` refuses to let a decline under that cue stand, re-runs the turn with `ANSWER_REQUIRED`, and speaks a fallback if it declines twice |
| A turn spoken **52.6 s after Stop**, written to the closed session's ledger | The browser went away, so no `EndFrame` travelled the pipeline and the offer timer was still armed | `build_pipeline` returns a `Drive`; the connection's `closed` handler cancels offers, seals the recorder and cancels the worker. `/agent-turn` and `/decision` answer **409** for an ended or debriefing drive, and the container closes itself on that |
| **8.4 s median** on tool-backed turns (1.3 s without), in silence | Nothing was spoken while a tool ran, and in a car that is indistinguishable from a dropped connection | `Liveness` speaks a placeholder as the call starts and a reassurance every ~5 s, capped at two, in the drive's own language (`packages/talkback/src/fillers.ts`). Every filler is written to `agent_turn` as the new `filler` kind |
| Run **stationary under the `driving` profile** — 25-word replies, no screen | With no accelerometer permission the detector fell back to `driving`, and nothing recorded that the profile had been guessed | The recorder asks rather than starting under a guess, corrections are remembered per browser, and `capture_session.setting_source` stores how the answer was reached |
| The **debrief was never recorded** | Stop ended the session, so the three questions `/study` promises were asked with the microphone closed | Stop opens a debrief window instead (`debrief_started_offset_ms`); capture keeps running, talk-back disconnects, and done closes both |
| `resolved_model`, `asr_ms`, `speak_ttfb_ms` **null on all 15 turns**; `end_offset_ms` an unmarked estimate; **two `agent_decision` rows per offset** | Nothing read the LLM's resolved name, nothing timed the ASR, the only metrics reader sat upstream of the TTS, and a moment that ran two completions produced two rows | Read from `llm.get_full_model_name()`; timed in `Recall`; `PlaybackClock` between the TTS and the transport (`end_measured` says which ends are real); every decision carries its moment's `cue_id` and `recordAgentDecision` keeps exactly one row `authoritative` |

### 9.2 The measures, in three tiers

`pnpm study:metrics [--user <id>] [--re-prompt-ms 5000] [--print]` computes all of them, per
session and per participant, and writes one JSON file each. It reads transcript text inside the
privacy boundary to classify two of the Tier 2 measures and returns counts only;
`metrics.test.ts` seeds a sentinel into every text column and fails if it surfaces.

**Tier 1 — system behaviour** (unchanged, and not the point). Response latency split by whether
a tool ran; silent opportunities as a share of *deduplicated* moments; error rate.

**Tier 2 — steerability.** Re-prompt rate (their words after *n* seconds of agent silence, *n*
configurable); repeat-request rate; correction rate (spoken rejections, declined invocations and
`judge()`'s reversed/corrected transitions, reported apart and pooled); intent throughput
(directions that reached the board); and **unanswered answers, whose target is 0**.

Every rate over decisions counts `authoritative` rows only — Pilot 01 wrote two per offset, which
doubles the denominator of the silence rate — with one deliberate exception. Unanswered answers
count the *declines themselves*, because when `AnswerGuard` rescues one the completion that
finally speaks becomes the moment's authoritative decision, and deduplicating would report zero
for a drive where the model declined every answer and was overruled every time.

**Tier 3 — relief.** Mental load before and after the same drive (negative delta is the good
direction); whether they could tell it was working; whether they could correct it; revisit rate
by *day*; and the day-7 verdict per item — done / still open / **lost**. `lostRate` is the
primary failure measure for offloading.

**The `thinking` group — whether they were still doing the thinking.** Added after the second
piece of Pilot 01 feedback and argued for in §10: intrusions (agent speech that began while they
were still talking), self-repairs, and how long they get to speak without the agent taking a
turn. It is reported beside the tiers rather than inside one, because it is the group that keeps
the other three honest.

### 9.3 The study flow the system now supports

- **Day 1.** Pre item on the recorder → drive → Stop opens the debrief (microphone still open,
  three questions, two post items) → done ends the session.
- **Days 2–6.** Ordinary use. Counts only: `study_event` records board and card opens;
  dictations and edits come from `workspace_op`, which already has them.
- **Day 7.** `pnpm study:review --user <id>` lists the cards awaiting a verdict, oldest first;
  `--card <id> --outcome done|open|lost` records one. `/api/study/review` takes the same
  verdicts, so a spoken review session can write them without this changing.

### 9.4 What is still open

- The day-7 review is a CLI and an API route, not a voice session. Reading each item back aloud
  and taking the answer by voice is the natural next step and is not built.
- `intentThroughput` counts classifier-detected directions only. An intent the participant
  expressed straight to the agent, which the agent carried out with a board tool, has no
  `directive` row and does not appear in the denominator.
- The pooled medians in a participant's summary are null on purpose: a median of medians is not
  a median, and the per-session values are the ones to read.

---

## 10. Thinking aloud is the task, not the input method

Feedback after Pilot 01, in one line: *consider talking aloud as a way of thinking and
processing for knowledge work.* It is the sharpest thing anyone has said about this system,
because it says the measures in §9 are still measuring the wrong thing — better than before, but
still about the machine.

The whole design already rests on the claim: Notes.md says silence is thinking rather than a turn
boundary, and the prompt says never to interrupt a thought that is still being formed. What was
missing is that **nothing measured whether the thinking happened**, and one of our own measures
was pointed the wrong way.

### 10.1 What the literature says, and what each thing means here

**Verbalising a thought does not change it; being asked to explain it does.**
Ericsson and Simon's protocol analysis separates levels of verbalisation: saying what is already
in working memory (Levels 1–2) leaves the cognition alone, while being asked to explain or
justify (Level 3) alters it, and alters task performance and completion times with it.

> *Consequence.* Every prompted turn this system takes is a Level 3 intervention. It is not a
> neutral observation of somebody's thinking — it is a manipulation of it. That is not an
> argument for silence; it is an argument for **counting the interventions** and for never
> treating "the agent said something useful" as free. `thinking.intrusions` is the version of
> this that can be measured mechanically: agent speech that began while the person was still
> talking, which is a Level 3 intervention delivered mid-formation.

**Eliciting explanation can also be exactly what helps.**
Chi et al. found that students prompted to explain each line to themselves understood far more,
and that the high explainers were the ones who built a correct model. The mechanism is
integration and self-correction: explaining surfaces conflicts you would otherwise not notice.

> *Consequence.* The same intervention the first finding warns about is the one that produces
> the benefit. The interesting question for this study is therefore not "does it interrupt" but
> **when does a question move the thinking on and when does it derail it** — which is exactly
> what `thinking_moved` (asked) and `thinking.intrusions` / `selfRepairs` (observed) are for,
> read together rather than separately.

**Speech externalises fragmented, non-linear thought, and dictation is linear.**
The recent CHI work on speech as a canvas ("Orality") names the tension directly: verbalised
thinking is half-formed utterances and spontaneous sparks, and the sequential stream of dictation
fights the non-linear structure of the thought.

> *Consequence.* This is an argument FOR the workspace and the board and AGAINST the transcript
> as an artefact — which is the architecture we already have, and it is worth saying that out
> loud, because it means the board is not a to-do list that happens to be voice-driven. It is
> the non-linear structure the speech could not carry. It is also why `medianUtteranceWords` and
> the run lengths are worth watching: a person whose utterances get shorter every day has
> stopped externalising and started dictating.

**Offloading the thinking is a documented failure mode, not a hypothetical one.**
Fan et al. found learners with a generative assistant produced better essays, showed no
knowledge gain, and self-corrected less — they call it metacognitive laziness. Lee et al., in a
survey of 319 knowledge workers, found confidence in the assistant associated with *less*
critical thinking, and the work shifting from doing to supervising.

> *Consequence, and it is the big one.* **"Optimise for relief, not throughput" is not
> sufficient as a guiding principle.** A system that did the thinking would score beautifully on
> mental load. The principle has to be stated as:
>
> > **Relieve what they are HOLDING. Never relieve them of the THINKING.**
>
> Those are different loads — tracking, remembering and re-deriving on one side; forming,
> checking and correcting on the other — and §9's measures could not tell them apart.
> `did_my_thinking` is reverse-scored precisely to catch a drive that scored well by taking the
> work.

### 10.2 What changed because of this

- **Two new post-drive items.** `thinking_moved` ("Did talking it through move your thinking
  on?") and `did_my_thinking` ("Did it do thinking you wanted to do yourself?", reverse-scored).
  `StudyItem.higherIsBetter` now states each item's direction in the data, because two
  reverse-scored items in a five-item set is how a scale gets averaged into nonsense.
- **A fourth measure group, `thinking`,** computed from the ledger beside Tiers 1–3:
  - `intrusions` / `intrusionRate` — agent speech that began while they were still talking. The
    system's own central rule, measured for the first time. It should be at or near zero.
  - `selfRepairs` / `selfRepairRate` — them revising their own half-formed sentence
    ("beziehungsweise…", "no, wait"). The audible form of thinking in progress. It shares its
    vocabulary with the correction measure, and the two are told apart by whether an agent turn
    came first: the addressee is a fact about the turn structure, not about the words.
  - `runs`, `medianRunMs`, `longestRunMs`, `medianUtteranceWords` — how long they speak without
    the agent taking a turn. Thinking aloud comes in long stretches; issuing commands does not.
- **None of these is good or bad alone**, and they are deliberately not summed into a score. A
  low self-repair rate where `thinking_moved` is high is somebody who arrived with the thought
  already formed. The same number where `did_my_thinking` is also high is the failure.

### 10.3 What follows, and is not built

- **A prompt change is warranted and has not been made.** The base prompt tells the model not to
  interrupt a thought in formation; it does not tell it to avoid asking somebody to *justify* a
  thought they are still forming, which is the specific Level 3 intervention the first finding
  is about. This repo's definition of done requires a version bump and
  `pnpm talkback:eval --strict --runs 3` for any prompt change, which needs a live model, so it
  is proposed rather than applied. The wording to add, after the "WHEN TO SPEAK" bullets:
  *"While a thought is still being formed, do not ask them to explain or justify it. Ask after
  it has landed, or not at all."*
- **Intrusions are measured against ASR boundaries**, which are approximate. Read the rate, not
  the individual incidents.
- **The condition that would settle it is not in the design.** Whether an offered question moves
  thinking on or derails it is a within-participant comparison — offers on for one drive and off
  for the next — which `proactiveOffers` can already express and the cold-start toggles can
  already flip per drive (§9.3). Nobody has decided to run it.

**Sources.**
[Ericsson & Simon, *Protocol Analysis*](https://www.ida.liu.se/~nilda08/Anders_Ericsson/Ericsson_protocol.pdf) ·
[Think-aloud protocols, overview](https://benjamins.com/online/hop/articles/thi1) ·
[Chi et al. (1994), *Eliciting self-explanations improves understanding*](https://onlinelibrary.wiley.com/doi/10.1207/s15516709cog1803_3) ·
[*Orality: A Semantic Canvas for Externalizing and Clarifying Thoughts with Speech*, CHI 2026](https://dl.acm.org/doi/10.1145/3772318.3791713) ·
[Fan et al. (2025), *Beware of metacognitive laziness*, BJET](https://bera-journals.onlinelibrary.wiley.com/doi/10.1111/bjet.13544) ·
[Lee et al. (2025), *The Impact of Generative AI on Critical Thinking*, CHI](https://dl.acm.org/doi/full/10.1145/3706598.3713778)

---

## 11. Saying that it is recording

The second piece of feedback after Pilot 01: **make it more salient that recording has started.**

Everything that said "recording" was a *modifier of a control that is always there* — the record
button changed colour, a level meter appeared inside it, a timer began to count. Each of those
reads as "on" only against a memory of what "off" looked like a second ago, which a first-time
participant does not have. And all of it was visual, for a system whose premise is that the
person's eyes are on something else.

- **Two rising notes when recording starts**, two falling notes when Stop opens the debrief, and
  one soft note when talk-back is actually connected and listening
  (`apps/web/src/lib/recorder/earcon.ts`). Local WebAudio, so they work with the conversation
  switched off, the network down and the container dead — which is when they matter most. The
  third one is the important one conceptually: *"it is recording"* and *"it can hear me"* are
  different facts arriving seconds apart, and only the failure of the second was ever shown.
- **A haptic** alongside the transport pair, where the device has one.
- **A badge that is present or absent**, never a shade of something: a pulsing red dot, the word,
  and the elapsed time, with `role="status"` so it is announced. The dot pulses because
  peripheral vision is nearly blind to colour and very good at movement.
- **The gap is narrated.** Opening a microphone takes about a second, and that second used to
  show an ellipsis on a disabled button — which reads as "it did not hear me" and invites a
  second tap.

No new study item for this. If people cannot tell it is recording they say so in the debrief,
and they leave a behavioural trace — a drive stopped and restarted within seconds — which is
cheaper and more honest than another rating. Worth watching in the next pilot's
`endedBy`/duration pairs.
