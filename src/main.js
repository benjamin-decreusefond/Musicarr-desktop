'use strict';

// Musicarr Desktop — a thin, native Electron shell around a remote Musicarr
// server's web app. The renderer that actually talks to Deezer/Soulseek/etc is
// the server's own React UI: we point a hardened WebContentsView at the chosen
// server origin (same-origin cookies = the web login persists) and add the
// things a browser tab can't give you — a server picker, a slim custom title
// bar with an in-app "Switch server" control, window-state persistence, a tray,
// hardware media-key playback and auto-update.
//
// Layout: the BrowserWindow is frameless. Its own webContents renders the slim
// custom title bar (top TITLEBAR_H px); a child WebContentsView holds the actual
// app content below it, so the title bar never overlaps the web UI.

const path = require('path');
const { app, BrowserWindow, WebContentsView, ipcMain, shell, net, Tray, Menu, nativeImage, screen } = require('electron');
const { Store } = require('./store');
const { buildAppMenu } = require('./menu');
const { initAutoUpdates, checkForUpdates } = require('./updater');

const CONNECT_PAGE = path.join(__dirname, 'renderer', 'connect.html');
const TITLEBAR_PAGE = path.join(__dirname, 'renderer', 'titlebar.html');
const SETTINGS_PAGE = path.join(__dirname, 'renderer', 'settings.html');
const PRELOAD = path.join(__dirname, 'preload.js');
const TITLEBAR_PRELOAD = path.join(__dirname, 'titlebar-preload.js');
const SETTINGS_PRELOAD = path.join(__dirname, 'settings-preload.js');
const HEALTH_TIMEOUT_MS = 8000;
const TITLEBAR_H = 36;

let store;
let mainWindow = null;     // frameless window; its webContents = the title bar
let contentView = null;    // WebContentsView holding the connect screen / server app
let settingsWindow = null; // small native dialog for desktop preferences
let tray = null;
// The origin we currently consider "in-app". Null while on the connect screen.
let currentOrigin = null;
// Set on a real quit so the close-to-tray handler lets the window actually close.
let isQuitting = false;
// True when this launch was started hidden (auto-start at login + "start hidden").
let startHidden = process.argv.includes('--hidden');

// ---------------------------------------------------------------------------
// URL helpers
// ---------------------------------------------------------------------------

