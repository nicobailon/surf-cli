const net = require("net");
const { DEFAULT_SOCKET_PATH } = require("./socket-path.cjs");

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
  for (let i = 0; i < args.length; i++) if (args[i] === "--remote") remoteIndexes.push(i);
  if (remoteIndexes.length > 1) throw new Error("--remote may only be specified once");
  let cliRemote;
  const strippedArgs = [...args];
  if (remoteIndexes.length) {
    const index = remoteIndexes[0];
    cliRemote = args[index + 1];
    if (!cliRemote || cliRemote.startsWith("--")) throw new Error("--remote requires host:port");
    strippedArgs.splice(index, 2);
  }
  if (cliRemote || selectedEnv.SURF_REMOTE) return { args: strippedArgs, endpoint: parseRemoteEndpoint(cliRemote || selectedEnv.SURF_REMOTE) };
  const socketPath = selectedEnv.SURF_SOCKET || DEFAULT_SOCKET_PATH;
  return { args: strippedArgs, endpoint: { kind: "local", path: socketPath, display: socketPath, key: `unix:${socketPath}`, connectionOptions: socketPath } };
}

function connectEndpoint(endpoint, onConnect) {
  return net.createConnection(endpoint.connectionOptions, onConnect);
}

function formatEndpointError(error, endpoint, formatSocketError) {
  if (endpoint.kind === "local") return formatSocketError(error);
  const message = error?.message || String(error);
  return `Remote endpoint connection failed (${endpoint.display}): ${message}`;
}

module.exports = { parseRemoteEndpoint, selectEndpoint, connectEndpoint, formatEndpointError };
