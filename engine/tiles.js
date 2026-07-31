// The world tileset: 8x8 tiles authored as digit strings.
//
// Digits are shades 0 (lightest) .. 3 (darkest) within whatever palette slot the
// material draws with; "." is transparent. Edge variants (shorelines, roof
// outlines, path kerbs) are generated in code rather than hand-drawn sixteen
// times each.

import { TRANSPARENT } from './gfx.js';

export const TILE = 8;

/** Bit flags for which sides of a tile border a different material. */
export const N = 1;
export const E = 2;
export const S = 4;
export const W = 8;

function parse(spec, size = TILE) {
  const rows = spec.split('/');
  if (rows.length !== size) throw new Error(`tile needs ${size} rows, got ${rows.length}`);
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) {
    if (rows[y].length !== size) throw new Error(`tile row ${y} needs ${size} chars: "${rows[y]}"`);
    for (let x = 0; x < size; x++) {
      const ch = rows[y][x];
      out[y * size + x] = ch === '.' ? TRANSPARENT : ch.charCodeAt(0) - 48;
    }
  }
  return out;
}

class TilesetBuilder {
  constructor(size = TILE) {
    this.size = size;
    this.tiles = [];
    this.id = Object.create(null);
  }

  addPixels(name, pixels) {
    if (name in this.id) throw new Error(`duplicate tile "${name}"`);
    this.id[name] = this.tiles.length;
    this.tiles.push(pixels);
    return this.id[name];
  }

  add(name, spec) {
    return this.addPixels(name, parse(spec, this.size));
  }

  /** Add `name` plus 16 edge-masked variants named `name@<mask>`. */
  addWithEdges(name, spec, painter) {
    const base = parse(spec, this.size);
    this.addPixels(name, base);
    for (let mask = 0; mask < 16; mask++) {
      const px = base.slice();
      if (mask & N) painter(px, 'N', this.size);
      if (mask & E) painter(px, 'E', this.size);
      if (mask & S) painter(px, 'S', this.size);
      if (mask & W) painter(px, 'W', this.size);
      this.addPixels(`${name}@${mask}`, px);
    }
    return this.id[name];
  }

  build() {
    const { size } = this;
    const data = new Uint8Array(this.tiles.length * size * size);
    this.tiles.forEach((t, i) => data.set(t, i * size * size));
    return { size, data, id: this.id, count: this.tiles.length };
  }
}

/** Walk the pixels along one side of a tile. */
function sideCells(side, size) {
  const cells = [];
  for (let i = 0; i < size; i++) {
    if (side === 'N') cells.push([i, 0], [i, 1]);
    else if (side === 'S') cells.push([i, size - 1], [i, size - 2]);
    else if (side === 'W') cells.push([0, i], [1, i]);
    else cells.push([size - 1, i], [size - 2, i]);
  }
  return cells;
}

/** Solid 1px rim in `shade`, used for building roofs. */
const rim = (shade) => (px, side, size) => {
  sideCells(side, size).forEach(([x, y], idx) => {
    if (idx % 2 === 0) px[y * size + x] = shade;
  });
};

/** Foam: a bright broken rim plus scattered second-row speckle. */
const foam = (px, side, size) => {
  sideCells(side, size).forEach(([x, y], idx) => {
    const outer = idx % 2 === 0;
    if (outer) px[y * size + x] = 0;
    else if ((x + y) % 3 === 0) px[y * size + x] = 1;
  });
};

/**
 * Kerb: a solid darker rim around paths and plazas. It has to be solid, not
 * dotted: on the real DMG palette shades 0 and 1 are nearly the same green, so
 * a pale path on pale lawn is only legible because of its edges.
 */
const kerb = (px, side, size) => {
  sideCells(side, size).forEach(([x, y], idx) => {
    if (idx % 2 === 0) px[y * size + x] = 2;
  });
};

const b = new TilesetBuilder();

