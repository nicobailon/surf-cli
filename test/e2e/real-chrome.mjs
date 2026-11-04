import { execFile } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const repo = process.cwd();
// The shipped extension pins its ID; `surf install` with no ID must register the same one.
const extensionId = require("../../scripts/install-native-host.cjs").SURF_EXTENSION_ID;
const pinnedChromeVersion = "156.0.8078.47";
const scratch = mkdtempSync(join(tmpdir(), "surf-real-chrome-"));
const home = join(scratch, "home");
const extensionDir = join(scratch, "extension");
const profileDir = join(scratch, "profile");
const socketPath = join(scratch, "surf.sock");
const surfTmp = join(scratch, "tmp");
const screenshotPath = join(scratch, "shot.png");
const hostPidPath = join(scratch, "native-host.pid");
let browser;
let browserPid;
let crossOriginServer;
let chromeExecutablePath;
let puppeteer;
let server;
let failure;

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitFor(predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function terminateProcess(pid, label) {
  if (!processIsAlive(pid)) return;
  process.kill(pid, "SIGTERM");
  await waitFor(() => !processIsAlive(pid), `${label} SIGTERM`, 3_000).catch(() => {});
  if (!processIsAlive(pid)) return;
  process.kill(pid, "SIGKILL");
  await waitFor(() => !processIsAlive(pid), `${label} SIGKILL`, 3_000);
}

async function terminateProcessesUsingProfile() {
  const { stdout } = await execFileAsync("ps", ["-axo", "pid=,command="], {
    timeout: 5_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  const profilePids = stdout
    .split("\n")
    .map((line) => line.trim().match(/^(\d+)\s+(.*)$/))
    .filter((match) => match?.[2].includes(profileDir))
    .map((match) => Number.parseInt(match[1], 10))
    .filter((pid) => pid !== process.pid);

  for (const pid of profilePids) await terminateProcess(pid, "Chrome profile process");
}

const env = {
  ...process.env,
  HOME: home,
  SURF_HOST_PATH: join(repo, "native/host.cjs"),
  SURF_NODE_PATH: process.execPath,
  SURF_SOCKET: socketPath,
  SURF_TMP: surfTmp,
};

async function runSurf(...args) {
  const result = await execFileAsync(process.execPath, [join(repo, "native/cli.cjs"), ...args], {
    cwd: repo,
    env,
    timeout: 20_000,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.stderr.includes("surf: version mismatch")) {
    throw new Error(`surf ${args.join(" ")} warned about versions that match: ${result.stderr}`);
  }
  return result.stdout;
}

/** `--json` with an explicit target wraps the payload as {result, target, notice}. */
function unwrapJson(stdout) {
  const parsed = JSON.parse(stdout);
  return parsed && typeof parsed === "object" && "result" in parsed && "target" in parsed ? parsed.result : parsed;
}

/** tab.new prints "Created tab <id>: <url>" even with --json. */
function tabIdFromOutput(stdout) {
  const match = stdout.match(/\btab\s+(\d+)\b/i);
  if (!match) throw new Error(`tab.new did not report a tab id: ${stdout}`);
  return Number(match[1]);
}

/** Run surf expecting a non-zero exit; returns stdout and stderr. */
async function runSurfExpectingFailure(...args) {
  try {
    const stdout = await runSurf(...args);
    throw new Error(`Expected \`surf ${args.join(" ")}\` to fail, but it printed: ${stdout}`);
  } catch (error) {
    if (typeof error.code !== "number" || error.code === 0) throw error;
    return { code: error.code, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

function fixturePages(request, { crossOriginBase }) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/frames") {
    return `<!doctype html><html><head><title>Surf frames fixture</title></head>
<body><h1>Frames</h1>
<iframe id="same-origin" src="/fixture" width="300" height="120"></iframe>
<iframe id="inline" srcdoc="<p>inline</p>" width="200" height="60"></iframe>
<iframe id="cross-origin" src="${crossOriginBase}/fixture" width="300" height="120"></iframe>
<iframe id="sandboxed" src="/fixture?sandboxed" sandbox="allow-forms" width="200" height="60"></iframe>
<div id="host"></div>
<script>document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = '<iframe id="shadowed" src="/fixture?shadowed" width="200" height="60"></iframe>';</script>
</body></html>`;
  }
  if (url.pathname === "/login") {
    return `<!doctype html><html><head><title>Sign in - Surf fixture</title></head>
<body><main><h1>Sign in</h1><form><label>Email <input type="email" name="email"></label>
<label>Password <input type="password" name="password"></label><button type="submit">Sign in</button></form></main></body></html>`;
  }
  if (url.pathname === "/changes") {
    return `<!doctype html><html><head><title>Surf page changes fixture</title></head>
<body><main><h1>Project settings</h1>
<button id="open-dialog">Delete project</button>
<label><input type="checkbox" id="notify"> Email me</label>
<button id="noop">Do nothing</button>
<label>Password <input type="password" id="secret"></label>
<button id="ticker-start">Start ticker</button><p id="ticker">0</p>
<p id="outcome">Nothing deleted</p>
<a id="leave" href="/changes-target">Leave settings</a>
</main>
<script>
  document.querySelector("#open-dialog").addEventListener("click", () => {
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    dialog.setAttribute("aria-labelledby", "dialog-title");
    dialog.innerHTML = '<h2 id="dialog-title">Delete project?</h2><button id="cancel">Cancel</button><button id="confirm">Delete</button>';
    dialog.querySelector("#confirm").addEventListener("click", () => {
      document.querySelector("#outcome").textContent = "Project deleted";
      dialog.remove();
    });
    setTimeout(() => document.body.append(dialog), 50);
  });
  document.querySelector("#ticker-start").addEventListener("click", () => {
    let count = 0;
    setInterval(() => { document.querySelector("#ticker").textContent = String(++count); }, 50);
  });
</script></body></html>`;
  }
  if (url.pathname === "/changes-target") {
    return `<!doctype html><html><head><title>Changes target</title></head><body><main><h1>Target</h1></main></body></html>`;
  }
  if (url.pathname === "/navigates-away") {
    return `<!doctype html><html><head><title>Navigates away</title></head><body><p>Leaving</p>
<script>setTimeout(() => { location.href = "/changes-target"; }, 1500);</script></body></html>`;
  }
  if (url.pathname === "/native-dialog") {
    return `<!doctype html><html><head><title>Native dialog fixture</title></head>
<body><main><button id="alert" onclick="alert('hi')">Alert</button>
<button id="confirm" onclick="document.querySelector('#answer').textContent = confirm('Sure?') ? 'yes' : 'no'">Confirm</button>
<p id="answer">none</p></main></body></html>`;
  }
  if (url.pathname === "/upload") {
    return `<!doctype html><html><head><title>Upload fixture</title>
<script>
  addEventListener("DOMContentLoaded", () => {
    const report = (input, target) => input.addEventListener("change", () => {
      document.querySelector(target).textContent = "Uploaded " + input.files.length + " file: " + input.files[0].name;
    });
    const hidden = document.querySelector("#hidden-input");
    report(hidden, "#resume");
    report(document.querySelector("#cover-input"), "#cover");
    document.querySelector("#upload-button").addEventListener("click", () => hidden.click());
  });
</script></head>
<body><main><h1>Apply</h1>
<button id="upload-button">Upload resume</button><p id="resume">No resume</p>
<button id="nothing">Does nothing</button>
<input type="file" id="cover-input" aria-label="Cover letter"><p id="cover">No cover letter</p>
</main><input type="file" id="hidden-input" style="display:none"></body></html>`;
  }
  if (url.pathname === "/list") {
    const empty = url.searchParams.get("empty") === "1";
    const items = empty
      ? '<p class="empty-state">No results for this search.</p>'
      : [1, 2, 3]
          .map((n) => `<article class="item" data-id="${n}"><h2>Item ${n}</h2><a href="/items/${n}">open</a></article>`)
          .join("");
    return `<!doctype html><html><head><title>Surf list fixture</title></head>
<body><h1>List</h1><label>Tracked <input id="tracked" type="text"></label><output id="mirror"></output>
<section id="results">${items}</section>
<script>
  // Emulates a framework value tracker: an own "value" property on the
  // instance shadows the native accessor and records what it saw. On
  // "input" the framework compares its tracked value with the DOM value
  // and ignores the event when they match, exactly like a controlled input.
  const tracked = document.querySelector("#tracked");
  const native = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
  let trackedValue = "";
  Object.defineProperty(tracked, "value", {
    configurable: true,
    get() { return native.get.call(this); },
    set(next) { trackedValue = String(next); native.set.call(this, next); },
  });
  tracked.addEventListener("input", () => {
    const domValue = native.get.call(tracked);
    if (domValue === trackedValue) return; // framework sees no change
    trackedValue = domValue;
    document.querySelector("#mirror").textContent = domValue;
  });
</script></body></html>`;
  }
  if (url.pathname === "/summary") {
    const sections = ["World", "Business", "Science", "Sport", "Culture", "Travel", "Opinion", "Archive"]
      .map((name) => `<a href="/${name.toLowerCase()}">${name}</a>`)
      .join(" ");
    const stories = Array.from({ length: 120 }, (_, index) => {
      const n = index + 1;
      return `<div class="story"><h2>Story ${n}</h2><p>Story ${n} reports on a long-running local question in plain terms, with quotes from residents, figures from the council and a short note on what happens next.</p><a href="/story/${n}">Read story ${n}</a> <a href="/story/${n}#comments">${n} comments</a></div>`;
    }).join("\n");
    return `<!doctype html><html><head><title>Surf summary fixture</title></head>
<body><header><h1>Surf News</h1></header><nav aria-label="Sections">${sections}</nav>
<main><input type="search" aria-label="Search stories"><button>Search</button>
${stories}</main>
<dialog open aria-label="Cookie consent"><p>We use cookies.</p><button>Accept</button><button>Reject</button></dialog>
</body></html>`;
  }
  if (url.pathname === "/rerender") {
    return `<!doctype html><html><head><title>Surf rerender fixture</title></head>
<body><label>Filter <input id="filter" type="text"></label><div id="app"></div><output id="log">none</output>
<script>
  // Re-renders replace the button node while its role and name stay the same.
  // The click handler is delegated to the document, like React, so a detached node never reaches it.
  const render = () => { document.querySelector("#app").innerHTML = "<button>Save</button>"; };
  render();
  document.querySelector("#filter").addEventListener("input", render);
  document.addEventListener("click", (event) => {
    if (event.target.closest("#app button")) document.querySelector("#log").textContent = "saved";
  });
</script></body></html>`;
  }
  if (url.pathname === "/locate") {
    // "Save draft" comes first, so a substring match picks it; role="button" matches two selectors.
    return `<!doctype html><html><head><title>Surf locate fixture</title></head>
<body><output id="log"></output>
<button onclick="log('save draft')">Save draft</button>
<button role="button" onclick="log('save')">Save</button>
<ul><li>Invoice 1001 <button onclick="log('delete 1001')">Delete</button></li>
<li>Invoice 1002 <button onclick="log('delete 1002')">Delete</button></li></ul>
<label>Email <input id="work-email"></label> <label>Email <input id="home-email"></label>
<script>
  function log(entry) { const out = document.querySelector("#log"); out.textContent = out.textContent ? out.textContent + "|" + entry : entry; }
</script></body></html>`;
  }
  if (url.pathname === "/page-text") {
    // Tilda-style page: CSS, scripts and hidden form config sit in body next to the visible copy.
    return `<!doctype html><html><head><title>Surf page text fixture</title></head><body>
<style>.leak{color:red}</style><h1>Visible heading</h1><p>Visible copy</p>
<script>var scriptLeak = 1;</script><noscript>noscriptLeak</noscript>
<div style="display:none"><textarea>[{"lid":"hiddenJsonLeak"}]</textarea></div>
</body></html>`;
  }
  if (url.pathname === "/offscreen") {
    // One control on screen, three below the fold.
    return `<!doctype html><html><head><title>Surf offscreen fixture</title></head><body>
<button>Top</button><div style="height:5000px"></div>
<button>Below 1</button><a href="#below">Below 2</a><input aria-label="Below 3">
</body></html>`;
  }
  if (url.pathname === "/custom-controls") {
    // Custom controls name themselves from text in a child element, or from text under 3 characters.
    return `<!doctype html><html><head><title>Surf custom controls fixture</title></head>
<body><output id="log"></output>
<div role="button" onclick="log('save draft')"><span>Save draft</span></div>
<div role="button" onclick="log('save')"><span>Save</span></div>
<div role="button" onclick="log('ok')">OK</div>
<div role="button" onclick="log('new item')"><span class="icon" aria-hidden="true">add</span>New item</div>
<script>
  function log(entry) { const out = document.querySelector("#log"); out.textContent = out.textContent ? out.textContent + "|" + entry : entry; }
</script></body></html>`;
  }
  if (url.pathname === "/shadow-form") {
    // Form fields live inside open shadow roots of custom elements, like SmartRecruiters' spl-* components.
    // The host carries the same id as its inner input, and a light-DOM wrapper listens for input bubbling out.
    return `<!doctype html><html><head><title>Surf shadow form fixture</title></head>
<body><output id="log"></output>
<x-title>Personal information</x-title>
<spl-input id="first-name" label="First name"></spl-input>
<spl-button>Submit application</spl-button>
<input type="checkbox" id="agree"><label for="agree">I have read and agree to the Terms of Service, the Privacy Policy, and the Acceptable Use Policy of this example website</label>
<script>
  function log(entry) { const out = document.querySelector("#log"); out.textContent = out.textContent ? out.textContent + "|" + entry : entry; }
  class SplInput extends HTMLElement {
    connectedCallback() {
      const id = this.id;
      const root = this.attachShadow({ mode: "open", delegatesFocus: true });
      root.innerHTML = '<label for="' + id + '">' + this.getAttribute("label") + '<span aria-hidden="true">*</span></label><input id="' + id + '" type="text" autocomplete="given-name">';
      this.addEventListener("input", () => log("input:" + root.querySelector("input").value));
    }
  }
  class SplButton extends HTMLElement {
    connectedCallback() { this.attachShadow({ mode: "open" }).innerHTML = '<button><slot></slot></button>'; }
  }
  class XTitle extends HTMLElement {
    connectedCallback() { this.attachShadow({ mode: "open" }).innerHTML = '<h3><slot></slot></h3>'; }
  }
  customElements.define("spl-input", SplInput);
  customElements.define("spl-button", SplButton);
  customElements.define("x-title", XTitle);
</script></body></html>`;
  }
  if (url.pathname === "/field-values") {
    // read shows what a field holds, except a secret: the password sits in a wrapping label with no other name.
    return `<!doctype html><html><head><title>Surf field values fixture</title></head>
<body><input type="email" placeholder="hello@example.com">
<label>Password <input type="password"></label>
<textarea placeholder="Notes"></textarea>
<input type="text" aria-label="SSN" style="-webkit-text-security:disc">
<input type="text" aria-label="Quote"></body></html>`;
  }
  if (url.pathname === "/click") {
    // Each button only reports a click a user could have made.
    return `<!doctype html><html><head><title>Surf click fixture</title></head>
<body><output id="log"></output>
<button id="submit" disabled onclick="log('submit')">Submit order</button>
<div style="position:relative"><button onclick="log('delete')">Delete order</button>
<div role="dialog" aria-label="Cookie consent" style="position:absolute;inset:0;background:#0003"></div></div>
<button id="pay">Pay now</button>
<div id="clip" style="height:40px;overflow:hidden"><div style="height:200px"></div><button onclick="log('archive')">Archive order</button></div>
<button id="arm">Arm</button> <button id="confirm" onclick="log('confirm')">Confirm order</button>
<button oncontextmenu="event.preventDefault(); log('menu')">Options</button>
<script>
  function log(entry) { const out = document.querySelector("#log"); out.textContent = out.textContent ? out.textContent + "|" + entry : entry; }
  document.querySelector("#pay").addEventListener("click", (event) => { if (event.isTrusted) log("pay"); });
  document.querySelector("#arm").addEventListener("click", () => {
    const confirm = document.querySelector("#confirm");
    confirm.disabled = true;
    setTimeout(() => { confirm.disabled = false; }, 1500);
  });
</script></body></html>`;
  }
  if (url.pathname === "/check") {
    // "Terms" keeps its app state in click events, the way React does, and shows it in #terms-state.
    return `<!doctype html><html><head><title>Surf check fixture</title></head>
<body><output id="log"></output>
<input type="checkbox" id="news" checked><label for="news">Newsletter</label>
<input type="checkbox" id="terms"><label for="terms">Terms</label> <span id="terms-state">not accepted</span>
<input type="radio" name="size" id="small" checked><label for="small">Small</label>
<input type="radio" name="size" id="large"><label for="large">Large</label>
<select id="country"><option value="us">United States</option><option value="fr">France</option></select>
<button role="switch" id="frame-switch" aria-checked="false">Animated</button>
<button role="switch" id="saved-switch" aria-checked="false">Saved</button>
<select id="qty" aria-label="Qty"><option value="0">1</option><option value="1">2</option></select>
<label><input type="checkbox" id="styled" style="position:absolute;opacity:0;width:16px;height:16px"><span style="display:inline-block;width:16px;height:16px;border:1px solid"></span>Remember me</label>
<input type="checkbox" id="all"><label for="all">Select all</label>
<script>
  function log(entry) { const out = document.querySelector("#log"); out.textContent = out.textContent ? out.textContent + "|" + entry : entry; }
  // These switches commit their state a frame later and after a 400ms save, like animated or server-backed toggles.
  const flip = (el) => el.setAttribute("aria-checked", String(el.getAttribute("aria-checked") !== "true"));
  const frameSwitch = document.querySelector("#frame-switch");
  frameSwitch.addEventListener("click", () => requestAnimationFrame(() => flip(frameSwitch)));
  const savedSwitch = document.querySelector("#saved-switch");
  savedSwitch.addEventListener("click", () => setTimeout(() => flip(savedSwitch), 400));
  document.querySelector("#all").indeterminate = true;
  document.querySelector("#news").addEventListener("click", () => log("news"));
  document.querySelector("#terms").addEventListener("click", (event) => {
    document.querySelector("#terms-state").textContent = event.target.checked ? "accepted" : "not accepted";
    log("terms:" + event.isTrusted);
  });
</script></body></html>`;
  }
  if (url.pathname === "/type") {
    return `<!doctype html><html><head><title>Surf type fixture</title></head>
<body><input id="plain" type="text"><textarea id="notes"></textarea></body></html>`;
  }
  if (url.pathname === "/refs-a") {
    // The title says when the page came back from the back/forward cache instead of reloading.
    return `<!doctype html><html><head><title>Surf refs page A</title></head>
<body><a href="/refs-b">Billing settings</a> <button onclick="document.title = 'kept'">Keep my plan</button>
<script>addEventListener("pageshow", (event) => { if (event.persisted) document.title = "restored"; });</script>
</body></html>`;
  }
  if (url.pathname === "/refs-b") {
    return `<!doctype html><html><head><title>Surf refs page B</title></head>
<body><output id="log"></output> <a href="/refs-a">Back to plan</a>
<button onclick="document.querySelector('#log').textContent = 'deleted'">Delete account</button></body></html>`;
  }
  if (url.pathname === "/type-limits") {
    return `<!doctype html><html><head><title>Surf type limits fixture</title></head>
<body><input id="code" aria-label="Code" maxlength="4"><input id="locked" aria-label="Locked" readonly value="orig">
<input id="reverted" aria-label="Reverted" value="draft"><input id="wiped" aria-label="Wiped" value="draft">
<fieldset disabled><input id="off" aria-label="Off" value="orig"></fieldset>
<input id="shout" aria-label="Shout"><input id="name" aria-label="Name">
<script>
  const on = (id, edit) => document.getElementById(id).addEventListener("input", (event) => { event.target.value = edit(event.target.value); });
  on("reverted", () => "draft");
  on("wiped", () => "");
  on("shout", (value) => value.toUpperCase());
</script>
</body></html>`;
  }
  if (url.pathname === "/harvest") {
    // A feed that loads a cursor-paginated JSON API with a token header set by page JS and
    // renders a virtualized list (about five rows in the DOM). `?nonce` adds a one-time nonce
    // header per request, so a replayed request is rejected.
    return `<!doctype html><html><head><title>Surf harvest fixture</title>
<style>body{margin:0}#list{position:relative}.row{position:absolute;left:0;right:0;height:200px;margin:0}</style></head>
<body><div id="list" data-loaded="0"></div>
<script>
  const ROW = 200;
  const token = ["page", "token", "7f3a"].join("-");
  const nonceMode = new URLSearchParams(location.search).has("nonce");
  const list = document.getElementById("list");
  const items = [];
  let cursor;
  let loading = false;
  let done = false;
  function render() {
    list.style.height = (items.length + 1) * ROW + "px";
    const first = Math.max(0, Math.floor(scrollY / ROW) - 1);
    list.replaceChildren(...items.slice(first, first + 5).map((item, offset) => {
      const row = document.createElement("article");
      row.className = "row";
      row.dataset.id = item.id;
      row.style.top = (first + offset) * ROW + "px";
      const text = document.createElement("p");
      text.className = "text";
      text.textContent = item.text;
      row.append(text);
      return row;
    }));
    list.dataset.loaded = String(items.length);
    if (!done && scrollY + innerHeight >= list.offsetHeight - ROW) load();
  }
  async function load() {
    if (loading || done) return;
    loading = true;
    const headers = { "x-harvest-token": token };
    if (nonceMode) headers["x-harvest-nonce"] = crypto.randomUUID();
    const variables = JSON.stringify(cursor ? { cursor } : {});
    const response = await fetch("/harvest-api/v1/feed?variables=" + encodeURIComponent(variables), { headers });
    const page = await response.json();
    items.push(...page.data.items);
    cursor = page.data.cursors.find((entry) => entry.type === "Bottom")?.value;
    done = !cursor;
    loading = false;
    render();
  }
  addEventListener("scroll", render);
  load();
</script></body></html>`;
  }
  return null;
}

const harvestStats = { rejected: 0 };
const usedNonces = new Set();

/** The /harvest page's feed API: 5 pages of 4 items, Bottom cursors c1..c4. */
function harvestApi(request, response) {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname !== "/harvest-api/v1/feed") return false;
  const send = (status, body) => {
    response.writeHead(status, { "content-type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (request.headers["x-harvest-token"] !== "page-token-7f3a") {
    send(401, { error: "missing token" });
    return true;
  }
  const nonce = request.headers["x-harvest-nonce"];
  if (nonce !== undefined) {
    if (usedNonces.has(nonce)) {
      harvestStats.rejected++;
      send(403, { error: "nonce reused" });
      return true;
    }
    usedNonces.add(nonce);
  }
  let page = Number.NaN;
  try {
    const cursor = JSON.parse(url.searchParams.get("variables") || "{}").cursor;
    page = cursor === undefined ? 0 : Number(/^c([1-4])$/.exec(cursor)?.[1]);
  } catch {}
  if (!Number.isInteger(page)) {
    send(400, { error: "bad cursor" });
    return true;
  }
  const items = Array.from({ length: 4 }, (_, index) => ({ id: `item-${page * 4 + index + 1}`, text: `Item ${page * 4 + index + 1}` }));
  const cursors = [{ type: "Top", value: "top" }, ...(page < 4 ? [{ type: "Bottom", value: `c${page + 1}` }] : [])];
  send(200, { data: { items, cursors } });
  return true;
}

try {
  if (!new Set(["darwin", "linux"]).has(process.platform)) {
    throw new Error(`Real Chrome E2E does not support ${process.platform}`);
  }

  const projectPackage = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
  const expectedPuppeteerVersion = projectPackage.devDependencies?.puppeteer;
  const projectPuppeteerPackagePath = join(repo, "node_modules/puppeteer/package.json");
  let resolvedPuppeteerPackagePath;
  try {
    resolvedPuppeteerPackagePath = require.resolve("puppeteer/package.json");
  } catch (error) {
    throw new Error("Project-local Puppeteer is not installed. Run `npm ci` first.", {
      cause: error,
    });
  }
  if (
    !existsSync(projectPuppeteerPackagePath) ||
    realpathSync(resolvedPuppeteerPackagePath) !== realpathSync(projectPuppeteerPackagePath)
  ) {
    throw new Error(
      `Real Chrome E2E resolved Puppeteer outside this project (${resolvedPuppeteerPackagePath}). Run \`npm ci\` first.`,
    );
  }
  const installedPuppeteerVersion = JSON.parse(
    readFileSync(projectPuppeteerPackagePath, "utf8"),
  ).version;
  if (installedPuppeteerVersion !== expectedPuppeteerVersion) {
    throw new Error(
      `Expected project-local Puppeteer ${expectedPuppeteerVersion}, found ${installedPuppeteerVersion}. Run \`npm ci\` first.`,
    );
  }

  ({ default: puppeteer } = await import("puppeteer"));
  const browserVersion = await puppeteer.browserVersion();
  if (browserVersion !== pinnedChromeVersion) {
    throw new Error(
      `Puppeteer ${installedPuppeteerVersion} expects Chrome ${browserVersion}, but this test pins ${pinnedChromeVersion}.`,
    );
  }
  chromeExecutablePath = await puppeteer.executablePath();
  if (!existsSync(chromeExecutablePath)) {
    throw new Error(
      `Pinned Chrome for Testing ${pinnedChromeVersion} is not installed. Run \`npx puppeteer browsers install chrome@${pinnedChromeVersion}\`.`,
    );
  }

  mkdirSync(home, { recursive: true });
  mkdirSync(surfTmp, { recursive: true });
  cpSync(join(repo, "dist"), extensionDir, { recursive: true });

  const installed = await execFileAsync(
    process.execPath,
    [join(repo, "native/cli.cjs"), "install"],
    { cwd: repo, env, timeout: 20_000 },
  );
  if (!installed.stdout.includes(`"Load unpacked" and choose:\n  ${join(repo, "dist")}\n`)) {
    throw new Error(`surf install did not print the extension folder to load: ${installed.stdout}`);
  }

  const standardManifest = join(
    home,
    process.platform === "darwin"
      ? "Library/Application Support/Google/Chrome/NativeMessagingHosts/surf.browser.host.json"
      : ".config/google-chrome/NativeMessagingHosts/surf.browser.host.json",
  );
  const nativeManifest = JSON.parse(readFileSync(standardManifest, "utf8"));
  const hostWrapper = (extraExports = "") =>
    `#!/usr/bin/env bash\necho $$ > ${JSON.stringify(hostPidPath)}\nexport SURF_SOCKET=${JSON.stringify(socketPath)}\nexport SURF_TMP=${JSON.stringify(surfTmp)}\n${extraExports}exec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(repo, "native/host.cjs"))} "$@"\n`;
  writeFileSync(nativeManifest.path, hostWrapper());
  chmodSync(nativeManifest.path, 0o755);

  const testingManifest = join(profileDir, "NativeMessagingHosts/surf.browser.host.json");
  mkdirSync(join(profileDir, "NativeMessagingHosts"), { recursive: true });
  cpSync(standardManifest, testingManifest);

  crossOriginServer = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end("<!doctype html><html><head><title>Cross-origin fixture</title></head><body><p>cross-origin fixture</p></body></html>");
  });
  await new Promise((resolve, reject) => {
    crossOriginServer.once("error", reject);
    crossOriginServer.listen(0, "127.0.0.1", resolve);
  });
  const crossOriginBase = `http://127.0.0.1:${crossOriginServer.address().port}`;

  server = createServer((request, response) => {
    if (harvestApi(request, response)) return;
    const extraPage = fixturePages(request, { crossOriginBase });
    if (extraPage !== null) {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(extraPage);
      return;
    }
    const hasSessionCookie = request.headers.cookie?.includes("surf_session=present") === true;
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "set-cookie": "surf_session=present; Path=/; HttpOnly; SameSite=Lax",
    });
    response.end(`<!doctype html>
<html>
  <head><title>Surf real Chrome fixture</title></head>
  <body>
    <main>
      <h1>Surf real Chrome fixture</h1>
      <p id="session-state">${hasSessionCookie ? "session-cookie-present" : "session-cookie-missing"}</p>
      <button id="fixture-button">Mark complete</button>
      <p id="fixture-result">Waiting for Surf</p>
    </main>
    <script>
      document.querySelector("#fixture-button").addEventListener("click", () => {
        document.querySelector("#fixture-result").textContent = "Clicked by Surf";
      });
    </script>
  </body>
</html>`);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const fixtureUrl = `http://127.0.0.1:${address.port}/fixture`;
  const navigationUrl = `${fixtureUrl}?navigated`;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  // Opt-in autostart (#424): with no Surf host running, `surf go <url>` starts the browser from
  // surf.json browser.command (here Chrome for Testing through Puppeteer), opening <url>, then runs.
  const autostartProfileDir = join(scratch, "profile-autostart");
  const autostartPidPath = join(scratch, "autostart-launcher.pid");
  const autostartLauncher = join(scratch, "autostart-launcher.mjs");
  mkdirSync(join(autostartProfileDir, "NativeMessagingHosts"), { recursive: true });
  cpSync(standardManifest, join(autostartProfileDir, "NativeMessagingHosts/surf.browser.host.json"));
  writeFileSync(autostartLauncher, `import { writeFileSync } from "node:fs";
import puppeteer from ${JSON.stringify(import.meta.resolve("puppeteer"))};
writeFileSync(${JSON.stringify(autostartPidPath)}, String(process.pid));
const launched = await puppeteer.launch({
  headless: true,
  handleSIGTERM: false,
  executablePath: ${JSON.stringify(chromeExecutablePath)},
  enableExtensions: [${JSON.stringify(extensionDir)}],
  userDataDir: ${JSON.stringify(autostartProfileDir)},
  args: [...${JSON.stringify(process.platform === "linux" ? ["--no-sandbox"] : [])}, ...process.argv.slice(2)],
});
process.on("SIGTERM", () => launched.close().finally(() => process.exit(0)));
setInterval(() => {}, 60_000);
`);
  writeFileSync(
    join(home, "surf.json"),
    JSON.stringify({ browser: { autostart: true, command: [process.execPath, autostartLauncher], timeoutMs: 45_000 } }),
  );
  const autostartUrl = `${fixtureUrl}?autostart`;
  await execFileAsync(process.execPath, [join(repo, "native/cli.cjs"), "go", autostartUrl, "--no-screenshot"], {
    cwd: repo,
    env,
    timeout: 60_000,
  });
  const autostartTabs = JSON.parse(await runSurf("tab.list", "--json"));
  if (!autostartTabs.some((tab) => tab.url === autostartUrl && tab.active)) {
    throw new Error(`autostart did not open the go URL as the active tab: ${JSON.stringify(autostartTabs)}`);
  }
  rmSync(join(home, "surf.json"));
  await terminateProcess(Number.parseInt(readFileSync(autostartPidPath, "utf8"), 10), "autostart launcher");
  await terminateProcessesUsingProfile();
  if (existsSync(hostPidPath)) {
    await terminateProcess(Number.parseInt(readFileSync(hostPidPath, "utf8"), 10), "autostarted native host");
  }
  rmSync(hostPidPath, { force: true });
  rmSync(socketPath, { force: true });

  browser = await puppeteer.launch({
    headless: true,
    enableExtensions: [extensionDir],
    userDataDir: profileDir,
    env,
    args: process.platform === "linux" ? ["--no-sandbox"] : [],
  });
  browserPid = browser.process()?.pid;

  const workerTarget = await browser.waitForTarget(
    (target) =>
      target.type() === "service_worker" &&
      target.url().startsWith(`chrome-extension://${extensionId}/`),
    { timeout: 20_000 },
  );
  await waitFor(() => existsSync(socketPath), "Surf native-host socket");
  await waitFor(() => existsSync(hostPidPath), "Surf native-host PID");

  await runSurf("tab.new", fixtureUrl, "--json");
  await runSurf("go", navigationUrl, "--no-screenshot", "--json");
  const tabs = JSON.parse(await runSurf("tab.list", "--json"));
  const fixtureTab = tabs.find((tab) => tab.url === navigationUrl);
  if (!fixtureTab?.id) {
    throw new Error(`tab.list did not report the navigated fixture tab: ${JSON.stringify(tabs)}`);
  }

  // A window-mode session keeps its tab in its own window, not the focused one (#403).
  const sessionUrl = `${fixtureUrl}?session-window`;
  await runSurf("session.ensure", "e2e-window", sessionUrl, "--json");
  const sessionTab = JSON.parse(await runSurf("tab.list", "--json")).find((tab) => tab.url === sessionUrl);
  if (!sessionTab?.windowId || sessionTab.windowId === fixtureTab.windowId) {
    throw new Error(`session.ensure put its tab in the existing window: ${JSON.stringify({ sessionTab, fixtureTab })}`);
  }
  await runSurf("session.close", "e2e-window", "--json");

  const fixturePage = (await browser.pages()).find((page) => page.url() === navigationUrl);
  if (!fixturePage) throw new Error("Puppeteer could not find the navigated fixture page");
  let contentRealm;
  let contentRealmState;
  for (const realm of fixturePage.extensionRealms()) {
    const extension = await realm.extension();
    if (extension?.id === extensionId) {
      contentRealm = realm;
      contentRealmState = await realm.evaluate(() => ({
        text: document.body.textContent,
        visualHandler: typeof window.__piVisualIndicatorMessageHandler,
      }));
      break;
    }
  }
  if (!contentRealmState?.text?.includes("Surf real Chrome fixture")) {
    throw new Error("Surf content-script realm was not injected");
  }

  const worker = await workerTarget.worker();
  if (!worker) throw new Error("Could not access the Surf service worker");
  const directText = await worker.evaluate(
    async (tabId) => await chrome.tabs.sendMessage(tabId, { type: "GET_PAGE_TEXT" }, { frameId: 0 }),
    fixtureTab.id,
  );
  if (!directText?.text?.includes("Surf real Chrome fixture")) {
    throw new Error(
      `Direct page-text message failed: ${JSON.stringify({ contentRealmState, directText })}`,
    );
  }

  const initialText = await runSurf("page.text");
  if (!initialText.includes("Surf real Chrome fixture") || !initialText.includes("Waiting for Surf")) {
    throw new Error(`page.text did not contain fixture text: ${initialText}`);
  }

  const packageVersion = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
  const doctorReport = JSON.parse(await runSurf("doctor", "--json"));
  if (
    doctorReport.versions?.cli !== packageVersion ||
    doctorReport.versions?.host !== packageVersion ||
    doctorReport.versions?.extension !== packageVersion
  ) {
    throw new Error(`doctor did not report matching versions: ${JSON.stringify(doctorReport.versions)}`);
  }

  const pageHtml = await runSurf("page.html");
  if (!pageHtml.startsWith("<!doctype html>") || !pageHtml.includes("<h1>Surf real Chrome fixture</h1>")) {
    throw new Error(`page.html without --selector did not return the document: ${pageHtml.slice(0, 300)}`);
  }

  const playbookRead = JSON.parse(
    await runSurf("use", "page", "read", "--json", "--tab-id", String(fixtureTab.id)),
  );
  if (
    playbookRead.strategy !== "network" ||
    typeof playbookRead.value !== "string" ||
    !playbookRead.value.includes("session-cookie-present")
  ) {
    throw new Error(
      `page playbook did not use page-context fetch with the browser session: ${JSON.stringify(playbookRead)}`,
    );
  }

  const pageRead = await runSurf("read", "--depth", "2", "--compact");
  if (!pageRead.includes('button "Mark complete"')) {
    throw new Error(`read did not contain the fixture button: ${pageRead}`);
  }

  await runSurf("click", "--selector", "#fixture-button", "--json");
  await waitFor(
    () => fixturePage.evaluate(() => document.querySelector("#fixture-result")?.textContent === "Clicked by Surf"),
    "Surf click result",
  );
  const clickedText = await runSurf("page.text");
  if (!clickedText.includes("Clicked by Surf")) {
    throw new Error(`page.text did not reflect the click: ${clickedText}`);
  }

  await contentRealm.evaluate(() => {
    const handleVisualIndicatorMessage = window.__piVisualIndicatorMessageHandler;
    window.__surfE2EVisualStates = [];
    window.__piVisualIndicatorMessageHandler = (type) => {
      handleVisualIndicatorMessage(type);
      window.__surfE2EVisualStates.push({
        display: document.querySelector("#pi-agent-glow")?.style.display ?? null,
        type,
      });
    };
  });

  const showResult = await worker.evaluate(
    async (tabId) =>
      await chrome.tabs.sendMessage(tabId, { type: "SHOW_AGENT_INDICATORS" }, { frameId: 0 }),
    fixtureTab.id,
  );
  if (!showResult?.success) {
    throw new Error(`Visual indicator show command failed: ${JSON.stringify(showResult)}`);
  }
  await waitFor(
    () => fixturePage.evaluate(() => document.querySelector("#pi-agent-glow") !== null),
    "visual indicator",
  );

  // js --file with a statement script (MV3 CSP)
  const statementScript = join(scratch, "statement-script.js");
  writeFileSync(
    statementScript,
    'const heading = document.querySelector("h1")?.textContent ?? "";\nreturn { title: document.title, heading };\n',
  );
  const statementResult = unwrapJson(
    await runSurf("js", "--file", statementScript, "--tab-id", String(fixtureTab.id), "--json"),
  );
  if (statementResult?.title !== "Surf real Chrome fixture" || statementResult?.heading !== "Surf real Chrome fixture") {
    throw new Error(`js --file with a leading declaration did not run: ${JSON.stringify(statementResult)}`);
  }

  // Page readiness
  const readiness = unwrapJson(await runSurf("page.readiness", "--json", "--tab-id", String(fixtureTab.id)));
  if (readiness.state !== "ready" || readiness.readyState !== "complete") {
    throw new Error(`page.readiness did not report ready: ${JSON.stringify(readiness)}`);
  }
  const waited = unwrapJson(
    await runSurf("wait.ready", "--json", "--tab-id", String(fixtureTab.id), "--selector", "#fixture-button", "--text", "Clicked by Surf"),
  );
  if (waited.state !== "ready" || typeof waited.polls !== "number" || waited.polls < 1) {
    throw new Error(`wait.ready did not settle on ready: ${JSON.stringify(waited)}`);
  }

  const loginTab = { tabId: tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/login`)) };
  const loginFailure = await runSurfExpectingFailure(
    "wait.ready", "--tab-id", String(loginTab.tabId), "--url-prefix", `${baseUrl}/fixture`, "--timeout", "5000",
  );
  if (!loginFailure.stderr.includes("login") || !loginFailure.stderr.includes("password field")) {
    throw new Error(`wait.ready did not classify the login bounce: ${JSON.stringify(loginFailure)}`);
  }
  const acceptedLogin = unwrapJson(
    await runSurf("wait.ready", "--json", "--tab-id", String(loginTab.tabId), "--url-prefix", `${baseUrl}/fixture`, "--accept", "login"),
  );
  if (acceptedLogin.state !== "login" || acceptedLogin.accepted !== true) {
    throw new Error(`wait.ready --accept login did not return the state: ${JSON.stringify(acceptedLogin)}`);
  }
  await runSurf("tab.close", "--id", String(loginTab.tabId), "--json");

  // read --summary: a fixed content-heavy page, so summary size growth fails here.
  const summaryTab = { tabId: tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/summary`)) };
  const summaryTabId = String(summaryTab.tabId);
  await runSurf("wait.element", "dialog", "--tab-id", summaryTabId, "--json");
  const fullRead = await runSurf("read", "--tab-id", summaryTabId);
  const summaryRead = await runSurf("read", "--summary", "--tab-id", summaryTabId);
  const summaryLines = summaryRead.split("\n");
  if (
    summaryLines[0] !== `Surf summary fixture — ${baseUrl}/summary` ||
    !summaryLines.includes('headings: h1 "Surf News", h2 "Story 1", h2 "Story 2", h2 "Story 3", h2 "Story 4", h2 "Story 5", h2 "Story 6", h2 "Story 7", h2 "Story 8", h2 "Story 9", +111 more') ||
    !summaryLines.includes("  main                     link 240, searchbox 1, button 1") ||
    !summaryLines.includes('  navigation "Sections"    link 8') ||
    !summaryLines.includes('dialogs: dialog "Cookie consent"') ||
    /\be\d+\b/.test(summaryRead)
  ) {
    throw new Error(`read --summary did not summarize the fixture:\n${summaryRead}`);
  }
  const summaryBytes = Buffer.byteLength(summaryRead);
  const fullReadBytes = Buffer.byteLength(fullRead);
  if (summaryBytes > 700 || summaryBytes * 10 > fullReadBytes) {
    throw new Error(`read --summary is ${summaryBytes} bytes; want at most 700 and a tenth of read's ${fullReadBytes}`);
  }
  const summaryJson = unwrapJson(await runSurf("read", "--summary", "--json", "--tab-id", summaryTabId));
  if (
    JSON.stringify(summaryJson.dialogs) !== JSON.stringify([{ role: "dialog", name: "Cookie consent" }]) ||
    JSON.stringify(summaryJson.regions.find(({ region }) => region === 'dialog "Cookie consent"')) !==
      JSON.stringify({ region: 'dialog "Cookie consent"', controls: { button: 2 } }) ||
    summaryJson.headingsOmitted !== 111
  ) {
    throw new Error(`read --summary --json did not return the summary fields: ${JSON.stringify(summaryJson)}`);
  }
  const summaryConflict = await runSurfExpectingFailure("read", "--summary", "--depth", "2", "--tab-id", summaryTabId);
  if (!summaryConflict.stderr.includes("--summary cannot be combined with --depth")) {
    throw new Error(`read --summary --depth did not fail clearly: ${JSON.stringify(summaryConflict)}`);
  }
  await runSurf("tab.close", "--id", summaryTabId, "--json");

  // frame.diagnose
  const framesTab = { tabId: tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/frames`)) };
  await runSurf("wait.element", "#sandboxed", "--tab-id", String(framesTab.tabId), "--json");
  await runSurf("wait.dom", "--tab-id", String(framesTab.tabId), "--json");
  const diagnosis = unwrapJson(await runSurf("frame.diagnose", "--json", "--tab-id", String(framesTab.tabId)));
  const byId = Object.fromEntries(diagnosis.domIframes.map((frame) => [frame.id, frame]));
  if (diagnosis.counts.domIframes !== 5 || !byId["same-origin"] || !byId["inline"] || !byId["cross-origin"] || !byId["sandboxed"] || !byId["shadowed"]) {
    throw new Error(`frame.diagnose did not list the five fixture iframes: ${JSON.stringify(diagnosis)}`);
  }
  if (byId["same-origin"].extensionFrameIds.length !== 1 || byId["same-origin"].cdpFrameIds.length !== 1) {
    throw new Error(`same-origin iframe was not correlated: ${JSON.stringify(byId["same-origin"])}`);
  }
  if (byId["shadowed"].shadowHost !== "div#host" || byId["shadowed"].extensionFrameIds.length !== 1) {
    throw new Error(`shadow-hosted iframe was not inventoried: ${JSON.stringify(byId["shadowed"])}`);
  }
  if (byId["inline"].cdpFrameIds.length !== 1) {
    throw new Error(`srcdoc iframe was not matched to its CDP frame by id: ${JSON.stringify(byId["inline"])}`);
  }
  if (!byId["inline"].blank || byId["cross-origin"].crossOrigin !== true || byId["sandboxed"].scriptsBlocked !== true) {
    throw new Error(`frame flags are wrong: ${JSON.stringify(byId)}`);
  }
  const sameOriginFrame = diagnosis.extensionFrames.find((frame) => frame.frameId === byId["same-origin"].extensionFrameIds[0]);
  if (!sameOriginFrame?.contentScriptReachable) {
    throw new Error(`content script PING did not reach the same-origin iframe: ${JSON.stringify(diagnosis.extensionFrames)}`);
  }
  if (!diagnosis.warnings.some((line) => line.includes("srcdoc")) || !diagnosis.warnings.some((line) => line.includes("allow-scripts"))) {
    throw new Error(`frame.diagnose warnings missing: ${JSON.stringify(diagnosis.warnings)}`);
  }
  await runSurf("tab.close", "--id", String(framesTab.tabId), "--json");

  // Native value setter
  const listTab = { tabId: tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/list`)) };
  await runSurf("wait.element", "#tracked", "--tab-id", String(listTab.tabId), "--json");
  await runSurf("type", "hello tracker", "--into", "#tracked", "--tab-id", String(listTab.tabId), "--no-screenshot", "--json");
  const listPage = (await browser.pages()).find((page) => page.url() === `${baseUrl}/list`);
  if (!listPage) throw new Error("Puppeteer could not find the list fixture page");
  const mirror = await listPage.evaluate(() => document.querySelector("#mirror")?.textContent);
  if (mirror !== "hello tracker") {
    throw new Error(`framework-controlled input did not observe the typed value (mirror=${JSON.stringify(mirror)})`);
  }
  await runSurf("tab.close", "--id", String(listTab.tabId), "--json");

  // Stale ref after a re-render
  const rerenderTabId = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/rerender`)));
  await runSurf("wait.element", "#app button", "--tab-id", rerenderTabId, "--json");
  const staleRef = (await runSurf("read", "--tab-id", rerenderTabId)).match(/button "Save" \[(e\d+)\]/)?.[1];
  if (!staleRef) throw new Error("read did not list the rerender fixture button");
  await runSurf("type", "a", "--into", "#filter", "--tab-id", rerenderTabId, "--no-screenshot", "--json");
  const staleClick = await runSurfExpectingFailure("click", staleRef, "--tab-id", rerenderTabId, "--no-screenshot");
  const suggestedRef = staleClick.stderr.match(
    new RegExp(`Element ${staleRef} no longer exists\\. Did you mean (e\\d+) \\(button "Save"\\)\\? Otherwise run surf read\\.`),
  )?.[1];
  if (!suggestedRef) throw new Error(`stale ref click did not suggest the new ref: ${JSON.stringify(staleClick)}`);
  await runSurf("click", suggestedRef, "--tab-id", rerenderTabId, "--no-screenshot", "--json");
  const rerenderPage = (await browser.pages()).find((page) => page.url() === `${baseUrl}/rerender`);
  const rerenderLog = await rerenderPage?.evaluate(() => document.querySelector("#log")?.textContent);
  if (rerenderLog !== "saved") throw new Error(`suggested ref click did not reach the new button (log=${rerenderLog})`);
  await runSurf("tab.close", "--id", rerenderTabId, "--json");

  // Locators act only on an element the query names uniquely
  const locateTabId = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/locate`)));
  await runSurf("wait.element", "#home-email", "--tab-id", locateTabId, "--json");
  const locatePage = (await browser.pages()).find((page) => page.url() === `${baseUrl}/locate`);
  const locateLog = () => locatePage.evaluate(() => document.querySelector("#log").textContent);
  await runSurf("locate.role", "button", "--name", "Save", "--action", "click", "--tab-id", locateTabId, "--no-screenshot");
  if ((await locateLog()) !== "save") throw new Error(`locate --name Save did not click the exact "Save" (log=${await locateLog()})`);
  const ambiguousDelete = await runSurfExpectingFailure(
    "locate.role", "button", "--name", "Delete", "--action", "click", "--tab-id", locateTabId, "--no-screenshot",
  );
  const deleteRefs = [...ambiguousDelete.stderr.matchAll(/^ {2}(e\d+) button "Delete"$/gm)].map((match) => match[1]);
  if (!ambiguousDelete.stderr.includes('2 elements match role "button" and name "Delete", so nothing was done') || deleteRefs.length !== 2) {
    throw new Error(`ambiguous locate did not list both candidates: ${JSON.stringify(ambiguousDelete)}`);
  }
  if ((await locateLog()) !== "save") throw new Error(`ambiguous locate acted anyway (log=${await locateLog()})`);
  await runSurf("click", deleteRefs[1], "--tab-id", locateTabId, "--no-screenshot");
  if ((await locateLog()) !== "save|delete 1002") throw new Error(`listed ref did not reach the second row (log=${await locateLog()})`);
  const ambiguousLabel = await runSurfExpectingFailure(
    "locate.label", "Email", "--action", "fill", "--value", "x@example.com", "--tab-id", locateTabId, "--no-screenshot",
  );
  const emailValues = await locatePage.evaluate(() => [...document.querySelectorAll("input")].map((input) => input.value));
  if (!ambiguousLabel.stderr.includes('2 elements match label "Email"') || emailValues.some(Boolean)) {
    throw new Error(`ambiguous locate.label filled a field: ${JSON.stringify({ ambiguousLabel, emailValues })}`);
  }
  await runSurf("tab.close", "--id", locateTabId, "--json");

  // Custom controls take their name from their content, so read lists them and locate picks the exact one
  const controlsTabId = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/custom-controls`)));
  await runSurf("wait.element", "[role=button]", "--tab-id", controlsTabId, "--json");
  const controlsRead = await runSurf("read", "--no-text", "--tab-id", controlsTabId);
  for (const name of ["Save draft", "Save", "OK", "New item"]) {
    if (!new RegExp(`button "${name}" \\[e\\d+\\]`).test(controlsRead)) {
      throw new Error(`read did not name the custom button "${name}": ${controlsRead}`);
    }
  }
  await runSurf("locate.role", "button", "--name", "Save", "--action", "click", "--tab-id", controlsTabId, "--no-screenshot");
  const controlsLog = await runSurf("js", 'return document.querySelector("#log").textContent', "--tab-id", controlsTabId);
  if (controlsLog.trim().split("\n").at(-1) !== '"save"') {
    throw new Error(`locate --name Save did not click only the custom "Save" button: ${controlsLog}`);
  }
  await runSurf("tab.close", "--id", controlsTabId, "--json");

  // Form fields inside open shadow roots are listed, named from their shadow label, and typable by ref.
  const shadowTabId = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/shadow-form`)));
  await runSurf("wait.element", "spl-input", "--tab-id", shadowTabId, "--json");
  const shadowRead = await runSurf("read", "--no-text", "--tab-id", shadowTabId);
  const shadowFieldRef = shadowRead.match(/textbox "First name" \[(e\d+)\]/)?.[1];
  if (!shadowFieldRef) throw new Error(`read did not list the shadow-root field "First name": ${shadowRead}`);
  if (!/button "Submit application" \[e\d+\]/.test(shadowRead)) {
    throw new Error(`read did not name the shadow-root slotted button "Submit application": ${shadowRead}`);
  }
  // Text drawn through a slot names the element holding the slot, not the shadow host as well.
  const shadowReadAll = await runSurf("read", "--all", "--no-text", "--tab-id", shadowTabId);
  for (const text of ["Personal information", "Submit application"]) {
    if (shadowReadAll.split(`"${text}"`).length !== 2) throw new Error(`read --all did not list "${text}" exactly once: ${shadowReadAll}`);
  }
  if (!/heading "Personal information" \[e\d+\]/.test(shadowReadAll)) {
    throw new Error(`read --all did not list the slotted title as the heading: ${shadowReadAll}`);
  }
  await runSurf("type", "Ada", "--ref", shadowFieldRef, "--tab-id", shadowTabId, "--no-screenshot");
  const shadowValue = await runSurf("js", 'return document.querySelector("spl-input").shadowRoot.querySelector("input").value', "--tab-id", shadowTabId);
  if (shadowValue.trim() !== '"Ada"') throw new Error(`type --ref did not reach the inner shadow input: ${shadowValue}`);
  const shadowLog = await runSurf("js", 'return document.querySelector("#log").textContent', "--tab-id", shadowTabId);
  if (shadowLog.trim() !== '"input:Ada"') throw new Error(`a light-DOM wrapper did not see the composed input event: ${shadowLog}`);
  await runSurf("tab.close", "--id", shadowTabId, "--json");

  // Locators reach fields inside open shadow roots and act on the inner input, not the host that shares its id.
  const shadowLocateTabId = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/shadow-form`)));
  await runSurf("wait.element", "spl-input", "--tab-id", shadowLocateTabId, "--json");
  const innerRef = (await runSurf("read", "--no-text", "--tab-id", shadowLocateTabId)).match(/textbox "First name" \[(e\d+)\]/)?.[1];
  const locatedLabel = JSON.parse(await runSurf("locate.label", "First name", "--tab-id", shadowLocateTabId, "--json")).result;
  if (!innerRef || locatedLabel.ref !== innerRef) {
    throw new Error(`locate.label did not find the shadow-root input ${innerRef}: ${JSON.stringify(locatedLabel)}`);
  }
  const innerFocused = async () => (await runSurf(
    "js",
    'const host = document.querySelector("spl-input"); return document.activeElement === host && host.shadowRoot.activeElement === host.shadowRoot.querySelector("input")',
    "--tab-id", shadowLocateTabId,
  )).trim() === "true";
  const blurInner = () => runSurf(
    "js", 'document.querySelector("spl-input").shadowRoot.querySelector("input").blur(); return true', "--tab-id", shadowLocateTabId,
  );
  for (const locator of [["locate.role", "textbox", "--name", "First name"], ["locate.text", "First name"]]) {
    await blurInner();
    if (await innerFocused()) throw new Error("the shadow input stayed focused after blur");
    await runSurf(...locator, "--action", "click", "--tab-id", shadowLocateTabId, "--no-screenshot");
    if (!(await innerFocused())) throw new Error(`${locator.join(" ")} --action click did not focus the shadow-root input`);
  }
  // "First name" names its label exactly (the aria-hidden "*" is not part of it), so a longer label does not make it ambiguous.
  await runSurf(
    "js",
    'const spouse = document.createElement("spl-input"); spouse.id = "spouse-name"; spouse.setAttribute("label", "First name of spouse"); document.body.append(spouse); return true',
    "--tab-id", shadowLocateTabId,
  );
  await runSurf(
    "locate.label", "First name", "--action", "fill", "--value", "Ada", "--tab-id", shadowLocateTabId, "--no-screenshot",
  );
  const filled = await runSurf(
    "js",
    'return [document.querySelector("spl-input").shadowRoot.querySelector("input").value, document.querySelector("#log").textContent]',
    "--tab-id", shadowLocateTabId,
  );
  if (JSON.stringify(JSON.parse(filled)) !== '["Ada","input:Ada"]') {
    throw new Error(`locate.label fill did not reach the inner shadow input and its light-DOM listener: ${filled}`);
  }
  // A label over 100 characters names its field in full, so locate --name with the whole label finds it.
  const agreeLabel = "I have read and agree to the Terms of Service, the Privacy Policy, and the Acceptable Use Policy of this example website";
  await runSurf("locate.role", "checkbox", "--name", agreeLabel, "--action", "click", "--tab-id", shadowLocateTabId, "--no-screenshot");
  const agreed = await runSurf("js", 'return document.querySelector("#agree").checked', "--tab-id", shadowLocateTabId);
  if (agreed.trim() !== "true") throw new Error(`locate.role checkbox --name <full 120-character label> did not check it: ${agreed}`);
  await runSurf("tab.close", "--id", shadowLocateTabId, "--json");
  // read shows a field's current value, and never a password's
  const valuesTabId = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/field-values`)));
  await runSurf("wait.element", "textarea", "--tab-id", valuesTabId, "--json");
  const emptyFields = await runSurf("read", "--no-text", "--tab-id", valuesTabId);
  const fieldRef = (pattern) => {
    const ref = emptyFields.match(pattern)?.[1];
    if (!ref) throw new Error(`read did not list ${pattern}: ${emptyFields}`);
    return ref;
  };
  for (const [pattern, text] of [
    [/textbox "hello@example\.com" \[(e\d+)\]/, "hello22"],
    [/textbox \[(e\d+)\] type="password"/, "s3cret-434"],
    [/textbox "Notes" \[(e\d+)\]/, "call back tomorrow"],
    [/textbox "SSN" \[(e\d+)\]/, "masked-434"],
    [/textbox "Quote" \[(e\d+)\]/, 'say "hi" \\'],
  ]) {
    await runSurf("type", text, "--ref", fieldRef(pattern), "--tab-id", valuesTabId, "--no-screenshot", "--json");
  }
  const filledFields = await runSurf("read", "--no-text", "--tab-id", valuesTabId);
  if (!/textbox "hello@example\.com" \[e\d+\] type="email" placeholder="hello@example\.com" value="hello22"/.test(filledFields) ||
      !filledFields.includes('value="call back tomorrow"') || filledFields.includes("s3cret") || !filledFields.includes("[value hidden]") ||
      !filledFields.includes('value="say \\"hi\\" \\\\"')) {
    throw new Error(`read did not show field values without the password: ${filledFields}`);
  }
  if (filledFields.includes("masked-434") || !/textbox "SSN" \[e\d+\] type="text" \[value hidden\]/.test(filledFields)) {
    throw new Error(`read showed a field the page masks on screen: ${filledFields}`);
  }
  // type --escapes turns \n, \t and \\ into a newline, a tab and one backslash; without it the text is typed literally.
  const notesRef = fieldRef(/textbox "Notes" \[(e\d+)\]/);
  const notesValue = async () => JSON.parse(await runSurf("js", 'return [document.querySelector("textarea").value]', "--tab-id", valuesTabId))[0];
  await runSurf("type", "a\\nb\\tc\\\\d", "--escapes", "--ref", notesRef, "--tab-id", valuesTabId, "--no-screenshot", "--json");
  const escaped = await notesValue();
  if (escaped !== "a\nb\tc\\d") throw new Error(`type --escapes did not type a newline, a tab and one backslash: ${JSON.stringify(escaped)}`);
  await runSurf("type", "a\\nb\\tc\\\\d", "--ref", notesRef, "--tab-id", valuesTabId, "--no-screenshot", "--json");
  const literal = await notesValue();
  if (literal !== "a\\nb\\tc\\\\d") throw new Error(`type without --escapes did not type the text literally: ${JSON.stringify(literal)}`);
  await runSurf("tab.close", "--id", valuesTabId, "--json");
  // Page text is the rendered text: no CSS rules, script bodies, noscript text or hidden content
  const textTabId = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/page-text`)));
  await runSurf("wait.element", "h1", "--tab-id", textTabId, "--json");
  const pageText = await runSurf("page.text", "--tab-id", textTabId);
  const readText = (await runSurf("read", "--tab-id", textTabId)).split("--- Page Text ---")[1] ?? "";
  for (const [command, output] of [["page.text", pageText], ["read", readText]]) {
    const leak = ["color:red", "scriptLeak", "noscriptLeak", "hiddenJsonLeak"].find((marker) => output.includes(marker));
    if (!output.includes("Visible copy") || leak) {
      throw new Error(`${command} page text was not the rendered text (leak: ${leak}): ${output}`);
    }
  }
  await runSurf("tab.close", "--id", textTabId, "--json");

  // read ends with how many controls it left off-screen and how to see them; --all lists them instead
  const offscreenTabId = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/offscreen`)));
  await runSurf("wait.element", "input", "--tab-id", offscreenTabId, "--json");
  const onScreenRead = await runSurf("read", "--tab-id", offscreenTabId);
  if (onScreenRead.trimEnd().split("\n").at(-1) !== "+3 elements off-screen: surf read --all" || onScreenRead.includes('"Below 1" [e')) {
    throw new Error(`read did not end with the off-screen count: ${onScreenRead}`);
  }
  const allRead = await runSurf("read", "--all", "--tab-id", offscreenTabId);
  if (allRead.includes("off-screen") || !["Below 1", "Below 2", "Below 3"].every((name) => allRead.includes(`"${name}" [e`))) {
    throw new Error(`read --all did not list the off-screen controls without a count: ${allRead}`);
  }
  await runSurf("tab.close", "--id", offscreenTabId, "--json");

  // A ref click waits for a click a user could make, then clicks with trusted input
  const clickTabId = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/click`)));
  await runSurf("wait.element", "#confirm", "--tab-id", clickTabId, "--json");
  const clickPage = (await browser.pages()).find((page) => page.url() === `${baseUrl}/click`);
  const clickLog = () => clickPage.evaluate(() => document.querySelector("#log").textContent);
  const clickRead = await runSurf("page.read", "--all", "--no-text", "--tab-id", clickTabId);
  const clickRef = (name) => {
    const ref = clickRead.match(new RegExp(`button "${name}" \\[(e\\d+)\\]`))?.[1];
    if (!ref) throw new Error(`page.read did not list button "${name}": ${clickRead}`);
    return ref;
  };
  const clickTab = ["--tab-id", clickTabId, "--no-screenshot"];
  const disabledClick = await runSurfExpectingFailure("click", clickRef("Submit order"), ...clickTab);
  if (!disabledClick.stderr.includes(`${clickRef("Submit order")} is disabled, so it was not clicked`)) {
    throw new Error(`a disabled button was not refused: ${JSON.stringify(disabledClick)}`);
  }
  const coveredClick = await runSurfExpectingFailure("click", clickRef("Delete order"), ...clickTab);
  if (!coveredClick.stderr.includes('is covered by dialog "Cookie consent", so it was not clicked')) {
    throw new Error(`a covered button was not refused: ${JSON.stringify(coveredClick)}`);
  }
  if ((await clickLog()) !== "") throw new Error(`a refused click fired anyway (log=${await clickLog()})`);
  await runSurf("click", clickRef("Pay now"), ...clickTab);
  await runSurf("click", clickRef("Archive order"), ...clickTab);
  await runSurf("click", "--selector", "#arm", ...clickTab);
  await runSurf("click", clickRef("Confirm order"), ...clickTab);
  await runSurf("click", clickRef("Options"), "--button", "right", ...clickTab);
  if ((await clickLog()) !== "pay|archive|confirm|menu") {
    throw new Error(`ref clicks did not reach trusted, clipped, late-enabled and right-click buttons (log=${await clickLog()})`);
  }
  // A click that can't be a real mouse click goes in the page and says why, before its screenshot line.
  const frontTabId = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/type`)));
  const hiddenClick = await runSurf("click", clickRef("Archive order"), "--tab-id", clickTabId);
  const hintAt = hiddenClick.indexOf(`because its tab is hidden`);
  if (hintAt === -1 || !hiddenClick.includes(`surf tab.switch ${clickTabId}`)
    || hintAt > hiddenClick.indexOf("Screenshot (pending):") || !(await clickLog()).endsWith("|archive")) {
    throw new Error(`a click in a background tab did not go in the page with a note: ${hiddenClick} (log=${await clickLog()})`);
  }
  await runSurf("tab.close", "--id", frontTabId, "--json");
  await runSurf("tab.close", "--id", clickTabId, "--json");

  // check/uncheck set a state: clicking only when it differs, with a trusted click the page's app state follows
  const checkTabId = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/check`)));
  await runSurf("wait.element", "#country", "--tab-id", checkTabId, "--json");
  const checkPage = (await browser.pages()).find((page) => page.url() === `${baseUrl}/check`);
  const checkRead = await runSurf("page.read", "--all", "--no-text", "--tab-id", checkTabId);
  const checkRef = (role, name) => {
    const ref = checkRead.match(new RegExp(`${role} "${name}" \\[(e\\d+)\\]`))?.[1];
    if (!ref) throw new Error(`page.read did not list ${role} "${name}": ${checkRead}`);
    return ref;
  };
  const checkTab = ["--tab-id", checkTabId, "--no-screenshot"];
  const missingOption = await runSurfExpectingFailure("select", checkRef("combobox", "United States"), "nowhere", ...checkTab);
  const alreadyChecked = await runSurf("check", checkRef("checkbox", "Newsletter"), ...checkTab);
  await runSurf("check", checkRef("checkbox", "Terms"), ...checkTab);
  const termsAccepted = await checkPage.evaluate(() => document.querySelector("#terms").checked && document.querySelector("#terms-state").textContent);
  await runSurf("uncheck", checkRef("checkbox", "Terms"), ...checkTab);
  const alreadyUnchecked = await runSurf("uncheck", checkRef("checkbox", "Terms"), ...checkTab);
  const radioUncheck = await runSurfExpectingFailure("uncheck", checkRef("radio", "Small"), ...checkTab);
  // Late state updates, a label standing for its hidden input, a partly checked box, and an option value that
  // is another option's text. Each runs even if an earlier one fails, so one failure lists every broken case.
  const lateRuns = [];
  for (const args of [
    ["check", checkRef("switch", "Animated")], ["check", checkRef("switch", "Saved")],
    ["check", checkRef("generic", "Remember me")], ["uncheck", checkRef("checkbox", "Select all")],
    ["form.fill", "--data", JSON.stringify([{ ref: checkRef("combobox", "1"), value: "1" }])],
  ]) lateRuns.push(await runSurf(...args, ...checkTab).then(() => "ok", (error) => `${args[0]}: ${error.stderr?.trim().split("\n").at(-1)}`));
  const lateState = await checkPage.evaluate(() => [
    document.querySelector("#frame-switch").getAttribute("aria-checked"), document.querySelector("#saved-switch").getAttribute("aria-checked"),
    document.querySelector("#styled").checked, document.querySelector("#all").checked, document.querySelector("#all").indeterminate,
    document.querySelector("#qty").value,
  ].join(","));
  if (lateRuns.some((run) => run !== "ok") || lateState !== "true,true,true,false,false,1") {
    throw new Error(`late, label, partly checked or option-value cases failed: ${JSON.stringify({ lateRuns, lateState })}`);
  }
  const checkState = await checkPage.evaluate(() => ({
    news: document.querySelector("#news").checked,
    terms: document.querySelector("#terms").checked,
    small: document.querySelector("#small").checked,
    country: document.querySelector("#country").value,
    log: document.querySelector("#log").textContent,
    termsState: document.querySelector("#terms-state").textContent,
  }));
  if (termsAccepted !== "accepted" || !alreadyChecked.includes("was already checked; nothing clicked") || !alreadyUnchecked.includes("was already unchecked; nothing clicked")
    || !radioUncheck.stderr.includes("is a radio button") || !missingOption.stderr.includes('no option matching "nowhere"')
    || JSON.stringify(checkState) !== JSON.stringify({ news: true, terms: false, small: true, country: "us", log: "terms:true|terms:true", termsState: "not accepted" })) {
    throw new Error(`check/uncheck/select did not set the requested state: ${JSON.stringify({ termsAccepted, alreadyChecked, alreadyUnchecked, radioUncheck, missingOption, checkState })}`);
  }
  await runSurf("tab.close", "--id", checkTabId, "--json");

  // A ref from an earlier page in the tab never resolves on a later one, even when both pages
  // number their elements the same way, and a reload counts as a later page.
  const refsTabId = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/refs-a`)));
  const refsTab = ["--tab-id", refsTabId, "--no-screenshot"];
  await runSurf("wait.ready", "--json", "--tab-id", refsTabId, "--selector", "button");
  const refOf = (read, line) => {
    const ref = read.match(new RegExp(`${line} \\[(e\\d+)\\]`))?.[1];
    if (!ref) throw new Error(`read did not list ${line}: ${read}`);
    return ref;
  };
  const refNumbers = (read) => [...read.matchAll(/\[e(\d+)\]/g)].map((match) => Number(match[1]));
  const readA = await runSurf("read", "--no-text", ...refsTab);
  const keepRef = refOf(readA, 'button "Keep my plan"');
  await runSurf("click", refOf(readA, 'link "Billing settings"'), ...refsTab);
  await runSurf("wait.ready", "--json", "--tab-id", refsTabId, "--selector", "a[href=\"/refs-a\"]");
  const readB = await runSurf("read", "--no-text", ...refsTab);
  const deleteRef = refOf(readB, 'button "Delete account"');
  if (Math.min(...refNumbers(readB)) <= Math.max(...refNumbers(readA))) {
    throw new Error(`page B reused page A's ref numbers: ${JSON.stringify({ readA, readB })}`);
  }
  const pageB = (await browser.pages()).find((page) => page.url() === `${baseUrl}/refs-b`);
  const staleKeep = await runSurfExpectingFailure("click", keepRef, ...refsTab);
  if (!staleKeep.stderr.includes(`${keepRef} is from an earlier page in this tab (${baseUrl}/refs-a).`)) {
    throw new Error(`a ref from page A was not refused on page B: ${JSON.stringify(staleKeep)}`);
  }
  if ((await pageB.evaluate(() => document.querySelector("#log").textContent)) !== "") {
    throw new Error("a ref from page A clicked an element on page B");
  }
  await runSurf("tab.reload", ...refsTab);
  await runSurf("wait.ready", "--json", "--tab-id", refsTabId, "--selector", "a[href=\"/refs-a\"]");
  const staleDelete = await runSurfExpectingFailure("click", deleteRef, ...refsTab);
  if (!staleDelete.stderr.includes(`${deleteRef} is from an earlier page in this tab (${baseUrl}/refs-b).`)) {
    throw new Error(`a ref from before a reload was not refused: ${JSON.stringify(staleDelete)}`);
  }
  await runSurf("back", ...refsTab);
  await runSurf("wait.ready", "--json", "--tab-id", refsTabId, "--selector", "button");
  const titleOfRefsTab = async () =>
    JSON.parse(await runSurf("tab.list", "--json")).find((tab) => String(tab.id) === refsTabId)?.title;
  const backTitle = await titleOfRefsTab();
  if (backTitle !== "restored") throw new Error(`surf back did not restore page A from the back/forward cache (title=${backTitle})`);
  const staleOnRestored = await runSurfExpectingFailure("click", deleteRef, ...refsTab);
  if (!staleOnRestored.stderr.includes(`${deleteRef} is from an earlier page in this tab (${baseUrl}/refs-b).`)) {
    throw new Error(`a restored page did not name the page visited after it: ${JSON.stringify(staleOnRestored)}`);
  }
  // The same document, so its own refs still work.
  await runSurf("click", keepRef, ...refsTab);
  if ((await titleOfRefsTab()) !== "kept") throw new Error("a restored page did not accept its own ref");
  await runSurf("tab.close", "--id", refsTabId, "--json");

  // CDP type enters punctuation and non-ASCII exactly
  const typeTabId = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/type`)));
  await runSurf("wait.element", "#notes", "--tab-id", typeTabId, "--json");
  const typePage = (await browser.pages()).find((page) => page.url() === `${baseUrl}/type`);
  if (!typePage) throw new Error("Puppeteer could not find the type fixture page");
  const punctuated = "john.smith-private's (a&b)#1!%$\" `~=+[]{}\\|;:<>,/?^*_@ é 😀";
  for (const selector of ["#plain", "#notes"]) {
    await runSurf("click", "--selector", selector, "--tab-id", typeTabId, "--no-screenshot", "--json");
    await runSurf("type", punctuated, "--tab-id", typeTabId, "--no-screenshot", "--json");
    const typedValue = await typePage.evaluate((target) => document.querySelector(target).value, selector);
    if (typedValue !== punctuated) {
      throw new Error(`type into ${selector} did not enter the exact text: ${JSON.stringify(typedValue)}`);
    }
  }
  await runSurf("tab.close", "--id", typeTabId, "--json");

  // type refuses text a field can't take and fails when the page doesn't keep the value
  const limitsTabId = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/type-limits`)));
  await runSurf("wait.element", "#name", "--tab-id", limitsTabId, "--json");
  const limitsRead = await runSurf("read", "--tab-id", limitsTabId);
  const limitsRef = (name) => {
    const ref = limitsRead.match(new RegExp(`textbox "${name}" \\[(e\\d+)\\]`))?.[1];
    if (!ref) throw new Error(`read did not list the ${name} field: ${limitsRead}`);
    return ref;
  };
  for (const [name, text, reason] of [
    ["Code", "ABCDEFGH", "accepts at most 4 characters, but 8 were given"],
    ["Locked", "new", "is read-only"],
    ["Reverted", "hello", "did not keep the typed text"],
    ["Wiped", "hello", "did not keep the typed text"],
    ["Off", "new", "is disabled"],
  ]) {
    const ref = limitsRef(name);
    const refused = await runSurfExpectingFailure("type", text, "--ref", ref, "--tab-id", limitsTabId, "--no-screenshot");
    if (!refused.stderr.includes(`${ref} ${reason}`)) throw new Error(`type into ${name} did not fail with "${reason}": ${JSON.stringify(refused)}`);
  }
  const intoRefused = await runSurfExpectingFailure("type", "new", "--into", "#locked", "--tab-id", limitsTabId, "--no-screenshot");
  if (!intoRefused.stderr.includes("#locked is read-only")) throw new Error(`type --into a read-only field did not fail: ${JSON.stringify(intoRefused)}`);
  // A field that reformats the text (a mask) still counts as typed.
  await runSurf("type", "ada", "--ref", limitsRef("Shout"), "--tab-id", limitsTabId, "--no-screenshot", "--json");
  const fillData = JSON.stringify([{ ref: limitsRef("Name"), value: "Ada" }, { ref: limitsRef("Locked"), value: "new" }]);
  const partial = await runSurfExpectingFailure("form.fill", "--data", fillData, "--tab-id", limitsTabId, "--no-screenshot");
  if (!partial.stderr.includes("Filled 1 of 2 fields.") || !partial.stderr.includes(`${limitsRef("Locked")} is read-only`)) {
    throw new Error(`form.fill did not report its partial fill: ${JSON.stringify(partial)}`);
  }
  const limitsPage = (await browser.pages()).find((page) => page.url() === `${baseUrl}/type-limits`);
  const limitValues = await limitsPage?.evaluate(() => [...document.querySelectorAll("input")].map((input) => `${input.id}=${input.value}`).join(" "));
  if (limitValues !== "code= locked=orig reverted=draft wiped= off=orig shout=ADA name=Ada") {
    throw new Error(`type changed fields it refused or missed the ones it may fill: ${limitValues}`);
  }
  await runSurf("tab.close", "--id", limitsTabId, "--json");

  // js --file with statements and --options
  const optionsScript = join(repo, "test/e2e/fixtures/list-items.js");
  const listTabForJs = { tabId: tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/list?q=js`)) };
  await runSurf("wait.ready", "--json", "--tab-id", String(listTabForJs.tabId), "--selector", ".item");
  const jsOutput = unwrapJson(
    await runSurf("js", "--file", optionsScript, "--options", '{"limit": 1}', "--tab-id", String(listTabForJs.tabId), "--json"),
  );
  if (jsOutput?.query !== "js" || jsOutput?.total !== 1 || jsOutput?.rows?.[0]?.title !== "Item 1") {
    throw new Error(`js --file with statements and --options did not return the script result: ${JSON.stringify(jsOutput)}`);
  }
  const optionsTabId = String(listTabForJs.tabId);
  const inlineOptions = unwrapJson(await runSurf(
    "js", "return {limit: SURF_OPTIONS.limit, frozen: Object.isFrozen(SURF_OPTIONS)};",
    "--options", '{"limit":2}', "--tab-id", optionsTabId, "--json",
  ));
  if (inlineOptions.limit !== 2 || inlineOptions.frozen !== true) {
    throw new Error(`js inline options failed: ${JSON.stringify(inlineOptions)}`);
  }
  await runSurf("js", `const frame = document.createElement('iframe'); frame.src = '${baseUrl}/list?q=frame'; document.body.append(frame);`, "--tab-id", optionsTabId);
  let childFrame;
  await waitFor(async () => {
    const result = unwrapJson(await runSurf("frame.list", "--tab-id", optionsTabId, "--json"));
    childFrame = result.find((frame) => frame.url === `${baseUrl}/list?q=frame`);
    return Boolean(childFrame);
  }, "options child frame");
  const frameOutput = unwrapJson(await runSurf(
    "frame.js", "--id", childFrame.frameId, "--file", optionsScript,
    "--options", '{"limit":2}', "--tab-id", optionsTabId, "--json",
  ));
  if (frameOutput.query !== "frame" || frameOutput.total !== 2 || frameOutput.rows[1].title !== "Item 2") {
    throw new Error(`frame.js file options failed: ${JSON.stringify(frameOutput)}`);
  }
  const frameInline = unwrapJson(await runSurf(
    "frame.js", "--id", childFrame.frameId,
    "return {query: new URL(location.href).searchParams.get('q'), frozen: Object.isFrozen(SURF_OPTIONS), limit: SURF_OPTIONS.limit};",
    "--options", '{"limit":3}', "--tab-id", optionsTabId, "--json",
  ));
  if (frameInline.query !== "frame" || frameInline.frozen !== true || frameInline.limit !== 3) {
    throw new Error(`frame.js inline options failed: ${JSON.stringify(frameInline)}`);
  }
  await runSurf("tab.close", "--id", optionsTabId, "--json");

  // extract owned lifecycle
  const pagesBeforeExtract = (await browser.pages()).length;
  const extracted = JSON.parse(await runSurf(
    "extract", `${baseUrl}/list?q=extract`, "--file", optionsScript,
    "--options", '{"limit":2}', "--ready-selector", ".item", "--json",
  ));
  if (extracted.rowCount !== 2 || extracted.data?.query !== "extract" || extracted.rows?.[1]?.title !== "Item 2") {
    throw new Error(`extract success contract failed: ${JSON.stringify(extracted)}`);
  }
  const acceptedEmpty = JSON.parse(await runSurf(
    "extract", `${baseUrl}/list?empty=1`, "--file", optionsScript,
    "--empty-text", "No results for this search.", "--json",
  ));
  if (acceptedEmpty.rowCount !== 0 || acceptedEmpty.readiness?.state !== "empty") {
    throw new Error(`extract accepted-empty contract failed: ${JSON.stringify(acceptedEmpty)}`);
  }
  const rejectedEmpty = await runSurfExpectingFailure(
    "extract", `${baseUrl}/list?empty=1`, "--file", optionsScript,
    "--retry", "1", "--retry-delay-ms", "0", "--json",
  );
  const emptyError = JSON.parse(rejectedEmpty.stdout).error;
  if (emptyError?.code !== "empty_result" || emptyError?.details?.attempts !== 2) {
    throw new Error(`extract rejected-empty contract failed: ${JSON.stringify(emptyError)}`);
  }
  if ((await browser.pages()).length !== pagesBeforeExtract) {
    throw new Error("extract leaked an owned tab");
  }

  // Page changes after actions
  const changesTab = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/changes`)));
  await runSurf("wait.ready", "--json", "--tab-id", changesTab, "--selector", "#leave");
  const dialogOutput = await runSurf("click", "--selector", "#open-dialog", "--tab-id", changesTab);
  const dialogButtons = Object.fromEntries(
    [...dialogOutput.matchAll(/^ {6}(e\d+) button "(Cancel|Delete)"$/gm)].map((match) => [match[2], match[1]]),
  );
  if (!/^changed \(settled in \d+ms\):$/m.test(dialogOutput) || !dialogOutput.includes('  + dialog "Delete project?"\n') || !dialogButtons.Cancel || !dialogButtons.Delete) {
    throw new Error(`click did not report the opened dialog and its buttons: ${dialogOutput}`);
  }
  const confirmOutput = await runSurf("click", dialogButtons.Delete, "--settle", "1000", "--no-screenshot", "--tab-id", changesTab);
  if (!confirmOutput.includes('  - dialog "Delete project?"')) {
    throw new Error(`clicking the reported dialog ref did not remove the dialog: ${confirmOutput}`);
  }
  if (!(await runSurf("page.text", "--tab-id", changesTab)).includes("Project deleted")) {
    throw new Error("clicking the reported dialog ref did not reach the dialog button");
  }
  const checkbox = JSON.parse(await runSurf("click", "--selector", "#notify", "--settle", "1000", "--no-screenshot", "--tab-id", changesTab, "--json"));
  const checkboxChanges = checkbox.pageChanges?.changes;
  if (checkboxChanges?.length !== 1 || checkboxChanges[0].kind !== "changed" || checkboxChanges[0].name !== "Email me" || checkboxChanges[0].property !== "checked" || checkboxChanges[0].to !== true) {
    throw new Error(`checkbox toggle did not report one state change: ${JSON.stringify(checkbox)}`);
  }
  const timeNoop = async (...flags) => {
    const startedAt = Date.now();
    const output = await runSurf("click", "--selector", "#noop", "--no-screenshot", "--tab-id", changesTab, ...flags);
    return { ms: Date.now() - startedAt, output };
  };
  const noopRuns = [];
  for (let run = 0; run < 3; run++) noopRuns.push({ plain: await timeNoop("--no-diff"), diff: await timeNoop() });
  const median = (values) => values.sort((a, b) => a - b)[1];
  const noopLatency = {
    noDiffMs: median(noopRuns.map((run) => run.plain.ms)),
    diffMs: median(noopRuns.map((run) => run.diff.ms)),
  };
  noopLatency.addedMs = noopLatency.diffMs - noopLatency.noDiffMs;
  if (noopRuns.some((run) => !/^no visible change \(quiet \d+ms\)$/m.test(run.diff.output) || run.plain.output.includes("visible change"))) {
    throw new Error(`no-op click did not report no visible change: ${JSON.stringify(noopRuns)}`);
  }
  if (noopLatency.addedMs > 1500) {
    throw new Error(`page changes added too much latency to a no-op click: ${JSON.stringify(noopLatency)}`);
  }
  const secret = "hunter2-page-changes";
  const typedOutput = await runSurf("type", secret, "--into", "#secret", "--settle", "1000", "--no-screenshot", "--tab-id", changesTab);
  const typedJson = await runSurf("type", `${secret}-json`, "--into", "#secret", "--settle", "1000", "--no-screenshot", "--tab-id", changesTab, "--json");
  if (!/"Password" {2}value changed$/m.test(typedOutput) || typedOutput.includes(secret) || typedJson.includes(secret)) {
    throw new Error(`typing into a password field leaked or missed the change: ${typedOutput}\n${typedJson}`);
  }
  const tickerOutput = await runSurf("click", "--selector", "#ticker-start", "--settle", "600", "--no-screenshot", "--tab-id", changesTab);
  if (!/^still changing after \d+ms \(partial\):$/m.test(tickerOutput)) {
    throw new Error(`a page that keeps changing was not reported as partial: ${tickerOutput}`);
  }
  const leaveOutput = await runSurf("click", "--selector", "#leave", "--no-screenshot", "--tab-id", changesTab);
  const navigatedLines = leaveOutput.split("\n").filter((line) => line.startsWith("navigated: "));
  if (navigatedLines.length !== 1 || navigatedLines[0] !== `navigated: ${baseUrl}/changes -> ${baseUrl}/changes-target "Changes target"` || leaveOutput.includes("changed (")) {
    throw new Error(`a navigating click did not report one navigation line: ${leaveOutput}`);
  }
  await runSurf("tab.close", "--id", changesTab, "--json");

  // Native JS dialogs (#343): the click that opens one returns, and dialog.* handle it.
  const nativeDialogNotice = (type, message) =>
    `Native ${type} dialog is open: ${JSON.stringify(message)}. Close it with dialog.accept or dialog.dismiss.`;
  const expectNativeDialog = async (tabId, type, message) => {
    const info = unwrapJson(await runSurf("dialog.info", "--tab-id", tabId, "--json"));
    if (info?.hasDialog !== true || info.type !== type || info.message !== message) {
      throw new Error(`dialog.info did not report the open ${type} dialog: ${JSON.stringify(info)}`);
    }
  };
  // CDP click (--selector) on a tab the debugger already controls.
  const cdpDialogTab = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/native-dialog`)));
  await runSurf("wait.ready", "--json", "--tab-id", cdpDialogTab, "--selector", "#confirm");
  for (const flags of [[], ["--no-diff", "--no-screenshot"]]) {
    const clicked = await runSurf("click", "--selector", "#alert", "--tab-id", cdpDialogTab, ...flags);
    if (clicked.trim() !== `OK\n${nativeDialogNotice("alert", "hi")}`) {
      throw new Error(`a click that opened alert() did not report it (${flags.join(" ")}): ${clicked}`);
    }
    await expectNativeDialog(cdpDialogTab, "alert", "hi");
    await runSurf("dialog.accept", "--tab-id", cdpDialogTab, "--no-screenshot");
    if (unwrapJson(await runSurf("dialog.info", "--tab-id", cdpDialogTab, "--json"))?.hasDialog !== false) {
      throw new Error("dialog.accept did not close the alert");
    }
  }
  await runSurf("tab.close", "--id", cdpDialogTab, "--json");
  // Content-script click (ref) on a tab no command has attached the debugger to yet.
  const refDialogTab = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/native-dialog`)));
  const confirmRef = (await runSurf("page.read", "--tab-id", refDialogTab)).match(/button "Confirm" \[(e\d+)\]/)?.[1];
  for (const [flags, verb, answer] of [[[], "dialog.dismiss", "no"], [["--no-diff", "--no-screenshot"], "dialog.accept", "yes"]]) {
    const clicked = await runSurf("click", confirmRef, "--tab-id", refDialogTab, ...flags);
    if (clicked.trim() !== `OK\n${nativeDialogNotice("confirm", "Sure?")}`) {
      throw new Error(`a ref click that opened confirm() did not report it (${flags.join(" ")}): ${clicked}`);
    }
    await expectNativeDialog(refDialogTab, "confirm", "Sure?");
    await runSurf(verb, "--tab-id", refDialogTab, "--no-screenshot");
    if (!(await runSurf("page.text", "--tab-id", refDialogTab)).includes(`Alert Confirm ${answer}`)) {
      throw new Error(`${verb} did not answer the confirm() with ${answer}`);
    }
  }
  await runSurf("tab.close", "--id", refDialogTab, "--json");

  // A command cut short by a navigation names the navigation, not a missing content script.
  const leavingTab = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/navigates-away`)));
  await runSurf("wait.ready", "--json", "--tab-id", leavingTab, "--selector", "p");
  const cutShort = await runSurfExpectingFailure("wait.element", "#never", "--timeout", "15000", "--tab-id", leavingTab);
  if (cutShort.stderr.includes("Content script not loaded") || !cutShort.stderr.includes("The page navigated or closed")) {
    throw new Error(`a wait cut short by navigation did not report the navigation: ${JSON.stringify(cutShort)}`);
  }
  await runSurf("tab.close", "--id", leavingTab, "--json");

  // Upload through the visible button that opens a hidden file input's chooser (#363).
  const uploadTab = String(tabIdFromOutput(await runSurf("tab.new", `${baseUrl}/upload`)));
  await runSurf("wait.ready", "--json", "--tab-id", uploadTab, "--selector", "#upload-button");
  const uploadFile = join(scratch, "resume.txt");
  writeFileSync(uploadFile, "resume\n");
  const uploadRead = await runSurf("page.read", "--tab-id", uploadTab);
  const uploadRef = (label) => {
    const ref = uploadRead.match(new RegExp(`"${label}" \\[(e\\d+)\\]`))?.[1];
    if (!ref) throw new Error(`page.read did not list "${label}": ${uploadRead}`);
    return ref;
  };
  await runSurf("upload", "--ref", uploadRef("Upload resume"), "--files", uploadFile, "--tab-id", uploadTab);
  if (!(await runSurf("page.text", "--tab-id", uploadTab)).includes("Uploaded 1 file: resume.txt")) {
    throw new Error("upload --ref <button> did not set the file on the hidden input it opens");
  }
  const coverFile = join(scratch, "cover.txt");
  writeFileSync(coverFile, "cover\n");
  await runSurf("upload", "--ref", uploadRef("Cover letter"), "--files", coverFile, "--tab-id", uploadTab);
  if (!(await runSurf("page.text", "--tab-id", uploadTab)).includes("Uploaded 1 file: cover.txt")) {
    throw new Error("upload --ref <file input> no longer sets the file");
  }
  const noChooserStart = Date.now();
  const noChooser = await runSurfExpectingFailure("upload", "--ref", uploadRef("Does nothing"), "--files", uploadFile, "--tab-id", uploadTab);
  const noChooserMs = Date.now() - noChooserStart;
  if (noChooserMs > 15_000 || !`${noChooser.stdout}${noChooser.stderr}`.includes("No file chooser opened")) {
    throw new Error(`upload --ref <button that opens nothing> did not fail naming the file chooser (${noChooserMs}ms): ${JSON.stringify(noChooser)}`);
  }
  if (!(await runSurf("page.read", "--tab-id", uploadTab)).includes("Upload resume")) {
    throw new Error("page.read failed on the tab after a failed upload");
  }
  await runSurf("tab.close", "--id", uploadTab, "--json");

  await runSurf("screenshot", "--output", screenshotPath);
  const png = readFileSync(screenshotPath);
  if (png.length < 100 || png.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a") {
    throw new Error("screenshot was not a valid PNG");
  }
  await waitFor(
    () => fixturePage.evaluate(() => document.querySelector("#pi-agent-glow") !== null),
    "visual indicator restoration after screenshot",
  );
  const screenshotVisualStates = await contentRealm.evaluate(() => window.__surfE2EVisualStates);
  const hiddenForScreenshot = screenshotVisualStates.find(
    (state) => state.type === "HIDE_FOR_TOOL_USE",
  );
  const restoredAfterScreenshot = screenshotVisualStates.find(
    (state) => state.type === "SHOW_AFTER_TOOL_USE",
  );
  if (hiddenForScreenshot?.display !== "none" || restoredAfterScreenshot?.display !== "") {
    throw new Error(
      `Screenshot did not hide and restore the visual indicator: ${JSON.stringify(screenshotVisualStates)}`,
    );
  }

  const hideResult = await worker.evaluate(
    async (tabId) =>
      await chrome.tabs.sendMessage(tabId, { type: "HIDE_AGENT_INDICATORS" }, { frameId: 0 }),
    fixtureTab.id,
  );
  if (!hideResult?.success) {
    throw new Error(`Visual indicator hide command failed: ${JSON.stringify(hideResult)}`);
  }
  await waitFor(
    () => fixturePage.evaluate(() => document.querySelector("#pi-agent-glow") === null),
    "visual indicator removal",
  );

  // Site harvesting through a project playbook: replay, replay rejected -> drive, and DOM collect.
  const harvestUrl = `${baseUrl}/harvest`;
  const harvestProject = join(scratch, "harvest-project");
  const harvestPlaybook = join(harvestProject, ".surf/playbooks/harvest");
  mkdirSync(join(harvestPlaybook, "ops"), { recursive: true });
  writeFileSync(
    join(harvestPlaybook, "playbook.json"),
    JSON.stringify({ id: "harvest", version: "1.0.0", origins: [baseUrl] }),
  );
  const feedRecords = { find: { exists: ["id", "text"] }, key: "id", fields: { id: "id", text: "text" } };
  const collectFeed = {
    using: "collect",
    open: "{{url}}",
    item: ".row",
    key: ":scope@data-id",
    fields: { id: ":scope@data-id", text: ".text" },
    scrollDelayMs: 300,
  };
  const feedOp = (id, api) => ({
    id,
    args: { url: { required: true } },
    run: [{ using: "api", open: "{{url}}", records: feedRecords, expect: { minItems: 1 }, ...api }, collectFeed],
  });
  writeFileSync(
    join(harvestPlaybook, "ops/feed.json"),
    JSON.stringify(
      feedOp("feed", {
        match: "/harvest-api/*/feed",
        cursor: { find: { equals: { type: "Bottom" } }, path: "value", into: "query.variables.cursor" },
      }),
    ),
  );
  writeFileSync(
    join(harvestPlaybook, "ops/feed-unmatched.json"),
    JSON.stringify(feedOp("feed-unmatched", { match: "/harvest-api/*/never", timeoutMs: 3000 })),
  );
  const expectedFeed = JSON.stringify(
    Array.from({ length: 20 }, (_, index) => ({ id: `item-${index + 1}`, text: `Item ${index + 1}` })),
  );
  const harvestTab = tabIdFromOutput(await runSurf("tab.new", fixtureUrl, "--json"));
  const useHarvest = async (...args) =>
    (
      await execFileAsync(
        process.execPath,
        [join(repo, "native/cli.cjs"), "use", "harvest", ...args, "--tab-id", String(harvestTab)],
        { cwd: harvestProject, env, timeout: 90_000, maxBuffer: 10 * 1024 * 1024 },
      )
    ).stdout;
  const loadedByPage = async (url) => {
    const page = (await browser.pages()).find((candidate) => candidate.url() === url);
    if (!page) throw new Error(`Puppeteer could not find ${url}`);
    return page.evaluate(() => document.querySelector("#list").dataset.loaded);
  };

  const replayed = JSON.parse(await useHarvest("feed", "--url", harvestUrl, "--json"));
  const replayLoaded = await loadedByPage(harvestUrl);
  if (replayed.strategy !== "api" || JSON.stringify(replayed.value) !== expectedFeed || replayLoaded !== "4") {
    throw new Error(`api replay did not return the whole feed: ${JSON.stringify({ replayed, replayLoaded })}`);
  }

  const nonceUrl = `${harvestUrl}?nonce=1`;
  const driven = JSON.parse(await useHarvest("feed", "--url", nonceUrl, "--json"));
  const drivenLoaded = await loadedByPage(nonceUrl);
  if (
    driven.strategy !== "api" ||
    JSON.stringify(driven.value) !== expectedFeed ||
    harvestStats.rejected !== 1 ||
    drivenLoaded !== "20"
  ) {
    throw new Error(
      `api auto mode did not fall back to driving the page: ${JSON.stringify({ driven, drivenLoaded, harvestStats })}`,
    );
  }

  const collectedJsonl = await useHarvest("feed-unmatched", "--url", harvestUrl, "--format", "jsonl");
  const collected = collectedJsonl.trim().split("\n").map((line) => JSON.parse(line));
  if (JSON.stringify(collected) !== expectedFeed) {
    throw new Error(`collect fallback did not return the whole feed: ${collectedJsonl}`);
  }

  const firstFeedPage = unwrapJson(
    await runSurf("network.wait", "--match", "/harvest-api/*/feed", "--open", harvestUrl, "--json", "--tab-id", String(harvestTab)),
  );
  const secondPage = unwrapJson(
    await runSurf("network.replay", firstFeedPage.id, "--set", "query.variables.cursor=c1", "--json", "--tab-id", String(harvestTab)),
  );
  if (firstFeedPage.json?.data?.items?.[0]?.id !== "item-1" || secondPage.status !== 200 || secondPage.json?.data?.items?.[0]?.id !== "item-5") {
    throw new Error(`network.wait/network.replay failed: ${JSON.stringify({ firstFeedPage, secondPage })}`);
  }

  // Last, because it restarts the native host: a host reporting another version makes
  // each command print one stderr line, while its stdout stays the same.
  const tabListBeforeSkew = await runSurf("tab.list");
  writeFileSync(nativeManifest.path, hostWrapper("export SURF_TEST_HOST_VERSION=0.0.1\n"));
  const matchingHostPid = Number.parseInt(readFileSync(hostPidPath, "utf8"), 10);
  rmSync(hostPidPath);
  await terminateProcess(matchingHostPid, "Surf native host");
  await waitFor(() => existsSync(hostPidPath), "restarted Surf native-host PID", 30_000);
  let skewed;
  await waitFor(async () => {
    skewed = await execFileAsync(process.execPath, [join(repo, "native/cli.cjs"), "tab.list"], {
      cwd: repo,
      env,
      timeout: 20_000,
    }).catch(() => null);
    return skewed !== null;
  }, "restarted Surf native host to answer", 30_000);
  const expectedSkewLine = `surf: version mismatch (cli ${packageVersion}, host 0.0.1, extension ${packageVersion}). Run \`surf update\`.\n`;
  if (skewed.stderr !== expectedSkewLine || skewed.stdout !== tabListBeforeSkew) {
    throw new Error(`version mismatch was not reported as one stderr line: ${JSON.stringify(skewed)}`);
  }

  // surf update's reload, through the live host: the extension reloads itself from disk and
  // starts a fresh native host, now from the restored wrapper, that the extension greets again.
  // Chrome reloads an unpacked extension only with Developer mode on, as it is for anyone who
  // clicked "Load unpacked"; this test profile loaded it without, so turn it on first.
  const extensionsPage = await browser.newPage();
  await extensionsPage.goto("chrome://extensions");
  await extensionsPage.evaluate(
    () => new Promise((resolve) => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, resolve)),
  );
  await extensionsPage.close();
  writeFileSync(nativeManifest.path, hostWrapper());
  const skewedHostPid = Number.parseInt(readFileSync(hostPidPath, "utf8"), 10);
  rmSync(hostPidPath);
  const { reloadExtension } = require(join(repo, "native/update.cjs"));
  const reload = await reloadExtension({ socketPath });
  const reloadedHostPid = existsSync(hostPidPath) ? Number.parseInt(readFileSync(hostPidPath, "utf8"), 10) : null;
  if (
    !reload.ok ||
    reload.versions.host !== packageVersion ||
    reload.versions.extension !== packageVersion ||
    !reloadedHostPid ||
    reloadedHostPid === skewedHostPid
  ) {
    throw new Error(`the extension did not reload and reconnect: ${JSON.stringify({ reload, skewedHostPid, reloadedHostPid })}`);
  }

  console.log(
    JSON.stringify(
      {
        chrome: chromeExecutablePath,
        extensionId,
        platform: process.platform,
        result: "pass",
        readiness: { fixture: readiness.state, loginAccepted: acceptedLogin.state },
        frameDiagnoseWarnings: diagnosis.warnings.length,
        scriptOptions: { js: jsOutput.total, frameJs: frameOutput.total, frozen: frameInline.frozen },
        pageChanges: { noopLatency },
        upload: { viaButton: "resume.txt", viaInput: "cover.txt", noChooserMs },
        harvest: { replay: replayed.value.length, drive: driven.value.length, collect: collected.length },
        screenshotBytes: png.length,
        serviceWorker: workerTarget.url(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  failure = error;
}

const cleanupErrors = [];
try {
  if (browser) await browser.close();
} catch (error) {
  cleanupErrors.push(error);
}
try {
  if (browserPid) await terminateProcess(browserPid, "Chrome");
} catch (error) {
  cleanupErrors.push(error);
}
try {
  await terminateProcessesUsingProfile();
} catch (error) {
  cleanupErrors.push(error);
}
try {
  if (server) {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
} catch (error) {
  cleanupErrors.push(error);
}
try {
  if (crossOriginServer) {
    await new Promise((resolve, reject) => {
      crossOriginServer.close((error) => (error ? reject(error) : resolve()));
    });
  }
} catch (error) {
  cleanupErrors.push(error);
}
try {
  if (existsSync(hostPidPath)) {
    const hostPid = Number.parseInt(readFileSync(hostPidPath, "utf8"), 10);
    if (Number.isInteger(hostPid)) await terminateProcess(hostPid, "Surf native host");
  }
} catch (error) {
  cleanupErrors.push(error);
}
try {
  rmSync(scratch, { recursive: true, force: true });
} catch (error) {
  cleanupErrors.push(error);
}

if (failure) {
  for (const cleanupError of cleanupErrors) console.error("Cleanup error:", cleanupError);
  throw failure;
}
if (cleanupErrors.length > 0) {
  throw new AggregateError(cleanupErrors, "Real Chrome E2E cleanup failed");
}
