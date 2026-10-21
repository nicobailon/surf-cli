// Scroll-and-harvest for virtualized lists: read the visible items each round, merge by key on
// the host (so a page reload does not lose records), stop when scrolling stops adding items.

const { filterRecords } = require("./records.cjs");

const COLLECT_KEYS = ["open", "item", "key", "fields", "maxItems", "idleRounds", "scrollDelayMs", "expand", "keep"];
const FIELD_KEYS = ["selector", "attr", "all", "match", "template"];
const ITEM_WAIT_MS = 20000;
const OUTPUT_LIMIT = 50000;

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** DOM field spec: "sel", "sel@attr", "sel@attr[]", "sel[]", ":scope", or { selector, attr?, all?, match?, template? }. */
function parseDomField(spec, where) {
  if (typeof spec === "string") {
    const all = spec.endsWith("[]");
    const text = all ? spec.slice(0, -2) : spec;
    const withAttr = text.match(/^(.*?)@([a-zA-Z_:][-a-zA-Z0-9_:.]*)$/);
    const selector = withAttr ? withAttr[1] : text;
    if (!selector.trim()) throw new Error(`${where} needs a selector`);
    return { selector, ...(withAttr ? { attr: withAttr[2] } : {}), ...(all ? { all } : {}) };
  }
  if (!isPlainObject(spec)) throw new Error(`${where} must be a string or an object`);
  for (const key of Object.keys(spec)) {
    if (!FIELD_KEYS.includes(key)) throw new Error(`${where} has unknown key "${key}" (allowed: ${FIELD_KEYS.join(", ")})`);
  }
  if (spec.template !== undefined) {
    if (typeof spec.template !== "string" || Object.keys(spec).length !== 1) throw new Error(`${where}.template must be a string used alone`);
    return { template: spec.template };
  }
  if (typeof spec.selector !== "string" || !spec.selector.trim()) throw new Error(`${where} needs a selector`);
  if (spec.attr !== undefined && (typeof spec.attr !== "string" || !spec.attr)) throw new Error(`${where}.attr must be a string`);
  if (spec.all !== undefined && typeof spec.all !== "boolean") throw new Error(`${where}.all must be a boolean`);
  if (spec.match !== undefined) {
    if (typeof spec.match !== "string") throw new Error(`${where}.match must be a regex string`);
    try {
      new RegExp(spec.match);
    } catch (error) {
      throw new Error(`${where}.match is not a valid regex: ${error.message}`);
    }
  }
  return { ...spec };
}

function optionalInteger(value, name, min) {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < min) throw new Error(`${name} must be an integer >= ${min}`);
  return value;
}

function validateCollectSpec(spec) {
  if (!isPlainObject(spec)) throw new Error("collect must be an object");
  for (const key of Object.keys(spec)) {
    if (!COLLECT_KEYS.includes(key)) throw new Error(`collect has unknown key "${key}" (allowed: ${COLLECT_KEYS.join(", ")})`);
  }
  if (typeof spec.item !== "string" || !spec.item.trim()) throw new Error("collect needs an item selector");
  if (spec.key === undefined) throw new Error("collect needs a key");
  if (!isPlainObject(spec.fields) || Object.keys(spec.fields).length === 0) throw new Error("collect fields must map at least one field");
  if (spec.expand !== undefined && (typeof spec.expand !== "string" || !spec.expand.trim())) throw new Error("collect expand must be a selector");
  if (spec.open !== undefined && (typeof spec.open !== "string" || !spec.open)) throw new Error("collect open must be a URL");
  if (spec.keep !== undefined) filterRecords([], spec.keep);
  return {
    open: spec.open,
    item: spec.item,
    key: parseDomField(spec.key, "collect key"),
    fields: Object.fromEntries(Object.entries(spec.fields).map(([name, field]) => [name, parseDomField(field, `collect field ${name}`)])),
    maxItems: optionalInteger(spec.maxItems, "collect maxItems", 1) ?? 500,
    idleRounds: optionalInteger(spec.idleRounds, "collect idleRounds", 1) ?? 3,
    scrollDelayMs: optionalInteger(spec.scrollDelayMs, "collect scrollDelayMs", 0) ?? 800,
    expand: spec.expand,
    keep: spec.keep,
  };
}

