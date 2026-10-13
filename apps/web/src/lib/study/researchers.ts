/**
 * Who may open researcher-only pages — the findings survey's results today.
 *
 * A list of user ids in `RESEARCHER_USER_IDS`, comma-separated, read per
 * request so it can be changed with a restart rather than a rebuild. Unset
 * means nobody: a page gated on this is a 404 until someone is named, which
 * is the safe failure for a page that shows what participants wrote.
 *
 * Ids rather than emails because an id is what a session carries and cannot
 * be claimed by signing up with somebody else's address.
 */

/** Any environment-shaped object, so a test can pass a plain one. */
type ResearcherEnv = Record<string, string | undefined>;

export function researcherIds(env: ResearcherEnv = process.env): Set<string> {
  return new Set(
    (env.RESEARCHER_USER_IDS ?? "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

export function isResearcher(
  userId: string | null | undefined,
  env: ResearcherEnv = process.env,
): boolean {
  return Boolean(userId) && researcherIds(env).has(userId as string);
}
