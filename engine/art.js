// Indexed pixel-art format shared by hand-drawn panels and photo-derived ones.
//
// Every image is a rectangle of 2-bit palette indices (0 = lightest .. 3 = darkest),
// packed 4 pixels per byte and base64'd, so a 96x72 panel is ~2.3 KB of text.
// Hand-drawn art is authored as a list of draw ops and rasterized to the same
// buffer at load time, which keeps both kinds interchangeable at the call site.
//
// DOM-free: usable from Node (tools/, CI validation) and the browser alike.

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function toBase64(bytes) {
  if (typeof btoa === 'function') {
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s);
  }
  // Fallback for exotic hosts.
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b || 0) >> 4)];
    out += i + 1 < bytes.length ? B64[((b & 15) << 2) | ((c || 0) >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[c & 63] : '=';
  }
  return out;
}

function fromBase64(str) {
  if (typeof atob === 'function') {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const clean = str.replace(/=+$/, '');
  const out = new Uint8Array((clean.length * 3) >> 2);
  let acc = 0;
  let bits = 0;
  let o = 0;
  for (const ch of clean) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (acc >> bits) & 0xff;
    }
  }
  return out;
}

/** Pack a Uint8Array of 0..3 indices into a base64 string, 4 px per byte. */
export function packIndices(px) {
  const bytes = new Uint8Array(Math.ceil(px.length / 4));
  for (let i = 0; i < px.length; i++) {
    bytes[i >> 2] |= (px[i] & 3) << (6 - 2 * (i & 3));
  }
  return toBase64(bytes);
}

/** Inverse of packIndices. */
export function unpackIndices(b64, count) {
  const bytes = fromBase64(b64);
  const px = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    px[i] = (bytes[i >> 2] >> (6 - 2 * (i & 3))) & 3;
  }
  return px;
}

// ---------------------------------------------------------------------------
// Draw-op DSL for hand-authored panels.
//
// Ops are compact arrays so art files stay readable and diffable:
//   ['r', x, y, w, h, c]                filled rect
//   ['o', x, y, w, h, c]                rect outline
//   ['l', x0, y0, x1, y1, c]            line
//   ['p', [[x,y],...], c]               filled polygon
//   ['t', x0,y0, x1,y1, x2,y2, c]       filled triangle
//   ['e', cx, cy, rx, ry, c]            filled ellipse
//   ['E', cx, cy, rx, ry, c]            ellipse outline
//   ['d', x, y, w, h, cA, cB, n]        dithered rect, n = 1..3 density of cB
//   ['g', x, y, cols, rows, dx, dy, w, h, c]   grid of rects (windows, etc.)
//   ['c', x, y, w, h]                   clip to rect for subsequent ops
//   ['C']                               reset clip
// ---------------------------------------------------------------------------

const DITHER = [
  // density 1 (sparse), 2 (checker), 3 (dense) on a 4x4 grid
  [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5],
];

class Raster {
  constructor(w, h, bg = 0) {
    this.w = w;
    this.h = h;
    this.px = new Uint8Array(w * h).fill(bg);
    this.clip = [0, 0, w, h];
  }

  set(x, y, c) {
    x |= 0;
    y |= 0;
    const [cx, cy, cw, ch] = this.clip;
    if (x < cx || y < cy || x >= cx + cw || y >= cy + ch) return;
    this.px[y * this.w + x] = c & 3;
  }

