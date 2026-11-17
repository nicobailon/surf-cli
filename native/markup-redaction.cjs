// Echoes of secret values in markup (HTML or XML), redacted by its tokens rather than its words:
// htmlparser2's tokenizer gives each token's place in the text, and a secret is replaced only
// inside the content of one token, so every tag, comment, CDATA section and quote stays where it
// was. Required lazily by redaction.cjs, and only for a text that holds markup, so nothing else
// loads htmlparser2.
//
// The rules, applied to each token's content (`rules` as redaction.cjs's echoRules builds them):
// - Text, comment, CDATA, processing-instruction and declaration contents and raw text (`<script>`,
//   `<style>`...): a long secret goes anywhere in it, a short one only as a whole word (bounded by
//   whitespace, the content's edges, or a matching quote on each side). Every content is also
//   matched with its entities decoded, raw text and comments too, since a later reader may decode
//   them; a match that isn't written out plainly masks the whole content.
// - Contents a browser may read otherwise than the tokenizer (text and comments inside `<svg>` or
//   `<math>`, CDATA in HTML, bogus comments such as `<?x>`) go whole on any hit, read as written or
//   decoded, with a word bounded by any character that can end one in a text, a tag or a value.
// - An attribute value goes whole when, with its entities decoded, it is a secret; a long secret
//   also goes inside one.
// - An attribute name is renamed `redacted` (`redacted-2`... when that name is taken) when it is a
//   secret of 4 characters or more whole, or holds a long one; a namespace declaration (`xmlns`,
//   `xmlns:p`) is never renamed, as the prefix it binds is still used. A tag name is never touched.
// - An XML doctype is read by scanDoctype, internal subset included: a secret in a quoted value goes
//   as in text (a short one bounded loosely); one elsewhere in it masks the body. A reference to an
//   entity it declares counts as the entity's text.
// - A secret that crosses tokens masks every token content it touches: a long one always, a short
//   one when it stands as a whole word, and then only text, comment, CDATA and raw-text contents.
// - Anything that can't be placed this way (a long secret in a tag name, a secret in a namespace
//   declaration's name or a processing instruction's target, an output that tokenizes differently
//   from its input, still holds a secret, or shows a long one anywhere, as written or decoded, or XML
//   that was well formed and no longer is) masks the whole body.

const RAW_TEXT_TAGS = new Set(["iframe", "noembed", "noframes", "plaintext", "script", "style", "xmp"]);
// HTML elements whose content a browser reads as foreign (SVG, MathML), not as HTML.
const FOREIGN_TAGS = new Set(["svg", "math"]);
// The one marker, in text, values, raw text, comments, CDATA, processing instructions and
// declarations alike: it has no `<`, `>`, quote, `&`, `]`, `-`, `/`, `=`, backtick or space, so it
// can't open a tag, end a comment, CDATA section, value or declaration, or start an entity, wherever
// it stands and whatever stands beside it.
const MARKER = "(redacted)";
// A whole body: a valid XML document and an HTML element.
const MARKUP_WHOLE_MARKER = "<redacted/>";
const NAME_MARKER = "redacted";

