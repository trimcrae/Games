// Minimal PNG encoder (truecolour, no filtering) so sample renders and CI
// screenshots can be produced with nothing but Node's zlib.

import { deflateSync } from 'node:zlib';

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
