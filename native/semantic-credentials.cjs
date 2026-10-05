const crypto = require("crypto");
const os = require("os");
const path = require("path");
const {
  atomicWriteJson,
  readPrivateFile,
  removePrivateFile,
} = require("./private-state.cjs");

const CREDENTIAL_VERSION = 1;
const MAX_API_KEY_BYTES = 16 * 1024;
const FINGERPRINT_LENGTH = 12;
const TTY_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];
const CLOUDFLARE_ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/;
const CLOUDFLARE_INPUT_MAX_BYTES = 32 + MAX_API_KEY_BYTES + 4;

function configLocation(env, { platform, homeDir }) {
  const windows = platform === "win32";
  const pathApi = windows ? path.win32 : path;
  const configRoot = windows
    ? (typeof env.APPDATA === "string" && env.APPDATA.trim() ? env.APPDATA.trim() : pathApi.join(homeDir, "AppData", "Roaming"))
    : (typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim() ? env.XDG_CONFIG_HOME.trim() : pathApi.join(homeDir, ".config"));
  return { windows, pathApi, configRoot };
}

function credentialLocation(env = process.env, { platform = process.platform, homeDir = os.homedir() } = {}) {
  const { windows, pathApi, configRoot } = configLocation(env, { platform, homeDir });
  const root = pathApi.join(configRoot, windows ? "TypeSafe" : "typesafe");
  return {
    root,
    filePath: pathApi.join(root, "credentials.json"),
  };
}

function cloudflareCredentialLocation(env = process.env, { platform = process.platform, homeDir = os.homedir() } = {}) {
  const { pathApi, configRoot } = configLocation(env, { platform, homeDir });
  const root = pathApi.join(configRoot, "surf");
  return {
    root,
    filePath: pathApi.join(root, "cloudflare-credentials.json"),
  };
}

