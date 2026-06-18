'use strict';

// Generates the app icons from Musicarr's logo — the same mark the web server
// uses (a lime rounded square with a dark vertical bar). Dependency-free: it
// rasterizes the simple vector shapes directly (with 4×4 supersampled
// anti-aliasing), encodes PNG via the built-in zlib, and assembles a multi-size
// .ico. Re-run with `npm run icons` after changing the logo.
//
// Outputs (into build/):
//   icon.png  512×512  — Linux app icon / electron-builder source
//   icon.ico  16–256   — Windows app + installer icon
//   tray.png  32×32    — system-tray icon

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

// Logo geometry in a 32×32 viewBox (mirrors web/src/favicon.svg).
const LIME = [201, 242, 77];   // #c9f24d
const INK = [17, 20, 10];      // #11140a
const BG = { x: 0, y: 0, w: 32, h: 32, r: 7 };
const BAR = { x: 13, y: 8.5, w: 6, h: 15, r: 1.5 };

// Is point (px,py) inside a rounded rect? (coordinates in 32-space)
function inRoundedRect(px, py, R) {
  if (px < R.x || px >= R.x + R.w || py < R.y || py >= R.y + R.h) return false;
  const nx = Math.max(R.x + R.r, Math.min(px, R.x + R.w - R.r));
  const ny = Math.max(R.y + R.r, Math.min(py, R.y + R.h - R.r));
  const dx = px - nx;
  const dy = py - ny;
  return dx * dx + dy * dy <= R.r * R.r;
}

// Render the logo to an RGBA buffer at the given pixel size.
function render(size) {
  const SS = 4; // supersampling factor per axis
  const data = Buffer.alloc(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let covered = 0;
      for (let sj = 0; sj < SS; sj++) {
        for (let si = 0; si < SS; si++) {
          const fx = ((i + (si + 0.5) / SS) / size) * 32;
          const fy = ((j + (sj + 0.5) / SS) / size) * 32;
          let c = null;
          if (inRoundedRect(fx, fy, BAR)) c = INK;
          else if (inRoundedRect(fx, fy, BG)) c = LIME;
          if (c) { r += c[0]; g += c[1]; b += c[2]; covered++; }
        }
      }
      const samples = SS * SS;
      const o = (j * size + i) * 4;
      if (covered > 0) {
        data[o] = Math.round(r / covered);
        data[o + 1] = Math.round(g / covered);
        data[o + 2] = Math.round(b / covered);
        data[o + 3] = Math.round((covered / samples) * 255);
      } // else fully transparent (zeroed)
    }
  }
  return data;
}

// --- PNG encoding -----------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(size, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  // bytes 10-12 (compression, filter, interlace) are already 0
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))]);
}

// --- ICO encoding (PNG-compressed entries) ----------------------------------

function encodeICO(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + 16 * entries.length;
  entries.forEach((e, idx) => {
    const d = dir.subarray(idx * 16);
    d[0] = e.size >= 256 ? 0 : e.size; // width (0 == 256)
    d[1] = e.size >= 256 ? 0 : e.size; // height
    d[2] = 0; // palette
    d[3] = 0; // reserved
    d.writeUInt16LE(1, 4);   // color planes
    d.writeUInt16LE(32, 6);  // bits per pixel
    d.writeUInt32LE(e.png.length, 8);
    d.writeUInt32LE(offset, 12);
    offset += e.png.length;
  });

  return Buffer.concat([header, dir, ...entries.map((e) => e.png)]);
}

// --- main -------------------------------------------------------------------

function pngFor(size) {
  return encodePNG(size, render(size));
}

const outDir = __dirname;
const icoSizes = [16, 32, 48, 64, 128, 256];

fs.writeFileSync(path.join(outDir, 'icon.png'), pngFor(512));
fs.writeFileSync(path.join(outDir, 'tray.png'), pngFor(32));
fs.writeFileSync(
  path.join(outDir, 'icon.ico'),
  encodeICO(icoSizes.map((size) => ({ size, png: pngFor(size) })))
);

console.log('Wrote build/icon.png (512), build/tray.png (32), build/icon.ico (' + icoSizes.join(',') + ')');
