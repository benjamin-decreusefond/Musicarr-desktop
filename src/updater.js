'use strict';

// Auto-update via electron-updater.
//
// The release pipeline publishes latest.yml + the NSIS .exe + .blockmap to
// GitHub Releases, and the repo is public, so electron-updater can read the feed
// anonymously (the GitHub provider is derived from the "publish" field in
// package.json's build config). On launch and every few hours the app checks for
// a newer release, downloads it in the background (differential via .blockmap),
// and offers to restart-and-install — no manual download or installer wizard.
//
// Auto-update only works in a packaged build; in dev (`npm start`) it's a no-op.

const { app, dialog, BrowserWindow } = require('electron');
const { autoUpdater } = require('electron-updater');

let initialized = false;
// True while a user-initiated "Check for updates" is in flight, so we can show
// "you're up to date" / error dialogs that we'd stay silent about for the
// automatic background checks.
let manualCheck = false;

const SIX_HOURS = 6 * 60 * 60 * 1000;

function activeWindow() {
  return BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0] || null;
}

function setupHandlers() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = console;

  autoUpdater.on('update-available', (info) => {
    if (manualCheck) {
      dialog.showMessageBox(activeWindow(), {
        type: 'info',
        title: 'Update available',
        message: `Musicarr ${info.version} is available.`,
        detail: 'It’s downloading in the background — you’ll be prompted to restart when it’s ready.',
        buttons: ['OK'],
      });
      manualCheck = false; // the download/restart prompt takes over from here
    }
  });

  autoUpdater.on('update-not-available', () => {
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox(activeWindow(), {
        type: 'info',
        title: 'No updates',
        message: 'You’re on the latest version.',
        buttons: ['OK'],
      });
    }
  });

  autoUpdater.on('error', (err) => {
    console.error('[updater]', err);
    if (manualCheck) {
      manualCheck = false;
      dialog.showMessageBox(activeWindow(), {
        type: 'error',
        title: 'Update check failed',
        message: 'Could not check for updates.',
        detail: String((err && err.message) || err),
        buttons: ['OK'],
      });
    }
  });

  autoUpdater.on('update-downloaded', async (info) => {
    manualCheck = false;
    const win = activeWindow();
    const { response } = await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Update ready',
      message: `Musicarr ${info.version} has been downloaded.`,
      detail: 'Restart now to install it, or it will be applied the next time you quit.',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) {
      // Give the dialog a tick to close before the app quits to install.
      setImmediate(() => autoUpdater.quitAndInstall());
    }
  });
}

// Wire up handlers and kick off the first check + a periodic timer.
function initAutoUpdates() {
  if (initialized || !app.isPackaged) return;
  initialized = true;
  setupHandlers();
  checkForUpdates({ silent: true });
  setInterval(() => checkForUpdates({ silent: true }), SIX_HOURS);
}

// Trigger a check. With silent:false (a menu action) the user gets feedback even
// when there's nothing new or the check fails.
function checkForUpdates({ silent = true } = {}) {
  if (!app.isPackaged) {
    if (!silent) {
      dialog.showMessageBox(activeWindow(), {
        type: 'info',
        title: 'Updates',
        message: 'Auto-update is only available in the installed app.',
        buttons: ['OK'],
      });
    }
    return;
  }
  if (!silent) manualCheck = true;
  autoUpdater.checkForUpdates().catch((err) => {
    // The 'error' handler reports to the user when this was a manual check.
    console.error('[updater] check failed', err);
  });
}

module.exports = { initAutoUpdates, checkForUpdates };
