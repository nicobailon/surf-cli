const { savedOps } = require("./playbooks.cjs");

const SHOWN_OPS = 5;

/**
 * The saved ops a session hears of when its tab lands on a site: once per session and origin for
 * the life of the host. `pageUrl` is asked only when some op is saved.
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
    const ops = all.filter((op) => op.origins.includes(origin)).map(({ playbook, op, inputs }) => ({ playbook, op, inputs }));
    if (told.has(key) || ops.length === 0) return null;
    told.add(key);
    return { origin, ops };
  };
}

/** `saved: books list_books --page, get_book --book_id`: five ops, then where the rest are. */
function formatSavedOps({ ops }) {
  const groups = {};
  for (const { playbook, op, inputs } of ops.slice(0, SHOWN_OPS)) (groups[playbook] ??= []).push([op, ...inputs.map((input) => `--${input}`)].join(" "));
  const line = `saved: ${Object.entries(groups).map(([playbook, calls]) => `${playbook} ${calls.join(", ")}`).join("; ")}`;
  const rest = ops.slice(SHOWN_OPS);
  return rest.length ? `${line} +${rest.length} more: ${[...new Set(rest.map(({ playbook }) => `surf pb ops ${playbook}`))].join(", ")}` : line;
}

module.exports = { createSavedOpsNotice, formatSavedOps };
