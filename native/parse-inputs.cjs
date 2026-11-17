// surf parse: names, the goal check, and which values of the replayed request become inputs.
// Rules from running the parse recipe on books.toscrape.com, arXiv and jobs.lever.co.

const { siteOf } = require("./record-candidates.cjs");

const SEARCH_KEYS = /^(?:q|s|k|query|search|search_?query|keywords?|term|text|terms-\d+-term)$/i;
const PAGE_KEYS = /^(?:page|p|pg|page_?num(?:ber)?)$/i;
const OFFSET_KEYS = /^(?:start|skip|offset|from)$/i;
// Route words that are never an input, though a goal may say them.
const ROUTE_WORDS = new Set("list recent new latest top popular all search browse catalogue catalog category categories jobs job posts post products product items item page pages index home api abs pdf html tag tags user users en us r".split(" "));
// The input a value takes from the route word before it.
const AFTER = { list: "category", category: "category", categories: "category", c: "category", tag: "tag", tags: "tag", topic: "topic", topics: "topic", author: "author", authors: "author", user: "user", users: "user", u: "user", r: "subreddit", company: "company", companies: "company", org: "org", orgs: "org" };
const ID_AFTER = { abs: "paper_id", pdf: "paper_id", p: "post_id", posts: "post_id", status: "post_id", jobs: "job_id", products: "product_id", items: "item_id", users: "user_id" };
const STOP = new Set("a an the of for on in at to from by with and or its their each every all get list show find fetch read details detail info information page data".split(" "));
const DETAIL_WORDS = new Set(["details", "detail", "info", "information", "page"]);
const ID_LIKE = [/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, /^\d{4}\.\d{4,5}(?:v\d+)?$/, /^[0-9a-f]{16,}$/i, /^\d{4,}$/, /^[a-z0-9-]+_\d+$/i, /^[a-z0-9-]+-\d{3,}$/i];

const WRITE_VERBS = new Set("post submit send create delete remove update edit buy purchase pay checkout add apply register subscribe comment reply like follow upload vote reserve publish share invite message".split(" "));
const UI_ACTIONS = /\b(click|scroll|load more|log ?in|sign ?in)\b/i;

const words = (text) => String(text).toLowerCase().split(/[^\p{L}\p{N}._-]+/u).map((word) => word.replace(/^[._-]+|[._-]+$/g, "")).filter(Boolean);
const isIdLike = (value) => ID_LIKE.some((pattern) => pattern.test(value));
const singular = (word) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);
const snake = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** Why the goal needs the recipe instead (a write, a click, scroll or typed search), or nothing. */
function goalNeedsRecipe(goal, url) {
  const said = words(goal);
  const verbAt = said.findIndex((word, index) => WRITE_VERBS.has(word) && (index === 0 || ["to", "then", "and"].includes(said[index - 1])));
  if (verbAt >= 0) return `the goal asks for a write ("${said[verbAt]}"); surf parse saves reads only`;
  const action = String(goal).match(UI_ACTIONS);
  if (action) return `the goal needs a ${action[1].toLowerCase()} in the page; surf parse only loads the URL`;
  if (said[0] === "search" && !new URL(url).search) return "the goal needs a typed search, and the URL holds no query";
  return undefined;
}

