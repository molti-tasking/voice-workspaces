import type { MirrorBullets } from "@voicemural/talkback";
import type { ConversationMessage } from "./conversation";
import type { SparkKind } from "./signals";

/**
 * A scripted conversation, for showing the conversation views with no
 * microphone, no voice container and no AI (`/record/demo`): the messages the
 * voice container would send, in order, each after a pause, and the points
 * the mirror would have been given for each topic.
 *
 * Written to exercise everything a drive shows: topics on both sides, one
 * settled and one left open, a return to an earlier topic, and enough words
 * for the sparks to offer something (one topic mostly the agent's, one talked
 * through at length and still open).
 */

export interface DemoStep {
  /** Pause before this message, in ms. */
  waitMs: number;
  message: ConversationMessage;
}

const user = (id: string, text: string): ConversationMessage => ({ type: "user", id, text });
const agent = (id: string, text: string): ConversationMessage => ({ type: "agent", id, text });
const title = (t: string, ordinal: number): ConversationMessage => ({ type: "title", title: t, ordinal });

export const DEMO_STEPS: readonly DemoStep[] = [
  { waitMs: 600, message: title("Weekend in Denmark", 1) },
  {
    waitMs: 900,
    message: user(
      "d1",
      "Okay, so I'm thinking about a long weekend in Denmark at the end of the month. I don't want to spend more than three hundred euros, and I'd like somewhere with a bit of culture, but not too crowded.",
    ),
  },
  {
    waitMs: 2200,
    message: agent("d2", "That budget works if you go by train and stay two nights. A city, or somewhere by the sea?"),
  },
  { waitMs: 2000, message: title("Destinations", 2) },
  { waitMs: 600, message: user("d3", "Somewhere with both, ideally. What would you suggest?") },
  {
    waitMs: 2200,
    message: agent(
      "d4",
      "Three good options. Aarhus has the ARoS art museum with its rainbow walkway and a compact old town, about three hours by train. Skagen, at the very tip of Jutland, is where the two seas meet; quieter, and lovely in autumn light. Copenhagen is the easy option: the most to do, but also the highest prices.",
    ),
  },
  { waitMs: 2600, message: title("Getting there", 3) },
  {
    waitMs: 700,
    message: user(
      "d5",
      "Hm, I'm not sure. The train to Skagen sounds long, I think it's six hours or so, and flying to Aalborg might be faster, but then I'd still need a bus from the airport, and I really don't know whether the prices change much by date, so maybe I should, I don't know, check both options first and decide later this week, when I know which days I can actually take off.",
    ),
  },
  { waitMs: 1200, message: { type: "state", ordinal: 3, settled: false } },
  { waitMs: 1200, message: agent("d6", "Both work. The train is the cheaper one.") },
  { waitMs: 2200, message: title("Paper deadline", 4) },
  {
    waitMs: 600,
    message: user("d7", "Oh, before I forget: the paper draft is due on Friday, so the trip has to come after that."),
  },
  { waitMs: 1800, message: agent("d8", "Noted: the trip goes after Friday's deadline.") },
  { waitMs: 900, message: { type: "state", ordinal: 4, settled: true } },
  { waitMs: 2200, message: title("Weekend in Denmark", 1) },
  { waitMs: 600, message: user("d9", "Back to the weekend, then: so it's two nights, Friday to Sunday?") },
  { waitMs: 2000, message: agent("d10", "Yes: leave Friday after the deadline, back on Sunday evening.") },
];

/** The mirror's points for each topic, as the AI would have written them. */
export const DEMO_POINTS: ReadonlyMap<string, MirrorBullets> = new Map([
  [
    "Weekend in Denmark",
    {
      you: ["Long weekend, at most 300 euros", "Culture, not too crowded", "Two nights, Friday to Sunday"],
      ai: ["Train and two nights fit the budget", "Leave Friday, back Sunday evening"],
    },
  ],
  [
    "Destinations",
    {
      you: ["Somewhere with both city and sea"],
      ai: ["Aarhus: ARoS and the old town", "Skagen: where two seas meet", "Copenhagen: the easy option"],
    },
  ],
  [
    "Getting there",
    { you: ["Train to Skagen, about six hours", "Or fly to Aalborg, then a bus", "Decide once the days are known"], ai: ["The train is cheaper"] },
  ],
  ["Paper deadline", { you: ["Paper draft due Friday"], ai: ["Trip after Friday's deadline"] }],
]);

/** What the agent asks when a spark is pulled in the simulation. */
export function demoSparkQuestion(kind: SparkKind, topic: string): string {
  switch (kind) {
    case "say_back":
      return `In your own words: what did we say about ${topic}?`;
    case "decide":
      return `If you had to decide ${topic.toLowerCase()} now, what would it be?`;
    case "unsure":
      return `What makes you unsure about ${topic.toLowerCase()}?`;
    case "revisit":
      return `Back to ${topic.toLowerCase()}: where did we leave it?`;
  }
}
