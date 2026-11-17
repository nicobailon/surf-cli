import { describe, expect, it } from "vitest";

const robots = require("../../native/parse-robots.cjs");
const inputs = require("../../native/parse-inputs.cjs");
const infer = require("../../native/parse-infer.cjs");

const books = (count: number) => `<html><head><title>All products</title></head><body>
<div class="side_categories"><ul class="nav nav-list"><li><a href="/c/books_1/index.html">Books</a><ul>
${Array.from({ length: 12 }, (_, i) => `<li><a href="/c/cat_${i}/index.html">Category ${i}</a></li>`).join("\n")}
</ul></li></ul></div>
<ol class="row">
${Array.from(
  { length: count },
  (_, i) => `<li class="col-xs-6 col-sm-4 col-md-3 col-lg-3"><article class="product_pod">
  <div class="image_container"><a href="book-${i}_${100 + i}/index.html"><img src="x.jpg" alt="Book ${i}"></a></div>
  <p class="star-rating ${["One", "Two", "Three"][i % 3]}"><i class="icon-star"></i></p>
  <h3><a href="book-${i}_${100 + i}/index.html" title="A Long Book Title Number ${i}">A Long Book Ti...</a></h3>
  <div class="product_price"><p class="price_color">£${10 + i}.99</p><p class="instock availability">In stock</p>
  <form><button type="submit" class="btn btn-primary">Add to basket</button></form></div>
</article></li>`,
).join("\n")}
</ol></body></html>`;

const lever = `<html><body><div class="postings-wrapper">
${["Engineering", "Sales"]
  .map(
    (team, t) => `<div class="postings-group"><div class="large-category-header">${team}</div>
${Array.from(
  { length: 3 },
  (_, i) => `<div class="posting" data-qa-posting-id="0000000${t}-0000-4000-8000-00000000000${i}">
  <div class="posting-apply"><a href="https://jobs.example/acme/0000000${t}-0000-4000-8000-00000000000${i}/apply" class="posting-btn-submit">Apply</a></div>
  <a class="posting-title" href="https://jobs.example/acme/0000000${t}-0000-4000-8000-00000000000${i}">
    <h5 data-qa="posting-name">${team} Role ${i}</h5>
    <div class="posting-categories"><span class="sort-by-location posting-category">City ${i}</span><span class="sort-by-commitment posting-category">Full-time</span></div>
  </a></div>`,
).join("\n")}</div>`,
  )
  .join("\n")}
</div></body></html>`;

const arxivList = `<html><body><div id="dlpage"><h3>Recent</h3><dl id="articles">
${Array.from(
  { length: 4 },
  (
    _,
    i,
  ) => `<dt><a name="item${i}">[${i + 1}]</a> <a href="/abs/2501.0000${i}" title="Abstract" id="2501.0000${i}">arXiv:2501.0000${i}</a> [<a href="/pdf/2501.0000${i}" title="Download PDF">pdf</a>]</dt>
<dd><div class="meta"><div class="list-title mathjax"><span class="descriptor">Title:</span> Paper ${i}</div>
<div class="list-authors"><a href="/a/one">Author One</a>, <a href="/a/two${i}">Author ${i}</a></div>
${i === 1 ? '<div class="list-comments">Comments: 9 pages</div>' : ""}
<div class="list-subjects"><span class="primary-subject">Computation and Language (cs.CL)</span></div></div></dd>`,
).join("\n")}
</dl></div></body></html>`;

const paper = `<html><head>
<meta name="citation_title" content="A Dummy Paper">
<meta name="citation_author" content="One, Author">
<meta name="citation_author" content="Two, Author">
<meta name="citation_date" content="2021/01/25">
<meta property="og:description" content="We study dummy things.">
</head><body><h1 class="title mathjax">Title: A Dummy Paper</h1></body></html>`;

const bookDetail = `<html><head><meta name="description" content="
    A dummy description.
"></head><body><div class="row"><div class="col-sm-6 product_main"><h1>A Dummy Book</h1>
<p class="price_color">£51.77</p><p class="instock availability">In stock (22 available)</p></div></div>
<table class="table table-striped"><tr><th>UPC</th><td>a897fe39b1053632</td></tr><tr><th>Product Type</th><td>Books</td></tr></table>
<div class="side"><p class="price_color">£1.00</p></div></body></html>`;

