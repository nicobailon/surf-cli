import { createHash } from "node:crypto";
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
const extensionKey =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArWZVsRzpoyzuyQFqRzGOnkxv9FNaX/SR/VMw2f9ld+DKmUMxJhi/14olehkLWRJQumFPYTzWr1oqb1LwwI2KhBtn9mbaqzPSrrRGQ1VobTx7ZmxU+ooppXNdb2KGh/WXVqahS0D1nsQplAE6hCqQWPjsPCnXnWjUIH/B0EsInIUDwA8PKfuMG8p2HDlLj8hEpmLwOA48W4aHbl2S6bZHu9O50Lbd0L94aSwJLBNLKuXpBt/kFwlnpHd3zoJme9DIbqnDU/nMNh9SlA+EXRT6FhyiKdo6ZBMdtJeUPLQI2uHeoF8wikkNhIXX/E2EXlBqtZJJaFEi895x2s40+j/iZQIDAQAB"; // gitleaks:allow -- public test manifest key
const extensionId = "nionemkjcnknfdhdolfloigkhpjnifmf";
const pinnedChromeVersion = "154.0.8037.57";
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

function extensionIdForKey(key) {
  const digest = createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16);
  return Array.from(digest, (byte) =>
    `${String.fromCharCode(97 + (byte >> 4))}${String.fromCharCode(97 + (byte & 15))}`,
  ).join("");
}

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
  if (url.pathname === "/native-dialog") {
    return `<!doctype html><html><head><title>Native dialog fixture</title></head>
<body><main><button id="alert" onclick="alert('hi')">Alert</button>
<button id="confirm" onclick="document.querySelector('#answer').textContent = confirm('Sure?') ? 'yes' : 'no'">Confirm</button>
<p id="answer">none</p></main></body></html>`;
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
  return null;
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

  if (extensionIdForKey(extensionKey) !== extensionId) {
    throw new Error("Stable extension key does not match the expected test extension ID");
  }

  mkdirSync(home, { recursive: true });
  mkdirSync(surfTmp, { recursive: true });
  cpSync(join(repo, "dist"), extensionDir, { recursive: true });
  const extensionManifestPath = join(extensionDir, "manifest.json");
  const extensionManifest = JSON.parse(readFileSync(extensionManifestPath, "utf8"));
  extensionManifest.key = extensionKey;
  writeFileSync(extensionManifestPath, `${JSON.stringify(extensionManifest, null, 2)}\n`);

  await execFileAsync(
    process.execPath,
    [join(repo, "scripts/install-native-host.cjs"), extensionId],
    { cwd: repo, env, timeout: 20_000 },
  );

  const standardManifest = join(
    home,
    process.platform === "darwin"
      ? "Library/Application Support/Google/Chrome/NativeMessagingHosts/surf.browser.host.json"
      : ".config/google-chrome/NativeMessagingHosts/surf.browser.host.json",
  );
  const nativeManifest = JSON.parse(readFileSync(standardManifest, "utf8"));
  writeFileSync(
    nativeManifest.path,
    `#!/usr/bin/env bash\necho $$ > ${JSON.stringify(hostPidPath)}\nexport SURF_SOCKET=${JSON.stringify(socketPath)}\nexport SURF_TMP=${JSON.stringify(surfTmp)}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(repo, "native/host.cjs"))} "$@"\n`,
  );
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
