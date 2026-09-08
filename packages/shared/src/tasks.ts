/**
 * The columns of the task board — the tenses of speech.
 *
 * Lives in `shared` rather than `workspace` because the analytics taxonomy
 * needs the literal set and `workspace` depends on `shared`, not the other way
 * round. The workspace package wraps this in a Zod enum for the op payloads.
 *
 *   open    — "I should…", "at some point"; also parked or deferred
 *   next    — "tomorrow", "first thing"
 *   doing   — "I'm on it"
 *   done    — "that's sorted", "sent it"
 *   dropped — "forget that"
 */
export const TASK_STATES = ["open", "next", "doing", "done", "dropped"] as const;
export type TaskStateName = (typeof TASK_STATES)[number];
