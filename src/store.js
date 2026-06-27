'use strict';

// Tiny dependency-free JSON config store persisted to the app's userData
// directory. Holds the list of known Musicarr servers, which one is current,
// and the last window bounds so the app reopens where you left it.

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULTS = {
  // The server the app should auto-connect to on launch (normalized origin).
  currentServer: null,
  // Most-recently-used first; each entry: { url, name, lastUsedAt }.
  servers: [],
  // Restored on next launch.
  windowBounds: null,
  // Whether the window was maximized when last closed.
  windowMaximized: false,
  // Persisted zoom factor for the web content.
  zoomFactor: 1,
  // When the window is closed, keep the app running in the tray instead of
  // quitting — re-open it from the tray icon. Off by default (closing quits).
  minimizeToTray: false,
  // Start hidden in the tray when the app is launched at login (only takes
  // effect together with the OS "launch at login" setting).
  startMinimized: false,
  // Whether the app registers itself to launch at login. We keep this as the
  // source of truth and apply it to the OS, because reading it back from the OS
  // is unreliable on Windows once a launch arg (--hidden) is registered.
  launchAtLogin: false,
};

class Store {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'config.json');
    this.data = this._load();
  }

  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULTS, ...parsed };
    } catch {
      return { ...DEFAULTS };
    }
  }

  _save() {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (err) {
      // Config is best-effort; a failed write must never crash the app.
      console.error('[store] failed to persist config:', err);
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this._save();
  }

  // Record a successful connection: set as current and move to the front of
  // the recent list (de-duplicated by normalized url).
  rememberServer(url, name) {
    const servers = (this.data.servers || []).filter((s) => s.url !== url);
    servers.unshift({ url, name: name || url, lastUsedAt: new Date().toISOString() });
    this.data.servers = servers.slice(0, 10);
    this.data.currentServer = url;
    this._save();
  }

  forgetServer(url) {
    this.data.servers = (this.data.servers || []).filter((s) => s.url !== url);
    if (this.data.currentServer === url) this.data.currentServer = null;
    this._save();
  }
}

module.exports = { Store };
