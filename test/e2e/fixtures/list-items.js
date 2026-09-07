// Page-side extractor used by the real-Chrome E2E for `surf extract`.
// Reads SURF_OPTIONS.limit (injected by --options) and returns rows.
const limit = Number.isFinite(SURF_OPTIONS.limit) ? SURF_OPTIONS.limit : 50;
const rows = Array.from(document.querySelectorAll(".item"))
  .slice(0, limit)
  .map((item) => ({
    id: item.dataset.id,
    title: item.querySelector("h2")?.textContent?.trim() ?? "",
    href: item.querySelector("a")?.getAttribute("href") ?? "",
  }));
return { query: new URL(location.href).searchParams.get("q") ?? "", total: rows.length, rows };
