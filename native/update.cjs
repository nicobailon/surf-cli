const fs = require("fs");
const net = require("net");
const path = require("path");
const childProcess = require("child_process");
const { SOCKET_PATH } = require("./socket-path.cjs");

const PACKAGE_ROOT = path.resolve(__dirname, "..");
const MANUAL_RELOAD = "Reload Surf once in chrome://extensions; later `surf update` runs reload it for you.";

// How this surf is installed, from the real path of its package. A global npm install lives in
// <prefix>/lib/node_modules/surf-cli (<prefix>\node_modules\surf-cli on Windows) and is updated
// with the npm of that prefix, not whichever npm is first on PATH. A prefix without its own npm
// (the default %APPDATA%\npm on Windows, or a prefix such as ~/.npm-global) uses the npm next to
// the running node, once the prefix's `surf` command shows the install is global. A linked repo
// checkout resolves to the repo itself, which has a .git, and is rebuilt in place.
function planUpdate(packageRoot = PACKAGE_ROOT, platform = process.platform, nodePath = process.execPath) {
  const root = fs.realpathSync(packageRoot);
  const isWin = platform === "win32";
  const npmName = isWin ? "npm.cmd" : "npm";
  const modules = path.dirname(root);
  const globalLayout = path.basename(root) === "surf-cli" && path.basename(modules) === "node_modules" &&
    (isWin || path.basename(path.dirname(modules)) === "lib");
  if (globalLayout) {
    const prefix = isWin ? path.dirname(modules) : path.dirname(path.dirname(modules));
    const binDir = isWin ? prefix : path.join(prefix, "bin");
    const besideNode = path.join(path.dirname(nodePath), npmName);
    const npm = fs.existsSync(path.join(binDir, npmName))
      ? path.join(binDir, npmName)
      : fs.existsSync(path.join(binDir, isWin ? "surf.cmd" : "surf")) && fs.existsSync(besideNode) ? besideNode : null;
    if (npm) {
      // npm_config_prefix keeps the install in this prefix even if npm's shebang finds another node.
      return {
        root,
        steps: [{ command: npm, args: ["install", "-g", "surf-cli@latest"], cwd: prefix, env: { npm_config_prefix: prefix } }],
      };
    }
  }
  if (fs.existsSync(path.join(root, ".git"))) {
    return {
      root,
      steps: [
        { command: npmName, args: ["ci"], cwd: root },
        { command: npmName, args: ["run", "build"], cwd: root },
      ],
    };
  }
  throw new Error(`surf in ${root} is neither a global npm install nor a git checkout, so surf update changed nothing. Update it with the package manager that installed it.`);
}

// Runs one step with its output on stderr, so stdout stays the update's own report. Windows
// runs a .cmd only through the shell, so then the command and every argument are quoted.
function runStep(step, { spawn = childProcess.spawn, platform = process.platform } = {}) {
  return new Promise((resolve) => {
    const options = { cwd: step.cwd, env: { ...process.env, ...step.env }, stdio: ["ignore", 2, 2] };
    const child = platform === "win32" && /\.cmd$/i.test(step.command)
      ? spawn([step.command, ...step.args].map((part) => `"${part}"`).join(" "), { ...options, shell: true })
      : spawn(step.command, step.args, options);
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
    const timer = setTimeout(finish, timeoutMs);
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
    // How a host or extension from before `surf update` refuses the reload request.
    if (/Unsupported request type|explicit tab binding|Unknown message type/.test(reply.error || "")) {
      return { ok: false, message: `The running Surf extension is older than \`surf update\`, so it can't reload itself. ${MANUAL_RELOAD}` };
    }
    return { ok: false, message: `The running Surf extension could not reload itself: ${reply.error || "no reason given"}. ${MANUAL_RELOAD}` };
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

  console.error("surf update: reloading the extension restarts Surf for every session, so commands running in other sessions fail");
  const reload = await reloadExtension({ socketPath });
  steps.push({ step: "reload extension", ok: reload.ok, message: reload.message });
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

module.exports = { planUpdate, reloadExtension, runStep, runUpdateCli };
