import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';

function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

const M = [
  'X...X',
  'XX.XX',
  'X.X.X',
  'X.X.X',
  'X...X',
  'X...X',
  'X...X',
];

function roundedRect(x, y, w, h, r) {
  const cx = Math.max(Math.min(x, w - r), r);
  const cy = Math.max(Math.min(y, h - r), r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function png(size) {
  const rows = Buffer.alloc(size * (size * 4 + 1));
  const pad = size * 0.06;
  const r = size * 0.2;
  const gw = size * 0.52, gh = size * 0.62;
  const gx0 = (size - gw) / 2, gy0 = (size - gh) / 2;
  const cw = gw / 5, ch = gh / 7;
  for (let y = 0; y < size; y++) {
    const ro = y * (size * 4 + 1);
    rows[ro] = 0;
    for (let x = 0; x < size; x++) {
      const o = ro + 1 + x * 4;
      const inside =
        x >= pad && x < size - pad && y >= pad && y < size - pad &&
        roundedRect(x - pad, y - pad, size - 2 * pad, size - 2 * pad, r);
      if (!inside) continue;
      let isM = false;
      const mx = (x - gx0) / cw, my = (y - gy0) / ch;
      if (mx >= 0 && mx < 5 && my >= 0 && my < 7) {
        isM = M[Math.floor(my)][Math.floor(mx)] === 'X';
      }
      if (isM) { rows[o] = 235; rows[o + 1] = 238; rows[o + 2] = 245; }
      else { rows[o] = 24; rows[o + 1] = 26; rows[o + 2] = 32; }
      rows[o + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync('public/icon', { recursive: true });
for (const s of [16, 32, 48, 128]) {
  writeFileSync(`public/icon/${s}.png`, png(s));
  console.log(`wrote public/icon/${s}.png`);
}
