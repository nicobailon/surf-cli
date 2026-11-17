import { describe, expect, it } from "vitest";

const typedValues = require("../../native/record-typed-values.cjs");

const redact = (url: string, ...values: string[]) =>
  typedValues.redactTypedValuesInUrl(
    url,
    values.map((value, index) => ({
      value,
      marker: index === 0 ? "<text>" : `<text-${index + 1}>`,
    })),
  );

describe("typed values in a captured URL", () => {
  it("replaces whole query values, path segments and fragments, never keys or parts of them", () => {
    expect(redact("https://example.test/api?username=bob&q=name&page=1", "name")).toBe(
      "https://example.test/api?username=bob&q=<text>&page=1",
    );
    expect(redact("https://example.test/users/name/edit/username", "name")).toBe(
      "https://example.test/users/<text>/edit/username",
    );
    expect(redact("https://name.example.test/?q=other", "name")).toBe(
      "https://name.example.test/?q=other",
    );
  });

  it("replaces a value of 4 or more characters inside a longer value at word boundaries", () => {
    const variables = encodeURIComponent('{"rawQuery":"dummy romeo","count":20}');
    expect(
      redact(
        `https://example.test/graphql/abc/SearchTimeline?variables=${variables}&f=1`,
        "dummy romeo",
      ),
    ).toBe(
      `https://example.test/graphql/abc/SearchTimeline?variables=${encodeURIComponent('{"rawQuery":"')}<text>${encodeURIComponent('","count":20}')}&f=1`,
    );
    expect(redact("https://example.test/s?q=pizza+near+me", "pizza")).toBe(
      "https://example.test/s?q=<text>+near+me",
    );
    expect(redact("https://example.test/api?q=dummy-username&n=myname1&page=1", "name", "1")).toBe(
      "https://example.test/api?q=dummy-username&n=myname1&page=1",
    );
  });

  it("replaces every typed value inside one value", () => {
    expect(redact("https://example.test/s?q=pizza+dummy+romeo", "pizza", "dummy romeo")).toBe(
      "https://example.test/s?q=<text>+<text-2>",
    );
    expect(
      redact("https://example.test/s?q=dummy%2520romeo%2520pizza", "pizza", "dummy romeo"),
    ).toBe("https://example.test/s?q=<text-2>%2520<text>");
  });

  it("matches a decoded value only: never escape syntax, path pieces or JSON keys", () => {
    expect(redact("https://example.test/search-users/list?q=1", "users")).toBe(
      "https://example.test/search-users/list?q=1",
    );
    expect(redact("https://example.test/users/list", "users")).toBe(
      "https://example.test/<text>/list",
    );
    expect(redact("https://example.test/s?q=hello%20abc", "20abc")).toBe(
      "https://example.test/s?q=hello%20abc",
    );
    expect(redact("https://example.test/s?q=hello%20abcd", "abcd")).toBe(
      "https://example.test/s?q=hello%20<text>",
    );
    const json = encodeURIComponent('{"query":"romeo","q":"dummy query"}');
    expect(redact(`https://example.test/graphql?variables=${json}`, "query")).toBe(
      `https://example.test/graphql?variables=${encodeURIComponent('{"query":"romeo","q":"dummy ')}<text>${encodeURIComponent('"}')}`,
    );
  });

  it("replaces a typed value that is a whole JSON number or boolean with a JSON string", () => {
    const json = encodeURIComponent('{"year":2024,"live":true,"n":20245}');
    expect(redact(`https://example.test/graphql?variables=${json}`, "2024", "true")).toBe(
      `https://example.test/graphql?variables=${encodeURIComponent('{"year":"')}<text>${encodeURIComponent('","live":"')}<text-2>${encodeURIComponent('","n":20245}')}`,
    );
    expect(redact('https://example.test/graphql?variables={"year":2024}', "2024")).toBe(
      'https://example.test/graphql?variables={"year":"<text>"}',
    );
  });

  it("compares the value as typed with every decoding of the captured value", () => {
    expect(redact("https://example.test/s?q=start+foo%2520bar+end", "foo%20bar")).toBe(
      "https://example.test/s?q=start+<text>+end",
    );
    expect(redact("https://example.test/s?q=start+foo%2520bar+end", "foo bar")).toBe(
      "https://example.test/s?q=start+<text>+end",
    );
    expect(redact("https://example.test/s?q=hello%2520abcd", "20abcd")).toBe(
      "https://example.test/s?q=hello%2520abcd",
    );
  });

  it("keeps a path segment when the value is also a query or fragment value", () => {
    expect(redact("https://example.test/api/users?q=users", "users")).toBe(
      "https://example.test/api/users?q=<text>",
    );
    expect(redact("https://example.test/api/users?q=all+users", "users")).toBe(
      "https://example.test/api/users?q=all+<text>",
    );
    expect(redact("https://example.test/?q=users#/users", "users")).toBe(
      "https://example.test/?q=<text>#/users",
    );
    expect(redact("https://example.test/search/pizza?page=2", "pizza")).toBe(
      "https://example.test/search/<text>?page=2",
    );
    const typed = [{ value: "users", marker: "<text>" }];
    for (const body of ['{"q":"users"}', "q=users&n=1"]) {
      expect(
        typedValues.redactTypedValuesInUrl("https://example.test/api/users", typed, { body }),
      ).toBe("https://example.test/api/users");
    }
    expect(
      typedValues.redactTypedValuesInUrl("https://example.test/api/users", typed, {
        body: '{"users":1}',
      }),
    ).toBe("https://example.test/api/<text>");
  });

  it("never matches inside a marker an earlier pass listed", () => {
    const typed = [
      { value: "romeo", marker: "<text>" },
      { value: "text", marker: "<text-2>" },
    ];
    const url = "https://example.test/s?q=<text>&r=dummy+text+here";
    const markers = [{ start: 25, end: 31 }];
    expect(typedValues.maskTypedValuesInUrl(url, typed, { markers })).toEqual({
      url: "https://example.test/s?q=<text>&r=dummy+<text-2>+here",
      markers: [
        { start: 25, end: 31 },
        { start: 40, end: 48 },
      ],
    });
  });

  it("leaves values shorter than 3 characters alone", () => {
    expect(redact("https://example.test/list?page=1&q=ab", "1", "ab")).toBe(
      "https://example.test/list?page=1&q=ab",
    );
  });

  it("decodes percent and + encoding until the value stops changing", () => {
    expect(redact("https://example.test/get?q=dummy%2520romeo&r=dummy+romeo", "dummy romeo")).toBe(
      "https://example.test/get?q=<text>&r=<text>",
    );
    expect(redact("https://example.test/p/dummy%2Fslash", "dummy/slash")).toBe(
      "https://example.test/p/<text>",
    );
    expect(redact("https://example.test/get?q=dummy%2520romeo%25", "dummy romeo%")).toBe(
      "https://example.test/get?q=<text>",
    );
  });

  it("replaces a short fragment and fragment values", () => {
    expect(redact("https://example.test/page#abc", "abc")).toBe("https://example.test/page#<text>");
    expect(redact("https://example.test/page#tab=abc&x=1", "abc")).toBe(
      "https://example.test/page#tab=<text>&x=1",
    );
    expect(redact("https://example.test/page#dummy/slash", "dummy/slash")).toBe(
      "https://example.test/page#<text>",
    );
    expect(redact("https://example.test/page#/list/dummy", "dummy")).toBe(
      "https://example.test/page#/list/<text>",
    );
  });
});

