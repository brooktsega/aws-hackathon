// Generates the toolbar/notification icons (a white check mark on a blue rounded square)
// without any image dependency. Run: npm run icons. The PNGs are committed.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const BLUE = [11, 87, 208];
const WHITE = [255, 255, 255];
const SS = 4; // supersampling per axis

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function insideRoundedSquare(x, y, size, radius) {
  const cx = Math.min(Math.max(x, radius), size - radius);
  const cy = Math.min(Math.max(y, radius), size - radius);
  return Math.hypot(x - cx, y - cy) <= radius;
}

function render(size) {
  const radius = size * 0.22;
  const stroke = size * 0.095;
  // Check mark in unit coordinates, scaled to the icon.
  const p1 = [0.27, 0.53], p2 = [0.44, 0.69], p3 = [0.74, 0.34];
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let bg = 0, fg = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          if (!insideRoundedSquare(px, py, size, radius)) continue;
          bg++;
          const d = Math.min(
            distToSegment(px, py, p1[0] * size, p1[1] * size, p2[0] * size, p2[1] * size),
            distToSegment(px, py, p2[0] * size, p2[1] * size, p3[0] * size, p3[1] * size),
          );
          if (d <= stroke / 2) fg++;
        }
      }
      const total = SS * SS;
      const alpha = bg / total;
      const mix = bg === 0 ? 0 : fg / bg;
      const i = y * (size * 4 + 1) + 1 + x * 4;
      for (let c = 0; c < 3; c++) raw[i + c] = Math.round(BLUE[c] * (1 - mix) + WHITE[c] * mix);
      raw[i + 3] = Math.round(alpha * 255);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [16, 32, 48, 128]) {
  writeFileSync(resolve(out, `icon-${size}.png`), render(size));
}
console.log('Wrote icons to', out);
