// Maps third-party JSON into records. Missing data reads as undefined; malformed specs throw.

const { isDeepStrictEqual } = require("node:util");
// Field match patterns come from op files: each run is bounded, and one extract's runs share a budget.
const { EXTRACT_REGEX_BUDGET_MS, boundedExec, checkPattern, createRegexBudget } = require("./bounded-regex.cjs");

const SEGMENT = /^([^[\]\s?*]*)((?:\[(?:\d+|\*)\])*)$/;
const TEMPLATE_NAME = /\{\{([a-zA-Z0-9._-]+)\}\}/g;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
// ISO 8601 date-time with an explicit zone, e.g. 2024-01-01T10:00:00.000Z or 2024-01-01T12:00+02:00.
const ISO_DATETIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:\d{2})$/;
// X's created_at, e.g. Mon Jan 01 10:00:00 +0000 2024.
const X_DATETIME = new RegExp(
  `^(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat) (${MONTHS.join("|")}) (\\d{2}) (\\d{2}):(\\d{2}):(\\d{2}) ([+-]\\d{4}) (\\d{4})$`,
);

// Output field names build objects, so these segments could reach Object.prototype.
const RESERVED_SEGMENTS = ["__proto__", "constructor", "prototype"];

function assertFieldName(name, where) {
  if (name.split(".").some((part) => RESERVED_SEGMENTS.includes(part))) {
    throw new Error(`${where} name "${name}" uses a reserved segment (${RESERVED_SEGMENTS.join(", ")})`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function checkKeys(value, allowed, where) {
  if (!isPlainObject(value)) throw new Error(`${where} must be an object`);
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new Error(`${where} has unknown key "${key}" (allowed: ${allowed.join(", ")})`);
  }
}

function parseAlternative(text, source) {
  if (!text) throw new Error(`invalid path "${source}": empty alternative`);
  const steps = [];
  for (const segment of text.split(".")) {
    const parsed = segment.match(SEGMENT);
    if (!parsed || !segment) throw new Error(`invalid path "${source}": bad segment "${segment}"`);
    if (parsed[1]) steps.push({ key: parsed[1] });
    for (const [, index] of parsed[2].matchAll(/\[(\d+|\*)\]/g)) {
      steps.push(index === "*" ? { all: true } : { index: Number(index) });
    }
  }
  return steps;
}

function walk(value, steps, start) {
  let current = value;
  for (let i = start; i < steps.length; i++) {
    const step = steps[i];
    if (step.all) {
      if (!Array.isArray(current)) return undefined;
      const out = [];
      for (const item of current) {
        const result = walk(item, steps, i + 1);
        if (Array.isArray(result)) out.push(...result);
        else if (result !== undefined) out.push(result);
      }
      return out;
    }
    if (step.index !== undefined) {
      if (!Array.isArray(current)) return undefined;
      current = current[step.index];
    } else {
      if (!isPlainObject(current) || !Object.hasOwn(current, step.key)) return undefined;
      current = current[step.key];
    }
  }
  return current;
}

function compilePath(source) {
  if (typeof source !== "string" || !source.trim()) throw new Error(`invalid path ${JSON.stringify(source)}`);
  const alternatives = source.split("??").map((alt) => parseAlternative(alt.trim(), source));
  return (value) => {
    let result;
    for (const steps of alternatives) {
      result = walk(value, steps, 0);
      if (result !== undefined && result !== null) return result;
    }
    return result;
  };
}

function getPath(value, path) {
  return compilePath(path)(value);
}

function compileFind(find, where = "find") {
  checkKeys(find, ["exists", "equals"], where);
  const exists = find.exists ?? [];
  const equals = find.equals ?? {};
  if (!Array.isArray(exists)) throw new Error(`${where}.exists must be an array of paths`);
  if (!isPlainObject(equals)) throw new Error(`${where}.equals must be an object`);
  if (exists.length === 0 && Object.keys(equals).length === 0) throw new Error(`${where} needs exists or equals`);
  const required = exists.map(compilePath);
  const expected = Object.entries(equals).map(([path, value]) => [compilePath(path), value]);
  return (object) =>
    required.every((get) => get(object) !== undefined) &&
    expected.every(([get, value]) => isDeepStrictEqual(get(object), value));
}

function collectMatches(node, test, out) {
  if (Array.isArray(node)) {
    for (const item of node) collectMatches(item, test, out);
  } else if (isPlainObject(node)) {
    if (test(node)) out.push(node);
    else for (const value of Object.values(node)) collectMatches(value, test, out);
  }
  return out;
}

function findObjects(doc, find) {
  return collectMatches(doc, compileFind(find), []);
}

function compileTemplate(template, where) {
  if (typeof template !== "string") throw new Error(`${where}.template must be a string`);
  const names = [...template.matchAll(TEMPLATE_NAME)].map(([, name]) => [name, compilePath(name)]);
  return (record) => {
    const values = new Map();
    for (const [name, get] of names) {
      const value = get(record);
      if (value === undefined || value === null) return undefined;
      values.set(name, String(value));
    }
    return template.replace(TEMPLATE_NAME, (_, name) => values.get(name));
  };
}

/** ISO 8601 UTC for the two accepted shapes; undefined for anything else, including impossible dates. */
function toDatetime(value) {
  if (typeof value !== "string") return undefined;
  // X's form becomes ISO: Mon Jan 01 10:00:00 +0000 2024 -> 2024-01-01T10:00:00+00:00.
  const x = value.match(X_DATETIME);
  const month = x && String(MONTHS.indexOf(x[1]) + 1).padStart(2, "0");
  const text = x ? `${x[7]}-${month}-${x[2]}T${x[3]}:${x[4]}:${x[5]}${x[6].slice(0, 3)}:${x[6].slice(3)}` : value;
  const iso = text.match(ISO_DATETIME);
  if (!iso) return undefined;
  // Date.parse rolls Feb 30 over to Mar 1 and reads hour 24 as the next day; V8 rejects the other out-of-range fields.
  const [, year, mm, day, hour] = iso;
  if (new Date(Date.UTC(year, mm - 1, day)).getUTCDate() !== Number(day) || Number(hour) > 23) return undefined;
  const time = Date.parse(text);
  return Number.isNaN(time) ? undefined : new Date(time).toISOString();
}

function compileField(spec, where) {
  if (typeof spec === "string") return compilePath(spec);
  checkKeys(spec, ["path", "match", "fields", "as"], where);
  if (typeof spec.path !== "string") throw new Error(`${where} needs a path or a template`);
  if (spec.match !== undefined && spec.fields !== undefined) throw new Error(`${where} cannot combine match and fields`);
  if (spec.as !== undefined) {
    if (spec.as !== "datetime") throw new Error(`${where}.as must be "datetime"`);
    if (spec.fields !== undefined) throw new Error(`${where} cannot combine as and fields`);
    if (spec.path.includes("[*]")) throw new Error(`${where}.as needs a single value, not a [*] path`);
  }
  const get = compilePath(spec.path);
  let read = get;
  if (spec.match !== undefined) {
    const label = `${where}.match`;
    checkPattern(spec.match, label);
    read = (object, budget) => {
      const value = get(object);
      const found = typeof value === "string" ? boundedExec({ pattern: spec.match, text: value, budget, label }) : null;
      if (!found) return undefined;
      return found.length > 1 ? found[1] : found[0];
    };
  }
  if (spec.fields !== undefined) {
    const map = compileFields(spec.fields, `${where}.fields`);
    return (object, budget) => {
      const value = get(object);
      if (Array.isArray(value)) return value.filter(isPlainObject).map((item) => map(item, budget));
      return isPlainObject(value) ? map(value, budget) : undefined;
    };
  }
  return spec.as === undefined ? read : (object, budget) => toDatetime(read(object, budget));
}

function compileFields(fields, where) {
  if (!isPlainObject(fields) || Object.keys(fields).length === 0) throw new Error(`${where} must map at least one field`);
  const paths = [];
  const templates = [];
  for (const [name, spec] of Object.entries(fields)) {
    assertFieldName(name, "field");
    if (isPlainObject(spec) && spec.template !== undefined) {
      checkKeys(spec, ["template"], `${where}.${name}`);
      templates.push([name, compileTemplate(spec.template, `${where}.${name}`)]);
    } else {
      paths.push([name, compileField(spec, `${where}.${name}`)]);
    }
  }
  return (object, budget) => {
    const record = {};
    for (const [name, get] of paths) {
      const value = get(object, budget);
      if (value !== undefined) record[name] = value;
    }
    for (const [name, render] of templates) {
      const value = render(record);
      if (value !== undefined) record[name] = value;
    }
    return record;
  };
}

/** `keep` values: "@first" = the first record's value for that field; anything else is a literal. */
function filterRecords(records, keep) {
  if (keep === undefined) return records;
  if (!isPlainObject(keep)) throw new Error("keep must be an object");
  const rules = Object.entries(keep).map(([field, value]) => {
    const get = compilePath(field);
    return [get, value === "@first" ? (records.length ? get(records[0]) : undefined) : value];
  });
  return records.filter((record) => rules.every(([get, value]) => isDeepStrictEqual(get(record), value)));
}

/** Collects records across pages: dedupes by key (first seen wins), applies `keep` on read. */
function createRecordSet(spec) {
  checkKeys(spec, ["find", "key", "fields", "keep"], "records");
  if (spec.find === undefined) throw new Error("records needs find");
  if (spec.key === undefined) throw new Error("records needs key");
  const test = compileFind(spec.find, "records.find");
  const getKey = compilePath(spec.key);
  const map = compileFields(spec.fields, "records.fields");
  if (spec.keep !== undefined) filterRecords([], spec.keep);
  const byKey = new Map();
  return {
    add(doc) {
      const budget = extractBudget();
      let added = 0;
      for (const object of collectMatches(doc, test, [])) {
        const key = getKey(object);
        if (key === undefined || key === null) {
          throw new Error(`records key "${spec.key}" is missing on a matched object; add it to find.exists`);
        }
        const id = JSON.stringify(key);
        if (byKey.has(id)) continue;
        byKey.set(id, map(object, budget));
        added++;
      }
      return added;
    },
    records() {
      return filterRecords([...byKey.values()], spec.keep);
    },
  };
}

function readCursor(doc, cursor) {
  checkKeys(cursor, ["find", "path", "into"], "cursor");
  const get = compilePath(cursor.path);
  const [first] = collectMatches(doc, compileFind(cursor.find, "cursor.find"), []);
  return first === undefined ? undefined : get(first);
}

/** "$", "$.data.items" or "$[0].title" as a path for compilePath; "" is the document itself. */
function fromJsonPath(source, where) {
  const usage = `${where} must be $, $.path or $[n]..., such as $.data.items (got ${JSON.stringify(source)})`;
  if (typeof source !== "string" || !/^\$(?:$|\.[^.]|\[)/.test(source)) throw new Error(usage);
  const path = source.slice(1).replace(/^\./, "");
  if (path) {
    try {
      compilePath(path);
    } catch {
      throw new Error(usage);
    }
  }
  return path;
}

function compileJsonPath(source, where) {
  const path = fromJsonPath(source, where);
  return path ? compilePath(path) : (value) => value;
}

function extractBudget() {
  return createRegexBudget({ ms: EXTRACT_REGEX_BUDGET_MS, scope: "extract" });
}

/**
 * A playbook extract over JSON: `records` picks the array, `filter` keeps records whose path equals
 * a value (compared as text), `fields` maps output names to paths. Without `records`, `fields` maps
 * the whole document. Malformed specs throw when compiled. A call's field match patterns share
 * `regexBudget`, a fresh 2 s one when not given.
 */
function compileJsonExtract({ records, fields, filter }) {
  const getRecords = records === undefined ? undefined : compileJsonPath(records, "records");
  const map = fields === undefined ? undefined : compileFields(fields, "fields");
  let rules;
  if (filter !== undefined) {
    if (!isPlainObject(filter) || Object.keys(filter).length === 0) throw new Error("filter must map a path to a value");
    rules = Object.entries(filter).map(([path, value]) => [compilePath(path), String(value)]);
  }
  return (doc, { regexBudget = extractBudget() } = {}) => {
    const mapRecord = (record) => map(record, regexBudget);
    let value = doc;
    if (getRecords) {
      value = getRecords(doc);
      if (!Array.isArray(value)) throw new Error(`extract records ${records} is not an array (found ${value === null ? "null" : typeof value})`);
    }
    if (rules) {
      if (!Array.isArray(value)) throw new Error("extract filter needs an array of records");
      value = value.filter((record) => rules.every(([get, expected]) => {
        const found = get(record);
        return found !== undefined && found !== null && String(found) === expected;
      }));
    }
    if (!map) return value;
    if (Array.isArray(value)) return value.map((record) => (isPlainObject(record) ? mapRecord(record) : record));
    return isPlainObject(value) ? mapRecord(value) : value;
  };
}

function extractRecords(doc, spec, options) {
  return compileJsonExtract(spec)(doc, options);
}

module.exports = { assertFieldName, compileJsonExtract, compileJsonPath, createRecordSet, extractRecords, filterRecords, findObjects, getPath, readCursor };
