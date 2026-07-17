import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import puppeteer from "puppeteer";

const execFileAsync = promisify(execFile);
const repo = process.cwd();
const extensionKey =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArWZVsRzpoyzuyQFqRzGOnkxv9FNaX/SR/VMw2f9ld+DKmUMxJhi/14olehkLWRJQumFPYTzWr1oqb1LwwI2KhBtn9mbaqzPSrrRGQ1VobTx7ZmxU+ooppXNdb2KGh/WXVqahS0D1nsQplAE6hCqQWPjsPCnXnWjUIH/B0EsInIUDwA8PKfuMG8p2HDlLj8hEpmLwOA48W4aHbl2S6bZHu9O50Lbd0L94aSwJLBNLKuXpBt/kFwlnpHd3zoJme9DIbqnDU/nMNh9SlA+EXRT6FhyiKdo6ZBMdtJeUPLQI2uHeoF8wikkNhIXX/E2EXlBqtZJJaFEi895x2s40+j/iZQIDAQAB"; // gitleaks:allow -- public test manifest key
const extensionId = "nionemkjcnknfdhdolfloigkhpjnifmf";
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

try {
  if (!new Set(["darwin", "linux"]).has(process.platform)) {
    throw new Error(`Real Chrome E2E does not support ${process.platform}`);
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

  server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(`<!doctype html>
<html>
  <head><title>Surf real Chrome fixture</title></head>
  <body>
    <main>
      <h1>Surf real Chrome fixture</h1>
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
        chrome: await puppeteer.executablePath(),
        extensionId,
        platform: process.platform,
        result: "pass",
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
