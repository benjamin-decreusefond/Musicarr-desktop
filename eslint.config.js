'use strict';

// Flat ESLint config for the Electron app. The main process and the preloads
// are Node/CommonJS; the renderer scripts are plain browser scripts loaded by
// their own HTML pages.

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  // build/ is electron-builder's buildResources dir, but it also holds the icon
  // generator script, which is ours and worth linting.
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  {
    // Main process, preloads and the icon generator.
    files: ['src/**/*.js', 'build/**/*.js'],
    ignores: ['src/renderer/**'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      // The codebase uses empty catch blocks for best-effort cleanup
      // ("try { x } catch { /* noop */ }"); flag genuinely empty blocks elsewhere.
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    // Node test files (CommonJS, node:test).
    files: ['test/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
  {
    // Renderer scripts run in the sandboxed pages and only see the bridge the
    // matching preload exposes.
    files: ['src/renderer/**/*.js'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: { ...globals.browser, musicarr: 'readonly', musicarrChrome: 'readonly', musicarrSettings: 'readonly' },
    },
    rules: {
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
    },
  },
];
