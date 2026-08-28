import { agentTurn, captureSession, getDb, sql, utterance } from "@voicemural/db";
import { withoutHallucinatedSentences } from "@voicemural/shared";
import { log } from "@voicemural/telemetry";
import { keptIndices, withoutEcho } from "./echo";

/**
 * Giving the agent access to what was actually said, in past drives and this one.
 *
 * Retrieval runs on EVERY turn rather than being offered as a tool the model
 * chooses to call. Two reasons:
 *
 * 1. `MODEL_CONVERSE` is a self-hosted model that accepts a `tools` parameter
 *    and then never calls one (measured — see scripts/spike-talkback.mjs). An
 *    agent that silently declines to look anything up is worse than one that
 *    always looks.
 * 2. It costs one round trip instead of two. At ~230ms time-to-first-token, a
 *    tool call would roughly double the wait before the first word — and this
 *    is a conversation happening at 110 km/h.
 *
 * Tool-driven retrieval arrives in Phase 4 alongside a tool-capable model. The
 * function signatures here are the ones a tool would wrap, so that change is
 * contained.
 *
 * Search is lexical, not semantic. Phase 5 adds pgvector; until then the tool's
 * shape does not change, only its internals. A caveat worth knowing while it is
 * lexical: it matches words, so asking about "the deadline" finds the word
 * "deadline" and not a paraphrase of it.
 */

/** A stretch of transcript, quotable back to the user. */
export interface Passage {
  /** Absolute wall-clock, so the agent can say "last Tuesday". */
  occurredAt: Date;
  text: string;
}

/**
 * Words to ignore when searching.
 *
 * `websearch_to_tsquery` with the 'simple' configuration does no stopword
 * removal, so "what did I say about the deadline" searches for "what" and "did"
 * as well — which match nearly every utterance ever recorded and bury the one
 * word that mattered. Stripped here rather than by switching to the 'english'
 * configuration, because the corpus is mixed German and English and stemming in
 * the wrong language is worse than not stemming at all.
 */
const STOPWORDS = new Set([
  "a", "about", "after", "again", "all", "am", "an", "and", "any", "are", "as", "at",
  "back", "be", "because", "been", "before", "being", "but", "by", "can", "could",
  "did", "do", "does", "doing", "done", "down", "for", "from", "get", "got", "had",
  "has", "have", "he", "her", "here", "him", "his", "how", "i", "if", "in", "into",
  "is", "it", "its", "just", "know", "like", "me", "mean", "more", "most", "my",
  "no", "not", "now", "of", "on", "one", "only", "or", "other", "our", "out", "over",
  "really", "said", "say", "see", "she", "should", "so", "some", "something", "such",
  "than", "that", "the", "their", "them", "then", "there", "these", "they", "thing",
  "think", "this", "those", "to", "too", "up", "us", "very", "was", "we", "well",
  "were", "what", "when", "where", "which", "while", "who", "why", "will", "with",
  "would", "you", "your",
]);

/**
 * Content words worth searching for.
 *
 * Returns an empty array when the question is entirely stopwords — "what do you
 * think?" has nothing to look up, and searching for it would return a random
 * slice of the corpus dressed up as relevant context.
 */
export function contentWords(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, " ")
        .split(/\s+/)
        .filter((word) => word.length > 2 && !STOPWORDS.has(word)),
    ),
  ];
}

/**
 * What the system has actually SPOKEN in these drives.
 *
 * `text` rather than `generatedText`: a reply cut off by an interruption was
 * never played, so it cannot have echoed into the microphone.
 */
