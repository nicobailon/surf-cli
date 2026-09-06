import { describe, expect, it } from "vitest";

// @ts-expect-error - CommonJS module without type definitions
import * as scriptOptions from "../../native/script-options.cjs";

describe("parseScriptOptions", () => {
  it("returns an empty object for missing input", () => {
    expect(scriptOptions.parseScriptOptions(undefined)).toEqual({});
    expect(scriptOptions.parseScriptOptions(null)).toEqual({});
    expect(scriptOptions.parseScriptOptions("")).toEqual({});
  });

  it("accepts JSON strings and plain objects", () => {
    expect(scriptOptions.parseScriptOptions('{"limit": 20, "query": "x"}')).toEqual({
      limit: 20,
      query: "x",
    });
    expect(scriptOptions.parseScriptOptions({ mode: "list" })).toEqual({ mode: "list" });
  });

  it("rejects non-object values and invalid JSON", () => {
    expect(() => scriptOptions.parseScriptOptions("[1]")).toThrow(/must be a JSON object/);
    expect(() => scriptOptions.parseScriptOptions("42")).toThrow(/must be a JSON object/);
    expect(() => scriptOptions.parseScriptOptions("{oops")).toThrow(/not valid JSON/);
    expect(() => scriptOptions.parseScriptOptions(true)).toThrow(/needs a JSON object/);
  });

  it("strips functions and undefined values by JSON round-trip", () => {
    const parsed = scriptOptions.parseScriptOptions({ keep: 1, fn: () => 1, gone: undefined });
    expect(parsed).toEqual({ keep: 1 });
  });
});

describe("buildOptionsPrelude", () => {
  it("defines a frozen SURF_OPTIONS constant that is valid JavaScript on its own", () => {
    const prelude = scriptOptions.buildOptionsPrelude({ limit: 3 });
    expect(prelude).toBe('const SURF_OPTIONS = Object.freeze({"limit":3});\n');
    const evaluate = new Function(`${prelude}return SURF_OPTIONS;`);
    expect(evaluate()).toEqual({ limit: 3 });
    expect(Object.isFrozen(evaluate())).toBe(true);
  });

  it("still defines the constant for empty options and prefixes the code", () => {
    expect(scriptOptions.applyOptionsPrelude("return 1;", undefined)).toBe(
      "const SURF_OPTIONS = Object.freeze({});\nreturn 1;",
    );
  });
});
