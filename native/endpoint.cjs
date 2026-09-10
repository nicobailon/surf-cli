const net = require("net");
const fs = require("fs");
const tls = require("tls");
const { DEFAULT_SOCKET_PATH } = require("./socket-path.cjs");
const { authenticateClient } = require("./remote-transport.cjs");

const TLS_HANDSHAKE_TIMEOUT_MS = 5000;
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function parseRemoteEndpoint(value) {
  if (typeof value !== "string" || !value) throw new Error("--remote requires host:port");
  let host;
  let portText;
  if (value.startsWith("[")) {
    const match = value.match(/^\[([^\]]+)\]:(\d+)$/);
    if (!match || net.isIP(match?.[1]) !== 6) throw new Error("remote endpoint must use a bracketed IPv6 address and port");
    [, host, portText] = match;
    host = new URL(`http://[${host}]`).hostname.slice(1, -1);
  } else {
    const match = value.match(/^([^:]+):(\d+)$/);
    if (!match) throw new Error("remote endpoint must be host:port (IPv6 must be bracketed)");
    [, host, portText] = match;
    if (host.includes("/") || host.includes("@") || host.includes(":") || host === "*" || host.includes("*")) throw new Error("remote endpoint host is invalid");
    if ((/^\d+(?:\.\d+){3}$/.test(host) && net.isIP(host) !== 4) || (net.isIP(host) !== 4 && !HOSTNAME_PATTERN.test(host))) {
      throw new Error("remote endpoint host is invalid");
    }
    host = host.toLowerCase();
  }
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("remote endpoint port must be between 1 and 65535");
  if ((net.isIP(host) === 4 && host === "0.0.0.0") || (net.isIP(host) === 6 && /^0*:?0*$/.test(host.replace(/:/g, "")))) {
    throw new Error("remote endpoint host must not be unspecified");
  }
  const display = net.isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
  return { kind: "remote", host, port, display, key: `tcp:${display}`, connectionOptions: { host, port } };
}

function extractRemoteOptions(args) {
  const definitions = {
    "--remote": { name: "remote", missing: "--remote requires host:port" },
    "--remote-credential": { name: "credential", missing: "--remote-credential requires a file path" },
    "--remote-tls": { name: "tls", boolean: true },
    "--remote-tls-ca": { name: "tlsCa", missing: "--remote-tls-ca requires a file path" },
    "--remote-tls-server-name": { name: "tlsServerName", missing: "--remote-tls-server-name requires a DNS hostname" },
  };
  const values = {};
  const strippedArgs = [];
  for (let index = 0; index < args.length; index++) {
    const option = definitions[args[index]];
    if (!option) {
      strippedArgs.push(args[index]);
      continue;
    }
    if (Object.hasOwn(values, option.name)) throw new Error(`${args[index]} may only be specified once`);
    if (option.boolean) {
      values[option.name] = true;
      continue;
    }
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(option.missing);
    values[option.name] = value;
    index++;
  }
  return { values, strippedArgs };
}

function validateServerName(value, source) {
  if (!value || net.isIP(value) !== 0 || !HOSTNAME_PATTERN.test(value)) {
    throw new Error(`${source} must be a valid DNS hostname`);
  }
  return value.toLowerCase();
}

function loadTlsCa(caPath, source) {
  let ca;
  try {
    ca = fs.readFileSync(caPath);
  } catch (error) {
    throw new Error(`${source} could not read CA file ${caPath}: ${error.message}`);
  }
  if (ca.length === 0 || !ca.includes(Buffer.from("-----BEGIN CERTIFICATE-----"))) {
    throw new Error(`${source} CA file ${caPath} must contain a PEM certificate`);
  }
  return ca;
}

