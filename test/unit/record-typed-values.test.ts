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
    expect(redact("https://example.test/s?q=pizza+near+me", "pizza")).toBe(
      "https://example.test/s?q=pizza+near+me",
    );
    expect(redact("https://name.example.test/?q=other", "name")).toBe(
      "https://name.example.test/?q=other",
    );
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
  });

  it("replaces a short fragment and fragment values", () => {
    expect(redact("https://example.test/page#abc", "abc")).toBe("https://example.test/page#<text>");
    expect(redact("https://example.test/page#tab=abc&x=1", "abc")).toBe(
      "https://example.test/page#tab=<text>&x=1",
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
});
