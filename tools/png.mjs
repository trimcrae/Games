// Minimal PNG encoder (truecolour, no filtering) so sample renders and CI
// screenshots can be produced with nothing but Node's zlib.

import { deflateSync, inflateSync } from 'node:zlib';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = Buffer.alloc(data.length + 12);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'ascii');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/**
 * @param {number} w
 * @param {number} h
 * @param {Uint8Array} rgb w*h*3 bytes
 * @param {number} [scale=1] nearest-neighbour upscale
 */
export function encodePNG(w, h, rgb, scale = 1) {
  const ow = w * scale;
  const oh = h * scale;
  const raw = Buffer.alloc((ow * 3 + 1) * oh);
  let p = 0;
  for (let y = 0; y < oh; y++) {
    raw[p++] = 0; // filter: none
    const sy = (y / scale) | 0;
    for (let x = 0; x < ow; x++) {
      const s = (sy * w + ((x / scale) | 0)) * 3;
      raw[p++] = rgb[s];
      raw[p++] = rgb[s + 1];
      raw[p++] = rgb[s + 2];
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(ow, 0);
  ihdr.writeUInt32BE(oh, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Lay images out in a grid with a background border. Images are {w,h,rgb}. */
export function montage(images, cols, gap = 8, bg = [24, 24, 24]) {
  const rows = Math.ceil(images.length / cols);
  const cw = Math.max(...images.map((i) => i.w));
  const ch = Math.max(...images.map((i) => i.h));
  const w = cols * cw + (cols + 1) * gap;
  const h = rows * ch + (rows + 1) * gap;
  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = bg[0];
    rgb[i * 3 + 1] = bg[1];
    rgb[i * 3 + 2] = bg[2];
  }
  images.forEach((img, idx) => {
    const cx = gap + (idx % cols) * (cw + gap);
    const cy = gap + Math.floor(idx / cols) * (ch + gap);
    for (let y = 0; y < img.h; y++) {
      for (let x = 0; x < img.w; x++) {
        const s = (y * img.w + x) * 3;
        const d = ((cy + y) * w + cx + x) * 3;
        rgb[d] = img.rgb[s];
        rgb[d + 1] = img.rgb[s + 1];
        rgb[d + 2] = img.rgb[s + 2];
      }
    }
  });
  return { w, h, rgb };
}

/**
 * Decode a truecolour or greyscale PNG (no interlacing) into { w, h, rgb }.
 * Enough to read back the working copies this tool writes, which is all the
 * offline retuning loop needs.
 */
export function decodePNG(buf) {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  let pos = 8;
  let w = 0;
  let h = 0;
  let depth = 8;
  let colourType = 2;
  const idat = [];
  let palette = null;

  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      depth = data[8];
      colourType = data[9];
      if (data[12] !== 0) throw new Error('interlaced PNG not supported');
    } else if (type === 'PLTE') {
      palette = data;
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    pos += 12 + len;
  }
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);

  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colourType];
  if (!channels) throw new Error(`unsupported colour type ${colourType}`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * channels;
  const out = Buffer.alloc(h * stride);

  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    const cur = out.subarray(y * stride, (y + 1) * stride);
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? cur[i - channels] : 0;
      const b = prev ? prev[i] : 0;
      const c = prev && i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      switch (filter) {
        case 0: break;
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: throw new Error(`unknown PNG filter ${filter}`);
      }
      cur[i] = v & 0xff;
    }
  }

  const rgb = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    if (colourType === 2 || colourType === 6) {
      rgb[i * 3] = out[i * channels];
      rgb[i * 3 + 1] = out[i * channels + 1];
      rgb[i * 3 + 2] = out[i * channels + 2];
    } else if (colourType === 3) {
      const p = out[i] * 3;
      rgb[i * 3] = palette[p];
      rgb[i * 3 + 1] = palette[p + 1];
      rgb[i * 3 + 2] = palette[p + 2];
    } else {
      rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = out[i * channels];
    }
  }
  return { w, h, rgb };
}
