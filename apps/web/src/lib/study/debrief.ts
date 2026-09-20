/**
 * The post-drive debrief: the three questions, and how long they get.
 *
 * ONE COPY, because there are now two places that show them and they must not
 * drift. `/study` promises these exact questions in the information sheet
 * ("Same three every time, so you can turn them over while you drive"), and
 * `/record` asks them the moment a drive ends. A participant who read one set
 * on the information sheet and heard another in the car would have been asked
 * to consent to something that did not happen.
 *
 * THEY ARE ALSO THE PRIVACY BOUNDARY IN PRACTICE. Everything else a
 * participant says is theirs — no one on the research team listens to a drive
 * or reads its transcript. These answers are the exception, spoken knowingly,
 * and `capture_session.debrief_started_offset_ms` is what marks the interval
 * they live in.
 *
 * Pure data and no imports, so both a server component and the recorder can
 * read it.
 */
export const DEBRIEF_QUESTIONS = [
  "What did you want it to do that it couldn't?",
  "What did it do that you didn't ask for?",
  "What would you make into a thing, if that were easy?",
] as const;

/**
 * How long the recording stays open for the answers.
 *
 * Ninety seconds is enough for three short answers and short enough that a
 * participant who has already got out of the car is not recorded for long.
 * It is an upper bound, not a target: tapping Done ends it immediately, and
 * "nothing today" is a complete answer to all three.
 *
 * Nothing depends on this being reached. If the phone is put down mid-debrief
 * the worker's idle sweep closes the session as it always has, and the window
 * is then read as running to the end of the recording.
 */
export const DEBRIEF_MAX_MS = 90_000;
