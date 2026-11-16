import { describe, expect, it } from "vitest";

// @ts-expect-error - CommonJS module without type definitions
import * as harvest from "../../native/api-harvest.cjs";

describe("api harvest", () => {
  it("matches URL globs against the path or full URL without the query string", () => {
    const tweetDetail = harvest.urlMatcher("/i/api/graphql/*/TweetDetail");
    expect(tweetDetail("https://x.com/i/api/graphql/abc123/TweetDetail?variables=%7B%7D")).toBe(
      true,
    );
    expect(tweetDetail("https://x.com/i/api/graphql/a/b/TweetDetail")).toBe(false);
    expect(tweetDetail("https://x.com/i/api/graphql/abc123/TweetDetailV2")).toBe(false);

    const api = harvest.urlMatcher("https://x.com/i/api/**");
    expect(api("https://x.com/i/api/graphql/abc/TweetDetail?x=1")).toBe(true);
    expect(api("https://api.x.com/i/api/graphql/abc/TweetDetail")).toBe(false);

    expect(() => harvest.urlMatcher("i/api/*")).toThrow(/must start with \//);
    expect(() => harvest.urlMatcher("/api?cursor=*")).toThrow(/without its query string/);
  });

  it("keeps the glob rules: * stays in a segment, ** crosses them, everything else is literal", () => {
    const cases: Array<[string, string, boolean]> = [
      ["/api/*", "https://x.test/api/items", true],
      ["/api/*", "https://x.test/api/", true],
      ["/api/*", "https://x.test/api/a/b", false],
      ["/api/**", "https://x.test/api/a/b", true],
      ["/api/**", "https://x.test/api/", true],
      ["/api/**", "https://x.test/api", false],
      ["/a/**/b", "https://x.test/a/x/y/b", true],
      ["/a/**/b", "https://x.test/a/b", false],
      ["/a/*/b", "https://x.test/a//b", true],
      ["/a*", "https://x.test/abc", true],
      ["/a*c", "https://x.test/abcbc", true],
      ["/a*c", "https://x.test/abcb", false],
      ["/***", "https://x.test/a/b", true],
      ["/*/**.json", "https://x.test/v1/a/b.json", true],
      ["/*/**.json", "https://x.test/v1.json", false],
      // Regex characters are literal.
      ["/v1.0/(x)+$", "https://x.test/v1.0/(x)+$", true],
      ["/v1.0/*", "https://x.test/v1x0/a", false],
      ["/a[b]", "https://x.test/a[b]", true],
      ["/a%5Bb%5D", "https://x.test/a[b]", false],
      // Case matters, and the path is compared percent-encoded.
      ["/API/*", "https://x.test/api/a", false],
      ["/caf%C3%A9/*", "https://x.test/café/menu", true],
      // A pattern with :// is matched against origin + path.
      ["https://*.x.test/**", "https://api.x.test/v1/a", true],
      ["https://*.x.test/**", "https://a.b.x.test/v1/a", true],
      ["https://*.x.test/**", "http://api.x.test/v1/a", false],
      ["https://x.test:8443/*", "https://x.test:8443/a", true],
      ["/a", "not a url", false],
    ];
    for (const [pattern, url, expected] of cases) {
      expect(harvest.urlMatcher(pattern)(url), `${pattern} on ${url}`).toBe(expected);
    }
  });

  it("refuses a glob over 500 characters and never tests a path over 8 KB", () => {
    // A 20 KB all-* glob against a 20 KB path held the host for about 6 s.
    const path = `https://x.test/${"a".repeat(20000)}`;
    const started = Date.now();
    expect(() => harvest.urlMatcher(`/${"*".repeat(19999)}`)).toThrow(
      "match is 20000 characters; the limit is 500",
    );
    expect(() => harvest.validateApiSpec({ match: `/${"*".repeat(500)}`, records: {} })).toThrow(
      "match is 501 characters; the limit is 500",
    );
    const longest = harvest.urlMatcher(`/${"*".repeat(499)}`);
    expect(longest(path)).toBe(false);
    expect(longest(`https://x.test/${"a".repeat(8191)}`)).toBe(true);
    expect(Date.now() - started).toBeLessThan(100);
  });

  it("matches a glob of many ** in time linear in the URL, not by backtracking", () => {
    // The first backtracked for about 2 s; the second (from the review) never finished.
    const path = `https://x.test/${"a".repeat(80)}`;
    for (const pattern of [
      `/${"**a".repeat(5)}b`,
      `/${"**a".repeat(20)}b`,
      `/${"*a".repeat(40)}b`,
    ]) {
      const started = Date.now();
      expect(harvest.urlMatcher(pattern)(path), pattern).toBe(false);
      expect(harvest.urlMatcher(pattern)(`${path}b`), pattern).toBe(true);
      expect(Date.now() - started, pattern).toBeLessThan(100);
    }
  });

  it("applies set edits to query params, JSON query params, and the JSON body", () => {
    const request = {
      method: "POST",
      url: `https://x.test/api?variables=${encodeURIComponent('{"focal":"1"}')}&count=20`,
      headers: { "x-token": "t" },
      body: '{"page":{"n":1}}',
    };
    const edited = harvest.applySet(request, {
      "query.variables.cursor": "c-1",
      "query.count": 40,
      "body.page.n": 2,
    });
    const url = new URL(edited.url);
    expect(JSON.parse(url.searchParams.get("variables") as string)).toEqual({
      focal: "1",
      cursor: "c-1",
    });
    expect(url.searchParams.get("count")).toBe("40");
    expect(JSON.parse(edited.body)).toEqual({ page: { n: 2 } });
    expect(edited).toMatchObject({ method: "POST", headers: { "x-token": "t" } });
    expect(harvest.applySet(request, { body: "raw" }).body).toBe("raw");

    expect(() => harvest.applySet(request, { "query.count.x": 1 })).toThrow(
      /query param "count" is not a JSON object/,
    );
    expect(() => harvest.applySet(request, { "headers.x": 1 })).toThrow(/set key "headers.x"/);
  });
});
