// The world tileset: 8x8 tiles authored as digit strings.
//
// Digits are shades 0 (lightest) .. 3 (darkest) within whatever palette slot the
// material draws with; "." is transparent. Edge variants (shorelines, roof
// outlines, path kerbs) are generated in code rather than hand-drawn sixteen
// times each.
//
// The world is drawn in a shallow three-quarter view, lit from the north-west:
// the southern rows of a building footprint become a *facade* rather than roof,
// north and west rims catch a highlight, south and east rims darken, and ground
// cells to the south/east of anything tall take a dithered shadow overlay.
// Everything here is authored with that one light direction in mind.

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

/** Paint the outermost line of one side, optionally the line just inside it. */
function border(px, side, size, outer, inner) {
  for (let i = 0; i < size; i++) {
    const o = side === 'N' ? [i, 0] : side === 'S' ? [i, size - 1] : side === 'W' ? [0, i] : [size - 1, i];
    if (outer !== null) px[o[1] * size + o[0]] = outer;
    if (inner === null || i === 0 || i === size - 1) continue;
    const j = side === 'N' ? [i, 1] : side === 'S' ? [i, size - 2] : side === 'W' ? [1, i] : [size - 2, i];
    px[j[1] * size + j[0]] = inner;
  }
}

/**
 * Building rim, lit from the north-west. Every side keeps a hard shade-3 ink
 * line so a roof never bleeds into the grass; inside that line the north and
 * west catch a highlight and the south and east fall into shade. That one
 * asymmetry is what stops a 25x20 footprint reading as a flat coloured slab.
 */
const roofRim = (px, side, size) => {
  if (side === 'N') border(px, side, size, 3, 0);
  else if (side === 'W') border(px, side, size, 3, 0);
  else if (side === 'E') border(px, side, size, 3, 2);
  else border(px, side, size, 3, 2);
};

/** Facades only ever meet neighbours left and right; top and bottom are drawn in. */
const wallRim = (px, side, size) => {
  if (side === 'W') border(px, side, size, 3, 1);
  else if (side === 'E') border(px, side, size, 3, null);
};

