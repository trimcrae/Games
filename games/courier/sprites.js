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
 * Where you collect: a taped parcel on a short post.
 *
 * Both markers are 12x16 with their foot on the bottom row, so the one swaps
 * for the other mid-job without appearing to jump. They are on posts for the
 * same reason the Explorer's landmark signs are: these maps are drawn in a
 * shallow three-quarter view and anything lying flat on the ground disappears
 * into a sandstone roof. A vertical stroke is what makes a marker findable.
 */
export const PICKUP = sprite([
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
  '.....33.....',
  '.....33.....',
  '.....33.....',
  '....3333....',
  '...333333...',
  '............',
]);

/** Where it goes. A flag, which reads as a destination rather than as cargo. */
export const DROP = sprite([
  '..33333333..',
  '..30000003..',
  '..300000003.',
  '..3000000003',
  '..300000003.',
  '..30000003..',
  '..33333333..',
  '..33........',
  '..33........',
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
const ARROW_W = 13;

/** One arrow head pointing along `angle` (screen radians, y down). */
function arrowOps(angle) {
  const c = (ARROW_W - 1) / 2;
  const at = (spread, d) => [
    Math.round(c + Math.cos(angle + spread) * d),
    Math.round(c + Math.sin(angle + spread) * d),
  ];
  const dart = (r) => [at(0, r), at(2.45, r * 0.92), at(Math.PI, r * 0.3), at(-2.45, r * 0.92)];
  // A dark disc under a bright dart. The first version was a pale outline
  // around a dark head, and over a tan sandstone roof - which is most of
  // Stanford - it vanished completely. A badge cannot be subtle: it is the
  // only thing telling the player which way to go.
  return [
    ['e', c, c, c, c, 3],
    ['p', dart(c - 0.6), 3],
    ['p', dart(c - 2), 1],
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
    ['d', 0, 2, 64, 22, 0, 1, 1], // haze, so the rider is not floating on paper
    // the road, with the kerb line and lane dashes under the wheels
    ['r', 0, 40, 64, 8, 2],
    ['l', 0, 40, 63, 40, 3],
    ['g', 2, 44, 5, 1, 14, 0, 8, 1, 0],
    // speed lines coming off the back of the rider
    ['l', 0, 14, 9, 14, 2],
    ['l', 2, 21, 13, 21, 2],
    ['l', 0, 28, 7, 28, 2],
    // wheels, resting on the kerb line
    ['E', 16, 34, 6, 6, 3],
    ['E', 46, 34, 6, 6, 3],
    ['E', 16, 34, 2, 2, 2],
    ['E', 46, 34, 2, 2, 2],
    // frame: chainstay, seat tube, down tube, top tube, fork, bars
    ['l', 16, 34, 30, 35, 3],
    ['l', 17, 33, 30, 34, 3],
    ['l', 30, 35, 26, 23, 3],
    ['l', 31, 35, 27, 23, 3],
    ['l', 30, 35, 41, 25, 3],
    ['l', 31, 35, 42, 25, 3],
    ['l', 26, 23, 41, 25, 3],
    ['l', 46, 34, 43, 23, 3],
    ['l', 47, 34, 44, 23, 3],
    ['l', 42, 22, 50, 19, 3],
    ['r', 22, 21, 8, 2, 3], // saddle
    // rider, up out of the saddle and leaning on the bars
    ['p', [[25, 23], [30, 11], [36, 13], [33, 24]], 1],
    ['l', 25, 23, 30, 11, 3],
    ['l', 36, 13, 33, 24, 3],
    ['l', 30, 11, 36, 13, 3],
    ['l', 33, 24, 25, 23, 3],
    ['l', 35, 14, 48, 20, 3], // arm to the grips
    ['l', 35, 15, 48, 21, 3],
    ['l', 35, 12, 38, 11, 3], // neck
    ['e', 40, 10, 3, 3, 3], // head
    ['r', 41, 10, 2, 2, 0], // cheek, which is what turns the blob into a face
    ['l', 43, 8, 45, 9, 3], // the peak of a cap, jutting into the wind
    // The near leg is drawn in the jersey's own shade rather than in ink: the
    // frame behind it is solid black, and a black leg over a black frame is no
    // leg at all.
    ['l', 28, 24, 33, 30, 1],
    ['l', 29, 24, 34, 30, 1],
    ['l', 33, 30, 30, 35, 1],
    ['l', 34, 30, 31, 35, 1],
    ['r', 29, 34, 4, 2, 3], // shoe on the pedal
    // The parcel on the rack: the one light shape in a dark silhouette, so it
    // is the first thing read at any scale. One tape band and a flap seam
    // rather than a full cross - a cross of 1px lines reads as a window.
    ['r', 10, 18, 14, 11, 0],
    ['o', 10, 18, 14, 11, 3],
    ['r', 15, 18, 3, 11, 2],
    ['l', 10, 21, 23, 21, 2],
    ['r', 11, 24, 3, 3, 1],
  ],
};
