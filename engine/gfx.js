// Framebuffer and drawing primitives for the handheld.
//
// Every pixel in the framebuffer is one byte: (paletteSlot << 2) | shade,
// where shade is 0 (lightest) .. 3 (darkest). The original Game Boy had a
// single 4-shade palette; the Color could pick a different 4-colour palette per
// tile. Storing the slot in the framebuffer means the whole console can switch
// between a strict monochrome look and a colour one by swapping a lookup table,
// without re-authoring a single tile.

export const SHADES = 4;
export const TRANSPARENT = 4; // sentinel index inside sprite/tile pixel data

/** Named palette slots. Art refers to these, never to raw colours. */
export const SLOT = {
  UI: 0,
  LAND: 1,
  WATER: 2,
  ROAD: 3,
  WALL: 4,
  ROOF: 5,
  SAND: 6,
  TREE: 7,
  CHAR: 8,
  ACCENT: 9,
  BRICK: 10,
  TURF: 11,
  CONCRETE: 12,
  DEEP: 13,
  NIGHT: 14,
  GOLD: 15,
};
export const SLOT_COUNT = 16;

/**
 * Framebuffer bytes 0..63 are the 16 art slots above. Everything from 64 up is
 * a free palette that a scene can install for one image - that is where the
 * photographic landmark panels live, giving them Game Boy Advance-era colour
 * depth while the world keeps its four-shades-per-slot discipline.
 */
export const IMAGE_BASE = SLOT_COUNT * 4;
export const IMAGE_MAX = 256 - IMAGE_BASE;

/** Compose a framebuffer byte. */
export const px = (slot, shade) => ((slot << 2) | (shade & 3)) & 0xff;

const ramp = (a, b, c, d) => [a, b, c, d];

/**
 * A "look" is one palette per slot. All eight are identical on the monochrome
 * looks, which is exactly what makes them monochrome.
 */
function mono(ramp4) {
  return Array.from({ length: SLOT_COUNT }, () => ramp4);
}

export const LOOKS = {
  dmg: {
    name: 'DMG',
    note: 'Game Boy, 1989',
    slots: mono(ramp('#9bbc0f', '#8bac0f', '#306230', '#0f380f')),
    shell: { case: '#c8c4bc', screen: '#8b9440', accent: '#7c1c48' },
  },
  pocket: {
    name: 'POCKET',
    note: 'Game Boy Pocket',
    slots: mono(ramp('#c4cfa1', '#8b956d', '#4d533c', '#1f1f1f')),
    shell: { case: '#3f3f42', screen: '#6f7a55', accent: '#9a9a9e' },
  },
  light: {
    name: 'LIGHT',
    note: 'Game Boy Light',
    slots: mono(ramp('#00b581', '#009a71', '#00694a', '#004232')),
    shell: { case: '#d8d2c4', screen: '#0b3b2c', accent: '#c0a02a' },
  },
  color: {
    name: 'COLOR',
    note: 'full colour',
    colour: true,
    slots: [
      ramp('#f8f8f0', '#b8b8a8', '#606060', '#181818'), // UI
      ramp('#d8e878', '#88c040', '#3d8028', '#1d4a18'), // LAND
      ramp('#b8e8f0', '#68b8e0', '#2868b8', '#123468'), // WATER
      ramp('#e0dcd0', '#a8a49c', '#68645c', '#2c2c2c'), // ROAD
      ramp('#f0e0c0', '#d0a878', '#98684c', '#4c3020'), // WALL
      ramp('#f0b080', '#d06848', '#983028', '#4c1818'), // ROOF
      ramp('#f8ecc0', '#e0c890', '#b09058', '#6c5430'), // SAND
      ramp('#a8d868', '#4a9030', '#2c6820', '#143810'), // TREE
      ramp('#f8d8b0', '#e05840', '#2848a0', '#181818'), // CHAR
      ramp('#fff0a0', '#f0c020', '#a86818', '#402c08'), // ACCENT
      ramp('#e8a882', '#c06848', '#8c3c2c', '#4c1c18'), // BRICK
      ramp('#c8e878', '#7cc040', '#3c8830', '#1c4c1c'), // TURF
      ramp('#f0f0e8', '#c4c4bc', '#8c8c88', '#4c4c4c'), // CONCRETE
      ramp('#5088c8', '#2c5ca0', '#183c78', '#0c1c40'), // DEEP
      ramp('#8898c8', '#48588c', '#283048', '#101018'), // NIGHT
      ramp('#fff4c0', '#f0cc50', '#b08820', '#5c4008'), // GOLD
    ],
    shell: { case: '#5a3fa0', screen: '#2a1c50', accent: '#e8c020' },
  },
};

