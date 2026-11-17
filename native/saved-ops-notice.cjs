const { savedOps } = require("./playbooks.cjs");

const SHOWN_OPS = 5;

/**
 * The saved ops a session hears of when its tab lands on a site: the first time, for the life of
 * the host, that it lands on each origin some op runs on. `pageUrl` is asked only when an op is saved.
 */
function createSavedOpsNotice({ find = savedOps } = {}) {
  const told = new Set();
  return async function notice({ session, cwd, pageUrl }) {
    const all = find({ cwd });
    if (all.length === 0) return null;
    let origin;
    try {
      origin = new URL(await pageUrl()).origin;
    } catch {
      return null;
    }
    const key = JSON.stringify([session || "", origin]);
    if (told.has(key)) return null;
    const ops = all
      .filter((op) => op.origins.includes(origin))
      .map(({ playbook, op, inputs }) => ({ playbook, op, inputs }));
    if (ops.length === 0) return null;
    told.add(key);
    return { origin, ops };
  };
}

/** `saved: books list_books --page, get_book --book`: the first five ops, then where the rest are. */
function formatSavedOps({ ops }) {
  const groups = [];
  for (const { playbook, op, inputs } of ops.slice(0, SHOWN_OPS)) {
    const call = [op, ...inputs.map((input) => `--${input}`)].join(" ");
    const last = groups.at(-1);
    if (last?.playbook === playbook) last.calls.push(call);
    else groups.push({ playbook, calls: [call] });
  }
  const line = `saved: ${groups.map(({ playbook, calls }) => `${playbook} ${calls.join(", ")}`).join("; ")}`;
  const rest = ops.slice(SHOWN_OPS);
  if (rest.length === 0) return line;
  const where = [...new Set(rest.map(({ playbook }) => `surf pb ops ${playbook}`))].join(", ");
  return `${line} +${rest.length} more: ${where}`;
}

module.exports = { createSavedOpsNotice, formatSavedOps };
