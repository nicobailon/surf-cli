import { describe, expect, it } from "vitest";

const { readFileSync } = require("node:fs");
const Module = require("node:module");
const { dirname } = require("node:path");

const typedValues = require("../../native/record-typed-values.cjs");
const { paramOp } = require("../../native/playbook-param.cjs");

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

describe("typed values in a URL's JSON, matched by source span", () => {
  const typed = (...values: string[]) =>
    values.map((value, index) => ({
      value,
      marker: index === 0 ? "<text>" : `<text-${index + 1}>`,
    }));
  const mask = (url: string, values: string[], options = {}) =>
    typedValues.maskTypedValuesInUrl(url, typed(...values), options);
  const json = (text: string) => encodeURIComponent(text);

  it("masks a JSON number or literal typed as its source spells it, or as its value", () => {
    const spelled = mask(`https://example.test/g?v=${json('{"q":2024.0}')}`, ["2024.0"]);
    expect(spelled.url).toBe(`https://example.test/g?v=${json('{"q":"')}<text>${json('"}')}`);
    expect(spelled.markers).toEqual([
      expect.objectContaining({ type: "number", field: "query.v.q" }),
    ]);
    for (const [source, value] of [
      ["1e3", "1e3"],
      ["1e3", "1000"],
      ["-0.50", "-0.50"],
      ["null", "null"],
    ]) {
      expect(mask(`https://example.test/g?v=${json(`{"q":${source}}`)}`, [value]).url).toBe(
        `https://example.test/g?v=${json('{"q":"')}<text>${json('"}')}`,
      );
    }
    // null has no type to give an input, so it records none.
    expect(mask(`https://example.test/g?v=${json('{"q":null}')}`, ["null"]).markers).toEqual([
      { start: 41, end: 47 },
    ]);
  });

  it("masks a JSON string leaf that holds the typed value once decoded again, as a whole leaf", () => {
    expect(
      mask(`https://example.test/g?v=${json('{"q":"foo%20bar","n":1}')}`, ["foo bar"]).url,
    ).toBe(`https://example.test/g?v=${json('{"q":"')}<text>${json('","n":1}')}`);
    // In a JSON string, + is a +: the page writes + for a space only in the query value around it.
    const plus = "https://example.test/g?v=%7B%22q%22%3A%22foo%2Bbar%22%2C%22t%22%3A%22a+b%22%7D";
    expect(mask(plus, ["foo bar"]).url).toBe(plus);
    expect(mask(plus, ["a b"]).url).toBe(
      "https://example.test/g?v=%7B%22q%22%3A%22foo%2Bbar%22%2C%22t%22%3A%22<text>%22%7D",
    );
  });

  it("keeps every byte outside a masked leaf as captured", () => {
    const big = `{"q":"romeo","id":9007199254740993,"f":1.50}`;
    expect(mask(`https://example.test/g?v=${json(big)}`, ["romeo"]).url).toBe(
      `https://example.test/g?v=${json('{"q":"')}<text>${json('","id":9007199254740993,"f":1.50}')}`,
    );
    expect(
      mask('https://example.test/g?v={"q" : "romeo" ,"e":"\\u00e9","s":"\\/"}', ["romeo"]).url,
    ).toBe('https://example.test/g?v={"q" : "<text>" ,"e":"\\u00e9","s":"\\/"}');
    // Inside a string, only the matched characters change; an escape beside them stays.
    expect(mask('https://example.test/g?v={"q":"dummy romeo \\u0021"}', ["dummy romeo"]).url).toBe(
      'https://example.test/g?v={"q":"<text> \\u0021"}',
    );
  });

  it("counts as markers only the spans it lists, never characters of the URL", () => {
    const values = [
      { value: "romeo", marker: "<text>" },
      { value: "\uE000 abcd", marker: "<text-2>" },
    ];
    const url = "https://example.test/%EE%80%80%20abcd?q=romeo+abcd&both=%EF%80%80";
    const expected = "https://example.test/<text-2>?q=<text>+abcd&both=%EF%80%80";
    expect(typedValues.maskTypedValuesInUrl(url, values).url).toBe(expected);
    const first = typedValues.maskTypedValuesInUrl(url, values.slice(0, 1));
    const again = typedValues.maskTypedValuesInUrl(first.url, values, { markers: first.markers });
    expect(again.url).toBe(expected);
    expect(again.markers).toEqual([
      { start: 21, end: 29 },
      { start: 32, end: 38 },
    ]);
  });

  it("keeps a route segment on a later pass, when the query's marker stands for that typed value", () => {
    const users = [{ value: "users", marker: "<text>", id: "call-1.0" }];
    const first = typedValues.maskTypedValuesInUrl("https://example.test/api/users?q=users", users);
    expect(first.url).toBe("https://example.test/api/users?q=<text>");
    expect(first.markers).toEqual([{ start: 33, end: 39, typedValue: "call-1.0" }]);
    expect(typedValues.maskTypedValuesInUrl(first.url, users, { markers: first.markers })).toEqual(
      first,
    );
  });

  it("never takes a listed marker for another typed value that shares its name", () => {
    const romeo = { value: "romeo", marker: "<redacted>", id: "call-1.0" };
    const secrets = { value: "secrets", marker: "<redacted>", id: "call-2.0" };
    const first = typedValues.maskTypedValuesInUrl("https://example.test/secrets?q=romeo", [romeo]);
    expect(first.url).toBe("https://example.test/secrets?q=<redacted>");
    const later = typedValues.maskTypedValuesInUrl(first.url, [romeo, secrets], {
      markers: first.markers,
    });
    expect(later.url).toBe("https://example.test/<redacted>?q=<redacted>");
    // A marker listed with no typed value counts for none.
    const unnamed = typedValues.maskTypedValuesInUrl(first.url, [romeo, secrets], {
      markers: [{ start: 31, end: 41 }],
    });
    expect(unnamed.url).toBe("https://example.test/<redacted>?q=<redacted>");
  });

  it("gives a masked JSON scalar no field when its query key repeats", () => {
    const url = `https://example.test/g?v=${json('{"year":2024}')}&v=${json('{"year":"<genuine>"}')}`;
    const { markers } = mask(url, ["2024"]);
    expect(markers).toEqual([expect.objectContaining({ type: "number", repeatedKey: "v" })]);
    expect(markers[0]).not.toHaveProperty("field");
  });

  it("walks JSON held in a JSON string the same way, keeping its keys and escapes", () => {
    const inner = JSON.stringify({ romeo: "romeo", year: 2024, say: 'say "hi"', id: 2 });
    const url = `https://example.test/g?v=${json(JSON.stringify({ payload: inner }))}`;
    const masked = mask(url, ["romeo", "2024", 'say "hi"']);
    const outer = JSON.parse(new URL(masked.url).searchParams.get("v") as string);
    expect(JSON.parse(outer.payload)).toEqual({
      romeo: "<text>",
      year: "<text-2>",
      say: "<text-3>",
      id: 2,
    });
    expect(masked.markers.map((item: { type?: string }) => item.type ?? null)).toEqual([
      null,
      "number",
      null,
    ]);
  });
});

