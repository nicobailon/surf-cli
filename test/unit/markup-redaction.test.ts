import { describe, expect, it } from "vitest";

const { spawnSync } = require("node:child_process");
const path = require("node:path");
const exporter = require("../../native/network-export.cjs");

// Dummy values, built from parts so no literal here reads as a credential.
const SHOP = ["sh", "op"].join("");
const LONG = ["lo", "ng"].join("");
// The one marker markup gets, in every context: it has no `<`, `>`, quote, `&`, `]`, `-`, `/`, `=`,
// backtick or space, so it can't open, close or end anything wherever it stands.
const MARK = "(redacted)";
const PLAIN = MARK;

const redact = (secret: string, body: string, responseHeaders: Record<string, string> = {}) =>
  exporter.publicEntry({
    id: "r-t",
    url: "https://example.test/api",
    requestHeaders: { "x-csrf-token": secret },
    responseHeaders,
    responseBody: body,
  }).responseBody;
const XML = { "content-type": "application/xml" };

type Parsed = { xml: string; html: unknown[]; text: string[] };
// What Python's XML parser (expat) and HTML parser read in each text: "valid" or the XML error, the
// HTML parser's tags, attributes (entities decoded), comments and CDATA in order, and its text.
const parseMarkup = (texts: string[]): Parsed[] => {
  const script = [
    "import json, sys, xml.etree.ElementTree as ET",
    "from html.parser import HTMLParser",
    "class Events(HTMLParser):",
    "    def __init__(self):",
    "        super().__init__(convert_charrefs=True); self.events = []; self.text = []; self.run = None",
    // Text the parser hands over in pieces, between the same two tags, is one text.
    "    def event(self, item):",
    "        if self.run is not None: self.text.append(self.run); self.run = None",
    "        if item: self.events.append(item)",
    "    def handle_starttag(self, tag, attrs): self.event(['start', tag, attrs])",
    "    def handle_endtag(self, tag): self.event(['end', tag])",
    "    def handle_startendtag(self, tag, attrs): self.event(['self', tag, attrs])",
    "    def handle_comment(self, data): self.event(['comment', data])",
    "    def unknown_decl(self, data): self.event(['decl', data])",
    "    def handle_data(self, data): self.run = (self.run or '') + data",
    "out = []",
    "for text in json.load(sys.stdin):",
    "    try:",
    "        ET.fromstring(text); xml = 'valid'",
    "    except ET.ParseError as error:",
    "        xml = str(error)",
    "    parser = Events(); parser.feed(text); parser.close(); parser.event(None)",
    "    out.append({'xml': xml, 'html': parser.events, 'text': parser.text})",
    "print(json.dumps(out))",
  ].join("\n");
  const result = spawnSync("python3", ["-I", "-c", script], {
    input: JSON.stringify(texts),
    encoding: "utf8",
    maxBuffer: 1e8,
  });
  if (result.status !== 0) {
    throw new Error(`python3 failed: ${result.error || result.stderr}`);
  }
  return JSON.parse(result.stdout);
};
// The tags a parse holds, with how many attributes each has, and its comments and declarations.
const shape = ({ html }: Parsed) =>
  html.map((event) => {
    const [kind, name, attrs] = event as [string, string, unknown[] | undefined];
    return kind === "comment" || kind === "decl" ? kind : [kind, name, attrs?.length ?? 0];
  });

// Each [secret, body, expected], redacted: the outputs, the tags each parses to, and whether each is
// valid XML where its body is; and the same as the cases expect them, with the body's tags.
const redactCases = (cases: [string, string, string][], headers: Record<string, string> = {}) => {
  const outputs = cases.map(([secret, body]) => redact(secret, body, headers));
  const inputs = parseMarkup(cases.map(([, body]) => body));
  const parsed = parseMarkup(outputs);
  const validWhere = (list: Parsed[]) =>
    list.map((item, index) => (inputs[index].xml === "valid" ? item.xml : "not XML"));
  return {
    actual: { outputs, tags: parsed.map(shape), xml: validWhere(parsed) },
    expected: {
      outputs: cases.map(([, , expected]) => expected),
      tags: inputs.map(shape),
      xml: validWhere(inputs),
    },
  };
};

