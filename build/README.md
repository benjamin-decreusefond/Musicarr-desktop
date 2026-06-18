# Build resources

`electron-builder` picks up packaging assets from this directory.

The brand mark is Musicarr's logo — the same one the web server uses (a lime
rounded square with a dark vertical bar). It lives in [`icon.svg`](./icon.svg),
and the raster icons electron-builder ships are generated from it:

- `icon.ico` — Windows app + installer icon (16–256 px)
- `icon.png` — Linux app icon (512×512) and electron-builder source
- `tray.png` — system-tray icon (32×32)

These are committed so the build is self-contained. Regenerate them after
changing the logo with:

```bash
npm run icons      # runs build/generate-icons.js (no external dependencies)
```

`generate-icons.js` rasterizes the vector logo directly (anti-aliased), encodes
PNGs via Node's built-in zlib, and assembles the multi-size `.ico` — no
ImageMagick/rsvg/sharp needed.

> macOS builds additionally want an `icon.icns`; add one here if you target mac.
