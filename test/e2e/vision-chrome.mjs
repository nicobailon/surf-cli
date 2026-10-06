// Shared real-Chrome setup for --vision checks: the built extension, the native host, and a local fixture server.
// Same stable test key and native-host wiring as test/e2e/real-chrome.mjs. Run `npm run build` first.
import { execFile } from "node:child_process";
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const extensionKey =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEArWZVsRzpoyzuyQFqRzGOnkxv9FNaX/SR/VMw2f9ld+DKmUMxJhi/14olehkLWRJQumFPYTzWr1oqb1LwwI2KhBtn9mbaqzPSrrRGQ1VobTx7ZmxU+ooppXNdb2KGh/WXVqahS0D1nsQplAE6hCqQWPjsPCnXnWjUIH/B0EsInIUDwA8PKfuMG8p2HDlLj8hEpmLwOA48W4aHbl2S6bZHu9O50Lbd0L94aSwJLBNLKuXpBt/kFwlnpHd3zoJme9DIbqnDU/nMNh9SlA+EXRT6FhyiKdo6ZBMdtJeUPLQI2uHeoF8wikkNhIXX/E2EXlBqtZJJaFEi895x2s40+j/iZQIDAQAB"; // gitleaks:allow -- public test manifest key
const extensionId = "nionemkjcnknfdhdolfloigkhpjnifmf";

/** `pages` maps a URL path to its HTML, or to `{ type, body, headers }` for other content. `args` are extra Chrome flags. */
export async function launchVisionChrome(repo, pages, { args = [] } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), "surf-vision-chrome-"));
  const home = join(scratch, "home");
  const extensionDir = join(scratch, "extension");
  const profileDir = join(scratch, "profile");
  const socketPath = join(scratch, "surf.sock");
  const surfTmp = join(scratch, "tmp");
  const env = {
    ...process.env,
    HOME: home,
    SURF_HOST_PATH: join(repo, "native/host.cjs"),
    SURF_NODE_PATH: process.execPath,
    SURF_SOCKET: socketPath,
    SURF_TMP: surfTmp,
    XDG_CONFIG_HOME: join(home, ".config"),
  };
  delete env.SURF_SEMANTIC_MODEL;
  delete env.TYPESAFE_API_KEY;
  let browser;
  let server;
  let transport;
  const close = async () => {
    try {
      await transport?.close();
    } catch {
      // Already closed by the native host.
    }
    await browser?.close().catch(() => {});
    await new Promise((done) => (server ? server.close(done) : done()));
    rmSync(scratch, { recursive: true, force: true });
  };
  try {
    mkdirSync(home, { recursive: true });
    mkdirSync(surfTmp, { recursive: true });
    cpSync(join(repo, "dist"), extensionDir, { recursive: true });
    const manifestPath = join(extensionDir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.key = extensionKey;
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await execFileAsync(process.execPath, [join(repo, "scripts/install-native-host.cjs"), extensionId], { cwd: repo, env, timeout: 20_000 });
    const standardManifest = join(
      home,
      process.platform === "darwin"
        ? "Library/Application Support/Google/Chrome/NativeMessagingHosts/surf.browser.host.json"
        : ".config/google-chrome/NativeMessagingHosts/surf.browser.host.json",
    );
    const nativeManifest = JSON.parse(readFileSync(standardManifest, "utf8"));
    writeFileSync(
      nativeManifest.path,
      `#!/usr/bin/env bash\nexport SURF_SOCKET=${JSON.stringify(socketPath)}\nexport SURF_TMP=${JSON.stringify(surfTmp)}\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(join(repo, "native/host.cjs"))} "$@"\n`,
    );
    chmodSync(nativeManifest.path, 0o755);
    mkdirSync(join(profileDir, "NativeMessagingHosts"), { recursive: true });
    cpSync(standardManifest, join(profileDir, "NativeMessagingHosts/surf.browser.host.json"));

    server = createServer((request, response) => {
      const page = pages[new URL(request.url, "http://127.0.0.1").pathname];
      const content = typeof page === "string" ? { type: "text/html; charset=utf-8", body: page } : page;
      response.writeHead(content ? 200 : 404, { "content-type": content?.type ?? "text/plain", ...content?.headers });
      response.end(content?.body ?? "");
    });
    await new Promise((done, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", done);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;

    const { default: puppeteer } = await import("puppeteer");
    browser = await puppeteer.launch({
      headless: true,
      // No viewport emulation: pages render in the real window, as they do for a user.
      defaultViewport: null,
      enableExtensions: [extensionDir],
      userDataDir: profileDir,
      env,
      args: [...(process.platform === "linux" ? ["--no-sandbox"] : []), ...args],
    });
    const workerTarget = await browser.waitForTarget(
      (target) => target.type() === "service_worker" && target.url().startsWith(`chrome-extension://${extensionId}/`),
      { timeout: 20_000 },
    );
    const deadline = Date.now() + 20_000;
    while (!existsSync(socketPath)) {
      if (Date.now() > deadline) throw new Error("Timed out waiting for the Surf native-host socket");
      await new Promise((done) => setTimeout(done, 100));
    }
    const { openClientTransport } = require("../../native/client-transport.cjs");
    const { selectEndpoint } = require("../../native/endpoint.cjs");
    transport = await openClientTransport(selectEndpoint([], env).endpoint, { requestTimeoutMs: 60_000 });

    const surf = async (...args) => {
      const { stdout } = await execFileAsync(process.execPath, [join(repo, "native/cli.cjs"), ...args], {
        cwd: repo,
        env,
        timeout: 60_000,
        maxBuffer: 10 * 1024 * 1024,
      });
      return stdout;
    };
    let readId = 0;
    return {
      browser,
      baseUrl,
      env,
      surf,
      close,
      worker: await workerTarget.worker(),
      async openTab(path) {
        const url = `${baseUrl}${path}`;
        const tabId = Number((await surf("tab.new", url)).match(/\btab\s+(\d+)\b/i)[1]);
        const page = (await browser.pages()).find((item) => item.url() === url);
        return { tabId, page };
      },
      /** One page.read straight through the native host; returns the semantic observation. */
      async readPage(tabId, args) {
        const response = await transport.request({
          type: "tool_request",
          method: "execute_tool",
          params: { tool: "page.read", args },
          id: `vision-read-${++readId}`,
          tabId,
        }, 60_000);
        if (response?.error) throw new Error(`page.read failed: ${response.error.message || JSON.stringify(response.error)}`);
        return JSON.parse(response.result.content.find((item) => item.type === "text").text).semanticObservation;
      },
    };
  } catch (error) {
    await close();
    throw error;
  }
}
