import { describe, expect, it } from "vitest";
import { diffPageSnapshots, type PageNode, type PageSnapshot } from "../../src/utils/page-changes";

function node(role: string, name: string, overrides: Partial<PageNode> = {}): PageNode {
  return {
    role,
    name,
    scope: "",
    container: null,
    state: { checked: null, disabled: false, expanded: null, selected: null, pressed: null },
    ...overrides,
  };
}

function snapshot(nodes: PageNode[], text: PageSnapshot["text"] = {}): PageSnapshot {
  return { nodes, text };
}

const refOf = (index: number) => `e${index + 100}`;

describe("diffPageSnapshots", () => {
  it("reports nothing for identical snapshots", () => {
    const page = snapshot([
      node("main", ""),
      node("button", "Save", { scope: "main ", container: 0 }),
    ]);
    expect(diffPageSnapshots(page, structuredClone(page), refOf)).toEqual({
      changes: [],
      text: [],
      omitted: 0,
    });
  });

  it("groups everything added inside a new dialog under its outermost added container", () => {
    const before = snapshot([node("button", "Delete project")]);
    const after = snapshot([
      node("button", "Delete project"),
      node("dialog", "Delete project?"),
      node("form", "Confirm", { scope: "dialog Delete project?", container: 1 }),
      node("button", "Delete", { scope: "form Confirm", container: 2 }),
    ]);

    expect(diffPageSnapshots(before, after, refOf).changes).toEqual([
      { kind: "added", ref: "e101", role: "dialog", name: "Delete project?" },
      { kind: "added", ref: "e102", role: "form", name: "Confirm", within: "e101" },
      { kind: "added", ref: "e103", role: "button", name: "Delete", within: "e101" },
    ]);
  });

  it("reports a closed dialog once instead of listing its contents", () => {
    const before = snapshot([
      node("dialog", "Settings"),
      node("button", "Close", { scope: "dialog Settings", container: 0 }),
      node("button", "Open settings"),
    ]);
    const after = snapshot([
      node("button", "Open settings", { state: { ...before.nodes[2].state, expanded: false } }),
    ]);

    expect(diffPageSnapshots(before, after, refOf).changes).toEqual([
      {
        kind: "changed",
        ref: "e100",
        role: "button",
        name: "Open settings",
        property: "expanded",
        from: null,
        to: false,
      },
      { kind: "removed", ref: null, role: "dialog", name: "Settings" },
    ]);
  });

  it("matches duplicates in order and reports a renamed element at the same position", () => {
    const before = snapshot([
      node("heading", "Step 1"),
      node("button", "Remove"),
      node("button", "Remove"),
      node("button", "Remove"),
    ]);
    const after = snapshot([
      node("heading", "Step 2"),
      node("button", "Remove"),
      node("button", "Remove"),
    ]);

    expect(diffPageSnapshots(before, after, refOf).changes).toEqual([
      {
        kind: "changed",
        ref: "e100",
        role: "heading",
        name: "Step 2",
        property: "name",
        from: "Step 1",
        to: "Step 2",
      },
      { kind: "removed", ref: null, role: "button", name: "Remove" },
    ]);
  });

  it("redacts a value change when either side of the field was sensitive", () => {
    const before = snapshot([node("textbox", "Password", { valueHash: "a1", sensitive: true })]);
    const after = snapshot([
      node("textbox", "Password", { valueHash: "b2", value: "now-visible" }),
    ]);

    expect(diffPageSnapshots(before, after, refOf).changes).toEqual([
      {
        kind: "changed",
        ref: "e100",
        role: "textbox",
        name: "Password",
        property: "value",
        redacted: true,
      },
    ]);
  });

  it("counts body text additions and removals per region", () => {
    const before = snapshot([], { page: { h1: 1, h2: 2 } });
    const after = snapshot([], { page: { h2: 1, h3: 1 }, 'dialog "Saved"': { h4: 3 } });

    expect(diffPageSnapshots(before, after, refOf).text).toEqual([
      { region: "page", added: 1, removed: 2 },
      { region: 'dialog "Saved"', added: 3, removed: 0 },
    ]);
  });

  it("caps the change list and counts the rest as omitted", () => {
    const after = snapshot(
      Array.from({ length: 35 }, (_, index) => node("link", `Result ${index}`)),
    );

    const result = diffPageSnapshots(snapshot([]), after, refOf);
    expect(result.changes).toHaveLength(30);
    expect(result.changes[29]).toMatchObject({ kind: "added", name: "Result 29" });
    expect(result.omitted).toBe(5);
  });
});
