import { describe, expect, it } from "vitest";
import {
  WEB_SEARCH_TOOL,
  searchResultForModel,
  searxngRequest,
  webSearchFromToolCall,
  webSearchSection,
} from "./web-search";

describe("WEB_SEARCH_TOOL", () => {
  it("requires the announcement, so the container always has something to say", () => {
    expect(WEB_SEARCH_TOOL.function.parameters.required).toEqual(["query", "announcement"]);
  });
});

describe("webSearchSection", () => {
  it("tells the model today's date, which nothing else in the prompt does", () => {
    const section = webSearchSection(new Date("2026-09-16T12:46:00Z"));
    expect(section).toContain("Today is Wednesday, 16 September 2026.");
  });
});

describe("webSearchFromToolCall", () => {
  it("flattens whitespace and caps the query", () => {
    expect(webSearchFromToolCall({ query: "  CHI  2027\n deadline " })).toEqual({
      query: "CHI 2027 deadline",
    });
    const long = webSearchFromToolCall({ query: "x".repeat(500) });
    expect("query" in long && long.query.length).toBe(200);
  });

  it("refuses a call with no query rather than searching for nothing", () => {
    expect(webSearchFromToolCall({})).toHaveProperty("error");
    expect(webSearchFromToolCall({ query: "   " })).toHaveProperty("error");
    expect(webSearchFromToolCall({ query: 42 })).toHaveProperty("error");
  });
});

describe("searxngRequest", () => {
  it("asks for JSON under the instance's own path", () => {
    const { url, headers } = searxngRequest("https://search.example/searx", "CHI deadline");
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://search.example/searx/search");
    expect(parsed.searchParams.get("q")).toBe("CHI deadline");
    expect(parsed.searchParams.get("format")).toBe("json");
    expect(parsed.searchParams.has("language")).toBe(false);
    expect(headers.Authorization).toBeUndefined();
  });

  it("moves credentials out of the URL into a Basic header, which fetch requires", () => {
    const { url, headers } = searxngRequest("https://anton:s%40cret@search.example/", "q", "de");
    expect(url).not.toContain("anton");
    expect(url).not.toContain("cret");
    expect(headers.Authorization).toBe(`Basic ${Buffer.from("anton:s@cret").toString("base64")}`);
    expect(new URL(url).searchParams.get("language")).toBe("de");
  });
});

describe("searchResultForModel", () => {
  it("keeps site, title and snippet, drops the URL and duplicates, and stops at five", () => {
    const results = Array.from({ length: 8 }, (_, i) => ({
      title: `Result ${i}`,
      url: i === 1 ? "https://www.chi.acm.org/a" : `https://site${i}.example/page`,
      content: `Snippet ${i}`,
    }));
    results.splice(2, 0, { ...results[1]! });

    const shaped = searchResultForModel("CHI deadline", {
      results,
      answers: [{ answer: "12 September 2026" }],
    });

    expect(shaped.answers).toEqual(["12 September 2026"]);
    expect(shaped.results).toHaveLength(5);
    expect(shaped.results[1]).toEqual({ title: "Result 1", source: "chi.acm.org", snippet: "Snippet 1" });
    expect(JSON.stringify(shaped)).not.toContain("https://");
  });

  it("clips long snippets and keeps only the date of a published timestamp", () => {
    const shaped = searchResultForModel("q", {
      results: [
        {
          title: "News",
          url: "https://news.example/x",
          content: "word ".repeat(200),
          publishedDate: "2026-09-14T08:00:00",
        },
      ],
    });
    expect(shaped.results[0]!.snippet.length).toBeLessThanOrEqual(280);
    expect(shaped.results[0]!.published).toBe("2026-09-14");
  });

  it("says plainly that nothing came back, so the model does not fill the gap", () => {
    expect(searchResultForModel("q", { results: [] }).note).toMatch(/nothing useful/);
    expect(searchResultForModel("q", "not json at all").note).toMatch(/nothing useful/);
  });
});
