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
const pinnedChromeVersion = "152.0.7977.75";
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

  // --- js --file with a statement script (MV3 CSP) -----------------------
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

  // --- page readiness ---------------------------------------------------
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

  // --- frame.diagnose ----------------------------------------------------
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

  // --- native value setter -------------------------------------------------
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
