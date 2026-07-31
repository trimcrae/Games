// Turn a grayscale image into 4-level Game Boy palette indices.
// Index 0 is the lightest shade, 3 the darkest, matching engine/gfx.js palettes.

/** 4x4 Bayer matrix, normalized to -0.5..0.5 at use time. */
const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * @param {Uint8Array} gray w*h bytes, 0=black 255=white
 * @param {number} w
 * @param {number} h
 * @param {object} [opts]
 * @param {'bayer'|'floyd'|'none'} [opts.mode='bayer']
 * @param {number} [opts.spread=1] dither strength in output levels
 * @param {number} [opts.gamma=1] <1 brightens midtones, >1 darkens
 * @param {number} [opts.contrast=1] multiplier around mid grey
 * @param {number} [opts.brightness=0] added after contrast, in 0..255 units
 * @returns {Uint8Array} w*h palette indices 0..3
 */
export function quantize(gray, w, h, opts = {}) {
  const { mode = 'bayer', spread = 1, gamma = 1, contrast = 1, brightness = 0 } = opts;
  const n = w * h;
  // Tone map into 0..3 "levels of light".
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let v = gray[i] / 255;
    v = (v - 0.5) * contrast + 0.5 + brightness / 255;
    v = v <= 0 ? 0 : v >= 1 ? 1 : Math.pow(v, gamma);
    lum[i] = v * 3;
  }

  const out = new Uint8Array(n);
  const clampLevel = (v) => (v < 0 ? 0 : v > 3 ? 3 : v);

  if (mode === 'floyd') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const want = lum[i];
        const got = clampLevel(Math.round(want));
        out[i] = 3 - got;
        const err = want - got;
        const push = (dx, dy, k) => {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
          lum[ny * w + nx] += err * k;
        };
        push(1, 0, 7 / 16);
        push(-1, 1, 3 / 16);
        push(0, 1, 5 / 16);
        push(1, 1, 1 / 16);
      }
    }
    return out;
  }

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const t = mode === 'bayer' ? ((BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16 - 0.5) * spread : 0;
      out[i] = 3 - clampLevel(Math.round(lum[i] + t));
    }
  }
  return out;
}

/** Parse a binary PGM (P5) produced by ImageMagick. */
export function readPGM(buf) {
  let pos = 0;
  const token = () => {
    while (pos < buf.length) {
      const c = buf[pos];
      if (c === 35) {
        while (pos < buf.length && buf[pos] !== 10) pos++;
      } else if (c === 32 || c === 9 || c === 10 || c === 13) {
        pos++;
      } else break;
    }
    const start = pos;
    while (pos < buf.length && ![32, 9, 10, 13].includes(buf[pos])) pos++;
    return String.fromCharCode(...buf.subarray(start, pos));
  };
  const magic = token();
  if (magic !== 'P5') throw new Error(`expected P5 PGM, got "${magic}"`);
  const w = parseInt(token(), 10);
  const h = parseInt(token(), 10);
  const max = parseInt(token(), 10);
  pos++; // single whitespace before the raster
  const data = buf.subarray(pos, pos + w * h);
  if (data.length < w * h) throw new Error('truncated PGM');
  const gray = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = max === 255 ? data[i] : Math.round((data[i] / max) * 255);
  return { w, h, gray };
}
