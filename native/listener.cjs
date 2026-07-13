const net = require("net");

function parseListenEndpoint(value) {
  const v6 = typeof value === "string" && value.match(/^\[([^\]]+)\]:(\d+)$/);
  const v4 = typeof value === "string" && value.match(/^([^:]+):(\d+)$/);
  const host = v6 ? v6[1] : v4?.[1];
  const port = Number(v6 ? v6[2] : v4?.[2]);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SURF_LISTEN must be a Tailnet IP and port 1..65535");
  if (v6) {
    if (net.isIP(host) !== 6) throw new Error("SURF_LISTEN must use a Tailscale IPv6 address");
    const canonical = new URL(`http://[${host}]`).hostname.slice(1, -1);
    if (!canonical.startsWith("fd7a:115c:a1e0:")) throw new Error("SURF_LISTEN must use a Tailscale IPv6 address");
    return { host: canonical, port, display: `[${canonical}]:${port}` };
  }
  const parts = host.split(".").map(Number);
  if (net.isIP(host) !== 4 || parts[0] !== 100 || parts[1] < 64 || parts[1] > 127) throw new Error("SURF_LISTEN must use a Tailscale IPv4 address");
  return { host, port, display: `${host}:${port}` };
}

module.exports = { parseListenEndpoint };
