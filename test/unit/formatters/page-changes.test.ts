// @ts-expect-error - CommonJS module without type definitions
import { formatPageChanges } from "../../../native/formatters/page-changes.cjs";

const base = {
  settle: { state: "settled", ms: 340 },
  navigated: null,
  changes: [],
  text: [],
  omitted: 0,
};

describe("formatPageChanges", () => {
  it("groups an added dialog with its buttons and their refs", () => {
    expect(
      formatPageChanges({
        ...base,
        changes: [
          { kind: "added", ref: "e40", role: "dialog", name: "Delete project?" },
          { kind: "added", ref: "e41", role: "button", name: "Cancel", within: "e40" },
          { kind: "added", ref: "e42", role: "button", name: "Delete", within: "e40" },
          {
            kind: "changed",
            ref: "e12",
            role: "button",
            name: "Delete",
            property: "disabled",
            from: false,
            to: true,
          },
        ],
      }),
    ).toEqual([
      "changed (settled in 340ms):",
      '  + dialog "Delete project?"',
      '      e41 button "Cancel"',
      '      e42 button "Delete"',
      '  ~ e12 button "Delete"  now disabled',
    ]);
  });

  it("flattens a nested added group under its outermost container", () => {
    expect(
      formatPageChanges({
        ...base,
        changes: [
          { kind: "added", ref: "e1", role: "main", name: "" },
          { kind: "added", ref: "e2", role: "dialog", name: "Confirm", within: "e1" },
          { kind: "added", ref: "e3", role: "button", name: "OK", within: "e2" },
        ],
      }),
    ).toEqual([
      "changed (settled in 340ms):",
      "  + main",
      '      e2 dialog "Confirm"',
      '      e3 button "OK"',
    ]);
  });

  it("renders one line per state change", () => {
    const line = (property: string, from: unknown, to: unknown) =>
      formatPageChanges({
        ...base,
        changes: [
          { kind: "changed", ref: "e5", role: "checkbox", name: "Agree", property, from, to },
        ],
      })[1];
    expect(line("checked", false, true)).toBe('  ~ e5 checkbox "Agree"  now checked');
    expect(line("checked", true, false)).toBe('  ~ e5 checkbox "Agree"  now unchecked');
    expect(line("disabled", true, false)).toBe('  ~ e5 checkbox "Agree"  now enabled');
    expect(line("expanded", false, true)).toBe('  ~ e5 checkbox "Agree"  now expanded');
    expect(line("expanded", true, false)).toBe('  ~ e5 checkbox "Agree"  now collapsed');
    expect(line("value", "a", "b")).toBe('  ~ e5 checkbox "Agree"  value "a" -> "b"');
    expect(line("checked", false, "mixed")).toBe(
      '  ~ e5 checkbox "Agree"  checked false -> "mixed"',
    );
  });

  it("never prints a redacted value", () => {
    expect(
      formatPageChanges({
        ...base,
        changes: [
          {
            kind: "changed",
            ref: "e7",
            role: "textbox",
            name: "Password",
            property: "value",
            redacted: true,
          },
        ],
      }),
    ).toEqual(["changed (settled in 340ms):", '  ~ e7 textbox "Password"  value changed']);
  });

  it("renders removed elements, text counts and the cap marker", () => {
    expect(
      formatPageChanges({
        ...base,
        changes: [{ kind: "removed", ref: null, role: "button", name: "Undo" }],
        text: [
          { region: "main", added: 3, removed: 0 },
          { region: "banner", added: 0, removed: 0 },
          { region: "aside", added: 1, removed: 2 },
        ],
        omitted: 12,
      }),
    ).toEqual([
      "changed (settled in 340ms):",
      '  - button "Undo"',
      "  main: +3 text",
      "  aside: +1 -2 text",
      '+12 more changes. Narrow instead of re-reading: surf locate.role <role> --name "<text>"',
    ]);
  });

  it("points a truncated diff at the added group root and its dominant role", () => {
    const options = Array.from({ length: 28 }, (_, i) => ({
      kind: "added",
      ref: `e${202 + i}`,
      role: "option",
      name: `Country ${i}`,
      within: "e200",
    }));
    const lines = formatPageChanges({
      ...base,
      changes: [
        { kind: "added", ref: "e200", role: "dialog", name: "Choose country" },
        { kind: "added", ref: "e201", role: "listbox", name: "Country", within: "e200" },
        ...options,
      ],
      omitted: 220,
    });
    expect(lines.at(-1)).toBe(
      '+220 more changes, mostly option. Narrow instead of re-reading: surf locate.role option --name "<text>" | surf read --ref e200 --all --no-text',
    );
  });

  it("names the dominant role when no added group was shown", () => {
    const lines = formatPageChanges({
      ...base,
      changes: [
        { kind: "added", ref: "e1", role: "row", name: "a" },
        { kind: "added", ref: "e2", role: "row", name: "b" },
        { kind: "added", ref: "e3", role: "link", name: "c" },
      ],
      omitted: 40,
    });
    expect(lines.at(-1)).toBe(
      '+40 more changes, mostly row. Narrow instead of re-reading: surf locate.role row --name "<text>"',
    );
  });

  it("keeps the role a placeholder when shown added changes are mixed", () => {
    const lines = formatPageChanges({
      ...base,
      changes: [
        { kind: "added", ref: "e10", role: "region", name: "Results" },
        { kind: "added", ref: "e11", role: "link", name: "a", within: "e10" },
        { kind: "added", ref: "e12", role: "button", name: "b", within: "e10" },
      ],
      omitted: 5,
    });
    expect(lines.at(-1)).toBe(
      '+5 more changes. Narrow instead of re-reading: surf locate.role <role> --name "<text>" | surf read --ref e10 --all --no-text',
    );
  });

  it("reports no visible change with the quiet window", () => {
    expect(formatPageChanges({ ...base, settle: { state: "quiet", ms: 300 } })).toEqual([
      "no visible change (quiet 300ms)",
    ]);
  });

  it("marks unsettled changes as partial", () => {
    expect(
      formatPageChanges({
        ...base,
        settle: { state: "unsettled", ms: 2000 },
        changes: [{ kind: "added", ref: "e9", role: "status", name: "Loading" }],
      }),
    ).toEqual(["still changing after 2000ms (partial):", '  + e9 status "Loading"']);
  });

  it("collapses a navigation to one line", () => {
    expect(
      formatPageChanges({
        ...base,
        navigated: { from: "https://a/", to: "https://b/login", title: "Sign in" },
        changes: [{ kind: "removed", ref: null, role: "button", name: "Go" }],
        omitted: 4,
      }),
    ).toEqual(['navigated: https://a/ -> https://b/login "Sign in"']);
  });
});
