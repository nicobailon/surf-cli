const crypto = require("crypto");
const {
  atomicWriteJson,
  getPrivateStateRoot,
  privateStatePath,
  readPrivateJson,
} = require("./private-state.cjs");
const { surfError } = require("./surf-error.cjs");

const STORE_VERSION = 1;
const SESSION_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

function normalizeName(name) {
  return String(name || "").toLowerCase();
}

function validateSessionName(name) {
  if (typeof name !== "string" || !SESSION_NAME_PATTERN.test(name)) {
    throw surfError(
      "session_name_invalid",
      "session name must be 1-64 characters using letters, numbers, dot, underscore, or hyphen",
    );
  }
  return name;
}

function emptyState() {
  return { version: STORE_VERSION, browsers: {} };
}

class BrowserSessionStore {
  constructor({ filePath = privateStatePath("browser-sessions.json"), root = getPrivateStateRoot(), now = () => new Date().toISOString() } = {}) {
    this.filePath = filePath;
    this.root = root;
    this.now = now;
  }

  load() {
    let state;
    try {
      state = readPrivateJson(this.filePath, emptyState(), { root: this.root });
    } catch (error) {
      throw surfError("state_read_failed", `failed to read browser sessions: ${error.message}`, { cause: error });
    }
    if (!state || state.version !== STORE_VERSION || !state.browsers || typeof state.browsers !== "object") {
      throw surfError("state_read_failed", `browser session state is invalid: ${this.filePath}`);
    }
    return state;
  }

  save(state) {
    try {
      atomicWriteJson(this.filePath, state, { root: this.root });
    } catch (error) {
      throw surfError("state_write_failed", `failed to save browser sessions: ${error.message}`, {
        cause: error,
      });
    }
  }

  bucket(state, browserInstanceId, create = false) {
    if (!browserInstanceId) throw surfError("extension_identity_missing", "browser instance identity is unavailable");
    let bucket = state.browsers[browserInstanceId];
    if (!bucket && create) {
      bucket = { sessions: {}, namedTabs: {} };
      state.browsers[browserInstanceId] = bucket;
    }
    return bucket || { sessions: {}, namedTabs: {} };
  }

