'use strict';

// URL policy helpers, kept free of any `electron` import so they can be unit
// tested in plain Node. These decide what the content view — which renders an
// untrusted remote web app — is allowed to navigate to, so they are worth
// testing directly rather than only through a running app.

const path = require('path');

// Accept what a human types ("musicarr.example.com", "http://192.168.1.5:8686/")
// and return a clean scheme://host[:port] origin, or throw on garbage.
function normalizeServerUrl(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('Enter a server address');
  let value = raw.trim();
  if (!value) throw new Error('Enter a server address');
  // A bare host gets https:// prepended. Anything that already carries a scheme
  // must carry an HTTP one: prepending blindly turned "file:///etc/passwd" into
  // the parseable-but-nonsense origin "https://file", quietly accepting input
  // that should have been refused outright.
  const hasScheme = /^[a-z][a-z0-9+.-]*:/i.test(value);
  if (!hasScheme) {
    value = `https://${value}`;
  } else if (!/^https?:\/\//i.test(value)) {
    throw new Error('That doesn\'t look like a valid address');
  }
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('That doesn\'t look like a valid address');
  }
  if (!url.hostname) throw new Error('That doesn\'t look like a valid address');
  // Keep only the origin — paths/queries are irrelevant for a server root.
  return url.origin;
}

// Windows URL pathnames start with a leading slash ("/C:/..."), and its paths
// are case-insensitive; normalize both shapes so comparison is meaningful.
function normalizeFilePath(p, platform = process.platform) {
  return platform === 'win32' ? p.replace(/^[\\/]/, '').toLowerCase() : p;
}

/**
 * Whether `url` is one of the app's own local pages.
 *
 * Anything the content view loads shares its preload, so a local page gets the
 * `window.musicarr` bridge. Testing the `file://` scheme as a whole would let
 * remote server content navigate to ANY local file and inherit that bridge, so
 * this is an exact-path allowlist: resolved paths are compared, which also
 * means ".." segments and percent-encoded separators can't dress a different
 * file up as an allowed page.
 */
function isLocalPage(url, allowedPages, platform = process.platform) {
  let filePath;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    filePath = path.resolve(decodeURIComponent(parsed.pathname));
  } catch {
    return false;
  }
  return allowedPages.some(
    (page) => normalizeFilePath(filePath, platform) === normalizeFilePath(path.resolve(page), platform)
  );
}

/** The origin of `url`, but only when it is one the content view could
 *  legitimately be navigated to: http(s) and nothing else, so no redirect can
 *  park it on `file:` or fire a registered custom-scheme handler. */
function httpOrigin(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

// How many identity-provider origins one sign-in may accumulate. A federated
// login legitimately chains a couple of hops (proxy -> Keycloak -> upstream
// IdP); a redirect loop must not grow the set without bound.
const MAX_AUTH_ORIGINS = 8;

/** Remember `url`'s origin as part of a sign-in the connected server started.
 *
 *  A server that delegates authentication to an external identity provider
 *  (oauth2-proxy in front of Keycloak/Authentik/Authelia, or built-in OIDC)
 *  answers with a redirect to that provider, which then needs to run its own
 *  login pages — and set its own cookies — before redirecting back. Those pages
 *  are on a foreign origin, so without this they'd be treated as "leaving the
 *  app" and pushed to the system browser, where the provider's just-set login
 *  cookie doesn't exist.
 *
 *  Only origins we arrived at by following the server's own redirects are
 *  recorded, and only while connected. Returns true when the origin is (now)
 *  allowed. */
function rememberAuthOrigin(authOrigins, url, currentOrigin) {
  if (!authOrigins || !currentOrigin) return false;
  const origin = httpOrigin(url);
  if (!origin || origin === currentOrigin) return false;
  if (authOrigins.has(origin)) return true;
  if (authOrigins.size >= MAX_AUTH_ORIGINS) return false;
  authOrigins.add(origin);
  return true;
}

/** Whether navigating to `url` keeps us inside the app: one of our own local
 *  pages, the connected server's origin, or an identity provider that server
 *  redirected us to for an in-progress sign-in (see rememberAuthOrigin).
 *  `currentOrigin` may be null on the connect screen — nothing remote is
 *  in-app there. */
function isInAppUrl(url, { currentOrigin, allowedPages, authOrigins, platform }) {
  if (isLocalPage(url, allowedPages, platform)) return true;
  if (!currentOrigin) return false;
  const origin = httpOrigin(url);
  if (!origin) return false;
  if (origin === currentOrigin) return true;
  return !!authOrigins && authOrigins.has(origin);
}

/** Only ever hand http(s) links to the OS browser — never file:, and never a
 *  custom scheme that could launch a registered handler. */
function isExternallyOpenable(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

module.exports = {
  normalizeServerUrl, isLocalPage, isInAppUrl, isExternallyOpenable,
  httpOrigin, rememberAuthOrigin, MAX_AUTH_ORIGINS,
};
