// Line diff for showing an edited file: changed lines with up to `context` unchanged lines around
// them, and `@@` between hunks. Files here are small JSON ops, so a plain LCS table is fine.

function lineDiff(before, after, context = 3) {
  const a = before.split("\n");
  const b = after.split("\n");
  const lcs = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const lines = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push({ mark: " ", text: a[i++] });
      j++;
    } else if (j < b.length && (i === a.length || lcs[i][j + 1] >= lcs[i + 1][j])) lines.push({ mark: "+", text: b[j++] });
    else lines.push({ mark: "-", text: a[i++] });
  }
  const changed = lines.map((line, index) => (line.mark === " " ? -1 : index)).filter((index) => index >= 0);
  if (changed.length === 0) return "";
  const shown = new Set(changed.flatMap((index) => Array.from({ length: context * 2 + 1 }, (_, offset) => index - context + offset)));
  const out = [];
  let last = -1;
  lines.forEach((line, index) => {
    if (!shown.has(index)) return;
    if (last >= 0 && index > last + 1) out.push("@@");
    out.push(`${line.mark}${line.text}`.trimEnd());
    last = index;
  });
  return out.join("\n");
}

module.exports = { lineDiff };