describe("robots.txt", () => {
  const text = `# comment
User-agent: Googlebot
Disallow: /

User-agent: *
Disallow: /search
Disallow: /*.pdf$
Allow: /search/about
Crawl-delay: 15
`;
  const parsed = robots.parseRobots(text);

  it("reads the * group and its crawl delay", () => {
    expect(parsed.crawlDelay).toBe(15);
    expect(robots.robotsAllows(parsed, "/list/cs.CL/recent").allowed).toBe(true);
    expect(robots.robotsAllows(parsed, "/search?query=x")).toEqual({
      allowed: false,
      rule: "Disallow: /search",
    });
  });

  it("lets the longest rule win, Allow on a tie, and reads * and $", () => {
    expect(robots.robotsAllows(parsed, "/search/about").allowed).toBe(true);
    expect(robots.robotsAllows(parsed, "/papers/x.pdf").allowed).toBe(false);
    expect(robots.robotsAllows(parsed, "/papers/x.pdf?dl=1").allowed).toBe(true);
    expect(
      robots.robotsAllows(robots.parseRobots("User-agent: *\nDisallow:\n"), "/x").allowed,
    ).toBe(true);
  });

  it("allows all on a 4xx and refuses on a 5xx or no answer (RFC 9309)", async () => {
    const answer =
      (status: number, body = "") =>
      async () =>
        new Response(body, { status });
    await expect(
      robots.checkRobots("https://a.example/x", { fetch: answer(404) }),
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      robots.checkRobots("https://a.example/x", { fetch: answer(503) }),
    ).resolves.toMatchObject({ allowed: false });
    const failing = async () => {
      throw new Error("offline");
    };
    await expect(
      robots.checkRobots("https://a.example/x", { fetch: failing }),
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      robots.checkRobots("https://a.example/private/1", {
        fetch: answer(200, "User-agent: *\nDisallow: /private\n"),
      }),
    ).resolves.toMatchObject({ allowed: false, rule: "Disallow: /private" });
  });
});

describe("parse inputs", () => {
  const plan = (url: string, goal: string, query: Record<string, string> = {}, overrides = []) =>
    inputs.planInputs({ request: { url, query }, goal, overrides });

  it("makes a page number in a path segment an optional page input", () => {
    expect(
      plan("https://books.example/catalogue/page-2.html", "all books with price").inputs,
    ).toEqual([
      { field: "path.2", as: "page", value: "2", recorded: "2", required: false, weak: false },
    ]);
  });

  it("names an id-like segment after the goal's thing, and a goal term after the segment before it", () => {
    const board = plan(
      "https://jobs.example/acme/00000000-0000-4000-8000-000000000001",
      "acme job posting",
    );
    expect(board.detail).toBe(true);
    expect(board.inputs).toEqual([
      { field: "path.1", as: "name", recorded: "acme", required: true, weak: true },
      {
        field: "path.2",
        as: "posting_id",
        recorded: "00000000-0000-4000-8000-000000000001",
        required: true,
        weak: false,
      },
    ]);
    const arxiv = plan("https://arxiv.example/list/cs.CL/recent", "recent cs.CL papers");
    expect(arxiv.detail).toBe(false);
    expect(arxiv.inputs).toEqual([
      { field: "path.2", as: "category", recorded: "cs.CL", required: true, weak: false },
    ]);
    expect(plan("https://arxiv.example/abs/2101.10010", "arxiv paper details").inputs).toEqual([
      { field: "path.2", as: "paper_id", recorded: "2101.10010", required: true, weak: false },
    ]);
  });

  it("makes a search term the required query input and a paging key an optional one", () => {
    const search = plan("https://a.example/search", "papers on graphs", {
      "terms-0-term": "graphs",
      start: "50",
      order: "date",
      size: "50",
    });
    expect(search.inputs).toEqual([
      { field: "query.terms-0-term", as: "query", recorded: "graphs", required: true, weak: false },
      { field: "query.start", as: "start", recorded: "50", required: false, weak: false },
    ]);
  });

  it("lets --input name a field's input, keeping what the heuristics found for it", () => {
    expect(
      plan("https://books.example/catalogue/book-1_100/index.html", "book details", {}, [
        { name: "book", field: "path.2" },
      ] as never).inputs,
    ).toEqual([
      {
        field: "path.2",
        as: "book",
        recorded: "book-1_100",
        required: true,
        weak: false,
        explicit: true,
      },
    ]);
    expect(
      plan("https://books.example/catalogue/page-2.html", "books", { sort: "asc" }, [
        { name: "pg", field: "path.2" },
        { name: "sort", field: "query.sort" },
      ] as never).inputs,
    ).toEqual([
      {
        field: "path.2",
        as: "pg",
        value: "2",
        recorded: "2",
        required: false,
        weak: false,
        explicit: true,
      },
      {
        field: "query.sort",
        as: "sort",
        recorded: "asc",
        required: true,
        weak: false,
        explicit: true,
      },
    ]);
  });

  it("names the playbook after the site and the op after the goal", () => {
    expect(inputs.siteName("https://jobs.lever.co/acme")).toBe("lever-co");
    expect(inputs.siteName("https://books.toscrape.com/x")).toBe("toscrape-com");
    expect(inputs.opName("Acme job postings, with teams!")).toBe("get_acme_job_postings");
  });

  it("sends a write or a goal that needs a click, scroll or typed search to the recipe", () => {
    expect(inputs.goalNeedsRecipe("post a comment on the thread", "https://a.example/t/1")).toMatch(
      /write/,
    );
    expect(inputs.goalNeedsRecipe("add the book to the cart", "https://a.example/b")).toMatch(
      /write/,
    );
    expect(
      inputs.goalNeedsRecipe("click load more and list all items", "https://a.example/"),
    ).toMatch(/click/);
    expect(inputs.goalNeedsRecipe("search for graphs", "https://a.example/")).toMatch(/search/);
    expect(
      inputs.goalNeedsRecipe("search results for graphs", "https://a.example/s?q=graphs"),
    ).toBeUndefined();
    expect(inputs.goalNeedsRecipe("blog post titles", "https://a.example/blog")).toBeUndefined();
    expect(inputs.goalNeedsRecipe("job postings", "https://a.example/jobs")).toBeUndefined();
  });
});

