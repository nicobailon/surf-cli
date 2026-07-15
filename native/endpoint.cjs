const net = require("net");
const { DEFAULT_SOCKET_PATH } = require("./socket-path.cjs");
const { authenticateClient } = require("./remote-transport.cjs");

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
    if ((/^\d+(?:\.\d+){3}$/.test(host) && net.isIP(host) !== 4) || (net.isIP(host) !== 4 && !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)*[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(host))) {
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

function selectEndpoint(args, env) {
  const selectedEnv = env === undefined ? process.env : env;
  const remoteIndexes = [];
  const credentialIndexes = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--remote") remoteIndexes.push(i);
    if (args[i] === "--remote-credential") credentialIndexes.push(i);
  }
  if (remoteIndexes.length > 1) throw new Error("--remote may only be specified once");
  if (credentialIndexes.length > 1) throw new Error("--remote-credential may only be specified once");
  let cliRemote;
  let cliCredential;
  const strippedArgs = [...args];
  if (remoteIndexes.length) {
    const index = remoteIndexes[0];
    cliRemote = args[index + 1];
    if (!cliRemote || cliRemote.startsWith("--")) throw new Error("--remote requires host:port");
    strippedArgs.splice(index, 2);
  }
  if (credentialIndexes.length) {
    const index = credentialIndexes[0];
    cliCredential = args[index + 1];
    if (!cliCredential || cliCredential.startsWith("--")) throw new Error("--remote-credential requires a file path");
    const adjustedIndex = index - (remoteIndexes.length && index > remoteIndexes[0] ? 2 : 0);
    strippedArgs.splice(adjustedIndex, 2);
  }
  const remoteValue = cliRemote || selectedEnv.SURF_REMOTE;
  if (remoteValue) {
    const credentialPath = cliCredential || selectedEnv.SURF_REMOTE_CREDENTIAL;
    if (!credentialPath) throw new Error("remote endpoint requires --remote-credential <path> or SURF_REMOTE_CREDENTIAL");
    return { args: strippedArgs, endpoint: { ...parseRemoteEndpoint(remoteValue), credentialPath } };
  }
  if (cliCredential) throw new Error("--remote-credential requires a remote endpoint");
  const socketPath = selectedEnv.SURF_SOCKET || DEFAULT_SOCKET_PATH;
  return { args: strippedArgs, endpoint: { kind: "local", path: socketPath, display: socketPath, key: `unix:${socketPath}`, connectionOptions: socketPath } };
}

function createRemoteSocket(endpoint) {
  const rawSocket = net.createConnection(endpoint.connectionOptions, () => {});
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
  rawSocket.once("connect", () => { connected = true; });
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
  rawSocket.once("connect", () => {
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
  return `Remote endpoint connection failed (${endpoint.display}): ${message}`;
}

module.exports = { parseRemoteEndpoint, selectEndpoint, connectEndpoint, formatEndpointError };