describe("placeholders in a request", () => {
  it("names the field that still holds a redacted value", () => {
    const found = typedValues.findRedactedPlaceholder;
    expect(found({ url: "https://example.test/get", query: { q: "<text-2>" } })).toEqual({
      field: "query.q",
      placeholder: "<text-2>",
    });
    expect(found({ url: "https://example.test/u/%3Cvalue%3E", query: {} })).toEqual({
      field: "path.2",
      placeholder: "<value>",
    });
    expect(found({ url: "https://example.test/", query: {}, body: "<request-body>" })).toEqual({
      field: "body",
      placeholder: "<request-body>",
    });
    expect(found({ url: "https://example.test/get", query: { q: "{{q}}", b: "<b>" } })).toBeNull();
  });

  it("finds a placeholder in a body only as the whole body or a whole field value", () => {
    const found = typedValues.findRedactedPlaceholder;
    const url = "https://example.test/rpc";
    const xml =
      "<methodCall><params><param><value><string>dummy</string></value></param></params></methodCall>";
    expect(found({ url, query: {}, body: xml })).toBeNull();
    expect(found({ url, query: {}, body: '{"user":"dummy","password":"<redacted>"}' })).toEqual({
      field: "body",
      placeholder: "<redacted>",
    });
    expect(found({ url, query: {}, body: { q: { text: "<text-2>" } } })).toEqual({
      field: "body",
      placeholder: "<text-2>",
    });
    expect(found({ url, query: {}, body: "user=dummy&q=%3Cvalue%3E" })).toEqual({
      field: "body",
      placeholder: "<value>",
    });
    expect(found({ url, query: { variables: '{"rawQuery":"<text>","count":20}' } })).toEqual({
      field: "query.variables",
      placeholder: "<text>",
    });
    expect(found({ url, query: { q: "%253Ctext%253E%2525" } })).toEqual({
      field: "query.q",
      placeholder: "<text>",
    });
  });
});

