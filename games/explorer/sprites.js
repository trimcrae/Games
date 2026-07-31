// Character and marker sprites. Digits are shades within the sprite's palette
// slot, "." is transparent.
//
// The walker is 12x16 drawn on the CHAR slot: 0 skin, 1 shirt, 2 trousers,
// 3 outline/hair. The rider on the bike uses the same four shades, so the two
// read as the same person.

import { TRANSPARENT } from '../../engine/gfx.js';
import { rasterizeOps } from '../../engine/art.js';

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

/**
 * Same sprite shape, but authored as a draw-op list (see engine/art.js) on a
 * transparent field. A bicycle is circles and struts; rows of digits are the
 * wrong tool for it, and ops let the pedalling frames be generated from an
 * angle rather than redrawn by hand four times.
 */
function opSprite(ops, w, h) {
  return { w, h, px: rasterizeOps(ops, w, h, TRANSPARENT) };
}

const DOWN = [
  '....3333....',
  '...333333...',
  '..33333333..',
  '..30000003..',
  '..30300303..',
  '..30000003..',
  '...300003...',
  '..31111113..',
  '.3111111113.',
  '.3011111103.',
  '.3011111103.',
  '..31111113..',
  '..32222223..',
  '..32222223..',
];
const UP = [
  '....3333....',
  '...333333...',
  '..33333333..',
  '..33333333..',
  '..33333333..',
  '..33333333..',
  '...333333...',
  '..31111113..',
  '.3111111113.',
  '.3011111103.',
  '.3011111103.',
  '..31111113..',
  '..32222223..',
  '..32222223..',
];
const SIDE = [
  '...33333....',
  '..3333333...',
  '.333333333..',
  '.330000003..',
  '.330300003..',
  '.330000003..',
  '..30000003..',
  '..31111113..',
  '.311111113..',
  '.301111113..',
  '.301111113..',
  '..31111113..',
  '..32222223..',
  '..32222223..',
];

/** Legs for each animation frame, appended under the 14-row body. */
const LEGS = {
  stand: ['..322..223..', '..333..333..'],
  stepA: ['..3222.223..', '..3333.333..'],
  stepB: ['..322.2223..', '..333.3333..'],
};

function walker(body, legs) {
  return sprite([...body, ...LEGS[legs]]);
}

export const PLAYER = {
  down: [walker(DOWN, 'stand'), walker(DOWN, 'stepA'), walker(DOWN, 'stand'), walker(DOWN, 'stepB')],
  up: [walker(UP, 'stand'), walker(UP, 'stepA'), walker(UP, 'stand'), walker(UP, 'stepB')],
  right: [walker(SIDE, 'stand'), walker(SIDE, 'stepA'), walker(SIDE, 'stand'), walker(SIDE, 'stepB')],
};
PLAYER.left = PLAYER.right; // drawn flipped

/** Signpost marking a point of interest, on the ACCENT slot. */
export const MARKER = sprite([
  '.111111.',
  '13333331',
  '13011031',
  '13000031',
  '13011031',
  '13333331',
  '.111111.',
  '...33...',
  '...33...',
  '...33...',
]);

/** Same post, once its landmark has been read. */
export const MARKER_SEEN = sprite([
  '.111111.',
  '12222221',
  '12033021',
  '12300232',
  '12033021',
  '12222221',
  '.111111.',
  '...22...',
  '...22...',
  '...22...',
]);

// --- the bicycle -----------------------------------------------------------
//
// Same four CHAR shades as the walker (0 skin, 1 shirt, 2 trousers, 3 ink), and
// the same 16px height, so `PLAYER` and `BIKE` can be drawn with one anchor and
// swapping between them does not make the rider jump.
//
// Frames are generated from a crank angle rather than drawn four times. The
// side view pedals a real circle; the front and back views alternate the knees
// and sway the shoulders a pixel each way, which is what a rider actually does.

const TAU = Math.PI * 2;
const BIKE_FRAMES = 4;

/** Thick 2px limb: two parallel lines, offset along the shorter axis. */
function limb(x0, y0, x1, y1, c) {
  const across = Math.abs(x1 - x0) >= Math.abs(y1 - y0) ? [0, 1] : [1, 0];
  return [
    ['l', x0, y0, x1, y1, c],
    ['l', x0 + across[0], y0 + across[1], x1 + across[0], y1 + across[1], c],
  ];
}

