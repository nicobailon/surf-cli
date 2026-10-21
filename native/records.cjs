// Maps third-party JSON into records. Missing data reads as undefined; malformed specs throw.

const { isDeepStrictEqual } = require("node:util");

const SEGMENT = /^([^[\]\s?*]*)((?:\[(?:\d+|\*)\])*)$/;
const TEMPLATE_NAME = /\{\{([a-zA-Z0-9._-]+)\}\}/g;

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

function compileField(spec, where) {
  if (typeof spec === "string") return compilePath(spec);
  checkKeys(spec, ["path", "match", "fields"], where);
  if (typeof spec.path !== "string") throw new Error(`${where} needs a path or a template`);
  if (spec.match !== undefined && spec.fields !== undefined) throw new Error(`${where} cannot combine match and fields`);
  const get = compilePath(spec.path);
  if (spec.match !== undefined) {
    if (typeof spec.match !== "string") throw new Error(`${where}.match must be a regex string`);
    let regex;
    try {
      regex = new RegExp(spec.match);
    } catch (error) {
      throw new Error(`${where}.match is not a valid regex: ${error.message}`);
    }
    return (object) => {
      const value = get(object);
      const found = typeof value === "string" ? value.match(regex) : null;
      if (!found) return undefined;
      return found.length > 1 ? found[1] : found[0];
    };
  }
  if (spec.fields !== undefined) {
    const map = compileFields(spec.fields, `${where}.fields`);
    return (object) => {
      const value = get(object);
      if (Array.isArray(value)) return value.filter(isPlainObject).map(map);
      return isPlainObject(value) ? map(value) : undefined;
    };
  }
  return get;
}

function compileFields(fields, where) {
  if (!isPlainObject(fields) || Object.keys(fields).length === 0) throw new Error(`${where} must map at least one field`);
  const paths = [];
  const templates = [];
  for (const [name, spec] of Object.entries(fields)) {
    if (isPlainObject(spec) && spec.template !== undefined) {
      checkKeys(spec, ["template"], `${where}.${name}`);
      templates.push([name, compileTemplate(spec.template, `${where}.${name}`)]);
    } else {
      paths.push([name, compileField(spec, `${where}.${name}`)]);
    }
  }
  return (object) => {
    const record = {};
    for (const [name, get] of paths) {
      const value = get(object);
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
      let added = 0;
      for (const object of collectMatches(doc, test, [])) {
        const key = getKey(object);
        if (key === undefined || key === null) {
          throw new Error(`records key "${spec.key}" is missing on a matched object; add it to find.exists`);
        }
        const id = JSON.stringify(key);
        if (byKey.has(id)) continue;
        byKey.set(id, map(object));
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

module.exports = { createRecordSet, filterRecords, findObjects, getPath, readCursor };