// Runs in the page. Reads unseen items, then scrolls the last item to the top for the next round.
function roundScript(spec, seenKeys) {
  const input = JSON.stringify({ item: spec.item, key: spec.key, fields: spec.fields, expand: spec.expand, seen: seenKeys });
  return `(async () => {
const spec = ${input};
// Background tabs and minimized windows do not render virtualized lists.
if (document.visibilityState === "hidden") return { hidden: true };
const seen = new Set(spec.seen);
// Dotted field names ("quoted.text") build nested objects.
const assign = (record, name, value) => {
  if (value === undefined) return;
  const parts = name.split(".");
  let node = record;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  node[parts[parts.length - 1]] = value;
};
const pick = (item, field, record) => {
  if (field.template !== undefined) {
    let missing = false;
    const text = field.template.replace(/\\{\\{([a-zA-Z0-9._-]+)\\}\\}/g, (_, name) => {
      const value = name.split(".").reduce((node, part) => (node == null ? undefined : node[part]), record);
      if (value === undefined || value === null) missing = true;
      return String(value);
    });
    return missing ? undefined : text;
  }
  const elements = field.selector === ":scope" ? [item] : field.all ? [...item.querySelectorAll(field.selector)] : [item.querySelector(field.selector)].filter(Boolean);
  const read = (element) => {
    if (!field.attr) return element.innerText.trim();
    const property = element[field.attr];
    return typeof property === "string" ? property : element.getAttribute(field.attr) ?? undefined;
  };
  const apply = (value) => {
    if (!field.match || typeof value !== "string") return value;
    const found = value.match(new RegExp(field.match));
    return found ? (found.length > 1 ? found[1] : found[0]) : undefined;
  };
  if (field.all) {
    const values = elements.map(read).map(apply).filter((value) => value !== undefined && value !== null);
    return values.length ? values : undefined;
  }
  return elements.length ? apply(read(elements[0])) : undefined;
};
if (spec.expand) {
  const clicked = [];
  for (const item of document.querySelectorAll(spec.item)) {
    for (const element of item.querySelectorAll(spec.expand)) {
      const isButton = element.tagName === "BUTTON" || element.getAttribute("role") === "button";
      if (!isButton || element.closest('a[href], [role="link"]') || element.dataset.surfExpanded) continue;
      element.dataset.surfExpanded = "1";
      element.click();
      clicked.push(element);
    }
  }
  // Wait (bounded) for the page to replace the expanders with the full content before reading.
  const deadline = Date.now() + 2000;
  while (clicked.some((element) => element.isConnected) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
const items = [...document.querySelectorAll(spec.item)];
const records = [];
for (const item of items) {
  const record = {};
  const templates = [];
  for (const [name, field] of Object.entries(spec.fields)) {
    if (field.template !== undefined) templates.push([name, field]);
    else assign(record, name, pick(item, field, record));
  }
  for (const [name, field] of templates) assign(record, name, pick(item, field, record));
  const key = pick(item, spec.key, record);
  if (key === undefined || key === null || key === "") continue;
  const id = JSON.stringify(key);
  if (seen.has(id)) continue;
  seen.add(id);
  records.push({ id, record });
}
if (items.length) items[items.length - 1].scrollIntoView({ block: "start" });
else window.scrollBy(0, window.innerHeight);
return { records };
})()`;
}

/** Background tabs and minimized windows neither render virtualized lists nor load more on scroll. */
function hiddenTabError(what = "collect") {
  return new Error(
    `${what} needs a visible tab: this tab is hidden (a background tab or a minimized window), so the page does not render or load its list. ` +
      "Use a session with its own focused window (surf session.ensure <name> <url> --window --focused) or bring the tab to the front.",
  );
}

/** Collects records from a virtualized list. Returns records in first-seen order, deduped by key. */
async function runCollect({ spec, executeTool, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) }) {
  const options = validateCollectSpec(spec);
  if (options.open) await executeTool("navigate", { url: options.open });
  const visibility = await executeTool("javascript_tool", { code: "document.visibilityState" });
  if (visibility?.output === '"hidden"') throw hiddenTabError();
  await executeTool("wait.element", { selector: options.item, timeout: ITEM_WAIT_MS });
  const byKey = new Map();
  let idle = 0;
  while (byKey.size < options.maxItems && idle < options.idleRounds) {
    const result = await executeTool("javascript_tool", { code: roundScript(options, [...byKey.keys()]) });
    let round;
    try {
      round = JSON.parse(result?.output);
    } catch {
      const size = typeof result?.output === "string" ? result.output.length : 0;
      throw new Error(
        size >= OUTPUT_LIMIT
          ? `collect round output reached the ${OUTPUT_LIMIT}-character script limit; narrow the fields`
          : "collect round returned no records",
      );
    }
    if (round?.hidden === true) throw hiddenTabError();
    if (!Array.isArray(round?.records)) throw new Error("collect round returned no records");
    let added = 0;
    for (const { id, record } of round.records) {
      if (byKey.has(id) || byKey.size >= options.maxItems) continue;
      byKey.set(id, record);
      added++;
    }
    idle = added ? 0 : idle + 1;
    if (byKey.size < options.maxItems && idle < options.idleRounds) await sleep(options.scrollDelayMs);
  }
  return filterRecords([...byKey.values()], options.keep);
}

module.exports = { hiddenTabError, runCollect, validateCollectSpec };
