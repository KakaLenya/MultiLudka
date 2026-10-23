// Иконки PWA: золотая фишка на тёмном сукне. Рисует попиксельно с суперсэмплингом
// и пишет PNG через zlib — без зависимостей. Запуск: node scripts/make-icons.js
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const OUT = path.join(__dirname, '..', 'public', 'icons');
const SS = 4; // сэмплов на пиксель по каждой оси

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const C = {
  bg: hex('#07130d'), felt: hex('#0f3d26'), felt2: hex('#0b2e1d'),
  goldHi: hex('#ffe39a'), gold: hex('#f2c14e'), goldLo: hex('#c98f22'),
  ink: hex('#06100b'), cream: hex('#f3efe2'),
};

// Пятиконечная звезда: внешний радиус 1, внутренний 0.42.
const STAR = Array.from({ length: 10 }, (_, i) => {
  const a = -Math.PI / 2 + i * Math.PI / 5;
  const r = i % 2 ? 0.42 : 1;
  return [Math.cos(a) * r, Math.sin(a) * r];
});
// Шестерёнка админки: 8 зубцов, отверстие в центре (координаты в радиусах символа).
function inGear(x, y) {
  const d = Math.hypot(x, y);
  if (d < 0.32) return false;
  const a = (Math.atan2(y, x) + Math.PI * 2) % (Math.PI / 4);
  const tooth = Math.abs(a - Math.PI / 8) < 0.2;
  return d < (tooth ? 1 : 0.74);
}
function inPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Цвет сэмпла (u, v в [-1, 1]); null — прозрачно. opts: chip — радиус фишки, rounded — скругление фона.
function sample(u, v, opts) {
  if (opts.rounded) {
    const k = opts.rounded, ax = Math.max(Math.abs(u) - (1 - k), 0), ay = Math.max(Math.abs(v) - (1 - k), 0);
    if (ax * ax + ay * ay > k * k) return null;
  }
  const d = Math.hypot(u, v);
  const R = opts.chip;
  // Сукно с золотым бликом сверху и тенью под фишкой.
  let col = mix(C.felt, C.bg, Math.min(1, Math.hypot(u, v + 0.35) / 1.5));
  col = mix(col, C.gold, Math.max(0, 0.12 - Math.hypot(u, v + 1.1) * 0.1));
  const sh = Math.hypot(u, v - R * 0.08) / R;
  if (sh < 1.12) col = mix(col, C.ink, 0.55 * Math.min(1, (1.12 - sh) / 0.14));
  if (d > R) return col;
  const r = d / R;
  const goldAt = (t) => (t < 0.5 ? mix(C.goldHi, C.gold, t * 2) : mix(C.gold, C.goldLo, (t - 0.5) * 2));
  const vert = (v / R + 1) / 2; // 0 сверху, 1 снизу
  if (r > 0.97) return goldAt(Math.min(1, vert + 0.25));
  if (r > 0.76) {
    // Кромка фишки: золото с восемью тёмными вставками.
    const a = (Math.atan2(v, u) + Math.PI * 2 + Math.PI / 8) % (Math.PI / 4);
    if (r > 0.8 && r < 0.95 && Math.abs(a - Math.PI / 8) < 0.17) return mix(C.felt2, C.ink, 0.3);
    return goldAt(vert);
  }
  if (r > 0.72) return C.ink;
  // Внутренний круг: сукно, тонкое золотое кольцо и звезда.
  if (r > 0.62 && r < 0.655) return goldAt(vert * 0.6 + 0.2);
  const sr = 0.5 * R;
  const mark = opts.admin ? inGear(u / sr, v / sr) : inPoly(u / sr, (v + R * 0.02) / sr, STAR);
  if (mark) return goldAt(Math.min(1, (v / sr + 1) / 2));
  return mix(C.felt, C.felt2, r / 0.72);
}

function render(size, opts) {
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const u = ((x + (sx + 0.5) / SS) / size) * 2 - 1;
          const v = ((y + (sy + 0.5) / SS) / size) * 2 - 1;
          const c = sample(u, v, opts);
          if (!c) continue;
          r += c[0]; g += c[1]; b += c[2]; a++;
        }
      }
      const i = (y * size + x) * 4;
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
      px[i + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  return png(size, px);
}

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function png(size, px) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8 бит, RGBA
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) px.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
// ICO с PNG внутри (поддерживают все современные браузеры).
function ico(pngBuf, size) {
  const head = Buffer.alloc(22);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  head[6] = size; head[7] = size; head.writeUInt16LE(1, 10); head.writeUInt16LE(32, 12);
  head.writeUInt32LE(pngBuf.length, 14); head.writeUInt32LE(22, 18);
  return Buffer.concat([head, pngBuf]);
}

fs.mkdirSync(OUT, { recursive: true });
const write = (name, buf) => { fs.writeFileSync(path.join(OUT, name), buf); console.log(name, buf.length); };
write('icon-192.png', render(192, { chip: 0.74, rounded: 0.36 }));
write('icon-512.png', render(512, { chip: 0.74, rounded: 0.36 }));
write('maskable-512.png', render(512, { chip: 0.6 }));            // безопасная зона — круг 80%
write('apple-touch-icon.png', render(180, { chip: 0.7 }));        // iOS скругляет сам, без прозрачности
// Админка — та же фишка, но с шестерёнкой: на панели задач не спутать с залом.
write('admin-192.png', render(192, { chip: 0.74, rounded: 0.36, admin: true }));
write('admin-512.png', render(512, { chip: 0.74, rounded: 0.36, admin: true }));
write('admin-maskable-512.png', render(512, { chip: 0.6, admin: true }));
write('admin-favicon-32.png', render(32, { chip: 0.96, rounded: 0.3, admin: true }));
const fav = render(32, { chip: 0.96, rounded: 0.3 });
write('favicon-32.png', fav);
fs.writeFileSync(path.join(OUT, '..', 'favicon.ico'), ico(fav, 32));
console.log('favicon.ico');
