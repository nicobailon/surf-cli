const fs = require("fs");

const MAX_LOG_BYTES = 10 * 1024 * 1024;

// Past maxBytes the log moves to `<file>.1`, replacing the older copy. Its size is
// read at the first write and again after every checkEveryBytes written, so other
// hosts appending to the same file count too.
function createHostLog({ file, maxBytes = MAX_LOG_BYTES, checkEveryBytes = maxBytes / 10 }) {
  let unchecked = Infinity;
  return (line) => {
    try {
      if (unchecked >= checkEveryBytes) {
        unchecked = 0;
        let size = 0;
        try { size = fs.statSync(file).size; } catch {}
        if (size >= maxBytes) fs.renameSync(file, `${file}.1`);
      }
      fs.appendFileSync(file, line);
      unchecked += Buffer.byteLength(line);
    } catch {}
  };
}

module.exports = { MAX_LOG_BYTES, createHostLog };