/**
 * Side-on rider, nose to the right; 16x16 with the tyres on the bottom row.
 * @param {number} k frame index
 */
function bikeSide(k) {
  const a = (k / BIKE_FRAMES) * TAU;
  const crank = [8, 13];
  const r = 2;
  const near = [Math.round(crank[0] + r * Math.cos(a)), Math.round(crank[1] + r * Math.sin(a))];
  const far = [Math.round(crank[0] - r * Math.cos(a)), Math.round(crank[1] - r * Math.sin(a))];
  const hip = [5, 10];
  const knee = (p) => [Math.round((hip[0] + p[0]) / 2) + 2, Math.round((hip[1] + p[1]) / 2) - 1];
  // The rider rises a shade on the downstroke; 1px is plenty at this size.
  const bob = k === 1 ? -1 : 0;
  const kn = knee(near);
  const kf = knee(far);
  // One spoke per wheel, turning with the road rather than with the cranks, so
  // the wheels read as geared instead of as filled discs.
  const s = (k / BIKE_FRAMES) * (TAU / 2) + 0.5;
  const spoke = (cx, cy) => [
    ['l', Math.round(cx - 2 * Math.cos(s)), Math.round(cy - 2 * Math.sin(s)), Math.round(cx + 2 * Math.cos(s)), Math.round(cy + 2 * Math.sin(s)), 3],
  ];
  return [
    // wheels
    ...spoke(3, 12),
    ...spoke(12, 12),
    ['E', 3, 12, 3, 3, 3],
    ['E', 12, 12, 3, 3, 3],
    // far leg, behind the frame, in silhouette
    ['l', hip[0], hip[1] + bob, kf[0], kf[1], 3],
    ['l', kf[0], kf[1], far[0], far[1], 3],
    // frame: chainstay, seat tube, down tube, top tube, fork
    ['l', 3, 12, 8, 13, 3],
    ['l', 8, 13, 5, 9 + bob, 3],
    ['l', 8, 13, 12, 8, 3],
    ['l', 5, 9 + bob, 12, 8, 3],
    ['l', 12, 7, 12, 12, 3],
    ['E', 8, 13, 1, 1, 3],
    ['r', 3, 8 + bob, 4, 1, 3], // saddle
    ['l', 11, 6, 14, 6, 3], // handlebar
    // rider: torso in shirt with an ink edge, then head and arm
    ['p', [[4, 10 + bob], [6, 3 + bob], [9, 4 + bob], [8, 11 + bob]], 1],
    ['l', 4, 10 + bob, 6, 3 + bob, 3],
    ['l', 9, 4 + bob, 8, 11 + bob, 3],
    ['l', 6, 3 + bob, 9, 4 + bob, 3],
    ['e', 10, 2 + bob, 2, 2, 3],
    ['r', 10, 2 + bob, 3, 2, 0],
    ['r', 11, 2 + bob, 1, 1, 3],
    ...limb(8, 4 + bob, 12, 6, 1),
    ['r', 12, 5, 2, 2, 0],
    // near leg, over the frame
    ...limb(hip[0], hip[1] + bob, kn[0], kn[1], 2),
    ...limb(kn[0], kn[1], near[0], near[1], 2),
    ['r', near[0] - 1, near[1] + 1, 3, 1, 3], // pedal
  ];
}

/**
 * Head-on (`front`) or from behind; 14x16. The wheel is edge-on between the
 * feet, the bars run wide under the elbows, and the knees pump out of phase.
 */
