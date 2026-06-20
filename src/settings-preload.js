'use strict';

// Preload for the local, trusted Settings window. Exposes a tiny bridge to read
// and update the desktop preferences (launch at login, tray behaviour) — no fs,
// no shell, no Node — so the page itself stays unprivileged.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicarrSettings', {
  // Returns the current settings:
  //   { launchAtLogin, startMinimized, minimizeToTray, canLaunchAtLogin }.
  get: () => ipcRenderer.invoke('settings:get'),
  // Apply a partial update; returns the full, updated settings object.
  set: (partial) => ipcRenderer.invoke('settings:set', partial),
});
