// Markers, the compass arrow and the cover art for CAMPUS COURIER.
//
// The walker and the bicycle themselves are imported from the Explorer
// cartridge's sprite sheet (see movement.js): it is the same person on the same
// streets, so drawing a second one would only make the two games look like
// different worlds. Everything here is what the courier adds on top - the two
// job markers, the edge-of-screen compass, and the parcel pip in the HUD.
//
// Digits are shades within the sprite's palette slot, "." is transparent.

import { TRANSPARENT } from '../../engine/gfx.js';
import { rasterizeOps } from '../../engine/art.js';

/** Row-string sprite, as in games/explorer/sprites.js. */
function sprite(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const px = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`ragged sprite row ${y}: "${row}"`);
    for (let x = 0; x < w; x++) px[y * w + x] = row[x] === '.' ? TRANSPARENT : row[x].charCodeAt(0) - 48;
  });
  return { w, h, px };
}

/** Draw-op sprite on a transparent field, for anything with an angle in it. */
function opSprite(ops, w, h) {
  return { w, h, px: rasterizeOps(ops, w, h, TRANSPARENT) };
}

/**
 * Where you collect. A taped parcel standing on the pavement, 12x14 with the
 * feet on the bottom row so it shares an anchor with DROP below - the two
 * markers swap over mid-job and must not appear to jump.
 */
export const PICKUP = sprite([
  '............',
  '............',
  '..33333333..',
  '..30022003..',
  '..30022003..',
  '..30022003..',
  '..33322333..',
  '..33322333..',
  '..30022003..',
  '..30022003..',
  '..33333333..',
  '...3....3...',
  '............',
  '............',
]);

/** Where it goes. A flag, which reads as a destination rather than as cargo. */
export const DROP = sprite([
  '..3333333...',
  '..30000003..',
  '..300000003.',
  '..3000000003',
  '..300000003.',
  '..30000003..',
  '..3333333...',
  '..33........',
  '..33........',
  '..33........',
  '..33........',
  '.3333.......',
  '333333......',
  '............',
]);

/** Parcel pip for the HUD: lit while you are carrying something. */
export const PARCEL_PIP = sprite([
  '3333333',
  '3002003',
  '3332333',
  '3002003',
  '3333333',
]);

// --- the compass -----------------------------------------------------------
//
// On a 200-pixel screen the delivery is almost always off-screen, so the only
// honest way to steer is an arrow pinned to the edge of the view. It has to be
// legible over grass, tarmac and a brick roof alike, so it is drawn as a dark
// head inside a light halo rather than as a flat silhouette.
//
// Sixteen fixed headings are pre-rasterized at load. Rotating a nine-pixel
// triangle per frame would cost more and look worse: at this size the rounding
// is the art, and baking it means every frame of a given heading is identical
// instead of shimmering as the player turns.

const HEADINGS = 16;
const ARROW_W = 11;

/** One arrow head pointing along `angle` (screen radians, y down). */
function arrowOps(angle) {
  const c = (ARROW_W - 1) / 2;
  const at = (spread, d) => [
    Math.round(c + Math.cos(angle + spread) * d),
    Math.round(c + Math.sin(angle + spread) * d),
  ];
  // The halo is the same dart grown by a pixel; drawing it first and the dark
  // head over it gives a 1px outline without hand-cutting sixteen of them.
  const dart = (r) => [at(0, r), at(2.45, r * 0.92), at(Math.PI, r * 0.3), at(-2.45, r * 0.92)];
  return [
    ['p', dart(c), 0],
    ['p', dart(c - 1.4), 3],
  ];
}

/** Arrow heads by heading index, from `headingIndex`. */
export const ARROWS = Array.from({ length: HEADINGS }, (_, k) =>
  opSprite(arrowOps((k / HEADINGS) * Math.PI * 2), ARROW_W, ARROW_W),
);

/**
 * Which pre-baked arrow points closest to (dx, dy) in screen space.
 * @param {number} dx
 * @param {number} dy
 * @returns {number} index into ARROWS
 */
export function headingIndex(dx, dy) {
  const a = Math.atan2(dy, dx);
  return ((Math.round((a / (Math.PI * 2)) * HEADINGS) % HEADINGS) + HEADINGS) % HEADINGS;
}

/** Bobbing chevron drawn over a marker that is already on screen. */
export const CHEVRON = sprite([
  '0000000',
  '0333330',
  '.03330.',
  '..030..',
]);

// --- cover art -------------------------------------------------------------

/**
 * The cartridge's icon, in the draw-op format the launcher expects (see
 * engine/art.js). A rider hunched over the bars with a parcel on the rack,
 * kerb and lane markings under the wheels, speed lines behind: the whole game
 * in one picture, and no text, since the launcher prints the title anyway.
 */
export const ICON_ART = {
  w: 64,
  h: 48,
  bg: 0,
  ops: [
    ['r', 0, 0, 64, 48, 0],
    ['d', 0, 0, 64, 24, 0, 1, 1], // haze, so the rider is not floating on paper
    // road
    ['r', 0, 40, 64, 8, 2],
    ['l', 0, 40, 63, 40, 3],
    ['g', 3, 44, 5, 1, 14, 0, 8, 1, 0],
    // speed lines
    ['l', 1, 16, 11, 16, 2],
    ['l', 3, 22, 15, 22, 2],
    ['l', 0, 28, 9, 28, 2],
    // wheels
    ['E', 17, 34, 7, 7, 3],
    ['E', 47, 34, 7, 7, 3],
    ['E', 17, 34, 3, 3, 2],
    ['E', 47, 34, 3, 3, 2],
    // frame, fork and bars
    ['l', 17, 34, 32, 35, 3],
    ['l', 32, 35, 27, 22, 3],
    ['l', 32, 35, 41, 24, 3],
    ['l', 27, 22, 41, 24, 3],
    ['l', 47, 34, 44, 21, 3],
    ['l', 41, 22, 50, 19, 3],
    ['r', 24, 20, 7, 2, 3], // saddle
    // parcel on the rack, over the back wheel
    ['r', 13, 20, 12, 10, 0],
    ['o', 13, 20, 12, 10, 3],
    ['l', 19, 20, 19, 29, 2],
    ['l', 13, 25, 24, 25, 2],
    // rider, leaning on the bars
    ['p', [[26, 22], [31, 9], [38, 11], [35, 24]], 1],
    ['l', 26, 22, 31, 9, 3],
    ['l', 38, 11, 35, 24, 3],
    ['l', 31, 9, 38, 11, 3],
    ['l', 37, 12, 49, 19, 3],
    ['l', 38, 13, 50, 20, 3],
    ['e', 43, 8, 4, 4, 3],
    ['r', 41, 6, 5, 3, 0],
    ['r', 43, 7, 1, 1, 3],
    ['l', 29, 23, 35, 30, 2],
    ['l', 30, 23, 36, 30, 2],
    ['l', 35, 30, 32, 35, 2],
    ['l', 36, 30, 33, 35, 2],
    ['o', 4, 4, 56, 40, 3],
  ],
};
