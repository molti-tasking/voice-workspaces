import { stripFillers } from "./speech-cues";

/**
 * "Keep this one": the person marking a subject as theirs to hold.
 *
 * WHAT KEEPING MEANS. With `sparkSelection: "chosen"`, the person decides
 * which subjects of a drive they want to keep in their own head; Souffleur
 * holds the rest on the workspace, and sparks are offered on the kept ones
 * only. They keep by tapping Keep on a subject, or — with the phone untouched
 * — by saying so, which is what this recognises.
 *
 * A WHOLE TURN, NEVER A PHRASE INSIDE ONE. "I want to keep this simple" and
 * "we should keep that budget" contain the words; neither is a command. So a
 * turn counts only when, after fillers and a little courtesy at either end
 * ("okay", "please"), the command is all of it. Under-hearing is the safe
 * direction: a keep that was missed can be tapped; a keep that was invented
 * changes which sparks they are offered without their having asked.
 *
 * NOT "REMEMBER THIS". Said to the agent, "remember this" asks IT to hold
 * something — the opposite of keeping it yourself — so it is deliberately not
 * here. "I want to remember this" is: it says who does the remembering.
 *
 * English and German, like the other cues. Pure, so the recorder's live
 * detection and its tests are the same function.
 */

export type KeepRequest = "keep" | "unkeep";

/** Said around the command without changing it. */
const COURTESY_BEFORE = /^(?:(?:ok(?:ay)?|alright|all right|right|yes|yeah|so|and|please|souffleur|also|ja|gut|bitte|und|so)\s+)+/;
const COURTESY_AFTER = /(?:\s+(?:please|for me|then|thanks|thank you|bitte|danke|mal))+$/;

/** At most this many words once the courtesy is off: a command, not a sentence. */
const MAX_WORDS = 8;

const THIS = "(?:this|that|it)(?: one| topic| subject| bit| point)?";
const DIES = "(?:das|dies|den|die|diesen|dieses|diese)(?: hier| da| thema| punkt)?";

const KEEP: readonly RegExp[] = [
  new RegExp(`^keep ${THIS}$`),
  new RegExp(`^(?:i|i'd|i would|i will|i'll) (?:want to |like to |wanna )?keep ${THIS}$`),
  new RegExp(`^i want to remember ${THIS}(?: myself)?$`),
  new RegExp(`^(?:let me|i'm going to|i am going to|gonna) keep ${THIS}$`),
  new RegExp(`^${THIS} (?:i want to|i'd like to|i will|i'll) keep$`),
  new RegExp(`^(?:ich )?(?:will|möchte|mag) ${DIES} behalten$`),
  new RegExp(`^${DIES} (?:will|möchte) ich behalten$`),
  new RegExp(`^behalt(?:e|en)? (?:ich )?${DIES}$`),
  new RegExp(`^${DIES} (?:will|möchte) ich mir merken$`),
  new RegExp(`^ich (?:will|möchte) mir ${DIES} merken$`),
];

const UNKEEP: readonly RegExp[] = [
  new RegExp(`^(?:don't|do not|dont) keep ${THIS}$`),
  new RegExp(`^(?:i )?(?:don't|do not|dont) (?:want to |need to )?keep ${THIS}(?: after all)?$`),
  new RegExp(`^(?:unkeep|forget about keeping|stop keeping) ${THIS}$`),
  new RegExp(`^${DIES} (?:doch )?nicht behalten$`),
  new RegExp(`^(?:ich )?(?:will|möchte) ${DIES} (?:doch )?nicht behalten$`),
  new RegExp(`^${DIES} (?:will|möchte) ich (?:doch )?nicht behalten$`),
];

/**
 * Lower-cased, punctuation dropped, single-spaced — like `normalise` in
 * speech-cues.ts, except that apostrophes stay: "don't keep this" and "do
 * keep this" must not read the same.
 */
function plain(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘´`]/g, "'")
    .replace(/[.,!?;:"„“”…—–-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Whether a turn, as said, is a request to keep or to stop keeping the current subject. */
export function keepRequest(text: string): KeepRequest | null {
  const said = plain(stripFillers(text))
    .replace(COURTESY_BEFORE, "")
    .replace(COURTESY_AFTER, "")
    .trim();
  if (!said || said.split(" ").length > MAX_WORDS) return null;
  if (UNKEEP.some((pattern) => pattern.test(said))) return "unkeep";
  if (KEEP.some((pattern) => pattern.test(said))) return "keep";
  return null;
}