const TEXT_LIKE = new Set(["text", "raw", "comment", "cdata"]);
// Contents the tokenizer leaves undecoded, decoded apart, since a browser or a later reader may
// decode them: a script's or style's text, comments, CDATA, processing instructions, declarations.
const DECODED_APART = new Set(["raw", "comment", "cdata", "pi", "decl", "literal"]);
// Whether a character is whitespace, as `\s` reads it.
const isSpace = (char) => {
  if (char === undefined) return false;
  const code = char.charCodeAt(0);
  return code === 32 || (code >= 9 && code <= 13) || (code > 127 && /\s/.test(char));
};
const isQuote = (char) => char === '"' || char === "'";
// Whether a character can end a word in content a browser may read as text, a tag or a value.
const isLooseEdge = (char) => char === undefined || isSpace(char) || '<>"\'=/`'.includes(char);
const NO_CALLBACK = () => {};
const PREDEFINED = { lt: "<", gt: ">", amp: "&", apos: "'", quot: '"' };
// An XML reference: a character's (decimal or hexadecimal) or an entity's, by name.
const XML_REFERENCE = /&(?:#([0-9]+)|#x([0-9a-fA-F]+)|([^\s&;<>"'#][^\s&;<>"']*));/g;

let tokenizerClass = null;
function loadTokenizer() {
  tokenizerClass ||= require("htmlparser2").Tokenizer;
  return tokenizerClass;
}

// Whether a body is XML: by its content type, or by an XML declaration at its start.
function isXmlBody(text, contentType) {
  return /[/+]xml\b/i.test(String(contentType || "")) || /^\uFEFF?\s*<\?xml[\s?]/.test(text);
}

// The entities in `source`[start, end) as a browser decodes HTML text, each { start, end, text }, or
// null when it has none; read by a tokenizer of its own, with every `<` hidden so all of it is text.
function htmlEntities(source, start, end, work) {
  const text = source.slice(start, end);
  work.steps += text.length;
  if (!text.includes("&")) return null;
  const Tokenizer = loadTokenizer();
  const hidden = text.replaceAll("<", "\uFFFF");
  const entities = [];
  const callbacks = {};
  for (const name of ["onattribdata", "onattribentity", "onattribend", "onattribname", "oncdata", "onclosetag", "oncomment", "ondeclaration", "onend", "onopentagend", "onopentagname", "onprocessinginstruction", "onselfclosingtag", "ontext"]) {
    callbacks[name] = NO_CALLBACK;
  }
  callbacks.ontextentity = (codepoint, at) => {
    work.steps++;
    const decoded = String.fromCodePoint(codepoint);
    const last = entities.at(-1);
    if (last && last.end === start + at) {
      last.text += decoded;
      return;
    }
    entities.push({ start: start + hidden.lastIndexOf("&", at - 1), end: start + at, text: decoded });
  };
  const tokenizer = new Tokenizer({ xmlMode: false, decodeEntities: true }, callbacks);
  tokenizer.write(hidden);
  tokenizer.end();
  return entities.length > 0 ? entities : null;
}

// The XML references in `source`[start, end), each { start, end, text }, or null when it has none:
// characters', the five predefined entities' and those `declared` expands, or only the declared
// ones when `declaredOnly` (the tokenizer has decoded the others).
function xmlEntities(source, start, end, expand, work, declaredOnly = false) {
  const text = source.slice(start, end);
  work.steps += text.length;
  if (!text.includes("&")) return null;
  const entities = [];
  for (const match of text.matchAll(XML_REFERENCE)) {
    work.steps++;
    const [all, decimal, hex, name] = match;
    let decoded = null;
    if (name !== undefined) decoded = declaredOnly && PREDEFINED[name] !== undefined ? null : (PREDEFINED[name] ?? expand(name));
    else if (!declaredOnly) {
      const code = decimal !== undefined ? Number.parseInt(decimal, 10) : Number.parseInt(hex, 16);
      if (code > 0 && code <= 0x10ffff && (code < 0xd800 || code > 0xdfff)) decoded = String.fromCodePoint(code);
    }
    if (decoded !== null) entities.push({ start: start + match.index, end: start + match.index + all.length, text: decoded });
  }
  return entities.length > 0 ? entities : null;
}

// An XML document's DOCTYPE, which the tokenizer ends at its first `>` though an internal subset
// (`[<!ENTITY x "a>b">]`) holds more: where it stands in the prolog, { start, end, closed }, as
// spans: its quoted values and comments as `literal`, the rest as `dtd`; and the general entities
// it declares, by name, each the place of its value. Null when the prolog has none.
function scanDoctype(source, work) {
  let at = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (at < source.length && isSpace(source[at])) at++;
    const close = source.startsWith("<?", at) ? source.indexOf("?>", at + 2) + 2 : source.startsWith("<!--", at) ? source.indexOf("-->", at + 4) + 3 : 0;
    if (close <= 2) break;
    at = close;
  }
  work.steps += at;
  if (!source.startsWith("<!DOCTYPE", at)) return null;
  const start = at;
  const spans = [];
  const entities = new Map();
  let stretch = start;
  // A `kind` span over [from, to), after the `dtd` one that leads up to it.
  const cut = (kind, from, to) => {
    if (from > stretch) spans.push({ kind: "dtd", start: stretch, end: from });
    spans.push({ kind, start: from, end: to });
    stretch = to;
  };
  let pending = null;
  let subset = false;
  let closed = false;
  at += "<!DOCTYPE".length;
  while (at < source.length) {
    work.steps++;
    const char = source[at];
    if (isQuote(char)) {
      const close = source.indexOf(char, at + 1);
      const end = close < 0 ? source.length : close;
      cut("literal", at + 1, end);
      if (pending !== null && !entities.has(pending)) entities.set(pending, { start: at + 1, end });
      pending = null;
      at = end + 1;
    } else if (!subset && char === "[") {
      subset = true;
      at++;
    } else if (!subset && char === ">") {
      closed = true;
      at++;
      break;
    } else if (subset && char === "]") {
      let next = at + 1;
      while (isSpace(source[next])) next++;
      if (source[next] === ">") {
        closed = true;
        at = next + 1;
        break;
      }
      at++;
    } else if (subset && source.startsWith("<!--", at)) {
      const close = source.indexOf("-->", at + 4);
      const end = close < 0 ? source.length : close;
      cut("literal", at + 4, end);
      at = end + 3;
    } else if (subset && source.startsWith("<!ENTITY", at)) {
      // `<!ENTITY name "value">` declares a general entity; `<!ENTITY % name ...>` one for the DTD.
      let next = at + "<!ENTITY".length;
      while (isSpace(source[next])) next++;
      const parameter = source[next] === "%";
      if (parameter) next++;
      while (isSpace(source[next])) next++;
      let nameEnd = next;
      while (nameEnd < source.length && !isSpace(source[nameEnd]) && !isQuote(source[nameEnd]) && source[nameEnd] !== ">") nameEnd++;
      let value = nameEnd;
      while (isSpace(source[value])) value++;
      pending = !parameter && nameEnd > next && isQuote(source[value]) ? source.slice(next, nameEnd) : null;
      at = value;
    } else at++;
  }
  const end = Math.min(at, source.length);
  if (end > stretch) spans.push({ kind: "dtd", start: stretch, end });
  return { start, end, closed, spans, entities };
}