/** The playbook: the site's registrable name (lever-co). */
function siteName(url) {
  const host = new URL(url).hostname;
  if (/^[\d.]+$|^\[|^localhost$/.test(host)) return "local";
  return siteOf(host).replace(/[^a-z0-9]+/gi, "-").toLowerCase();
}

/** The op: get_ and the goal's first three words. */
function opName(goal) {
  return `get_${words(goal).map(snake).filter(Boolean).slice(0, 3).join("_") || "data"}`;
}

// The thing a detail page is about: the word before "details", else the last word before
// "with"/"and", leaving out stop words and the URL's own values.
function goalThing(goal, values) {
  const said = words(goal).filter((word) => !values.has(word) && !/^\d/.test(word));
  const detail = said.findIndex((word, index) => index > 0 && DETAIL_WORDS.has(word));
  if (detail > 0) return singular(said[detail - 1]);
  const cut = said.findIndex((word) => ["with", "and", "including"].includes(word));
  const kept = (cut >= 0 ? said.slice(0, cut) : said).filter((word) => !STOP.has(word));
  return kept.length > 0 ? singular(kept.at(-1)) : undefined;
}

/**
 * The inputs for the op's request ({ url, query }): one per path segment or query value that the
 * goal varies, each { field, as, recorded, required, weak, value?, explicit? }. `overrides`
 * ([{ name, field }], from --input) name a field's input. `detail` is true when a path segment is an id.
 */
function planInputs({ request, goal, overrides = [] }) {
  const url = new URL(request.url);
  const decode = (segment) => { try { return decodeURIComponent(segment); } catch { return segment; } };
  const segments = url.pathname.split("/").filter(Boolean).map(decode);
  const recordedAt = (field) => {
    const [kind, key] = [field.slice(0, field.indexOf(".")), field.slice(field.indexOf(".") + 1)];
    return kind === "path" ? segments[Number(key) - 1] : kind === "query" ? request.query?.[key] : undefined;
  };
  const detail = segments.some(isIdLike);
  const said = new Set(words(goal));
  const values = new Set(segments.map((segment) => segment.toLowerCase()));
  const inputs = [];
  segments.forEach((segment, index) => {
    const field = `path.${index + 1}`;
    const before = segments[index - 1]?.toLowerCase();
    const page = segment.match(/^page-(\d+)(?:\.\w+)?$/i) || (/^\d+$/.test(segment) && ["page", "p"].includes(before) ? [segment, segment] : null);
    if (page) inputs.push({ field, as: "page", value: page[1], recorded: page[1], required: false, weak: false });
    else if (isIdLike(segment)) {
      const thing = goalThing(goal, values);
      const as = thing ? `${thing}_id` : ID_AFTER[before] || "id";
      inputs.push({ field, as, recorded: segment, required: true, weak: !thing && !ID_AFTER[before] });
    } else if (said.has(segment.toLowerCase()) && !ROUTE_WORDS.has(segment.toLowerCase())) {
      const known = AFTER[before];
      const as = known || (before && before.length > 1 && /^[a-z-]+$/.test(before) ? snake(singular(before)) : "name");
      inputs.push({ field, as, recorded: segment, required: true, weak: !known });
    }
  });
  let searched = false;
  for (const [key, value] of Object.entries(request.query || {})) {
    const field = `query.${key}`;
    const text = String(value);
    if (SEARCH_KEYS.test(key) && text && !searched) {
      searched = true;
      inputs.push({ field, as: "query", recorded: text, required: true, weak: false });
    } else if ((PAGE_KEYS.test(key) || OFFSET_KEYS.test(key)) && /^\d+$/.test(text)) {
      inputs.push({ field, as: PAGE_KEYS.test(key) ? "page" : key.toLowerCase(), recorded: text, required: false, weak: false });
    } else if (text.length > 1 && said.has(text.toLowerCase())) {
      inputs.push({ field, as: snake(key) || "value", recorded: text, required: true, weak: false });
    }
  }
  // --input names a field's input: a field the heuristics chose keeps its kind (an optional page).
  for (const { name, field } of overrides) {
    const chosen = inputs.find((input) => input.field === field);
    if (chosen) Object.assign(chosen, { as: name, weak: false, explicit: true });
    else inputs.push({ field, as: name, recorded: recordedAt(field), required: true, weak: false, explicit: true });
  }
  // One name per input.
  const taken = new Set();
  for (const input of inputs) {
    let name = input.as;
    for (let n = 2; taken.has(name); n++) name = `${input.as}_${n}`;
    taken.add((input.as = name));
  }
  return { detail, inputs };
}

module.exports = { goalNeedsRecipe, opName, planInputs, siteName };