function requireSecret(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must not be blank`);
  }
  if (Buffer.byteLength(value, "utf8") > MAX_API_KEY_BYTES) {
    throw new Error(`${label} exceeds ${MAX_API_KEY_BYTES} bytes`);
  }
  return value;
}

function requireApiKey(value) {
  return requireSecret(value, "TypeSafe API key");
}

function requireCloudflareApiToken(value) {
  return requireSecret(value, "Cloudflare API token");
}

function requireCloudflareAccountId(value) {
  if (typeof value !== "string" || !CLOUDFLARE_ACCOUNT_ID_PATTERN.test(value)) {
    throw new Error("Cloudflare account id must be 32 lowercase hexadecimal characters");
  }
  return value;
}

function fingerprintApiKey(apiKey) {
  const digest = crypto.createHash("sha256").update(apiKey, "utf8").digest("hex");
  return `sha256:${digest.slice(0, FINGERPRINT_LENGTH)}`;
}

function isNonblank(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && value.version === CREDENTIAL_VERSION;
}

// Parse errors would echo file contents, so any malformed record gets one fixed message.
function readStoredRecord({ root, filePath }, provider) {
  const content = readPrivateFile(filePath, { root, allowMissing: true, fallback: null, encoding: "utf8" });
  if (content === null) return null;
  const invalid = new Error(`stored ${provider} credential is invalid`);
  let value;
  try { value = JSON.parse(content); } catch { throw invalid; }
  if (!isRecord(value)) throw invalid;
  return value;
}

function readStoredApiKey(env = process.env) {
  const value = readStoredRecord(credentialLocation(env), "TypeSafe");
  if (value === null) return null;
  try {
    return requireApiKey(value.apiKey);
  } catch {
    throw new Error("stored TypeSafe credential is invalid");
  }
}

function resolveTypeSafeCredential(env = process.env) {
  if (isNonblank(env.TYPESAFE_API_KEY)) {
    const apiKey = requireApiKey(env.TYPESAFE_API_KEY);
    return { apiKey, source: "environment", fingerprint: fingerprintApiKey(apiKey) };
  }
  const apiKey = readStoredApiKey(env);
  if (apiKey === null) return null;
  return { apiKey, source: "shared-store", fingerprint: fingerprintApiKey(apiKey) };
}

function readStoredCloudflareCredential(env) {
  const value = readStoredRecord(cloudflareCredentialLocation(env), "Cloudflare");
  if (value === null) return null;
  try {
    return {
      accountId: requireCloudflareAccountId(value.accountId),
      apiToken: requireCloudflareApiToken(value.apiToken),
    };
  } catch {
    throw new Error("stored Cloudflare credential is invalid");
  }
}

function resolveCloudflareCredential(env = process.env) {
  const hasAccountId = isNonblank(env.CLOUDFLARE_ACCOUNT_ID);
  const hasApiToken = isNonblank(env.CLOUDFLARE_API_TOKEN);
  if (hasAccountId !== hasApiToken) {
    const missing = hasAccountId ? "CLOUDFLARE_API_TOKEN" : "CLOUDFLARE_ACCOUNT_ID";
    throw new Error(`${missing} is not set; set both CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN, or neither to use the stored credential`);
  }
  if (hasAccountId) {
    const accountId = requireCloudflareAccountId(env.CLOUDFLARE_ACCOUNT_ID);
    const apiToken = requireCloudflareApiToken(env.CLOUDFLARE_API_TOKEN);
    return { accountId, apiToken, source: "environment", fingerprint: fingerprintApiKey(apiToken) };
  }
  const stored = readStoredCloudflareCredential(env);
  if (stored === null) return null;
  return { ...stored, source: "stored", fingerprint: fingerprintApiKey(stored.apiToken) };
}

const CREDENTIAL_RESOLVERS = {
  typesafe: resolveTypeSafeCredential,
  cloudflare: resolveCloudflareCredential,
};

function credentialStatus(env = process.env, provider = "all") {
  const providers = provider === "all" ? Object.keys(CREDENTIAL_RESOLVERS) : [provider];
  return Object.fromEntries(providers.map((name) => {
    const credential = CREDENTIAL_RESOLVERS[name](env);
    return [name, credential ? { source: credential.source, fingerprint: credential.fingerprint } : { source: "not-configured" }];
  }));
}

function storeTypeSafeCredential(apiKey, env = process.env) {
  const validated = requireApiKey(apiKey);
  const { root, filePath } = credentialLocation(env);
  atomicWriteJson(filePath, { version: CREDENTIAL_VERSION, apiKey: validated }, { root });
  return { source: "shared-store", fingerprint: fingerprintApiKey(validated) };
}

function clearStoredTypeSafeCredential(env = process.env) {
  const { root, filePath } = credentialLocation(env);
  return removePrivateFile(filePath, { root });
}

function clearStoredCloudflareCredential(env = process.env) {
  const { root, filePath } = cloudflareCredentialLocation(env);
  return removePrivateFile(filePath, { root });
}

function readNonInteractiveLines(input, { label, maxBytes, lineCount, lineError }) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    const cleanup = () => {
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const onData = (chunk) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      if (bytes > maxBytes) {
        input.pause?.();
        fail(new Error(`${label} input exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      cleanup();
      let value = Buffer.concat(chunks).toString("utf8");
      if (value.endsWith("\n")) value = value.slice(0, -1);
      if (value.endsWith("\r")) value = value.slice(0, -1);
      const lines = value.split(/\r?\n/);
      if (lines.length !== lineCount || lines.some((line) => line.includes("\r"))) {
        reject(new Error(lineError));
        return;
      }
      resolve(lines);
    };
    const onError = (error) => fail(error);
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onError);
    input.resume?.();
  });
}