// The declared entities' text, references expanded, for `doctype` in `source`: a function from a
// name to its text, or null for a name it doesn't declare. An expansion that refers to itself, or
// that grows past what a body this size can hold, is refused (thrown), so a page can't make the
// expansion run away.
function entityExpander(source, doctype, work) {
  const expansions = new Map();
  const active = new Set();
  const budget = { left: 16 * source.length + 100_000 };
  const expand = (name) => {
    if (!doctype?.entities.has(name)) return null;
    if (expansions.has(name)) return expansions.get(name);
    if (active.has(name)) throw new Error("an entity refers to itself");
    active.add(name);
    const { start, end } = doctype.entities.get(name);
    const pieces = xmlEntities(source, start, end, expand, work) || [];
    let text = "";
    let at = start;
    for (const piece of pieces) {
      text += source.slice(at, piece.start) + piece.text;
      at = piece.end;
    }
    text += source.slice(at, end);
    budget.left -= text.length;
    if (budget.left < 0) throw new Error("the declared entities expand past the body's budget");
    active.delete(name);
    expansions.set(name, text);
    return text;
  };
  return expand;
}

// The token contents of `source`, in order, each { kind, start, end }, with `entities` (each
// { start, end, text }, `text` decoded) for contents that hold any, `tag` for names, `ambiguous`
// for contents a browser may read otherwise than the tokenizer (see planSpan) and `outside` for
// XML text outside the root; the kinds of every token, to compare one tokenization with another;
// each tag's names, attributes and end, for the XML check (see wellFormed); and the doctype.
function tokenize(source, xml, work) {
  const Tokenizer = loadTokenizer();
  const doctype = xml ? scanDoctype(source, work) : null;
  // The doctype is read by scanDoctype; the tokenizer sees blanks in its place.
  const input = doctype ? `${source.slice(0, doctype.start)}${" ".repeat(doctype.end - doctype.start)}${source.slice(doctype.end)}` : source;
  const spans = [];
  const kinds = doctype ? ["doctype"] : [];
  const tags = [];
  let text = null;
  let tag = null;
  let attr = null;
  let openName = "";
  let raw = false;
  // How deep in SVG or MathML (HTML), or in elements (XML), the tokenizer stands.
  let foreign = 0;
  let level = 0;
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
      text = { kind: raw ? "raw" : "text", start, end, entities: null, ambiguous: foreign > 0, outside: level === 0 };
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
    const start = input.lastIndexOf("&", end - 1);
    textPiece(start, end);
    (text.entities ||= []).push({ start, end, text: decoded });
  };
  const endValue = (end) => {
    spans.push({ kind: "value", start: attr.start ?? end, end, entities: attr.entities });
    kinds.push("value");
    attr.value = [attr.start ?? end, end];
  };
  const structure = (kind) => {
    step();
    flushText();
    kinds.push(kind);
  };
  const tokenizer = new Tokenizer(
    { xmlMode: xml, decodeEntities: true },
    {
      isInForeignContext: () => foreign > 0,
      ontext: textPiece,
      ontextentity: textEntity,
      onopentagname: (start, end) => {
        structure("open");
        openName = input.slice(start, end).toLowerCase();
        tag = { kind: "open", name: [start, end], names: [], attrs: [], ended: false, selfClosing: false };
        tags.push(tag);
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
        attr = { start: null, end: null, entities: null, name: [start, end], quote: 0, value: null };
        tag?.attrs.push(attr);
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
        if (!Number.isInteger(start) || !Number.isInteger(end) || input[start] !== "&" || end <= start) {
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
        if (attr) attr.quote = quote;
        if (attr && quote !== 0) endValue(quote >= 2 ? end - 1 : end);
        attr = null;
      },
      onopentagend: () => {
        structure("tagend");
        inTag = false;
        if (tag) tag.ended = true;
        if (xml) level++;
        else if (FOREIGN_TAGS.has(openName)) foreign++;
        raw = !xml && foreign === 0 && RAW_TEXT_TAGS.has(openName);
      },
      onselfclosingtag: () => {
        structure("selfclose");
        inTag = false;
        if (tag) Object.assign(tag, { ended: true, selfClosing: true });
        // HTML reads `<script/>` as an open tag, so raw text follows it all the same; an SVG or
        // MathML element closes there.
        raw = !xml && foreign === 0 && RAW_TEXT_TAGS.has(openName);
      },
      onclosetag: (start, end) => {
        structure("close");
        tags.push({ kind: "close", name: [start, end] });
        raw = false;
        if (xml) level = Math.max(0, level - 1);
        else if (foreign > 0 && FOREIGN_TAGS.has(input.slice(start, end).toLowerCase())) foreign--;
      },
      oncomment: (start, end, offset) => {
        structure("comment");
        // HTML reads `<?`, `<!x`, `</ x` and an unfinished `<![CDATA[` as a comment up to the next
        // `>`: a bogus one, which a reader may take otherwise. Its `?` stays, so it stays one.
        const bogus = !input.startsWith("<!--", start - 4);
        const from = bogus && input[start] === "?" ? start + 1 : start;
        spans.push({ kind: "comment", start: from, end: end - offset, ambiguous: bogus || foreign > 0 });
      },
      oncdata: (start, end, offset) => {
        structure("cdata");
        // HTML reads CDATA as a comment that ends at the first `>`, but in SVG as CDATA.
        spans.push({ kind: "cdata", start, end: end - offset, ambiguous: !xml, outside: level === 0 });
      },
      onprocessinginstruction: (start, end) => {
        structure("pi");
        // Its target (`<?target data?>`) is a name; its data, text.
        let target = start;
        while (target < end && !isSpace(input[target])) target++;
        spans.push({ kind: "target", start, end: target });
        let data = target;
        while (data < end && isSpace(input[data])) data++;
        spans.push({ kind: "pi", start: data, end });
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
        while (inTag && (isSpace(input[start]) || input[start] === "/")) start++;
        if (inTag && start < input.length) {
          const name = { kind: "name", start, end: input.length, tag };
          tag?.names.push(name);
          spans.push(name);
        }
      },
    },
  );
  tokenizer.write(input);
  tokenizer.end();
  let found = spans;
  if (doctype) {
    // Text the blanks made goes; what lies outside the doctype stays.
    found = [];
    for (const span of spans) {
      if (span.kind !== "text" || span.end <= doctype.start || span.start >= doctype.end) found.push(span);
      else {
        const keep = (start, end) => ({ ...span, start, end, entities: span.entities?.filter((entity) => entity.start >= start && entity.end <= end) || null });
        if (span.start < doctype.start) found.push(keep(span.start, doctype.start));
        if (span.end > doctype.end) found.push(keep(doctype.end, span.end));
      }
    }
    found.push(...doctype.spans);
    found.sort((a, b) => a.start - b.start);
  }
  found = found.filter((span) => span.end > span.start);
  const expand = entityExpander(source, doctype, work);
  for (const span of found) {
    if (!span.entities && DECODED_APART.has(span.kind)) {
      span.entities = xml ? xmlEntities(source, span.start, span.end, expand, work) : htmlEntities(source, span.start, span.end, work);
    } else if (xml && doctype?.entities.size && (span.kind === "text" || span.kind === "value")) {
      // The tokenizer decodes characters' and predefined entities, not those the doctype declares.
      const declared = xmlEntities(source, span.start, span.end, expand, work, true);
      if (declared) span.entities = [...(span.entities || []), ...declared].sort((a, b) => a.start - b.start);
    }
  }
  return { spans: found, kinds, tags, doctype };
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
// side, or the same quote on both; or, when `loose`, any character that can end a word in a text,
// a tag or a value (see isLooseEdge).
function isWord(text, start, end, from, to, loose = false) {
  const before = start > from ? text[start - 1] : undefined;
  const after = end < to ? text[end] : undefined;
  if (loose) return isLooseEdge(before) && isLooseEdge(after);
  if (isQuote(before) && before === after) return true;
  return (before === undefined || isSpace(before)) && (after === undefined || isSpace(after));
}

// The matches of `rules` in `text` (a token's decoded content): each long secret anywhere, each
// short one as a whole word when `short` (see isWord for `loose`); as [start, end) pairs.
function matchesIn(text, rules, short, work, loose = false) {
  const hits = [];
  for (const value of rules.long) {
    if (value.length <= text.length) for (const at of occurrences(text, value, work)) hits.push([at, at + value.length]);
  }
  if (short) {
    for (const value of rules.short) {
      for (let at = text.indexOf(value); at >= 0; at = text.indexOf(value, at + 1)) {
        work.steps++;
        if (isWord(text, at, at + value.length, 0, text.length, loose)) hits.push([at, at + value.length]);
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

// Contents that can't be masked in place: a processing instruction's target and a doctype's own
// syntax are names, and a namespace declaration's name binds a prefix the document still uses.
const cantMask = (source, span) =>
  span.kind === "target" || span.kind === "dtd" || (span.kind === "name" && /^xmlns(?::|$)/i.test(source.slice(span.start, span.end)));

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
      if (cantMask(source, span)) return { whole: true };
      masked.add(index);
      continue;
    }
    const whole = (span.kind === "name" || span.kind === "value") && span.end - span.start <= longest + 1;
    if (!contained[index] && !span.entities && !whole) continue;
    const result = planSpan(source, span, contained[index] || [], rules, work);
    if (result === "whole") return { whole: true };
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

// The ranges replaced within one token content, or "mask" when it must go whole, or "whole" when
// the body must.
function planSpan(source, span, found, rules, work) {
  const { kind, start, end } = span;
  if (kind === "name") {
    const name = source.slice(start, end);
    if (!rules.keys.has(name) && !found.some((hit) => hit.long)) return [];
    return cantMask(source, span) ? "whole" : "mask";
  }
  // Content a browser may read otherwise than the tokenizer goes whole on any hit, read as written
  // or decoded, with words bounded loosely; so do a target's or a doctype's names, with the body.
  if (span.ambiguous || cantMask(source, span)) {
    const hit = (text) => matchesIn(text, rules, true, work, true).length > 0;
    const decoded = span.entities ? piecesOf(source, span).map((piece) => piece.text).join("") : null;
    if (!found.some((hit) => hit.long) && !hit(source.slice(start, end)) && !(decoded !== null && hit(decoded))) return [];
    return cantMask(source, span) ? "whole" : "mask";
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
  // A short secret goes from a value only whole (above); from a doctype's quoted value as a word
  // bounded loosely, as the text it may become.
  const short = kind !== "value";
  const loose = kind === "literal";
  const hits = [];
  for (const hit of found) if (hit.long || (short && isWord(source, hit.start, hit.end, start, end, loose))) hits.push([hit.start, hit.end]);
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
    for (const [from, to] of disjoint(matchesIn(decoded, rules, short, work, loose)).sort((a, b) => a[0] - b[0])) {
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
    const text = span.kind === "name" ? newName(source, span, renamed) : MARKER;
    replaced.push({ start: span.start, end: span.end, text });
  });
  for (const [start, end] of planned.ranges) replaced.push({ start, end, text: MARKER });
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

// Whether a long secret of `rules` shows in `text` outside `markers`, as written or with every
// entity decoded, wherever the tokenizer put it: a check that doesn't trust its reading of the page.
function showsLong(text, xml, markers, rules, work) {
  if (rules.long.length === 0) return false;
  let hidden = text;
  if (markers.length > 0) {
    const parts = [];
    let last = 0;
    for (const [start, end] of markers) {
      parts.push(text.slice(last, start), "\u0000".repeat(end - start));
      last = end;
    }
    parts.push(text.slice(last));
    hidden = parts.join("");
  }
  const entities = xml ? xmlEntities(hidden, 0, hidden.length, () => null, work) : htmlEntities(hidden, 0, hidden.length, work);
  const decoded = entities ? piecesOf(hidden, { start: 0, end: hidden.length, entities }).map((piece) => piece.text).join("") : hidden;
  return rules.long.some((value) => occurrences(hidden, value, work).length > 0 || occurrences(decoded, value, work).length > 0);
}

// The tokens of `output` when it tokenizes as `tokens` did and holds no secret but inside its
// markers; else null.
function verified(output, xml, tokens, markers, rules, work) {
  const again = tokenize(output, xml, work);
  if (again.kinds.length !== tokens.kinds.length || again.kinds.some((kind, index) => kind !== tokens.kinds[index])) return null;
  const planned = plan(output, again, rules, work);
  if (planned.whole) return null;
  const found = [...[...planned.masked].map((index) => [again.spans[index].start, again.spans[index].end]), ...planned.ranges];
  found.sort((a, b) => a[0] - b[0]);
  // Both in order, so one walk finds the marker each range would have to lie in.
  let marker = 0;
  for (const [start, end] of found) {
    work.steps++;
    while (marker < markers.length && markers[marker][1] <= start) marker++;
    if (marker === markers.length || markers[marker][0] > start || markers[marker][1] < end) return null;
  }
  return showsLong(output, xml, markers, rules, work) ? null : again;
}

// An XML 1.0 name, with a prefix or not (letters past ASCII taken as name characters).
const XML_NAME = /^[A-Za-z_\u00C0-\uFFFF][\w.\-\u00B7\u00C0-\uFFFF]*$/;
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";

// Whether `source`, tokenized as `tokens` (XML), is well formed as expat reads it, as far as a
// redaction could change it: one root and nothing but space, comments and processing instructions
// outside it; tags that nest and close; names that are XML names with at most one prefix, every
// prefix bound and no attribute twice, by name or by namespace; values quoted, after a space; no
// `<` in text or values and every `&` a known reference; comments without `--`; sections closed.
function wellFormed(source, tokens) {
  const { spans, tags, doctype } = tokens;
  if (doctype && !doctype.closed) return false;
  const declared = doctype?.entities || new Map();
  // Its own sticky copy, so no other reader's place in a text is moved.
  const reference = new RegExp(XML_REFERENCE.source, "y");
  const references = (start, end) => {
    for (let at = source.indexOf("&", start); at >= 0 && at < end; at = source.indexOf("&", at + 1)) {
      reference.lastIndex = at;
      const match = reference.exec(source);
      if (!match || at + match[0].length > end) return false;
      const name = match[3];
      if (name !== undefined && PREDEFINED[name] === undefined && !declared.has(name)) return false;
    }
    return true;
  };
  for (const span of spans) {
    const content = source.slice(span.start, span.end);
    if (span.kind === "text") {
      if (content.includes("<") || content.includes("]]>") || !references(span.start, span.end)) return false;
      if (span.outside && /\S/.test(content)) return false;
    } else if (span.kind === "value") {
      if (content.includes("<") || !references(span.start, span.end)) return false;
    } else if (span.kind === "comment") {
      if (content.includes("--") || content.endsWith("-") || !source.startsWith("-->", span.end)) return false;
    } else if (span.kind === "cdata") {
      if (span.outside || !source.startsWith("]]>", span.end)) return false;
    } else if (span.kind === "decl") return false;
  }
  const qualified = (name) => {
    const parts = name.split(":");
    return parts.length <= 2 && parts.every((part) => XML_NAME.test(part));
  };
  const stack = [];
  let roots = 0;
  let closed = false;
  for (const tag of tags) {
    const name = source.slice(...tag.name);
    if (tag.kind === "close") {
      const open = stack.pop();
      let after = tag.name[1];
      while (isSpace(source[after])) after++;
      if (!open || open.name !== name || source[after] !== ">") return false;
      if (stack.length === 0) closed = true;
      continue;
    }
    if (closed || !tag.ended || !qualified(name)) return false;
    if (stack.length === 0) roots++;
    const scope = new Map(stack.at(-1)?.scope || [["xml", XML_NAMESPACE]]);
    const names = new Set();
    for (const attr of tag.attrs) {
      const attrName = source.slice(...attr.name);
      if (attr.quote < 2 || !isSpace(source[attr.name[0] - 1]) || !qualified(attrName) || names.has(attrName)) return false;
      names.add(attrName);
      const value = attr.value ? source.slice(...attr.value) : "";
      if (attrName.startsWith("xmlns:")) {
        const prefix = attrName.slice("xmlns:".length);
        if (value === "" || prefix === "xmlns" || (prefix === "xml") !== (value === XML_NAMESPACE)) return false;
        scope.set(prefix, value);
      }
    }
    const bound = (qname) => !qname.includes(":") || scope.has(qname.split(":")[0]);
    if (name.startsWith("xmlns:") || !bound(name)) return false;
    const expanded = new Set();
    for (const attrName of names) {
      if (attrName === "xmlns" || attrName.startsWith("xmlns:")) continue;
      if (!bound(attrName)) return false;
      const [prefix, local] = attrName.includes(":") ? attrName.split(":") : [null, attrName];
      const key = `${prefix === null ? "" : scope.get(prefix)}\u0000${local}`;
      if (expanded.has(key)) return false;
      expanded.add(key);
    }
    if (tag.selfClosing) {
      if (stack.length === 0) closed = true;
    } else stack.push({ name, scope });
  }
  return roots === 1 && stack.length === 0;
}

// Whether `text` is a well-formed XML document (see wellFormed).
function isWellFormedXml(text) {
  try {
    return wellFormed(text, tokenize(text, true, { steps: 0 }));
  } catch {
    return false;
  }
}

// `text` (which holds markup) with each secret of `rules` redacted by its tokens (see above). `xml`
// picks XML tokenizing over HTML; `work`, when given, counts the steps taken.
function redactMarkup(text, rules, { xml = false, work = { steps: 0 } } = {}) {
  try {
    const tokens = tokenize(text, xml, work);
    const planned = plan(text, tokens, rules, work);
    if (planned.whole) return MARKUP_WHOLE_MARKER;
    if (planned.masked.size === 0 && planned.ranges.length === 0) {
      return showsLong(text, xml, [], rules, work) ? MARKUP_WHOLE_MARKER : text;
    }
    const { output, markers } = apply(text, tokens, planned);
    const again = verified(output, xml, tokens, markers, rules, work);
    if (!again) return MARKUP_WHOLE_MARKER;
    // XML a parser read before must still read: a namespace, a reference or a tag the redaction
    // broke would otherwise lose the whole document for whoever reads it next.
    if (xml && wellFormed(text, tokens) && !wellFormed(output, again)) return MARKUP_WHOLE_MARKER;
    return output;
  } catch {
    // No tokenizer (it failed to load, or to read the text): only a text that holds no secret and
    // no entity can be shown as it is.
    const secret = [...rules.long, ...rules.short].some((value) => text.includes(value));
    return secret || text.includes("&") ? MARKUP_WHOLE_MARKER : text;
  }
}

module.exports = { MARKUP_WHOLE_MARKER, isWellFormedXml, isXmlBody, redactMarkup };