describe("markup echoes redacted by their tokens", () => {
  it("renames a secret attribute name of 4 characters or more to a valid XML name, numbered when taken", () => {
    const { actual, expected } = redactCases([
      [SHOP, `<r ${SHOP} = "x"/>`, '<r redacted = "x"/>'],
      [SHOP, `<r ${SHOP}="x"/>`, '<r redacted="x"/>'],
      [SHOP, `<r ${SHOP}>y</r>`, "<r redacted>y</r>"],
      [
        SHOP,
        `<r ${SHOP} = "first" redacted="second"/>`,
        '<r redacted-2 = "first" redacted="second"/>',
      ],
      [SHOP, `<?xml version="1.0"?><r ${SHOP} = "x"/>`, '<?xml version="1.0"?><r redacted = "x"/>'],
    ]);
    expect(actual).toEqual(expected);
  });

  it("never renames a name shorter than 4 characters, bare or before a value", () => {
    const cases: [string, string, string][] = [
      ["a", '<r a="x">y</r>', '<r a="x">y</r>'],
      ["a", "<r a>y</r>", "<r a>y</r>"],
      ["r", `<r>${SHOP}</r>`, `<r>${SHOP}</r>`],
    ];
    const { actual, expected } = redactCases(cases);
    expect(actual).toEqual(expected);
    // One that stands between spaces reads as a word to the final check, which can't tell a name
    // from text: the body goes whole rather than the name being renamed.
    expect(redact("a", "<r a >y</r>")).toBe("<redacted/>");
    expect(redact("a", '<r a="x" a >y</r>')).toBe("<redacted/>");
    expect(redact("a b", '<r a b = "x"/>')).toBe("<redacted/>");
  });

  it("masks the text a long secret touches across tags, keeping every tag", () => {
    const { actual, expected } = redactCases([
      [
        "x</textarea>y",
        "<textarea> x</textarea>y <b>ok</b>",
        `<textarea>${MARK}</textarea>${MARK}<b>ok</b>`,
      ],
      [`${LONG}</q>x`, `<r><q>${LONG}</q>x </r>`, `<r><q>${MARK}</q>${MARK}</r>`],
      [`${LONG}</r><q/>`, `<r> ${LONG}</r><q/>`, `<r>${MARK}</r><q/>`],
    ]);
    expect(actual).toEqual(expected);
  });

  it("keeps a comment or CDATA terminator a short secret shares, masking only the content it touches", () => {
    const { actual, expected } = redactCases([
      ["--", "<r><!-- --><q/></r>", "<r><!-- --><q/></r>"],
      ["]]", "<r><![CDATA[ ]]><q/></r>", "<r><![CDATA[ ]]><q/></r>"],
      ["x--", "<r><!-- x--><q/></r>", `<r><!--${PLAIN}--><q/></r>`],
      ["x]]", "<r><![CDATA[ x]]><q/></r>", `<r><![CDATA[${PLAIN}]]><q/></r>`],
    ]);
    expect(actual).toEqual(expected);
    // Quoted or spaced, the shared terminator reads as a word to the final check, which can't
    // tell it from text: the body goes whole, the delimiters never cut.
    for (const [secret, body] of [
      ["-->x", '<r><!-- ="-->x" <q/></r>'],
      ["-->", "<r><!-- --> <q/></r>"],
      ["]]>x", '<r><![CDATA[ ="]]>x" <q/></r>'],
    ]) {
      expect(redact(secret, body)).toBe("<redacted/>");
    }
  });

  it("matches text with its entities decoded, masking text that doesn't write the secret plainly", () => {
    const one = ["", "1"].join("");
    const { actual, expected } = redactCases([
      [SHOP, "<r>sh&#111;p</r>", `<r>${MARK}</r>`],
      [one, "<r>&#49;</r>", `<r>${MARK}</r>`],
      [one, "<r>&#x31;</r>", `<r>${MARK}</r>`],
      ["<", "<r> &lt; </r>", `<r>${MARK}</r>`],
      ["a&b", "<textarea>a&amp;b</textarea>", `<textarea>${MARK}</textarea>`],
      [SHOP, '<r value="sh&#0000000111;p"/>', `<r value="${MARK}"/>`],
      [SHOP, "<input value=sh&#111;p>", `<input value=${MARK}>`],
      // An entity that only looks like the secret's letters is not it.
      ["lt", "<r> &lt; </r>", "<r> &lt; </r>"],
    ]);
    expect(actual).toEqual(expected);
  });

  it("reads text before `=` as text, not as an attribute name", () => {
    const { actual, expected } = redactCases([
      ["a", "<r>say a = z</r>", `<r>say ${MARK} = z</r>`],
      ["a", "<r>a = a</r>", `<r>${MARK} = ${MARK}</r>`],
      // In a value it is a word too (the value rule: a whole value, or a word in one).
      ["a", '<r v="a = z"/>', `<r v="${MARK} = z"/>`],
    ]);
    expect(actual).toEqual(expected);
  });

  it("redacts a secret that holds markup characters inside one token, and the text it touches across tokens", () => {
    const { actual, expected } = redactCases([
      // Inside one token.
      ['x">y', '<r> x">y </r>', `<r> ${MARK} </r>`],
      ["-->x", "<r> -->x </r>", `<r> ${MARK} </r>`],
      ["a'b", '<r v="a\'b"/>', `<r v="${MARK}"/>`],
      ["a'b", "<r> a'b </r>", `<r> ${MARK} </r>`],
      ["]]>x", "<r> ]]&gt;x </r>", `<r>${MARK}</r>`],
      // Across tokens.
      ['x">y', '<r a=" x">y </r>', `<r a=" x">${MARK}</r>`],
      ["x<q/>y", "<r> x<q/>y </r>", `<r>${MARK}<q/>${MARK}</r>`],
      ["-->x", "<r><!-- -->x <q/></r>", `<r><!-- -->${MARK}<q/></r>`],
      ["]]>x", "<r><![CDATA[ ]]>x <q/></r>", `<r><![CDATA[ ]]>${MARK}<q/></r>`],
    ]);
    expect(actual).toEqual(expected);
  });

  it("masks a markup body that is a secret whole with a valid XML element", () => {
    const body = "<r/>";
    const output = redact(body, body);
    expect(output).toBe("<redacted/>");
    expect(parseMarkup([output])[0].xml).toBe("valid");
  });

  it("reads XML by its content type or declaration, and HTML otherwise", () => {
    const body = `<r><script><b ${SHOP}="1"/></script></r>`;
    // HTML reads a script's text as raw text, where the name is no word; XML reads tags in it.
    expect(redact(SHOP, body)).toBe(body);
    expect(redact(SHOP, body, XML)).toBe('<r><script><b redacted="1"/></script></r>');
    expect(redact(SHOP, `<?xml version="1.0"?>${body}`)).toBe(
      `<?xml version="1.0"?><r><script><b redacted="1"/></script></r>`,
    );
  });

  it("loads the tokenizer only for a body that holds markup", () => {
    const root = path.join(__dirname, "../..");
    const script = [
      `const exporter = require(${JSON.stringify(path.join(root, "native/network-export.cjs"))});`,
      `require(${JSON.stringify(path.join(root, "native/host-helpers.cjs"))});`,
      `require(${JSON.stringify(path.join(root, "native/record-candidates.cjs"))});`,
      `require(${JSON.stringify(path.join(root, "native/playbook-records.cjs"))});`,
      "const loaded = () => Object.keys(require.cache).some((file) => file.includes('htmlparser2'));",
      "const entry = (body) => exporter.publicEntry({ url: 'https://example.test/', requestHeaders: { 'x-csrf-token': 'value' }, responseBody: body });",
      "entry(JSON.stringify({ a: 'value' })); entry('say value now'); entry('a=value&b=1');",
      "const before = loaded();",
      "entry('<p>value</p>');",
      "console.log(JSON.stringify([before, loaded()]));",
    ].join("\n");
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual([false, true]);
  });

  it("masks the whole body when the tokenizer can't load and the body holds a secret or an entity", () => {
    const root = path.join(__dirname, "../..");
    const script = [
      "const Module = require('node:module');",
      "const resolve = Module._resolveFilename;",
      "Module._resolveFilename = function (request, ...rest) {",
      "  if (request === 'htmlparser2') throw new Error('not installed');",
      "  return resolve.call(this, request, ...rest);",
      "};",
      `const exporter = require(${JSON.stringify(path.join(root, "native/network-export.cjs"))});`,
      "const entry = (body) => exporter.publicEntry({ url: 'https://example.test/', requestHeaders: { 'x-csrf-token': 'value' }, responseBody: body }).responseBody;",
      "console.log(JSON.stringify([entry('<p>value</p>'), entry('<p>v&#97;lue</p>'), entry('<p>other</p>')]));",
    ].join("\n");
    const result = spawnSync(process.execPath, ["-e", script], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(JSON.parse(result.stdout)).toEqual(["<redacted/>", "<redacted/>", "<p>other</p>"]);
  });
});

// What expat reads in each XML text: its text and every attribute value, entities expanded, or the
// error that stops it.
const readXml = (texts: string[]): ({ text: string } | { error: string })[] => {
  const script = [
    "import json, sys, xml.etree.ElementTree as ET",
    "out = []",
    "for text in json.load(sys.stdin):",
    "    try:",
    "        root = ET.fromstring(text)",
    "        values = [v for e in root.iter() for v in e.attrib.values()]",
    "        out.append({'text': ' '.join([''.join(root.itertext())] + values)})",
    "    except ET.ParseError as error:",
    "        out.append({'error': str(error)})",
    "print(json.dumps(out))",
  ].join("\n");
  const result = spawnSync("python3", ["-I", "-c", script], {
    input: JSON.stringify(texts),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`python3 failed: ${result.error || result.stderr}`);
  }
  return JSON.parse(result.stdout);
};

describe("markup contexts a browser or an XML parser reads differently from the tokenizer", () => {
  const HTML_CASES: [string, string, string][] = [
    // A browser reads <script> inside <svg> or <math> as a foreign element: its entities decode.
    [SHOP, `<svg><script>${SHOP}</script></svg>`, `<svg><script>${MARK}</script></svg>`],
    [SHOP, "<svg><script>sh&#111;p</script></svg>", `<svg><script>${MARK}</script></svg>`],
    [SHOP, "<math><style>a sh&#111;p</style></math>", `<math><style>${MARK}</style></math>`],
    // In SVG a script holds tags, as the tokenizer reads them there.
    [
      SHOP,
      `<svg><g><script>x>${SHOP}<y</script></g></svg>`,
      `<svg><g><script>${MARK}<y</script></g></svg>`,
    ],
    // HTML reads <![CDATA[ as a comment that ends at the first `>`, so what follows it is page text.
    [SHOP, `<![CDATA[${SHOP}]]><b>ok</b>`, `<![CDATA[${MARK}]]><b>ok</b>`],
    [SHOP, "<![CDATA[x> sh&#111;p <b>ok</b>]]>", `<![CDATA[${MARK}]]>`],
    [SHOP, `<![CDATA[x>${SHOP}<b>ok</b>]]>`, `<![CDATA[${MARK}]]>`],
    // Bogus comments: `<?`, `<!x`, `</ x`.
    [SHOP, "<?x sh&#111;p>", `<?${MARK}>`],
    [SHOP, `<!x ${SHOP}>`, `<!${MARK}>`],
    [SHOP, `</ ${SHOP}>`, `</${MARK}>`],
  ];

  it("masks a secret, raw or decoded, in foreign content, HTML CDATA and bogus comments", () => {
    const outputs = HTML_CASES.map(([secret, body]) => redact(secret, body));
    expect(outputs).toEqual(HTML_CASES.map(([, , expected]) => expected));
  });

  it("decodes entities in every span, raw text and comments included", () => {
    const cases: [string, string, string, Record<string, string>?][] = [
      [SHOP, "<script>sh&#111;p</script>", `<script>${MARK}</script>`],
      [SHOP, "<style>a{} sh&#111;p</style>", `<style>${MARK}</style>`],
      [SHOP, "<!-- sh&#111;p -->", `<!--${MARK}-->`],
      [SHOP, "<r><![CDATA[ sh&#111;p ]]></r>", `<r><![CDATA[${MARK}]]></r>`, XML],
      [SHOP, '<r><?pi a="sh&#111;p"?></r>', `<r><?pi ${MARK}?></r>`, XML],
      [SHOP, `<r><?pi ${SHOP}?></r>`, `<r><?pi ${MARK}?></r>`, XML],
    ];
    const outputs = cases.map(([secret, body, , headers]) => redact(secret, body, headers));
    expect(outputs).toEqual(cases.map(([, , expected]) => expected));
  });

  it("uses one marker that can't open a tag or end a section in any context", () => {
    const outputs = [
      redact(SHOP, `<r>${SHOP}</r>`),
      redact(SHOP, `<r v="${SHOP}"/>`),
      redact(SHOP, `<script>${SHOP}</script>`),
      redact(SHOP, `<!-- ${SHOP} -->`),
      redact(SHOP, `<r><![CDATA[${SHOP}]]></r>`, XML),
      redact(SHOP, `<r><?pi ${SHOP}?></r>`, XML),
      redact(SHOP, `<!DOCTYPE html PUBLIC "${SHOP}">`),
    ];
    for (const output of outputs) {
      expect(output).toContain(MARK);
    }
    expect(MARK).not.toMatch(/[<>"'&\]\-/=`\s]/);
  });

  it("tokenizes XML whose tag names aren't ASCII", () => {
    const body = '<é v="sh&#111;p"/>';
    const output = redact(SHOP, body, XML);
    expect(output).toBe(`<é v="${MARK}"/>`);
    expect(readXml([output])).toEqual([{ text: ` ${MARK}` }]);
    // HTML reads it as text, whose entity decodes to the secret.
    expect(redact(SHOP, body)).toBe(MARK);
  });

  it("redacts a secret declared in an XML doctype, and the references to it", () => {
    const cases: [string, string, string][] = [
      [
        SHOP,
        `<!DOCTYPE r [<!ENTITY x "${SHOP}">]><r>&x;</r>`,
        `<!DOCTYPE r [<!ENTITY x "${MARK}">]><r>${MARK}</r>`,
      ],
      [
        SHOP,
        '<!DOCTYPE r [<!ENTITY x "sh&#111;p">]><r a="&x;">&x;</r>',
        // A reference in a declared value is read again where it's used, which this doesn't model.
        "<redacted/>",
      ],
      // The declared value holds part of it; the reference completes it.
      [
        SHOP,
        '<!DOCTYPE r [<!ENTITY x "sh">]><r>&x;op</r>',
        `<!DOCTYPE r [<!ENTITY x "sh">]><r>${MARK}</r>`,
      ],
      [
        SHOP,
        '<!DOCTYPE r [<!ENTITY x "sh">]><r v="&x;op"/>',
        `<!DOCTYPE r [<!ENTITY x "sh">]><r v="${MARK}"/>`,
      ],
      // A `>` inside a declared value doesn't end the doctype.
      [
        `${LONG}-secret-1`,
        `<!DOCTYPE r [<!ENTITY x "a>b">]><r>&x; ${LONG}-secret-1</r>`,
        `<!DOCTYPE r [<!ENTITY x "a>b">]><r>&x; ${MARK}</r>`,
      ],
      // A secret outside a quoted value can't be taken out of the doctype: the body goes.
      [SHOP, `<!DOCTYPE r [<!ENTITY ${SHOP} "x">]><r>&${SHOP};</r>`, "<redacted/>"],
    ];
    const outputs = cases.map(([secret, body]) => redact(secret, body, XML));
    expect(outputs).toEqual(cases.map(([, , expected]) => expected));
    const read = readXml(outputs);
    for (const [index, result] of read.entries()) {
      expect(result).not.toHaveProperty("error");
      expect("text" in result && result.text.includes(cases[index][0])).toBe(false);
    }
  });

  it("never renames a namespace declaration, masking the body instead", () => {
    const prefix = ["xml", "ns:p"].join("");
    const body = `<p:r ${prefix}="urn:x"/>`;
    expect(redact(prefix, body, XML)).toBe("<redacted/>");
    const bare = ["xml", "ns"].join("");
    expect(redact(bare, `<r ${bare}="urn:x"/>`, XML)).toBe("<redacted/>");
    // A prefixed attribute that isn't a declaration is renamed, and stays valid XML.
    const named = `p:${SHOP}`;
    const output = redact(named, `<r ${prefix}="urn:x" ${named}="1"/>`, XML);
    expect(output).toBe(`<r ${prefix}="urn:x" redacted="1"/>`);
    expect(readXml([output])[0]).not.toHaveProperty("error");
  });

  it("checks redacted XML is still well formed, with every prefix bound", () => {
    const { isWellFormedXml } = require("../../native/markup-redaction.cjs");
    expect(isWellFormedXml('<?xml version="1.0"?><r xmlns:p="u" a="1"><p:q/><!-- c --></r>')).toBe(
      true,
    );
    expect(isWellFormedXml('<!DOCTYPE r [<!ENTITY x "a>b">]><r>&x;&amp;&#49;</r>')).toBe(true);
    for (const bad of [
      '<p:r redacted="urn:x"/>',
      "<r><q></r>",
      "<r>",
      '<r a="1" a="2"/>',
      "<r a=1/>",
      "<r>&x;</r>",
      "<r><!-- a -- b --></r>",
      "<r/><r/>",
      "<r>a < b</r>",
      '<r xmlns:p="u" xmlns:q="u" p:a="1" q:a="2"/>',
    ]) {
      expect(isWellFormedXml(bad)).toBe(false);
    }
  });
});

describe("markup a browser or an XML parser reads past the tokenizer fails closed", () => {
  const WHOLE = "<redacted/>";
  const LONG_SECRET = ["alpha", "echo", "4826"].join("-");
  const HTML = { "content-type": "text/html" };
  const rulesOf = (secrets: string[]) => ({
    long: secrets.filter((value) => value.length >= 8),
    short: secrets.filter((value) => value.length < 8),
    whole: new Set(secrets),
    keys: new Set(secrets.filter((value) => value.length >= 4)),
  });
  const markup = require("../../native/markup-redaction.cjs");

  it("reads an HTML or XML body as markup by its content type, though it has no tag", () => {
    expect(redact(SHOP, "sh&#111;p", HTML)).toBe(MARK);
    expect(redact(LONG_SECRET, "alpha-ech&#111;-4826", HTML)).toBe(MARK);
    expect(redact(SHOP, "sh&#111;p", XML)).toBe(MARK);
    // Plain text has no entities to its readers.
    expect(redact(SHOP, "sh&#111;p", { "content-type": "text/plain" })).toBe("sh&#111;p");
  });

  it("redacts an HTML or XML body as markup though it also parses as JSON", () => {
    const encoded = `sh&#${"111"};p`;
    const encodedLong = `${LONG_SECRET.slice(0, 9)}&#${"111"};${LONG_SECRET.slice(10)}`;
    const cases: [string, string, Record<string, string>][] = [
      [SHOP, JSON.stringify(encoded), HTML],
      [SHOP, JSON.stringify({ x: encoded }), HTML],
      [SHOP, JSON.stringify([encoded]), HTML],
      [LONG_SECRET, JSON.stringify(encodedLong), HTML],
      [LONG_SECRET, JSON.stringify({ x: encodedLong }), HTML],
      [SHOP, JSON.stringify({ x: encoded }), XML],
    ];
    // Still JSON, as it came: the body a browser would read the secret from goes whole.
    expect(cases.map(([secret, body, type]) => redact(secret, body, type))).toEqual(
      cases.map(() => JSON.stringify("<redacted>")),
    );
    // A JSON value that is the secret goes as JSON redaction has it; the markup pass keeps the rest.
    expect(redact(SHOP, JSON.stringify({ x: SHOP, y: "ok" }), HTML)).toBe(
      JSON.stringify({ x: "<redacted>", y: "ok" }),
    );
    expect(redact(SHOP, JSON.stringify({ x: `a ${SHOP} b` }), HTML)).toBe(
      JSON.stringify({ x: `a ${MARK} b` }),
    );
  });

  it("reads HTML text with U+0000 dropped, as a browser builds it", () => {
    const NUL = String.fromCharCode(0);
    const split = `${SHOP.slice(0, 2)}${NUL}${SHOP.slice(2)}`;
    const splitLong = `${LONG_SECRET.slice(0, 5)}${NUL}${LONG_SECRET.slice(5)}`;
    expect(redact(SHOP, `<r>${split}</r>`, HTML)).toBe(`<r>${MARK}</r>`);
    expect(redact(SHOP, `<p>a ${split} b</p>`)).toBe(`<p>a ${MARK} b</p>`);
    expect(redact(SHOP, `<r>${NUL}${SHOP}</r>`)).toBe(`<r>${NUL}${MARK}</r>`);
    expect(redact(LONG_SECRET, `<r>${splitLong}</r>`)).toBe(`<r>${MARK}</r>`);
    // A browser reads U+0000 as U+FFFD in a value and in raw text, but the final check doesn't tell
    // contexts apart, so a word split there masks the body.
    for (const body of [`<r v="${split}"/>`, `<script>${split}</script>`]) {
      expect(redact(SHOP, body)).toBe(WHOLE);
    }
    // Not a word once joined: `x` + `shop`.
    expect(redact(SHOP, `<r>x${NUL}${SHOP}</r>`)).toBe(`<r>x${NUL}${SHOP}</r>`);
  });

  it("masks the document when a declared entity's value holds markup or a reference", () => {
    const bodies = [
      `<!DOCTYPE r [<!ENTITY x "<q ${SHOP}='v'>ok</q>">]><r>&x;</r>`,
      `<!DOCTYPE r [<!ENTITY x "<q ${SHOP}='v'/>">]><r>&x;</r>`,
      `<!DOCTYPE r [<!ENTITY x "<![CDATA[${SHOP}]]>">]><r>&x;</r>`,
      `<!DOCTYPE r [<!ENTITY x "<?${SHOP} ok?>">]><r>&x;</r>`,
      `<!DOCTYPE r [<!ENTITY x "&#60;q/&#62;${SHOP}">]><r>&x;</r>`,
    ];
    expect(bodies.map((body) => redact(SHOP, body, XML))).toEqual(bodies.map(() => WHOLE));
    // One that can't spell the secret in any reading stays.
    const plain = '<!DOCTYPE r [<!ENTITY x "<q/>">]><r>ok</r>';
    expect(redact(SHOP, plain, XML)).toBe(plain);
  });

  it("fails closed on a closing svg or math tag that doesn't match the open foreign element", () => {
    // A browser ignores `</math>` inside <svg>, so the script is SVG and its <r> a real element.
    expect(redact(SHOP, `<svg></math><script><r a=${SHOP}></r></script>`)).toBe(WHOLE);
    expect(redact(SHOP, `<svg></math><script><r>${SHOP}</r></script>`)).toBe(WHOLE);
    // One that matches an open foreign element closes it and those inside it, as a browser does.
    expect(redact(SHOP, `<svg><g></svg><p>${SHOP}</p>`)).toBe(`<svg><g></svg><p>${MARK}</p>`);
    expect(redact(SHOP, "<svg></math><p>ok</p>")).toBe("<svg></math><p>ok</p>");
  });

  it("masks an srcdoc value whose document holds a secret, decoded any number of times", () => {
    const frame = (value: string) => `<iframe srcdoc="${value}"></iframe>`;
    const cases: [string, string, string][] = [
      [SHOP, frame("&lt;r&gt;sh&amp;#111;p&lt;/r&gt;"), frame(MARK)],
      [LONG_SECRET, frame("&lt;r&gt;alpha-ech&amp;#111;-4826&lt;/r&gt;"), frame(MARK)],
      [SHOP, frame("&lt;r&gt;sh&amp;amp;amp;#111;p&lt;/r&gt;"), frame(MARK)],
      [SHOP, frame(`&lt;p title=${SHOP}&gt;`), frame(MARK)],
      [SHOP, frame("&lt;p&gt;ok&lt;/p&gt;"), frame("&lt;p&gt;ok&lt;/p&gt;")],
    ];
    const outputs = cases.map(([secret, body]) => redact(secret, body));
    expect(outputs).toEqual(cases.map(([, , expected]) => expected));
  });

  it("masks the whole document when its doctype uses a feature it doesn't model", () => {
    const bodies = [
      // A parameter entity declares another entity.
      `<!DOCTYPE r [<!ENTITY % x "<!ENTITY y 'sh'>">%x;]><r>&y;op</r>`,
      `<!DOCTYPE r [<!ENTITY % x "<!ENTITY y 'sh&#111;p'>">%x;]><r>&y;</r>`,
      // An NMTOKEN attribute's value is read with its spaces trimmed.
      `<!DOCTYPE r [<!ATTLIST r v NMTOKEN #IMPLIED>]><r v=" sh&#111;p "/>`,
      // A processing instruction whose data holds `]>`.
      `<!DOCTYPE r [<?pi ]> ?><!ENTITY x "sh">]><r>&x;op</r>`,
      `<!DOCTYPE r [<?pi ]> ?><!ENTITY x "sh&#111;p">]><r>&x;</r>`,
    ];
    expect(bodies.map((body) => redact(SHOP, body, XML))).toEqual(bodies.map(() => WHOLE));
    // One that can't spell the secret in any reading stays.
    const plain = '<!DOCTYPE r [<!ATTLIST r v CDATA "x">]><r v="y"/>';
    expect(redact(SHOP, plain, XML)).toBe(plain);
  });

  it("never rewrites the XML declaration, masking the body instead", () => {
    const cases: [string, string][] = [
      ["1.0", '<?xml version="1.0"?><r/>'],
      ["UTF-8", '<?xml version="1.0" encoding="UTF-8"?><r/>'],
      ["yes", '<?xml version="1.0" standalone="yes"?><r/>'],
    ];
    expect(cases.map(([secret, body]) => redact(secret, body, XML))).toEqual(
      cases.map(() => WHOLE),
    );
  });

  it("masks the body when a secret touches a namespace declaration's value", () => {
    // Rewritten, `p` would bind the namespace `q` binds, written with entities.
    const collide = `<r xmlns:p="${SHOP}" xmlns:q="&#40;redacted&#41;" p:x="1" q:x="2"/>`;
    expect(redact(SHOP, collide, XML)).toBe(WHOLE);
    const space = ["http://www.w3.org/XML/1998/", "namespace"].join("");
    const encoded = `<r xmlns:xml="${space.replace("namespace", "name&#115;pace")}" xml:lang="en"/>`;
    expect(redact(space, encoded, XML)).toBe(WHOLE);
    // The checker reads a namespace as decoded.
    expect(markup.isWellFormedXml(encoded)).toBe(true);
    expect(markup.isWellFormedXml('<r xmlns:p="u" xmlns:q="&#117;" p:a="1" q:a="2"/>')).toBe(false);
  });

  it("checks nested namespace declarations in linear time and memory", () => {
    const nested = (count: number) =>
      `${Array.from({ length: count }, (_, index) => `<r xmlns:p${index}="u${index}">`).join("")}${SHOP}${"</r>".repeat(count)}`;
    const [small, large] = [1500, 6000].map((count) => {
      const work = { steps: 0 };
      const started = performance.now();
      const output = markup.redactMarkup(nested(count), rulesOf([SHOP]), { xml: true, work });
      return { output, steps: work.steps, ms: performance.now() - started };
    });
    expect(large.output).toBe(nested(6000).replace(SHOP, MARK));
    // Four times the declarations take about four times the steps; a scope copied per element
    // took 5.5 s or more for 6,000.
    expect(large.steps / small.steps).toBeLessThan(5);
    expect(large.ms).toBeLessThan(2000);
  });

  it("redacts a short secret that stands as a word inside a quoted value", () => {
    // The value rule: a short secret goes from a value when it is the whole value, and also where
    // it stands as a word in it, as in free text (this replaces keeping a quoted subword, as in
    // the reviewer's worker-quoted-subword and extra-boundary-9).
    const { actual, expected } = redactCases([
      [SHOP, `<r title="a ${SHOP} b"/>`, `<r title="a ${MARK} b"/>`],
      [SHOP, `<r x="abc'${SHOP}'def"/>`, `<r x="abc'${MARK}'def"/>`],
      [SHOP, `<r x="&quot;${SHOP}&quot;"/>`, `<r x="&quot;${MARK}&quot;"/>`],
      [SHOP, `<r x="a-${SHOP}"/>`, `<r x="a-${SHOP}"/>`],
    ]);
    expect(actual).toEqual(expected);
  });

  it("redacts the secret 0 from an SVG viewBox word by word, and the page still parses", () => {
    const body = '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';
    const { actual, expected } = redactCases([
      ["0", body, `<svg viewBox="${MARK} ${MARK} 24 24"><path d="M0 0h24v24H0z"/></svg>`],
    ]);
    expect(actual).toEqual(expected);
    expect(actual.xml).toEqual(["valid"]);
  });

  describe("the final check, which doesn't trust the tokenizer", () => {
    // A redactor that misses everything, or that marks what it was told to.
    const missesAll = (text: string, rules: object, options?: object) =>
      markup.backstopped((body: string) => ({ output: body, markers: [] }))(text, rules, options);
    const check = (secret: string, body: string) => missesAll(body, rulesOf([secret]));

    it("masks the body when a secret shows in any reading of the output", () => {
      const leaks: [string, string][] = [
        [SHOP, `<r>${SHOP}</r>`],
        [SHOP, `<p>a ${SHOP} b</p>`],
        [SHOP, `<r v="${SHOP}"/>`],
        [SHOP, "<r>sh&#111;p</r>"],
        [SHOP, "<r>sh&#x6F;p</r>"],
        [SHOP, '<iframe srcdoc="&lt;r&gt;sh&amp;#111;p&lt;/r&gt;"></iframe>'],
        [LONG_SECRET, `x${LONG_SECRET}y`],
        [LONG_SECRET, "<r>alpha-ech&amp;#111;-4826</r>"],
      ];
      expect(leaks.map(([secret, body]) => check(secret, body))).toEqual(leaks.map(() => WHOLE));
    });

    it("reads HTML text with U+0000 dropped, but not surf's own markers", () => {
      const NUL = String.fromCharCode(0);
      const split = (value: string, at: number) => `${value.slice(0, at)}${NUL}${value.slice(at)}`;
      for (const [secret, body] of [
        [SHOP, `<r>${split(SHOP, 2)}</r>`],
        [SHOP, `<r>${split(`sh&#${"111"};p`, 2)}</r>`],
        [SHOP, `<r>&${NUL}#${"111"};</r>`.replace("<r>", "<r>sh").replace("</r>", "p</r>")],
        [LONG_SECRET, `<r>${split(LONG_SECRET, 5)}</r>`],
      ]) {
        expect(check(secret, body)).toBe(WHOLE);
      }
      // XML has no such rule (a parser rejects U+0000).
      expect(
        missesAll(`<r>${split(LONG_SECRET, 5)}</r>`, rulesOf([LONG_SECRET]), { xml: true }),
      ).toBe(`<r>${split(LONG_SECRET, 5)}</r>`);
      // A marker between two halves is no NUL a browser drops.
      const halves = `<r>${SHOP.slice(0, 2)}${MARK}${SHOP.slice(2)}</r>`;
      const marked = markup.backstopped((text: string) => ({
        output: text,
        markers: [[5, 5 + MARK.length]],
      }));
      expect(marked(halves, rulesOf([SHOP]))).toBe(halves);
    });

    it("keeps a short secret that isn't a word, and anything inside its own markers", () => {
      const kept = [`<r>${SHOP}x</r>`, `<${SHOP}>`, `<r a=${SHOP}x/>`];
      expect(kept.map((body) => check(SHOP, body))).toEqual(kept);
      const marked = markup.backstopped((text: string) => ({
        output: text,
        markers: [[3, 3 + LONG_SECRET.length]],
      }));
      const inMarker = `<r>${LONG_SECRET}</r>`;
      expect(marked(inMarker, rulesOf([LONG_SECRET]))).toBe(inMarker);
    });

    it("grows linearly with the output", () => {
      const steps = (count: number) => {
        const work = { steps: 0 };
        missesAll("<p>a &amp;amp;lt; b</p>".repeat(count), rulesOf([SHOP, LONG_SECRET]), { work });
        return work.steps;
      };
      expect(steps(800) / steps(100)).toBeLessThan(10);
    });
  });
});

describe("markup redaction on unfinished and malformed markup", () => {
  const rules = (secrets: string[]) => ({
    long: secrets.filter((value) => value.length >= 8),
    short: secrets.filter((value) => value.length < 8),
    whole: new Set(secrets),
    keys: new Set(secrets.filter((value) => value.length >= 4)),
  });
  const work = (text: string, secrets: string[]) => {
    const counter = { steps: 0 };
    const { redactMarkup } = require("../../native/markup-redaction.cjs");
    const output = redactMarkup(text, rules(secrets), { work: counter });
    return { steps: counter.steps, output };
  };

  // Fragments that leave a tag, a value, a comment, CDATA, an entity or raw text unfinished.
  const unfinished: [string, string, string[]][] = [
    ["open tag", `<p ${'a="x" '.repeat(10)}`, [SHOP]],
    ["unclosed values", `<p a='x b="${SHOP} ${SHOP}   = `, [SHOP]],
    ["comments", `<!-- ${SHOP} <!-- -`, [SHOP]],
    ["cdata", `<![CDATA[ ${SHOP} ]]`, [SHOP]],
    ["entities", `<r>&#1&#x&amp ${SHOP}&#111;p </r`, [SHOP]],
    ["script", `<script>${SHOP} </scrip <`, [SHOP]],
    ["near misses", `<r>${"a".repeat(40)}</r>`, [`${"a".repeat(12)}b`]],
    ["short hits", "<r>a a a a a a a a a a</r>", ["a"]],
    ["crossing", `<b>${LONG}x</b>y${LONG}x</b>y`, [`${LONG}x</b>y`]],
  ];

  it.each(unfinished)("grows linearly with the input: %s", (_, fragment, secrets) => {
    const [small, large] = [100, 800].map((count) => work(fragment.repeat(count), secrets));
    expect(small.steps).toBeGreaterThan(0);
    // Eight times the input takes about eight times the steps and output; quadratic would be 64.
    expect(large.steps / small.steps).toBeLessThan(10);
    expect(large.output.length / small.output.length).toBeLessThan(10);
  });

  // A seeded generator of malformed markup, so a failure can be replayed.
  const random = (seed: number) => {
    let state = seed;
    return () => {
      state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
      return state / 2_147_483_648;
    };
  };
  const PIECES = [
    "<",
    "</",
    ">",
    "/>",
    "<r",
    "<q ",
    "</r>",
    "<!--",
    "-->",
    "--",
    "<![CDATA[",
    "]]>",
    "]]",
    '"',
    "'",
    "=",
    " ",
    "\n",
    "a",
    "x",
    "&amp;",
    "&#111;",
    "&lt;",
    "&",
    "<script>",
    "</script>",
    "<?",
    "?>",
    "<!",
    SHOP,
    "sh",
    "op",
    "-->x",
  ];
  const SECRETS = [SHOP, "a", "-->x", "x--", `${SHOP}${SHOP}x`];

  it("leaves no secret readable in random malformed markup, and keeps its tags", () => {
    const next = random(7);
    const bodies: [string, string][] = [];
    for (let index = 0; index < 400; index++) {
      const parts = Array.from(
        { length: 4 + Math.floor(next() * 24) },
        () => PIECES[Math.floor(next() * PIECES.length)],
      );
      const secret = SECRETS[Math.floor(next() * SECRETS.length)];
      bodies.push([secret, `<r>${parts.join("")}`]);
    }
    const outputs = bodies.map(([secret, body]) => redact(secret, body));
    const inputs = parseMarkup(bodies.map(([, body]) => body));
    const parsed = parseMarkup(outputs);
    const word = (text: string, secret: string) =>
      new RegExp(`(^|\\s)${secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`).test(text);
    const shows = (text: string, secret: string) => {
      const plain = text.replace(/<redacted\/>|<redacted>|redacted(-\d+)?/g, "\u0000");
      return secret.length >= 8 ? plain.includes(secret) : word(plain, secret);
    };
    // What a parse's tags, comments, attribute values and names show of the secret.
    const shown = (secret: string, { html }: Parsed) =>
      html.flatMap((event) => {
        const [kind, data, attrs] = event as [
          string,
          string,
          [string, string | null][] | undefined,
        ];
        const comment = kind === "comment" && shows(data, secret) ? ["comment"] : [];
        const values = (attrs ?? []).flatMap(([name, value]) => [
          ...(value === secret ? ["value"] : []),
          ...(secret.length >= 4 && name === secret ? ["name"] : []),
        ]);
        return [...comment, ...values];
      });
    // What is wrong with one output: lost tags, invalid XML, or a secret it still shows.
    const problems = (secret: string, input: Parsed, output: Parsed, whole: boolean) => [
      ...(!whole && JSON.stringify(shape(output)) !== JSON.stringify(shape(input)) ? ["tags"] : []),
      ...(input.xml === "valid" && output.xml !== "valid" ? ["xml"] : []),
      ...(output.text.some((text) => shows(text, secret)) ? ["text"] : []),
      ...shown(secret, output),
    ];
    // HTML reads CDATA as a comment that ends at its first `>`, SVG as CDATA to `]]>`: one that
    // holds the secret is masked whole, with the tags the tokenizer read inside it.
    const masksCdata = (body: string, output: string) =>
      body.includes("<![CDATA[") && /<!(\[CDATA\[)?\(redacted\)/.test(output);
    const failures = parsed.flatMap((output, index) => {
      const [secret, body] = bodies[index];
      const whole = outputs[index] === "<redacted/>" || masksCdata(body, outputs[index]);
      const found = problems(secret, inputs[index], output, whole);
      return found.length > 0 ? [{ secret, body, output: outputs[index], found }] : [];
    });
    expect(failures).toEqual([]);
  });
});
