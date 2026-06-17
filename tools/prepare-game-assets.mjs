import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'public/assets/game');
const MANIFEST = path.join(ROOT, 'src/data/spriteBounds.json');

const SOURCES = [
  ['asset-pack/runtime-sources/provided/characters', 'characters'],
  ['asset-pack/runtime-sources/provided/kaya', 'kaya'],
  ['asset-pack/runtime-sources/provided/props', 'props'],
  ['asset-pack/runtime-sources/v3/decor', 'v3/decor'],
  ['asset-pack/runtime-sources/v3/furniture', 'v3/furniture'],
  ['asset-pack/runtime-sources/v3/fx', 'v3/fx'],
  ['asset-pack/runtime-sources/v3/obstacles', 'v3/obstacles'],
];

const RUN_GROUP = new Set(['groom-run-1', 'groom-run-2', 'groom-run-3', 'groom-run-4']);

function crc32(buf) {
  let c = -1;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k += 1) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const t = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crc]);
}

function decodePng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error(`Not a PNG: ${file}`);
  let o = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  let bitDepth = 0;
  const idats = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString('ascii', o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    o += len + 12;
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idats.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) return null;
  const bpp = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const stride = width * bpp;
  const data = Buffer.alloc(height * stride);
  let ro = 0;
  for (let y = 0; y < height; y += 1) {
    const filter = raw[ro];
    ro += 1;
    const src = raw.subarray(ro, ro + stride);
    ro += stride;
    const dst = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= bpp ? dst[x - bpp] : 0;
      const up = prev ? prev[x] : 0;
      const upLeft = prev && x >= bpp ? prev[x - bpp] : 0;
      let pred = 0;
      if (filter === 1) pred = left;
      else if (filter === 2) pred = up;
      else if (filter === 3) pred = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upLeft;
        const pa = Math.abs(p - left);
        const pb = Math.abs(p - up);
        const pc = Math.abs(p - upLeft);
        pred = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      } else if (filter !== 0) {
        throw new Error(`Unsupported PNG filter ${filter}: ${file}`);
      }
      dst[x] = (src[x] + pred) & 255;
    }
  }
  const rgba = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < width * height; i += 1, j += bpp) {
    rgba[i * 4] = data[j];
    rgba[i * 4 + 1] = data[j + 1];
    rgba[i * 4 + 2] = data[j + 2];
    rgba[i * 4 + 3] = bpp === 4 ? data[j + 3] : 255;
  }
  return { width, height, rgba, hasAlpha: colorType === 6 };
}

function encodePng(width, height, rgba) {
  const scanline = width * 4 + 1;
  const raw = Buffer.alloc(scanline * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * scanline] = 0;
    rgba.copy(raw, y * scanline + 1, y * width * 4, (y + 1) * width * 4);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function alphaBounds(img) {
  let left = img.width;
  let top = img.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (img.rgba[(y * img.width + x) * 4 + 3] <= 8) continue;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left) return null;
  return { left, top, right: right + 1, bottom: bottom + 1, width: right - left + 1, height: bottom - top + 1 };
}

function alphaAt(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 0;
  return img.rgba[(y * img.width + x) * 4 + 3];
}

function nearTransparent(img, x, y, radius) {
  for (let yy = y - radius; yy <= y + radius; yy += 1) {
    for (let xx = x - radius; xx <= x + radius; xx += 1) {
      if (alphaAt(img, xx, yy) <= 8) return true;
    }
  }
  return false;
}

function removeMatteArtifacts(img) {
  const rgba = Buffer.from(img.rgba);
  let changed = 0;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const i = (y * img.width + x) * 4;
      const r = img.rgba[i];
      const g = img.rgba[i + 1];
      const b = img.rgba[i + 2];
      const a = img.rgba[i + 3];
      if (a <= 8 || !nearTransparent(img, x, y, 2)) continue;
      const whiteMatte = r >= 235 && g >= 225 && b >= 195;
      const greenMatte = g >= 170 && r <= 150 && b <= 150 && g - Math.max(r, b) >= 35;
      if (!whiteMatte && !greenMatte) continue;
      rgba[i] = 0;
      rgba[i + 1] = 0;
      rgba[i + 2] = 0;
      rgba[i + 3] = 0;
      changed += 1;
    }
  }
  return { ...img, rgba, matteRemoved: changed };
}

function copyCrop(src, bounds, outW, outH, dx, dy) {
  const out = Buffer.alloc(outW * outH * 4);
  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const si = ((bounds.top + y) * src.width + bounds.left + x) * 4;
      const di = ((dy + y) * outW + dx + x) * 4;
      out[di] = src.rgba[si];
      out[di + 1] = src.rgba[si + 1];
      out[di + 2] = src.rgba[si + 2];
      out[di + 3] = src.rgba[si + 3];
    }
  }
  return out;
}

function listPngs(dir) {
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.png'))
    .map((name) => path.join(dir, name));
}

function textureKey(group, file) {
  const base = path.basename(file, '.png');
  if (group.startsWith('v3/')) return `${group.replace('v3/', '')}/${base}`;
  return base;
}

function outputPath(group, file) {
  return path.join(OUT, group, path.basename(file));
}

for (const [, group] of SOURCES) {
  fs.rmSync(path.join(OUT, group), { recursive: true, force: true });
}
const entries = [];
for (const [dir, group] of SOURCES) {
  for (const file of listPngs(path.join(ROOT, dir))) {
    const decoded = decodePng(file);
    const img = decoded ? removeMatteArtifacts(decoded) : null;
    if (!img?.hasAlpha) continue;
    const bounds = alphaBounds(img);
    if (!bounds) continue;
    entries.push({ file, group, key: textureKey(group, file), out: outputPath(group, file), img, bounds });
  }
}

const runMax = entries
  .filter((entry) => RUN_GROUP.has(entry.key))
  .reduce((acc, entry) => ({
    width: Math.max(acc.width, entry.bounds.width),
    height: Math.max(acc.height, entry.bounds.height),
  }), { width: 0, height: 0 });

const manifest = {};
for (const entry of entries) {
  const pad = entry.group.includes('/fx') ? 8 : 18;
  const normalized = RUN_GROUP.has(entry.key);
  const contentW = normalized ? runMax.width : entry.bounds.width;
  const contentH = normalized ? runMax.height : entry.bounds.height;
  const outW = contentW + pad * 2;
  const outH = contentH + pad * 2;
  const dx = Math.round((outW - entry.bounds.width) / 2);
  const dy = outH - pad - entry.bounds.height;
  fs.mkdirSync(path.dirname(entry.out), { recursive: true });
  fs.writeFileSync(entry.out, encodePng(outW, outH, copyCrop(entry.img, entry.bounds, outW, outH, dx, dy)));
  manifest[entry.key] = {
    contentWidth: contentW,
    contentHeight: contentH,
    textureWidth: outW,
    textureHeight: outH,
  };
}

fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared ${entries.length} assets into ${path.relative(ROOT, OUT)}`);
