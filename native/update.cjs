const fs = require("fs");
const net = require("net");
const path = require("path");
const { spawn } = require("child_process");
const { SOCKET_PATH } = require("./socket-path.cjs");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const MANUAL_RELOAD = "Reload Surf once in chrome://extensions; later `surf update` runs reload it for you.";

// How this surf is installed, from the real path of its package. A global npm install lives in
// <prefix>/lib/node_modules/surf-cli (<prefix>\node_modules\surf-cli on Windows) and is updated
// with the npm of that prefix, not whichever npm is first on PATH. A linked repo checkout
// resolves to the repo itself, which has a .git, and is rebuilt in place.
function planUpdate(packageRoot = PACKAGE_ROOT, platform = process.platform) {
  const root = fs.realpathSync(packageRoot);
  const isWin = platform === "win32";
  const modules = path.dirname(root);
  if (path.basename(root) === "surf-cli" && path.basename(modules) === "node_modules") {
    const prefix = isWin ? path.dirname(modules) : path.dirname(path.dirname(modules));
    const npm = isWin ? path.join(prefix, "npm.cmd") : path.join(prefix, "bin", "npm");
    if ((isWin || path.basename(path.dirname(modules)) === "lib") && fs.existsSync(npm)) {
      // npm_config_prefix keeps the install in this prefix even if npm's shebang finds another node.
      return {
        kind: "npm",
        root,
        steps: [{ command: npm, args: ["install", "-g", "surf-cli@latest"], cwd: prefix, env: { npm_config_prefix: prefix } }],
      };
    }
    throw new Error(`surf is installed in ${root}, but there is no npm at ${npm} to update it. Update it with the npm you installed it with: npm install -g surf-cli@latest`);
  }
  if (fs.existsSync(path.join(root, ".git"))) {
    const npm = isWin ? "npm.cmd" : "npm";
    return {
      kind: "repo",
      root,
      steps: [
        { command: npm, args: ["ci"], cwd: root },
        { command: npm, args: ["run", "build"], cwd: root },
      ],
    };
  }
  throw new Error(`surf in ${root} is neither a global npm install nor a git checkout, so surf update changed nothing. Update it the way you installed it.`);
}

// Runs one step with its output on stderr, so stdout stays the update's own report.
function runStep(step) {
  return new Promise((resolve) => {
    const isWin = process.platform === "win32";
    const child = spawn(isWin ? `"${step.command}"` : step.command, step.args, {
      cwd: step.cwd,
      env: { ...process.env, ...step.env },
      stdio: ["ignore", 2, 2],
      shell: isWin,
    });
    child.on("error", (error) => {
      console.error(`surf update: ${error.message}`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}

// Sends one request to the native host and resolves with its first reply, or null when no host
// answers in time. With untilClose, an `ok` reply also waits for the host to close the connection.
function askHost(message, { socketPath = SOCKET_PATH, timeoutMs = 1000, untilClose = false } = {}) {
  return new Promise((resolve) => {
    const socket = net.createConnection(socketPath);
    let buffer = "";
    let reply = null;
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(reply);
    };
    let timer = setTimeout(finish, timeoutMs);
    socket.on("connect", () => socket.write(`${JSON.stringify(message)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const newline = buffer.indexOf("\n");
      if (reply || newline === -1) return;
      try {
        reply = JSON.parse(buffer.slice(0, newline));
      } catch {
        reply = {};
      }
      if (!(untilClose && reply.ok)) finish();
    });
    socket.on("error", finish);
    socket.on("close", finish);
  });
}

async function readVersions(socketPath, cli) {
  const reply = await askHost({ type: "versions_request" }, { socketPath });
  const answered = reply?.type === "versions_response";
  return { cli, host: answered ? reply.host : null, extension: answered ? reply.extension ?? null : null };
}

// Asks the running extension to reload itself from disk, which also restarts the native host,
// then waits for the new host to hear from the reloaded extension.
async function reloadExtension({ socketPath = SOCKET_PATH, waitMs = 20000 } = {}) {
  const reply = await askHost({ type: "reload_extension_request" }, { socketPath, timeoutMs: 10000, untilClose: true });
  if (!reply) {
    return { ok: false, message: "No Surf extension is connected, so nothing was reloaded; the browser loads the new version when it starts Surf." };
  }
  if (!reply.ok) {
    // A host or extension from before `surf update` does not know the reload request.
    return { ok: false, message: `The running Surf extension could not reload itself (${reply.error || "not supported"}). ${MANUAL_RELOAD}` };
  }
  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const versions = await askHost({ type: "versions_request" }, { socketPath });
    if (versions?.type === "versions_response" && versions.extension) {
      return { ok: true, versions: { host: versions.host, extension: versions.extension } };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {
    ok: false,
    message: `The Surf extension did not come back within ${waitMs / 1000}s of reloading. Check it in chrome://extensions: with Developer mode off, Chrome disables a reloaded unpacked extension.`,
  };
}

function formatVersions(label, versions) {
  return `${label} CLI ${versions.cli}, host ${versions.host ?? "not running"}, extension ${versions.extension ?? "not connected"}`;
}

async function runUpdateCli(rawArgs, { socketPath = SOCKET_PATH, packageRoot = PACKAGE_ROOT } = {}) {
  const unknown = rawArgs.filter((arg) => arg !== "--json");
  if (unknown.length > 0) {
    console.error(`Unknown update option: ${unknown[0]}`);
    return 1;
  }
  const json = rawArgs.includes("--json");
  const readCliVersion = () => JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")).version;
  const before = await readVersions(socketPath, readCliVersion());
  let plan;
  try {
    plan = planUpdate(packageRoot);
  } catch (error) {
    console.error(`surf update: ${error.message}`);
    return 1;
  }

  const steps = [];
  const installer = { command: process.execPath, args: [path.join(plan.root, "scripts/install-native-host.cjs"), "--refresh"], cwd: plan.root };
  for (const step of [...plan.steps, installer]) {
    const name = step === installer ? "refresh native host and skill links" : [path.basename(step.command), ...step.args].join(" ");
    console.error(`surf update: ${name}`);
    const code = await runStep(step);
    steps.push({ step: name, ok: code === 0, ...(code === 0 ? {} : { exitCode: code }) });
    if (code !== 0) {
      console.error(`surf update: ${name} failed with exit code ${code}`);
      if (json) console.log(JSON.stringify({ before, after: null, steps }, null, 2));
      return code;
    }
  }

  const reload = await reloadExtension({ socketPath });
  steps.push({ step: "reload extension", ok: reload.ok, ...(reload.message ? { message: reload.message } : {}) });
  if (reload.message) console.error(`surf update: ${reload.message}`);
  const after = reload.versions ? { cli: readCliVersion(), ...reload.versions } : await readVersions(socketPath, readCliVersion());

  if (json) {
    console.log(JSON.stringify({ before, after, steps }, null, 2));
  } else {
    console.log(formatVersions("Before:", before));
    console.log(formatVersions("After: ", after));
  }
  return 0;
}

module.exports = { planUpdate, reloadExtension, runUpdateCli };
