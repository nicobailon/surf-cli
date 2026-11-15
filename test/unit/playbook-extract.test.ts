import { afterEach, describe, expect, it, vi } from "vitest";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const playbooks = require("../../native/playbooks.cjs");
const runtime = require("../../native/playbook-runtime.cjs");
const records = require("../../native/records.cjs");
const extract = require("../../native/playbook-extract.cjs");
const clients = require("../../native/playbook-client.cjs");
const tempDirs: string[] = [];

afterEach(() => {
  for (const directory of tempDirs.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function tempDir(prefix: string) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

type FakeNode = {
  text?: string;
  attrs?: Record<string, string>;
  children?: Record<string, FakeNode[]>;
};

/** A parsed document: elements answer the selectors listed in `children`, and `href` resolves against its <base>. */
function fakeDocument(root: FakeNode) {
  const doc: Record<string, any> = { baseURI: "https://tab.test/current" };
  const element = (node: FakeNode): Record<string, unknown> => {
    const attrs = { ...(node.attrs || {}) };
    const self: Record<string, unknown> = {
      textContent: node.text ?? "",
      getAttribute: (name: string) => attrs[name] ?? null,
      setAttribute: (name: string, value: string) => {
        attrs[name] = value;
      },
      querySelector: (selector: string) => select(node, selector)[0] ?? null,
      querySelectorAll: (selector: string) => select(node, selector),
    };
    if (attrs.href !== undefined) {
      Object.defineProperty(self, "href", { get: () => new URL(attrs.href, doc.baseURI).href });
    }
    if (attrs.value !== undefined) {
      self.value = attrs.value;
    }
    return self;
  };
  const select = (node: FakeNode, selector: string) => {
    if (selector.includes("!!")) {
      throw new SyntaxError(`'${selector}' is not a valid selector`);
    }
    return (node.children?.[selector] || []).map(element);
  };
  doc.querySelector = (selector: string) => select(root, selector)[0] ?? null;
  doc.querySelectorAll = (selector: string) => select(root, selector);
  doc.createElement = () => {
    const base: Record<string, unknown> = {};
    base.setAttribute = (_name: string, value: string) => {
      base.href = value;
    };
    return base;
  };
  doc.head = {
    prepend: (base: { href: string }) => {
      doc.baseURI = base.href;
    },
  };
  return doc;
}

const books: FakeNode = {
  children: {
    "article.product_pod": [
      {
        children: {
          "h3 a": [
            {
              text: "A Light in the ...",
              attrs: { title: "A Light in the Attic", href: "a-light_1000/index.html" },
            },
          ],
          ".price_color": [{ text: "\n    £51.77\n  " }],
        },
      },
      {
        children: {
          "h3 a": [
            {
              text: "Tipping",
              attrs: { title: "Tipping the Velvet", href: "tipping_999/index.html" },
            },
          ],
          ".price_color": [{ text: "£53.74" }],
        },
      },
    ],
    "input[name=RID]": [{ attrs: { value: "RID-123" } }],
  },
};

/** Runs the page script of a network strategy against a fake fetch and DOMParser. */
function fakeTab(html: string, doc: Record<string, unknown>) {
  const fetchImpl = vi.fn(async (url: string) => ({
    status: 200,
    ok: true,
    url,
    headers: new Headers({ "content-type": "text/html" }),
    text: async () => html,
  }));
  class DOMParser {
    parseFromString(text: string, type: string) {
      if (text !== html || type !== "text/html") {
        throw new Error(`parsed ${type}: ${text}`);
      }
      return doc;
    }
  }
  const executeTool = vi.fn(async (tool: string, args: { code: string }) => {
    if (tool !== "javascript_tool") {
      return { success: true };
    }
    const value = await new Function(
      "fetch",
      "DOMParser",
      "location",
      "document",
      `return ${args.code}`,
    )(fetchImpl, DOMParser, { href: "https://books.test/" }, doc);
    return { output: JSON.stringify(value) };
  });
  return { executeTool, fetchImpl };
}

const htmlExtract = {
  html: {
    item: "article.product_pod",
    fields: { title: "h3 a@title", price: ".price_color", url: "h3 a@href" },
  },
};

function op(run: unknown[], extra: Record<string, unknown> = {}) {
  return { id: "get_books", effect: "read", args: {}, run, ...extra };
}

describe("extracting records from JSON", () => {
  it("picks the records array, renames nested fields and keeps only matching records", () => {
    const body = {
      data: {
        items: [
          { __typename: "Product", name: "Lamp", price: { current: 10 }, id: { walmart: "w1" } },
          { __typename: "Ad", name: "Sponsored" },
          { __typename: "Product", name: "Desk", price: { current: 99 }, id: { walmart: "w2" } },
        ],
      },
    };
    expect(
      records.extractRecords(body, {
        records: "$.data.items",
        fields: { title: "name", price: "price.current", id: "id.walmart" },
        filter: { __typename: "Product" },
      }),
    ).toEqual([
      { title: "Lamp", price: 10, id: "w1" },
      { title: "Desk", price: 99, id: "w2" },
    ]);
  });

  it("renames fields of the whole body when no records path is given", () => {
    const body = { search: { hits: [{ name: "Carbone" }] }, meta: { total: 7 } };
    expect(
      records.extractRecords(body, { fields: { restaurants: "search.hits", total: "meta.total" } }),
    ).toEqual({ restaurants: [{ name: "Carbone" }], total: 7 });
    expect(
      records.extractRecords([{ id: 1, x: 2 }], { records: "$", fields: { key: "id" } }),
    ).toEqual([{ key: 1 }]);
  });

  it("fails clearly when the records path is missing or not an array", () => {
    expect(() => records.extractRecords({ data: {} }, { records: "$.data.items" })).toThrow(
      /extract records \$\.data\.items is not an array \(found undefined\)/,
    );
    expect(() =>
      records.extractRecords({ data: { items: 3 } }, { records: "$.data.items" }),
    ).toThrow(/not an array \(found number\)/);
  });

  it("applies the extract in a network strategy run", async () => {
    const result = await runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op: op([
        {
          using: "network",
          request: { method: "GET", url: "/api" },
          extract: { records: "$.hits", fields: { name: "venue.name" } },
        },
      ]),
      executeTool: async () => ({
        output: JSON.stringify({
          ok: true,
          status: 200,
          bodyJson: { hits: [{ venue: { name: "A" } }, { venue: { name: "B" } }] },
        }),
      }),
    });
    expect(result.value).toEqual([{ name: "A" }, { name: "B" }]);
  });
});

describe("the tab's output for a JSON extract", () => {
  it("leaves out the response text, which the tab's 50,000-character output limit would cut", async () => {
    const outputs: Record<string, unknown>[] = [];
    const body = JSON.stringify({ hits: [{ name: "A" }] });
    const executeTool = async (_tool: string, args: { code: string }) => {
      const fetchImpl = async (url: string) => ({
        status: 200,
        ok: true,
        url,
        headers: new Headers({ "content-type": "application/json" }),
        text: async () => body,
      });
      const value = await new Function("fetch", "location", `return ${args.code}`)(fetchImpl, {
        href: "https://api.test/",
      });
      outputs.push(value);
      return { output: JSON.stringify(value) };
    };
    const result = await runtime.runPlaybookOp({
      playbook: { id: "fixture", provenance: { scope: "test" } },
      op: op([
        {
          using: "network",
          request: { method: "GET", url: "https://api.test/search" },
          extract: { records: "$.hits", fields: { title: "name" } },
        },
      ]),
      executeTool,
    });
    expect(result.value).toEqual([{ title: "A" }]);
    expect(outputs[0]).toMatchObject({ status: 200, bodyJson: { hits: [{ name: "A" }] } });
    expect(outputs[0]).not.toHaveProperty("body");
  });
});

describe("extracting records from HTML", () => {
  it("parses a network strategy's HTML body in the tab and returns records, not the body", async () => {
    const html = "<html><body>books</body></html>";
    const tab = fakeTab(html, fakeDocument(books));
    const result = await runtime.runPlaybookOp({
      playbook: { id: "books", provenance: { scope: "test" } },
      op: op([
        {
          using: "network",
          request: { method: "GET", url: "https://books.test/catalogue/page-1.html" },
          extract: htmlExtract,
        },
      ]),
      executeTool: tab.executeTool,
    });
    expect(result.strategy).toBe("network");
    expect(result.value).toEqual([
      {
        title: "A Light in the Attic",
        price: "£51.77",
        url: "https://books.test/catalogue/a-light_1000/index.html",
      },
      {
        title: "Tipping the Velvet",
        price: "£53.74",
        url: "https://books.test/catalogue/tipping_999/index.html",
      },
    ]);
    const output = await tab.executeTool.mock.results[0].value;
    expect(JSON.parse(output.output)).not.toHaveProperty("body");
  });

  it("pulls a single value out of HTML", async () => {
    const tab = fakeTab("<form></form>", fakeDocument(books));
    const result = await runtime.runPlaybookOp({
      playbook: { id: "blast", provenance: { scope: "test" } },
      op: op([
        {
          using: "network",
          request: { method: "GET", url: "https://blast.test/Blast.cgi" },
          extract: { html: { value: "input[name=RID]@value" } },
        },
      ]),
      executeTool: tab.executeTool,
    });
    expect(result.value).toBe("RID-123");
  });

  it("names the field whose selector the page rejects", async () => {
    const tab = fakeTab("<p></p>", fakeDocument(books));
    await expect(
      runtime.runPlaybookOp({
        playbook: { id: "books", provenance: { scope: "test" } },
        op: op([
          {
            using: "network",
            request: { method: "GET", url: "https://books.test/" },
            extract: { html: { item: "article", fields: { title: "h3 !! a" } } },
          },
        ]),
        executeTool: tab.executeTool,
      }),
    ).rejects.toThrow(/extract field title has an invalid selector: h3 !! a/);
  });

  it("runs the same extraction on the page a workflow strategy ends on", async () => {
    const doc = fakeDocument(books);
    doc.baseURI = "https://books.test/catalogue/page-1.html";
    const tab = fakeTab("", doc);
    const result = await runtime.runPlaybookOp({
      playbook: { id: "books", provenance: { scope: "test" } },
      op: op([
        {
          using: "workflow",
          steps: [{ cmd: "navigate", args: { url: "https://books.test/catalogue/page-1.html" } }],
          stepDelay: 0,
          autoWait: false,
          extract: htmlExtract,
        },
      ]),
      executeTool: tab.executeTool,
      sleep: vi.fn(),
    });
    expect(result.strategy).toBe("workflow");
    expect(result.value).toHaveLength(2);
    expect(result.value[0]).toEqual({
      title: "A Light in the Attic",
      price: "£51.77",
      url: "https://books.test/catalogue/a-light_1000/index.html",
    });
    expect(tab.fetchImpl).not.toHaveBeenCalled();
  });
});

describe("validating an op's extract", () => {
  const validate = (strategy: Record<string, unknown>) =>
    playbooks.validateOp(
      op([{ using: "network", request: { url: "https://x.test/" }, ...strategy }]),
      {
        origins: [],
      },
    );

  it("accepts HTML records, a single HTML value and JSON records", () => {
    expect(() => validate({ extract: htmlExtract })).not.toThrow();
    expect(() => validate({ extract: { html: { value: "input[name=RID]@value" } } })).not.toThrow();
    expect(() =>
      validate({
        extract: {
          records: "$.data.items",
          fields: { id: "id.walmart" },
          filter: { __typename: "Product" },
        },
      }),
    ).not.toThrow();
  });

  it("rejects malformed selectors, paths and mixes", () => {
    expect(() =>
      validate({ extract: { html: { item: "article[", fields: { t: "h3" } } } }),
    ).toThrow(/op get_books extract: html item has an unbalanced selector: article\[/);
    expect(() =>
      validate({ extract: { html: { item: "article", fields: { t: "h3 a@" } } } }),
    ).toThrow(/extract: html field t/);
    expect(() => validate({ extract: { html: { item: "article" } } })).toThrow(
      /html fields must map at least one field/,
    );
    expect(() =>
      validate({ extract: { html: { item: "article", value: "h1", fields: { t: "h1" } } } }),
    ).toThrow(/html takes item and fields, or value/);
    expect(() => validate({ extract: { records: "data.items" } })).toThrow(
      /records must be a path starting with \$/,
    );
    expect(() => validate({ extract: { records: "$.data..items" } })).toThrow(/bad segment/);
    expect(() => validate({ extract: { fields: { id: "a..b" } } })).toThrow(/bad segment/);
    expect(() => validate({ extract: { html: htmlExtract.html, records: "$" } })).toThrow(
      /extract cannot combine html with records, fields or filter/,
    );
    expect(() => validate({ extract: { rename: {} } })).toThrow(/unknown key "rename"/);
    expect(() =>
      playbooks.validateOp(
        op([
          {
            using: "api",
            match: "/api/*",
            records: { find: { exists: ["id"] }, key: "id", fields: { id: "id" } },
            extract: htmlExtract,
          },
        ]),
        { origins: [] },
      ),
    ).toThrow(/extract.html works only on network and workflow strategies/);
  });
});

function writeOp(base: string, run: unknown[]) {
  const directory = path.join(base, ".surf", "playbooks", "books");
  fs.mkdirSync(path.join(directory, "ops"), { recursive: true });
  fs.writeFileSync(
    path.join(directory, "playbook.json"),
    JSON.stringify({ id: "books", version: "1.0.0", origins: ["https://books.test"] }),
  );
  const file = path.join(directory, "ops", "get_books.json");
  fs.writeFileSync(file, `${JSON.stringify({ id: "get_books", effect: "read", run }, null, 2)}\n`);
  return file;
}

describe("surf pb extract", () => {
  const network = {
    using: "network",
    request: { method: "GET", url: "https://books.test/catalogue/page-1.html" },
  };
  const workflow = {
    using: "workflow",
    steps: [{ tool: "navigate", args: { url: "https://books.test/" } }],
  };

  it("parses HTML, single-value and JSON flags", () => {
    expect(
      extract.parseExtractArgs([
        "books",
        "get_books",
        "--item",
        "article.product_pod",
        "--field",
        "title=h3 a@title",
        "--field",
        "price=.price_color",
      ]),
    ).toEqual({
      playbook: "books",
      op: "get_books",
      extract: {
        html: {
          item: "article.product_pod",
          fields: { title: "h3 a@title", price: ".price_color" },
        },
      },
      options: {},
    });
    expect(
      extract.parseExtractArgs(["blast", "submit", "--value", "input[name=RID]@value"]).extract,
    ).toEqual({
      html: { value: "input[name=RID]@value" },
    });
    expect(
      extract.parseExtractArgs([
        "walmart",
        "search",
        "--records",
        "$.data.items",
        "--field",
        "id=id.walmart",
        "--filter",
        "__typename=Product",
        "--strategy",
        "network",
        "--json",
      ]),
    ).toEqual({
      playbook: "walmart",
      op: "search",
      extract: {
        records: "$.data.items",
        fields: { id: "id.walmart" },
        filter: { __typename: "Product" },
      },
      options: { strategy: "network", json: true },
    });
    expect(() => extract.parseExtractArgs(["books", "get_books", "--field", "title"])).toThrow(
      /--field needs name=source/,
    );
    expect(() => extract.parseExtractArgs(["books", "get_books"])).toThrow(
      /Usage: surf pb extract/,
    );
    expect(() =>
      extract.parseExtractArgs([
        "books",
        "get_books",
        "--item",
        "a",
        "--field",
        "t=h3",
        "--filter",
        "x=y",
      ]),
    ).toThrow(/--filter works on JSON records only/);
  });

  it("sets the extract on the network and workflow strategies, saves it and prints a diff", () => {
    const cwd = tempDir("surf-extract-cwd-");
    const home = tempDir("surf-extract-home-");
    const file = writeOp(cwd, [network, workflow]);
    const result = extract.saveExtract({
      playbook: "books",
      op: "get_books",
      extract: htmlExtract,
      cwd,
      home,
    });
    expect(result.strategies).toEqual(["network", "workflow"]);
    expect(result.path).toBe(file);
    expect(result.diff).toContain('+      "extract": {');
    expect(result.diff).toContain('+            "title": "h3 a@title",');
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(saved.run.map((strategy: { extract?: unknown }) => strategy.extract)).toEqual([
      htmlExtract,
      htmlExtract,
    ]);
    expect(playbooks.resolveOp("books", "get_books", { cwd, home }).op.run[0].extract).toEqual(
      htmlExtract,
    );
  });

  it("puts JSON extracts on network strategies only, or the one --strategy names", () => {
    const cwd = tempDir("surf-extract-cwd-");
    const home = tempDir("surf-extract-home-");
    const file = writeOp(cwd, [network, workflow]);
    const json = { records: "$.items", fields: { id: "id" } };
    expect(
      extract.saveExtract({ playbook: "books", op: "get_books", extract: json, cwd, home })
        .strategies,
    ).toEqual(["network"]);
    expect(() =>
      extract.saveExtract({
        playbook: "books",
        op: "get_books",
        extract: json,
        strategy: "api",
        cwd,
        home,
      }),
    ).toThrow(/op get_books has no api strategy \(it has network, workflow\)/);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).run[1].extract).toBeUndefined();
  });

  it("leaves the op untouched when the extract is malformed or the playbook is built in", () => {
    const cwd = tempDir("surf-extract-cwd-");
    const home = tempDir("surf-extract-home-");
    const file = writeOp(cwd, [network]);
    const before = fs.readFileSync(file, "utf8");
    expect(() =>
      extract.saveExtract({
        playbook: "books",
        op: "get_books",
        extract: { html: { item: "article(", fields: { t: "h3" } } },
        cwd,
        home,
      }),
    ).toThrow(/unbalanced selector/);
    expect(fs.readFileSync(file, "utf8")).toBe(before);
    expect(() =>
      extract.saveExtract({ playbook: "x", op: "thread", extract: htmlExtract, cwd, home }),
    ).toThrow(/built-in playbook x can't be edited/);
  });
});

describe("generated clients and extract", () => {
  it("applies JSON records and renames without the browser", async () => {
    const parent = tempDir("surf-client-");
    const out = path.join(parent, "client");
    const result = clients.generateClient({
      playbookId: "lever",
      op: { id: "postings", effect: "read" },
      strategy: {
        using: "network",
        request: { method: "GET", url: "https://api.lever.test/v0/postings/acme" },
        extract: {
          records: "$",
          fields: { title: "text", team: "categories.team" },
          filter: { workplaceType: "remote" },
        },
      },
      provenance: { type: "playbook", id: "lever" },
      out,
    });
    expect(result.warnings).toEqual([]);
    expect(fs.existsSync(path.join(out, "records.cjs"))).toBe(true);
    const http = require("node:http");
    const server = http.createServer((_request: unknown, response: any) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(
        JSON.stringify([
          { text: "Engineer", categories: { team: "Dev" }, workplaceType: "remote" },
          { text: "Designer", categories: { team: "Design" }, workplaceType: "onsite" },
        ]),
      );
    });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { execFile } = require("node:child_process");
      const stdout = await new Promise<string>((resolve, reject) =>
        execFile(
          process.execPath,
          [path.join(out, "client.mjs")],
          {
            env: {
              ...process.env,
              SURF_CLIENT_ENDPOINT_URL: `http://127.0.0.1:${server.address().port}/`,
            },
          },
          (error: Error | null, output: string) => (error ? reject(error) : resolve(output)),
        ),
      );
      expect(JSON.parse(stdout)).toEqual([{ title: "Engineer", team: "Dev" }]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    await expect(clients.verifyClient(out, { live: false })).resolves.toMatchObject({
      valid: true,
    });
  });

  it("derives a client that keeps the saved op's JSON extract", () => {
    const parent = tempDir("surf-client-");
    const playbookRecords = require("../../native/playbook-records.cjs");
    const root = path.join(parent, "state");
    const record = playbookRecords.startRecord({ site: "books", op: "get_books", tabId: 1, root });
    playbookRecords.attachNetworkTrace(
      record.id,
      [
        {
          id: "r-1",
          method: "GET",
          status: 200,
          type: "XHR",
          url: "https://books.test/api/items?page=1",
        },
      ],
      root,
    );
    writeOp(parent, [
      {
        using: "network",
        request: { method: "GET", url: "https://books.test/api/items" },
        extract: { records: "$.items", fields: { id: "sku" } },
      },
    ]);
    const result = clients.deriveClient("books", "get_books", path.join(parent, "client"), {
      root,
      recordId: record.id,
      cwd: parent,
      home: parent,
    });
    expect(result.manifest.extract).toEqual({ records: "$.items", fields: { id: "sku" } });
  });

  it("warns that HTML extraction runs only through surf use and prints the raw body", () => {
    const parent = tempDir("surf-client-");
    const result = clients.generateClient({
      playbookId: "books",
      op: { id: "get_books", effect: "read" },
      strategy: {
        using: "network",
        request: { method: "GET", url: "https://books.test/" },
        extract: htmlExtract,
      },
      provenance: { type: "playbook", id: "books" },
      out: path.join(parent, "client"),
    });
    expect(result.manifest.extract).toBeNull();
    expect(result.warnings).toEqual([
      "extract.html runs only through surf use (Node has no DOM); this client prints the raw HTML body",
    ]);
  });
});
