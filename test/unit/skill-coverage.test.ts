import { describe, expect, it } from "vitest";

declare const process: { execPath: string };
declare const require: (moduleName: string) => any;

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const skillDir = "skills/surf";
const skillFiles = [
  path.join(skillDir, "SKILL.md"),
  ...fs
    .readdirSync(path.join(skillDir, "references"))
    .filter((name: string) => name.endsWith(".md"))
    .map((name: string) => path.join(skillDir, "references", name)),
];

// Public commands are what `surf --help-full` lists before its Aliases line: one indented line per
// command, its name (one or more lowercase words) followed by <args> or a capitalized description.
function publicCommands() {
  const help = spawnSync(process.execPath, ["native/cli.cjs", "--help-full"], { encoding: "utf8" });
  if (help.status !== 0) {
    throw new Error(`surf --help-full failed: ${help.stderr}`);
  }
  const names = new Set<string>();
  const aliases = new Set<string>();
  for (const line of (help.stdout as string).split("\n")) {
    const aliasLine = line.match(/^Aliases: (.*)$/);
    if (aliasLine) {
      for (const [, alias] of aliasLine[1].matchAll(/(\S+) ->/g)) {
        aliases.add(alias);
      }
      break;
    }
    if (!/^ {2}[a-z]/.test(line)) {
      continue;
    }
    const words = [];
    for (const word of line.trim().split(/\s+/)) {
      if (!/^[a-z][a-z0-9._-]*$/.test(word)) {
        break;
      }
      words.push(word);
    }
    names.add(words.join(" "));
  }
  return { names, aliases };
}

const { names: commands, aliases } = publicCommands();
const known = new Set([...commands, ...aliases]);
const longest = Math.max(...[...known].map((name) => name.split(" ").length));

// The public command that starts `words`, longest first. A first word written as `a|b|c`
// names several single-word commands at once.
function commandAt(words: string[]): string[] | undefined {
  if (words[0].includes("|")) {
    const alternatives = words[0].split("|");
    return alternatives.every((name) => known.has(name)) ? alternatives : undefined;
  }
  for (let size = Math.min(longest, words.length); size > 0; size--) {
    const name = words.slice(0, size).join(" ");
    if (known.has(name)) {
      return [name];
    }
  }
  return undefined;
}

function leadingWords(text: string): string[] {
  const words = [];
  for (const word of text.trim().split(/\s+/)) {
    if (!/^[a-z][a-z0-9._|-]*$/.test(word)) {
      break;
    }
    words.push(word);
  }
  return words;
}

// The word runs that name commands in a ```text commands block (one command per " | " segment)
// or a ```text index block (several names per segment, after a "group: " label).
function blockSegments(text: string) {
  const segments: { kind: string; words: string[] }[] = [];
  for (const [, kind, body] of text.matchAll(/```text (commands|index)\n([\s\S]*?)```/g)) {
    for (const rawLine of body.split("\n")) {
      const uncommented = rawLine.replace(/\s#.*$/, "");
      const line = kind === "index" ? uncommented.replace(/^[a-z]+: /, "") : uncommented;
      for (const segment of line.split(" | ")) {
        segments.push({ kind, words: leadingWords(segment.replace(/^surf /, "")) });
      }
    }
  }
  return segments;
}

// Every place the skill names a command: each `surf <command>` and the command blocks.
function skillCommands() {
  const used = new Set<string>();
  const unknown: string[] = [];
  // Records the command that starts `words` and returns how many words it took.
  const take = (words: string[], file: string) => {
    const names = commandAt(words);
    if (!names) {
      unknown.push(`${file}: ${words.join(" ")}`);
      return words.length;
    }
    for (const name of names) {
      used.add(name);
    }
    return names.length === 1 ? names[0].split(" ").length : 1;
  };
  for (const file of skillFiles) {
    const text = fs.readFileSync(file, "utf8") as string;
    const runs = [...text.matchAll(/(?<![\w./$-])surf ([^\n`]*)/g)].map((match) => ({
      kind: "commands",
      words: leadingWords(match[1]),
    }));
    for (const { kind, words } of [...runs, ...blockSegments(text)]) {
      if (words.length === 0) {
        continue;
      }
      if (kind === "commands") {
        take(words, file);
        continue;
      }
      for (let rest = words; rest.length > 0; ) {
        rest = rest.slice(take(rest, file));
      }
    }
  }
  return { used, unknown };
}

describe("Surf skill command coverage", () => {
  it("parses the CLI's public command list", () => {
    expect(commands.size).toBeGreaterThan(100);
    expect(known.has("oracle ask")).toBe(true);
  });

  it("names only commands the CLI has, and every command it has", () => {
    const { used, unknown } = skillCommands();
    const missing = [...commands].filter((name) => !used.has(name));
    expect({ unknown, missing }).toEqual({ unknown: [], missing: [] });
  });
});
