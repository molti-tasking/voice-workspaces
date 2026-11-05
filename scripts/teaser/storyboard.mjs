/**
 * What the teaser says, and how long each beat holds.
 *
 * Words and timing live here. The layout lives in stage.html, and the order
 * of the beats in film.mjs. The conversation on the phone is the app's own
 * demo script, apps/web/src/lib/talkback/demo-conversation.ts.
 */

/** The size of the video. scale: 2 renders 3840×2160 from the same layout. */
export const FRAME = { width: 1920, height: 1080, scale: 1 };

/** The full-screen cards at the start and the end. */
export const OPENING = { name: "Souffleur", line: "A glanceable display for mobile voice conversations", holdMs: 2600 };
export const CLOSING = { name: "Souffleur", line: "A Glanceable Display for Mobile Voice Conversations", holdMs: 3500 };

/** The small label above the phone, before and after the morph. */
export const LABEL = { before: "Chat transcript", after: "Souffleur" };

/** Who calls during the interruption. */
export const CALLER = { initial: "M", name: "Mum", sub: "mobile" };

/**
 * The captions beside the phone, in the order they appear. `kicker` is the
 * small coloured line above the title; leave it "" for none. A beat without
 * `holdMs` lasts until the conversation reaches its cue (see CUES).
 */
export const BEATS = {
  setting: {
    kicker: "Mobile voice conversations",
    title: "Talking it through, on the go.",
    text: "Walking, cooking, commuting: the conversation is the secondary task, and the phone is something to glance at.",
    holdMs: 5000,
  },
  transcript: {
    kicker: "Today",
    title: "The screen shows a chat transcript.",
    text: "After a few minutes, it is a column of text you cannot take in at a glance.",
    // Until CUES.callAfter has been said.
  },
  call: {
    kicker: "",
    title: "Then a call comes in.",
    text: "On the go, interruptions are the rule, not the exception.",
    holdMs: 3200,
  },
  where: {
    kicker: "A minute later",
    title: "Where were we?",
    text: "The last few lines rarely say where the conversation stood, what was decided, or what is still open.",
    holdMs: 3600,
  },
  same: {
    kicker: "",
    title: "The same conversation…",
    text: "Five topics, spread over fifteen turns.",
    // While the transcript zooms out and tints by topic.
  },
  stack: {
    kicker: "Souffleur",
    title: "…as a stack of topics.",
    text: "Each topic keeps its place, with what was decided so far: the conversation in a fraction of the words.",
    holdMs: 3200, // after the morph has landed
  },
  return: {
    kicker: "Souffleur",
    title: "Going back is the only motion.",
    text: "An earlier topic comes down into the card. It leaves a gap, so nothing else moves.",
    holdMs: 4500, // after the return has landed
  },
  live: {
    kicker: "Souffleur",
    title: "Live words at the bottom.",
    text: "The current topic, its decision so far, and what was just said. Everything else, a glance away.",
    // Until the conversation ends.
  },
};

/** Moments in the demo conversation the film waits for. */
export const CUES = {
  /** Words in the transcript; the call comes 2.5 s after they appear. */
  callAfter: "Around two hundred and eighty",
  /** The topic whose return the "return" beat shows. */
  returnTo: "Destinations",
};

/** The transcript → stack morph, in ms. */
export const MORPH = {
  zoomMs: 1700, // the transcript zooms out to its full length
  tintMs: 700, // turns tint by topic
  holdMs: 1300, // tinted, words still visible
  dropMs: 600, // the words fade; the coloured blocks remain
  flyMs: 1300, // each block flies into its card
  stagger: 170, // between one topic's flight and the next
};

/**
 * Which turns belong to which topic in the morph, and its tint. A turn
 * belongs to a topic when its text starts with one of the phrases. Update
 * this when the demo conversation changes.
 */
export const TOPICS = [
  ["Weekend in Denmark", "#f4b9a0", ["Okay, I want to think", "That budget works", "Both, ideally", "Then Friday to Sunday", "Okay, back to the weekend", "That's it."]],
  ["Destinations", "#a9c6f4", ["What would you suggest", "Three good options", "Hm. Okay", "Back to the places", "Aarhus: everything"]],
  ["Getting there", "#f3d27f", ["The train to Skagen", "So maybe I should", "Both work."]],
  ["Paper deadline", "#c7b5f1", ["Oh, before I forget", "Noted: leave"]],
  ["Budget", "#9fd9bb", ["Can you do a rough", "Roughly:", "Then I'll cook"]],
  ["Things to do in Aarhus", "#f2b3cf", ["And what would I", "ARoS first"]],
  ["Weather", "#b6e0ea", ["Is it going to rain", "Aarhus weather", "Probably on one"]],
];

/**
 * Time-lapse in the cut: stretches between two markers that play faster.
 * The markers are set in film.mjs: chat-fast/chat-slow around the transcript
 * playing, stack-fast/stack-slow around the stack playing after the return.
 */
export const SPEED = [
  ["chat-fast", "chat-slow", 2.5],
  ["stack-fast", "stack-slow", 2],
];
