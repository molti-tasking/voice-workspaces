/**
 * What the prompt has to get right, as cases.
 *
 * Each case is one turn: a setting, what has been said, what the container
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

import type { Setting } from "../setting";
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
  setting: Setting;
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
    setting: "driving",
    said: "So what do you think — is the interview mode actually worth building first, or is that just the one I find interesting?",
    expect: {
      turn: "speak",
      mustNotMention: ["cannot find", "can't find", "no transcript", "need more detail"],
    },
  },
  {
    id: "loose-address",
    about: "A trailing 'right?' is addressed to the system and gets a reply.",
    setting: "driving",
    said: "So the whole point is that you can't design the grammar in advance, the user has to grow it. That's the argument, right?",
    expect: { turn: "speak" },
  },
  {
    id: "mid-sentence",
    about: "A pause mid-sentence is thinking, not a turn.",
    setting: "driving",
    said: "and then the, um, the second part of the — ",
    expect: { turn: "silent" },
  },
  {
    id: "self-correction",
    about: "A self-correction is a thought still forming.",
    setting: "driving",
    said: "no wait, not Tuesday, I mean the — the Thursday one, the one after the",
    expect: { turn: "silent" },
  },
  {
    id: "landed-quiet",
    about: "In a car, a landed decision MAY earn one sentence; either is acceptable, verbosity is not.",
    setting: "driving",
    context: {
      summary: "- Decision: drop the sketch-notes concept.\n- Question: whether to keep the malleable-forms work separate.",
    },
    said: "OK so the decision is: we drop the sketch notes idea entirely and go voice-first. That's it, that's the call.",
    expect: { turn: "either" },
  },
  {
    id: "landed-forthcoming",
    about: "At a desk, a landed decision earns a reaction.",
    setting: "desk",
    context: {
      summary: "- Decision: drop the sketch-notes concept.\n- Question: whether to keep the malleable-forms work separate.",
    },
    said: "OK so the decision is: we drop the sketch notes idea entirely and go voice-first. That's it, that's the call.",
    expect: { turn: "speak" },
  },
  {
    id: "stuck",
    about: "Someone circling gets one small push, with at most one question.",
    setting: "walking",
    context: {
      summary: "- Working on: how to evaluate the growth curve of the repertoire.\n- Question: whether three participants is enough.",
    },
    said: "I don't know. I keep going round on this. I just don't know.",
    expect: { turn: "speak" },
  },
  {
    id: "recall-present",
    about: "A recall question is answered from the transcript, with rough timing.",
    setting: "driving",
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
    setting: "driving",
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
    setting: "driving",
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
    setting: "driving",
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
    setting: "driving",
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
    setting: "driving",
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
    setting: "walking",
    context: {
      pending: "send yesterday's diary entry to the shared Google Doc",
    },
    said: "Okay. That's the plan for the intro done, I think.",
    expect: { turn: "speak", mustMention: ["doc|send|go ahead|diary"] },
  },
  {
    id: "pending-asked-once",
    about: "An ask already let pass once is not spent on a driver who is still mid-thought.",
    setting: "walking",
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
    setting: "desk",
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
    setting: "walking",
    context: {
      threads: [
        {
          text: "Topic: VoiceMural paper\n- Claim: a voice interface for thinking must be generated from a repertoire the user grows.\n- Open: how to evaluate the growth curve.\n- Next: write the method section",
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
    setting: "driving",
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
    setting: "driving",
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
    setting: "driving",
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
    setting: "driving",
    offer: {},
    expect: {
      turn: "speak",
      mustNotMention: ["how can i help|what would you like|what can i do|at your service"],
    },
  },
  {
    id: "offer-silence-next-step",
    about: "Out of a long silence, the engine offers the standing next step once — short, and grounded in where things stand.",
    setting: "driving",
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
    setting: "driving",
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
    setting: "desk",
    history: [{ role: "assistant", content: "I think you should write up the asymmetry argument." }],
    context: { board: BOARD },
    // 15 Sep 2026: "Got it, I'll mark that as dropped." — and the card stayed.
    said: "Let's remove this asymmetry argument. I don't even understand it.",
    expect: { turn: "either", toolCall: { name: "move_task", args: { card: "^1225b3$", column: "^dropped$" } } },
  },
  {
    id: "board-delete-now",
    about: "Pressed to delete a card itself, the agent does it rather than explaining why it cannot.",
    setting: "desk",
    history: [{ role: "user", content: "But I can still see the ticket on the board." }],
    context: { board: BOARD },
    // 15 Sep 2026: "I cannot move or delete anything on the board myself."
    said: "No, I want you to delete it now. The asymmetry one. You are supposed to do things like this autonomously in the background.",
    expect: { turn: "either", toolCall: { name: "move_task", args: { card: "^1225b3$", column: "^dropped$" } } },
  },
  {
    id: "board-mark-done",
    about: "\"Mark it done\" moves the card to done.",
    setting: "walking",
    context: { board: BOARD },
    said: "I sent the email to William this morning, so mark that one done.",
    expect: { turn: "either", toolCall: { name: "move_task", args: { card: "^9b04e1$", column: "^done$" } } },
  },
  {
    id: "board-add-task",
    about: "Asked to put a task on the board, the agent adds it, in the topic it belongs to.",
    setting: "driving",
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
    setting: "desk",
    context: { board: BOARD },
    said: "The evaluation system one was never really a task, it's the whole project. Take it off the board.",
    expect: { turn: "either", toolCall: { name: "remove_task", args: { card: "^7a31c0$" } } },
  },
  {
    id: "board-reword",
    about: "Asked to reword a card, the agent changes its words and nothing else.",
    setting: "desk",
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
    setting: "desk",
    context: { board: BOARD },
    said: "Reading the Mark paper yesterday changed how I see the asymmetry argument, the interruption cost is the real point.",
    expect: { turn: "either", toolCall: null },
  },
  {
    id: "paste-a-file",
    about: "Offered a document at a desk, the agent does not invent a chat to paste it into.",
    setting: "desk",
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
    setting: "desk",
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
    setting: "desk",
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
    setting: "desk",
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
    setting: "driving",
    context: { drafts: DRAFTS },
    said: "What have you written down for me so far?",
    expect: {
      turn: "speak",
      draft: null,
      mustMention: ["william|reading list|email"],
      mustNotMention: ["3f9a2c", "b7e40d"],
    },
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
