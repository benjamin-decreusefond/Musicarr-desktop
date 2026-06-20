'use strict';

// Renderer for the Settings window. Talks to the main process only through the
// safe `window.musicarrSettings` bridge from settings-preload.js — no Node here.

const api = window.musicarrSettings;

const launchAtLogin = document.getElementById('launchAtLogin');
const startMinimized = document.getElementById('startMinimized');
const minimizeToTray = document.getElementById('minimizeToTray');
const status = document.getElementById('status');

function setStatus(text, isError) {
  status.textContent = text || '';
  status.classList.toggle('error', !!isError);
}

// Reflect the canonical settings (read back from the main process) into the UI.
function render(settings) {
  launchAtLogin.checked = !!settings.launchAtLogin;
  startMinimized.checked = !!settings.startMinimized;
  minimizeToTray.checked = !!settings.minimizeToTray;

  // Launch-at-login isn't manageable on some platforms (e.g. Linux); disable the
  // toggles that depend on it and explain why.
  if (!settings.canLaunchAtLogin) {
    launchAtLogin.checked = false;
    launchAtLogin.disabled = true;
    launchAtLogin.closest('.row').classList.add('disabled');
    setStatus('Launch at login isn’t available on this platform.');
  }

  // "Start hidden" only makes sense when the app launches itself at login.
  const canHide = settings.canLaunchAtLogin && settings.launchAtLogin;
  startMinimized.disabled = !canHide;
  startMinimized.closest('.row').classList.toggle('disabled', !canHide);
}

async function apply(partial) {
  try {
    const updated = await api.set(partial);
    render(updated);
  } catch (err) {
    setStatus((err && err.message) || 'Could not save settings', true);
  }
}

launchAtLogin.addEventListener('change', () => apply({ launchAtLogin: launchAtLogin.checked }));
startMinimized.addEventListener('change', () => apply({ startMinimized: startMinimized.checked }));
minimizeToTray.addEventListener('change', () => apply({ minimizeToTray: minimizeToTray.checked }));

async function init() {
  try {
    render(await api.get());
  } catch (err) {
    setStatus((err && err.message) || 'Could not load settings', true);
  }
}

init();
