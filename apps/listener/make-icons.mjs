#!/usr/bin/env node
/**
 * Icon generation, with no image library.
 *
 * The mark is simple enough to rasterise directly — three returning arcs and a
 * dot — so the icons are drawn into an RGBA buffer and written out as PNG with
 * nothing but `node:zlib`. One fewer build dependency to audit (SEC-9), and
 * the icons regenerate identically on any machine.
 *
 *   node make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const OUT = path.join(import.meta.dirname, 'public');

const BG = [0x16, 0x18, 0x26];
const ARCS = [
  { radius: 0.36, width: 0.05, colour: [0xe3, 0x9a, 0x2f], alpha: 1 },
  { radius: 0.265, width: 0.04, colour: [0x6f, 0xb8, 0x9e], alpha: 0.85 },
  { radius: 0.175, width: 0.032, colour: [0x9f, 0xd0, 0xbe], alpha: 0.7 },
];
const DOT = { centre: [0.5, 0.71], radius: 0.05, colour: [0xf0, 0xb3, 0x57] };

function render(size, { maskable }) {
  const pixels = new Uint8Array(size * size * 4);
  const pad = maskable ? 0.1 : 0;
  const cornerRadius = maskable ? 0.5 : 0.219;
  const samples = 3; // supersampling, so the curves are not jagged

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < samples; sy++) {
        for (let sx = 0; sx < samples; sx++) {
          const u = (x + (sx + 0.5) / samples) / size;
          const v = (y + (sy + 0.5) / samples) / size;
          const [pr, pg, pb, pa] = sample(u, v, pad, cornerRadius);
          r += pr;
          g += pg;
          b += pb;
          a += pa;
        }
      }
      const n = samples * samples;
      const i = (y * size + x) * 4;
      pixels[i] = Math.round(r / n);
      pixels[i + 1] = Math.round(g / n);
      pixels[i + 2] = Math.round(b / n);
      pixels[i + 3] = Math.round(a / n);
    }
  }
  return pixels;
}

function sample(u, v, pad, cornerRadius) {
  if (!insideRoundedSquare(u, v, cornerRadius)) return [0, 0, 0, 0];
  let colour = [...BG];

  const cx = 0.5;
  const cy = 0.54;
  const scale = 1 - pad * 2;
  const du = (u - cx) / scale;
  const dv = (v - cy) / scale;
  const distance = Math.hypot(du, dv);

  for (const arc of ARCS) {
    // Upper half only: an arc that opens downward, like a phrase returning.
    if (dv > 0.02) continue;
    const edge = Math.abs(distance - arc.radius);
    const coverage = edge <= arc.width / 2 ? arc.alpha : 0;
    if (coverage > 0) colour = blend(colour, arc.colour, coverage);
  }

  const dotDistance = Math.hypot((u - DOT.centre[0]) / scale, (v - DOT.centre[1]) / scale);
  if (dotDistance <= DOT.radius) colour = blend(colour, DOT.colour, 1);

  return [colour[0], colour[1], colour[2], 255];
}

function insideRoundedSquare(u, v, radius) {
  const x = Math.min(u, 1 - u);
  const y = Math.min(v, 1 - v);
  if (x >= radius || y >= radius) return true;
  return Math.hypot(radius - x, radius - y) <= radius;
}

function blend(base, colour, alpha) {
  return [
    Math.round(base[0] * (1 - alpha) + colour[0] * alpha),
    Math.round(base[1] * (1 - alpha) + colour[1] * alpha),
    Math.round(base[2] * (1 - alpha) + colour[2] * alpha),
  ];
}

function png(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type: RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)) >>> 0, 8 + data.length);
  return out;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return c ^ 0xffffffff;
}

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: false },
];

for (const target of targets) {
  const pixels = render(target.size, { maskable: target.maskable });
  writeFileSync(path.join(OUT, target.file), png(target.size, target.size, pixels));
  console.log(`wrote ${target.file} (${target.size}×${target.size})`);
}
