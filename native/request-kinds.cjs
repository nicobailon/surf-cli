// What a captured request is: a read or a write, telemetry, a page asset, or one a draft may replay.

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
// Beacons, CSP reports and requests to analytics and error-reporting services don't change the
// site's data, so they don't make a recorded flow a write, unless they are made on that service's
// own site (posthog.com's dashboards, say).
const TELEMETRY_TYPES = new Set(["Ping", "CSPViolationReport"]);
const TELEMETRY_HOSTS = [
  "google-analytics.com", "analytics.google.com", "googletagmanager.com", "doubleclick.net",
  "segment.io", "mixpanel.com", "amplitude.com", "heapanalytics.com", "posthog.com",
  "sentry.io", "bugsnag.com", "browser-intake-datadoghq.com", "browser-intake-datadoghq.eu", "nr-data.net",
  "hotjar.com", "clarity.ms", "fullstory.com", "cloudflareinsights.com", "plausible.io",
];

function hostname(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

// A request to a telemetry host is first-party, not telemetry, when the record started on that
// service's site or the page that sent it (`tabUrl`) is on it. With neither known, it isn't
// treated as telemetry.
function isTelemetryRequest(entry, recordOrigin) {
  if (TELEMETRY_TYPES.has(entry.type)) return true;
  const sites = [hostname(recordOrigin), hostname(entry.tabUrl)].filter(Boolean);
  if (sites.length === 0) return false;
  const within = (host, suffix) => host === suffix || host.endsWith(`.${suffix}`);
  const host = hostname(entry.url);
  return TELEMETRY_HOSTS.some((suffix) => within(host, suffix) && !sites.some((site) => within(site, suffix)));
}

// Page assets are captured so the write check sees every request (a POST answered with JavaScript
// is an XHR, not a Script), but a draft or client never replays one.
const ASSET_TYPES = new Set(["Image", "Stylesheet", "Script", "Font", "Media"]);

// A captured request a draft or derived client may replay.
function isReplayCandidate(entry) {
  return ["GET", "HEAD", "OPTIONS", "POST"].includes(entry.method) && entry.status >= 200 && entry.status < 400 && !ASSET_TYPES.has(entry.type);
}

function requestEffect(entry) {
  return READ_METHODS.has(String(entry.method).toUpperCase()) ? "read" : "write";
}

function shownUrl(entry) {
  const url = new URL(entry.url);
  url.search = "";
  return `${entry.method} ${url}`;
}

module.exports = { ASSET_TYPES, hostname, isReplayCandidate, isTelemetryRequest, requestEffect, shownUrl };
