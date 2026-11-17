// A playbook strategy's `extract`: what `surf use` returns instead of the raw result.
//   { jsonPath } or { field }            one value (the original forms)
//   { html: { item, fields } }           records from HTML, with collect's field specs
//   { html: { value } }                  one value from HTML
//   { records?, fields?, filter? }       records from JSON (paths as in records.cjs)
//   { embedded, jsonPath | records… }    the same, from JSON the HTML page embeds (embedded-json.cjs)
// `surf pb extract` sets it on an op and saves the op.

const { parseHtmlExtract } = require("./dom-collect.cjs");
const { parseEmbeddedSpec } = require("./embedded-json.cjs");
const { compileJsonExtract } = require("./records.cjs");
const { lineDiff } = require("./text-diff.cjs");

const EXTRACT_KEYS = ["jsonPath", "field", "html", "embedded", "records", "fields", "filter"];
const HTML_STRATEGIES = ["network", "workflow"];
const USAGE =
  "Usage: surf pb extract <playbook> <op> (--item <css> --field name=<selector>[@attr]... | --value <selector>[@attr] | [--embedded <css> [--ld-type <type>] | --assign <name>] ([--records <$.path>] --field name=<path>... [--filter <path>=<value>] | --value <$.path>)) [--strategy <using>] [--json]";

function isJsonRecords(extract) {
  return extract.records !== undefined || extract.fields !== undefined || extract.filter !== undefined;
}

/** Throws a plain message (the caller names the op) when the extract can't run on this strategy. */
function validateExtract(extract, using) {
  if (!extract || typeof extract !== "object" || Array.isArray(extract)) throw new Error("must be an object");
  for (const key of Object.keys(extract)) {
    if (!EXTRACT_KEYS.includes(key)) throw new Error(`extract has unknown key "${key}" (allowed: ${EXTRACT_KEYS.join(", ")})`);
  }
  if (extract.jsonPath !== undefined && (typeof extract.jsonPath !== "string" || !/^\$(?:\.[^.]+)*$/.test(extract.jsonPath))) {
    throw new Error(`jsonPath must be $ or $.key.key (got ${JSON.stringify(extract.jsonPath)})`);
  }
  if (extract.html !== undefined) {
    if (Object.keys(extract).length > 1) throw new Error("extract cannot combine html with records, fields or filter (or jsonPath, field)");
    if (!HTML_STRATEGIES.includes(using)) throw new Error("extract.html works only on network and workflow strategies");
    parseHtmlExtract(extract.html);
    return;
  }
  if (extract.embedded !== undefined) {
    if (using !== "network") throw new Error("extract.embedded works only on network strategies");
    if (extract.field !== undefined) throw new Error("extract cannot combine embedded with field (use jsonPath)");
    parseEmbeddedSpec(extract.embedded);
  }
  if (isJsonRecords(extract)) {
    if (extract.jsonPath !== undefined || extract.field !== undefined) throw new Error("extract cannot combine jsonPath or field with records, fields or filter");
    compileJsonExtract(extract);
  }
}

function splitPair(value, flag) {
  const index = typeof value === "string" ? value.indexOf("=") : -1;
  if (index < 1) throw new Error(`${flag} needs name=source, got ${JSON.stringify(value)}`);
  return [value.slice(0, index), value.slice(index + 1)];
}