describe("every spelling of a typed value, masked at any depth", () => {
  const typed = (...values: string[]) =>
    values.map((value, index) => ({
      value,
      marker: index === 0 ? "<text>" : `<text-${index + 1}>`,
    }));
  const mask = (json: string, values: string[], options = {}) =>
    typedValues.maskTypedValuesInUrl(
      `https://example.test/g?v=${encodeURIComponent(json)}`,
      typed(...values),
      options,
    );
  const query = (result: { url: string }) =>
    JSON.parse(new URL(result.url).searchParams.get("v") as string);
  // `inner` held in a JSON string `depth` times over: {"payload":"{\"payload\":…}"}.
  const nest = (inner: string, depth: number) => {
    let text = inner;
    for (let level = 0; level < depth; level++) {
      text = JSON.stringify({ payload: text });
    }
    return text;
  };
  const unnest = (outer: { payload?: string }, depth: number) => {
    let value: any = outer;
    for (let level = 0; level < depth; level++) {
      value = JSON.parse(value.payload);
    }
    return value;
  };

  it("masks a leaf that spells the value both as typed and encoded once more", () => {
    const result = mask('{"q":"foo bar, foo%20bar"}', ["foo bar"]);
    expect(query(result)).toEqual({ q: "<text>" });
    expect(result.url).not.toMatch(/foo/);
    const both = mask('{"q":"verylongsecret foo%20bar"}', ["verylongsecret", "foo bar"]);
    expect(both.url).not.toMatch(/foo|verylongsecret/);
    // The leaf masked whole for the second value takes the first's match in it.
    expect(query(both)).toEqual({ q: "<text-2>" });
  });

  it("masks a JSON string whose whole text is the typed value, before reading it as JSON", () => {
    for (const value of ['{"q":"words"}', '["private words"]']) {
      expect(query(mask(JSON.stringify({ payload: value, n: 1 }), [value]))).toEqual({
        payload: "<text>",
        n: 1,
      });
    }
  });

  it("walks JSON held in strings at any depth, keeping it valid and its keys as they are", () => {
    const inner = JSON.stringify({ q: 'say "hi"', secret: "safe", number: 2024 }).replace(
      '"number"',
      '"name":"\\u0041lice","number"',
    );
    for (const depth of [4, 5, 6, 8]) {
      for (const [value, field] of [
        ['say "hi"', "q"],
        ["Alice", "name"],
        ["2024", "number"],
      ]) {
        const result = mask(nest(inner, depth), [value]);
        const leaf = unnest(query(result), depth);
        expect(leaf[field]).toBe("<text>");
        expect(Object.keys(leaf)).toEqual(["q", "secret", "name", "number"]);
      }
      const keyed = unnest(query(mask(nest(inner, depth), ["secret"])), depth);
      expect(keyed).toEqual({ q: 'say "hi"', secret: "safe", name: "Alice", number: 2024 });
    }
  });

  it("walks JSON nested any number of arrays deep", () => {
    for (const depth of [100, 8000]) {
      const result = mask(`${"[".repeat(depth)}"secret"${"]".repeat(depth)}`, ["secret"]);
      expect(result.url).not.toContain("secret");
      let value = query(result);
      for (let level = 1; level < depth; level++) {
        value = value[0];
      }
      expect(value).toEqual(["<text>"]);
    }
  });

  it("masks a whole value, with no type, when the walk leaves a spelling of a typed value", () => {
    const url = `https://example.test/g?v=${encodeURIComponent('{"q":"romeo","n":1}')}&w=keep`;
    const skips = () => [];
    expect(typedValues.maskTypedValuesInUrl(url, typed("romeo"), { walk: skips })).toEqual({
      url: "https://example.test/g?v=<text>&w=keep",
      markers: [{ start: 25, end: 31 }],
    });
    // The walk spells the value another way it doesn't decode: percent-encoded twice.
    const twice = `https://example.test/g?v=${encodeURIComponent(encodeURIComponent("romeo, other"))}`;
    expect(typedValues.maskTypedValuesInUrl(twice, typed("romeo"), { walk: skips }).url).toBe(
      "https://example.test/g?v=<text>",
    );
  });

  it("masks a whole value, with no type, when the walk leaves JSON that no longer parses", () => {
    const url = `https://example.test/g?v=${encodeURIComponent('{"n":2024}')}`;
    // A walk that writes a number's marker without its quotes.
    const unquoted = (raw: string, offset: number) => {
      const start = raw.indexOf("2024");
      return start < 0
        ? []
        : [
            {
              start: offset + start,
              end: offset + start + 4,
              pieces: [{ marker: "<text>", type: "number" }],
            },
          ];
    };
    expect(typedValues.maskTypedValuesInUrl(url, typed("2024"), { walk: unquoted })).toEqual({
      url: "https://example.test/g?v=<text>",
      markers: [{ start: 25, end: 31 }],
    });
  });

  it("masks in time linear in the URL's size", () => {
    const time = (url: string, values: string[]) => {
      const start = performance.now();
      const result = typedValues.maskTypedValuesInUrl(url, typed(...values));
      return { ms: performance.now() - start, result };
    };
    // Under 100 ms each on an idle machine; the bound leaves room for a loaded one.
    const LIMIT = 1000;
    const array = `https://example.test/g?v=${encodeURIComponent(JSON.stringify(Array(8000).fill("other")))}`;
    expect(array.length).toBeGreaterThan(112000);
    expect(time(array, ["2024"]).ms).toBeLessThan(LIMIT);
    const object = Object.fromEntries(Array.from({ length: 8000 }, (_, i) => [`k${i}`, "other"]));
    expect(
      time(`https://example.test/g?v=${encodeURIComponent(JSON.stringify(object))}`, ["2024"]).ms,
    ).toBeLessThan(LIMIT);
    const pairs = Array.from({ length: 8000 }, (_, i) => `k${i}=2024`).join("&");
    const many = time(`https://example.test/g?${pairs}`, ["2024"]);
    expect(many.ms).toBeLessThan(LIMIT);
    expect(many.result.markers).toHaveLength(8000);
    for (const count of [2000, 8000]) {
      const numbers = time(
        `https://example.test/g?v=${encodeURIComponent(`[${Array(count).fill("2024").join(",")}]`)}`,
        ["2024"],
      );
      expect(numbers.ms).toBeLessThan(LIMIT);
      expect(numbers.result.markers).toHaveLength(count);
    }
    // The work counts below prove linear growth; these only catch a gross slowdown.
    const alternating = `[${Array.from({ length: 8000 }, (_, i) => (i % 2 ? "2025" : "2024")).join(",")}]`;
    expect(
      time(`https://example.test/g?v=${encodeURIComponent(alternating)}`, ["2024", "2025"]).ms,
    ).toBeLessThan(LIMIT);
    const nested = `${'{"x":0,"x":'.repeat(4000)}1${"}".repeat(4000)}`;
    expect(
      time(`https://example.test/g?v=${encodeURIComponent(nested)}`, ["2024"]).ms,
    ).toBeLessThan(LIMIT);
  });
});

