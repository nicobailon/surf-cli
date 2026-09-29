// Page change formatter for surf-cli action output

const STATE_WORDS = {
  checked: ["checked", "unchecked"],
  disabled: ["disabled", "enabled"],
  expanded: ["expanded", "collapsed"],
  selected: ["selected", "unselected"],
  pressed: ["pressed", "not pressed"],
};

function show(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function label(change) {
  return [change.ref, change.role, change.name ? JSON.stringify(change.name) : null].filter(Boolean).join(" ");
}

function describeChange(change) {
  const words = STATE_WORDS[change.property];
  if (words && typeof change.to === "boolean") return `now ${words[change.to ? 0 : 1]}`;
  if (change.redacted) return `${change.property} changed`;
  return `${change.property} ${show(change.from)} -> ${show(change.to)}`;
}

function formatPageChanges(pageChanges) {
  const { settle, navigated, changes, text, omitted } = pageChanges;
  if (navigated) {
    return [`navigated: ${navigated.from} -> ${navigated.to}${navigated.title ? ` ${JSON.stringify(navigated.title)}` : ""}`];
  }

  const settleText = settle.state === "settled"
    ? `settled in ${settle.ms}ms`
    : settle.state === "quiet" ? `quiet ${settle.ms}ms` : `still changing after ${settle.ms}ms`;
  const textLines = text
    .filter((entry) => entry.added > 0 || entry.removed > 0)
    .map((entry) => `  ${entry.region}: ${[entry.added > 0 ? `+${entry.added}` : null, entry.removed > 0 ? `-${entry.removed}` : null].filter(Boolean).join(" ")} text`);
  if (changes.length === 0 && textLines.length === 0 && omitted === 0) {
    return [`no visible change (${settleText})`];
  }

  const lines = [settle.state === "unsettled" ? `${settleText} (partial):` : `changed (${settleText}):`];
  // Nested groups (a dialog inside an added landmark) flatten under the outermost added container.
  const added = new Map(changes.filter((change) => change.kind === "added" && change.ref).map((change) => [change.ref, change]));
  const groupOf = new Map();
  for (const change of changes) {
    if (change.kind !== "added") continue;
    let root = null;
    const seen = new Set();
    for (let current = change; added.has(current.within) && !seen.has(current.within); current = root) {
      seen.add(current.within);
      root = added.get(current.within);
    }
    if (root) groupOf.set(change, root);
  }
  const groups = new Set(groupOf.values());
  for (const change of changes) {
    if (groupOf.has(change)) continue;
    if (groups.has(change)) {
      lines.push(`  + ${change.role}${change.name ? ` ${JSON.stringify(change.name)}` : ""}`);
      for (const member of changes) {
        if (groupOf.get(member) === change) lines.push(`      ${label(member)}`);
      }
    } else if (change.kind === "added") {
      lines.push(`  + ${label(change)}`);
    } else if (change.kind === "changed") {
      lines.push(`  ~ ${label(change)}  ${describeChange(change)}`);
    } else {
      lines.push(`  - ${label(change)}`);
    }
  }
  lines.push(...textLines);
  if (omitted > 0) lines.push(`+${omitted} more changes. Run surf read`);
  return lines;
}

module.exports = { formatPageChanges };
