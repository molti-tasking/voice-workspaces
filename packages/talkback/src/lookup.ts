/**
 * Looking things up, for the speech-to-speech agent: one `web_search`
 * function, answered by a MOCK search.
 *
 * WHY A MOCK. The demo and the display study need the agent to answer "when
 * does it open?" the way a voice assistant would, and to show on the screen
 * that it is looking something up (the Stack view's lookup, the state line's
 * "Looking it up"). A real search makes every run different and depends on an
 * instance being up; a mock answered by the fast model gives ordinary,
 * plausible results every time, with the same few seconds of waiting. It is
 * switched on per deployment (`REALTIME_MOCK_SEARCH=on`), never by default:
 * the results are made up, so a real drive must not get them.
 *
 * The browser runs the function (`use-realtime.ts`): the provider asks for
 * it on the data channel, `/api/realtime/lookup` answers, and the result goes
 * back as the function's output.
 *
 * Pure: the tool, the prompt passages and the mock's messages and parse.
 */

import type { ChatMessage, RealtimeFunctionTool } from "@voicemural/llm";

export const LOOKUP_TOOL_NAME = "web_search";

/** The longest query kept, and the most results handed back. */
export const LOOKUP_MAX_QUERY_CHARS = 160;
export const LOOKUP_MAX_RESULTS = 5;
const LOOKUP_MAX_TITLE_CHARS = 90;
const LOOKUP_MAX_SNIPPET_CHARS = 240;

export const LOOKUP_TOOL: RealtimeFunctionTool = {
  type: "function",
  name: LOOKUP_TOOL_NAME,
  description:
    "Look something up on the web: opening hours, prices, times, places, or a fact you do not know for certain. One short query.",
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search as you would type it: a few words, with the place and day." },
    },
    required: ["query"],
    additionalProperties: false,
  },
};

/** What the agent is told it can do, added to its instructions when the tool is on. */
export const LOOKUP_SECTION = `LOOKING THINGS UP
You can look things up with ${LOOKUP_TOOL_NAME}. Use it when they ask for something you would have to know from outside this conversation — opening hours, prices, times, places, what something is — and you do not know it for certain. Do not announce it: their screen shows that you are looking it up. Search once, with a short query, then answer from what came back in one sentence. Never read out a list of results, links or sources.`;

/** The passages that say it cannot look anything up, and what each says instead. */
const CANNOT_LOOK_UP: readonly [from: string, to: string][] = [
  [
    "You only talk. You cannot write anything down, keep notes, change their board, look anything up or send anything;",
    "You only talk, and look things up. You cannot write anything down, keep notes, change their board or send anything;",
  ],
  [
    "- You cannot look anything up. When you do not know something, say so.",
    "- When you do not know something, look it up (see LOOKING THINGS UP), or say so.",
  ],
];

/**
 * `prompt` for an agent that can look things up: every passage saying it
 * cannot is rewritten. Throws when there was none to rewrite, so an edit to
 * the wording cannot leave the agent told both things.
 */
export function withLookup(prompt: string): string {
  let next = prompt;
  for (const [from, to] of CANNOT_LOOK_UP) next = next.replace(from, to);
  if (next === prompt) throw new Error("lookup: no passage saying the agent cannot look things up was found");
  return next;
}

/** The query from the function's arguments, as the provider sends them (a JSON string). */
export function lookupQuery(args: unknown): string | null {
  let parsed: unknown = args;
  if (typeof args === "string") {
    try {
      parsed = JSON.parse(args);
    } catch {
      return null;
    }
  }
  const query = (parsed as { query?: unknown } | null)?.query;
  if (typeof query !== "string") return null;
  const text = query.replace(/\s+/g, " ").trim().slice(0, LOOKUP_MAX_QUERY_CHARS);
  return text || null;
}

export interface LookupResult {
  title: string;
  snippet: string;
}

const MOCK_SYSTEM = `You stand in for a web search engine in a research prototype, where no real search is connected. You are given one query and return what a search would plausibly show for it.

Return JSON only: {"results": [{"title": "...", "snippet": "..."}]}

- 3 to 5 results, the most useful first.
- Ordinary and realistic: typical opening hours, prices and times for that kind of place in that country, as a listing, a booking site or a timetable would put them. Nothing remarkable or surprising.
- Each snippet carries the concrete answer: the hours, the price, the time, the address.
- Write in the language of the query.`;

/** The mock search's messages for `query`. `localTime` lets "tonight" and "Saturday" mean something. */
export function mockSearchMessages(query: string, localTime?: string | null): ChatMessage[] {
  return [
    { role: "system", content: MOCK_SYSTEM },
    { role: "user", content: `${localTime ? `${localTime}\n\n` : ""}Query: ${query.slice(0, LOOKUP_MAX_QUERY_CHARS)}` },
  ];
}

function clip(raw: unknown, max: number): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.replace(/\s+/g, " ").trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** The mock's reply as results, or null when it is not the JSON asked for. */
export function parseMockSearch(raw: string): LookupResult[] | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
  const items = (parsed as { results?: unknown } | null)?.results;
  if (!Array.isArray(items)) return null;
  return items
    .flatMap((item): LookupResult[] => {
      const title = clip((item as { title?: unknown } | null)?.title, LOOKUP_MAX_TITLE_CHARS);
      const snippet = clip((item as { snippet?: unknown } | null)?.snippet, LOOKUP_MAX_SNIPPET_CHARS);
      return title && snippet ? [{ title, snippet }] : [];
    })
    .slice(0, LOOKUP_MAX_RESULTS);
}

/** What the screen says came back, under the query. */
export function lookupFoundLabel(results: number): string {
  if (results === 0) return "Nothing found";
  return results === 1 ? "1 result found" : `${results} results found`;
}
