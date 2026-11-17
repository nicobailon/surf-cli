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
      ["a", "<r a >y</r>", "<r a >y</r>"],
      ["a", '<r a="x" a >y</r>', '<r a="x" a >y</r>'],
      ["a b", '<r a b = "x"/>', '<r a b = "x"/>'],
      ["r", `<r>${SHOP}</r>`, `<r>${SHOP}</r>`],
    ];
    const { actual, expected } = redactCases(cases);
    expect(actual).toEqual(expected);
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
      ["-->x", '<r><!-- ="-->x" <q/></r>', '<r><!-- ="-->x" <q/></r>'],
      ["--", "<r><!-- --><q/></r>", "<r><!-- --><q/></r>"],
      ["-->", "<r><!-- --> <q/></r>", "<r><!-- --> <q/></r>"],
      ["]]", "<r><![CDATA[ ]]><q/></r>", "<r><![CDATA[ ]]><q/></r>"],
      ["]]>x", '<r><![CDATA[ ="]]>x" <q/></r>', '<r><![CDATA[ ="]]>x" <q/></r>'],
      ["x--", "<r><!-- x--><q/></r>", `<r><!--${PLAIN}--><q/></r>`],
      ["x]]", "<r><![CDATA[ x]]><q/></r>", `<r><![CDATA[${PLAIN}]]><q/></r>`],
    ]);
    expect(actual).toEqual(expected);
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
      ["a", '<r v="a = z"/>', '<r v="a = z"/>'],
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
    const body = `<r><script>a<b>${SHOP}</b></script></r>`;
    // HTML reads a script's text as raw text, where the secret is no whole word; XML reads tags in it.
    expect(redact(SHOP, body)).toBe(body);
    expect(redact(SHOP, body, XML)).toBe(`<r><script>a<b>${MARK}</b></script></r>`);
    expect(redact(SHOP, `<?xml version="1.0"?>${body}`)).toBe(
      `<?xml version="1.0"?><r><script>a<b>${MARK}</b></script></r>`,
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
        `<!DOCTYPE r [<!ENTITY x "${MARK}">]><r a="${MARK}">${MARK}</r>`,
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
