# Build resources

`electron-builder` picks up packaging assets from this directory.

The brand mark lives in [`icon.svg`](./icon.svg). For installer/app icons,
drop the rendered raster versions here and `electron-builder` will use them
automatically:

- `icon.ico` — Windows app + installer icon (multi-size, 256×256 recommended)
- `icon.icns` — macOS app icon
- `icon.png` — Linux app icon (512×512)
- `tray.png` — small monochrome-ish tray icon (16/32px); optional, the app
  falls back to a built-in placeholder if absent.

Generate them from `icon.svg` with any tool you like, e.g.:

```bash
# requires rsvg-convert + ImageMagick / png2icns / electron-icon-builder
rsvg-convert -w 1024 -h 1024 icon.svg -o icon.png
npx electron-icon-builder --input=icon.png --output=. --flatten
```

Until raster icons are added the app and installer build fine using
Electron's default icon — they are purely cosmetic.
