# The Prolific recall study

An online, between-subjects version of the sparks question: **does offering
sparks during a conversation with the voice agent change what people remember
of it a day later, and how well they know what they remember?**

Everything else is held equal between the arms: the same task, the same agent
prompt, the same floor controls. Only the spark chips (and the one line of
instructions that explains them) differ.

## The two parts

**Part 1** — `/p?PROLIFIC_PID=…&STUDY_ID=…&SESSION_ID=…` (about 20 minutes)

1. Consent. A guest account is created behind the scenes and the arm is
   assigned: whichever arm has fewer participants, ties at random
   (`chooseArm`). The arm is written onto the account as its study condition,
   so the drive copies it like any other (`capture_session.study_condition`).
2. Microphone check.
3. The task (`PROLIFIC_TASKS` in `packages/talkback/src/study-task.ts`): a
   short plan for a town council — three measures and why — and how the
   controls work.
4. The conversation, with the study's own agent (`study-agent.ts`): a
   conversational assistant, not the field study's quiet companion, the same
   in both arms. On screen: the topics (theirs without words; the agent's
   last three replies on the current topic), **the plan**, Lock / Normal /
   Poke, and in the sparks arm the spark chips at the foot of their panel.
   - **The plan** is one draft the agent writes only when asked ("put that on
     the plan"), holding only what the participant decided; asked to write
     the whole thing, it offers options to choose from instead. Finish needs
     `PROLIFIC_MIN_MINUTES` **and** a plan. The final plan is exported.
   - **Sparks are targeted**: the rules in `signals.ts` pick the subject and
     the kind; `/api/realtime/spark-question` writes a question about that
     subject's actual content (MODEL_FAST), shown on the chip and asked by
     the agent when pulled (`SPARK_QUESTION_NUDGE`, mirrored in `bot.py`).
     Without a question the chip keeps its generic label.
   - The agent never summarises the conversation: a recap would be retrieval
     practice in both arms. The plan is visible in both arms alike.
5. One question: how much they expect to remember tomorrow (a judgement of
   learning). Then the completion code and the link back to Prolific.

**Part 2** — `/p/recall?PROLIFIC_PID=…` (about 10 minutes), opens
`PROLIFIC_RECALL_DELAY_HOURS` after part 1 ended. Found by PID, not by cookie,
so it works in a fresh browser.

1. **Free recall**, before any cue: everything they remember, in writing, then
   how complete they think it is. Pasting is blocked. This is the primary
   measure, and the first answer stands.
2. **Recall probes** for up to three subjects of their conversation
   (`recall_probe`, the same as `/recall`): confidence → their own words on it
   → how close they were → whose idea it was.
3. **Closing questions**: what they took away, ownership, who did the
   thinking, whether the cards helped (sparks arm only), and whether they
   rehearsed (wrote it down, looked it up, talked it over) since part 1 — the
   validity check.

The server enforces the order (free recall before any probe; confidence before
the reveal), so a reload or a hand-made request cannot change it.

## Testing locally

You need the usual local setup (README.md) **and** the voice container, since
the conversation is the point:

```bash
cp .env.example .env     # if you have not already
```

Then in `.env`:

```bash
TALKBACK_ENABLED=true
NEXT_PUBLIC_TALKBACK_ENABLED=true
PROLIFIC_MIN_MINUTES=1          # Finish after a minute
PROLIFIC_RECALL_DELAY_HOURS=0   # part 2 opens straight away
```

```bash
docker compose up -d && pnpm db:migrate     # adds prolific_participant (migration 0026)
pnpm talkback:up                            # the Pipecat container (TALKBACK.md)
pnpm dev
```

Open, in a **private window** (one PID per browser — see below):

- Sparks arm: <http://localhost:3000/p?PROLIFIC_PID=test-anton-1&arm=sparks>
- Control arm: <http://localhost:3000/p?PROLIFIC_PID=test-anton-2&arm=control>

Talk for a minute or two about the task — long enough for the agent to name a
couple of subjects, which is what the probes and the sparks are built from.
Finish, answer the question, then open part 2 with the same PID, in any
browser:

- <http://localhost:3000/p/recall?PROLIFIC_PID=test-anton-1>

Then `pnpm study:prolific` writes `storage/prolific-export/participants.csv`
and `probes.csv`.

`?arm=` works anywhere outside production. Any short URL-safe PID is accepted;
only 24-hex-character ones count as real, and the export marks the rest
`test=true`.

**One PID per browser.** A browser that already holds one participant refuses a
second PID (it would mix two people's data on one account). Use a private
window per test participant, or clear the site's cookies.

Without the voice container the whole flow still runs — you can click through
both parts — but the agent never answers, no subjects are named, and part 2
skips straight from the free recall to the closing questions.

## On Prolific

Two studies, both with the study URL set to pass the Prolific parameters
(`{{%PROLIFIC_PID%}}` etc.):

| | Part 1 | Part 2 |
|---|---|---|
| URL | `https://<host>/p?PROLIFIC_PID={{%PROLIFIC_PID%}}&STUDY_ID={{%STUDY_ID%}}&SESSION_ID={{%SESSION_ID%}}` | `https://<host>/p/recall?PROLIFIC_PID=…` (same parameters) |
| Completion | redirect, code `PROLIFIC_COMPLETION_CODE_PART1` | redirect, code `PROLIFIC_COMPLETION_CODE_PART2` |
| Devices | desktop, microphone required | desktop |
| Audience | — | custom allowlist: the PIDs that finished part 1 (`pnpm study:prolific`, `part1_completed_at`) |
| Launch | — | about 24 h after part 1 participants finish |

Set both completion codes in the deployment. In production, a missing code
closes the study rather than hand out one Prolific would reject.

## Before the real thing

- Pilot both arms with two or three people outside the group.
- Decide and pre-register how the free recall is scored: e.g. idea units from
  the task, each coded as present or absent and as originally the
  participant's or the agent's (the transcript tells which).
- Ethics: the consent text on `/p` is a draft. Have it checked, and add the
  institution, contact and data-retention details your board requires.
- Pay for both parts; tell people up front that there is a second part.
