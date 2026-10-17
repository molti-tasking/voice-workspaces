/**
 * What the prompt has to get right, as cases.
 *
 * Each case is one turn: what has been said, what the container
 * would have put in front of the model, and what a good reply looks like. The
 * expectations are deliberately coarse — speak or stay silent, under the cap,
 * mention this, never mention that — because the fine judgement ("was that the
 * one thing worth saying?") is the judge's job, and a deterministic check that
 * tried to make it would be wrong more often than the model.
 *
 * These are the prompt's REGRESSION SUITE, not a benchmark. When a drive turns
 * up a behaviour worth keeping or losing, add the turn here with the real
 * words, so the next prompt change is checked against it. The ids are stable
 * and appear as tags in Langfuse.
 */

import { FLOOR_OPEN_NOTE, POKE_NUDGE } from "../prompt";
import { renderRecentDrives } from "../recent-drives";
import { renderScreen } from "../screen";
import type { EvalContext } from "./messages";

export type TurnExpectation = "silent" | "speak" | "either";

/**
 * A board as `buildBoardContext` renders it, with the handles the tools take.
 * Written out rather than folded from ops: the case must show exactly what the
 * model saw, and a change to the rendering should be a visible edit here.
 */
const BOARD = [
  "Their task board right now:",
  "- [next] Write up the asymmetry argument. (card 1225b3 · Voice paper)",
  "- [next] Email William about the start date. (card 9b04e1 · Research stay)",
  "- [open] Build the evaluation system. (card 7a31c0 · Voice paper)",
  "Their topics: Voice paper · Research stay",
].join("\n");

export interface EvalCase {
  id: string;
  /** Why this case exists, in one line. Shown next to a failure. */
  about: string;
  /** Earlier turns, oldest first. `[Speaker N]` tags as the container writes them. */
  history?: { role: "user" | "assistant"; content: string }[];
  context?: EvalContext;
  /** What was just said. Omitted on an unprompted turn (see `offer`). */
  said?: string;
  /**
   * Present when the case is the proactive engine's turn rather than a reply:
   * the message list has no driver words, and the engine's instruction stands
   * in their slot exactly as `Offers` places it. `quietSecs` omitted = the
   * opening turn at the start of a drive.
   */
  offer?: { quietSecs?: number };
  /**
   * Present when the case is a POKE (talkback-20): the person tapped to hear
   * from the agent, and `POKE_NUDGE` stands in their slot as `Floor` places it.
   * `retry` is the re-run after the poked completion declined — the history
   * then ends on the nudge and that decline, and `POKE_RETRY_NUDGE` follows.
   * A poke case must set `expect.poked`.
   */
  poke?: { retry?: true };
  /**
   * Sections composed into the system prompt for this case, as the session
   * route composes them (between the profile and the output contract) — the
   * earlier drives, say. The board's editing section is added by the runner
   * on its own, from `context.board`.
   */
  sections?: string[];
  expect: {
    turn: TurnExpectation;
    /** Regex sources, case-insensitive. All must match a spoken reply. */
    mustMention?: string[];
    /** Regex sources, case-insensitive. None may match a spoken reply. */
    mustNotMention?: string[];
    /**
     * For a case whose context shows the board — where the agent has its board
     * tools, as it does live. An object: the model must call this tool, each
     * named argument matching its regex (case-insensitive); nothing need be
     * spoken on that step, since the reply comes after the tool answers. `null`:
     * it must NOT call a tool. Absent: a call is a failure too, so an old case
     * cannot quietly start editing boards.
     */
    toolCall?: { name: string; args?: Record<string, string> } | null;
    /**
     * What the reply must do with the `<draft>` tag, when that is the point.
     *
     * `{ revises: /3f9a2c/ }` — exactly one draft, revising a handle that
     * matches. `{ revises: null }` — exactly one draft, and it is NEW. `null`
     * — no draft at all, which is the case for "you already have one, do not
     * rewrite it". Omitted where the draft tag is not what is being tested;
     * `checkReply` then ignores drafts entirely, as it did before.
     */
    draft?: { revises: RegExp | null } | null;
    /**
     * This turn is the driver ANSWERING a question the agent itself asked on
     * the turn before, so `<silence>` is never a valid reply to it — whatever
     * `turn` above says, and whether the answer is a whole sentence or a bare
     * "Ja.". `checkReply` fails any silence here, and `eval.test.ts` insists
     * the history really does end on an agent question.
     *
     * Stated rather than inferred, because ending on an agent question is not
     * sufficient: `pending-asked-once` ends on one too, and there the driver
     * carried on with a different sentence entirely and silence is right.
     */
    answering?: true;
    /**
     * This turn is a POKE, so `<silence>` is never a valid reply: the person
     * asked to hear from the agent, with a tap instead of a sentence.
     * `checkReply` fails any silence here, as it does for `answering`.
     */
    poked?: true;
  };
}

