'use strict';

// The preload runs in an isolated world and is the ONLY bridge between the
// renderer and the main process. It exposes a deliberately tiny, non-privileged
// API (server discovery/connect) — no fs, no shell, no Node — so that even the
// remote server web app, which shares this preload, gains nothing dangerous.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('musicarr', {
  // Returns { servers: [{ url, name, lastUsedAt }], current }.
  listServers: () => ipcRenderer.invoke('servers:list'),
  // Probe a server without switching to it. Returns { ok, url?, error? }.
  testServer: (url) => ipcRenderer.invoke('servers:test', url),
  // Test then, on success, navigate the window to the server. Returns same shape.
  connect: (url) => ipcRenderer.invoke('servers:connect', url),
  // Drop a saved server from the recents list. Returns the updated list.
  forgetServer: (url) => ipcRenderer.invoke('servers:forget', url),
});
