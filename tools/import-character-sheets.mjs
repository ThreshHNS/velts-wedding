import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const SRC = path.join(ROOT, 'asset-pack/runtime-sources/source-sheets/characters');
const OUT = path.join(ROOT, 'asset-pack/runtime-sources/provided/characters');
const ALPHA_MIN = 10;

const SHEETS = [
  {
    file: 'idle-run1-run2.png',
    keys: ['groom-idle', 'groom-run-1', 'groom-run-2'],
    group: 'groom',
  },
  {
    file: 'run3-run4-jump.png',
    keys: ['groom-run-3', 'groom-run-4', 'groom-jump'],
    group: 'groom',
  },
  {
    file: 'land-celebrate.png',
    keys: ['groom-land', 'groom-celebrate'],
    group: 'groom',
  },
  {
    file: 'idle-wave-bouquet.png',
    keys: ['bride-idle', 'bride-wave', 'bride-bouquet'],
    group: 'bride',
  },
  {
    file: 'couple-pose.png',
    keys: ['couple-pose'],
    group: 'couple',
  },
];

const TARGET_REFERENCE_HEIGHT = {
  groom: 224,
  bride: 238,
  couple: 320,
};

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
  if (bitDepth !== 8 || ![2, 6].includes(colorType)) throw new Error(`Unsupported PNG format: ${file}`);
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
  return { width, height, rgba };
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

function components(img) {
  const foreground = new Uint8Array(img.width * img.height);
  const seen = new Uint8Array(img.width * img.height);
  for (let i = 0; i < foreground.length; i += 1) foreground[i] = img.rgba[i * 4 + 3] > ALPHA_MIN ? 1 : 0;
  const found = [];
  const q = [];
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const start = y * img.width + x;
      if (!foreground[start] || seen[start]) continue;
      let left = x;
      let top = y;
      let right = x;
      let bottom = y;
      let area = 0;
      q.length = 0;
      q.push(start);
      seen[start] = 1;
      for (let qi = 0; qi < q.length; qi += 1) {
        const p = q[qi];
        const px = p % img.width;
        const py = Math.floor(p / img.width);
        area += 1;
        if (px < left) left = px;
        if (py < top) top = py;
        if (px > right) right = px;
        if (py > bottom) bottom = py;
        for (const np of [p - 1, p + 1, p - img.width, p + img.width]) {
          if (np < 0 || np >= foreground.length || seen[np] || !foreground[np]) continue;
          const nx = np % img.width;
          const ny = Math.floor(np / img.width);
          if (Math.abs(nx - px) + Math.abs(ny - py) !== 1) continue;
          seen[np] = 1;
          q.push(np);
        }
      }
      if (area > 500) found.push({ left, top, right, bottom, width: right - left + 1, height: bottom - top + 1, area });
    }
  }
  return found.sort((a, b) => a.left - b.left);
}

function crop(img, bounds, pad = 8) {
  const left = Math.max(0, bounds.left - pad);
  const top = Math.max(0, bounds.top - pad);
  const right = Math.min(img.width - 1, bounds.right + pad);
  const bottom = Math.min(img.height - 1, bounds.bottom + pad);
  const width = right - left + 1;
  const height = bottom - top + 1;
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const si = ((top + y) * img.width + left + x) * 4;
      const di = (y * width + x) * 4;
      rgba[di] = img.rgba[si];
      rgba[di + 1] = img.rgba[si + 1];
      rgba[di + 2] = img.rgba[si + 2];
      rgba[di + 3] = img.rgba[si + 3] <= ALPHA_MIN ? 0 : img.rgba[si + 3];
    }
  }
  return { width, height, rgba };
}

function alphaBounds(img) {
  let left = img.width;
  let top = img.height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (img.rgba[(y * img.width + x) * 4 + 3] <= ALPHA_MIN) continue;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left) return null;
  return { left, top, right, bottom, width: right - left + 1, height: bottom - top + 1 };
}

function resizeNearest(img, scale) {
  const width = Math.max(1, Math.round(img.width * scale));
  const height = Math.max(1, Math.round(img.height * scale));
  const rgba = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    const sy = Math.min(img.height - 1, Math.floor(y / scale));
    for (let x = 0; x < width; x += 1) {
      const sx = Math.min(img.width - 1, Math.floor(x / scale));
      const si = (sy * img.width + sx) * 4;
      const di = (y * width + x) * 4;
      rgba[di] = img.rgba[si];
      rgba[di + 1] = img.rgba[si + 1];
      rgba[di + 2] = img.rgba[si + 2];
      rgba[di + 3] = img.rgba[si + 3];
    }
  }
  return { width, height, rgba };
}

function transparentEdges(img) {
  let edge = 0;
  for (let x = 0; x < img.width; x += 1) {
    if (img.rgba[x * 4 + 3] > ALPHA_MIN) edge += 1;
    if (img.rgba[((img.height - 1) * img.width + x) * 4 + 3] > ALPHA_MIN) edge += 1;
  }
  for (let y = 0; y < img.height; y += 1) {
    if (img.rgba[(y * img.width) * 4 + 3] > ALPHA_MIN) edge += 1;
    if (img.rgba[(y * img.width + img.width - 1) * 4 + 3] > ALPHA_MIN) edge += 1;
  }
  return edge;
}

const rawSprites = [];
for (const sheet of SHEETS) {
  const img = decodePng(path.join(SRC, sheet.file));
  const found = components(img);
  if (found.length !== sheet.keys.length) {
    throw new Error(`${sheet.file}: expected ${sheet.keys.length} components, found ${found.length}`);
  }
  sheet.keys.forEach((key, index) => {
    rawSprites.push({ key, group: sheet.group, img: crop(img, found[index]) });
  });
}

const referenceHeight = {};
for (const group of ['groom', 'bride', 'couple']) {
  const reference =
    group === 'groom'
      ? rawSprites.find((s) => s.key === 'groom-idle')
      : group === 'bride'
        ? rawSprites.find((s) => s.key === 'bride-idle')
        : rawSprites.find((s) => s.key === 'couple-pose');
  const bounds = reference ? alphaBounds(reference.img) : null;
  if (!bounds) throw new Error(`Missing reference bounds for ${group}`);
  referenceHeight[group] = bounds.height;
}

fs.mkdirSync(OUT, { recursive: true });
const report = [];
for (const sprite of rawSprites) {
  const scale = TARGET_REFERENCE_HEIGHT[sprite.group] / referenceHeight[sprite.group];
  const resized = resizeNearest(sprite.img, scale);
  const out = path.join(OUT, `${sprite.key}.png`);
  fs.writeFileSync(out, encodePng(resized.width, resized.height, resized.rgba));
  const bounds = alphaBounds(resized);
  report.push({
    key: sprite.key,
    size: `${resized.width}x${resized.height}`,
    content: bounds ? `${bounds.width}x${bounds.height}` : 'empty',
    edgeOpaque: transparentEdges(resized),
  });
}

console.table(report);
console.log(`Imported ${rawSprites.length} character sprites into ${path.relative(ROOT, OUT)}`);