// Guard against typos in the palette tables above.
for (const [id, look] of Object.entries(LOOKS)) {
  for (const slot of look.slots) {
    for (const c of slot) {
      if (!/^#[0-9a-f]{6}$/i.test(c)) throw new Error(`look "${id}" has a bad colour: ${c}`);
    }
  }
}

const LITTLE_ENDIAN = (() => {
  const probe = new Uint32Array(1);
  new Uint8Array(probe.buffer)[0] = 1;
  return probe[0] === 1;
})();

function rgba(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return LITTLE_ENDIAN ? (255 << 24) | (b << 16) | (g << 8) | r : (r << 24) | (g << 16) | (b << 8) | 255;
}

/** Relative luminance of a hex colour, 0..1. */
export function luma(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Build the 256-entry framebuffer-byte -> RGBA lookup for a look.
 * @param {object} look
 * @param {string[]} [imagePalette] colours for the image region (byte 64 up).
 *   On a monochrome look these are folded down to the look's own four shades by
 *   luminance, so one colour panel serves every screen.
 */
export function buildLUT(look, imagePalette = null) {
  const lut = new Uint32Array(256);
  for (let slot = 0; slot < SLOT_COUNT; slot++) {
    const colours = look.slots[slot] || look.slots[0];
    for (let shade = 0; shade < 4; shade++) lut[px(slot, shade)] = rgba(colours[shade]);
  }

  const uiRamp = look.slots[SLOT.UI];
  const monochrome = look.monochrome !== false && !look.colour;
  for (let i = 0; i < IMAGE_MAX; i++) {
    const hex = imagePalette?.[i];
    if (!hex) {
      lut[IMAGE_BASE + i] = lut[px(SLOT.UI, 0)];
    } else if (monochrome) {
      const shade = Math.min(3, Math.max(0, Math.round((1 - luma(hex)) * 3)));
      lut[IMAGE_BASE + i] = rgba(uiRamp[shade]);
    } else {
      lut[IMAGE_BASE + i] = rgba(hex);
    }
  }
  return lut;
}

const hexToRGB = (hex) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** Return the RGB triplet for a framebuffer byte under a look (for tooling). */
export function rgbOf(look, byte, imagePalette = null) {
  if (byte >= IMAGE_BASE) {
    const hex = imagePalette?.[byte - IMAGE_BASE];
    if (!hex) return hexToRGB(look.slots[SLOT.UI][0]);
    if (look.colour) return hexToRGB(hex);
    const shade = Math.min(3, Math.max(0, Math.round((1 - luma(hex)) * 3)));
    return hexToRGB(look.slots[SLOT.UI][shade]);
  }
  // Slot count is not a power of two, so this has to be a modulo, not a mask.
  const hex = (look.slots[(byte >> 2) % SLOT_COUNT] || look.slots[0])[byte & 3];
  return hexToRGB(hex);
}

import { glyph, GLYPH_W, GLYPH_H, ADVANCE } from './font.js';

export class Screen {
  constructor(w = 160, h = 144) {
    this.w = w;
    this.h = h;
    this.buf = new Uint8Array(w * h);
    this.clipX = 0;
    this.clipY = 0;
    this.clipW = w;
    this.clipH = h;
  }

  clip(x = 0, y = 0, w = this.w, h = this.h) {
    this.clipX = Math.max(0, x);
    this.clipY = Math.max(0, y);
    this.clipW = Math.min(this.w - this.clipX, w);
    this.clipH = Math.min(this.h - this.clipY, h);
  }

  noClip() {
    this.clip(0, 0, this.w, this.h);
  }

  clear(byte = 0) {
    this.buf.fill(byte);
  }

  set(x, y, byte) {
    x |= 0;
    y |= 0;
    if (x < this.clipX || y < this.clipY || x >= this.clipX + this.clipW || y >= this.clipY + this.clipH) return;
    this.buf[y * this.w + x] = byte;
  }

  get(x, y) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.buf[y * this.w + x];
  }

  fill(x, y, w, h, byte) {
    const x0 = Math.max(x | 0, this.clipX);
    const y0 = Math.max(y | 0, this.clipY);
    const x1 = Math.min((x | 0) + w, this.clipX + this.clipW);
    const y1 = Math.min((y | 0) + h, this.clipY + this.clipH);
    for (let j = y0; j < y1; j++) this.buf.fill(byte, j * this.w + x0, j * this.w + x1);
  }

  frame(x, y, w, h, byte) {
    this.fill(x, y, w, 1, byte);
    this.fill(x, y + h - 1, w, 1, byte);
    this.fill(x, y, 1, h, byte);
    this.fill(x + w - 1, y, 1, h, byte);
  }

  hline(x, y, w, byte) {
    this.fill(x, y, w, 1, byte);
  }

  vline(x, y, h, byte) {
    this.fill(x, y, 1, h, byte);
  }

  /** Dotted 1px border, the classic menu-frame texture. */
  dottedFrame(x, y, w, h, byte, step = 2) {
    for (let i = 0; i < w; i += step) {
      this.set(x + i, y, byte);
      this.set(x + i, y + h - 1, byte);
    }
    for (let j = 0; j < h; j += step) {
      this.set(x, y + j, byte);
      this.set(x + w - 1, y + j, byte);
    }
  }

  /**
   * Blit indexed pixel data. Values 0..3 are shades within `slot`;
   * TRANSPARENT (4) is skipped.
   */
  blit(data, w, h, dx, dy, opts = {}) {
    const { slot = 0, flipX = false, flipY = false, scale = 1, tint = null, raw = false } = opts;
    // `raw` means the data already holds absolute framebuffer bytes, which is
    // how full-colour image panels are drawn.
    const base = raw ? 0 : slot << 2;
    for (let j = 0; j < h; j++) {
      const sy = flipY ? h - 1 - j : j;
      for (let i = 0; i < w; i++) {
        const sx = flipX ? w - 1 - i : i;
        const v = data[sy * w + sx];
        if (v === undefined || (!raw && v === TRANSPARENT)) continue;
        const byte = tint !== null ? tint : raw ? v : base | (v & 3);
        if (scale === 1) this.set(dx + i, dy + j, byte);
        else this.fill(dx + i * scale, dy + j * scale, scale, scale, byte);
      }
    }
  }

  /** Draw one 8x8 tile out of a packed tileset. */
  tile(tileset, id, dx, dy, slot = 0) {
    const { size, data } = tileset;
    const off = id * size * size;
    const base = slot << 2;
    for (let j = 0; j < size; j++) {
      const ty = dy + j;
      if (ty < this.clipY || ty >= this.clipY + this.clipH) continue;
      for (let i = 0; i < size; i++) {
        const v = data[off + j * size + i];
        if (v === TRANSPARENT) continue;
        this.set(dx + i, ty, base | (v & 3));
      }
    }
  }

  textWidth(str, spacing = ADVANCE) {
    return str.length * spacing - (spacing - GLYPH_W);
  }

  /**
   * Draw text. `shadow` paints a 1px offset copy first, which is how the real
   * hardware's UI text stayed legible over busy tiles.
   */
  text(str, x, y, opts = {}) {
    const { slot = SLOT.UI, shade = 3, spacing = ADVANCE, shadow = null, scale = 1 } = opts;
    const byte = px(slot, shade);
    if (shadow !== null) {
      this.text(str, x + scale, y + scale, { ...opts, shade: shadow, shadow: null });
    }
    let cx = x;
    for (const ch of str) {
      const g = glyph(ch);
      for (let j = 0; j < GLYPH_H; j++) {
        for (let i = 0; i < GLYPH_W; i++) {
          if (!g[j * GLYPH_W + i]) continue;
          if (scale === 1) this.set(cx + i, y + j, byte);
          else this.fill(cx + i * scale, y + j * scale, scale, scale, byte);
        }
      }
      cx += spacing * scale;
    }
    return cx;
  }

  textCentred(str, y, opts = {}) {
    const scale = opts.scale || 1;
    const w = this.textWidth(str, opts.spacing) * scale;
    return this.text(str, Math.round((this.w - w) / 2), y, opts);
  }

  /** Write the framebuffer into a 32-bit view of an ImageData, via a LUT. */
  present(out32, lut) {
    const buf = this.buf;
    for (let i = 0; i < buf.length; i++) out32[i] = lut[buf[i]];
  }
}

/**
 * Word-wrap into lines that fit `width` pixels.
 * Long words are broken rather than overflowing.
 */
export function wrapText(str, width, spacing = ADVANCE) {
  const max = Math.max(1, Math.floor((width + (spacing - GLYPH_W)) / spacing));
  const lines = [];
  for (const paragraph of String(str).split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (!line.length) {
        line = word;
      } else if (line.length + 1 + word.length <= max) {
        line += ` ${word}`;
      } else {
        lines.push(line);
        line = word;
      }
      while (line.length > max) {
        lines.push(line.slice(0, max));
        line = line.slice(max);
      }
    }
    lines.push(line);
  }
  return lines;
}
