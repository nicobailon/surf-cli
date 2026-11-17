// Echoes of secret values in markup (HTML or XML), redacted by its tokens rather than its words:
// htmlparser2's tokenizer gives each token's place in the text, and a secret is replaced only
// inside the content of one token, so every tag, comment, CDATA section and quote stays where it
// was. Required lazily by redaction.cjs, and only for a text that holds markup, so nothing else
// loads htmlparser2.
//
// The rules, applied to each token's content (`rules` as redaction.cjs's echoRules builds them):
// - Text, comment and CDATA contents and raw text (`<script>`, `<style>`...): a long secret goes
//   anywhere in it, a short one only as a whole word (bounded by whitespace, the content's edges, or
//   a matching quote on each side). Text and RCDATA (`<textarea>`, `<title>`) are also matched with
//   their entities decoded; a match that isn't written out plainly masks the whole text.
// - An attribute value goes whole when, with its entities decoded, it is a secret; a long secret
//   also goes inside one.
// - An attribute name is renamed `redacted` (`redacted-2`... when that name is taken) when it is a
//   secret of 4 characters or more whole, or holds a long one. A tag name is never touched.
// - A secret that crosses tokens masks every token content it touches: a long one always, a short
//   one when it stands as a whole word, and then only text, comment, CDATA and raw-text contents.
// - Anything that can't be placed this way (a long secret in a tag name, an output that tokenizes
//   differently from its input or still holds a secret) masks the whole body.

const RAW_TEXT_TAGS = new Set(["iframe", "noembed", "noframes", "plaintext", "script", "style", "xmp"]);
// In text and attribute values: reads as <redacted> and has no `<`, `>`, quote, `=`, backtick or
// space, so it can stand as an unquoted value and can't open or close anything.
const TEXT_MARKER = "&lt;redacted&gt;";
// In comments, CDATA and raw text, where entities aren't read: it has no `-`, `]`, `/` or `!`, so it
// can't make `--`, `-->`, `--!>`, `]]>` or `</` with what stands beside it.
const PLAIN_MARKER = "<redacted>";
// In a processing instruction or declaration, which end at `>`.
const BARE_MARKER = "redacted";
// A whole body: a valid XML document and an HTML element.
const MARKUP_WHOLE_MARKER = "<redacted/>";
const NAME_MARKER = "redacted";

const TEXT_LIKE = new Set(["text", "raw", "comment", "cdata"]);
const MARKERS = { text: TEXT_MARKER, value: TEXT_MARKER, raw: PLAIN_MARKER, comment: PLAIN_MARKER, cdata: PLAIN_MARKER, pi: BARE_MARKER, decl: BARE_MARKER };
// Whether a character is whitespace, as `\s` reads it.
const isSpace = (char) => {
  if (char === undefined) return false;
  const code = char.charCodeAt(0);
  return code === 32 || (code >= 9 && code <= 13) || (code > 127 && /\s/.test(char));
};
const isQuote = (char) => char === '"' || char === "'";

let tokenizerClass = null;
function loadTokenizer() {
  tokenizerClass ||= require("htmlparser2").Tokenizer;
  return tokenizerClass;
}

// Whether a body is XML: by its content type, or by an XML declaration at its start.
function isXmlBody(text, contentType) {
  return /[/+]xml\b/i.test(String(contentType || "")) || /^\uFEFF?\s*<\?xml[\s?]/.test(text);
}

