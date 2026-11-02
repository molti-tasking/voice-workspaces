// The `/comprehension` subpath, not the package index: the index pulls in server code.
import type { TopicComprehension } from "@voicemural/talkback/comprehension";
import type { Conversation } from "./conversation";

/**
 * What the comprehension monitor (DRAFT) would find in the scripted
 * conversation (`demo-conversation.ts`), written by hand so the simulated
 * conversation shows the marks and the Rethink section with no AI behind it.
 * A topic's finding appears once the talk has left it, as the live monitor's
 * would.
 */
const SCRIPTED: readonly TopicComprehension[] = [
  {
    ordinal: 3,
    ideas: [
      { text: "Train is the cheaper option", origin: "assistant", hold: "borrowed", why: "said by the assistant, never picked up" },
      { text: "Check both options, decide this week", origin: "you", hold: "shaky", why: "hedged twice, no criterion for deciding" },
    ],
    check: {
      kind: "commit",
      question: "Before comparing prices: train or flight to Aalborg, and what would make you switch?",
      about: "Check both options, decide this week",
    },
  },
  {
    ordinal: 5,
    ideas: [
      { text: "About 280 € in total", origin: "both", hold: "held", why: "you set the total and accepted it" },
      { text: "Twenty euros left for food is tight", origin: "assistant", hold: "borrowed", why: "you reacted, but did not check the numbers" },
    ],
    check: {
      kind: "predict",
      question: "If the guesthouse turns out to cost 180, where does the budget give first?",
      about: "Twenty euros left for food is tight",
    },
  },
];

export function demoComprehension(conversation: Conversation): ReadonlyMap<number, TopicComprehension> {
  const left = new Set(
    conversation.sections.flatMap((s) => (s.ordinal !== undefined && s.key !== conversation.current ? [s.ordinal] : [])),
  );
  return new Map(SCRIPTED.filter((c) => left.has(c.ordinal)).map((c) => [c.ordinal, c]));
}
