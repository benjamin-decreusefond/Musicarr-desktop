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

/** Whether navigating to `url` keeps us inside the app (local page or the
 *  connected server's own origin). `currentOrigin` may be null on the
 *  connect screen. */
function isInAppUrl(url, { currentOrigin, allowedPages, platform }) {
  if (isLocalPage(url, allowedPages, platform)) return true;
  if (!currentOrigin) return false;
  try {
    return new URL(url).origin === currentOrigin;
  } catch {
    return false;
  }
}

/** Only ever hand http(s) links to the OS browser — never file:, and never a
 *  custom scheme that could launch a registered handler. */
function isExternallyOpenable(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url);
}

module.exports = { normalizeServerUrl, isLocalPage, isInAppUrl, isExternallyOpenable };