// The token contents of `source`, in order, each { kind, start, end }, with `entities` (each
// { start, end, text }, `text` decoded) for text and values that hold any, and `tag` for names; and
// the kinds of every token, to compare one tokenization with another.
function tokenize(source, xml, work) {
  const Tokenizer = loadTokenizer();
  const spans = [];
  const kinds = [];
  let text = null;
  let tag = null;
  let attr = null;
  let openName = "";
  let raw = false;
  // Within a tag the body may end in, how far its names and values reach.
  let inTag = false;
  let tagEnd = 0;
  const step = () => work.steps++;
  const flushText = () => {
    if (!text) return;
    spans.push(text);
    kinds.push(text.kind);
    text = null;
  };
  const textPiece = (start, end) => {
    step();
    if (text && text.end === start) text.end = end;
    else {
      flushText();
      text = { kind: raw ? "raw" : "text", start, end, entities: null };
    }
  };
  const textEntity = (codepoint, end) => {
    step();
    const decoded = String.fromCodePoint(codepoint);
    const last = text?.entities?.at(-1);
    // A named entity that decodes to two code points arrives as two at the same end.
    if (last && last.end === end) {
      last.text += decoded;
      return;
    }
    const start = source.lastIndexOf("&", end - 1);
    textPiece(start, end);
    (text.entities ||= []).push({ start, end, text: decoded });
  };
  const endValue = (end) => {
    spans.push({ kind: "value", start: attr.start ?? end, end, entities: attr.entities });
    kinds.push("value");
  };
  const structure = (kind) => {
    step();
    flushText();
    kinds.push(kind);
  };
  const tokenizer = new Tokenizer(
    { xmlMode: xml, decodeEntities: true },
    {
      ontext: textPiece,
      ontextentity: textEntity,
      onopentagname: (start, end) => {
        structure("open");
        openName = source.slice(start, end).toLowerCase();
        tag = { names: [] };
        raw = false;
        inTag = true;
        tagEnd = end;
      },
      onattribname: (start, end) => {
        step();
        tagEnd = end;
        const name = { kind: "name", start, end, tag };
        tag?.names.push(name);
        spans.push(name);
        kinds.push("name");
        attr = { start: null, end: null, entities: null };
      },
      onattribdata: (start, end) => {
        step();
        tagEnd = end;
        if (!attr) return;
        attr.start ??= start;
        attr.end = end;
      },
      onattribentity: (codepoint) => {
        step();
        if (!attr) return;
        // The callback gives no place, so it is read from the tokenizer (pinned): where the entity
        // starts, and where the text after it does.
        const { entityStart: start, sectionStart: end } = tokenizer;
        if (!Number.isInteger(start) || !Number.isInteger(end) || source[start] !== "&" || end <= start) {
          throw new Error("the tokenizer gave no place for an entity");
        }
        const last = attr.entities?.at(-1);
        const decoded = String.fromCodePoint(codepoint);
        // A named entity that decodes to two code points arrives as two at the same end.
        if (last && last.end === end) {
          last.text += decoded;
          return;
        }
        attr.start ??= start;
        attr.end = end;
        (attr.entities ||= []).push({ start, end, text: decoded });
      },
      onattribend: (quote, end) => {
        step();
        tagEnd = end;
        // QuoteType: 0 no value, 1 unquoted, 2 single, 3 double.
        if (attr && quote !== 0) endValue(quote >= 2 ? end - 1 : end);
        attr = null;
      },
      onopentagend: () => {
        structure("tagend");
        inTag = false;
        raw = !xml && RAW_TEXT_TAGS.has(openName);
      },
      onselfclosingtag: () => {
        structure("selfclose");
        inTag = false;
        // HTML reads `<script/>` as an open tag, so raw text follows it all the same.
        raw = !xml && RAW_TEXT_TAGS.has(openName);
      },
      onclosetag: () => {
        structure("close");
        raw = false;
      },
      oncomment: (start, end, offset) => {
        structure("comment");
        spans.push({ kind: "comment", start, end: end - offset });
      },
      oncdata: (start, end, offset) => {
        structure("cdata");
        spans.push({ kind: "cdata", start, end: end - offset });
      },
      onprocessinginstruction: (start, end) => {
        structure("pi");
        spans.push({ kind: "pi", start, end });
      },
      ondeclaration: (start, end) => {
        structure("decl");
        spans.push({ kind: "decl", start, end });
      },
      onend: () => {
        flushText();
        // A value the body ends inside of runs to the end.
        if (attr && attr.start !== null) endValue(attr.end);
        attr = null;
        // The tokenizer reports nothing of a name it was still reading (`<p a="x" shop`).
        let start = tagEnd;
        while (inTag && (isSpace(source[start]) || source[start] === "/")) start++;
        if (inTag && start < source.length) {
          const name = { kind: "name", start, end: source.length, tag };
          tag?.names.push(name);
          spans.push(name);
        }
      },
    },
  );
  tokenizer.write(source);
  tokenizer.end();
  return { spans: spans.filter((span) => span.end > span.start), kinds };
}

