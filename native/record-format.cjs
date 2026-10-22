// Renders record arrays as jsonl or markdown (`surf use ... --format md|jsonl`).

const { getPath } = require("./records.cjs");

const TEMPLATE_NAME = /\{\{([a-zA-Z0-9._-]+)\}\}/g;
const MARKDOWN_KEYS = ["title", "heading", "link", "body", "quote", "images"];

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validateMarkdownSpec(spec) {
  if (!isPlainObject(spec)) throw new Error("markdown must be an object");
  for (const [key, value] of Object.entries(spec)) {
    if (!MARKDOWN_KEYS.includes(key)) throw new Error(`markdown has unknown key "${key}" (allowed: ${MARKDOWN_KEYS.join(", ")})`);
    if (typeof value !== "string" || !value) throw new Error(`markdown.${key} must be a non-empty string`);
  }
}

function fill(template, values) {
  return template
    .replace(TEMPLATE_NAME, (_, name) => {
      const value = getPath(values, name);
      return value === undefined || value === null ? "" : String(value);
    })
    .trim();
}

function text(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function renderGeneric(records) {
  const lines = [];
  records.forEach((record, index) => {
    lines.push(`## ${index + 1}/${records.length}`, "");
    if (isPlainObject(record)) {
      for (const [field, value] of Object.entries(record)) lines.push(`- **${field}:** ${text(value)}`);
    } else {
      lines.push(text(record));
    }
    lines.push("");
  });
  return lines;
}

function renderWithSpec(records, spec, args) {
  const lines = [];
  if (spec.title) lines.push(`# ${fill(spec.title, { ...args, ...records[0] })}`, "");
  records.forEach((record, index) => {
    const heading = spec.heading ? ` · ${fill(spec.heading, record)}` : "";
    lines.push(`## ${index + 1}/${records.length}${heading}`, "");
    if (spec.link) lines.push(fill(spec.link, record), "");
    const body = spec.body ? getPath(record, spec.body) : undefined;
    if (body !== undefined && body !== null) lines.push(text(body), "");
    const quoted = spec.quote ? getPath(record, spec.quote) : undefined;
    if (isPlainObject(quoted)) {
      const quote = [];
      if (spec.heading) quote.push(`**${fill(spec.heading, quoted)}**`, "");
      const quotedBody = spec.body ? getPath(quoted, spec.body) : undefined;
      if (quotedBody !== undefined && quotedBody !== null) quote.push(text(quotedBody));
      const quotedImages = spec.images ? getPath(quoted, spec.images) : undefined;
      if (Array.isArray(quotedImages)) {
        for (const url of quotedImages) if (typeof url === "string") quote.push("", `![image](${url})`);
      }
      lines.push(...quote.join("\n").trimEnd().split("\n").map((line) => (line ? `> ${line}` : ">")), "");
    }
    const images = spec.images ? getPath(record, spec.images) : undefined;
    if (Array.isArray(images) && images.length) {
      for (const url of images) if (typeof url === "string") lines.push(`![image](${url})`);
      lines.push("");
    }
  });
  return lines;
}

/** `format`: json | jsonl | md. `markdown` is the op's optional spec; `args` are the op args (title only). */
function formatRecords(value, format, { markdown, args = {} } = {}) {
  if (!["json", "jsonl", "md"].includes(format)) throw new Error(`unknown --format "${format}" (use json, jsonl, or md)`);
  if (!Array.isArray(value)) {
    throw new Error(`--format ${format} needs a list of records, but this op returned ${value === null ? "null" : typeof value}`);
  }
  if (format === "json") return JSON.stringify(value, null, 2);
  if (format === "jsonl") return value.map((record) => JSON.stringify(record)).join("\n");
  if (markdown !== undefined) validateMarkdownSpec(markdown);
  const lines = markdown ? renderWithSpec(value, markdown, args) : renderGeneric(value);
  if (value.length === 0) lines.push("No records.");
  return lines.join("\n").trimEnd();
}

module.exports = { formatRecords, validateMarkdownSpec };
