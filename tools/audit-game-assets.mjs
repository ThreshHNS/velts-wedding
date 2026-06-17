import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const ROOT = process.cwd();
const ASSET_DIR = path.join(ROOT, 'public/assets/game');
const OUT = path.join(ROOT, 'docs/visual-audit/asset-audit.json');

function decodePng(file) {
  const buf = fs.readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) return null;
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
  return { width, height, rgba };
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listFiles(full);
    return entry.name.endsWith('.png') ? [full] : [];
  });
}

function alphaAt(img, x, y) {
  if (x < 0 || y < 0 || x >= img.width || y >= img.height) return 0;
  return img.rgba[(y * img.width + x) * 4 + 3];
}

function hasTransparentNeighbor(img, x, y) {
  return alphaAt(img, x - 1, y) <= 8 || alphaAt(img, x + 1, y) <= 8 || alphaAt(img, x, y - 1) <= 8 || alphaAt(img, x, y + 1) <= 8;
}

function audit(file) {
  const img = decodePng(file);
  if (!img) return null;
  let left = img.width;
  let top = img.height;
  let right = -1;
  let bottom = -1;
  let edgeOpaque = 0;
  let whiteFringe = 0;
  let semiTransparent = 0;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      const i = (y * img.width + x) * 4;
      const r = img.rgba[i];
      const g = img.rgba[i + 1];
      const b = img.rgba[i + 2];
      const a = img.rgba[i + 3];
      if (a <= 8) continue;
      if (x < left) left = x;
      if (y < top) top = y;
      if (x > right) right = x;
      if (y > bottom) bottom = y;
      if (x === 0 || y === 0 || x === img.width - 1 || y === img.height - 1) edgeOpaque += 1;
      if (a < 248) semiTransparent += 1;
      if (a > 20 && r > 232 && g > 232 && b > 232 && hasTransparentNeighbor(img, x, y)) whiteFringe += 1;
    }
  }
  if (right < left) return null;
  return {
    file: path.relative(ROOT, file),
    size: [img.width, img.height],
    margins: {
      left,
      top,
      right: img.width - 1 - right,
      bottom: img.height - 1 - bottom,
    },
    edgeOpaque,
    whiteFringe,
    semiTransparent,
  };
}

const results = listFiles(ASSET_DIR).map(audit).filter(Boolean);
const flagged = results.filter((item) => item.edgeOpaque > 0 || item.whiteFringe > 0 || Math.min(item.margins.left, item.margins.top, item.margins.right, item.margins.bottom) < 3);
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, `${JSON.stringify({ generatedAt: new Date().toISOString(), count: results.length, flagged }, null, 2)}\n`);

console.log(`Audited ${results.length} PNG assets`);
console.log(`Flagged ${flagged.length} assets`);
for (const item of flagged.slice(0, 40)) {
  console.log(`${item.file} margins=${JSON.stringify(item.margins)} edge=${item.edgeOpaque} whiteFringe=${item.whiteFringe}`);
}
