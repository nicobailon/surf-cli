const crypto = require("crypto");
const os = require("os");
const path = require("path");
const {
  atomicWriteJson,
  readPrivateJson,
  removePrivateFile,
} = require("./private-state.cjs");

const CREDENTIAL_VERSION = 1;
const MAX_API_KEY_BYTES = 16 * 1024;
const FINGERPRINT_LENGTH = 12;
const TTY_SIGNALS = ["SIGINT", "SIGTERM", "SIGHUP"];

function credentialLocation(env = process.env, { platform = process.platform, homeDir = os.homedir() } = {}) {
  const windows = platform === "win32";
  const pathApi = windows ? path.win32 : path;
  const configRoot = windows
    ? (typeof env.APPDATA === "string" && env.APPDATA.trim() ? env.APPDATA.trim() : pathApi.join(homeDir, "AppData", "Roaming"))
    : (typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim() ? env.XDG_CONFIG_HOME.trim() : pathApi.join(homeDir, ".config"));
  const root = pathApi.join(configRoot, windows ? "TypeSafe" : "typesafe");
  return {
    root,
    filePath: pathApi.join(root, "credentials.json"),
  };
}

function requireApiKey(value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("TypeSafe API key must not be blank");
  }
  if (Buffer.byteLength(value, "utf8") > MAX_API_KEY_BYTES) {
    throw new Error(`TypeSafe API key exceeds ${MAX_API_KEY_BYTES} bytes`);
  }
  return value;
}

function fingerprintApiKey(apiKey) {
  const digest = crypto.createHash("sha256").update(apiKey, "utf8").digest("hex");
  return `sha256:${digest.slice(0, FINGERPRINT_LENGTH)}`;
}

function readStoredApiKey(env = process.env) {
  const { root, filePath } = credentialLocation(env);
  const value = readPrivateJson(filePath, null, { root });
  if (value === null) return null;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    value.version !== CREDENTIAL_VERSION ||
    typeof value.apiKey !== "string"
  ) {
    throw new Error("stored TypeSafe credential is invalid");
  }
  try {
    return requireApiKey(value.apiKey);
  } catch {
    throw new Error("stored TypeSafe credential is invalid");
  }
}

function resolveTypeSafeCredential(env = process.env) {
  if (typeof env.TYPESAFE_API_KEY === "string" && env.TYPESAFE_API_KEY.trim().length > 0) {
    const apiKey = requireApiKey(env.TYPESAFE_API_KEY);
    return { apiKey, source: "environment", fingerprint: fingerprintApiKey(apiKey) };
  }
  const apiKey = readStoredApiKey(env);
  if (apiKey === null) return null;
  return { apiKey, source: "shared-store", fingerprint: fingerprintApiKey(apiKey) };
}

function credentialStatus(env = process.env) {
  const credential = resolveTypeSafeCredential(env);
  if (!credential) return { source: "not-configured" };
  return { source: credential.source, fingerprint: credential.fingerprint };
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

function readNonInteractiveLine(input, maxBytes) {
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
      if (bytes > maxBytes + 2) {
        input.pause?.();
        fail(new Error(`TypeSafe API key input exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(buffer);
    };
    const onEnd = () => {
      cleanup();
      let value = Buffer.concat(chunks).toString("utf8");
      if (value.endsWith("\n")) value = value.slice(0, -1);
      if (value.endsWith("\r")) value = value.slice(0, -1);
      if (value.includes("\n") || value.includes("\r")) {
        reject(new Error("TypeSafe API key input must be one line"));
        return;
      }
      try {
        resolve(requireApiKey(value));
      } catch (error) {
        reject(error);
      }
    };
    const onError = (error) => fail(error);
    input.on("data", onData);
    input.once("end", onEnd);
    input.once("error", onError);
    input.resume?.();
  });
}

function readHiddenTtyLine(input, output, maxBytes, signalSource = process) {
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
      else {
        try { resolve(requireApiKey(value)); } catch (validationError) { reject(validationError); }
      }
    };
    const signalHandlers = Object.fromEntries(
      TTY_SIGNALS.map((signal) => [signal, () => finish(new Error(`TypeSafe API key input interrupted by ${signal}`))]),
    );
    const onError = (error) => finish(error);
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") return finish(new Error("TypeSafe API key input cancelled"));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
        if (Buffer.byteLength(value, "utf8") > maxBytes) {
          return finish(new Error(`TypeSafe API key input exceeds ${maxBytes} bytes`));
        }
      }
    };
    output.write("TypeSafe API key: ");
    input.setRawMode(true);
    input.on("data", onData);
    input.once("error", onError);
    for (const signal of TTY_SIGNALS) signalSource.once(signal, signalHandlers[signal]);
    input.resume?.();
  });
}

function readTypeSafeApiKey(options = {}) {
  const { input = process.stdin, output = process.stderr, signalSource = process } = options;
  if (input.isTTY) {
    if (typeof input.setRawMode !== "function") {
      return Promise.reject(new Error("hidden TypeSafe API key input is unavailable on this terminal"));
    }
    return readHiddenTtyLine(input, output, MAX_API_KEY_BYTES, signalSource);
  }
  return readNonInteractiveLine(input, MAX_API_KEY_BYTES);
}

async function setTypeSafeCredentialFromInput(options = {}) {
  const apiKey = await readTypeSafeApiKey(options);
  return storeTypeSafeCredential(apiKey, options.env || process.env);
}

module.exports = {
  MAX_API_KEY_BYTES,
  clearStoredTypeSafeCredential,
  credentialLocation,
  credentialStatus,
  fingerprintApiKey,
  readStoredApiKey,
  readTypeSafeApiKey,
  resolveTypeSafeCredential,
  setTypeSafeCredentialFromInput,
  storeTypeSafeCredential,
};
