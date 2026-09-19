/**
 * The three worked examples `/welcome` invites people to try.
 *
 * ## Why examples exist at all
 *
 * Two of the first peers said the same thing in different words: *"it seemed
 * like an organizer for voice memos"* and *"I didn't really know what it could
 * do so I didn't know how to get started"*. That is G1 — make clear what the
 * system can do — failing, and it is the guideline the research this app serves
 * already scores as only partial. On a screen an empty state can list features;
 * here the interface is a microphone, and someone holding one with nothing to
 * say gets nothing back.
 *
 * ## Why exactly three, and why they are these three
 *
 * Each names something a voice-memo app cannot do, because that is the
 * confusion being answered. `think_aloud` ends with the board moving; `draft`
 * ends with text on the clipboard; `recall` only works on a second drive. Task
 * lists and groceries are deliberately absent from the invitation: they sound
 * like every other assistant, and they invite the comparison this system loses.
 *
 * ## Why the choice is recorded
 *
 * Seeding examples has a real cost to the claim this project rests on — a
 * capability somebody was SHOWN is not one they grew. That cost is acceptable
 * for a week-long probe and unacceptable if it is invisible, so the drive
 * carries which example started it (`capture_session.use_case`) and a drive
 * begun any other way carries null. "Which example did people pick, and which
 * did they abandon after one drive" is then a count rather than an anecdote.
 *
 * CLIENT-SAFE. No imports, no I/O — this is read by a client component and by
 * the recorder's provider. The wire enum lives in `@voicemural/shared`
 * (`CaptureUseCase`) and the column in `@voicemural/db`; keep all three in step.
 */

export type UseCaseId = "think_aloud" | "draft" | "recall";

export interface UseCase {
  id: UseCaseId;
  /** Shown as the card's heading. An outcome, never a feature name. */
  title: string;
  /** One line: what they get, in their terms. */
  promise: string;
  /**
   * Something they can actually say out loud, first try.
   *
   * The most load-bearing field on the card. "Try asking it about your work" is
   * what produced the blank-microphone problem; a sentence somebody can read
   * off a screen and repeat is what fixes it.
   */
  opening: string;
  /** What to say next, once it has answered. Where the second half lives. */
  then: string;
  /** Why this is not a voice memo — the sentence that answers the confusion. */
  point: string;
}

export const USE_CASES: readonly UseCase[] = [
  {
    id: "think_aloud",
    title: "Think a problem out, and come back to a board",
    promise:
      "Talk through something unresolved. It listens, and what you decide turns into tasks you can see afterwards.",
    opening:
      "I need to work out how to structure the method section. Let me think out loud for a bit.",
    then: "When something lands, say so — “right, that's decided” — or “mark that one done”.",
    point: "It hears a decision and moves the card. A recording app just keeps the audio.",
  },
  {
    id: "draft",
    title: "Get something written you can paste",
    promise:
      "Ask for an email, a message or notes. It writes them to the screen instead of reading them at you, and you can change them by voice.",
    opening: "Draft me a message to my sister with the action items from this.",
    then: "Then change it without repeating yourself: “make it shorter”, “warmer”, “fix the name”.",
    point: "The second ask revises the same draft rather than producing a second one.",
  },
  {
    id: "recall",
    title: "Pick the thread up tomorrow",
    promise:
      "Record something today, then start a second drive another day and ask where you got to.",
    opening: "Where did I get to on the ethics form?",
    then: "It answers from what you actually said, and says roughly when you said it.",
    point:
      "This is the one that needs two drives. It is also the one that most clearly is not a voice memo.",
  },
];

function findUseCase(id: string | null | undefined): UseCase | undefined {
  return USE_CASES.find((u) => u.id === id);
}

/**
 * Where a picked example waits between the tap and the recording.
 *
 * `sessionStorage`, not a query parameter, for two reasons. A peer who taps a
 * card while signed out is sent through Better Auth and back, and the redirect
 * does not carry the parameter. And capture is hoisted above the router
 * (`CaptureProvider` lives in the layout so a drive survives navigation), so
 * there is no route whose params the recorder could read at the moment it
 * starts.
 *
 * Per-tab and read-once: the intent belongs to the NEXT drive, not to every
 * drive this browser ever records. See `takeUseCase`.
 */
const KEY = "voicemural.use-case";

/** Remember which example was tapped, for the drive that follows. */
export function rememberUseCase(id: UseCaseId): void {
  try {
    sessionStorage.setItem(KEY, id);
  } catch {
    // Private mode, or storage disabled. The drive still records; it just
    // carries no use case, which reads as "started some other way" — true
    // enough, and far better than refusing to start.
  }
}

/**
 * Take the pending example, clearing it.
 *
 * Read-once on purpose. Somebody who tries the draft example and then records
 * again about something else has not done the draft example twice, and counting
 * it twice would overstate exactly the number this column exists to keep
 * honest.
 */
export function takeUseCase(): UseCaseId | undefined {
  try {
    const value = sessionStorage.getItem(KEY);
    if (!value) return undefined;
    sessionStorage.removeItem(KEY);
    return findUseCase(value)?.id;
  } catch {
    return undefined;
  }
}