describe("parse extract inference", () => {
  it("finds the largest JSON record array and its scalar fields", () => {
    const body = {
      meta: { tags: [{ a: 1 }, { a: 2 }] },
      data: {
        items: Array.from({ length: 5 }, (_, i) => ({
          title: `T${i}`,
          id: i,
          url: `/j/${i}`,
          nested: { x: 1 },
          team: "Eng",
        })),
      },
    };
    const found = infer.inferJson(body);
    expect(found.extract).toEqual({
      records: "$.data.items",
      fields: { id: "id", title: "title", url: "url", team: "team" },
    });
    expect(found.records).toBe(5);
    expect(infer.keyFields(found)).toEqual(["title", "id"]);
    expect(infer.inferJson([{ name: "a" }, { name: "b" }]).extract).toEqual({
      records: "$",
      fields: { name: "name" },
    });
    expect(infer.inferJson({ origin: "x" }).extract).toEqual({ jsonPath: "$" });
  });

  it("takes the repeated item with a link on a listing, not the nav or the wrapper", () => {
    const found = infer.inferHtml(books(6), {
      baseUrl: "https://books.example/catalogue/page-2.html",
    });
    expect(found.mode).toBe("list");
    expect(found.extract.html).toEqual({
      item: "article.product_pod",
      fields: {
        title: "h3 a@title",
        url: "h3 a@href",
        star_rating: ".star-rating@class",
        price_color: ".price_color",
      },
    });
    expect(found.records).toBe(6);
    expect(found.sample).toMatchObject({
      title: "A Long Book Title Number 0",
      url: "https://books.example/catalogue/book-0_100/index.html",
      star_rating: "star-rating One",
      price_color: "£10.99",
    });
  });

  it("names fields after their class without the item's prefix, and skips constant text", () => {
    const found = infer.inferHtml(lever, { baseUrl: "https://jobs.example/acme" });
    expect(found.extract.html.item).toBe("div.posting");
    expect(found.extract.html.fields).toMatchObject({
      id: ":scope@data-qa-posting-id",
      title: "h5",
      url: "a.posting-title@href",
    });
    expect(found.extract.html.fields).not.toHaveProperty("apply");
    expect(found.records).toBe(6);
  });

  it("reads records split across dt/dd siblings as parallel [] fields of their container", () => {
    const found = infer.inferHtml(arxivList, {
      baseUrl: "https://arxiv.example/list/cs.CL/recent",
    });
    expect(found.mode).toBe("siblings");
    expect(found.extract.html.item).toBe("dl#articles");
    expect(found.extract.html.fields).toMatchObject({
      url: 'dt a[title="Abstract"]@href[]',
      id: 'dt a[title="Abstract"]@id[]',
      title: "dd .list-title[]",
      authors: "dd .list-authors[]",
    });
    expect(found.extract.html.fields).not.toHaveProperty("comments");
  });

  it("reads a detail page's meta tags, heading, labelled cells and the price beside the heading", () => {
    const found = infer.inferHtml(paper, {
      baseUrl: "https://arxiv.example/abs/2101.10010",
      detail: true,
    });
    expect(found.mode).toBe("detail");
    expect(found.extract.html).toEqual({
      item: "html",
      fields: {
        title: 'meta[name="citation_title"]@content',
        author: 'meta[name="citation_author"]@content[]',
        date: 'meta[name="citation_date"]@content',
        description: 'meta[property="og:description"]@content',
        heading: "h1",
      },
    });
    const book = infer.inferHtml(bookDetail, {
      baseUrl: "https://books.example/b/index.html",
      detail: true,
    });
    expect(book.extract.html.fields).toEqual({
      description: 'meta[name="description"]@content',
      title: "h1",
      price_color: ".product_main .price_color",
      instock: ".product_main .instock",
      upc: "table.table-striped tr:nth-child(1) td",
      product_type: "table.table-striped tr:nth-child(2) td",
    });
    expect(book.sample).toMatchObject({ price_color: "£51.77", upc: "a897fe39b1053632" });
  });

  it("drops the longest field until the records fit under the cap", () => {
    const found = infer.inferHtml(books(6), { baseUrl: "https://books.example/", limit: 700 });
    expect(Object.keys(found.extract.html.fields)).toEqual(["title", "price_color"]);
    expect(found.dropped).toEqual(["url", "star_rating"]);
    expect(found.chars).toBeLessThanOrEqual(700);
  });
});
