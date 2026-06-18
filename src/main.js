'use strict';

// Musicarr Desktop — a thin, native Electron shell around a remote Musicarr
// server's web app. The renderer that actually talks to Deezer/Soulseek/etc is
// the server's own React UI: we just point a hardened BrowserWindow at the
// chosen server origin (same-origin cookies = the web login persists) and add
// the things a browser tab can't give you — a server picker, window-state
// persistence, a tray, native menus and hardware media-key playback control.

const path = require('path');
const { app, BrowserWindow, ipcMain, shell, net, Tray, Menu, nativeImage } = require('electron');
const { Store } = require('./store');
const { buildAppMenu } = require('./menu');
const { initAutoUpdates, checkForUpdates } = require('./updater');

const CONNECT_PAGE = path.join(__dirname, 'renderer', 'connect.html');
const PRELOAD = path.join(__dirname, 'preload.js');
const HEALTH_TIMEOUT_MS = 8000;

let store;
let mainWindow = null;
let tray = null;
// The origin we currently consider "in-app". Null while on the connect screen.
let currentOrigin = null;

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

function createWindow() {
  const bounds = store.get('windowBounds') || {};
  mainWindow = new BrowserWindow({
    width: bounds.width || 1180,
    height: bounds.height || 800,
    x: bounds.x,
    y: bounds.y,
    minWidth: 720,
    minHeight: 540,
    backgroundColor: '#0b0c10',
    show: false,
    autoHideMenuBar: false,
    title: 'Musicarr',
    webPreferences: {
      preload: PRELOAD,
      // Remote server content is untrusted web content: keep it fully sandboxed
      // with no Node access. The preload only bridges a tiny, safe config API.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
    },
  });

  const savedZoom = store.get('zoomFactor');
  if (savedZoom) {
    mainWindow.webContents.on('did-finish-load', () => {
      mainWindow.webContents.setZoomFactor(savedZoom);
    });
  }

  mainWindow.once('ready-to-show', () => mainWindow.show());

  // Persist size/position so we reopen where the user left off.
  const persistBounds = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isMinimized()) {
      store.set('windowBounds', mainWindow.getBounds());
    }
  };
  mainWindow.on('resize', persistBounds);
  mainWindow.on('move', persistBounds);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Open links to anywhere other than the connected server in the user's real
  // browser, and never let the app spawn extra Electron windows.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalIfSafe(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (isInAppUrl(url)) return; // staying inside the server app — allow
    event.preventDefault();
    openExternalIfSafe(url);
  });

  // Decide what to show first: auto-reconnect to the last server if it's up,
  // otherwise fall back to the connect screen.
  bootstrap();
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
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const query = message ? `?message=${encodeURIComponent(message)}` : '';
  mainWindow.loadFile(CONNECT_PAGE, query ? { search: query } : undefined);
  mainWindow.setTitle('Musicarr');
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
  mainWindow.loadURL(origin);
  mainWindow.setTitle(`Musicarr — ${hostLabel(origin)}`);
  refreshMenu();

  // If the server origin itself can't be loaded, bounce back to the picker.
  mainWindow.webContents.once('did-fail-load', (_e, code, desc, failedUrl, isMainFrame) => {
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

// ---------------------------------------------------------------------------
// Menu / tray wiring
// ---------------------------------------------------------------------------

function refreshMenu() {
  const menu = buildAppMenu({
    app,
    window: mainWindow,
    store,
    isConnected: !!currentOrigin,
    onDisconnect: () => showConnectScreen(),
    onReload: () => { if (mainWindow) mainWindow.webContents.reload(); },
    onZoom: (factor) => {
      if (!mainWindow) return;
      mainWindow.webContents.setZoomFactor(factor);
      store.set('zoomFactor', factor);
    },
    onConnectTo: (url) => loadServer(url),
    onCheckForUpdates: () => checkForUpdates({ silent: false }),
  });
  Menu.setApplicationMenu(menu);
}

function createTray() {
  // A 1x1 transparent fallback keeps the tray functional even before a real
  // icon asset is added under build/.
  let image = nativeImage.createFromPath(path.join(__dirname, '..', 'build', 'tray.png'));
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
      { type: 'separator' },
      { label: 'Quit', click: () => app.quit() },
    ]));
  } catch {
    // Tray is a nicety; some headless/CI environments have no tray host.
    tray = null;
  }
}

// ---------------------------------------------------------------------------
// IPC — the only privileged surface exposed to the (local) connect screen
// ---------------------------------------------------------------------------

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

  app.whenReady().then(() => {
    store = new Store();
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