// Every start of `pattern` in `text`, overlapping ones included, in linear time (Knuth-Morris-Pratt).
function occurrences(text, pattern, work) {
  const found = [];
  work.steps += text.length;
  // Most texts hold no long secret at all, which indexOf tells at once.
  if (text.indexOf(pattern) < 0) return found;
  const codes = new Uint16Array(pattern.length);
  for (let i = 0; i < pattern.length; i++) codes[i] = pattern.charCodeAt(i);
  const fail = new Int32Array(codes.length);
  for (let i = 1, k = 0; i < codes.length; i++) {
    while (k > 0 && codes[i] !== codes[k]) {
      k = fail[k - 1];
      work.steps++;
    }
    if (codes[i] === codes[k]) k++;
    fail[i] = k;
  }
  for (let i = 0, k = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    while (k > 0 && code !== codes[k]) {
      k = fail[k - 1];
      work.steps++;
    }
    if (code === codes[k]) k++;
    if (k === codes.length) {
      found.push(i - k + 1);
      k = fail[k - 1];
    }
  }
  work.steps += text.length + codes.length;
  return found;
}

// Whether text[start, end) stands as a whole word within [from, to): whitespace or an edge on each
// side, or the same quote on both.
function isWord(text, start, end, from, to) {
  const before = start > from ? text[start - 1] : undefined;
  const after = end < to ? text[end] : undefined;
  if (isQuote(before) && before === after) return true;
  return (before === undefined || isSpace(before)) && (after === undefined || isSpace(after));
}

// The matches of `rules` in `text` (a token's decoded content): each long secret anywhere, each
// short one as a whole word when `short`; as [start, end) pairs.
function matchesIn(text, rules, short, work) {
  const hits = [];
  for (const value of rules.long) {
    if (value.length <= text.length) for (const at of occurrences(text, value, work)) hits.push([at, at + value.length]);
  }
  if (short) {
    for (const value of rules.short) {
      for (let at = text.indexOf(value); at >= 0; at = text.indexOf(value, at + 1)) {
        work.steps++;
        if (isWord(text, at, at + value.length, 0, text.length)) hits.push([at, at + value.length]);
      }
    }
  }
  return hits;
}

// Non-overlapping ranges from `hits`, by start, the longest at a start winning.
function disjoint(hits) {
  if (hits.length < 2) return hits;
  const sorted = [...hits].sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const result = [];
  for (const hit of sorted) if (result.length === 0 || hit[0] >= result.at(-1)[1]) result.push(hit);
  return result;
}

// Where `rules` would redact `source`: { whole: true } when it can't be placed, else each token
// content that goes whole (`masked`, by span index) and the ranges replaced within the others.
function plan(source, tokens, rules, work) {
  const { spans } = tokens;
  const spanAt = new Int32Array(source.length).fill(-1);
  spans.forEach((span, index) => spanAt.fill(index, span.start, span.end));
  work.steps += source.length;
  // The first span that ends after `at`, and the last that starts at or before it, by binary search.
  const spanFrom = (at) => {
    let low = 0;
    let high = spans.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (spans[mid].end > at) high = mid;
      else low = mid + 1;
    }
    return low;
  };
  const spanTo = (at) => {
    let low = -1;
    let high = spans.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (spans[mid].start <= at) low = mid;
      else high = mid - 1;
    }
    return low;
  };
  // The matches that lie inside each span, for the few spans that have any.
  const contained = new Array(spans.length);
  const crossAll = new Int32Array(spans.length + 1);
  const crossText = new Int32Array(spans.length + 1);
  const values = [...rules.long.map((value) => ({ value, long: true })), ...rules.short.map((value) => ({ value, long: false }))];
  for (const { value, long } of values) {
    const starts = long ? occurrences(source, value, work) : [];
    if (!long) for (let at = source.indexOf(value); at >= 0; at = source.indexOf(value, at + 1)) starts.push(at);
    for (const start of starts) {
      work.steps++;
      const end = start + value.length;
      const first = spanAt[start];
      if (first >= 0 && first === spanAt[end - 1]) {
        (contained[first] ||= []).push({ start, end, long });
        continue;
      }
      const from = spanFrom(start);
      const to = spanTo(end - 1);
      if (from > to) {
        // Only markup: a delimiter a short one shares with the text, or a long one in a tag name.
        if (long) return { whole: true };
        continue;
      }
      if (long) {
        crossAll[from]++;
        crossAll[to + 1]--;
        continue;
      }
      const opens = start === 0 || spanAt[start - 1] !== first || first < 0 || isSpace(source[start - 1]);
      const last = spanAt[end - 1];
      const closes = end === source.length || spanAt[end] !== last || last < 0 || isSpace(source[end]);
      if (opens && closes) {
        crossText[from]++;
        crossText[to + 1]--;
      }
    }
  }
  const masked = new Set();
  const ranges = [];
  // A name or value longer than any secret (by a `/` at most) can only hold a match, not be one.
  let longest = 0;
  for (const value of rules.whole) longest = Math.max(longest, value.length);
  let all = 0;
  let text = 0;
  for (let index = 0; index < spans.length; index++) {
    const span = spans[index];
    all += crossAll[index];
    text += crossText[index];
    if (all > 0 || (text > 0 && TEXT_LIKE.has(span.kind))) {
      masked.add(index);
      continue;
    }
    const whole = (span.kind === "name" || span.kind === "value") && span.end - span.start <= longest + 1;
    if (!contained[index] && !span.entities && !whole) continue;
    const result = planSpan(source, span, contained[index] || [], rules, work);
    if (result === "mask") masked.add(index);
    else for (const range of result) ranges.push(range);
  }
  return { whole: false, masked, ranges };
}