// Accept what a human types ("musicarr.example.com", "http://192.168.1.5:8686/")
// and return a clean scheme://host[:port] origin, or throw on garbage.
function normalizeServerUrl(raw) {
  if (!raw || typeof raw !== 'string') throw new Error('Enter a server address');
  let value = raw.trim();
  if (!value) throw new Error('Enter a server address');
  if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
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

// Probe a candidate server's unauthenticated /health liveness endpoint.
function testServer(rawUrl) {
  return new Promise((resolve) => {
    let origin;
    try {
      origin = normalizeServerUrl(rawUrl);
    } catch (err) {
      resolve({ ok: false, error: err.message });
      return;
    }

    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const request = net.request({ method: 'GET', url: `${origin}/health` });
    const timer = setTimeout(() => {
      try { request.abort(); } catch { /* noop */ }
      finish({ ok: false, url: origin, error: 'Connection timed out — is the server running and reachable?' });
    }, HEALTH_TIMEOUT_MS);

    request.on('response', (response) => {
      // Drain the body so the socket can close cleanly.
      response.on('data', () => {});
      response.on('end', () => {
        const status = response.statusCode || 0;
        if (status >= 200 && status < 500) finish({ ok: true, url: origin, status });
        else finish({ ok: false, url: origin, error: `Server responded with HTTP ${status}` });
      });
    });
    request.on('error', (err) => {
      finish({ ok: false, url: origin, error: err && err.message ? err.message : 'Could not reach the server' });
    });
    request.end();
  });
}

// ---------------------------------------------------------------------------
// Window lifecycle
// ---------------------------------------------------------------------------

// Saved window bounds, but only if a meaningful part of them still falls on a
// currently-connected display. This is what makes multi-monitor restore work:
// without the check, stale/off-screen coordinates get clamped back onto the
// primary screen (or the wrong monitor under mixed DPI).
function savedWindowBounds() {
  const b = store.get('windowBounds');
  if (!b || typeof b.x !== 'number' || typeof b.y !== 'number' || !b.width || !b.height) return null;
  const visible = screen.getAllDisplays().some((d) => {
    const wa = d.workArea;
    const ox = Math.min(b.x + b.width, wa.x + wa.width) - Math.max(b.x, wa.x);
    const oy = Math.min(b.y + b.height, wa.y + wa.height) - Math.max(b.y, wa.y);
    return ox > 0 && oy > 0 && ox * oy > 0.3 * b.width * b.height; // ~30% on-screen
  });
  return visible ? b : null;
}

function createWindow() {
  const saved = savedWindowBounds();
  mainWindow = new BrowserWindow({
    width: saved ? saved.width : 1180,
    height: saved ? saved.height : 800,
    x: saved ? saved.x : undefined,
    y: saved ? saved.y : undefined,
    minWidth: 720,
    minHeight: 540,
    backgroundColor: '#0b0c10',
    show: false,
    frame: false,            // custom title bar (see titlebar.html)
    title: 'Musicarr',
    webPreferences: {
      // The window's own page is the local, trusted title bar.
      preload: TITLEBAR_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Re-assert the exact saved position after construction — setBounds places the
  // window reliably across monitors with different DPI, where constructor x/y can
  // land on the wrong screen. Then restore the maximized state.
  if (saved) mainWindow.setBounds({ x: saved.x, y: saved.y, width: saved.width, height: saved.height });
  if (store.get('windowMaximized')) mainWindow.maximize();

  // The title bar lives in the window's root webContents.
  mainWindow.loadFile(TITLEBAR_PAGE);
  mainWindow.webContents.on('did-finish-load', () => updateTitlebar());
  // The title bar is local; never let it navigate away or open windows.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  // The actual app content (connect screen / remote server) lives below the bar.
  contentView = new WebContentsView({
    webPreferences: {
      preload: PRELOAD,
      // Remote server content is untrusted: keep it fully sandboxed with no Node
      // access. The preload only bridges a tiny, safe config API.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });
  mainWindow.contentView.addChildView(contentView);
  layout();

  const cv = contentView.webContents;
  const savedZoom = store.get('zoomFactor');
  if (savedZoom) {
    cv.on('did-finish-load', () => cv.setZoomFactor(savedZoom));
  }

  // Open links to anywhere other than the connected server in the user's real
  // browser, and never let the app spawn extra Electron windows.
  cv.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });
  cv.on('will-navigate', (event, url) => {
    if (isInAppUrl(url)) return; // staying inside the server app — allow
    event.preventDefault();
    openExternalIfSafe(url);
  });

  // Show the window unless we were auto-started hidden (launch-at-login +
  // "start hidden in the tray"); in that case stay in the tray until summoned.
  mainWindow.once('ready-to-show', () => {
    if (startHidden) { startHidden = false; return; }
    mainWindow.show();
  });

  // "Keep running in the tray when closed": intercept the close and hide instead
  // of quitting, unless we're really quitting or there's no tray to restore from.
  mainWindow.on('close', (event) => {
    if (!isQuitting && store.get('minimizeToTray') && tray) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  // Persist size/position so we reopen where the user left off. Only store the
  // *windowed* bounds (skip while maximized/minimized) so the restore size is the
  // un-maximized size; the maximized state is tracked separately.
  const persistBounds = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized() && !mainWindow.isMaximized()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  };
  mainWindow.on('resize', () => { layout(); persistBounds(); });
  mainWindow.on('move', persistBounds);
  mainWindow.on('maximize', () => { store.set('windowMaximized', true); updateTitlebar(); });
  mainWindow.on('unmaximize', () => { store.set('windowMaximized', false); updateTitlebar(); });
  mainWindow.on('enter-full-screen', () => updateTitlebar());
  mainWindow.on('leave-full-screen', () => updateTitlebar());

  mainWindow.on('closed', () => {
    mainWindow = null;
    contentView = null;
  });

  // Decide what to show first: auto-reconnect to the last server if it's up,
  // otherwise fall back to the connect screen.
  bootstrap();
}

// Size the content view to fill everything below the title bar.
function layout() {
  if (!mainWindow || mainWindow.isDestroyed() || !contentView) return;
  const [w, h] = mainWindow.getContentSize();
  contentView.setBounds({ x: 0, y: TITLEBAR_H, width: w, height: Math.max(0, h - TITLEBAR_H) });
}

async function bootstrap() {
  const last = store.get('currentServer');
  if (last) {
    const result = await testServer(last);
    if (result.ok) {
      loadServer(result.url);
      return;
    }
  }
  showConnectScreen();
}

function showConnectScreen(message) {
  currentOrigin = null;
  if (!contentView) return;
  const query = message ? `?message=${encodeURIComponent(message)}` : '';
  contentView.webContents.loadFile(CONNECT_PAGE, query ? { search: query } : undefined);
  if (mainWindow) mainWindow.setTitle('Musicarr');
  updateTitlebar();
  refreshMenu();
}

function loadServer(rawUrl) {
  let origin;
  try {
    origin = normalizeServerUrl(rawUrl);
  } catch {
    showConnectScreen('That server address is not valid.');
    return;
  }
  currentOrigin = origin;
  store.rememberServer(origin, hostLabel(origin));
  contentView.webContents.loadURL(origin);
  if (mainWindow) mainWindow.setTitle(`Musicarr — ${hostLabel(origin)}`);
  updateTitlebar();
  refreshMenu();

  // If the server origin itself can't be loaded, bounce back to the picker.
  contentView.webContents.once('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
    if (isMainFrame && currentOrigin && failedUrl.startsWith(currentOrigin)) {
      showConnectScreen(`Couldn't load ${hostLabel(origin)} (${desc || code}).`);
    }
  });
}

function hostLabel(origin) {
  try { return new URL(origin).host; } catch { return origin; }
}

function isInAppUrl(url) {
  if (url.startsWith('file://')) return true; // the local connect screen
  if (!currentOrigin) return false;
  try { return new URL(url).origin === currentOrigin; } catch { return false; }
}

function openExternalIfSafe(url) {
  if (/^https?:\/\//i.test(url)) shell.openExternal(url).catch(() => {});
}

// Push the current connection/window state to the title bar renderer.
function updateTitlebar() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send('titlebar:state', {
    connected: !!currentOrigin,
    host: currentOrigin ? hostLabel(currentOrigin) : '',
    maximized: mainWindow.isMaximized(),
  });
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

// Electron can only manage the OS "open at login" entry on Windows and macOS;
// on Linux it's left to the desktop environment.
const CAN_LAUNCH_AT_LOGIN = process.platform === 'darwin' || process.platform === 'win32';

// Our own config is the source of truth for all three toggles. We deliberately
// do NOT read launch-at-login back from the OS: on Windows, once the login item
// is registered with a launch arg (--hidden), app.getLoginItemSettings() called
// without that same arg fails to match and reports the item as disabled — which
// previously made enabling "start hidden" silently turn launch-at-login off and
// left the toggle stuck. So we store the choice and only ever write it to the OS.
function getSettings() {
  return {
    launchAtLogin: CAN_LAUNCH_AT_LOGIN ? !!store.get('launchAtLogin') : false,
    startMinimized: !!store.get('startMinimized'),
    minimizeToTray: !!store.get('minimizeToTray'),
    canLaunchAtLogin: CAN_LAUNCH_AT_LOGIN,
  };
}

// Register/unregister the OS login item from our stored preferences. The
// "start hidden" flag is passed two ways so each platform can honour it:
// openAsHidden (macOS) and a --hidden launch arg we read on boot (Windows).
function applyLoginItem() {
  if (!CAN_LAUNCH_AT_LOGIN) return;
  const hidden = !!store.get('startMinimized');
  app.setLoginItemSettings({
    openAtLogin: !!store.get('launchAtLogin'),
    openAsHidden: hidden,
    args: hidden ? ['--hidden'] : [],
  });
}

// Apply a partial settings update and return the resulting full settings.
function setSettings(partial = {}) {
  if (typeof partial.minimizeToTray === 'boolean') store.set('minimizeToTray', partial.minimizeToTray);
  if (typeof partial.startMinimized === 'boolean') store.set('startMinimized', partial.startMinimized);
  if (typeof partial.launchAtLogin === 'boolean') store.set('launchAtLogin', partial.launchAtLogin);
  applyLoginItem();
  refreshMenu();
  return getSettings();
}

function openSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 480,
    height: 470,
    parent: mainWindow && !mainWindow.isDestroyed() ? mainWindow : undefined,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'Musicarr Settings',
    backgroundColor: '#0b0c10',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: SETTINGS_PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  settingsWindow.loadFile(SETTINGS_PAGE);
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  // setWindowOpenHandler lives on webContents, not the BrowserWindow.
  settingsWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

// ---------------------------------------------------------------------------
// Menu / tray wiring
// ---------------------------------------------------------------------------

// The application menu is kept (hidden, since the window is frameless) purely so
// its keyboard accelerators keep working; the visible controls are the custom
// title bar and the tray.
function refreshMenu() {
  const menu = buildAppMenu({
    app,
    window: mainWindow,
    store,
    isConnected: !!currentOrigin,
    onDisconnect: () => showConnectScreen(),
    onReload: () => { if (contentView) contentView.webContents.reload(); },
    onZoom: (factor) => {
      if (!contentView) return;
      contentView.webContents.setZoomFactor(factor);
      store.set('zoomFactor', factor);
    },
    onConnectTo: (url) => loadServer(url),
    onOpenSettings: () => openSettingsWindow(),
    onCheckForUpdates: () => checkForUpdates({ silent: false }),
  });
  Menu.setApplicationMenu(menu);
}

function createTray() {
  // Load the bundled tray icon (src/tray.png ships inside the app; build/ is
  // buildResources and isn't packaged). A 1x1 transparent fallback keeps the
  // tray functional if it's somehow missing.
  let image = nativeImage.createFromPath(path.join(__dirname, 'tray.png'));
  if (image.isEmpty()) {
    image = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
    );
  }
  try {
    tray = new Tray(image);
    tray.setToolTip('Musicarr');
    tray.on('click', () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible()) mainWindow.focus();
      else mainWindow.show();
    });
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Show Musicarr', click: () => mainWindow && mainWindow.show() },
      { label: 'Switch server…', click: () => showConnectScreen() },
      { label: 'Settings…', click: () => openSettingsWindow() },
      { label: 'Check for Updates…', click: () => checkForUpdates({ silent: false }) },
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
  } catch {
    // Tray is a nicety; some headless/CI environments have no tray host.
    tray = null;
  }
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

// Server config bridge (used by the connect screen).
ipcMain.handle('servers:list', () => ({
  servers: store.get('servers') || [],
  current: store.get('currentServer') || null,
}));

ipcMain.handle('servers:test', async (_event, url) => testServer(url));

ipcMain.handle('servers:connect', async (_event, url) => {
  const result = await testServer(url);
  if (result.ok) loadServer(result.url);
  return result;
});

ipcMain.handle('servers:forget', (_event, url) => {
  store.forgetServer(url);
  return { servers: store.get('servers') || [], current: store.get('currentServer') || null };
});

// Desktop preferences bridge (used by the Settings window).
ipcMain.handle('settings:get', () => getSettings());
ipcMain.handle('settings:set', (_event, partial) => setSettings(partial || {}));

// Title bar bridge: window controls + in-app "Switch server" / "Settings".
ipcMain.on('chrome:minimize', () => mainWindow && mainWindow.minimize());
ipcMain.on('chrome:maximize-toggle', () => {
  if (!mainWindow) return;
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('chrome:close', () => mainWindow && mainWindow.close());
ipcMain.on('chrome:switch-server', () => showConnectScreen());
ipcMain.on('chrome:open-settings', () => openSettingsWindow());
ipcMain.on('chrome:ready', () => updateTitlebar());

// ---------------------------------------------------------------------------
// App boot
// ---------------------------------------------------------------------------

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // Mark a real quit so the close-to-tray handler stops intercepting and lets
  // every window close.
  app.on('before-quit', () => { isQuitting = true; });

  app.whenReady().then(() => {
    store = new Store();
    // Reconcile our stored launch-at-login with the OS once on boot, reading with
    // the same args we register (so the read is reliable on Windows). This migrates
    // users who enabled it before this was stored, and picks up changes made in the
    // OS startup settings.
    if (CAN_LAUNCH_AT_LOGIN) {
      const hidden = !!store.get('startMinimized');
      store.set('launchAtLogin', app.getLoginItemSettings({ args: hidden ? ['--hidden'] : [] }).openAtLogin);
    }
    createWindow();
    refreshMenu();
    createTray();
    initAutoUpdates();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