async function spokenByAgent(captureSessionIds: string[]): Promise<string[]> {
  if (captureSessionIds.length === 0) return [];
  try {
    const rows = await getDb()
      .select({ text: agentTurn.text })
      .from(agentTurn)
      .where(sql`${agentTurn.captureSessionId} in ${captureSessionIds}`);
    return rows.map((row) => row.text).filter((text) => text.trim().length > 0);
  } catch (err) {
    log.error("could not load spoken turns", {
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * The same, but keyed by drive.
 *
 * A passage must be cleaned against what the agent said in ITS OWN drive, not
 * against everything it has ever said — echo containment is deliberately loose
 * (0.75, asymmetric), and widening the comparison set would start hiding things
 * the driver really said in one drive because the agent said something similar
 * in another. One query for all of them, grouped here, rather than one query
 * per hit inside a loop.
 */
async function spokenByAgentPerSession(
  captureSessionIds: string[],
): Promise<Map<string, string[]>> {
  const bySession = new Map<string, string[]>();
  if (captureSessionIds.length === 0) return bySession;
  try {
    const rows = await getDb()
      .select({ text: agentTurn.text, captureSessionId: agentTurn.captureSessionId })
      .from(agentTurn)
      .where(sql`${agentTurn.captureSessionId} in ${captureSessionIds}`);
    for (const row of rows) {
      if (!row.text?.trim()) continue;
      const existing = bySession.get(row.captureSessionId);
      if (existing) existing.push(row.text);
      else bySession.set(row.captureSessionId, [row.text]);
    }
  } catch (err) {
    log.error("could not load spoken turns", {
      err: err instanceof Error ? err.message : String(err),
    });
  }
  return bySession;
}

/**
 * What was said earlier in this drive.
 *
 * Answers "what have we covered so far" without a search, and grounds anaphora
 * — "that", "the second one" — in the turn the user is actually referring to.
 * Read from the ledger rather than from the conversation's own memory so it
 * includes everything spoken, not only the fragments the live path happened to
 * transcribe.
 */
export async function loadDriveSoFar(
  captureSessionId: string,
  limit = 60,
): Promise<Passage[]> {
  try {
    const rows = await getDb()
      .select({
        text: utterance.text,
        startOffsetMs: utterance.startOffsetMs,
        startedAt: captureSession.startedAt,
      })
      .from(utterance)
      .innerJoin(captureSession, sql`${captureSession.id} = ${utterance.captureSessionId}`)
      .where(sql`${utterance.captureSessionId} = ${captureSessionId}`)
      .orderBy(sql`${utterance.startOffsetMs} desc`)
      .limit(limit);

    // Newest-first from the database so the LIMIT keeps the most recent, then
    // reversed so the agent reads them in the order they were spoken.
    const ordered = rows.reverse();

    // Strip the system's own voice before it reads this back. Speaking aloud
    // puts the reply into the ledger via the microphone, and without this the
    // agent treats its own last answer as something the driver said and
    // proceeds to converse with itself.
    const spoken = await spokenByAgent([captureSessionId]);
    // By position, not by text: filtering rows against the set of kept STRINGS
    // would bring every copy of a repeated line back and undo the dedupe.
    const keep = new Set(keptIndices(ordered.map((row) => row.text), spoken));

    return ordered
      .filter((_, index) => keep.has(index))
      /* And drop what nobody said.
       *
       * Whisper invents sign-offs on silence — "Thanks for watching!",
       * "Subtitles by the Amara.org community" — and those land in the ledger
       * as ordinary utterances. Reading them back means telling the agent the
       * driver said things they never said, and it answers accordingly. The
       * ledger keeps them, because it is the verbatim record; retrieval is a
       * READ, and a read is allowed to know better. */
      .map((row) => ({
        occurredAt: new Date(row.startedAt.getTime() + row.startOffsetMs),
        text: withoutHallucinatedSentences(row.text),
      }))
      .filter((passage) => passage.text.length > 0);
  } catch (err) {
    log.error("could not load drive context", {
      captureSessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/**
 * Search everything this user has ever recorded.
 *
 * Matches are widened into a surrounding window before being returned: a single
 * `utterance` is one Whisper segment, often three or four words, and quoting
 * that back is useless. The window is what makes a hit readable.
 */
export async function searchTranscripts(
  userId: string,
  query: string,
  options: { limit?: number; excludeSessionId?: string; windowMs?: number } = {},
): Promise<Passage[]> {
  const words = contentWords(query);
  if (words.length === 0) return [];

  const limit = options.limit ?? 4;
  const windowMs = options.windowMs ?? 20_000;
  const tsquery = words.join(" or ");

  try {
    const db = getDb();

    // Rank by lexical match, then prefer recency. `simple` rather than a
    // language configuration: the corpus is mixed German/English.
    const hits = await db.execute<{
      capture_session_id: string;
      start_offset_ms: number;
    }>(sql`
      select u.capture_session_id, u.start_offset_ms
      from utterance u
      join capture_session cs on cs.id = u.capture_session_id
      where cs.user_id = ${userId}
        ${options.excludeSessionId ? sql`and u.capture_session_id <> ${options.excludeSessionId}` : sql``}
        and to_tsvector('simple', u.text) @@ websearch_to_tsquery('simple', ${tsquery})
      order by
        ts_rank_cd(to_tsvector('simple', u.text), websearch_to_tsquery('simple', ${tsquery})) desc,
        cs.started_at desc
      limit ${limit}
    `);

    // Everything below used to run inside a `for` loop, one window query and
    // one spoken-turns query per hit — up to 1 + 4x2 = 9 strictly sequential
    // round trips before the first token of a reply, on the one code path whose
    // whole design rationale is latency. The hits are independent, so they are
    // fetched together, and the spoken turns for every hit drive come back in a
    // single query rather than one per hit.
    const sessionIds = [...new Set(hits.map((hit) => hit.capture_session_id))];
    const [spokenPerSession, windows] = await Promise.all([
      spokenByAgentPerSession(sessionIds),
      Promise.all(
        hits.map((hit) =>
          db.execute<{ text: string; start_offset_ms: number; started_at: Date }>(sql`
            select u.text, u.start_offset_ms, cs.started_at
            from utterance u
            join capture_session cs on cs.id = u.capture_session_id
            where u.capture_session_id = ${hit.capture_session_id}
              and u.start_offset_ms between ${hit.start_offset_ms - windowMs} and ${hit.start_offset_ms + windowMs}
            order by u.start_offset_ms
          `),
        ),
      ),
    ]);

    const passages: Passage[] = [];
    for (const [index, hit] of hits.entries()) {
      const window = windows[index] ?? [];

      const first = window[0];
      if (!first) continue;

      // Past drives carry the same contamination, so a passage must be cleaned
      // before it is quoted back — otherwise a reply invented three drives ago
      // returns as established fact about the driver's own thinking.
      const spoken = spokenPerSession.get(hit.capture_session_id) ?? [];
      const text = withoutEcho(
        // Whisper's invented sign-offs go too, for the same reason and by the
        // same rule: the ledger is verbatim, a read is allowed to know better.
        window.map((row) => withoutHallucinatedSentences(row.text.trim())).filter(Boolean),
        spoken,
      ).join(" ");
      if (!text.trim()) continue;

      passages.push({
        occurredAt: new Date(new Date(first.started_at).getTime() + first.start_offset_ms),
        text,
      });
    }

    // Two hits inside one window produce the same passage twice.
    const seen = new Set<string>();
    return passages.filter((passage) => {
      const key = passage.text.slice(0, 80);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  } catch (err) {
    // Retrieval failing degrades the answer; it must not fail the turn.
    log.error("transcript search failed", {
      userId,
      err: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

/** "yesterday", "last Tuesday", "3 weeks ago" — how a person refers to a drive. */
export function describeWhen(when: Date, now = new Date()): string {
  const days = Math.floor((now.getTime() - when.getTime()) / 86_400_000);
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "last week";
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  return when.toLocaleDateString(undefined, { month: "long", year: "numeric" });
}