function bikeFace(k, front) {
  const lift = [1, 0, -1, 0][k];
  const lean = [0, 1, 0, -1][k];
  const bx = 6 + lean; // the upper body drifts with the lean
  const legL = 4 + lift;
  const legR = 4 - lift;
  const head = front
    ? [
        ['e', bx, 2, 3, 2, 3],
        ['r', bx - 2, 2, 5, 3, 0],
        ['r', bx - 1, 3, 1, 1, 3],
        ['r', bx + 1, 3, 1, 1, 3],
      ]
    : [['e', bx, 2, 3, 2, 3]];
  return [
    // legs, behind the bars
    ['r', 2, 10, 3, legL, 2],
    ['r', 2, 10 + legL - 1, 3, 1, 3],
    ['r', 9, 10, 3, legR, 2],
    ['r', 9, 10 + legR - 1, 3, 1, 3],
    // wheel, edge on, with the fork either side
    ['r', 6, 11, 2, 5, 3],
    ['r', 6, 13, 2, 1, 2],
    ['l', 5, 11, 5, 14, 3],
    ['l', 8, 11, 8, 14, 3],
    // bars
    ['r', 6, 9, 2, 2, 3],
    ['r', 1, 10, 12, 1, 3],
    ['r', 0, 9, 2, 3, 3],
    ['r', 12, 9, 2, 3, 3],
    // torso: shirt with an ink edge down each side, not a full outline, or the
    // 7px-wide body would be all outline and no rider.
    ['r', bx - 3, 5, 7, 5, 1],
    ['l', bx - 3, 5, bx + 3, 5, 3],
    ['l', bx - 3, 5, bx - 3, 9, 3],
    ['l', bx + 3, 5, bx + 3, 9, 3],
    front ? ['r', bx - 1, 8, 2, 2, 3] : ['l', bx, 6, bx, 9, 3],
    // arms, out and down to the grips
    ['l', bx - 3, 6, 1, 9, 1],
    ['l', bx + 3, 6, 12, 9, 1],
    ...head,
  ];
}

const sideFrames = [];
const downFrames = [];
const upFrames = [];
for (let k = 0; k < BIKE_FRAMES; k++) {
  sideFrames.push(opSprite(bikeSide(k), 16, 16));
  downFrames.push(opSprite(bikeFace(k, true), 14, 16));
  upFrames.push(opSprite(bikeFace(k, false), 14, 16));
}

/** The rider, keyed the same way as PLAYER so the draw code does not branch. */
export const BIKE = {
  down: downFrames,
  up: upFrames,
  right: sideFrames,
};
BIKE.left = BIKE.right; // drawn flipped

/**
 * A bike rack, on the ACCENT slot like the landmark posts: dark steel hoops (3)
 * with a bright bike racked against them (1). The bike is the light shape and
 * the rack the dark one, so the silhouette still reads over a brick building or
 * a lawn - which is most of what these maps are made of. Stanford has one of
 * these outside every door.
 */
export const RACK = opSprite(
  [
    // steel hoops, behind
    ['l', 0, 2, 0, 10, 3],
    ['l', 0, 2, 4, 2, 3],
    ['l', 4, 2, 4, 10, 3],
    ['l', 7, 2, 7, 10, 3],
    ['l', 7, 2, 11, 2, 3],
    ['l', 11, 2, 11, 10, 3],
    ['r', 0, 10, 12, 2, 3],
    // a bike racked against them
    ['E', 3, 8, 2, 2, 1],
    ['E', 9, 8, 2, 2, 1],
    ['l', 3, 8, 6, 9, 1],
    ['l', 6, 9, 4, 5, 1],
    ['l', 6, 9, 9, 7, 1],
    ['l', 4, 5, 9, 6, 1],
    ['l', 9, 6, 9, 8, 1],
    ['r', 3, 4, 3, 1, 1],
    ['r', 8, 5, 3, 1, 1],
  ],
  12,
  12,
);

/** Tiny bike for the HUD, drawn on whatever slot the caller picks. */
export const BIKE_ICON = opSprite(
  [
    ['E', 2, 4, 2, 2, 3],
    ['E', 8, 4, 2, 2, 3],
    ['l', 2, 4, 5, 5, 3],
    ['l', 5, 5, 3, 1, 3],
    ['l', 5, 5, 8, 2, 3],
    ['l', 3, 1, 8, 2, 3],
    ['l', 8, 2, 8, 4, 3],
    ['r', 2, 0, 3, 1, 3],
    ['r', 7, 0, 2, 1, 3],
  ],
  11,
  7,
);

/** Small bobbing "!" shown when a landmark is in reach. */
export const HINT = sprite([
  '.3333.',
  '.3113.',
  '.3113.',
  '.3113.',
  '.3333.',
  '.3333.',
  '..33..',
  '.3333.',
  '.3113.',
  '.3333.',
]);
