// Echoes of secret values in markup (HTML or XML), redacted by its tokens rather than its words:
// htmlparser2's tokenizer gives each token's place in the text, and a secret is replaced only
// inside the content of one token, so every tag, comment, CDATA section and quote stays where it
// was. Required lazily by redaction.cjs, and only for a text that holds markup or an HTML or XML
// body, so nothing else loads htmlparser2.
//
// The rules, applied to each token's content (`rules` as redaction.cjs's echoRules builds them):
// - Text, comment, CDATA, processing-instruction and declaration contents and raw text (`<script>`,
//   `<style>`...): a long secret goes anywhere in it, a short one only as a whole word (bounded by
//   whitespace or the content's edges, `>` before it or `<` after it, or a matching quote on each
//   side, as in free text). Every content is also matched with its entities decoded, raw text and
//   comments too, since a later reader may decode them; a match that isn't written out plainly
//   masks the whole content. HTML text is read with U+0000 dropped, as a browser drops it, so a
//   secret it splits goes as a word.
// - Contents a browser may read otherwise than the tokenizer (text and comments inside `<svg>` or
//   `<math>`, CDATA in HTML, bogus comments such as `<?x>`) go whole on any hit, read as written or
//   decoded, with a word bounded by any character that can end one in a text, a tag or a value. So
//   does an `srcdoc` value, decoded as many times as it decodes. A closing tag that matches no open
//   SVG or MathML element, or an HTML tag that ends foreign content, masks the body when it holds a
//   secret so bounded.
// - An attribute value goes whole when, with its entities decoded, it is a secret; a long secret
//   also goes inside one, and a short one where it stands as a word in it, as in text.
// - An attribute name is renamed `redacted` (`redacted-2`... when that name is taken) when it is a
//   secret of 4 characters or more whole, or holds a long one; a namespace declaration (`xmlns`,
//   `xmlns:p`) is never renamed, as the prefix it binds is still used. A tag name is never touched.
// - An XML doctype is read by scanDoctype, internal subset included: a secret in a quoted value goes
//   as in text (a short one bounded loosely); one elsewhere in it masks the body. A reference to an
//   entity it declares counts as the entity's text. A subset with parameter entities, attribute
//   lists, processing instructions or an entity value that holds `<` or `&` masks the body when
//   any reading could spell a secret.
// - The XML declaration and a namespace declaration's value are never rewritten: a secret in either
//   masks the body.
// - A secret that crosses tokens masks every token content it touches: a long one always, a short
//   one when it stands as a whole word, and then only text, comment, CDATA and raw-text contents.
// - Anything that can't be placed this way (a long secret in a tag name, a secret in a namespace
//   declaration's name or a processing instruction's target, an output that tokenizes differently
//   from its input or still holds a secret, or XML that was well formed and no longer is) masks the
//   whole body.
// - Last, a check that doesn't trust the tokenizer (see exposes): an output that shows a secret
//   outside its markers in any reading, as written or decoded by HTML's or XML's rules up to three
//   times (in HTML, each also with U+0000 dropped), a long one anywhere and a short one as a whole
//   word, masks the whole body.

const RAW_TEXT_TAGS = new Set(["iframe", "noembed", "noframes", "plaintext", "script", "style", "xmp"]);
// HTML elements whose content a browser reads as foreign (SVG, MathML), not as HTML.
const FOREIGN_TAGS = new Set(["svg", "math"]);
// Foreign elements whose content a browser reads as HTML again, by namespace.
const INTEGRATION_POINTS = { svg: new Set(["foreignobject", "desc", "title"]), math: new Set(["mi", "mo", "mn", "ms", "mtext"]) };
// HTML tags that end foreign content when a browser meets them in it (`<font>` with some
// attributes too); and `annotation-xml`, which a browser reads as HTML or not by its encoding.
const LEAVE_FOREIGN = new Set([
  ..."b big blockquote body br center code dd div dl dt em embed h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strike strong sub sup table tt u ul var font annotation-xml".split(" "),
]);
// HTML elements that never have a closing tag.
const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr"]);
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
const DECODED_APART = new Set(["raw", "comment", "cdata", "pi", "xmldecl", "decl", "literal"]);
// How many times the final check decodes the output by each entity rule (see exposes).
const DECODE_LEVELS = 3;
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