  list(identity) {
    const state = this.load();
    const bucket = this.bucket(state, identity.browserInstanceId, false);
    return Object.values(bucket.sessions || {})
      .map((entry) => ({ ...entry }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  get(identity, name) {
    validateSessionName(name);
    const state = this.load();
    const bucket = this.bucket(state, identity.browserInstanceId, false);
    const record = bucket.sessions?.[normalizeName(name)];
    return record ? { ...record } : null;
  }

  findByTab(identity, tabId, exceptName) {
    const exceptKey = exceptName ? normalizeName(exceptName) : null;
    return this.list(identity).find((record) => (
      record.tabId === tabId &&
      record.browserEpoch === identity.browserEpoch &&
      normalizeName(record.name) !== exceptKey &&
      !record.invalidReason
    )) || null;
  }

  create(identity, name, values) {
    validateSessionName(name);
    const key = normalizeName(name);
    const state = this.load();
    const bucket = this.bucket(state, identity.browserInstanceId, true);
    if (bucket.sessions[key]) {
      throw surfError("session_exists", `session already exists: ${name}`, {
        session: name,
        recoveryCommand: `surf session.ensure ${name}`,
      });
    }
    const timestamp = this.now();
    const record = {
      ...values,
      bindingId: crypto.randomUUID(),
      name,
      browserInstanceId: identity.browserInstanceId,
      browserEpoch: identity.browserEpoch,
      createdAt: timestamp,
      updatedAt: timestamp,
      lastValidatedAt: values.lastValidatedAt || timestamp,
    };
    bucket.sessions[key] = record;
    this.save(state);
    return { ...record };
  }

  replace(identity, name, values) {
    validateSessionName(name);
    const key = normalizeName(name);
    const state = this.load();
    const bucket = this.bucket(state, identity.browserInstanceId, true);
    const existing = bucket.sessions[key];
    const timestamp = this.now();
    const record = {
      ...existing,
      ...values,
      bindingId: existing?.bindingId || crypto.randomUUID(),
      name: existing?.name || name,
      browserInstanceId: identity.browserInstanceId,
      browserEpoch: identity.browserEpoch,
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
      lastValidatedAt: values.lastValidatedAt || timestamp,
    };
    delete record.invalidReason;
    delete record.invalidatedAt;
    bucket.sessions[key] = record;
    this.save(state);
    return { ...record };
  }

  update(identity, name, patch) {
    const existing = this.get(identity, name);
    if (!existing) throw surfError("session_unknown", `unknown session: ${name}`, { session: name });
    return this.replace(identity, name, { ...existing, ...patch, updatedAt: this.now() });
  }

  remove(identity, name) {
    validateSessionName(name);
    const key = normalizeName(name);
    const state = this.load();
    const bucket = this.bucket(state, identity.browserInstanceId, false);
    const existing = bucket.sessions?.[key];
    if (!existing) return null;
    delete bucket.sessions[key];
    this.save(state);
    return { ...existing };
  }

  invalidateByTab(identity, tabId, reason = "tab_gone") {
    const state = this.load();
    const bucket = this.bucket(state, identity.browserInstanceId, false);
    let changed = false;
    for (const record of Object.values(bucket.sessions || {})) {
      if (record.tabId !== tabId) continue;
      record.invalidReason = reason;
      record.invalidatedAt = this.now();
      record.updatedAt = record.invalidatedAt;
      changed = true;
    }
    for (const [key, entry] of Object.entries(bucket.namedTabs || {})) {
      if (entry.tabId === tabId) {
        delete bucket.namedTabs[key];
        changed = true;
      }
    }
    if (changed) this.save(state);
    return changed;
  }

  invalidateByWindow(identity, windowId, reason = "window_gone") {
    const state = this.load();
    const bucket = this.bucket(state, identity.browserInstanceId, false);
    let changed = false;
    for (const record of Object.values(bucket.sessions || {})) {
      if (record.windowId !== windowId) continue;
      record.invalidReason = reason;
      record.invalidatedAt = this.now();
      record.updatedAt = record.invalidatedAt;
      changed = true;
    }
    for (const [key, entry] of Object.entries(bucket.namedTabs || {})) {
      if (entry.windowId === windowId) {
        delete bucket.namedTabs[key];
        changed = true;
      }
    }
    if (changed) this.save(state);
    return changed;
  }

  updateTabMetadata(identity, tabId, patch) {
    const state = this.load();
    const bucket = this.bucket(state, identity.browserInstanceId, false);
    let changed = false;
    for (const record of Object.values(bucket.sessions || {})) {
      if (record.tabId !== tabId) continue;
      Object.assign(record, patch, { updatedAt: this.now() });
      changed = true;
    }
    if (changed) this.save(state);
    return changed;
  }

  setNamedTab(identity, name, values) {
    validateSessionName(name);
    const state = this.load();
    const bucket = this.bucket(state, identity.browserInstanceId, true);
    bucket.namedTabs[normalizeName(name)] = {
      name,
      browserEpoch: identity.browserEpoch,
      updatedAt: this.now(),
      ...values,
    };
    this.save(state);
    return { ...bucket.namedTabs[normalizeName(name)] };
  }

  getNamedTab(identity, name) {
    validateSessionName(name);
    const state = this.load();
    const bucket = this.bucket(state, identity.browserInstanceId, false);
    const entry = bucket.namedTabs?.[normalizeName(name)];
    return entry ? { ...entry } : null;
  }

  listNamedTabs(identity) {
    const state = this.load();
    const bucket = this.bucket(state, identity.browserInstanceId, false);
    return Object.values(bucket.namedTabs || {})
      .map((entry) => ({ ...entry }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  removeNamedTab(identity, name) {
    validateSessionName(name);
    const state = this.load();
    const bucket = this.bucket(state, identity.browserInstanceId, false);
    const key = normalizeName(name);
    const entry = bucket.namedTabs?.[key];
    if (!entry) return null;
    delete bucket.namedTabs[key];
    this.save(state);
    return { ...entry };
  }
}

module.exports = {
  BrowserSessionStore,
  SESSION_NAME_PATTERN,
  STORE_VERSION,
  normalizeName,
  validateSessionName,
};