/** Woods get the same lighting treatment as buildings, one step softer. */
const canopyRim = (px, side, size) => {
  if (side === 'N') border(px, side, size, 3, 1);
  else if (side === 'W') border(px, side, size, 3, 1);
  else border(px, side, size, 3, null);
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
//
// Ground is deliberately almost flat. Variation comes from picking between
// these tiles over *patches* several tiles across (see geo.js), so a field
// reads as tonal drift rather than as per-tile confetti.
b.add('grass', '11111111/11111111/11111111/11111111/11111111/11111111/11111111/11111111');
b.add('grassPale', '01110111/11111111/11011101/11111111/01110111/11111111/11011101/11111111');
b.add('grassDeep', '21112111/11111111/11211121/11111111/21112111/11111111/11211121/11111111');
b.add('grassTuft', '11111111/11111111/11121111/11211111/11111111/11111211/11112111/11111111');

// Mown lawn: broad alternating stripes, the way a groundsman leaves it.
b.add('lawn', '00000000/00000000/00000000/00000000/00000000/00000000/00000000/00000000');
b.add('lawnStripe', '10101010/00000000/10101010/00000000/10101010/00000000/10101010/00000000');
b.add('lawnEdge', '00000000/00000000/00000000/00000000/00000000/00000000/00000000/11111111');

b.add('meadow', '11111111/11111111/11121111/11111111/11111111/11112111/11111111/11111111');
b.add('meadowFlower', '11111111/11011111/11111111/11111011/11111111/10111111/11111111/11111101');
b.add('farm', '11111111/11111111/22222222/11111111/11111111/22222222/11111111/11111111');
b.add('sand', '11111111/11111111/11011111/11111111/11111111/11111101/11111111/11111111');
b.add('marsh', '11111111/11311131/11111111/13111311/11111111/11311131/11111111/13111311');

// --- water ----------------------------------------------------------------
b.addWithEdges('water', '22222222/23322222/22222222/22222222/22222332/22222222/23322222/22222222', foam);
b.addWithEdges('waterDeep', '33333333/33333333/32233333/33333333/33333333/33333322/33333333/33333333', foam);

// --- built surfaces -------------------------------------------------------
b.addWithEdges('path', '00000000/00000000/00000000/00000000/00000000/00000000/00000000/00000000', kerb);
b.addWithEdges('plaza', '11111111/00010001/00010001/00010001/11111111/01000100/01000100/01000100', kerb);
b.add('road', '22222222/22222222/22222222/22222222/22222222/22222222/22222222/22222222');
b.add('roadGrit', '22222222/22222222/22322222/22222222/22222222/22222232/22222222/22222222');
b.add('roadDashH', '22222222/22222222/22222222/00002222/00002222/22222222/22222222/22222222');
b.add('roadDashV', '22200222/22200222/22200222/22200222/22222222/22222222/22222222/22222222');
b.add('parking', '22222222/22222222/22222222/22222222/22222222/22222222/22222222/22222222');
b.add('parkingLine', '00222222/00222222/00222222/00222222/00222222/00222222/22222222/22222222');
b.add('rail', '22222222/33333333/22222222/20202020/22222222/33333333/22222222/22222222');
b.add('pitch', '11111111/11111111/11111111/11111111/11111111/11111111/11111111/11111111');
b.add('pitchStripe', '11211121/11111111/11211121/11111111/11211121/11111111/11211121/11111111');
b.add('pitchLine', '11111111/11111111/11111111/00000000/11111111/11111111/11111111/11111111');
b.add('steps', '00000000/22222222/00000000/22222222/00000000/22222222/00000000/22222222');

// --- structures -----------------------------------------------------------
//
// Roofs are flat on purpose: the shape reads from the rim lighting and from the
// facade below, not from a texture. `roofWeather` and the rooftop plant give
// large footprints something to look at without turning into wallpaper.
b.addWithEdges('roof', '11111111/11111111/11111111/11111111/11111111/11111111/11111111/11111111', roofRim);
b.addWithEdges('roofWeather', '11111111/11111111/11211121/11111111/11111111/12111211/11111111/11111111', roofRim);
// The roof course that sits directly on top of a facade: its lower rows fall
// into the eaves shadow, so the wall below reads as being in front of it.
b.addWithEdges('roofEave', '11111111/11111111/11111111/11111111/11111111/11111111/22222222/22222222', roofRim);
b.add('roofPlant', '11111111/12222211/12000211/12000211/12000211/12222211/13333311/11111111');
b.add('roofLight', '11111111/11111111/11122111/11122111/11111111/11111111/11111111/11111111');
b.add('roofVent', '11111111/11111111/11222111/12000211/12000211/13333311/11111111/11111111');

// Facades. Storeys stack on an 8px rhythm: `wallHi` carries the eaves shadow,
// `wallLo` the line where the wall meets the ground.
const WALL_MID = '22222222/22222222/23322332/23322332/23322332/21122112/22222222/22222222';
b.addWithEdges('wallMid', WALL_MID, wallRim);
b.addWithEdges('wallHi', '33333333/22222222/23322332/23322332/23322332/21122112/22222222/22222222', wallRim);
b.addWithEdges('wallLo', '22222222/22222222/23322332/23322332/23322332/21122112/22222222/33333333', wallRim);
b.addWithEdges('wallDoor', '22222222/22222222/22222222/22111122/22333322/22333322/22333322/33333333', wallRim);
b.addWithEdges('wallOne', '33333333/22222222/23322332/23322332/23322332/21122112/22222222/33333333', wallRim);
b.addWithEdges('wallOneDoor', '33333333/22222222/22222222/22111122/22333322/22333322/22333322/33333333', wallRim);

// --- vegetation and barriers ---------------------------------------------
//
// A wood is a mass with an outline, not a field of individual trees; the crowns
// below are drawn as a *second pass* over it so they can overlap the mass.
b.addWithEdges('canopy', '21122112/11211211/12211221/22122122/21122112/11211211/12211221/22122122', canopyRim);
b.add('crown0', '..0110../.011113./01111113/01112213/02122223/.222233./..3333../...33...');
b.add('crown1', '.01111../011111.3/0111213./01122123/02222233/.322333./..333.../..33....');
b.add('crown2', '......../..0110../.011113./01122113/02122233/.222333./..333.../........');
b.add('bush', '......../..0110../.011113./.012213./.222233./..3333../......../........');
b.add('hedge', '00000000/12211221/21122112/12211221/21122112/12211221/21122112/33333333');
b.add('fence', '......../......../33333333/3......3/......../......../......../........');

// --- shadow overlays ------------------------------------------------------
//
// Drawn as a second pass over the ground tile in the *ground's own* palette
// slot at shade 3, so a shadow is always a darker version of whatever it falls
// on and stays visible on the monochrome looks too. Density fades away from the
// caster, which is what makes an ordered dither read as a soft edge rather than
// as a pattern.
b.add('shadowN', '333.333./.333.333/3.3.3.3./.3.3.3.3/3...3.../..3...3./......../........');
b.add('shadowW', '333.3.../3..3..../333..3../.3.3..../333.3.../3..3..../333..3../.3.3....');
b.add('shadowNW', '333.333./3333.333/333.3.3./.3.3.3.3/333.3.../3.3...3./333..3../.3.3....');
b.add('shadowDiag', '33.3..../3.3...../.3....../3......./......../......../......../........');

export const TILESET = b.build();
export const T = TILESET.id;

/** Deterministic per-tile noise so variants do not shimmer between frames. */
export function tileHash(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * Low-frequency noise: constant across a `size`-tile block, then smoothed
 * against its neighbours so the blocks do not read as a checkerboard. This is
 * what gives ground cover variation at the scale of a field instead of a tile.
 */
export function patchHash(x, y, size = 5) {
  const bx = Math.floor(x / size);
  const by = Math.floor(y / size);
  const fx = (x - bx * size) / size;
  const fy = (y - by * size) / size;
  const a = tileHash(bx, by);
  const c = tileHash(bx + 1, by);
  const d = tileHash(bx, by + 1);
  const e = tileHash(bx + 1, by + 1);
  const top = a + (c - a) * fx;
  const bot = d + (e - d) * fx;
  return top + (bot - top) * fy;
}

/** Pick one of a list of tile names using the deterministic hash. */
export function variant(names, x, y) {
  return T[names[Math.floor(tileHash(x, y) * names.length) % names.length]];
}