/** `pb extract` arguments (after `extract`) as { playbook, op, extract, options }. */
function parseExtractArgs(argv) {
  const positional = [];
  const fields = {};
  const filter = {};
  const single = {};
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const name = arg.slice(2);
    if (name === "json") {
      options.json = true;
      continue;
    }
    const value = argv[++index];
    if (value === undefined) throw new Error(`${arg} needs a value`);
    if (name === "field") {
      const [key, source] = splitPair(value, "--field");
      fields[key] = source;
    } else if (name === "filter") {
      const [key, expected] = splitPair(value, "--filter");
      filter[key] = expected;
    } else if (["item", "value", "records", "embedded", "assign", "ld-type"].includes(name)) single[name] = value;
    else if (name === "strategy") options.strategy = value;
    else throw new Error(`Unknown option ${arg} for pb extract. ${USAGE}`);
  }
  const [playbook, op] = positional;
  const hasFields = Object.keys(fields).length > 0;
  const hasFilter = Object.keys(filter).length > 0;
  if (!playbook || !op || positional.length > 2) throw new Error(USAGE);
  let extract;
  const embedded = single.embedded !== undefined || single.assign !== undefined || single["ld-type"] !== undefined;
  if (embedded) {
    if (single.item !== undefined || (single.value !== undefined && !single.value.startsWith("$"))) throw new Error("--embedded and --assign read JSON: use --records, --field and --filter, or --value $.path");
    if (single.value !== undefined && (single.records !== undefined || hasFields || hasFilter)) throw new Error("--value takes no other extract flags");
    const source = { ...(single.embedded !== undefined ? { selector: single.embedded } : {}), ...(single.assign !== undefined ? { assign: single.assign } : {}), ...(single["ld-type"] !== undefined ? { type: single["ld-type"] } : {}) };
    extract = {
      embedded: parseEmbeddedSpec(source),
      ...(single.value !== undefined ? { jsonPath: single.value } : {}),
      ...(single.records !== undefined ? { records: single.records } : {}),
      ...(hasFields ? { fields } : {}),
      ...(hasFilter ? { filter } : {}),
    };
  } else if (single.value !== undefined && single.value.startsWith("$")) {
    if (single.item || single.records || hasFields || hasFilter) throw new Error("--value takes no other extract flags");
    extract = { jsonPath: single.value };
  } else if (single.item !== undefined || single.value !== undefined) {
    if (single.records !== undefined) throw new Error("--records picks JSON records; for HTML use --item");
    if (hasFilter) throw new Error("--filter works on JSON records only; narrow HTML records with the --item selector");
    if (single.value !== undefined) {
      if (single.item !== undefined || hasFields) throw new Error("--value takes no --item or --field");
      extract = { html: { value: single.value } };
    } else {
      if (!hasFields) throw new Error("--item needs at least one --field name=<selector>");
      extract = { html: { item: single.item, fields } };
    }
  } else {
    if (single.records === undefined && !hasFields) throw new Error(USAGE);
    extract = {
      ...(single.records !== undefined ? { records: single.records } : {}),
      ...(hasFields ? { fields } : {}),
      ...(hasFilter ? { filter } : {}),
    };
  }
  return { playbook, op, extract, options };
}

/** Sets `extract` on the op's matching strategies, validates and saves the op, and returns a diff. */
function saveExtract({ playbook, op: opId, extract, strategy, cwd, home }) {
  // Required here: playbooks.cjs requires this module to validate extracts.
  const { editSavedOp } = require("./playbooks.cjs");
  let strategies;
  const edited = editSavedOp({
    playbook,
    op: opId,
    cwd,
    home,
    edit: (op) => {
      if (op.chain) throw new Error(`op ${opId} is a chain op; pb extract edits the ops its steps run`);
      const usings = (op.run || []).map((entry) => entry.using);
      const wanted = strategy ? [strategy] : extract.html !== undefined ? HTML_STRATEGIES : ["network"];
      const targets = usings.flatMap((using, index) => (wanted.includes(using) ? [index] : []));
      if (targets.length === 0) throw new Error(`op ${opId} has no ${wanted.join(" or ")} strategy (it has ${usings.join(", ") || "none"})`);
      strategies = targets.map((index) => usings[index]);
      return { ...op, run: op.run.map((entry, index) => (targets.includes(index) ? { ...entry, extract } : entry)) };
    },
  });
  return { playbook: edited.playbook, op: opId, scope: edited.scope, path: edited.path, strategies, extract, diff: lineDiff(edited.before, edited.after) };
}

function formatExtractResult(result) {
  return `Saved extract on ${result.playbook} ${result.op} (${result.strategies.join(", ")}) in ${result.path}\n${result.diff}`;
}

module.exports = { formatExtractResult, parseExtractArgs, saveExtract, validateExtract };
