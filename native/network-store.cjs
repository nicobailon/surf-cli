/**
 * Network Storage Module for surf-cli
 * 
 * Handles persistent storage of network requests with:
 * - JSONL append-only log
 * - Content-hash dedup for body storage
 * - Auto-cleanup with TTL and size limits
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline");
const {
  appendPrivateJsonLine,
  assertNotSymlink,
  atomicWriteFile,
  atomicWriteJson,
  ensurePrivateDir,
  privateStatePath,
} = require("./private-state.cjs");

// Configuration
const DEFAULT_BASE = privateStatePath("network");
const DEFAULT_TTL = 24 * 60 * 60 * 1000;  // 24 hours
const DEFAULT_MAX_SIZE = 200 * 1024 * 1024; // 200MB
const AUTO_CLEANUP_INTERVAL = 60 * 60 * 1000; // 1 hour

// Lock file for concurrent access
let writeLock = Promise.resolve();

/**
 * Get base path for network storage
 * Priority: SURF_NETWORK_PATH env var > default
 */
function getBasePath(basePath) {
  return basePath || process.env.SURF_NETWORK_PATH || DEFAULT_BASE;
}

/**
 * Get path to requests.jsonl
 */
function getRequestsPath(basePath) {
  return path.join(getBasePath(basePath), "requests.jsonl");
}

/**
 * Get path to bodies directory
 */
function getBodiesPath(basePath) {
  return path.join(getBasePath(basePath), "bodies");
}

/**
 * Get path to .meta file
 */
function getMetaPath() {
  return path.join(getBasePath(), ".meta");
}

/**
 * Ensure all required directories exist
 */
function ensureDirectories(basePath) {
  const base = getBasePath(basePath);
  const bodies = getBodiesPath(basePath);
  ensurePrivateDir(base, base);
  ensurePrivateDir(bodies, base);
}

/**
 * Read meta file
 */
function readMeta() {
  const metaPath = getMetaPath();
  try {
    if (fs.existsSync(metaPath)) {
      assertNotSymlink(metaPath, false);
      return JSON.parse(fs.readFileSync(metaPath, "utf-8"));
    }
  } catch (err) {
    // Ignore errors, return default
  }
  return { lastCleanup: 0 };
}

/**
 * Write meta file
 */
function writeMeta(meta) {
  const metaPath = getMetaPath();
  ensureDirectories();
  atomicWriteJson(metaPath, meta, { root: getBasePath() });
}

/**
 * Generate unique ID for entries
 */
