'use strict';

// Preload for the custom title bar (the window's own trusted page). Exposes a
// tiny bridge for window controls and the in-app "Switch server" action, plus a
// channel to receive connection/window state from the main process.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicarrChrome', {
  minimize: () => ipcRenderer.send('chrome:minimize'),
  toggleMaximize: () => ipcRenderer.send('chrome:maximize-toggle'),
  close: () => ipcRenderer.send('chrome:close'),
  switchServer: () => ipcRenderer.send('chrome:switch-server'),
  openSettings: () => ipcRenderer.send('chrome:open-settings'),
  // Ask main to push the current state (used on first paint).
  requestState: () => ipcRenderer.send('chrome:ready'),
  // { connected, host, maximized }
  onState: (cb) => ipcRenderer.on('titlebar:state', (_e, state) => cb(state)),
});
