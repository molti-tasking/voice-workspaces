/**
 * The talk-back agent's web search, over a SearXNG instance.
 *
 * Shaped like the board tools and for the same reason: one copy, in
 * TypeScript. `/api/realtime/session` offers `WEB_SEARCH_TOOL` to the
 * container when `SEARXNG_URL` is set, `bot.py` registers it without knowing
 * what it does, and every call comes back to `/api/realtime/search`, which
 * builds the request with `searxngRequest` and hands the model
 * `searchResultForModel`.
 *
 * WHAT THE DRIVER HEARS WHILE IT RUNS. The container speaks the call's
 * `announcement` the moment the call arrives and plays a soft cue until the
 * result is back, so a search is never dead air. The announcement is an
 * argument rather than a sentence the model says before calling, because a
 * model that calls a tool frequently says nothing first — and one that does
 * would be heard twice.
 *
 * WHAT LEAVES. The query is the participant's question in the model's words.
 * It goes to the SearXNG instance and, through it, to whichever engines that
 * instance forwards to. Nothing else about the drive is sent.
 *
 * Pure: schemas, a parser, a request builder and a result shaper. No I/O.
 */
import type { ToolDefinition } from "./board-tools";

export const WEB_SEARCH_TOOL_NAME = "search_web";

export const WEB_SEARCH_TOOL: ToolDefinition = {
  type: "function",
  function: {
    name: WEB_SEARCH_TOOL_NAME,
    description:
      "Search the web for a fact you do not know or cannot be sure is current: a date, a deadline, a figure, a name, what something is, what happened. The announcement is spoken aloud as the search starts, so say nothing yourself before calling.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "A few search keywords, using the words they used: a name on its own, a product with the year for anything current. Never add a place, a field or a guess they did not say.",
        },
        announcement: {
          type: "string",
          description:
            'One short sentence, spoken while the search runs, saying what you are looking up, in the language you are speaking with them. E.g. "Let me look up the CHI deadline."',
        },
      },
      required: ["query", "announcement"],
    },
  },
};

/**
 * The prompt section that goes with the tool. Composed in only when the tool
 * is offered, so the model is never told it can search where it cannot.
 *
 * Three rules here come from the first drive that used it (16 Sep 2026), each
 * against a failure the search itself did not cause — SearXNG had the answer
 * every time:
 *
 * - TODAY'S DATE. Nothing else in the prompt carries it, so the model had no
 *   way to know its memory was stale. Asked for the latest iPhones, it got
 *   Apple's page naming the iPhone 18 Pro and iPhone Duo, and answered "the
 *   iPhone 17 series" — which is what it remembered, and which one other
 *   result agreed with.
 * - THE THEIR-WORDS QUERY. Asked who Anton Wolter is, mid-conversation about
 *   Stanford, it searched for him "at Stanford, in voice interaction" and
 *   found nothing. His name alone puts his university page first.
 * - SEARCH BEFORE ASKING. "Just find it online" got "I can't search without a
 *   name", three turns running.
 *
 * `now` is when the session is composed, once per connection; a drive does
 * not outlast the day by enough to matter. UTC, so a drive just after
 * midnight in Denmark reads as the day before.
 */
export function webSearchSection(now: Date = new Date()): string {
  const today = now.toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return `SEARCHING THE WEB
You can search the web with search_web. Today is ${today}.

- What you remember about products, people, prices and events is older than today. For anything that may have changed — the latest version of something, a deadline, who someone is, the news — search instead of answering from memory.
- When they ask you to look something up, search straight away with what you have. Do not ask them for more detail first.
- Search with the words they used: a name on its own, a product with the year. Do not add a place, a field or a guess they did not say — one wrong word hides the right result. If they spell a name, search that spelling; the transcript often mishears names.
- Call the tool before you say anything, and put what you are looking up in its announcement: that sentence is spoken for you while the search runs.
- Answer from the results, not from memory. Where they disagree with what you remember, the results are right, and the newest thing they name is the latest. Say where it came from in a few words: "According to Apple, …". Never read out a web address.
- If nothing useful came back, search once more with fewer words. If that finds nothing either, say so plainly. Never present a guess as something you found.`;
}

