# Musicarr Desktop

A native **Windows** (and macOS/Linux) desktop client for a self-hosted
[Musicarr](https://github.com/benjamin-decreusefond/musicarr) server.

## Download & install (Windows)

Grab the latest installer from the
[**Releases**](https://github.com/benjamin-decreusefond/Musicarr-desktop/releases/latest)
page — download `Musicarr-Setup-<version>.exe`, run it, then launch **Musicarr**
and enter your server address. That's the whole setup.

The installer is a standard NSIS wizard (choose install location, desktop/start-menu
shortcuts). Each release is built automatically by CI — see
[Releasing](#releasing) below.

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
| **Auto-update** | Checks GitHub Releases, downloads new versions in the background (differential) and installs on restart — no re-downloading installers. |
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

## Auto-update

The installed app keeps **itself** up to date — no re-downloading installers.
Powered by [`electron-updater`](https://www.electron.build/auto-update):

- On launch and every few hours it checks the repo's GitHub Releases for a newer
  version (anonymously — the repo is public), reading the `latest.yml` the
  release workflow publishes.
- A new version downloads in the background, **differentially** (only the changed
  blocks, via the `.blockmap`), then prompts **Restart now / Later**. On restart
  it installs silently — no NSIS wizard.
- You can also trigger a check from **Help → Check for Updates…**.

Auto-update only runs in the installed app; in dev (`npm start`) it's a no-op.
Because the release pipeline already attaches `latest.yml`/`.blockmap` to every
release, **publishing a new version is all it takes** for existing installs to
pick it up. (Windows auto-update works even though the build is unsigned; signing
would only remove the first-install SmartScreen prompt.)

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

## CI & releasing

Two workflows drive the build:

- **`build.yml`** — runs on every push/PR: lints the sources and builds the
  Windows installer on `windows-latest`, uploading it as a workflow **artifact**
  (handy for testing a branch).
- **`release.yml`** — runs when you push a **version tag** (`v*`) or trigger it
  manually: builds the installer and publishes it to a public **GitHub Release**
  so end users can download it straight from the
  [Releases](https://github.com/benjamin-decreusefond/Musicarr-desktop/releases)
  page (no Actions login required).
- **`auto-release.yml`** — **fully automatic, label-driven releases**: when a PR
  is merged into `main`, it bumps the version, tags it, and builds + publishes
  the installer — no manual tagging at all (see below).

### Automatic releases on merge (recommended)

Add **one** of these labels to a PR before merging it and a release is cut
automatically when the PR lands on `main`:

| PR label | Version bump | Use for |
|---|---|---|
| `major` | `X+1.0.0` | breaking changes |
| `minor` | `x.Y+1.0` | new features |
| `patch` | `x.y.Z+1` | fixes (also the **default** if no label is set) |
| `no-release` | — | skip releasing for this PR |

On merge, `auto-release.yml` bumps `package.json`, commits + tags `vX.Y.Z`, then
builds `Musicarr-Setup-<version>.exe` and publishes the GitHub Release. A tag
pushed by CI's `GITHUB_TOKEN` can't trigger another workflow, so this one does
the build itself rather than handing off to `release.yml`.

> One-time setup: make sure the `major` / `minor` / `patch` (and optional
> `no-release`) **labels exist** in the repo (Issues → Labels), and that `main`
> allows the Actions bot to push the bump commit (no branch protection blocking
> it, or an exception for `github-actions[bot]`).

### Manual releasing

If you'd rather tag by hand (no label needed), `release.yml` still works:

```bash
npm version patch          # bumps package.json (1.0.0 -> 1.0.1) and creates the git tag
git push --follow-tags     # pushes the commit + tag; the tag triggers release.yml
```

`release.yml` then builds `Musicarr-Setup-<version>.exe` and attaches it (plus
`latest.yml`/`.blockmap` for future auto-update support) to a GitHub Release
named after the tag, with auto-generated release notes. You can also run the
workflow manually from the **Actions** tab and supply a tag.

> All release workflows use the built-in `GITHUB_TOKEN`, so no extra secrets are
> needed. (Code-signing the installer would require your own certificate; the
> unsigned installer triggers a one-time Windows SmartScreen prompt.)

## Requirements

- Node.js 18+ and npm (for development/building)
- A reachable Musicarr server (e.g. `https://musicarr.example.com`)
- Windows 10/11 to run the produced installer (macOS/Linux targets also available)
