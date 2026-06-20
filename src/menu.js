'use strict';

// Builds the native application menu. Rebuilt whenever the connection state
// changes so the "Recent servers" submenu and the connected/disconnected items
// stay accurate.

const { Menu, shell, dialog } = require('electron');

function buildAppMenu(ctx) {
  const { app, window, store, isConnected, onDisconnect, onReload, onZoom, onConnectTo, onOpenSettings, onCheckForUpdates } = ctx;
  const isMac = process.platform === 'darwin';

  const recents = (store.get('servers') || []).map((s) => ({
    label: s.name || s.url,
    click: () => onConnectTo(s.url),
  }));

  const currentZoom = () => (window && !window.isDestroyed() ? window.webContents.getZoomFactor() : 1);

  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'Server',
      submenu: [
        {
          label: 'Settings…',
          accelerator: 'CmdOrCtrl+,',
          click: () => { if (onOpenSettings) onOpenSettings(); },
        },
        { type: 'separator' },
        {
          label: 'Switch server…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => onDisconnect(),
        },
        {
          label: 'Reconnect',
          accelerator: 'CmdOrCtrl+R',
          enabled: isConnected,
          click: () => onReload(),
        },
        { type: 'separator' },
        {
          label: 'Recent servers',
          enabled: recents.length > 0,
          submenu: recents.length > 0 ? recents : [{ label: 'None', enabled: false }],
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          accelerator: 'CmdOrCtrl+Plus',
          click: () => onZoom(Math.min(currentZoom() + 0.1, 3)),
        },
        {
          label: 'Zoom Out',
          accelerator: 'CmdOrCtrl+-',
          click: () => onZoom(Math.max(currentZoom() - 0.1, 0.5)),
        },
        {
          label: 'Reset Zoom',
          accelerator: 'CmdOrCtrl+0',
          click: () => onZoom(1),
        },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Check for Updates…',
          click: () => { if (onCheckForUpdates) onCheckForUpdates(); },
        },
        { type: 'separator' },
        {
          label: 'Musicarr on GitHub',
          click: () => shell.openExternal('https://github.com/benjamin-decreusefond/musicarr'),
        },
        {
          label: 'About Musicarr Desktop',
          click: () => {
            dialog.showMessageBox(window, {
              type: 'info',
              title: 'Musicarr Desktop',
              message: 'Musicarr Desktop',
              detail:
                `Version ${app.getVersion()}\n` +
                'A native desktop client for a self-hosted Musicarr server.\n' +
                'All playback, search and downloads happen on the server you connect to.',
              buttons: ['OK'],
            });
          },
        },
      ],
    },
  ];

  return Menu.buildFromTemplate(template);
}

module.exports = { buildAppMenu };
