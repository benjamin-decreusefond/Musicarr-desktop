'use strict';

// Custom title bar renderer. Talks to main only through the safe
// `window.musicarrChrome` bridge from titlebar-preload.js.

const api = window.musicarrChrome;

const switchBtn = document.getElementById('switch');
const hostEl = document.getElementById('host');
const minBtn = document.getElementById('min');
const maxBtn = document.getElementById('max');
const maxIcon = document.getElementById('maxIcon');
const closeBtn = document.getElementById('close');
const dragEl = document.getElementById('drag');

const MAX_GLYPH = '<rect x="2.5" y="2.5" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.2"/>';
// "Restore" glyph: two overlapping squares.
const RESTORE_GLYPH =
  '<rect x="3.5" y="1.5" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.1"/>' +
  '<rect x="1.5" y="3.5" width="6" height="6" fill="none" stroke="var(--bg)" stroke-width="2.4"/>' +
  '<rect x="1.5" y="3.5" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1.1"/>';

minBtn.addEventListener('click', () => api.minimize());
maxBtn.addEventListener('click', () => api.toggleMaximize());
closeBtn.addEventListener('click', () => api.close());
switchBtn.addEventListener('click', () => api.switchServer());
// Double-clicking the empty drag area maximizes/restores, like a native bar.
dragEl.addEventListener('dblclick', () => api.toggleMaximize());

api.onState((state) => {
  if (state.connected && state.host) {
    hostEl.textContent = state.host;
    switchBtn.classList.remove('hidden');
  } else {
    switchBtn.classList.add('hidden');
  }
  maxIcon.innerHTML = state.maximized ? RESTORE_GLYPH : MAX_GLYPH;
  maxBtn.title = state.maximized ? 'Restore' : 'Maximize';
});

// Ask main for the current state once we're ready to render it.
api.requestState();