function selectEndpoint(args, env) {
  const selectedEnv = env === undefined ? process.env : env;
  const { values, strippedArgs } = extractRemoteOptions(args);
  const envTls = selectedEnv.SURF_REMOTE_TLS;
  if (envTls && envTls !== "1") {
    throw new Error('SURF_REMOTE_TLS must be "1" to enable TLS; unset it to disable');
  }
  const remoteValue = values.remote || selectedEnv.SURF_REMOTE;
  const credentialPath = values.credential || selectedEnv.SURF_REMOTE_CREDENTIAL;
  const tlsEnabled = values.tls === true || envTls === "1";
  const caPath = values.tlsCa || selectedEnv.SURF_REMOTE_TLS_CA;
  const serverNameValue = values.tlsServerName || selectedEnv.SURF_REMOTE_TLS_SERVER_NAME;
  if (!remoteValue) {
    if (values.credential) throw new Error("--remote-credential requires a remote endpoint");
    if (values.tls) throw new Error("--remote-tls requires a remote endpoint");
    if (selectedEnv.SURF_REMOTE_TLS === "1") throw new Error("SURF_REMOTE_TLS requires a remote endpoint");
    if (values.tlsCa) throw new Error("--remote-tls-ca requires a remote endpoint");
    if (selectedEnv.SURF_REMOTE_TLS_CA) throw new Error("SURF_REMOTE_TLS_CA requires a remote endpoint");
    if (values.tlsServerName) throw new Error("--remote-tls-server-name requires a remote endpoint");
    if (selectedEnv.SURF_REMOTE_TLS_SERVER_NAME) throw new Error("SURF_REMOTE_TLS_SERVER_NAME requires a remote endpoint");
    const socketPath = selectedEnv.SURF_SOCKET || DEFAULT_SOCKET_PATH;
    return { args: strippedArgs, endpoint: { kind: "local", path: socketPath, display: socketPath, key: `unix:${socketPath}`, connectionOptions: socketPath } };
  }
  if (!credentialPath) throw new Error("remote endpoint requires --remote-credential <path> or SURF_REMOTE_CREDENTIAL");
  if (caPath && !tlsEnabled) throw new Error(`${values.tlsCa ? "--remote-tls-ca" : "SURF_REMOTE_TLS_CA"} requires TLS to be enabled`);
  if (serverNameValue && !tlsEnabled) throw new Error(`${values.tlsServerName ? "--remote-tls-server-name" : "SURF_REMOTE_TLS_SERVER_NAME"} requires TLS to be enabled`);
  const endpoint = { ...parseRemoteEndpoint(remoteValue), credentialPath };
  if (tlsEnabled) {
    const tlsOptions = { enabled: true };
    if (caPath) {
      tlsOptions.ca = loadTlsCa(caPath, values.tlsCa ? "--remote-tls-ca" : "SURF_REMOTE_TLS_CA");
      tlsOptions.caPath = caPath;
    }
    const serverName = serverNameValue
      ? validateServerName(serverNameValue, values.tlsServerName ? "--remote-tls-server-name" : "SURF_REMOTE_TLS_SERVER_NAME")
      : net.isIP(endpoint.host) === 0 ? endpoint.host : undefined;
    if (serverName) tlsOptions.serverName = serverName;
    endpoint.tls = tlsOptions;
  }
  return { args: strippedArgs, endpoint };
}