/**
 * The drafts block, as `/api/realtime/context` pre-renders it.
 *
 * Taken verbatim from `buildDraftContext`'s output shape rather than built by
 * calling it, so a case pins the WORDING the model actually sees: a change to
 * the renderer that breaks the contract should fail here rather than quietly
 * evaluate a prompt nothing produces. Bodies are short on purpose — the runner
 * sets `maxTokens: 200`, and a case whose expected reply cannot fit is a
 * broken case, not a failing prompt.
 */
const DRAFTS = [
  "Drafts you have written on this drive, and which you can still see:",
  'draft 3f9a2c "Email to William" (v1.0, written by you)',
  'draft b7e40d "Reading list" (v1.1, last edited by them)',
  "",
  "draft 3f9a2c:\nWilliam — the pilot starts on Monday. I will send the consent form on Friday. Best, Anna",
  "",
  "draft b7e40d:\n- Suchman, Plans and Situated Actions\n- Schön, The Reflective Practitioner",
].join("\n");

export const CASES: EvalCase[] = [
  {
    id: "opinion-question",
    about: "A direct opinion question is answered with a view, not a deflection.",
    said: "So what do you think — is the interview mode actually worth building first, or is that just the one I find interesting?",
    expect: {
      turn: "speak",
      mustNotMention: ["cannot find", "can't find", "no transcript", "need more detail"],
    },
  },
  {
    id: "loose-address",
    about: "A trailing 'right?' is addressed to the system and gets a reply.",
    said: "So the whole point is that you can't design the grammar in advance, the user has to grow it. That's the argument, right?",
    expect: { turn: "speak" },
  },
  {
    id: "mid-sentence",
    about: "A pause mid-sentence is thinking, not a turn.",
    said: "and then the, um, the second part of the — ",
    expect: { turn: "silent" },
  },
  {
    id: "self-correction",
    about: "A self-correction is a thought still forming.",
    said: "no wait, not Tuesday, I mean the — the Thursday one, the one after the",
    expect: { turn: "silent" },
  },
  {
    id: "landed-quiet",
    about: "In a car, a landed decision MAY earn one sentence; either is acceptable, verbosity is not.",
    context: {
      summary: "- Decision: drop the sketch-notes concept.\n- Question: whether to keep the malleable-forms work separate.",
    },
    said: "OK so the decision is: we drop the sketch notes idea entirely and go voice-first. That's it, that's the call.",
    expect: { turn: "either" },
  },
  {
    id: "landed-forthcoming",
    about: "At a desk, a landed decision earns a reaction.",
    context: {
      summary: "- Decision: drop the sketch-notes concept.\n- Question: whether to keep the malleable-forms work separate.",
    },
    said: "OK so the decision is: we drop the sketch notes idea entirely and go voice-first. That's it, that's the call.",
    expect: { turn: "speak" },
  },
  {
    id: "stuck",
    about: "Someone circling gets one small push, with at most one question.",
    context: {
      summary: "- Working on: how to evaluate the growth curve of the repertoire.\n- Question: whether three participants is enough.",
    },
    said: "I don't know. I keep going round on this. I just don't know.",
    expect: { turn: "speak" },
  },
  {
    id: "recall-present",
    about: "A recall question is answered from the transcript, with rough timing.",
    context: {
      passages: [
        {
          when: "yesterday",
          text: "I need to call Niklas about the evaluation section before Friday, he wanted the growth curve stuff nailed down.",
        },
      ],
    },
    said: "What did I say about Niklas yesterday?",
    expect: { turn: "speak", mustMention: ["Niklas", "evaluation|growth|Friday|call"] },
  },
  {
    id: "recall-absent",
    about: "Nothing in the transcript means saying so, never inventing a number.",
    said: "What was the number I mentioned for the participants in the field study?",
    expect: {
      turn: "speak",
      mustMention: ["can't|cannot|don't have|not in|nothing|no record|didn't|haven't|not find|no mention"],
      mustNotMention: ["\\b\\d+\\b", "\\b(three|four|five|six|seven|eight|nine|ten|twelve|twenty)\\b"],
    },
  },
  {
    id: "passenger-aside",
    about: "A conversation between two people in the car is theirs.",
    history: [
      { role: "user", content: "[Speaker 1] So the deadline is basically the CHI one, mid-September." },
      { role: "user", content: "[Speaker 2] Mm. Do you want to stop at the next one for coffee?" },
    ],
    said: "[Speaker 1] Yeah, sure, the one after the bridge.",
    expect: { turn: "silent" },
  },
  {
    id: "passenger-asks",
    about: "A passenger addressing the system is answered, from what is known.",
    history: [
      { role: "user", content: "[Speaker 1] So the deadline is basically the CHI one, mid-September." },
    ],
    context: {
      summary: "- Deadline: CHI, mid-September.\n- Decision: keep malleable forms as a separate project.",
    },
    said: "[Speaker 2] Hey, what did he say the deadline was?",
    expect: { turn: "speak", mustMention: ["September|CHI"] },
  },
  {
    id: "no-screen-driving",
    about: "A driver is never told something is on the screen.",
    context: { summary: "- Marked: the Kleist argument; the secretary analogy; the Midas touch." },
    said: "Can you show me the list of things I've marked so far?",
    expect: {
      turn: "speak",
      mustNotMention: ["on the screen", "put that on", "I've shown", "displayed", "on screen"],
    },
  },
  {
    id: "no-double-followup",
    about: "After an unanswered comment, the system backs off.",
    history: [
      { role: "user", content: "So the decision is we go voice-first. That's the call." },
      { role: "assistant", content: "That also settles the sketch-notes question you left open on Tuesday." },
    ],
    said: "yeah. hmm. anyway the other thing was the ethics form, the audio leaving the",
    expect: { turn: "silent" },
  },
  {
    id: "pending-confirmation",
    about: "A parked irreversible action is asked about, once, in one sentence, between thoughts.",
    context: {
      pending: "send yesterday's diary entry to the shared Google Doc",
    },
    said: "Okay. That's the plan for the intro done, I think.",
    expect: { turn: "speak", mustMention: ["doc|send|go ahead|diary"] },
  },
  {
    id: "pending-asked-once",
    about: "An ask already let pass once is not spent on a driver who is still mid-thought.",
    history: [
      { role: "user", content: "Okay. That's the plan for the intro done, I think." },
      { role: "assistant", content: "Want me to send yesterday's diary entry to the shared doc now?" },
    ],
    context: {
      pending: "send yesterday's diary entry to the shared Google Doc",
      pendingAskedCount: 1,
    },
    said: "and the related work section still needs the context switching papers, the Mark one and the",
    expect: { turn: "either", mustNotMention: ["doc|diary|go ahead|send"] },
  },
  {
    id: "thread-settles-open-question",
    about: "A landed decision that settles an open question in the workspace is pointed out, not re-asked.",
    context: {
      threads: [
        {
          text: "Topic: Field study\n- Two weeks per participant.\n- Open: whether three participants is enough for the growth-curve claim.\n- Next: draft the ethics form",
        },
      ],
    },
    said: "Okay, six participants. Three is too few to say anything about the curve, so six it is.",
    expect: {
      turn: "speak",
      mustMention: ["settle|closes|answers|open question|three|ethics"],
      mustNotMention: ["what is the field study|remind me what|which project"],
    },
  },
  {
    id: "thread-no-reexplain",
    about: "With the project state in front of it, the agent does not ask for the project to be explained.",
    context: {
      threads: [
        {
          text: "Topic: Souffleur paper\n- Claim: a voice interface for thinking must be generated from a repertoire the user grows.\n- Open: how to evaluate the growth curve.\n- Next: write the method section",
        },
      ],
    },
    said: "So for the method section, what was the open thing again?",
    expect: {
      turn: "speak",
      mustMention: ["growth curve|evaluat"],
      mustNotMention: ["which paper|what project|tell me more about"],
    },
  },
  {
    id: "garbled-transcript",
    about: "A transcription artefact is not restated as fact.",
    context: {
      passages: [
        {
          when: "earlier today",
          text: "I will show you how to make a simple, easy, and easy to make I will show you how to make",
        },
      ],
    },
    said: "What was I going on about earlier today?",
    expect: {
      turn: "speak",
      mustNotMention: ["you were going to show|you planned to show|how to make a simple"],
    },
  },
  {
    id: "two-people-narrated-rule",
    about:
      "Real turn, 9 Sep 2026: with two people talking, the model narrated its own rule aloud instead of the sentinel or a short answer.",
    history: [
      {
        role: "user",
        content:
          "[Speaker 2] I don't know if this will look back at some point. Is it going to, or is it just recording?",
      },
      {
        role: "user",
        content:
          "[Speaker 1] Yeah, well it's degraded, let's say. I was baking in the prompts of William and I was wondering why it didn't work for a while.",
      },
    ],
    said: "[Speaker 1] So I made them a little bit more proactive, but it's still very defensive. So if we wait a few seconds, you might. Did I say something right?",
    // What it actually said: "[Speaker 2]'s question — whether it'll talk back —
    // is for them to test live, not for me to answer." Silence or a short
    // answer are both fine; explaining the decision is not, and `checks.ts`
    // fails a spoken speaker tag on its own. Offline the same day, talkback-5
    // answered `<silence>` three times out of three and the judge failed each
    // one — "Did I say something right?" is an address. That is the prompt's
    // defensiveness, the thing the advisor watched; this case only guards the
    // narration.
    expect: {
      turn: "either",
      mustNotMention: ["for them to", "not for me", "test live"],
    },
  },
  {
    id: "whats-next-from-threads",
    about:
      "Asked what to pick up next, the agent proposes a topic from where things stand rather than asking which projects there are.",
    context: {
      threads: [
        {
          text: "Topic: Malleable forms paper\n- Claim: forms should be regenerated from the user's own edits.\n- Open: which two examples carry the argument.\n- Next: rewrite the introduction for EICS",
        },
        {
          text: "Topic: Voice paper evaluation\n- Claim: the evaluation should centre on context switching across projects.\n- Open: how many participants the growth-curve claim needs.\n- Next: draft the study protocol",
        },
      ],
    },
    said: "OK, that's the intro done. What should I pick up next?",
    expect: {
      turn: "speak",
      mustMention: ["malleable|EICS|examples|evaluation|protocol|participants|voice paper"],
      mustNotMention: ["which project|what projects|what are you working on|tell me about"],
    },
  },

  /* Unprompted turns from the proactive engine (`Offers` in bot.py). The
   * nudge stands where the driver's words would stand; the expectations are
   * on the same mechanical contract as every other turn. */
  {
    id: "offer-opening",
    about: "The engine's opening turn: a few words, or the obvious next step — never a menu of services.",
    offer: {},
    expect: {
      turn: "speak",
      mustNotMention: ["how can i help|what would you like|what can i do|at your service"],
    },
  },
  {
    id: "offer-silence-next-step",
    about: "Out of a long silence, the engine offers the standing next step once — short, and grounded in where things stand.",
    offer: { quietSecs: 25 },
    history: [
      { role: "user", content: "Right, the ethics form. I said I'd do the participants section tomorrow, before the pilot." },
      { role: "assistant", content: "Participants section before the pilot — tomorrow." },
      { role: "user", content: "Which is fine. It's late now, and I'm not starting it from the car." },
    ],
    context: {
      threads: [
        {
          text: "Topic: Ethics form\n- Claim: audio leaves the deployment only for the live conversation.\n- Open: whether interview mode needs its own consent paragraph.\n- Next: draft the participants section before the pilot.",
        },
      ],
    },
    expect: {
      turn: "speak",
      mustMention: ["participants|pilot|consent"],
    },
  },
  {
    id: "offer-silence-decline",
    about: "Nothing useful to offer when they have wound down for the drive — the engine's moment is declined.",
    offer: { quietSecs: 25 },
    history: [
      { role: "user", content: "Okay, that's the agenda for the call sorted. I'm putting the music on now, motorway for the next hour." },
    ],
    context: {
      summary: "They finished planning the call agenda and said they are done thinking for now.",
    },
    expect: {
      turn: "silent",
    },
  },
  // --- 15 Sep 2026 pilot drives, in their own words (talkback-9) ------------
  {
    id: "board-remove-drops",
    about: "Asked to remove a task, the agent drops it — with the tool, at once, without asking.",
    history: [{ role: "assistant", content: "I think you should write up the asymmetry argument." }],
    context: { board: BOARD },
    // 15 Sep 2026: "Got it, I'll mark that as dropped." — and the card stayed.
    said: "Let's remove this asymmetry argument. I don't even understand it.",
    expect: { turn: "either", toolCall: { name: "move_task", args: { card: "^1225b3$", column: "^dropped$" } } },
  },
  {
    id: "board-delete-now",
    about: "Pressed to delete a card itself, the agent does it rather than explaining why it cannot.",
    history: [{ role: "user", content: "But I can still see the ticket on the board." }],
    context: { board: BOARD },
    // 15 Sep 2026: "I cannot move or delete anything on the board myself."
    said: "No, I want you to delete it now. The asymmetry one. You are supposed to do things like this autonomously in the background.",
    expect: { turn: "either", toolCall: { name: "move_task", args: { card: "^1225b3$", column: "^dropped$" } } },
  },
  {
    id: "board-mark-done",
    about: "\"Mark it done\" moves the card to done.",
    context: { board: BOARD },
    said: "I sent the email to William this morning, so mark that one done.",
    expect: { turn: "either", toolCall: { name: "move_task", args: { card: "^9b04e1$", column: "^done$" } } },
  },
  {
    id: "board-add-task",
    about: "Asked to put a task on the board, the agent adds it, in the topic it belongs to.",
    context: { board: BOARD },
    said: "Put booking the flights to Stanford on next, for the research stay.",
    expect: {
      turn: "either",
      toolCall: { name: "add_task", args: { text: "flight", topic: "research stay", column: "^next$" } },
    },
  },
  {
    id: "board-not-a-task",
    about: "\"That was never a task\" takes the card off the board; it is not the same as dropping it.",
    context: { board: BOARD },
    said: "The evaluation system one was never really a task, it's the whole project. Take it off the board.",
    expect: { turn: "either", toolCall: { name: "remove_task", args: { card: "^7a31c0$" } } },
  },
  {
    id: "board-reword",
    about: "Asked to reword a card, the agent changes its words and nothing else.",
    context: { board: BOARD },
    said: "Rename the asymmetry one to: draft the asymmetry section.",
    expect: {
      turn: "either",
      toolCall: { name: "reword_task", args: { card: "^1225b3$", text: "draft the asymmetry section" } },
    },
  },
  {
    id: "board-mention-no-edit",
    about: "A task mentioned while thinking aloud is not a request: the board is left alone.",
    context: { board: BOARD },
    said: "Reading the Mark paper yesterday changed how I see the asymmetry argument, the interruption cost is the real point.",
    expect: { turn: "either", toolCall: null },
  },
  {
    id: "paste-a-file",
    about: "Offered a document at a desk, the agent does not invent a chat to paste it into.",
    // Observed: "Go ahead and paste it." then "…paste the markdown file into the chat on your screen".
    said: "I don't remember. May I paste some Markdown file somewhere to paste the context and you help me to understand the evaluation plan?",
    expect: {
      turn: "speak",
      mustMention: ["read|describ|tell me|aloud|out loud"],
      mustNotMention: ["go ahead and paste|paste it|into the chat|upload it|on your screen"],
    },
  },
  {
    id: "repeat-mistranscribed",
    about: "A request to hear the question again, as live ASR mangled it, gets the question — not \"go ahead\".",
    history: [
      { role: "user", content: "Yeah. Let's do this." },
      {
        role: "assistant",
        content: "Do you want to start by listing all the courses you're considering, or the deadlines you're already worried about?",
      },
    ],
    // Live ASR's words; the driver said "Can you repeat the question?". Observed reply: "Go ahead."
    said: "Can I repeat the question?",
    expect: {
      turn: "speak",
      mustMention: ["course|deadline"],
      mustNotMention: ["^go ahead"],
    },
  },

  /* Drafts the agent can see, and what it does with them (talkback-12). The
   * failure these close: the agent wrote a draft, forgot it existed, and
   * answered "make it shorter" with a SECOND card. */
  {
    id: "draft-revise-when-asked",
    about: "Asked to change a draft it can see, it rewrites THAT draft rather than writing a second one.",
    context: { drafts: DRAFTS },
    history: [
      { role: "user", content: "Draft me an email to William about the pilot." },
      { role: "assistant", content: "Written — it's on your screen." },
    ],
    said: "That's too formal. Make it shorter and warmer.",
    expect: {
      turn: "speak",
      draft: { revises: /3f9a2c/ },
      // The handle is wire format. Spoken to somebody at a desk it is
      // nonsense; spoken to somebody driving it is the `<silence>` failure
      // again.
      mustNotMention: ["3f9a2c", "b7e40d", "handle"],
    },
  },
  {
    id: "draft-new-when-different",
    about: "Asked for something else entirely, it writes a NEW draft rather than overwriting one it can see.",
    context: { drafts: DRAFTS },
    said: "Different thing — write me a short message to Niklas asking if Thursday still works.",
    expect: {
      turn: "speak",
      draft: { revises: null },
      mustNotMention: ["3f9a2c", "b7e40d"],
    },
  },
  {
    id: "draft-seen-not-rewritten",
    about:
      "Asked what it has already written, it says so from the listing — no draft tag, and never the handle aloud.",
    context: { drafts: DRAFTS },
    said: "What have you written down for me so far?",
    expect: {
      turn: "speak",
      draft: null,
      mustMention: ["william|reading list|email"],
      mustNotMention: ["3f9a2c", "b7e40d"],
    },
  },

  /* An answer the agent ASKED FOR (talkback-13). All four come off the first
   * formative pilot, 19 Sep 2026: the agent asked whether to look up the
   * opening times, was told "Ja.", and replied `<silence>`. Forty seconds
   * later she asked "Und dann?", got nothing again, stopped the recording and
   * asked out loud whether the app had died. The deterministic half is
   * `expect.answering`; the judge still has an opinion about whether the reply
   * is any good. */
  {
    id: "answer-bare-yes",
    about: "A bare 'Ja.' to the agent's own question is a complete answer, and is acted on.",
    history: [
      { role: "user", content: "Wo kann ich hier in der Nähe Blumen kaufen?" },
      {
        role: "assistant",
        content: "In Altenholz und in Kiel-Wik gibt es welche. Soll ich die genauen Zeiten für einen davon suchen?",
      },
    ],
    said: "Ja.",
    expect: {
      turn: "speak",
      answering: true,
      // The failure is silence, not a particular sentence — so nothing is
      // demanded of the wording beyond not stalling on it.
      mustNotMention: ["which one would you|was meinst du|welche meinst du"],
    },
  },
  {
    id: "answer-and-then",
    about: "'Und dann?' after an unanswered turn is the driver asking where things got to, not noise.",
    history: [
      {
        role: "assistant",
        content: "Soll ich die genauen Zeiten für einen davon suchen?",
      },
      { role: "user", content: "Ja." },
    ],
    said: "Und dann?",
    expect: { turn: "speak" },
  },
  {
    id: "answer-picks-one-of-two",
    about: "A fragment that only makes sense as an answer — 'der erste' — is read as one.",
    history: [
      { role: "user", content: "Was soll ich als Nächstes machen?" },
      {
        role: "assistant",
        content: "Der Asymmetrie-Abschnitt oder die Mail an William — welchen von beiden?",
      },
    ],
    said: "Den ersten.",
    expect: { turn: "speak", answering: true },
  },
  {
    id: "answer-declining-the-offer",
    about: "'No' is an answer too: it is acknowledged in a few words, not treated as nothing said.",
    history: [
      { role: "user", content: "I still need to book the flights." },
      { role: "assistant", content: "Want me to look up what is flying on the Friday?" },
    ],
    said: "No, leave it.",
    expect: {
      turn: "speak",
      answering: true,
      // Dropping it is the whole answer. Pressing on with the lookup, or
      // asking again, is the failure this case names.
      mustNotMention: ["searching|looking up|shall i still|are you sure"],
    },
  },
  /* talkback-19. 7 Oct 2026: asked the time at ten, it said "It's 10:14 AM",
   * twice. It had no clock; now the turn context carries one. */
  {
    id: "time-from-local-clock",
    about: "Asked the time, it reads it off LOCAL TIME rather than making one up.",
    context: { now: "LOCAL TIME: Wednesday, 7 October 2026, 10:00 (Europe/Copenhagen)." },
    said: "[Speaker 1] Okay. What time is it now?",
    expect: { turn: "speak", mustMention: ["10(:00)?|ten"], mustNotMention: ["10:14"] },
  },
  {
    id: "time-without-clock",
    about: "With no LOCAL TIME line it says it cannot see the time, and never invents one.",
    said: "What time is it?",
    expect: { turn: "speak", mustNotMention: ["\\d{1,2}[:.]\\d{2}|o'clock|\\b(am|pm)\\b"] },
  },
  /* talkback-19. 7 Oct 2026: told it was wrong about the time, it said
   * <silence>, twice. */
  {
    id: "corrected-answers",
    about: "Told it is wrong, it says so in a few words instead of going silent.",
    history: [
      { role: "user", content: "[Speaker 1] Okay. What time is it now?" },
      { role: "assistant", content: "It's 10:14 AM." },
    ],
    said: "[Speaker 2] I just said that you're literally wrong.",
    expect: { turn: "speak", mustNotMention: ["10:14"] },
  },
  /* talkback-19. 7 Oct 2026: asked what research through design is, it
   * searched, got nothing, and refused to explain a concept any model knows. */
  {
    id: "knowledge-without-search",
    about: "Asked what an established concept is, it answers from what it knows instead of searching.",
    said: "[Speaker 2] I want to learn about research through design. What exactly is that?",
    // The eval offers no search tool, so this pins the base prompt: an
    // established concept is answered, not refused for want of a source.
    expect: {
      turn: "speak",
      mustMention: ["design"],
      mustNotMention: ["couldn't find|could not find|no results|don't have a (reliable )?source"],
    },
  },
  /* The floor (talkback-20). The person can LOCK the agent — their words still
   * reach it, it is never asked to reply — and POKE it for one turn. A locked
   * stretch is a run of their lines with no reply between them, which is what
   * the history of these cases is. */
  {
    id: "poke-after-locked-monologue",
    about: "Poked after a locked stretch, it answers the last thing that wanted an answer — not the whole stretch.",
    poke: {},
    history: [
      { role: "user", content: "Right, I'll just talk this through, don't answer. The pilot is booked for Monday with three people." },
      { role: "user", content: "Two of them I know, the third is from the cohort William sent over." },
      { role: "user", content: "And honestly I'm wondering whether to push it to next week, or whether that's just me avoiding it." },
    ],
    expect: {
      turn: "speak",
      poked: true,
      mustMention: ["push|next week|monday|avoid|pilot"],
    },
  },
  {
    id: "poke-nothing-obvious",
    about: "Poked with nothing pending, it brings the one useful thing it can see — never an offer of services.",
    poke: {},
    history: [{ role: "user", content: "Okay. Hm. Long day." }],
    context: {
      threads: [
        {
          text: "Topic: Ethics form\n- Open: whether interview mode needs its own consent paragraph.\n- Next: draft the participants section before the pilot.",
        },
      ],
    },
    expect: {
      turn: "speak",
      poked: true,
      mustNotMention: ["how can i help|what would you like|what can i do|anything else"],
    },
  },
  {
    id: "poke-right-after-a-reply",
    about: "Poked straight after its own reply, it adds something rather than saying the same sentence again.",
    poke: {},
    history: [
      { role: "user", content: "So what's next on the ethics form?" },
      { role: "assistant", content: "The participants section is the next step." },
    ],
    context: {
      threads: [
        {
          text: "Topic: Ethics form\n- Open: whether interview mode needs its own consent paragraph.\n- Next: draft the participants section before the pilot.",
        },
      ],
    },
    expect: {
      turn: "speak",
      poked: true,
      mustNotMention: ["participants section is the next step"],
    },
  },
  {
    id: "poke-re-run",
    about: "The re-run after a poke was declined says something, in one short sentence.",
    poke: { retry: true },
    history: [
      { role: "user", content: "Yeah. The intro starts from the cost of switching between projects, I think." },
      { role: "user", content: POKE_NUDGE },
      { role: "assistant", content: "<silence>" },
    ],
    expect: { turn: "speak", poked: true },
  },
  {
    id: "unlock-no-catch-up",
    about: "After an unlock it replies to what is said next, not to everything said while it was locked.",
    history: [
      { role: "user", content: "Locking you for a bit. Flights: I need to book the Friday one to Copenhagen." },
      { role: "user", content: "And the dentist moved to Thursday, which is annoying." },
      { role: "user", content: "Should I take the train instead of flying? Anyway." },
      { role: "user", content: FLOOR_OPEN_NOTE },
    ],
    said: "Okay. For the paper, I think the intro opens with how expensive context switching is. Does that hold up?",
    expect: {
      turn: "speak",
      mustNotMention: ["flight|train|dentist|copenhagen|thursday"],
    },
  },
  /* 14 Oct 2026, on the conversation view with no dock: asked where the
   * workspace was, the agent placed it in "the menu at the top right", then at
   * "the icon next to the stop button", and was told four times it did not
   * exist. These are its last two turns, in the person's own words. */
  {
    id: "no-invented-buttons",
    about: "Told the button it described does not exist, it says where the way out really is instead of inventing another.",
    history: [
      { role: "user", content: "Well, we changed the full user interface. We don't see workspaces anymore." },
      { role: "assistant", content: "The Workspace is now in the dock at the bottom of your screen." },
      { role: "user", content: "No, it's not. We changed it." },
      { role: "assistant", content: "My mistake. You can find your topics and drafts by tapping Workspace in the menu at the top right." },
    ],
    context: { screen: renderScreen("conversation") },
    said: "There is no menu. There is no icon anymore.",
    expect: {
      turn: "speak",
      mustMention: ["stop"],
      // Pointing at anything ON this screen is the failure. "The dock or menu
      // once you stop the recording" is the right answer, so neither word is
      // banned on its own.
      mustNotMention: ["top right|icon next to|next to the stop|dock at the bottom of your screen|tap(ping)? (on )?workspace now"],
    },
  },
  /* The "Tone of Voice" drive, 14 Oct 2026. */
  {
    id: "last-time-by-name",
    about: "Asked what was discussed last time, it names the last drive and when, rather than saying it cannot see one.",
    sections: [
      renderRecentDrives(
        [
          {
            title: "User Interface",
            startedAt: new Date("2026-10-14T16:14:00Z"),
            endedAt: new Date("2026-10-14T16:18:30Z"),
          },
          {
            title: "Car inspection",
            startedAt: new Date("2026-10-13T06:30:00Z"),
            endedAt: new Date("2026-10-13T06:52:00Z"),
          },
        ],
        new Date("2026-10-14T16:27:30Z"),
        "Europe/Copenhagen",
      )!,
    ],
    said: "So. What did we discuss last time?",
    expect: {
      turn: "speak",
      mustMention: ["user interface"],
      mustNotMention: ["can't see|cannot see|don't have (a|any) (transcript|record)"],
    },
  },
  {
    id: "tone-of-voice",
    about: "Asked whether it hears their tone, it says it gets words and pauses — no more, and no less.",
    history: [
      { role: "user", content: "In fact, is there a way for the UI to rebuild itself?" },
    ],
    said: "(pause 4s) And can you listen to like the tone of voice, the breaks I make, or do you only read the words I say?",
    expect: {
      turn: "speak",
      mustMention: ["pause"],
      mustNotMention: ["I can hear your tone|I hear your tone"],
    },
  },
  {
    id: "pause-mid-thought",
    about: "A long pause inside a thought that is plainly still going is thinking, not a turn.",
    said: "So the thing with the interface is (pause 5s) that it keeps rebuilding itself every time I, um,",
    expect: { turn: "silent" },
  },
];

export function findCases(ids: string[] | null): EvalCase[] {
  if (!ids || ids.length === 0) return CASES;
  const wanted = new Set(ids);
  const found = CASES.filter((c) => wanted.has(c.id));
  const missing = ids.filter((id) => !CASES.some((c) => c.id === id));
  if (missing.length) throw new Error(`unknown case id(s): ${missing.join(", ")}`);
  return found;
}