// --- ground ---------------------------------------------------------------
b.add('grass0', '11111111/11111111/11111111/11111111/11111111/11111111/11111111/11111111');
b.add('grass1', '11111111/11121111/11111111/11111111/11111211/11111111/11111111/12111111');
b.add('grass2', '11111111/11111111/11121211/11112111/11111111/21211111/12111111/11111111');
b.add('grass3', '11111111/11211111/11111111/11111121/11111111/12111111/11111111/11111112');
b.add('lawnA', '00000000/00000000/00010000/00000000/00000000/00000100/00000000/00000000');
b.add('lawnMow', '00000000/00000000/00000000/00000000/00000000/00000000/00000000/01010101');
b.add('lawnB', '11111111/11111111/11101111/11111111/11111111/11111011/11111111/11111111');
b.add('meadow', '11111111/12111211/11211121/11111111/21112111/11211112/11111111/12111211');
b.add('forest', '22222222/22322222/22222222/22222322/22222222/23222222/22222222/22222232');
b.add('farm', '11111111/11111111/22222222/11111111/11111111/22222222/11111111/11111111');
b.add('sand', '11111111/11011111/11111111/11111101/11111111/10111111/11111111/11111110');
b.add('marsh', '11111111/13111311/11311131/11111111/11131111/13111131/11111111/13111311');

// --- water ----------------------------------------------------------------
b.addWithEdges('water', '22222222/23322222/22222222/22222222/22222332/22222222/23322222/22222222', foam);
b.addWithEdges('waterDeep', '33333333/33333333/32233333/33333333/33333333/33333322/33333333/33333333', foam);

// --- built surfaces -------------------------------------------------------
b.addWithEdges('path', '00000000/00000000/00010000/00000000/00000000/00000100/00000000/00000000', kerb);
b.addWithEdges('plaza', '11111111/00010001/00010001/00010001/11111111/01000100/01000100/01000100', kerb);
b.add('road', '22222222/22222222/22322222/22222222/22222222/22222232/22222222/22222222');
b.add('roadDashH', '22222222/22222222/22222222/00002222/00002222/22222222/22222222/22222222');
b.add('roadDashV', '22200222/22200222/22200222/22200222/22222222/22222222/22222222/22222222');
b.add('parking', '22222222/22222222/22222222/22222222/22222222/22222222/22222222/22222222');
b.add('parkingLine', '00222222/00222222/00222222/00222222/00222222/00222222/22222222/22222222');
b.add('rail', '22222222/33333333/22222222/20202020/22222222/33333333/22222222/22222222');
b.add('pitch', '11111111/11111111/11111111/11111111/11111111/11111111/11111111/11111111');
b.add('pitchLine', '11111111/11111111/11111111/00000000/11111111/11111111/11111111/11111111');
b.add('steps', '00000000/22222222/00000000/22222222/00000000/22222222/00000000/22222222');

// --- structures -----------------------------------------------------------
b.addWithEdges('roof', '11111111/11111111/10111111/11111111/11111111/11111101/11111111/11111111', rim(3));
b.addWithEdges('roofTall', '11111111/12111121/11211211/11121111/11112111/12111121/11211211/11121111', rim(3));
b.add('roofRidge', '22222222/22222222/00000000/22222222/22222222/00000000/22222222/22222222');
// Seams break a large footprint into bays, so a 150m quadrangle reads as a
// building rather than a coloured blob.
b.add('roofSeamH', '11111111/11111111/11111111/22222222/11111111/11111111/11111111/11111111');
b.add('roofSeamV', '11121111/11121111/11121111/11121111/11121111/11121111/11121111/11121111');
b.add('door', '22222222/20000002/20333302/20333302/20333302/20333302/20333302/20333302');
b.add('wall', '00000000/11111111/13311331/11111111/13311331/11111111/13311331/11111111');

// --- vegetation and barriers ---------------------------------------------
b.add('tree0', '..3333../.311113./31111113/31122113/32212223/.322223./...33.../...33...');
b.add('tree1', '..3333../.311113./31121113/31222123/32222223/.322233./...33.../..333...');
b.add('bush', '......../..3333../.311113./.312213./.322223./..3333../......../........');
b.add('hedge', '23322332/33233233/32333233/23322332/33233323/32333233/23322332/33233233');
b.add('fence', '......../......../33333333/3......3/......../......../......../........');

export const TILESET = b.build();
export const T = TILESET.id;

/** Deterministic per-tile noise so variants do not shimmer between frames. */
export function tileHash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Pick one of a list of tile names using the deterministic hash. */
export function variant(names, x, y) {
  return T[names[Math.floor(tileHash(x, y) * names.length) % names.length]];
}