describe("the check after masking: only a proven match counts, read as a site reads it", () => {
  const typed = (value: string, marker = "<text>", id = "call-1.0") => ({ value, marker, id });
  const encode = (text: string, times: number) => {
    let encoded = text;
    for (let time = 0; time < times; time++) {
      encoded = encodeURIComponent(encoded);
    }
    return encoded;
  };
  // What a site reads from the query value `v`, decoded as many times as that changes it.
  const read = (url: string) => {
    let text = new URL(url).searchParams.get("v") as string;
    for (let time = 0; time < 8; time++) {
      text = new URLSearchParams(`q=${text}`).get("q") as string;
    }
    return text;
  };
  // Encoded more often than the check reads, so it can't read it in full.
  const unreadable = `%${"25".repeat(1000)}41`;

  it("masks a value it has too many readings to check whole, and counts no typed value as held", () => {
    const query = typedValues.maskTypedValuesInUrl(`https://example.test/romeo?q=${unreadable}`, [
      typed("romeo"),
    ]);
    expect(query).toEqual({
      url: "https://example.test/<text>?q=<redacted>",
      markers: [
        { start: 21, end: 27, typedValue: "call-1.0" },
        { start: 30, end: 40 },
      ],
    });
    const body = typedValues.maskTypedValuesInUrl("https://example.test/romeo", [typed("romeo")], {
      body: unreadable,
    });
    expect(body.url).toBe("https://example.test/<text>");
  });

  it("reads past every marker an earlier pass listed, but counts only one with an id as held", () => {
    const url = `https://example.test/redacted?q=${unreadable}`;
    const first = typedValues.maskTypedValuesInUrl(url, [typed("romeo")]);
    expect(first.url).toBe("https://example.test/redacted?q=<redacted>");
    const later = typedValues.maskTypedValuesInUrl(
      first.url,
      [typed("romeo"), typed("redacted", "<text-2>", "call-2.0")],
      { markers: first.markers },
    );
    expect(later).toEqual({
      url: "https://example.test/<text-2>?q=<redacted>",
      markers: [
        { start: 21, end: 29, typedValue: "call-2.0" },
        { start: 32, end: 42 },
      ],
    });
  });

  it("reads + as a space only in a form-encoded value, never in JSON or a path", () => {
    const path = `https://example.test/search/${encodeURIComponent("foo bar")}`;
    expect(
      typedValues.maskTypedValuesInUrl(path, [typed("foo bar")], { body: '{"q":"foo+bar"}' }).url,
    ).toBe("https://example.test/search/<text>");
    expect(
      typedValues.maskTypedValuesInUrl(path, [typed("foo bar")], { body: "q=foo+bar" }).url,
    ).toBe(path);
    const raw = JSON.stringify({ q: "foo+bar", n: 2024 });
    const result = typedValues.maskTypedValuesInUrl(
      `https://example.test/g?v=${encodeURIComponent(raw)}`,
      [typed("foo bar"), typed("2024", "<text-2>", "call-2.0")],
    );
    expect(JSON.parse(new URL(result.url).searchParams.get("v") as string)).toEqual({
      q: "foo+bar",
      n: "<text-2>",
    });
    const request = {
      method: "GET",
      url: "https://example.test/g",
      query: { v: new URL(result.url).searchParams.get("v") },
      headers: {},
      redactedTypes: Object.fromEntries(
        result.markers
          .filter((item: { field?: string }) => item.field)
          .map((item: { field: string; type: string }) => [item.field, item.type]),
      ),
    };
    const named = paramOp(
      { id: "search", args: {}, run: [{ using: "network", request }] },
      { fields: ["query.v.n"], as: "n" },
    );
    expect(named.op.args.n.type).toBe("number");
  });

  it("checks page text that looks like a marker as any other text, at any depth", () => {
    const inner = typedValues.maskTypedValuesInUrl(
      `https://example.test/g?v=${encode("<redacted>", 5)}`,
      [typed("redacted")],
    );
    expect(inner.url).toBe("https://example.test/g?v=<text>");
    expect(inner.markers).toEqual([{ start: 25, end: 31, typedValue: "call-1.0" }]);
    const whole = typedValues.maskTypedValuesInUrl(
      `https://example.test/g?v=${encode("<text>", 5)}`,
      [typed("<text>", "<text-2>")],
    );
    expect(whole.url).toBe("https://example.test/g?v=<text-2>");
  });

  it("reads malformed UTF-8 as URLSearchParams does, keeping the valid bytes beside it", () => {
    const replaced = typedValues.maskTypedValuesInUrl("https://example.test/g?v=abc%FFdef", [
      typed("abc\uFFFDdef"),
    ]);
    expect(replaced.url).toBe("https://example.test/g?v=<text>");
    for (const times of [1, 4, 5, 8]) {
      const deep = typedValues.maskTypedValuesInUrl(
        `https://example.test/g?v=${encode("%72%6f%6d%65%6f%FF", times)}`,
        [typed("romeo")],
      );
      expect(read(deep.url)).not.toContain("romeo");
    }
  });

  // The module compiled from its own source with `change` made to it, to count the work it does.
  const instrumented = (change: (source: string) => string) => {
    const file = (require as any).resolve("../../native/record-typed-values.cjs");
    const source = readFileSync(file, "utf8");
    const changed = change(source);
    if (changed === source) {
      throw new Error("the change matched nothing in the source");
    }
    const loaded = new Module(file);
    loaded.filename = file;
    loaded.paths = Module._nodeModulePaths(dirname(file));
    loaded._compile(changed, file);
    return loaded.exports;
  };
  // How much more work each doubling of the input took than the one before: about 2 when linear.
  const growth = (counts: number[]) =>
    Math.max(...counts.slice(1).map((count, index) => count / counts[index]));

  it("marks the values under a repeated JSON key once each, however deep they nest", () => {
    const counter = { writes: 0 };
    (globalThis as any).repeatedLeafWrites = counter;
    const counted = instrumented((source) =>
      source.replace(
        "leaves[leaf].repeated = true",
        "(globalThis.repeatedLeafWrites.writes++, (leaves[leaf].repeated = true))",
      ),
    );
    const counts = [100, 200, 400, 800].map((count) => {
      counter.writes = 0;
      const json = `${'{"x":0,"x":'.repeat(count)}2024${"}".repeat(count)}`;
      const { markers } = counted.maskTypedValuesInUrl(
        `https://example.test/g?v=${encodeURIComponent(json)}`,
        [typed("2024")],
      );
      expect(markers).toEqual([expect.objectContaining({ type: "number" })]);
      expect(markers[0]).not.toHaveProperty("field");
      return counter.writes;
    });
    (globalThis as any).repeatedLeafWrites = undefined;
    expect(growth(counts)).toBeLessThanOrEqual(2.2);
  });

  it("merges each value's edits in one pass, wherever in the URL they fall", () => {
    // The array entries pushed, and the entries splice inserts or moves, while `run` runs.
    const moves = (run: () => void) => {
      const { push, splice } = Array.prototype;
      let count = 0;
      Array.prototype.push = function (this: unknown[], ...items: unknown[]) {
        count += items.length;
        return push.apply(this, items);
      };
      Array.prototype.splice = function (this: unknown[], start: number, removed = 0, ...items) {
        count += items.length + Math.max(0, this.length - start - removed);
        return splice.call(this, start, removed, ...items);
      } as typeof splice;
      try {
        run();
      } finally {
        Array.prototype.push = push;
        Array.prototype.splice = splice;
      }
      return count;
    };
    const values = [typed("2024"), typed("2025", "<text-2>", "call-2.0")];
    const sizes = [100, 200, 400, 800];
    const alternating = sizes.map((count) => {
      const json = `[${Array.from({ length: count }, (_, i) => (i % 2 ? "2025" : "2024")).join(",")}]`;
      const url = `https://example.test/g?v=${encodeURIComponent(json)}`;
      return moves(() =>
        expect(typedValues.maskTypedValuesInUrl(url, values).markers).toHaveLength(count),
      );
    });
    expect(growth(alternating)).toBeLessThanOrEqual(2.2);
    // Path segments are masked after the query, ahead of its markers in the URL.
    const spread = sizes.map((count) => {
      const url = `https://example.test/${Array(count).fill("2025").join("/")}?${Array(count).fill("k=2024").join("&")}`;
      return moves(() =>
        expect(typedValues.maskTypedValuesInUrl(url, values).markers).toHaveLength(2 * count),
      );
    });
    expect(growth(spread)).toBeLessThanOrEqual(2.2);
  });

  it("keeps no typed value once the masking call returns", () => {
    const loaded = instrumented(
      (source) => `${source}\nmodule.exports.insidePatternsNow = () => insidePatterns;`,
    );
    loaded.rememberTypedValues("rec-1", "type", { text: "private phrase" });
    const { url } = loaded.maskTypedValuesInUrl(
      "https://example.test/g?q=some%20private%20phrase%20here",
      [{ value: "private phrase", marker: "<text>" }],
    );
    expect(url).toBe("https://example.test/g?q=some%20<text>%20here");
    loaded.forgetTypedValues("rec-1");
    expect(loaded.heldTypingCalls("rec-1")).toEqual([]);
    expect(loaded.insidePatternsNow()?.has("private phrase") ?? false).toBe(false);
  });
});
