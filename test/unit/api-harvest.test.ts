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
