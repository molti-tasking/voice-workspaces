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

export interface EvalCase {
  id: string;
  /** Why this case exists, in one line. Shown next to a failure. */
  about: string;
  setting: Setting;
  /** Earlier turns, oldest first. `[Speaker N]` tags as the container writes them. */
  history?: { role: "user" | "assistant"; content: string }[];
  context?: EvalContext;
  /** What was just said. */
  said: string;
  expect: {
    turn: TurnExpectation;
    /** Regex sources, case-insensitive. All must match a spoken reply. */
    mustMention?: string[];
    /** Regex sources, case-insensitive. None may match a spoken reply. */
    mustNotMention?: string[];
  };
}

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
];

export function findCases(ids: string[] | null): EvalCase[] {
  if (!ids || ids.length === 0) return CASES;
  const wanted = new Set(ids);
  const found = CASES.filter((c) => wanted.has(c.id));
  const missing = ids.filter((id) => !CASES.some((c) => c.id === id));
  if (missing.length) throw new Error(`unknown case id(s): ${missing.join(", ")}`);
  return found;
}
