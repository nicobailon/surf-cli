class SurfError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "SurfError";
    this.code = code;
    Object.assign(this, details);
  }

  toJSON() {
    const value = { code: this.code, message: this.message };
    for (const key of [
      "session", "target", "lastUrl", "laneKey", "resourceKeys", "retryable", "recoveryCommand",
      "queue", "reason", "browserEpoch", "expectedBrowserEpoch",
    ]) {
      if (this[key] !== undefined) value[key] = this[key];
    }
    return value;
  }
}

function surfError(code, message, details = {}) {
  return new SurfError(code, message, details);
}

function isSurfError(error) {
  return Boolean(error && typeof error === "object" && typeof error.code === "string");
}

function fromExtensionError(result, fallbackCode = "browser_error") {
  if (!result?.error) return null;
  return surfError(result.errorCode || fallbackCode, result.error, result.errorDetails || {});
}

function recoveryFor(error) {
  if (!error || typeof error !== "object") return null;
  if (typeof error.recoveryCommand === "string" && error.recoveryCommand) return error.recoveryCommand;
  if ((error.code === "tab_gone" || error.code === "session_epoch_stale") && error.session) {
    return `surf session.reopen ${error.session}`;
  }
  if ((error.code === "tab_busy" || error.code === "browser_busy" || error.code === "resource_busy") && error.session) {
    return `surf session.info ${error.session}`;
  }
  if (error.code === "browser_busy") return "surf session.list --refresh";
  return null;
}

module.exports = { SurfError, surfError, isSurfError, fromExtensionError, recoveryFor };
