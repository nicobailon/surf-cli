export const PAGE_CHANGES_CAP = 30;

// Dialogs and landmarks scope matching and group the elements added inside them.
export const PAGE_CONTAINER_ROLES = new Set([
  "dialog", "alertdialog", "banner", "complementary", "contentinfo", "form", "main", "navigation", "region", "search",
]);

export const PAGE_TRACKED_ROLES = new Set([
  ...PAGE_CONTAINER_ROLES,
  "alert", "status", "heading",
  "button", "link", "checkbox", "radio", "switch", "textbox", "searchbox", "combobox", "listbox", "option",
  "slider", "spinbutton", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "treeitem",
]);

const STATE_PROPERTIES = ["checked", "disabled", "expanded", "selected", "pressed"] as const;

export type PageStateValue = string | boolean | null;

export type PageNode = {
  role: string;
  name: string;
  // "role name" of the nearest container ancestor, "" when there is none.
  scope: string;
  container: number | null;
  state: Record<(typeof STATE_PROPERTIES)[number], PageStateValue>;
  // Bounded display value; never present for sensitive fields.
  value?: string;
  valueHash?: string;
  sensitive?: true;
};

export type PageSnapshot = {
  nodes: PageNode[];
  // region label -> text fingerprint -> occurrences
  text: Record<string, Record<string, number>>;
};

export type PageChange = {
  kind: "added" | "removed" | "changed";
  ref: string | null;
  role: string;
  name: string;
  within?: string;
  property?: (typeof STATE_PROPERTIES)[number] | "value" | "name";
  from?: PageStateValue;
  to?: PageStateValue;
  redacted?: true;
};

export type PageChanges = {
  settle: { state: "settled" | "quiet" | "unsettled"; ms: number };
  navigated: null | { from: string; to: string; title: string };
  changes: PageChange[];
  text: Array<{ region: string; added: number; removed: number }>;
  omitted: number;
};

// Position among same-role nodes in the same scope, used to pair renamed elements.
function sameRoleRanks(nodes: PageNode[]): number[] {
  const counts = new Map<string, number>();
  return nodes.map((node) => {
    const key = `${node.role}\u0000${node.scope}`;
    const rank = counts.get(key) || 0;
    counts.set(key, rank + 1);
    return rank;
  });
}

function hasAncestorIn(nodes: PageNode[], index: number, set: Set<number>): boolean {
  for (let current = nodes[index].container; current !== null; current = nodes[current].container) {
    if (set.has(current)) return true;
  }
  return false;
}

export function diffPageSnapshots(
  before: PageSnapshot,
  after: PageSnapshot,
  refOf: (afterIndex: number) => string,
): Pick<PageChanges, "changes" | "text" | "omitted"> {
  const matchOf = new Map<number, number>();
  const renamed = new Set<number>();

  // Identical role, name and scope pair up in document order, so swapped DOM nodes still match.
  const queues = new Map<string, number[]>();
  before.nodes.forEach((node, index) => {
    const key = `${node.role}\u0000${node.name}\u0000${node.scope}`;
    const queue = queues.get(key);
    if (queue) queue.push(index);
    else queues.set(key, [index]);
  });
  after.nodes.forEach((node, index) => {
    const match = queues.get(`${node.role}\u0000${node.name}\u0000${node.scope}`)?.shift();
    if (match !== undefined) matchOf.set(index, match);
  });

  // A non-container left unmatched on both sides at the same role position was renamed.
  const matchedBefore = new Set(matchOf.values());
  const beforeRanks = sameRoleRanks(before.nodes);
  const afterRanks = sameRoleRanks(after.nodes);
  const unmatchedBefore = new Map<string, number>();
  before.nodes.forEach((node, index) => {
    if (!matchedBefore.has(index) && !PAGE_CONTAINER_ROLES.has(node.role)) {
      unmatchedBefore.set(`${node.role}\u0000${node.scope}\u0000${beforeRanks[index]}`, index);
    }
  });
  after.nodes.forEach((node, index) => {
    if (matchOf.has(index) || PAGE_CONTAINER_ROLES.has(node.role)) return;
    const key = `${node.role}\u0000${node.scope}\u0000${afterRanks[index]}`;
    const match = unmatchedBefore.get(key);
    if (match === undefined) return;
    unmatchedBefore.delete(key);
    matchOf.set(index, match);
    matchedBefore.add(match);
    renamed.add(index);
  });

  const added = new Set(after.nodes.map((_, index) => index).filter((index) => !matchOf.has(index)));
  const removed = new Set(before.nodes.map((_, index) => index).filter((index) => !matchedBefore.has(index)));
  // Entries keep after-snapshot indices until the cap is applied, so only reported elements get refs.
  const entries: Array<{ change: PageChange; index?: number; within?: number }> = [];

  after.nodes.forEach((node, index) => {
    if (added.has(index)) {
      let within: number | undefined;
      for (let current = node.container; current !== null; current = after.nodes[current].container) {
        if (added.has(current)) within = current;
      }
      entries.push({ change: { kind: "added", ref: null, role: node.role, name: node.name }, index, within });
      return;
    }
    const previous = before.nodes[matchOf.get(index) as number];
    const base = { kind: "changed" as const, ref: null, role: node.role, name: node.name };
    if (renamed.has(index)) {
      entries.push({ change: { ...base, property: "name", from: previous.name, to: node.name }, index });
    }
    for (const property of STATE_PROPERTIES) {
      if (previous.state[property] !== node.state[property]) {
        entries.push({ change: { ...base, property, from: previous.state[property], to: node.state[property] }, index });
      }
    }
    if (previous.valueHash !== node.valueHash) {
      const change: PageChange = previous.sensitive || node.sensitive
        ? { ...base, property: "value", redacted: true }
        : { ...base, property: "value", from: previous.value ?? null, to: node.value ?? null };
      entries.push({ change, index });
    }
  });

  // Contents of a removed dialog or landmark are implied by its own removal entry.
  before.nodes.forEach((node, index) => {
    if (removed.has(index) && !hasAncestorIn(before.nodes, index, removed)) {
      entries.push({ change: { kind: "removed", ref: null, role: node.role, name: node.name } });
    }
  });

  const text: PageChanges["text"] = [];
  for (const region of new Set([...Object.keys(after.text), ...Object.keys(before.text)])) {
    const beforeCounts = before.text[region] || {};
    const afterCounts = after.text[region] || {};
    let addedText = 0;
    let removedText = 0;
    for (const hash of new Set([...Object.keys(beforeCounts), ...Object.keys(afterCounts)])) {
      const delta = (afterCounts[hash] || 0) - (beforeCounts[hash] || 0);
      if (delta > 0) addedText += delta;
      else removedText -= delta;
    }
    if (addedText || removedText) text.push({ region, added: addedText, removed: removedText });
  }

  return {
    changes: entries.slice(0, PAGE_CHANGES_CAP).map(({ change, index, within }) => ({
      ...change,
      ref: index === undefined ? null : refOf(index),
      ...(within === undefined ? {} : { within: refOf(within) }),
    })),
    text,
    omitted: Math.max(0, entries.length - PAGE_CHANGES_CAP),
  };
}