describe("typed values in a URL's parsed parts", () => {
  const typed = (...values: string[]) =>
    values.map((value, index) => ({
      value,
      marker: index === 0 ? "<text>" : `<text-${index + 1}>`,
    }));
  const mask = (url: string, values: string[], options = {}) =>
    typedValues.maskTypedValuesInUrl(url, typed(...values), options);

  it("never touches a JSON key, even one holding the typed value", () => {
    const json = encodeURIComponent('{"user-name":"other"}');
    expect(redact(`https://example.test/api?v=${json}`, "name")).toBe(
      `https://example.test/api?v=${json}`,
    );
    expect(redact('https://example.test/api?v={"user-name":"other"}', "name")).toBe(
      'https://example.test/api?v={"user-name":"other"}',
    );
  });

  it("masks a JSON number as a marker string and records that it was a number, where", () => {
    const { url, markers } = mask("https://example.test/graphql?variables=%7B%22year%22:2024%7D", [
      "2024",
    ]);
    expect(url).toBe("https://example.test/graphql?variables=%7B%22year%22:%22<text>%22%7D");
    expect(JSON.parse(new URL(url).searchParams.get("variables") as string)).toEqual({
      year: "<text>",
    });
    expect(markers).toEqual([
      {
        start: url.indexOf("<text>"),
        end: url.indexOf("<text>") + 6,
        type: "number",
        field: "query.variables.year",
      },
    ]);
    const live = mask('https://example.test/g?v={"live":true,"n":true}', ["true"]);
    expect(live.url).toBe('https://example.test/g?v={"live":"<text>","n":"<text>"}');
    expect(live.markers.map((item: { type: string }) => item.type)).toEqual(["boolean", "boolean"]);
  });

  it("keeps the page's JSON layout when it masks inside it", () => {
    const spaced = encodeURIComponent('{"q": "dummy romeo", "n": 2}');
    expect(redact(`https://example.test/g?v=${spaced}`, "dummy romeo")).toBe(
      `https://example.test/g?v=${encodeURIComponent('{"q": "')}<text>${encodeURIComponent('", "n": 2}')}`,
    );
  });

  it("reads + in a query value as a space, so a typed + matches only an encoded one", () => {
    expect(redact("https://example.test/s?q=start+foo+bar+end", "foo+bar")).toBe(
      "https://example.test/s?q=start+foo+bar+end",
    );
    expect(redact("https://example.test/s?q=start+foo%2Bbar+end", "foo+bar")).toBe(
      "https://example.test/s?q=start+<text>+end",
    );
    expect(redact("https://example.test/s?q=start+foo+bar+end", "foo bar")).toBe(
      "https://example.test/s?q=start+<text>+end",
    );
  });

  it("masks typed text that looks like a marker, as any other value", () => {
    expect(
      redact("https://example.test/s?q=hi+Alice+%3Ctext%3E+secret+bye", "Alice <text> secret"),
    ).toBe("https://example.test/s?q=hi+<text>+bye");
    expect(redact("https://example.test/s?q=%3Ctext%3E", "<text>")).toBe(
      "https://example.test/s?q=<text>",
    );
  });

  it("skips only the markers it inserted, which it lists by position", () => {
    const first = mask("https://example.test/get?q=romeo&r=x", ["romeo"]);
    expect(first.url).toBe("https://example.test/get?q=<text>&r=x");
    expect(first.markers).toEqual([{ start: 27, end: 33 }]);
    const later = [
      { value: "romeo", marker: "<text>" },
      { value: "<text>", marker: "<text-2>" },
    ];
    const again = typedValues.maskTypedValuesInUrl(first.url, later, { markers: first.markers });
    expect(again).toEqual(first);
    // Without the list, the same text is a value the user typed.
    expect(typedValues.maskTypedValuesInUrl(first.url, later).url).toBe(
      "https://example.test/get?q=<text-2>&r=x",
    );
  });

  it("leaves pairs it doesn't change byte for byte as captured", () => {
    expect(redact("https://example.test/s?a=x%2cy&b=%7b%7d&q=pizza+now&c=a+b", "pizza")).toBe(
      "https://example.test/s?a=x%2cy&b=%7b%7d&q=<text>+now&c=a+b",
    );
  });

  it("masks two path segments holding the value, and lists both", () => {
    const { url, markers } = mask("https://example.test/users/users", ["users"]);
    expect(url).toBe("https://example.test/<text>/<text>");
    expect(markers).toHaveLength(2);
    expect(redact("https://example.test/search-users", "users")).toBe(
      "https://example.test/search-users",
    );
  });

  it("treats a #/route as path segments and its ?query as a query", () => {
    expect(redact("https://example.test/app#/route/users", "users")).toBe(
      "https://example.test/app#/route/<text>",
    );
    expect(redact("https://example.test/app#/users?q=users", "users")).toBe(
      "https://example.test/app#/users?q=<text>",
    );
    expect(redact("https://example.test/app#/list?q=dummy+romeo+here", "dummy romeo")).toBe(
      "https://example.test/app#/list?q=<text>+here",
    );
  });

  it("learns from a JSON or form body which values the request sends, so the path keeps them", () => {
    const users = [{ value: "users", marker: "<text>" }];
    const url = "https://example.test/api/users";
    for (const body of [
      '{"filter":{"q":"all users"}}',
      "q=all+users&n=1",
      `variables=${encodeURIComponent('{"q":"users"}')}`,
    ]) {
      expect(typedValues.redactTypedValuesInUrl(url, users, { body })).toBe(url);
    }
    expect(typedValues.redactTypedValuesInUrl(url, users, { body: '{"users":1}' })).toBe(
      "https://example.test/api/<text>",
    );
  });
});