// Whether a content type is HTML or XML, whose readers decode entities in any text.
function isMarkupType(contentType) {
  return /[/+]xml\b|\bhtml\b/i.test(String(contentType || ""));
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
// spans: its quoted values and comments as `literal`, the rest as `dtd`; the general entities it
// declares, by name, each the place of its value; and `unsupported` when its internal subset uses
// what this reading doesn't model: parameter entities (`<!ENTITY % x ...>`, `%x;`), attribute
// lists (`<!ATTLIST`, with their defaults and normalized values), processing instructions, or a
// general entity whose value holds `<` or `&` (markup or a reference, parsed again where it's used).
// Null when the prolog has none.
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
  let unsupported = false;
  at += "<!DOCTYPE".length;
  while (at < source.length) {
    work.steps++;
    const char = source[at];
    if (isQuote(char)) {
      const close = source.indexOf(char, at + 1);
      const end = close < 0 ? source.length : close;
      cut("literal", at + 1, end);
      if (pending !== null && !entities.has(pending)) entities.set(pending, { start: at + 1, end });
      // A general entity's value that holds markup or a reference is parsed again where it is used,
      // as elements, CDATA or more references, which this reading doesn't model.
      if (pending !== null && /[<&]/.test(source.slice(at + 1, end))) unsupported = true;
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
    } else if (subset && source.startsWith("<?", at)) {
      // Its data may hold `]>` or a quote; it is read past whole.
      const close = source.indexOf("?>", at + 2);
      unsupported = true;
      at = close < 0 ? source.length : close + 2;
    } else if (subset && (source.startsWith("<!ATTLIST", at) || char === "%")) {
      unsupported = true;
      at++;
    } else if (subset && source.startsWith("<!ENTITY", at)) {
      // `<!ENTITY name "value">` declares a general entity; `<!ENTITY % name ...>` one for the DTD.
      let next = at + "<!ENTITY".length;
      while (isSpace(source[next])) next++;
      const parameter = source[next] === "%";
      if (parameter) {
        unsupported = true;
        next++;
      }
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
  return { start, end, closed, spans, entities, unsupported };
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
// each tag's names, attributes and end, for the XML check (see wellFormed); the doctype and its
// entities' expansion; and `unsure` when HTML leaves foreign content where a browser wouldn't, or
// stays in it where a browser leaves (a closing tag that matches no open SVG or MathML element, an
// HTML tag that ends foreign content): then the tokenizer's reading can't be trusted.
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
  // The elements open in and under SVG or MathML (HTML), innermost last, each { name, ns, html }:
  // `ns` the element's foreign namespace, or null for an HTML element in an integration point;
  // `html` when its content is read as HTML. And how deep in elements the tokenizer stands (XML).
  const foreign = [];
  let unsure = false;
  let level = 0;
  const inForeign = () => foreign.length > 0 && !foreign.at(-1).html;
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
      text = { kind: raw ? "raw" : "text", start, end, entities: null, ambiguous: foreign.length > 0, outside: level === 0 };
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
    const name = input.slice(...attr.name);
    // An srcdoc value is a document of its own; a namespace declaration's value names one.
    spans.push({
      kind: "value",
      start: attr.start ?? end,
      end,
      entities: attr.entities,
      srcdoc: name.toLowerCase() === "srcdoc",
      namespace: xml && /^xmlns(?::|$)/.test(name),
    });
    kinds.push("value");
    attr.value = [attr.start ?? end, end];
  };
  const structure = (kind) => {
    step();
    flushText();
    kinds.push(kind);
  };
  // An HTML tag the tokenizer has read to its end, kept on `foreign` as a browser keeps it.
  const openElement = (selfClosing) => {
    const top = foreign.at(-1);
    if (!top || top.html) {
      // In HTML, <svg> and <math> start foreign content (closing at once when self-closing); an
      // HTML element in an integration point stays open until its closing tag, `/>` or not.
      if (FOREIGN_TAGS.has(openName)) {
        if (!selfClosing) foreign.push({ name: openName, ns: openName, html: false });
      } else if (top && !VOID_TAGS.has(openName)) foreign.push({ name: openName, ns: null, html: true });
      return;
    }
    // In foreign content, `/>` closes an element; an integration point holds HTML.
    if (!selfClosing) foreign.push({ name: openName, ns: top.ns, html: INTEGRATION_POINTS[top.ns].has(openName) });
  };
  // A closing tag in or under foreign content closes the innermost foreign element of its name,
  // and every one inside it, as a browser does; one a browser reads otherwise (`</math>` in <svg>)
  // makes the reading unsure, and the stack is no longer kept.
  const closeElement = (name) => {
    if (unsure || foreign.length === 0) return;
    if (foreign.at(-1).ns === null) {
      if (foreign.at(-1).name === name) foreign.pop();
      else unsure = true;
      return;
    }
    for (let at = foreign.length - 1; at >= 0 && foreign[at].ns !== null; at--) {
      step();
      if (foreign[at].name === name) {
        foreign.length = at;
        return;
      }
    }
    unsure = true;
  };
  const tokenizer = new Tokenizer(
    { xmlMode: xml, decodeEntities: true },
    {
      isInForeignContext: inForeign,
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
        if (!xml && inForeign() && LEAVE_FOREIGN.has(openName)) unsure = true;
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
        else openElement(false);
        raw = !xml && !inForeign() && RAW_TEXT_TAGS.has(openName);
      },
      onselfclosingtag: () => {
        structure("selfclose");
        inTag = false;
        if (tag) Object.assign(tag, { ended: true, selfClosing: true });
        // HTML reads `<script/>` as an open tag, so raw text follows it all the same; an SVG or
        // MathML element closes there.
        if (!xml) openElement(true);
        raw = !xml && !inForeign() && RAW_TEXT_TAGS.has(openName);
      },
      onclosetag: (start, end) => {
        structure("close");
        tags.push({ kind: "close", name: [start, end] });
        raw = false;
        if (xml) level = Math.max(0, level - 1);
        else closeElement(input.slice(start, end).toLowerCase());
      },
      oncomment: (start, end, offset) => {
        structure("comment");
        // HTML reads `<?`, `<!x`, `</ x` and an unfinished `<![CDATA[` as a comment up to the next
        // `>`: a bogus one, which a reader may take otherwise. Its `?` stays, so it stays one.
        const bogus = !input.startsWith("<!--", start - 4);
        const from = bogus && input[start] === "?" ? start + 1 : start;
        spans.push({ kind: "comment", start: from, end: end - offset, ambiguous: bogus || foreign.length > 0 });
      },
      oncdata: (start, end, offset) => {
        structure("cdata");
        // HTML reads CDATA as a comment that ends at the first `>`, but in SVG as CDATA.
        spans.push({ kind: "cdata", start, end: end - offset, ambiguous: !xml, outside: level === 0 });
      },
      onprocessinginstruction: (start, end) => {
        structure("pi");
        // Its target (`<?target data?>`) is a name; its data, text, but for the XML declaration
        // (`<?xml version="1.0"?>`), whose fields a parser takes as syntax.
        let target = start;
        while (target < end && !isSpace(input[target])) target++;
        spans.push({ kind: "target", start, end: target });
        let data = target;
        while (data < end && isSpace(input[data])) data++;
        spans.push({ kind: xml && input.slice(start, target).toLowerCase() === "xml" ? "xmldecl" : "pi", start: data, end });
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
  // Where U+0000 stands, for HTML text (below); found once, so no span looks past its end.
  const nuls = [];
  if (!xml) for (let at = source.indexOf("\0"); at >= 0; at = source.indexOf("\0", at + 1)) nuls.push(at);
  work.steps += nuls.length;
  for (const span of found) {
    if (!span.entities && DECODED_APART.has(span.kind)) {
      span.entities = xml ? xmlEntities(source, span.start, span.end, expand, work) : htmlEntities(source, span.start, span.end, work);
    } else if (xml && doctype?.entities.size && (span.kind === "text" || span.kind === "value")) {
      // The tokenizer decodes characters' and predefined entities, not those the doctype declares.
      const declared = xmlEntities(source, span.start, span.end, expand, work, true);
      if (declared) span.entities = [...(span.entities || []), ...declared].sort((a, b) => a.start - b.start);
    } else if (nuls.length > 0 && span.kind === "text" && !span.ambiguous) {
      // A browser drops U+0000 from HTML text, so `sh\0op` reads as one word: each is a piece that
      // reads as nothing, written out as it is (see piecesOf).
      const dropped = [];
      for (let index = firstAtOrAfter(nuls, span.start); index < nuls.length && nuls[index] < span.end; index++) {
        work.steps++;
        dropped.push({ start: nuls[index], end: nuls[index] + 1, text: "", dropped: true });
      }
      if (dropped.length > 0) span.entities = [...(span.entities || []), ...dropped].sort((a, b) => a.start - b.start);
    }
  }
  return { spans: found, kinds, tags, doctype, expand, unsure };
}

// The index of the first of `sorted` (ascending) at or after `value`, by binary search.
function firstAtOrAfter(sorted, value) {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sorted[mid] < value) low = mid + 1;
    else high = mid;
  }
  return low;
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

// Whether text[start, end) stands as a whole word within [from, to), as in free text: whitespace
// or an edge on each side, `>` before it or `<` after it, or the same quote on both; or, when
// `loose`, any character that can end a word in a text, a tag or a value (see isLooseEdge).
function isWord(text, start, end, from, to, loose = false) {
  const before = start > from ? text[start - 1] : undefined;
  const after = end < to ? text[end] : undefined;
  if (loose) return isLooseEdge(before) && isLooseEdge(after);
  if (isQuote(before) && before === after) return true;
  return (before === undefined || before === ">" || isSpace(before)) && (after === undefined || after === "<" || isSpace(after));
}

// The matches of `rules` in `text` (a token's decoded content, or a whole reading of a body): each
// long secret anywhere, each short one as a whole word (see isWord for `loose`); as [start, end)
// pairs.
function matchesIn(text, rules, work, loose = false) {
  const hits = [];
  for (const value of rules.long) {
    if (value.length <= text.length) for (const at of occurrences(text, value, work)) hits.push([at, at + value.length]);
  }
  for (const value of rules.short) {
    for (let at = text.indexOf(value); at >= 0; at = text.indexOf(value, at + 1)) {
      work.steps++;
      if (isWord(text, at, at + value.length, 0, text.length, loose)) hits.push([at, at + value.length]);
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

// Contents that can't be masked in place: a processing instruction's target, the XML declaration
// and a doctype's own syntax are names and syntax; a namespace declaration's name binds a prefix
// the document still uses, and its value names the namespace, which a new value could make
// another's.
const cantMask = (source, span) =>
  span.kind === "target" ||
  span.kind === "xmldecl" ||
  span.kind === "dtd" ||
  (span.kind === "value" && span.namespace) ||
  (span.kind === "name" && /^xmlns(?::|$)/i.test(source.slice(span.start, span.end)));

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
// written and its entities decoded. A U+0000 HTML text drops (`dropped`) reads as nothing, but is
// written out plainly, so a word it splits goes as a word.
function piecesOf(source, span) {
  const pieces = [];
  let at = span.start;
  for (const { start, end, text, dropped } of span.entities) {
    if (start > at) pieces.push({ start: at, end: start, text: source.slice(at, start), entity: false });
    pieces.push({ start, end, text, entity: !dropped });
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
  if (span.srcdoc) return srcdocHolds(source, span, found, rules, work) ? "mask" : [];
  // Content a browser may read otherwise than the tokenizer goes whole on any hit, read as written
  // or decoded, with words bounded loosely; so do a target's or a doctype's names, with the body.
  if (span.ambiguous || cantMask(source, span)) {
    const hit = (text) => matchesIn(text, rules, work, true).length > 0;
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
  // A short secret goes from a value whole (above) or as a word in it, as from text; from a
  // doctype's quoted value as a word bounded loosely, as the text it may become.
  const loose = kind === "literal";
  const hits = [];
  for (const hit of found) if (hit.long || isWord(source, hit.start, hit.end, start, end, loose)) hits.push([hit.start, hit.end]);
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
    for (const [from, to] of disjoint(matchesIn(decoded, rules, work, loose)).sort((a, b) => a[0] - b[0])) {
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

// `text` decoded once as a browser decodes HTML text, or as an XML parser does (characters' and the
// five predefined entities).
function decodeHtml(text, work) {
  const entities = htmlEntities(text, 0, text.length, work);
  return entities ? piecesOf(text, { start: 0, end: text.length, entities }).map((piece) => piece.text).join("") : text;
}
function decodeXml(text, work) {
  const entities = xmlEntities(text, 0, text.length, () => null, work);
  return entities ? piecesOf(text, { start: 0, end: text.length, entities }).map((piece) => piece.text).join("") : text;
}

// Whether an srcdoc value holds a secret: as written, and decoded as many times as it decodes (the
// document it holds may hold another), a short one bounded loosely, as a page's text or a tag's
// value. Decoding that keeps going past a budget for its length counts as holding one.
function srcdocHolds(source, span, found, rules, work) {
  if (found.some((hit) => hit.long)) return true;
  let text = source.slice(span.start, span.end);
  if (matchesIn(text, rules, work, true).length > 0) return true;
  if (span.entities) text = piecesOf(source, span).map((piece) => piece.text).join("");
  let budget = 8 * text.length + 1024;
  for (;;) {
    if (matchesIn(text, rules, work, true).length > 0) return true;
    if (!text.includes("&")) return false;
    const next = decodeHtml(text, work);
    if (next === text) return false;
    budget -= next.length;
    if (budget < 0) return true;
    text = next;
  }
}

// Whether a secret of `rules` shows in `text` outside `markers` in any reading, whatever the
// tokenizer took the text for: as written, and decoded by HTML's rules and by XML's, each up to
// DECODE_LEVELS times (an srcdoc's document is decoded twice); a long one anywhere, a short one as
// a whole word (see isWord, `loose` for its loose bounds). In `html`, each reading is also read
// with U+0000 dropped, as a browser drops it from text, and decoded from there. It is the final
// check on every output.
function exposes(text, rules, markers, work, { loose = false, html = false } = {}) {
  let hidden = text;
  if (markers.length > 0) {
    // Hidden by a character no reading drops or decodes, which joins no word.
    const parts = [];
    let last = 0;
    for (const [start, end] of markers) {
      parts.push(text.slice(last, start), "\uFFFF".repeat(end - start));
      last = end;
    }
    parts.push(text.slice(last));
    hidden = parts.join("");
  }
  const shows = (reading) => matchesIn(reading, rules, work, loose).length > 0 || (html && reading.includes("\0") && matchesIn(reading.replaceAll("\0", ""), rules, work, loose).length > 0);
  const starts = [hidden];
  if (html && hidden.includes("\0")) starts.push(hidden.replaceAll("\0", ""));
  for (const start of starts) {
    if (shows(start)) return true;
    for (const decode of [decodeHtml, decodeXml]) {
      let reading = start;
      for (let level = 0; level < DECODE_LEVELS && reading.includes("&"); level++) {
        const next = decode(reading, work);
        if (next === reading) break;
        if (shows(next)) return true;
        reading = next;
      }
    }
  }
  return false;
}

// Whether any reading of `text` could spell a secret of `rules`: it has a reference, which can
// stand for any character, or every character of a secret is in it.
function couldSpell(text, rules, work) {
  work.steps += text.length;
  if (text.includes("&")) return true;
  const characters = new Set(text);
  return [...rules.long, ...rules.short].some((value) => [...value].every((char) => characters.has(char)));
}

// The tokens of `output` when it tokenizes as `tokens` did and holds no secret but inside its
// markers, by the redaction's own reading; else null.
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
  return again;
}

// An XML 1.0 name, with a prefix or not (letters past ASCII taken as name characters).
const XML_NAME = /^[A-Za-z_\u00C0-\uFFFF][\w.\-\u00B7\u00C0-\uFFFF]*$/;
const XML_NAMESPACE = "http://www.w3.org/XML/1998/namespace";
const UNBOUND = Symbol("unbound");

// Whether `source`, tokenized as `tokens` (XML), is well formed as expat reads it, as far as a
// redaction could change it: one root and nothing but space, comments and processing instructions
// outside it; tags that nest and close; names that are XML names with at most one prefix, every
// prefix bound and no attribute twice, by name or by namespace (namespaces read with their
// references decoded and their whitespace normalized); values quoted, after a space; no `<` in text
// or values and every `&` a known reference; comments without `--`; sections closed. The prefixes
// in scope are one map, each element's declarations undone at its end, so nesting costs no more
// than the declarations themselves.
function wellFormed(source, tokens, work = { steps: 0 }) {
  const { spans, tags, doctype, expand } = tokens;
  if (doctype && !doctype.closed) return false;
  const declared = doctype?.entities || new Map();
  // Its own sticky copy, so no other reader's place in a text is moved.
  const reference = new RegExp(XML_REFERENCE.source, "y");
  const references = (start, end) => {
    for (let at = source.indexOf("&", start); at >= 0 && at < end; at = source.indexOf("&", at + 1)) {
      work.steps++;
      reference.lastIndex = at;
      const match = reference.exec(source);
      if (!match || at + match[0].length > end) return false;
      const name = match[3];
      if (name !== undefined && PREDEFINED[name] === undefined && !declared.has(name)) return false;
    }
    return true;
  };
  for (const span of spans) {
    work.steps++;
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
  // A value as a parser reads it: references decoded, each literal tab, newline or return a space.
  const valueOf = ([start, end]) => {
    const entities = xmlEntities(source, start, end, expand, work);
    if (!entities) return source.slice(start, end).replace(/[\t\n\r]/g, " ");
    return piecesOf(source, { start, end, entities }).map((piece) => (piece.entity ? piece.text : piece.text.replace(/[\t\n\r]/g, " "))).join("");
  };
  const scope = new Map([["xml", XML_NAMESPACE]]);
  // Each open element's name, and the bindings its declarations replaced, to restore at its end.
  const stack = [];
  const restore = (undo) => {
    for (let index = undo.length - 1; index >= 0; index--) {
      work.steps++;
      const [prefix, previous] = undo[index];
      if (previous === UNBOUND) scope.delete(prefix);
      else scope.set(prefix, previous);
    }
  };
  let roots = 0;
  let closed = false;
  for (const tag of tags) {
    work.steps++;
    const name = source.slice(...tag.name);
    if (tag.kind === "close") {
      const open = stack.pop();
      let after = tag.name[1];
      while (isSpace(source[after])) after++;
      if (!open || open.name !== name || source[after] !== ">") return false;
      restore(open.undo);
      if (stack.length === 0) closed = true;
      continue;
    }
    if (closed || !tag.ended || !qualified(name)) return false;
    if (stack.length === 0) roots++;
    const undo = [];
    const names = new Set();
    for (const attr of tag.attrs) {
      work.steps++;
      const attrName = source.slice(...attr.name);
      if (attr.quote < 2 || !isSpace(source[attr.name[0] - 1]) || !qualified(attrName) || names.has(attrName)) return false;
      names.add(attrName);
      if (attrName.startsWith("xmlns:")) {
        const prefix = attrName.slice("xmlns:".length);
        const value = attr.value ? valueOf(attr.value) : "";
        if (value === "" || prefix === "xmlns" || (prefix === "xml") !== (value === XML_NAMESPACE)) return false;
        undo.push([prefix, scope.has(prefix) ? scope.get(prefix) : UNBOUND]);
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
      restore(undo);
      if (stack.length === 0) closed = true;
    } else stack.push({ name, undo });
  }
  return roots === 1 && stack.length === 0;
}

// Whether `text` is a well-formed XML document (see wellFormed).
function isWellFormedXml(text) {
  try {
    const work = { steps: 0 };
    return wellFormed(text, tokenize(text, true, work), work);
  } catch {
    return false;
  }
}

// `text` (which holds markup) with each secret of `rules` redacted by its tokens (see above), and
// where its markers stand: { output, markers }, the output `<redacted/>` when the body goes whole.
// `xml` picks XML tokenizing over HTML; `work` counts the steps taken.
function redactByTokens(text, rules, { xml, work }) {
  const whole = { output: MARKUP_WHOLE_MARKER, markers: [] };
  const tokens = tokenize(text, xml, work);
  // A doctype this reading doesn't model can make any text of its pieces; a page a browser reads
  // otherwise than the tokenizer, any of its words.
  if (tokens.doctype?.unsupported && couldSpell(text, rules, work)) return whole;
  if (tokens.unsure && exposes(text, rules, [], work, { loose: true, html: !xml })) return whole;
  const planned = plan(text, tokens, rules, work);
  if (planned.whole) return whole;
  if (planned.masked.size === 0 && planned.ranges.length === 0) return { output: text, markers: [] };
  const { output, markers } = apply(text, tokens, planned);
  const again = verified(output, xml, tokens, markers, rules, work);
  if (!again) return whole;
  // XML a parser read before must still read: a namespace, a reference or a tag the redaction
  // broke would otherwise lose the whole document for whoever reads it next.
  if (xml && wellFormed(text, tokens, work) && !wellFormed(output, again, work)) return whole;
  return { output, markers };
}

// `redact` (a redactor that gives { output, markers }, as redactByTokens does) with the final check
// that doesn't trust it: an output that shows a secret in any reading outside its markers (see
// exposes) goes whole, as `<redacted/>`.
function backstopped(redact) {
  return (text, rules, { xml = false, work = { steps: 0 } } = {}) => {
    try {
      const { output, markers } = redact(text, rules, { xml, work });
      if (output === MARKUP_WHOLE_MARKER) return output;
      return exposes(output, rules, markers, work, { html: !xml }) ? MARKUP_WHOLE_MARKER : output;
    } catch {
      // No tokenizer (it failed to load, or to read the text): only a text that holds no secret
      // and no entity can be shown as it is.
      const secret = [...rules.long, ...rules.short].some((value) => text.includes(value));
      return secret || text.includes("&") ? MARKUP_WHOLE_MARKER : text;
    }
  };
}

// `text` (which holds markup, or is an HTML or XML body) with each secret of `rules` redacted by its
// tokens (see above). `xml` picks XML tokenizing over HTML; `work`, when given, counts the steps.
const redactMarkup = backstopped(redactByTokens);

module.exports = { MARKUP_WHOLE_MARKER, backstopped, isMarkupType, isWellFormedXml, isXmlBody, redactMarkup };