/** Longest query passed on. A search engine needs keywords, not a paragraph. */
const MAX_QUERY_CHARS = 200;

export function webSearchFromToolCall(
  args: Record<string, unknown>,
): { query: string } | { error: string } {
  const raw = typeof args.query === "string" ? args.query : "";
  const query = raw.replace(/\s+/g, " ").trim().slice(0, MAX_QUERY_CHARS);
  return query ? { query } : { error: "No search query was given" };
}

/**
 * The SearXNG request for `query`.
 *
 * `base` is the instance's root, with or without a path prefix. Credentials in
 * it (`https://user:pass@search.example`) become a Basic header, because
 * `fetch` refuses a URL that carries them — a reverse proxy with basic auth is
 * the usual way a personal instance is kept private.
 *
 * `language` narrows results when the drive's transcription language is
 * pinned; null leaves SearXNG to its own default.
 */
export function searxngRequest(
  base: string,
  query: string,
  language?: string | null,
): { url: string; headers: Record<string, string> } {
  const url = new URL("search", base.endsWith("/") ? base : `${base}/`);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (url.username || url.password) {
    const credentials = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    headers.Authorization = `Basic ${Buffer.from(credentials).toString("base64")}`;
    url.username = "";
    url.password = "";
  }
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("safesearch", "1");
  if (language) url.searchParams.set("language", language);
  return { url: url.toString(), headers };
}

interface SearxngBody {
  answers?: unknown[];
  results?: { title?: unknown; url?: unknown; content?: unknown; publishedDate?: unknown }[];
}

export interface SearchResultForModel {
  ok: true;
  query: string;
  answers?: string[];
  results: { title: string; source: string; snippet: string; published?: string }[];
  note?: string;
}

/** How many results the model reads. Each one is prompt, and prompt is delay. */
const MAX_RESULTS = 5;
const MAX_SNIPPET_CHARS = 280;

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** The site a result came from, which is what the agent names aloud. */
function sourceOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * What the model reads back: a few results, as site, title and snippet.
 *
 * Deliberately small. The completion that follows the search carries this in
 * its prompt, and prompt size is the biggest lever on how long the agent takes
 * to start talking (TALKBACK.md, "Latency"). No URLs either — the agent is told
 * never to read one out, and one it cannot see it cannot read.
 */
export function searchResultForModel(query: string, body: unknown): SearchResultForModel {
  const data = (body && typeof body === "object" ? body : {}) as SearxngBody;

  const answers = (Array.isArray(data.answers) ? data.answers : [])
    .map((a) => (typeof a === "string" ? a : (a as { answer?: unknown } | null)?.answer))
    .filter((a): a is string => typeof a === "string" && a.trim() !== "")
    .slice(0, 2)
    .map((a) => clip(a, MAX_SNIPPET_CHARS));

  const results: SearchResultForModel["results"] = [];
  const seen = new Set<string>();
  for (const r of Array.isArray(data.results) ? data.results : []) {
    if (typeof r?.url !== "string" || typeof r.title !== "string" || seen.has(r.url)) continue;
    const source = sourceOf(r.url);
    if (!source) continue;
    seen.add(r.url);
    results.push({
      title: clip(r.title, 120),
      source,
      snippet: typeof r.content === "string" ? clip(r.content, MAX_SNIPPET_CHARS) : "",
      ...(typeof r.publishedDate === "string" && r.publishedDate
        ? { published: r.publishedDate.slice(0, 10) }
        : {}),
    });
    if (results.length >= MAX_RESULTS) break;
  }

  if (answers.length === 0 && results.length === 0) {
    return {
      ok: true,
      query,
      results: [],
      note: "The search found nothing useful. Say so; do not guess.",
    };
  }
  return { ok: true, query, ...(answers.length > 0 ? { answers } : {}), results };
}
