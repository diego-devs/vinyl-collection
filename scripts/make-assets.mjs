/**
 * Generates PWA icons and synthetic test fixtures without external dependencies.
 *   npm run assets
 * Fixtures are synthetic (no real album art, no personal data).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, pixel) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b] = pixel(x, y);
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = r;
      raw[o + 1] = g;
      raw[o + 2] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const PAPER = [0xf5, 0xef, 0xe4];
const INK = [0x2a, 0x21, 0x1b];
const GROOVE = [0x3a, 0x2f, 0x27];
const ACCENT = [0x9a, 0x3b, 0x1f];

/** A vinyl record centered on paper; `pad` keeps it inside the maskable safe zone. */
function recordIcon(size, pad) {
  const c = size / 2;
  const R = size / 2 - pad;
  return encodePng(size, size, (x, y) => {
    const d = Math.hypot(x + 0.5 - c, y + 0.5 - c);
    if (d > R) return PAPER;
    if (d < R * 0.06) return PAPER;
    if (d < R * 0.34) return ACCENT;
    const ring = Math.floor((d / R) * 26) % 2 === 0;
    return ring ? INK : GROOVE;
  });
}

mkdirSync("public", { recursive: true });
writeFileSync("public/icon-192.png", recordIcon(192, 22));
writeFileSync("public/icon-512.png", recordIcon(512, 58));
writeFileSync("public/apple-touch-icon.png", recordIcon(180, 14));

/** Synthetic "cover photo": a colored square on a table, slightly offset, with stripes as fake art. */
function syntheticCover(w, h, seed) {
  const colors = [
    [0x1f, 0x4e, 0x79],
    [0xc0, 0x39, 0x2b],
    [0x27, 0xae, 0x60],
  ];
  const col = colors[seed % colors.length];
  const side = Math.round(Math.min(w, h) * 0.7);
  const x0 = Math.round((w - side) / 2) + seed * 7;
  const y0 = Math.round((h - side) / 2);
  return encodePng(w, h, (x, y) => {
    const inside = x >= x0 && x < x0 + side && y >= y0 && y < y0 + side;
    if (!inside) return [0x8b, 0x6b, 0x4a]; // table
    const band = Math.floor(((y - y0) / side) * 8);
    if (band === 2 && x > x0 + side * 0.1 && x < x0 + side * 0.9) return [0xff, 0xff, 0xff];
    return band % 2 ? col : col.map((v) => Math.min(255, v + 40));
  });
}

mkdirSync("tests/fixtures", { recursive: true });
writeFileSync("tests/fixtures/cover-a.png", syntheticCover(800, 600, 0));
writeFileSync("tests/fixtures/cover-b.png", syntheticCover(600, 800, 1));
writeFileSync("tests/fixtures/not-an-image.png", Buffer.from("esto no es una imagen\n"));
console.log("Iconos en public/ y fixtures en tests/fixtures/ generados.");
