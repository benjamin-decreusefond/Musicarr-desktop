'use strict';

// Renderer for the connect screen. Talks to the main process only through the
// safe `window.musicarr` bridge exposed by the preload — no Node here.

const form = document.getElementById('connect-form');
const input = document.getElementById('server');
const button = document.getElementById('connect-btn');
const status = document.getElementById('status');
const banner = document.getElementById('banner');
const recentsBox = document.getElementById('recents');
const recentsList = document.getElementById('recents-list');

// Surface a message passed by the main process (e.g. "couldn't reach last server").
function showStartupBanner() {
  const params = new URLSearchParams(window.location.search);
  const message = params.get('message');
  if (message) {
    banner.textContent = message;
    banner.hidden = false;
  }
}

function setStatus(text, isError) {
  status.textContent = text || '';
  status.classList.toggle('error', !!isError);
}

function setBusy(busy) {
  button.disabled = busy;
  input.disabled = busy;
  button.textContent = busy ? 'Connecting…' : 'Connect';
}

async function connect(url) {
  if (!url || !url.trim()) {
    setStatus('Enter a server address', true);
    return;
  }
  setBusy(true);
  setStatus('Checking server…');
  try {
    const result = await window.musicarr.connect(url);
    if (!result || !result.ok) {
      setStatus((result && result.error) || 'Could not connect', true);
      setBusy(false);
    }
    // On success the main process navigates the window away; nothing to do.
  } catch (err) {
    setStatus(err && err.message ? err.message : 'Could not connect', true);
    setBusy(false);
  }
}

function renderRecents(servers, current) {
  recentsList.innerHTML = '';
  if (!servers || servers.length === 0) {
    recentsBox.hidden = true;
    return;
  }
  recentsBox.hidden = false;
  for (const server of servers) {
    const li = document.createElement('li');
    li.className = 'recent';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = server.name || server.url;
    name.title = server.url;
    name.addEventListener('click', () => connect(server.url));

    const forget = document.createElement('button');
    forget.className = 'forget';
    forget.type = 'button';
    forget.textContent = '×';
    forget.title = 'Remove from recents';
    forget.addEventListener('click', async (e) => {
      e.stopPropagation();
      const updated = await window.musicarr.forgetServer(server.url);
      renderRecents(updated.servers, updated.current);
    });

    li.appendChild(name);
    li.appendChild(forget);
    recentsList.appendChild(li);
  }

  // Pre-fill the input with the most recent server for one-tap reconnects.
  if (current && !input.value) input.value = current;
  else if (servers[0] && !input.value) input.value = servers[0].url;
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  connect(input.value);
});

async function init() {
  showStartupBanner();
  try {
    const { servers, current } = await window.musicarr.listServers();
    renderRecents(servers, current);
  } catch {
    /* first run / no config — leave the form empty */
  }
  input.focus();
}

init();