function readTtyLine(input, output, signalSource, { label, prompt, echo }) {
  return new Promise((resolve, reject) => {
    let value = "";
    let settled = false;
    const previousRaw = input.isRaw === true;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      input.off("data", onData);
      input.off("error", onError);
      for (const signal of TTY_SIGNALS) signalSource.off(signal, signalHandlers[signal]);
      try { input.setRawMode(previousRaw); } catch {}
      input.pause?.();
      output.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const signalHandlers = Object.fromEntries(
      TTY_SIGNALS.map((signal) => [signal, () => finish(new Error(`${label} input interrupted by ${signal}`))]),
    );
    const onError = (error) => finish(error);
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") return finish(new Error(`${label} input cancelled`));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") {
          if (echo && value) output.write("\b \b");
          value = value.slice(0, -1);
        } else {
          value += character;
          if (echo) output.write(character);
        }
        if (Buffer.byteLength(value, "utf8") > MAX_API_KEY_BYTES) {
          return finish(new Error(`${label} input exceeds ${MAX_API_KEY_BYTES} bytes`));
        }
      }
    };
    output.write(prompt);
    input.setRawMode(true);
    input.on("data", onData);
    input.once("error", onError);
    for (const signal of TTY_SIGNALS) signalSource.once(signal, signalHandlers[signal]);
    input.resume?.();
  });
}

async function readTypeSafeApiKey(options = {}) {
  const { input = process.stdin, output = process.stderr, signalSource = process } = options;
  if (input.isTTY) {
    if (typeof input.setRawMode !== "function") {
      throw new Error("hidden TypeSafe API key input is unavailable on this terminal");
    }
    const label = "TypeSafe API key";
    return requireApiKey(await readTtyLine(input, output, signalSource, { label, prompt: `${label}: `, echo: false }));
  }
  const [apiKey] = await readNonInteractiveLines(input, {
    label: "TypeSafe API key",
    maxBytes: MAX_API_KEY_BYTES + 2,
    lineCount: 1,
    lineError: "TypeSafe API key input must be one line",
  });
  return requireApiKey(apiKey);
}

async function setTypeSafeCredentialFromInput(options = {}) {
  const apiKey = await readTypeSafeApiKey(options);
  return storeTypeSafeCredential(apiKey, options.env || process.env);
}

async function readCloudflareCredential(options = {}) {
  const { input = process.stdin, output = process.stderr, signalSource = process } = options;
  if (input.isTTY) {
    if (typeof input.setRawMode !== "function") {
      throw new Error("hidden Cloudflare API token input is unavailable on this terminal");
    }
    const accountId = requireCloudflareAccountId(await readTtyLine(input, output, signalSource, {
      label: "Cloudflare account id",
      prompt: "Cloudflare account id: ",
      echo: true,
    }));
    const apiToken = requireCloudflareApiToken(await readTtyLine(input, output, signalSource, {
      label: "Cloudflare API token",
      prompt: "Cloudflare API token: ",
      echo: false,
    }));
    return { accountId, apiToken };
  }
  const [accountId, apiToken] = await readNonInteractiveLines(input, {
    label: "Cloudflare credential",
    maxBytes: CLOUDFLARE_INPUT_MAX_BYTES,
    lineCount: 2,
    lineError: "Cloudflare credential input must be two lines: account id, then API token",
  });
  return { accountId: requireCloudflareAccountId(accountId), apiToken: requireCloudflareApiToken(apiToken) };
}

async function setCloudflareCredentialFromInput(options = {}) {
  const { accountId, apiToken } = await readCloudflareCredential(options);
  const { root, filePath } = cloudflareCredentialLocation(options.env || process.env);
  atomicWriteJson(filePath, { version: CREDENTIAL_VERSION, accountId, apiToken }, { root });
  return { source: "stored", fingerprint: fingerprintApiKey(apiToken) };
}

module.exports = {
  MAX_API_KEY_BYTES,
  clearStoredCloudflareCredential,
  clearStoredTypeSafeCredential,
  cloudflareCredentialLocation,
  credentialLocation,
  credentialStatus,
  fingerprintApiKey,
  readStoredApiKey,
  readTypeSafeApiKey,
  resolveCloudflareCredential,
  resolveTypeSafeCredential,
  setCloudflareCredentialFromInput,
  setTypeSafeCredentialFromInput,
  storeTypeSafeCredential,
};
