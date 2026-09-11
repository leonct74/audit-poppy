#!/usr/bin/env node
/**
 * Generate the AuditPoppy app icon (512×512 PNG): a bold shield + check in the
 * poppy's assigned accent (#bccf9e — poppyAccent("com.auditpoppy.desktop"))
 * on the kit's warm graphite. Pure Node (zlib), no image tooling; legible at
 * 24px, square (the host rounds the corners itself).
 */
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 512;
const SS = 2; // supersample factor
const N = SIZE * SS;

const BG = [0x17, 0x16, 0x14]; // --poppy-surface-1
const ACCENT = [0xbc, 0xcf, 0x9e]; // assigned accent

// --- geometry (in supersampled pixels) ---
const s = N / 512;
const cx = 256 * s;
const shieldTop = 92 * s;
const shieldStraightBottom = 300 * s;
const shieldPoint = 436 * s;
const shieldHalf = 158 * s;

function insideShield(x, y) {
  if (y < shieldTop || y > shieldPoint) return false;
  const half =
    y <= shieldStraightBottom
      ? shieldHalf
      : shieldHalf * (1 - (y - shieldStraightBottom) / (shieldPoint - shieldStraightBottom));
  if (Math.abs(x - cx) > half) return false;
  // Soften the top corners with quarter-circles.
  const r = 36 * s;
  if (y < shieldTop + r) {
    const lx = cx - shieldHalf + r;
    const rx = cx + shieldHalf - r;
    if (x < lx && (x - lx) ** 2 + (y - (shieldTop + r)) ** 2 > r * r) return false;
    if (x > rx && (x - rx) ** 2 + (y - (shieldTop + r)) ** 2 > r * r) return false;
  }
  return true;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)));
  const qx = ax + t * dx;
  const qy = ay + t * dy;
  return Math.hypot(px - qx, py - qy);
}

const checkW = 27 * s;
function insideCheck(x, y) {
  return (
    distToSegment(x, y, 186 * s, 258 * s, 240 * s, 316 * s) < checkW ||
    distToSegment(x, y, 240 * s, 316 * s, 336 * s, 196 * s) < checkW
  );
}

// --- render supersampled, then box-filter down ---
const big = new Uint8Array(N * N * 3);
for (let y = 0; y < N; y++) {
  for (let x = 0; x < N; x++) {
    const inShield = insideShield(x, y);
    const color = inShield && !insideCheck(x, y) ? ACCENT : BG;
    const i = (y * N + x) * 3;
    big[i] = color[0];
    big[i + 1] = color[1];
    big[i + 2] = color[2];
  }
}

const raw = Buffer.alloc(SIZE * (SIZE * 3 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 3 + 1)] = 0; // filter: none
  for (let x = 0; x < SIZE; x++) {
    let r = 0;
    let g = 0;
    let b = 0;
    for (let dy = 0; dy < SS; dy++) {
      for (let dx = 0; dx < SS; dx++) {
        const i = ((y * SS + dy) * N + (x * SS + dx)) * 3;
        r += big[i];
        g += big[i + 1];
        b += big[i + 2];
      }
    }
    const o = y * (SIZE * 3 + 1) + 1 + x * 3;
    raw[o] = Math.round(r / (SS * SS));
    raw[o + 1] = Math.round(g / (SS * SS));
    raw[o + 2] = Math.round(b / (SS * SS));
  }
}

// --- PNG encode ---
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // color type: RGB
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", ihdr),
  chunk("IDAT", deflateSync(raw, { level: 9 })),
  chunk("IEND", Buffer.alloc(0)),
]);

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "src", "assets", "auditpoppy-icon.png");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, png);
console.log(`✅ icon → ${out} (${(png.length / 1024).toFixed(1)} KB)`);
