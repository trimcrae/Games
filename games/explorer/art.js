// Hand-drawn landmark panels.
//
// Each panel is a list of draw ops (see engine/art.js) rasterized to 128x88
// indices: 0 lightest .. 3 darkest. These are the fallback for landmarks with
// no freely-licensed photograph, and the alternative style to photo panels.

export const PANEL_W = 128;
export const PANEL_H = 88;

const panel = (ops) => ({ w: PANEL_W, h: PANEL_H, bg: 0, ops });

/** Sky wash, ground band and a horizon, shared by most panels. */
const backdrop = (horizon = 68) => [
  ['r', 0, 0, PANEL_W, PANEL_H, 0],
  ['d', 0, 0, PANEL_W, 18, 0, 1, 1],
  ['r', 0, horizon, PANEL_W, PANEL_H - horizon, 1],
  ['d', 0, horizon, PANEL_W, PANEL_H - horizon, 1, 2, 1],
  ['l', 0, horizon, PANEL_W - 1, horizon, 2],
];

/** A round tree: canopy, shadow side, trunk. */
const tree = (x, y, r, h = 8) => [
  ['e', x, y, r, r - 1, 3],
  ['e', x - 2, y - 2, r - 3, r - 4, 2],
  ['r', x - 1, y + r - 2, 3, h, 3],
];

export const ART = {
  // Herbert Hoover Memorial Tower: a slim shaft, an open belfry, a tiled cap.
  hooverTower: panel([
    ...backdrop(70),

    // base building
    ['r', 34, 52, 60, 20, 1],
    ['r', 80, 52, 14, 20, 2],
    ['o', 34, 52, 60, 20, 3],
    ['g', 38, 57, 6, 1, 8, 0, 4, 8, 3],
    ['r', 60, 62, 8, 10, 3],

    // shaft
    ['r', 52, 26, 24, 28, 1],
    ['r', 69, 26, 7, 28, 2],
    ['o', 52, 26, 24, 28, 3],
    ['l', 57, 28, 57, 52, 2],
    ['l', 62, 28, 62, 52, 2],
    ['l', 67, 28, 67, 52, 2],

    // cornice above the shaft
    ['r', 48, 22, 32, 4, 3],
    ['r', 50, 20, 28, 2, 2],

    // belfry, open on all sides
    ['r', 51, 10, 26, 11, 1],
    ['r', 70, 10, 7, 11, 2],
    ['o', 51, 10, 26, 11, 3],
    ['g', 54, 12, 4, 1, 6, 0, 4, 8, 3],

    // tiled cap and finial
    ['t', 64, 0, 46, 10, 82, 10, 2],
    ['l', 64, 0, 46, 10, 3],
    ['l', 64, 0, 82, 10, 3],
    ['r', 46, 9, 36, 2, 3],
    ['r', 63, 0, 2, 3, 3],

    ...tree(14, 62, 11, 10),
    ...tree(112, 64, 10, 8),
    ...tree(98, 66, 7, 6),
  ]),

  // Albert Paley's Sentinel: curling weathered steel against the brick campus.
  sentinel: panel([
    ...backdrop(72),

    // low brick buildings behind
    ['r', 0, 50, 44, 22, 1],
    ['o', 0, 50, 44, 22, 2],
    ['g', 4, 55, 5, 2, 8, 9, 5, 5, 2],
    ['r', 88, 54, 40, 18, 1],
    ['o', 88, 54, 40, 18, 2],
    ['g', 92, 58, 4, 1, 9, 0, 5, 5, 2],

    // the sculpture: heavy ribbons of steel
    ['p', [[58, 72], [66, 72], [70, 40], [64, 8], [58, 10], [63, 40]], 3],
    ['p', [[64, 46], [80, 30], [92, 14], [84, 12], [72, 28], [60, 40]], 3],
    ['p', [[62, 44], [46, 30], [34, 18], [42, 15], [54, 28], [66, 38]], 3],
    ['p', [[64, 26], [76, 16], [86, 20], [70, 30]], 2],
    ['p', [[62, 24], [50, 14], [40, 20], [58, 28]], 2],
    ['e', 64, 20, 6, 5, 3],
    ['e', 63, 18, 3, 2, 2],

    // plinth and its shadow
    ['r', 52, 70, 24, 6, 2],
    ['o', 52, 70, 24, 6, 3],
    ['e', 64, 78, 22, 4, 2],

    ...tree(20, 60, 9, 8),
    ...tree(108, 58, 10, 9),
  ]),
};
