// Generates the PWA / home-screen icons with zero dependencies (hand-rolled PNG
// encoder over node's zlib). Matches the in-game look: neon cyan ship + pink
// ring on the void background. Run: node tools/make-icons.js
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ---- minimal PNG encoder (8-bit RGBA, filter 0) ----
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
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePNG(size, rgba) {
  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type: RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---- icon art ----
function inPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function makeIcon(size) {
  const rgba = Buffer.alloc(size * size * 4);
  const set = (x, y, r, g, b, a = 1) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    rgba[i] = Math.round(rgba[i] * (1 - a) + r * a);
    rgba[i + 1] = Math.round(rgba[i + 1] * (1 - a) + g * a);
    rgba[i + 2] = Math.round(rgba[i + 2] * (1 - a) + b * a);
    rgba[i + 3] = 255;
  };

  // void background
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) set(x, y, 4, 4, 10);

  // deterministic starfield
  let seed = 1337;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(rnd() * size), y = Math.floor(rnd() * size);
    const bright = rnd();
    const [r, g, b] = bright > 0.7 ? [191, 232, 255] : [95, 127, 168];
    set(x, y, r, g, b, 0.4 + bright * 0.5);
    if (bright > 0.85 && size >= 192) set(x + 1, y, r, g, b, 0.5);
  }

  const c = size / 2;
  // the ship shape from the game, scaled up: (16,0)(-10,-10)(-5,0)(-10,10)
  const s = size / 48;
  const shipPts = [[16, 0], [-10, -10], [-5, 0], [-10, 10]].map(([x, y]) => [c + x * s, c + y * s]);
  const innerPts = [[16, 0], [-10, -10], [-5, 0], [-10, 10]].map(([x, y]) => [c + x * s * 0.6, c + y * s * 0.6]);

  const ringR = size * 0.37, ringTh = size * 0.022;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      // pink ring with soft edges
      const dr = Math.abs(d - ringR);
      if (dr < ringTh) set(x, y, 255, 34, 85, 0.9 * (1 - dr / ringTh));
      // cyan glow halo behind the ship
      if (d < size * 0.30) set(x, y, 125, 249, 255, 0.10 * (1 - d / (size * 0.30)));
      // ship: cyan hull with dark core
      if (inPoly(x, y, shipPts)) {
        if (inPoly(x, y, innerPts)) set(x, y, 12, 34, 51);
        else set(x, y, 125, 249, 255);
      }
    }
  }
  // cockpit dot
  const ck = { x: c + 4 * s, y: c, r: Math.max(2, 3 * s * 0.6) };
  for (let y = Math.floor(ck.y - ck.r); y <= ck.y + ck.r; y++)
    for (let x = Math.floor(ck.x - ck.r); x <= ck.x + ck.r; x++)
      if (Math.hypot(x - ck.x, y - ck.y) <= ck.r) set(x, y, 125, 249, 255);

  return encodePNG(size, rgba);
}

const outDir = path.join(__dirname, "..", "icons");
fs.mkdirSync(outDir, { recursive: true });
for (const size of [180, 192, 512]) {
  const file = path.join(outDir, `icon-${size}.png`);
  fs.writeFileSync(file, makeIcon(size));
  console.log("wrote", file);
}
