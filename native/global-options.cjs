// Options every surf command takes. `surf --help-full` lists them, and `surf use` keeps them out of
// an op's inputs unless the op declares one of these names.
const GLOBAL_OPTIONS = [
  { name: "remote", value: "<host>:<port>", desc: "Route requests to a remote native host" },
  { name: "remote-credential", value: "<path>", desc: "Use a mode-0600 Ed25519 remote credential file" },
  { name: "remote-tls", desc: "Use TLS through a TLS-terminating reverse proxy" },
  { name: "remote-tls-ca", value: "<path>", desc: "Replace system roots with a custom CA bundle" },
  { name: "remote-tls-server-name", value: "<name>", desc: "Override TLS SNI and certificate identity" },
  { name: "session", value: "<name>", desc: "Target a durable named session (or set SURF_SESSION)" },
  { name: "tab-id", value: "<id>", desc: "Target specific tab" },
  { name: "window-id", value: "<id>", desc: "Target specific window" },
  { name: "no-wait", desc: "Return immediately when the tab/browser is busy" },
  { name: "json", desc: "Output raw JSON including target metadata" },
  { name: "auto-capture", desc: "On error: capture screenshot + console to /tmp" },
  { name: "soft-fail", desc: "Host tool errors: warn on stderr, exit 0, no JSON error output" },
  { name: "no-lock", desc: "Bypass the legacy lock for compound client-side commands" },
  { name: "settle", value: "<ms>", desc: "Max wait for the page to settle after actions (default 2000, max 30000, surf.json settleMs)" },
  { name: "no-diff", desc: "Skip reporting page changes after actions" },
];

function formatGlobalOptions() {
  const flags = GLOBAL_OPTIONS.map(({ name, value }) => `--${name}${value ? ` ${value}` : ""}`);
  const width = Math.max(...flags.map((flag) => flag.length)) + 2;
  return GLOBAL_OPTIONS.map(({ desc }, index) => `  ${flags[index].padEnd(width)}${desc}`).join("\n");
}

module.exports = { GLOBAL_OPTIONS, formatGlobalOptions };
