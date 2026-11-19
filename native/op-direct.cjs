// The direct step of a read: the host sends the op's request itself (Node fetch), with the
// browser's cookies for its URL. The extension reads them at run time; they stay in this call's
// memory for that one request and are never logged or written. The caller has checked that the
// URL is on the op's site, and a redirect is not followed, so nothing goes to another origin.

// fetch sets these itself; the browser's cookies replace any the op names.
const DROPPED = new Set(["connection", "content-length", "cookie", "host"]);

/** Sends a rendered request from the host: { status, url, contentType, body }; gives up after `timeoutMs`. */
async function sendDirect({ request, readCookies, signal, timeoutMs = 15000 }) {
  const { cookies = [], userAgent } = await readCookies(request.url);
  const headers = Object.fromEntries(Object.entries(request.headers || {}).filter(([name]) => !DROPPED.has(name.toLowerCase())));
  if (userAgent && !Object.keys(headers).some((name) => name.toLowerCase() === "user-agent")) headers["user-agent"] = userAgent;
  const cookie = cookies.map(({ name, value }) => `${name}=${value}`).join("; ");
  if (cookie) headers.cookie = cookie;
  const timeout = AbortSignal.timeout(timeoutMs);
  try {
    const response = await fetch(request.url, { method: request.method, headers, body: request.body, redirect: "manual", signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error(`redirected (${response.status}) to ${response.headers.get("location")}; the tab follows redirects`);
    }
    return { status: response.status, url: request.url, contentType: response.headers.get("content-type") || "", body: await response.text() };
  } catch (error) {
    throw timeout.aborted ? new Error(`no answer within ${timeoutMs / 1000} s`) : error;
  }
}

module.exports = { sendDirect };