function createRemoteSocket(endpoint) {
  const usingTls = endpoint.tls?.enabled === true;
  const rawSocket = usingTls
    ? tls.connect({
      ...endpoint.connectionOptions,
      rejectUnauthorized: true,
      ...(endpoint.tls.ca ? { ca: endpoint.tls.ca } : {}),
      ...(endpoint.tls.serverName ? { servername: endpoint.tls.serverName } : {}),
    })
    : net.createConnection(endpoint.connectionOptions, () => {});
  let ready = false;
  let connected = false;
  let destroyed = false;
  const pending = new Map();
  const queue = (event, listener, once) => {
    if (ready) {
      once ? rawSocket.once(event, listener) : rawSocket.on(event, listener);
      return;
    }
    const listeners = pending.get(event) || [];
    listeners.push({ listener, once });
    pending.set(event, listeners);
  };
  const flush = () => {
    ready = true;
    for (const [event, listeners] of pending) {
      for (const { listener, once } of listeners) {
        once ? rawSocket.once(event, listener) : rawSocket.on(event, listener);
      }
    }
    pending.clear();
  };
  const proxy = {
    on(event, listener) { queue(event, listener, false); return proxy; },
    once(event, listener) { queue(event, listener, true); return proxy; },
    removeListener(event, listener) {
      if (ready) rawSocket.removeListener(event, listener);
      else pending.set(event, (pending.get(event) || []).filter((entry) => entry.listener !== listener));
      return proxy;
    },
    write(...args) { return rawSocket.write(...args); },
    end(...args) { return rawSocket.end(...args); },
    destroy(...args) { destroyed = true; return rawSocket.destroy(...args); },
    setTimeout(...args) { rawSocket.setTimeout(...args); return proxy; },
    get authenticated() { return ready; },
    get connected() { return connected; },
  };
  const transportReadyEvent = usingTls ? "secureConnect" : "connect";
  rawSocket.once(transportReadyEvent, () => { connected = true; });
  let handshakeTimer;
  if (usingTls) {
    const timeoutMs = endpoint.tls.handshakeTimeoutMs ?? TLS_HANDSHAKE_TIMEOUT_MS;
    const clearHandshakeTimer = () => {
      if (handshakeTimer) clearTimeout(handshakeTimer);
      handshakeTimer = undefined;
    };
    handshakeTimer = setTimeout(() => {
      if (connected || rawSocket.destroyed) return;
      const error = new Error(`TLS handshake timed out after ${timeoutMs}ms`);
      error.code = "ETIMEDOUT";
      rawSocket.destroy(error);
    }, timeoutMs);
    rawSocket.once("secureConnect", clearHandshakeTimer);
    rawSocket.once("error", clearHandshakeTimer);
    rawSocket.once("close", clearHandshakeTimer);
  }
  rawSocket.on("error", (error) => {
    if (ready || destroyed) return;
    ready = true;
    const listeners = pending.get("error") || [];
    pending.delete("error");
    for (const { listener } of listeners) listener(error);
    if (proxy.__pendingErrors) proxy.__pendingErrors.length = 0;
    flush();
  });
  rawSocket.on("close", () => {
    if (ready) return;
    ready = true;
    const error = new Error("remote authentication connection closed");
    for (const { listener } of pending.get("error") || []) listener(error);
    for (const { listener } of pending.get("close") || []) listener();
    pending.clear();
    if (proxy.__pendingErrors) proxy.__pendingErrors.length = 0;
  });
  return { rawSocket, proxy, flush };
}

function connectEndpoint(endpoint, onConnect) {
  if (endpoint.kind === "local") {
    return net.createConnection(endpoint.connectionOptions, onConnect || (() => {}));
  }
  const { rawSocket, proxy, flush } = createRemoteSocket(endpoint);
  rawSocket.once(endpoint.tls?.enabled ? "secureConnect" : "connect", () => {
    authenticateClient(rawSocket, endpoint.credentialPath)
      .then(() => {
        flush();
        if (onConnect) onConnect(proxy);
      })
      .catch((error) => {
        error.code = error.code || "EAUTH";
        const listeners = proxy.__pendingErrors || [];
        for (const listener of listeners) {
          proxy.removeListener("error", listener);
          listener(error);
        }
        proxy.__pendingErrors.length = 0;
        flush();
        proxy.destroy();
      });
  });
  proxy.__pendingErrors = [];
  const originalOn = proxy.on;
  const originalOnce = proxy.once;
  proxy.on = (event, listener) => {
    if (event === "error" && !proxy.authenticated) proxy.__pendingErrors.push(listener);
    return originalOn(event, listener);
  };
  proxy.once = (event, listener) => {
    if (event === "error" && !proxy.authenticated) proxy.__pendingErrors.push(listener);
    return originalOnce(event, listener);
  };
  return proxy;
}

function formatEndpointError(error, endpoint, formatSocketError) {
  if (endpoint.kind === "local") return formatSocketError(error);
  const message = error?.message || String(error);
  return `Remote endpoint connection failed (${endpoint.display}${endpoint.tls?.enabled ? ", TLS" : ""}): ${message}`;
}

module.exports = { TLS_HANDSHAKE_TIMEOUT_MS, parseRemoteEndpoint, selectEndpoint, connectEndpoint, formatEndpointError };