// A span's content as pieces in order, each { start, end, text, entity }: its literal runs as
// written and its entities decoded.
function piecesOf(source, span) {
  const pieces = [];
  let at = span.start;
  for (const { start, end, text } of span.entities) {
    if (start > at) pieces.push({ start: at, end: start, text: source.slice(at, start), entity: false });
    pieces.push({ start, end, text, entity: true });
    at = end;
  }
  if (span.end > at) pieces.push({ start: at, end: span.end, text: source.slice(at, span.end), entity: false });
  return pieces;
}

// The ranges replaced within one token content, or "mask" when it must go whole.
function planSpan(source, span, found, rules, work) {
  const { kind, start, end } = span;
  if (kind === "name") {
    const name = source.slice(start, end);
    return rules.keys.has(name) || found.some((hit) => hit.long) ? "mask" : [];
  }
  if (kind === "value") {
    const written = source.slice(start, end);
    const decoded = span.entities ? piecesOf(source, span).map((piece) => piece.text).join("") : written;
    if (rules.whole.has(decoded) || rules.whole.has(written)) return "mask";
    // HTML reads `value=shop/>` as the value `shop/`, a parser that knows less as `shop` and `/>`.
    if (source[end] === ">" && written.endsWith("/") && (rules.whole.has(decoded.slice(0, -1)) || rules.whole.has(written.slice(0, -1)))) {
      return [[start, end - 1]];
    }
  }
  const short = kind !== "value" && kind !== "pi" && kind !== "decl";
  const hits = [];
  for (const hit of found) if (hit.long || (short && isWord(source, hit.start, hit.end, start, end))) hits.push([hit.start, hit.end]);
  if (span.entities) {
    const pieces = piecesOf(source, span);
    const decoded = pieces.map((piece) => piece.text).join("");
    let at = 0;
    const offsets = pieces.map((piece) => {
      const offset = at;
      at += piece.text.length;
      return offset;
    });
    let piece = 0;
    for (const [from, to] of disjoint(matchesIn(decoded, rules, short, work)).sort((a, b) => a[0] - b[0])) {
      while (offsets[piece] + pieces[piece].text.length <= from) piece++;
      let last = piece;
      while (offsets[last] + pieces[last].text.length < to) last++;
      // Written out plainly when every character is literal, not part of an entity.
      for (let index = piece; index <= last; index++) if (pieces[index].entity) return "mask";
      hits.push([pieces[piece].start + from - offsets[piece], pieces[last].start + to - offsets[last]]);
    }
    // A replacement that cuts into an entity would leave half of it behind.
    const ranges = disjoint(hits);
    let index = 0;
    for (const [from, to] of ranges) {
      while (pieces[index].end <= from) index++;
      for (let at = index; at < pieces.length && pieces[at].start < to; at++) {
        work.steps++;
        const { entity, start: entityStart, end: entityEnd } = pieces[at];
        if (entity && (from > entityStart || to < entityEnd)) return "mask";
      }
    }
    return ranges;
  }
  return disjoint(hits);
}

