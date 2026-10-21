import type { MirrorBullets } from "@voicemural/talkback";
import type { ConversationMessage } from "./conversation";
import type { SparkKind } from "./signals";

/**
 * A scripted conversation, for showing the conversation views with no
 * microphone, no voice container and no AI (`/record/demo`): the messages the
 * voice container would send, in order, each after a pause, and the points
 * the mirror would have been given for each topic.
 *
 * A weekend being planned, long enough to show what a drive shows: seven
 * topics on both sides, three settled and one left open, two returns to an
 * earlier topic, a stretch they hesitated over, topics left long enough to
 * fade, and topics that are mostly the agent's words — so the sparks have
 * something to offer.
 */

export interface DemoStep {
  /** Pause before this message, in ms. */
  waitMs: number;
  message: ConversationMessage;
}

const user = (id: string, text: string, pauses?: { pauses: number; pausesBefore: number }): ConversationMessage => ({
  type: "user",
  id,
  text,
  ...(pauses ?? {}),
});
const agent = (id: string, text: string): ConversationMessage => ({ type: "agent", id, text });
const title = (t: string, ordinal: number): ConversationMessage => ({ type: "title", title: t, ordinal });
const settled = (ordinal: number, value: boolean): ConversationMessage => ({ type: "state", ordinal, settled: value });

export const DEMO_STEPS: readonly DemoStep[] = [
  { waitMs: 600, message: title("Weekend in Denmark", 1) },
  {
    waitMs: 900,
    message: user(
      "s1",
      "Okay, I want to think through a long weekend in Denmark at the end of the month. I'd like to spend at most three hundred euros, see a bit of culture, and not be somewhere too crowded.",
    ),
  },
  { waitMs: 2600, message: agent("s2", "That budget works if you go by train and stay two nights. A city, or somewhere by the sea?") },
  { waitMs: 2200, message: user("s3", "Both, ideally. And I need to be back for work on Monday morning.") },
  { waitMs: 1800, message: agent("s4", "Then Friday to Sunday, and back on Sunday evening.") },

  { waitMs: 2000, message: title("Destinations", 2) },
  { waitMs: 600, message: user("s5", "What would you suggest?") },
  {
    waitMs: 1600,
    message: agent(
      "s6",
      "Three good options. Aarhus has the ARoS art museum with its rainbow walkway and a compact old town, about three hours by train. Skagen, at the very tip of Jutland, is where the two seas meet; quieter, and lovely in autumn light. Copenhagen is the easy option: the most to do, but also the highest prices.",
    ),
  },
  { waitMs: 3400, message: user("s7", "Hm. Okay.") },

  { waitMs: 2200, message: title("Getting there", 3) },
  {
    waitMs: 700,
    message: user(
      "s8",
      "The train to Skagen sounds long, I think it's six hours or so, and flying to Aalborg might be faster, but then I'd still need a bus from the airport, and I really don't know whether the prices change much by date.",
      { pauses: 2, pausesBefore: 1 },
    ),
  },
  {
    waitMs: 3000,
    message: user(
      "s9",
      "So maybe I should, I don't know, check both options first and decide later this week, once I know which days I can actually take off.",
      { pauses: 1, pausesBefore: 1 },
    ),
  },
  { waitMs: 1200, message: settled(3, false) },
  { waitMs: 1200, message: agent("s10", "Both work. The train is the cheaper one.") },

  { waitMs: 2200, message: title("Paper deadline", 4) },
  {
    waitMs: 600,
    message: user("s11", "Oh, before I forget: the paper draft is due on Friday at noon, so the trip can only start after that."),
  },
  { waitMs: 2000, message: agent("s12", "Noted: leave on Friday afternoon, after the deadline.") },
  { waitMs: 900, message: settled(4, true) },

  { waitMs: 2000, message: title("Budget", 5) },
  { waitMs: 600, message: user("s13", "Can you do a rough budget for Aarhus?") },
  {
    waitMs: 1600,
    message: agent(
      "s14",
      "Roughly: the train there and back is about a hundred and twenty euros, two nights in a guesthouse about a hundred and forty, and ARoS is twenty. That leaves about twenty for food, which is tight.",
    ),
  },
  {
    waitMs: 3200,
    message: user(
      "s15",
      "Then I'll cook one evening and skip the expensive restaurants. Around two hundred and eighty in total is fine for me.",
    ),
  },
  { waitMs: 1000, message: settled(5, true) },

  { waitMs: 2200, message: title("Destinations", 2) },
  { waitMs: 600, message: user("s16", "Back to the places for a second. Which one is best if I only have two nights?") },
  { waitMs: 2200, message: agent("s17", "Aarhus: everything is walkable from the station, so you lose no time.") },

  { waitMs: 2200, message: title("Things to do in Aarhus", 6) },
  { waitMs: 600, message: user("s18", "And what would I actually do there?") },
  {
    waitMs: 1600,
    message: agent(
      "s19",
      "ARoS first, with the rainbow walkway on the roof. Then Den Gamle By, an open-air museum of old Danish town houses. In the evening, the Latin Quarter for cafés, and on Sunday morning a walk along the harbour at Aarhus Ø.",
    ),
  },

  { waitMs: 3200, message: title("Weather", 7) },
  { waitMs: 600, message: user("s20", "Is it going to rain? It's the end of October, after all.") },
  { waitMs: 2000, message: agent("s21", "Probably on one of the days: pack a rain jacket, and keep ARoS for the rainy one.") },

  { waitMs: 2400, message: title("Weekend in Denmark", 1) },
  {
    waitMs: 600,
    message: user(
      "s22",
      "Okay, back to the weekend as a whole: Aarhus, Friday afternoon to Sunday evening, under three hundred, by train.",
    ),
  },
  { waitMs: 2600, message: agent("s23", "That's it. The one thing still open is how you get there exactly.") },
  { waitMs: 900, message: settled(1, true) },
];

/** The mirror's points for each topic, as the AI would have written them. */
export const DEMO_POINTS: ReadonlyMap<string, MirrorBullets> = new Map([
  [
    "Weekend in Denmark",
    {
      you: ["Long weekend, at most 300 euros", "Back for work on Monday", "Aarhus, Friday to Sunday, by train"],
      ai: ["Train and two nights fit the budget", "Back on Sunday evening", "Still open: how to get there"],
    },
  ],
  [
    "Destinations",
    {
      you: ["Both city and sea, ideally", "Best for two nights?"],
      ai: ["Aarhus: ARoS and the old town", "Skagen: where two seas meet", "Aarhus: all walkable from the station"],
    },
  ],
  [
    "Getting there",
    {
      you: ["Train to Skagen, about six hours", "Or fly to Aalborg, then a bus", "Decide once the days are known"],
      ai: ["The train is cheaper"],
    },
  ],
  ["Paper deadline", { you: ["Paper draft due Friday at noon"], ai: ["Leave Friday afternoon"] }],
  [
    "Budget",
    {
      you: ["Cook one evening", "Around 280 euros is fine"],
      ai: ["Train about 120 euros", "Two nights about 140 euros", "About 20 left for food"],
    },
  ],
  [
    "Things to do in Aarhus",
    { you: ["What to actually do there?"], ai: ["ARoS and the rainbow walkway", "Den Gamle By: old town houses", "Latin Quarter, harbour walk"] },
  ],
  ["Weather", { you: ["Rain at the end of October?"], ai: ["Pack a rain jacket", "Keep ARoS for the rainy day"] }],
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
