# Musicarr Desktop

A native **Windows** (and macOS/Linux) desktop client for a self-hosted
[Musicarr](https://github.com/benjamin-decreusefond/musicarr) server.

Musicarr Desktop does **nothing on its own** — it has no Deezer, Soulseek/slskd
or database logic of its own. It is a thin, hardened [Electron](https://www.electronjs.org/)
shell that connects to a Musicarr **web server** you run and presents that
server's full web experience in a native window. Because it loads the server's
own UI, it has **complete feature parity** with the web app automatically:
search & browse (Deezer metadata), download via Soulseek, stream & listen,
playlists (including shared/collaborative), favorites, history, your stats,
made-for-you mixes, radio, listen-together, following artists, lyrics, and the
admin/settings pages — all driven by the server.

On top of the web app it adds the things a browser tab can't:

| Native feature | What it does |
|---|---|
| **Connect screen** | Pick/enter a server URL; validates it against the server's `/health` endpoint before connecting. |
| **Multi-server** | Remembers recent servers; one-click reconnect and a **Server → Switch server** menu (`Ctrl+Shift+S`). |
| **Auto-reconnect** | Reopens your last server on launch (falls back to the picker if it's unreachable). |
| **Persistent login** | Uses the same cookie session as the web app, kept in the app's own profile, so you stay signed in across restarts. |
| **Media keys** | Hardware play/pause/next/previous keys drive playback via the web app's Media Session integration. |
| **Window state** | Remembers window size/position and zoom level. |
| **Tray icon** | Quick show/quit from the system tray. |
| **Native menus** | Zoom, full-screen, reload, dev tools, external links open in your real browser. |

## How it works

1. The app opens a **Connect** screen. Enter your server address
   (`https://musicarr.example.com` — `http://` LAN servers work too).
2. It probes `GET /health` on that server. If the server answers, the window
   navigates to the server origin and loads the Musicarr web app.
3. You sign in exactly like the web UI. The session cookie is stored in the
   app's profile, so subsequent launches reconnect automatically.
4. Everything else — search, downloads, streaming, playlists, listen-together —
   is the server doing the work; the desktop app is just the window.

Switching servers (or signing into a different one) is **Server → Switch
server** in the menu, or `Ctrl+Shift+S`.

## Security model

The remote server UI is treated as untrusted web content:

- `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- The preload exposes only a tiny, non-privileged bridge (list/test/connect/forget
  server) — no file system, shell, or Node APIs reach the page.
- Navigations away from the connected server origin open in your **default
  browser** instead of inside the app; the app never spawns extra windows.

Connect only to Musicarr servers you trust, and prefer HTTPS in production.

## Development

```bash
npm install
npm start            # launch the app against your dev/prod server
npm run lint         # syntax-check main/preload/renderer sources
```

## Building installers

[`electron-builder`](https://www.electron.build/) produces installers:

```bash
npm run dist:win     # Windows NSIS installer  -> dist/Musicarr-Setup-<version>.exe
npm run dist:mac     # macOS dmg
npm run dist:linux   # Linux AppImage
npm run pack         # unpacked build for quick local testing
```

App/installer icons are optional and live in [`build/`](./build/README.md); the
build works out of the box with Electron's default icon until you add your own.

CI (`.github/workflows/build.yml`) lints on every push/PR and builds the
Windows installer on `windows-latest`, uploading it as a workflow artifact.

## Requirements

- Node.js 18+ and npm (for development/building)
- A reachable Musicarr server (e.g. `https://musicarr.example.com`)
- Windows 10/11 to run the produced installer (macOS/Linux targets also available)
