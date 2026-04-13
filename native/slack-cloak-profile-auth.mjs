/**
 * Chrome profile cookie injection for CloakBrowser Slack (macOS, Node.js).
 *
 * Mirrors chatgpt-cloak-profile-auth.mjs but targets Slack domains.
 * Extracts Slack cookies (including the critical 'd' / xoxd cookie) from
 * a Chrome profile's encrypted SQLite DB, decrypts them, and injects
 * into a CloakBrowser Playwright BrowserContext.
 */

import { DatabaseSync } from 'node:sqlite'
import { existsSync, copyFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const {
  discoverChromeProfiles,
  resolveChromeProfile,
  readChromeKeychainPassword,
  deriveChromeCookieKey,
  decryptCookieValue,
  chromeMicrosToUnixSeconds,
  chromeSamesiteToCdp,
} = require('./chrome-profile-utils.cjs')

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SLACK_COOKIE_DOMAINS = [
  '.slack.com',
  'app.slack.com',
  '.enterprise.slack.com',
]

/** The 'd' cookie contains the xoxd device token — required for all API calls */
const REQUIRED_SESSION_COOKIE = 'd'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snapshotCookieDb(cookieDbPath) {
  const tmpDir = mkdtempSync(join(tmpdir(), 'surf-slack-cookies-'))
  const dest = join(tmpDir, 'Cookies')
  copyFileSync(cookieDbPath, dest)
  for (const ext of ['-wal', '-shm']) {
    const src = cookieDbPath + ext
    if (existsSync(src)) copyFileSync(src, join(tmpDir, 'Cookies' + ext))
  }
  return { tmpDir, dbPath: dest }
}

function extractCookies(cookieDbPath, aesKey) {
  let snapshot = null
  let lastErr = null

  for (let attempt = 0; attempt < 2; attempt++) {
    let db = null
    try {
      snapshot = snapshotCookieDb(cookieDbPath)
      db = new DatabaseSync(snapshot.dbPath, { readOnly: true })

      const query = `
        SELECT name, value, encrypted_value, host_key, path,
               CAST(expires_utc AS TEXT) as expires_utc,
               is_secure, is_httponly, samesite
        FROM cookies
        WHERE host_key IN (?, ?, ?)
           OR host_key LIKE '%.slack.com'
           OR host_key LIKE '%app.slack.com'
           OR host_key LIKE '%.enterprise.slack.com'
      `

      const stmt = db.prepare(query)
      const rows = stmt.all(...SLACK_COOKIE_DOMAINS)
      db.close()
      db = null

      const seen = new Set()
      const cookies = []

      for (const row of rows) {
        const dedupeKey = `${row.name}|${row.host_key}|${row.path}`
        if (seen.has(dedupeKey)) continue
        seen.add(dedupeKey)

        let value = row.value
        if (!value && row.encrypted_value) {
          value = decryptCookieValue(Buffer.from(row.encrypted_value), aesKey)
        }
        if (!value) continue

        const expiresUnix = chromeMicrosToUnixSeconds(Number(row.expires_utc))
        if (expiresUnix && expiresUnix < Date.now() / 1000) continue

        const cookie = {
          name: row.name,
          value,
          domain: row.host_key,
          path: row.path || '/',
          secure: Boolean(row.is_secure),
          httpOnly: Boolean(row.is_httponly),
        }
        if (expiresUnix) cookie.expires = expiresUnix
        const sameSite = chromeSamesiteToCdp(row.samesite)
        if (sameSite) cookie.sameSite = sameSite

        cookies.push(cookie)
      }

      return cookies
    } catch (err) {
      lastErr = err
    } finally {
      if (db) try { db.close() } catch {}
      if (snapshot?.tmpDir) {
        try { rmSync(snapshot.tmpDir, { recursive: true, force: true }) } catch {}
      }
      snapshot = null
    }
  }

  throw new Error(
    `Failed to read cookie DB after 2 attempts: ${lastErr?.message}. ` +
    `Try closing Chrome and retrying.`
  )
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Load Slack cookies from a Chrome profile and inject into a CloakBrowser context.
 *
 * @param {import('playwright-core').BrowserContext} context
 * @param {{ profileEmail?: string|null, log?: (msg:string) => void }} opts
 * @returns {Promise<{ resolvedProfileDir: string, resolvedEmails: string[], injectedCount: number }>}
 */
export async function loadAndInjectSlackCookies(context, opts = {}) {
  const diag = opts.log || ((msg) => process.stderr.write(`[slack-auth] ${msg}\n`))

  const profiles = discoverChromeProfiles()
  const resolution = resolveChromeProfile(profiles, opts.profileEmail ?? undefined)
  if ('error' in resolution) {
    throw Object.assign(new Error(resolution.error), { code: resolution.code })
  }
  const profile = resolution.profile
  diag(`Profile: ${profile.dirName} (${profile.emails[0] || 'no email'})`)

  let password
  try {
    password = readChromeKeychainPassword()
  } catch (err) {
    throw Object.assign(
      new Error(`Keychain access failed: ${err.message}`),
      { code: 'keychain_access_failed' }
    )
  }

  const aesKey = deriveChromeCookieKey(password)
  let cookies
  try {
    cookies = extractCookies(profile.cookieDbPath, aesKey)
  } catch (err) {
    throw Object.assign(
      new Error(`Cookie DB error: ${err.message}`),
      { code: 'cookie_db_unavailable' }
    )
  }

  const hasDCookie = cookies.some(c => c.name === REQUIRED_SESSION_COOKIE)
  if (!hasDCookie) {
    throw Object.assign(
      new Error(
        `Required Slack session cookie missing ('${REQUIRED_SESSION_COOKIE}'). ` +
        `Please log into Slack in Chrome profile "${profile.dirName}".`
      ),
      { code: 'login_required' }
    )
  }

  diag(`Extracted ${cookies.length} Slack cookies (d cookie present)`)

  await context.addCookies(cookies)

  const injected = await context.cookies([
    'https://app.slack.com/',
    'https://slack.com/',
    'https://edgeapi.slack.com/',
  ])
  const injectedNames = new Set(injected.map(c => c.name))
  if (!injectedNames.has(REQUIRED_SESSION_COOKIE)) {
    throw Object.assign(
      new Error(`Cookie injection verification failed. Missing: ${REQUIRED_SESSION_COOKIE}`),
      { code: 'cookie_injection_failed' }
    )
  }

  diag(`Injected ${cookies.length} cookies, verification OK`)

  return {
    resolvedProfileDir: profile.dirName,
    resolvedEmails: profile.emails,
    injectedCount: cookies.length,
  }
}