// `source` with the plan applied; and where its markers stand.
function apply(source, tokens, planned) {
  const { spans } = tokens;
  const replaced = [];
  const renamed = new Map();
  spans.forEach((span, index) => {
    if (!planned.masked.has(index)) return;
    if (span.kind === "name") {
      replaced.push({ start: span.start, end: span.end, text: newName(source, span, renamed) });
    } else replaced.push({ start: span.start, end: span.end, text: MARKERS[span.kind] });
  });
  const kindAt = (at) => {
    let low = 0;
    let high = spans.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (spans[mid].end <= at) low = mid + 1;
      else if (spans[mid].start > at) high = mid - 1;
      else return spans[mid].kind;
    }
    return "text";
  };
  for (const [start, end] of planned.ranges) replaced.push({ start, end, text: MARKERS[kindAt(start)] });
  replaced.sort((a, b) => a.start - b.start);
  const parts = [];
  const markers = [];
  let last = 0;
  let length = 0;
  for (const { start, end, text } of replaced) {
    parts.push(source.slice(last, start));
    length += start - last;
    markers.push([length, length + text.length]);
    parts.push(text);
    length += text.length;
    last = end;
  }
  parts.push(source.slice(last));
  return { output: parts.join(""), markers };
}

// The name a renamed attribute takes: `redacted`, or `redacted-2`... when its tag has that name.
// `renamed` keeps, by tag, the names it has and the next number to try.
function newName(source, span, renamed) {
  const tag = span.tag || span;
  if (!renamed.has(tag)) {
    const names = (span.tag ? span.tag.names : [span]).map((name) => source.slice(name.start, name.end).toLowerCase());
    renamed.set(tag, { taken: new Set(names), next: 2 });
  }
  const state = renamed.get(tag);
  let name = NAME_MARKER;
  if (state.taken.has(name)) {
    while (state.taken.has(`${NAME_MARKER}-${state.next}`)) state.next++;
    name = `${NAME_MARKER}-${state.next}`;
  }
  state.taken.add(name);
  return name;
}

// Whether `output` tokenizes as `tokens` did and holds no secret but inside its markers.
function verified(output, xml, tokens, markers, rules, work) {
  const again = tokenize(output, xml, work);
  if (again.kinds.length !== tokens.kinds.length || again.kinds.some((kind, index) => kind !== tokens.kinds[index])) return false;
  const planned = plan(output, again, rules, work);
  if (planned.whole) return false;
  const found = [...[...planned.masked].map((index) => [again.spans[index].start, again.spans[index].end]), ...planned.ranges];
  found.sort((a, b) => a[0] - b[0]);
  // Both in order, so one walk finds the marker each range would have to lie in.
  let marker = 0;
  for (const [start, end] of found) {
    work.steps++;
    while (marker < markers.length && markers[marker][1] <= start) marker++;
    if (marker === markers.length || markers[marker][0] > start || markers[marker][1] < end) return false;
  }
  return true;
}

// `text` (which holds markup) with each secret of `rules` redacted by its tokens (see above). `xml`
// picks XML tokenizing over HTML; `work`, when given, counts the steps taken.
function redactMarkup(text, rules, { xml = false, work = { steps: 0 } } = {}) {
  try {
    const tokens = tokenize(text, xml, work);
    const planned = plan(text, tokens, rules, work);
    if (planned.whole) return MARKUP_WHOLE_MARKER;
    if (planned.masked.size === 0 && planned.ranges.length === 0) return text;
    const { output, markers } = apply(text, tokens, planned);
    return verified(output, xml, tokens, markers, rules, work) ? output : MARKUP_WHOLE_MARKER;
  } catch {
    // No tokenizer (it failed to load, or to read the text): only a text that holds no secret and
    // no entity can be shown as it is.
    const secret = [...rules.long, ...rules.short].some((value) => text.includes(value));
    return secret || text.includes("&") ? MARKUP_WHOLE_MARKER : text;
  }
}

module.exports = { MARKUP_WHOLE_MARKER, isXmlBody, redactMarkup };