function generateId() {
  return `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

/**
 * Store body content with content-hash dedup
 * @param {Buffer|string} content - Body content
 * @param {boolean} isRequest - Whether this is request body (vs response)
 * @returns {string} Hash reference
 */
function storeBody(content, isRequest = false) {
  ensureDirectories();
  
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content);
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
  const ext = isRequest ? "req" : "res";
  const bodyPath = path.join(getBodiesPath(), `${hash}.${ext}`);
  
  // Only write if doesn't exist (dedup)
  if (!fs.existsSync(bodyPath)) {
    atomicWriteFile(bodyPath, buffer, { root: getBasePath() });
  }
  
  return hash;
}

/**
 * Read body by hash
 * @param {string} hash - Body hash
 * @param {boolean} isRequest - Whether this is request body
 * @returns {Buffer|null} Body content or null if not found
 */
function readBody(hash, isRequest = false) {
  const ext = isRequest ? "req" : "res";
  const bodyPath = path.join(getBodiesPath(), `${hash}.${ext}`);
  
  try {
    if (fs.existsSync(bodyPath)) {
      assertNotSymlink(bodyPath, false);
      return fs.readFileSync(bodyPath);
    }
  } catch (err) {
    // Ignore errors
  }
  return null;
}

/**
 * Get file path for body (for external tools)
 * @param {string} hash - Body hash
 * @param {boolean} isRequest - Whether this is request body
 * @returns {string} Absolute path to body file
 */
function getBodyPath(hash, isRequest = false) {
  const ext = isRequest ? "req" : "res";
  return path.join(getBodiesPath(), `${hash}.${ext}`);
}

/**
 * Append a network entry (thread-safe with file locking)
 * @param {Object} entry - Network entry to append
 * @returns {Promise<Object>} The entry with assigned ID
 */
async function appendEntry(entry) {
  ensureDirectories();
  
  // Serialize writes
  const releasePromise = writeLock;
  let release;
  writeLock = new Promise(r => { release = r; });
  
  await releasePromise;
  
  try {
    const id = entry.id || generateId();
    const timestamp = entry.timestamp || Date.now();
    
    const fullEntry = {
      id,
      timestamp,
      ...entry
    };
    
    appendPrivateJsonLine(getRequestsPath(), fullEntry, { root: getBasePath() });
    
    return fullEntry;
  } finally {
    release();
  }
}

/**
 * Append entry synchronously (for simpler use cases)
 * @param {Object} entry - Network entry to append
 * @returns {Object} The entry with assigned ID
 */
function appendEntrySync(entry, basePath) {
  ensureDirectories(basePath);
  
  const id = entry.id || generateId();
  const timestamp = entry.timestamp || Date.now();
  
  const fullEntry = {
    id,
    timestamp,
    ...entry
  };
  
  // Use a simple lock file for synchronous operations
  const lockPath = path.join(getBasePath(basePath), ".lock");
  let lockFd;
  
  try {
    // Try to acquire lock
    assertNotSymlink(lockPath, true);
    lockFd = fs.openSync(lockPath, "wx", 0o600);
  } catch (err) {
    // Lock exists - check if stale and remove, otherwise proceed without lock
    try {
      const stat = fs.statSync(lockPath);
      if (Date.now() - stat.mtimeMs > 5000) {
        fs.unlinkSync(lockPath);
        try {
          lockFd = fs.openSync(lockPath, "wx", 0o600);
        } catch (e) {
          // Still can't get lock, proceed without it
        }
      }
    } catch (e) {
      // Lock file gone or inaccessible, proceed without lock
    }
    
    if (lockFd === undefined) {
      // Proceed without lock as fallback
      appendPrivateJsonLine(getRequestsPath(basePath), fullEntry, { root: getBasePath(basePath) });
      return fullEntry;
    }
  }
  
  try {
    appendPrivateJsonLine(getRequestsPath(basePath), fullEntry, { root: getBasePath(basePath) });
  } finally {
    if (lockFd !== undefined) {
      fs.closeSync(lockFd);
      try {
        fs.unlinkSync(lockPath);
      } catch (e) {}
    }
  }
  
  return fullEntry;
}

/**
 * Parse URL to extract origin
 */
function getOriginFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin;
  } catch (e) {
    return null;
  }
}

/**
 * Check if URL matches pattern
 */
function matchesUrlPattern(url, pattern) {
  if (!pattern) return true;
  
  // Support regex patterns
  if (pattern.startsWith("/") && pattern.endsWith("/")) {
    try {
      const regex = new RegExp(pattern.slice(1, -1));
      return regex.test(url);
    } catch (e) {
      return false;
    }
  }
  
  // Simple glob-like matching
  if (pattern.includes("*")) {
    const regexPattern = pattern
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*/g, ".*");
    return new RegExp(regexPattern).test(url);
  }
  
  // Simple substring match
  return url.includes(pattern);
}

/**
 * Check if entry matches filters
 */
function matchesFilters(entry, filters) {
  if (!filters) return true;
  
  const {
    origin,
    method,
    status,
    type,
    since,
    hasBody,
    excludeStatic,
    urlPattern
  } = filters;
  
  // Filter by origin
  if (origin) {
    const entryOrigin = getOriginFromUrl(entry.url);
    if (entryOrigin !== origin) return false;
  }
  
  // Filter by method
  if (method && entry.method !== method.toUpperCase()) {
    return false;
  }
  
  // Filter by status
  if (status !== undefined) {
    if (typeof status === "number" && entry.status !== status) return false;
    if (typeof status === "string") {
      const statusStr = String(entry.status);
      if (status.endsWith("xx")) {
        // Range like "2xx", "4xx"
        if (!statusStr.startsWith(status[0])) return false;
      } else if (entry.status !== parseInt(status, 10)) {
        return false;
      }
    }
  }
  
  // Filter by content type
  if (type) {
    const contentType = entry.contentType || entry.responseHeaders?.["content-type"] || "";
    if (!contentType.includes(type)) return false;
  }
  
  // Filter by timestamp
  if (since && entry.timestamp < since) {
    return false;
  }
  
  // Filter by body presence
  if (hasBody !== undefined) {
    const hasResponseBody = !!entry.responseBodyHash;
    if (hasBody !== hasResponseBody) return false;
  }
  
  // Exclude static assets
  if (excludeStatic) {
    const staticExts = [".css", ".js", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".woff", ".woff2", ".ttf", ".ico"];
    const urlPath = entry.url.split("?")[0].toLowerCase();
    if (staticExts.some(ext => urlPath.endsWith(ext))) return false;
  }
  
  // URL pattern matching
  if (urlPattern && !matchesUrlPattern(entry.url, urlPattern)) {
    return false;
  }
  
  return true;
}

/**
 * Read entries with filters (streaming for large files)
 * @param {Object} filters - Filter options
 * @returns {Promise<Array>} Matching entries
 */
async function readEntries(filters = {}) {
  const requestsPath = getRequestsPath();
  
  if (!fs.existsSync(requestsPath)) {
    return [];
  }
  assertNotSymlink(requestsPath, false);
  
  const { last } = filters;
  const entries = [];
  
  return new Promise((resolve, reject) => {
    const fileStream = fs.createReadStream(requestsPath, { encoding: "utf-8" });
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity
    });
    
    rl.on("line", (line) => {
      if (!line.trim()) return;
      
      try {
        const entry = JSON.parse(line);
        if (matchesFilters(entry, filters)) {
          entries.push(entry);
        }
      } catch (err) {
        // Skip malformed lines
      }
    });
    
    rl.on("close", () => {
      // Apply 'last' filter after collecting all matches
      if (last && last > 0) {
        resolve(entries.slice(-last));
      } else {
        resolve(entries);
      }
    });
    
    rl.on("error", reject);
  });
}

/**
 * Read entries synchronously (for smaller datasets)
 * @param {Object} filters - Filter options
 * @returns {Array} Matching entries
 */
function readEntriesSync(filters = {}) {
  const requestsPath = getRequestsPath();
  
  if (!fs.existsSync(requestsPath)) {
    return [];
  }
  assertNotSymlink(requestsPath, false);
  
  const { last } = filters;
  const entries = [];
  
  const content = fs.readFileSync(requestsPath, "utf-8");
  const lines = content.split("\n");
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    try {
      const entry = JSON.parse(line);
      if (matchesFilters(entry, filters)) {
        entries.push(entry);
      }
    } catch (err) {
      // Skip malformed lines
    }
  }
  
  if (last && last > 0) {
    return entries.slice(-last);
  }
  
  return entries;
}

/**
 * Get single entry by ID
 * @param {string} id - Entry ID
 * @returns {Promise<Object|null>} Entry or null if not found
 */
async function getEntry(id) {
  const entries = await readEntries();
  return entries.find(e => e.id === id) || null;
}

/**
 * Get single entry by ID (sync)
 * @param {string} id - Entry ID
 * @returns {Object|null} Entry or null if not found
 */
function getEntrySync(id) {
  const entries = readEntriesSync();
  return entries.find(e => e.id === id) || null;
}

/**
 * Get unique origins with request counts
 * @returns {Promise<Object>} Map of origin -> count
 */
async function getOrigins() {
  const entries = await readEntries();
  const origins = {};
  
  for (const entry of entries) {
    const origin = getOriginFromUrl(entry.url);
    if (origin) {
      origins[origin] = (origins[origin] || 0) + 1;
    }
  }
  
  return origins;
}

/**
 * Get unique origins with counts (sync)
 * @returns {Object} Map of origin -> count
 */
function getOriginsSync() {
  const entries = readEntriesSync();
  const origins = {};
  
  for (const entry of entries) {
    const origin = getOriginFromUrl(entry.url);
    if (origin) {
      origins[origin] = (origins[origin] || 0) + 1;
    }
  }
  
  return origins;
}

/**
 * Get statistics about stored data
 * @returns {Promise<Object>} Stats object
 */
async function getStats() {
  const entries = await readEntries();
  const meta = readMeta();
  const origins = {};
  let oldestEntry = Infinity;
  let newestEntry = 0;
  
  for (const entry of entries) {
    const origin = getOriginFromUrl(entry.url);
    if (origin) {
      origins[origin] = (origins[origin] || 0) + 1;
    }
    if (entry.timestamp < oldestEntry) oldestEntry = entry.timestamp;
    if (entry.timestamp > newestEntry) newestEntry = entry.timestamp;
  }
  
  // Calculate body size
  let totalBodySize = 0;
  const bodiesDir = getBodiesPath();
  if (fs.existsSync(bodiesDir)) {
    const files = fs.readdirSync(bodiesDir);
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(bodiesDir, file));
        totalBodySize += stat.size;
      } catch (err) {}
    }
  }
  
  return {
    totalRequests: entries.length,
    totalBodySize,
    oldestEntry: oldestEntry === Infinity ? null : oldestEntry,
    newestEntry: newestEntry === 0 ? null : newestEntry,
    lastCleanup: meta.lastCleanup || null,
    origins
  };
}

/**
 * Get stats synchronously
 */
function getStatsSync() {
  const entries = readEntriesSync();
  const meta = readMeta();
  const origins = {};
  let oldestEntry = Infinity;
  let newestEntry = 0;
  
  for (const entry of entries) {
    const origin = getOriginFromUrl(entry.url);
    if (origin) {
      origins[origin] = (origins[origin] || 0) + 1;
    }
    if (entry.timestamp < oldestEntry) oldestEntry = entry.timestamp;
    if (entry.timestamp > newestEntry) newestEntry = entry.timestamp;
  }
  
  // Calculate body size
  let totalBodySize = 0;
  const bodiesDir = getBodiesPath();
  if (fs.existsSync(bodiesDir)) {
    const files = fs.readdirSync(bodiesDir);
    for (const file of files) {
      try {
        const stat = fs.statSync(path.join(bodiesDir, file));
        totalBodySize += stat.size;
      } catch (err) {}
    }
  }
  
  return {
    totalRequests: entries.length,
    totalBodySize,
    oldestEntry: oldestEntry === Infinity ? null : oldestEntry,
    newestEntry: newestEntry === 0 ? null : newestEntry,
    lastCleanup: meta.lastCleanup || null,
    origins
  };
}

/**
 * Cleanup old entries and orphaned bodies
 * @param {Object} options - Cleanup options
 * @returns {Promise<Object>} Cleanup results
 */
async function cleanup(options = {}) {
  const { ttl = DEFAULT_TTL, maxSize = DEFAULT_MAX_SIZE } = options;
  const now = Date.now();
  const cutoffTime = now - ttl;
  
  const requestsPath = getRequestsPath();
  const bodiesDir = getBodiesPath();
  
  if (!fs.existsSync(requestsPath)) {
    writeMeta({ lastCleanup: now });
    return { deletedEntries: 0, deletedBodies: 0, freedBytes: 0 };
  }
  
  // Read all entries
  let entries = readEntriesSync();
  const originalCount = entries.length;
  
  // 1. Delete entries older than TTL
  entries = entries.filter(e => e.timestamp >= cutoffTime);
  
  // 2. If still over maxSize, calculate total size and remove oldest
  let totalSize = 0;
  const requestsSize = fs.existsSync(requestsPath) ? fs.statSync(requestsPath).size : 0;
  totalSize += requestsSize;
  
  if (fs.existsSync(bodiesDir)) {
    const files = fs.readdirSync(bodiesDir);
    for (const file of files) {
      try {
        totalSize += fs.statSync(path.join(bodiesDir, file)).size;
      } catch (e) {}
    }
  }
  
  if (totalSize > maxSize && entries.length > 0) {
    // Sort by timestamp and remove oldest entries until under limit
    entries.sort((a, b) => a.timestamp - b.timestamp);
    
    while (entries.length > 0 && totalSize > maxSize) {
      entries.shift();
      // Rough estimate: recalculate after removing some entries
      totalSize = totalSize * (entries.length / (entries.length + 1));
    }
  }
  
  // 3. Collect referenced body hashes
  const referencedHashes = new Set();
  for (const entry of entries) {
    if (entry.requestBodyHash) referencedHashes.add(`${entry.requestBodyHash}.req`);
    if (entry.responseBodyHash) referencedHashes.add(`${entry.responseBodyHash}.res`);
  }
  
  // 4. Delete orphaned body files
  let deletedBodies = 0;
  let freedBytes = 0;
  
  if (fs.existsSync(bodiesDir)) {
    const bodyFiles = fs.readdirSync(bodiesDir);
    for (const file of bodyFiles) {
      if (!referencedHashes.has(file)) {
        const filePath = path.join(bodiesDir, file);
        try {
          const stat = fs.statSync(filePath);
          freedBytes += stat.size;
          fs.unlinkSync(filePath);
          deletedBodies++;
        } catch (e) {}
      }
    }
  }
  
  // 5. Rewrite entries file with remaining entries
  const deletedEntries = originalCount - entries.length;
  
  if (deletedEntries > 0 || entries.length === 0) {
    // Atomic write: write to temp then rename
    const content = entries.map(e => JSON.stringify(e)).join("\n") + (entries.length > 0 ? "\n" : "");
    atomicWriteFile(requestsPath, content, { root: getBasePath(), encoding: "utf8" });
  }
  
  // 6. Update meta
  writeMeta({ lastCleanup: now });
  
  return {
    deletedEntries,
    deletedBodies,
    freedBytes,
    remainingEntries: entries.length
  };
}

/**
 * Clear entries with optional filters
 * @param {Object} options - Clear options
 * @returns {Promise<Object>} Clear results
 */
async function clear(options = {}) {
  const { before, origin: targetOrigin } = options;
  
  const requestsPath = getRequestsPath();
  const bodiesDir = getBodiesPath();
  
  // If no options, clear everything
  if (!before && !targetOrigin) {
    let deletedEntries = 0;
    let deletedBodies = 0;
    
    if (fs.existsSync(requestsPath)) {
      const entries = readEntriesSync();
      deletedEntries = entries.length;
      fs.unlinkSync(requestsPath);
    }
    
    if (fs.existsSync(bodiesDir)) {
      const files = fs.readdirSync(bodiesDir);
      for (const file of files) {
        try {
          fs.unlinkSync(path.join(bodiesDir, file));
          deletedBodies++;
        } catch (e) {}
      }
    }
    
    return { deletedEntries, deletedBodies };
  }
  
  // Selective clear
  if (!fs.existsSync(requestsPath)) {
    return { deletedEntries: 0, deletedBodies: 0 };
  }
  
  const entries = readEntriesSync();
  const originalCount = entries.length;
  
  const remaining = entries.filter(entry => {
    // Keep if doesn't match clear criteria
    if (before && entry.timestamp >= before) return true;
    if (targetOrigin) {
      const entryOrigin = getOriginFromUrl(entry.url);
      if (entryOrigin !== targetOrigin) return true;
    }
    return false;
  });
  
  const deletedEntries = originalCount - remaining.length;
  
  // Collect hashes to keep
  const keepHashes = new Set();
  for (const entry of remaining) {
    if (entry.requestBodyHash) keepHashes.add(`${entry.requestBodyHash}.req`);
    if (entry.responseBodyHash) keepHashes.add(`${entry.responseBodyHash}.res`);
  }
  
  // Delete orphaned bodies
  let deletedBodies = 0;
  if (fs.existsSync(bodiesDir)) {
    const files = fs.readdirSync(bodiesDir);
    for (const file of files) {
      if (!keepHashes.has(file)) {
        try {
          fs.unlinkSync(path.join(bodiesDir, file));
          deletedBodies++;
        } catch (e) {}
      }
    }
  }
  
  // Rewrite entries file
  if (deletedEntries > 0) {
    const content = remaining.map(e => JSON.stringify(e)).join("\n") + (remaining.length > 0 ? "\n" : "");
    atomicWriteFile(requestsPath, content, { root: getBasePath(), encoding: "utf8" });
  }
  
  return { deletedEntries, deletedBodies };
}

/**
 * Run cleanup if last cleanup was more than AUTO_CLEANUP_INTERVAL ago
 */
function maybeAutoCleanup() {
  try {
    const meta = readMeta();
    const now = Date.now();
    
    if (now - (meta.lastCleanup || 0) > AUTO_CLEANUP_INTERVAL) {
      // Run cleanup asynchronously to not block module load
      setImmediate(() => {
        cleanup().catch(err => {
          // Ignore cleanup errors
        });
      });
    }
  } catch (err) {
    // Ignore errors during auto-cleanup check
  }
}

module.exports = {
  // Configuration
  getBasePath,
  getRequestsPath,
  getBodiesPath,
  getMetaPath,
  
  // Body storage
  storeBody,
  readBody,
  getBodyPath,
  
  // Entry operations
  appendEntry,
  appendEntrySync,
  readEntries,
  readEntriesSync,
  getEntry,
  getEntrySync,
  
  // Aggregations
  getOrigins,
  getOriginsSync,
  getStats,
  getStatsSync,
  
  // Maintenance
  cleanup,
  clear,
  maybeAutoCleanup,
  
  // Constants
  DEFAULT_BASE,
  DEFAULT_TTL,
  DEFAULT_MAX_SIZE,
  AUTO_CLEANUP_INTERVAL,
};
