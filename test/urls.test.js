'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { normalizeServerUrl, isLocalPage, isInAppUrl, isExternallyOpenable } = require('../src/urls');

const CONNECT_PAGE = path.join(__dirname, '..', 'src', 'renderer', 'connect.html');
const PAGES = [CONNECT_PAGE];
const fileUrl = (p) => `file://${p}`;

test('normalizeServerUrl accepts what a human types and returns an origin', () => {
  assert.equal(normalizeServerUrl('musicarr.example.com'), 'https://musicarr.example.com');
  assert.equal(normalizeServerUrl('  http://192.168.1.5:8686/  '), 'http://192.168.1.5:8686');
  // Paths and queries are dropped — a server root is just an origin.
  assert.equal(normalizeServerUrl('https://host/some/path?x=1'), 'https://host');
});

test('normalizeServerUrl rejects empty and non-HTTP input', () => {
  assert.throws(() => normalizeServerUrl(''), /Enter a server address/);
  assert.throws(() => normalizeServerUrl('   '), /Enter a server address/);
  assert.throws(() => normalizeServerUrl(null), /Enter a server address/);
  // "https://" is prepended only when no scheme is present, so these keep theirs
  // and must be refused rather than silently becoming a navigable origin.
  assert.throws(() => normalizeServerUrl('file:///etc/passwd'), /valid address/);
  assert.throws(() => normalizeServerUrl('javascript:alert(1)'), /valid address/);
});

test('isLocalPage allows the connect screen only', () => {
  assert.equal(isLocalPage(fileUrl(CONNECT_PAGE), PAGES), true);
  assert.equal(isLocalPage(fileUrl(path.join(__dirname, '..', 'src', 'main.js')), PAGES), false);
  assert.equal(isLocalPage('file:///etc/passwd', PAGES), false);
  assert.equal(isLocalPage('https://example.com', PAGES), false);
  assert.equal(isLocalPage('not a url', PAGES), false);
});

test('isLocalPage is not fooled by traversal or percent-encoding', () => {
  const rendererDir = path.dirname(CONNECT_PAGE);
  // Walk out and back in: resolves to the connect page, so it is allowed.
  assert.equal(isLocalPage(fileUrl(path.join(rendererDir, '..', 'renderer', 'connect.html')), PAGES), true);
  // Walk out and land somewhere else: refused.
  assert.equal(isLocalPage(fileUrl(path.join(rendererDir, '..', '..', 'package.json')), PAGES), false);
  // Percent-encoded separators must decode before comparison, not sneak past it.
  assert.equal(isLocalPage(`file://${rendererDir}%2F..%2F..%2Fpackage.json`, PAGES), false);
  // A path that merely starts with the allowed one is not the allowed one.
  assert.equal(isLocalPage(fileUrl(`${CONNECT_PAGE}.evil.html`), PAGES), false);
});

test('isInAppUrl keeps navigation on the connected origin', () => {
  const opts = { currentOrigin: 'https://music.example.com', allowedPages: PAGES };
  assert.equal(isInAppUrl('https://music.example.com/library', opts), true);
  assert.equal(isInAppUrl(fileUrl(CONNECT_PAGE), opts), true);
  // A different origin, a different port and a downgraded scheme are all "out".
  assert.equal(isInAppUrl('https://evil.example.com/', opts), false);
  assert.equal(isInAppUrl('https://music.example.com:8443/', opts), false);
  assert.equal(isInAppUrl('http://music.example.com/', opts), false);
  // The remote app must not be able to reach local files.
  assert.equal(isInAppUrl('file:///etc/passwd', opts), false);
});

test('isInAppUrl allows only local pages while on the connect screen', () => {
  const opts = { currentOrigin: null, allowedPages: PAGES };
  assert.equal(isInAppUrl(fileUrl(CONNECT_PAGE), opts), true);
  assert.equal(isInAppUrl('https://music.example.com/', opts), false);
});

test('isLocalPage compares case-insensitively on Windows only', () => {
  const upper = CONNECT_PAGE.toUpperCase();
  assert.equal(isLocalPage(fileUrl(upper), [CONNECT_PAGE], 'win32'), true);
  assert.equal(isLocalPage(fileUrl(upper), [CONNECT_PAGE], 'linux'), false);
});

test('isExternallyOpenable hands only http(s) links to the OS browser', () => {
  assert.equal(isExternallyOpenable('https://example.com'), true);
  assert.equal(isExternallyOpenable('HTTP://example.com'), true);
  // Never let a remote page launch a registered scheme handler or a local file.
  assert.equal(isExternallyOpenable('file:///etc/passwd'), false);
  assert.equal(isExternallyOpenable('javascript:alert(1)'), false);
  assert.equal(isExternallyOpenable('ms-settings:'), false);
  assert.equal(isExternallyOpenable(undefined), false);
});
