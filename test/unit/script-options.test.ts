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

describe("applyOptionsPrelude", () => {
  it("defines a frozen SURF_OPTIONS constant", () => {
    const code = scriptOptions.applyOptionsPrelude("return SURF_OPTIONS;", { limit: 3 });
    const evaluate = new Function(code);
    expect(evaluate()).toEqual({ limit: 3 });
    expect(Object.isFrozen(evaluate())).toBe(true);
  });

  it("still defines the constant for empty options and prefixes the code", () => {
    expect(scriptOptions.applyOptionsPrelude("return 1;", undefined)).toBe(
      'const SURF_OPTIONS = Object.freeze(JSON.parse("{}"));\nreturn 1;',
    );
  });

  it("keeps a leading use strict directive before the options prelude", () => {
    expect(
      scriptOptions.applyOptionsPrelude('"use strict";\nreturn SURF_OPTIONS;', { ok: true }),
    ).toBe(
      '"use strict";\nconst SURF_OPTIONS = Object.freeze(JSON.parse("{\\"ok\\":true}"));\n\nreturn SURF_OPTIONS;',
    );
  });

  it("does not hoist a string literal continued as a call", () => {
    const code = '"use strict"\n(function(){ return this })()';
    expect(() => new Function(code)()).toThrow(TypeError);
    expect(() => new Function(scriptOptions.applyOptionsPrelude(code, {}))()).toThrow(TypeError);
  });
});