  rect(x, y, w, h, c) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) this.set(x + i, y + j, c);
  }

  outline(x, y, w, h, c) {
    for (let i = 0; i < w; i++) {
      this.set(x + i, y, c);
      this.set(x + i, y + h - 1, c);
    }
    for (let j = 0; j < h; j++) {
      this.set(x, y + j, c);
      this.set(x + w - 1, y + j, c);
    }
  }

  line(x0, y0, x1, y1, c) {
    let dx = Math.abs(x1 - x0);
    let dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x0 += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y0 += sy;
      }
    }
  }

  polygon(pts, c) {
    if (pts.length < 3) return;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const [, y] of pts) {
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    minY = Math.max(0, Math.floor(minY));
    maxY = Math.min(this.h - 1, Math.ceil(maxY));
    const xs = [];
    for (let y = minY; y <= maxY; y++) {
      xs.length = 0;
      const cy = y + 0.5;
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i];
        const [xj, yj] = pts[j];
        if (yi <= cy ? yj > cy : yj <= cy) {
          xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const x0 = Math.round(xs[k]);
        const x1 = Math.round(xs[k + 1]);
        for (let x = x0; x < x1; x++) this.set(x, y, c);
      }
    }
  }

  ellipse(cx, cy, rx, ry, c, filled = true) {
    for (let y = -ry; y <= ry; y++) {
      const t = 1 - (y * y) / (ry * ry);
      if (t < 0) continue;
      const half = rx * Math.sqrt(t);
      if (filled) {
        for (let x = Math.round(-half); x <= Math.round(half); x++) this.set(cx + x, cy + y, c);
      } else {
        this.set(cx + Math.round(half), cy + y, c);
        this.set(cx - Math.round(half), cy + y, c);
      }
    }
    if (!filled) {
      for (let x = -rx; x <= rx; x++) {
        const t = 1 - (x * x) / (rx * rx);
        if (t < 0) continue;
        const half = ry * Math.sqrt(t);
        this.set(cx + x, cy + Math.round(half), c);
        this.set(cx + x, cy - Math.round(half), c);
      }
    }
  }

  dither(x, y, w, h, cA, cB, n = 2) {
    const m = DITHER[0];
    const thr = [0, 4, 8, 12][Math.max(0, Math.min(3, n))];
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const v = m[(j & 3) * 4 + (i & 3)];
        this.set(x + i, y + j, v < thr ? cB : cA);
      }
    }
  }
}

/** Rasterize a draw-op list into a Uint8Array of palette indices. */
export function rasterizeOps(ops, w, h, bg = 0) {
  const r = new Raster(w, h, bg);
  for (const op of ops) {
    switch (op[0]) {
      case 'r': r.rect(op[1], op[2], op[3], op[4], op[5]); break;
      case 'o': r.outline(op[1], op[2], op[3], op[4], op[5]); break;
      case 'l': r.line(op[1], op[2], op[3], op[4], op[5]); break;
      case 'p': r.polygon(op[1], op[2]); break;
      case 't': r.polygon([[op[1], op[2]], [op[3], op[4]], [op[5], op[6]]], op[7]); break;
      case 'e': r.ellipse(op[1], op[2], op[3], op[4], op[5], true); break;
      case 'E': r.ellipse(op[1], op[2], op[3], op[4], op[5], false); break;
      case 'd': r.dither(op[1], op[2], op[3], op[4], op[5], op[6], op[7]); break;
      case 'g': {
        const [, x, y, cols, rows, dx, dy, gw, gh, c] = op;
        for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) r.rect(x + i * dx, y + j * dy, gw, gh, c);
        break;
      }
      case 'c': r.clip = [op[1], op[2], op[3], op[4]]; break;
      case 'C': r.clip = [0, 0, w, h]; break;
      default: throw new Error(`unknown art op "${op[0]}"`);
    }
  }
  return r.px;
}

/** Unpack a full byte-per-pixel base64 buffer (colour image panels). */
export function unpackBytes(b64, count) {
  const bytes = fromBase64(b64);
  return bytes.length === count ? bytes : bytes.subarray(0, count);
}

/** Pack a Uint8Array of arbitrary byte values. */
export function packBytes(px) {
  return toBase64(px);
}

/**
 * Normalize any art description into { w, h, px, mode }.
 * Accepts:
 *   { w, h, pal, bits8 }  full-colour panel, px are palette indices
 *   { w, h, bits }        4-shade panel, px are shades 0..3
 *   { w, h, ops, bg }     hand-drawn panel, rasterized on the spot
 */
export function decodeArt(art) {
  if (!art) return null;
  if (art.px) return art;
  const { w, h } = art;
  if (art.bits8 && art.pal) {
    return { w, h, px: unpackBytes(art.bits8, w * h), pal: art.pal, mode: 'image', credit: art.credit };
  }
  const px = art.bits ? unpackIndices(art.bits, w * h) : rasterizeOps(art.ops || [], w, h, art.bg ?? 0);
  return { w, h, px, mode: 'shades', credit: art.credit };
}
