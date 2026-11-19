// --where, --fields and --limit on surf use and pb test: applied in the CLI to the records a run
// returned. A field is a dotted path (stock.count); --fields keeps dotted ones as nested objects.

const FILTER_FLAGS = ["where", "fields", "limit"];
const WHERE_USAGE = "--where needs field=value, field!=value or field~=text";

/** Every --where's text, and the last --fields and --limit, as typed. */
function collectFilterFlags(argv) {
  const flags = { where: [] };
  argv.forEach((token, index) => {
    const name = token.startsWith("--") ? token.slice(2) : undefined;
    if (!FILTER_FLAGS.includes(name)) return;
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${name} needs a value`);
    if (name === "where") flags.where.push(value);
    else flags[name] = value;
  });
  return flags;
}

const hasFilter = (flags) => flags.where.length > 0 || flags.fields !== undefined || flags.limit !== undefined;

function parseWhere(text) {
  const at = text.indexOf("=");
  if (at < 0) throw new Error(`${WHERE_USAGE}, not "${text}"`);
  const op = ["!", "~"].includes(text[at - 1]) ? `${text[at - 1]}=` : "=";
  const field = text.slice(0, at - (op.length - 1)).trim();
  if (!field) throw new Error(`--where needs a field before ${op}, not "${text}"`);
  return { text, field, op, value: text.slice(at + 1).trim() };
}

/** The checked filter; `fields` and `limit` are null when not given. */
function parseFilter({ where, fields, limit }) {
  const parsed = { where: where.map(parseWhere), fields: null, limit: null };
  if (fields !== undefined) {
    parsed.fields = String(fields).split(",").map((field) => field.trim()).filter(Boolean);
    if (parsed.fields.length === 0) throw new Error("--fields needs field names, such as title,price");
  }
  if (limit !== undefined) {
    const text = String(limit).trim();
    if (!/^\d+$/.test(text) || Number(text) < 1) throw new Error(`--limit must be a whole number of 1 or more, not "${limit}"`);
    parsed.limit = Number(text);
  }
  return parsed;
}

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);

/** A record's fields, each object's own fields after it, dotted. */
function fieldPaths(record, prefix = "") {
  return Object.entries(record).flatMap(([key, value]) => {
    const name = `${prefix}${key}`;
    return [name, ...(isObject(value) ? fieldPaths(value, `${name}.`) : [])];
  });
}

function lookup(record, field) {
  let value = record;
  for (const key of field.split(".")) {
    if (!isObject(value) || !Object.hasOwn(value, key)) return { found: false };
    value = value[key];
  }
  return { found: true, value };
}

const asText = (value) => (value === null || value === undefined ? "" : typeof value === "object" ? JSON.stringify(value) : String(value)).trim();

function matches(record, { field, op, value }) {
  const found = lookup(record, field);
  const text = found.found ? asText(found.value) : "";
  if (op === "=") return text === value;
  if (op === "!=") return text !== value;
  return text.toLowerCase().includes(value.toLowerCase());
}

function project(record, fields) {
  const kept = {};
  for (const field of fields) {
    const found = lookup(record, field);
    if (!found.found) continue;
    const keys = field.split(".");
    let target = kept;
    for (const key of keys.slice(0, -1)) target = target[key] ??= {};
    target[keys.at(-1)] = found.value;
  }
  return kept;
}

/**
 * The filtered value and its summary. A list stays a list; a single object stays an object, or
 * null when --where drops it. An unknown field fails, listing the first record's fields.
 */
function applyFilter(value, filter) {
  const single = isObject(value);
  if (!single && !Array.isArray(value) && value !== null) throw new Error(`--where, --fields and --limit work on records (a list or an object); this op returned ${typeof value === "string" ? "text" : `a ${typeof value}`}`);
  let records = single ? [value] : value || [];
  const before = records.length;
  const first = records[0];
  const named = [...filter.where.map((where) => ({ flag: "--where", field: where.field })), ...(filter.fields || []).map((field) => ({ flag: "--fields", field }))];
  if (first !== undefined && named.length > 0) {
    if (!isObject(first)) throw new Error("--where and --fields need records that are objects");
    const valid = fieldPaths(first);
    const unknown = named.find(({ field }) => !valid.includes(field));
    if (unknown) throw new Error(`${unknown.flag}: unknown field "${unknown.field}". Fields: ${valid.join(", ")}`);
  }
  records = records.filter((record) => filter.where.every((where) => matches(record, where)));
  if (filter.limit !== null) records = records.slice(0, filter.limit);
  if (filter.fields) {
    // A field inside another one asked for comes with it.
    const fields = filter.fields.filter((field) => !filter.fields.some((other) => field.startsWith(`${other}.`)));
    records = records.map((record) => project(record, fields));
  }
  const summary = { where: filter.where.map((where) => where.text), fields: filter.fields, limit: filter.limit, before, after: records.length };
  return { value: single ? (records[0] ?? null) : records, filter: summary };
}

/** The filter flags, as they'd be typed again: `--where a=1 --fields a,b --limit 3`. */
function filterText({ where, fields, limit }) {
  return [...where.map((text) => `--where ${text}`), ...(fields ? [`--fields ${fields.join(",")}`] : []), ...(limit !== null ? [`--limit ${limit}`] : [])].join(" ");
}

/**
 * The filter for a run of `op` (undefined when the op isn't on this machine), taking out of `args`
 * the flags that are filters. A flag the op declares as an input stays its input. --limit is a filter
 * only when the op is known here and has no limit input, and never with --each (it caps the records looped over).
 */
function takeRunFilter({ flags, args, ops, each }) {
  const takes = (name) => ops.some((op) => Object.hasOwn(op.args || {}, name));
  const known = ops.length > 0;
  const given = { where: [] };
  if (flags.where.length > 0 && !takes("where")) given.where = flags.where;
  if (flags.fields !== undefined && !takes("fields")) given.fields = flags.fields;
  if (flags.limit !== undefined && known && !each && !takes("limit")) given.limit = flags.limit;
  for (const name of FILTER_FLAGS) if (name === "where" ? given.where.length > 0 : given[name] !== undefined) delete args[name];
  return hasFilter(given) ? parseFilter(given) : undefined;
}

module.exports = { applyFilter, collectFilterFlags, filterText, parseFilter, takeRunFilter };
