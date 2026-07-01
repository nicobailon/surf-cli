import { describe, expect, it } from "vitest";

// @ts-expect-error - CommonJS module without type definitions
import * as parser from "../../native/do-parser.cjs";

describe("parseDoCommands", () => {
  it("parses single command", () => {
    const input = "screenshot";
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(1);
    expect(steps[0].cmd).toBe("screenshot");
    expect(steps[0].args).toEqual({});
  });

  it("parses pipe-separated commands", () => {
    const input = 'go "https://example.com" | click e5 | screenshot';
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(3);
    expect(steps[0].cmd).toBe("navigate");
    expect(steps[0].args.url).toBe("https://example.com");
    expect(steps[1].cmd).toBe("click");
    expect(steps[1].args.ref).toBe("e5");
    expect(steps[2].cmd).toBe("screenshot");
  });

  it("parses newline-separated commands", () => {
    const input = 'go "https://example.com"\nclick e5';
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(2);
    expect(steps[0].cmd).toBe("navigate");
    expect(steps[0].args.url).toBe("https://example.com");
    expect(steps[1].cmd).toBe("click");
    expect(steps[1].args.ref).toBe("e5");
  });

  it("parses click with coordinates", () => {
    const input = "click 100 200";
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(1);
    expect(steps[0].cmd).toBe("click");
    expect(steps[0].args.x).toBe(100);
    expect(steps[0].args.y).toBe(200);
  });

  it("parses click with selector option", () => {
    const input = 'click --selector ".button"';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].cmd).toBe("click");
    expect(steps[0].args.selector).toBe(".button");
  });

  it("ignores blank lines", () => {
    const input = 'go "url"\n\n\nclick e5';
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(2);
  });

  it("ignores comment lines", () => {
    const input = '# comment\ngo "url"\n# another comment\nclick e5';
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(2);
    expect(steps[0].cmd).toBe("navigate");
    expect(steps[1].cmd).toBe("click");
  });

  it("applies aliases", () => {
    const input = 'go "url"\nsnap\nread';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].cmd).toBe("navigate");
    expect(steps[1].cmd).toBe("screenshot");
    expect(steps[2].cmd).toBe("page.read");
  });

  it("handles quoted strings with spaces", () => {
    const input = 'type "hello world"';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.text).toBe("hello world");
  });

  it("handles single-quoted strings", () => {
    const input = "type 'hello world'";
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.text).toBe("hello world");
  });

  it("parses options with values", () => {
    const input = 'type "hello" --ref e5 --submit';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.text).toBe("hello");
    expect(steps[0].args.ref).toBe("e5");
    expect(steps[0].args.submit).toBe(true);
  });

  it("parses numeric option values", () => {
    const input = "wait --duration 500";
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.duration).toBe(500);
  });

  it("parses boolean option values", () => {
    const input = "screenshot --fullpage true";
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.fullpage).toBe(true);
  });

  it("parses complex workflow", () => {
    const input = `
# Login workflow
go "https://example.com/login"
type "user@example.com" --selector "input[name=email]"
type "password123" --selector "input[name=password]"
click --selector "button[type=submit]"
screenshot --output /tmp/result.png
`;
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(5);
    expect(steps[0].cmd).toBe("navigate");
    expect(steps[1].cmd).toBe("type");
    expect(steps[1].args.text).toBe("user@example.com");
    expect(steps[4].cmd).toBe("screenshot");
    expect(steps[4].args.output).toBe("/tmp/result.png");
  });

  it("handles URLs with special characters", () => {
    const input = 'go "https://example.com/path?query=value&foo=bar"';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].args.url).toBe("https://example.com/path?query=value&foo=bar");
  });

  it("handles literal backslash-n as newline separator", () => {
    // Simulates bash single-quoted string: 'go "url"\nclick e5'
    const input = 'go "https://example.com"\\nclick e5\\nscreenshot';
    const steps = parser.parseDoCommands(input);
    expect(steps).toHaveLength(3);
    expect(steps[0].cmd).toBe("navigate");
    expect(steps[1].cmd).toBe("click");
    expect(steps[2].cmd).toBe("screenshot");
  });

  it("parses select with value", () => {
    const input = 'select e5 "US"';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].cmd).toBe("select");
    expect(steps[0].args.selector).toBe("e5");
    expect(steps[0].args.values).toBe("US"); // Single value as string (host wraps in array)
  });

  it("parses select with multiple values", () => {
    const input = 'select e5 "opt1" "opt2" "opt3"';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].cmd).toBe("select");
    expect(steps[0].args.selector).toBe("e5");
    expect(steps[0].args.values).toEqual(["opt1", "opt2", "opt3"]);
  });

  it("parses select with options", () => {
    const input = 'select e5 "United States" --by label';
    const steps = parser.parseDoCommands(input);
    expect(steps[0].cmd).toBe("select");
    expect(steps[0].args.selector).toBe("e5");
    expect(steps[0].args.values).toBe("United States"); // Single value as string
    expect(steps[0].args.by).toBe("label");
  });
});

describe("tokenize", () => {
  it("splits on spaces", () => {
    expect(parser.tokenize("go url")).toEqual(["go", "url"]);
  });

  it("respects double quotes", () => {
    expect(parser.tokenize('go "https://example.com"')).toEqual(["go", "https://example.com"]);
  });

  it("respects single quotes", () => {
    expect(parser.tokenize("type 'hello world'")).toEqual(["type", "hello world"]);
  });

  it("handles mixed quotes", () => {
    expect(parser.tokenize("type \"hello\" --ref 'e5'")).toEqual(["type", "hello", "--ref", "e5"]);
  });

  it("handles empty input", () => {
    expect(parser.tokenize("")).toEqual([]);
  });

  it("handles multiple spaces", () => {
    expect(parser.tokenize("go    url")).toEqual(["go", "url"]);
  });

  it("handles tabs", () => {
    expect(parser.tokenize("go\turl")).toEqual(["go", "url"]);
  });
});

describe("parseCommandLine", () => {
  it("returns null for empty input", () => {
    expect(parser.parseCommandLine("")).toBe(null);
  });

  it("parses command without args", () => {
    const result = parser.parseCommandLine("screenshot");
    expect(result).toEqual({ cmd: "screenshot", args: {} });
  });

  it("applies alias in parseCommandLine", () => {
    const result = parser.parseCommandLine("snap");
    expect(result.cmd).toBe("screenshot");
  });
});
