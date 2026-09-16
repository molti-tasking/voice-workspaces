/**
 * What both halves of the draft UI need to agree on.
 *
 * CLIENT-SAFE, and that is the whole reason this file exists. The caps used to
 * live in `api/realtime/draft/route.ts`, which is fine while only the container
 * writes drafts — but the editor on `/sessions/[id]` needs the same numbers for
 * its `maxLength`, and a client component cannot import them from there or from
 * `@voicemural/db/drafts` without pulling the Postgres driver into the browser
 * bundle. (`pnpm build` is the check that catches it; `pnpm typecheck` does
 * not. See EVALUATION_PLAN.md §4.10, which states the same rule for setting
 * profiles.)
 *
 * No imports, no I/O, no server-only anything. Keep it that way.
 */

/**
 * A cap, because the agent's half of this is model output written straight to a
 * column.
 *
 * Generous enough for a long email or a page of notes, and far below anything
 * that would make the cue panel unrenderable on a phone. The two writers treat
 * it differently on purpose: a model that runs away gets TRUNCATED, because a
 * clipped draft is still worth having and losing it entirely to a length check
 * is the worse failure; a person who pastes something too long gets REFUSED,
 * because silently eating the end of what they typed is the worse failure
 * there.
 */
export const MAX_DRAFT_CHARS = 8_000;

/** Same split: truncated for the model, refused for the person. */
export const MAX_DRAFT_TITLE_CHARS = 120;
