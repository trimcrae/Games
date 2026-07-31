// Character and marker sprites. Digits are shades within the sprite's palette
// slot, "." is transparent.
//
// The walker is 12x16 drawn on the CHAR slot: 0 skin, 1 shirt, 2 trousers,
// 3 outline/hair.

import { TRANSPARENT } from '../../engine/gfx.js';

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
