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
    ...backdrop(76),

    // arcaded base
    ['r', 30, 58, 68, 18, 1],
    ['r', 84, 58, 14, 18, 2],
    ['o', 30, 58, 68, 18, 3],
    ['g', 34, 64, 7, 1, 9, 0, 5, 12, 3],
    ['l', 30, 62, 97, 62, 2],

    // shaft: tall and narrow, this tower is 285 feet of very little floor area
    ['r', 55, 18, 18, 42, 1],
    ['r', 68, 18, 5, 42, 2],
    ['o', 55, 18, 18, 42, 3],
    ['l', 59, 22, 59, 58, 2],
    ['l', 63, 22, 63, 58, 2],
    ['l', 67, 22, 67, 58, 2],
    ['g', 57, 26, 2, 3, 9, 12, 3, 5, 3],

    // observation gallery and its cornice
    ['r', 50, 18, 28, 3, 3],
    ['r', 52, 10, 24, 8, 1],
    ['r', 71, 10, 5, 8, 2],
    ['o', 52, 10, 24, 8, 3],
    ['g', 55, 12, 4, 1, 6, 0, 3, 6, 3],
    ['r', 50, 8, 28, 2, 3],

    // tiled dome and finial
    ['e', 64, 8, 11, 6, 2],
    ['E', 64, 8, 11, 6, 3],
    ['r', 53, 7, 22, 2, 3],
    ['r', 63, 0, 2, 4, 3],
    ['l', 60, 4, 68, 4, 3],

    ...tree(13, 66, 10, 10),
    ...tree(114, 68, 9, 8),
    ...tree(101, 70, 6, 6),
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

// --- shared building blocks ------------------------------------------------

/** A boxy building with a window grid and a shaded right face. */
const block = (x, y, w, h, { cols = 4, rows = 2, shade = true } = {}) => {
  const ops = [['r', x, y, w, h, 1]];
  if (shade) ops.push(['r', x + w - Math.max(4, w >> 3), y, Math.max(4, w >> 3), h, 2]);
  ops.push(['o', x, y, w, h, 3]);
  if (cols < 1 || rows < 1) return ops;
  const gapX = Math.floor((w - 6) / cols);
  const gapY = Math.floor((h - 8) / rows);
  if (gapX > 3 && gapY > 3) ops.push(['g', x + 4, y + 5, cols, rows, gapX, gapY, Math.min(5, gapX - 2), Math.min(6, gapY - 2), 3]);
  return ops;
};

/** A pitched roof sitting on a block. */
const gable = (x, y, w, h) => [
  ['t', x + w / 2, y, x - 2, y + h, x + w + 2, y + h, 2],
  ['l', x + w / 2, y, x - 2, y + h, 3],
  ['l', x + w / 2, y, x + w + 2, y + h, 3],
  ['r', x - 2, y + h - 1, w + 4, 2, 3],
];

/** Water with a horizon and a few ripple strokes. */
const water = (y, h) => {
  const ops = [['r', 0, y, PANEL_W, h, 2], ['l', 0, y, PANEL_W - 1, y, 3]];
  for (let i = 0; i < 9; i++) {
    const ry = y + 5 + ((i * 7) % Math.max(1, h - 6));
    const rx = 6 + ((i * 29) % (PANEL_W - 30));
    ops.push(['l', rx, ry, rx + 10 + (i % 3) * 5, ry, i % 2 ? 1 : 3]);
  }
  return ops;
};

Object.assign(ART, {
  // Stanford Memorial Church: mosaic front, arcade, rose window.
  church: panel([
    ...backdrop(74),
    ...block(20, 34, 88, 40, { cols: 0, rows: 0 }),
    ...gable(34, 12, 60, 22),
    ['r', 34, 34, 60, 40, 1],
    ['o', 34, 34, 60, 40, 3],
    ['e', 64, 30, 9, 8, 2],
    ['E', 64, 30, 9, 8, 3],
    ['l', 64, 22, 64, 38, 3],
    ['l', 55, 30, 73, 30, 3],
    ['g', 40, 44, 3, 1, 16, 0, 10, 16, 2],
    ['g', 42, 46, 3, 1, 16, 0, 6, 14, 3],
    ['r', 58, 56, 12, 18, 3],
    ['e', 64, 56, 6, 5, 3],
    ...tree(10, 64, 9, 10),
    ...tree(118, 66, 9, 8),
  ]),

  // A sandstone quadrangle seen along its arcade.
  quad: panel([
    ...backdrop(66),
    ['r', 0, 30, PANEL_W, 36, 1],
    ['r', 0, 30, PANEL_W, 4, 2],
    ['l', 0, 30, PANEL_W - 1, 30, 3],
    ['l', 0, 66, PANEL_W - 1, 66, 3],
    ['g', 4, 38, 8, 1, 16, 0, 11, 28, 3],
    ['g', 6, 34, 8, 1, 16, 0, 7, 6, 2],
    ['r', 0, 24, PANEL_W, 7, 2],
    ['l', 0, 24, PANEL_W - 1, 24, 3],
    ['d', 0, 66, PANEL_W, 22, 1, 2, 1],
    ['r', 52, 66, 24, 22, 0],
    ['o', 52, 66, 24, 22, 2],
  ]),

  // The Oval: palms down the drive, lawn ring, quad in the distance.
  oval: panel([
    ...backdrop(52),
    ['r', 0, 44, PANEL_W, 10, 1],
    ['o', 20, 40, 88, 10, 2],
    ['r', 0, 54, PANEL_W, 34, 1],
    ['d', 0, 54, PANEL_W, 34, 1, 0, 2],
    ['E', 64, 74, 46, 16, 2],
    ['E', 64, 74, 30, 10, 2],
    ...[14, 30, 98, 114].flatMap((x, i) => [
      ['r', x, 30 + (i % 2) * 4, 3, 34, 3],
      ['e', x + 1, 30 + (i % 2) * 4, 9, 4, 3],
      ['e', x + 1, 33 + (i % 2) * 4, 7, 3, 2],
    ]),
  ]),

  // Museum with a columned portico.
  museum: panel([
    ...backdrop(72),
    ...block(14, 34, 100, 38, { cols: 0, rows: 0 }),
    ['r', 30, 26, 68, 10, 2],
    ['t', 64, 14, 26, 27, 102, 27, 1],
    ['l', 64, 14, 26, 27, 3],
    ['l', 64, 14, 102, 27, 3],
    ['r', 26, 26, 76, 2, 3],
    ['g', 32, 36, 6, 1, 11, 0, 5, 28, 2],
    ['g', 32, 36, 6, 1, 11, 0, 2, 28, 3],
    ['r', 56, 56, 16, 16, 3],
    ['r', 14, 72, 100, 4, 2],
    ...tree(8, 64, 7, 8),
    ...tree(120, 66, 7, 7),
  ]),

  // Bronze figures on plinths in a garden.
  rodin: panel([
    ...backdrop(64),
    ['r', 0, 40, PANEL_W, 24, 1],
    ['d', 0, 40, PANEL_W, 24, 1, 2, 1],
    ['r', 34, 8, 30, 52, 3],
    ['o', 34, 8, 30, 52, 2],
    ['g', 37, 12, 2, 4, 13, 12, 10, 9, 2],
    ['r', 30, 60, 38, 5, 2],
    ['o', 30, 60, 38, 5, 3],
    ['p', [[86, 62], [90, 34], [96, 24], [100, 34], [102, 62]], 3],
    ['e', 94, 22, 5, 5, 3],
    ['r', 82, 62, 24, 5, 2],
    ['o', 82, 62, 24, 5, 3],
    ['d', 0, 68, PANEL_W, 20, 1, 2, 2],
    ...tree(12, 50, 9, 12),
  ]),

  // Library: a long reading-room facade.
  library: panel([
    ...backdrop(74),
    ...block(8, 26, 112, 48, { cols: 7, rows: 3 }),
    ['r', 4, 22, 120, 5, 2],
    ['o', 4, 22, 120, 5, 3],
    ['r', 52, 54, 24, 20, 3],
    ['r', 56, 58, 16, 16, 0],
    ['o', 56, 58, 16, 16, 3],
    ['r', 40, 74, 48, 4, 2],
    ...tree(14, 66, 8, 8),
    ...tree(114, 68, 8, 7),
  ]),

  // Stadium bowl seen from outside.
  stadium: panel([
    ...backdrop(70),
    ['E', 64, 60, 60, 34, 3],
    ['p', [[10, 60], [24, 34], [104, 34], [118, 60], [104, 70], [24, 70]], 1],
    ['p', [[24, 34], [104, 34], [104, 40], [24, 40]], 2],
    ['o', 10, 34, 108, 36, 3],
    ['g', 16, 44, 12, 2, 8, 10, 5, 7, 2],
    ['e', 64, 30, 34, 8, 0],
    ['E', 64, 30, 34, 8, 2],
    ['r', 20, 70, 88, 4, 2],
    ['r', 60, 26, 3, 8, 3],
    ['r', 62, 24, 8, 4, 3],
  ]),

  // A modern arena: curved roof, glass front.
  arena: panel([
    ...backdrop(72),
    ['e', 64, 52, 56, 26, 1],
    ['p', [[8, 52], [120, 52], [120, 72], [8, 72]], 1],
    ['e', 64, 52, 56, 26, 1],
    ['E', 64, 52, 56, 26, 3],
    ['r', 8, 52, 112, 20, 1],
    ['r', 100, 52, 20, 20, 2],
    ['o', 8, 52, 112, 20, 3],
    ['g', 14, 56, 8, 1, 13, 0, 8, 12, 2],
    ['g', 16, 58, 8, 1, 13, 0, 4, 8, 3],
    ['r', 54, 60, 20, 12, 3],
    ['e', 64, 26, 40, 10, 2],
    ['E', 64, 26, 40, 10, 3],
    ['r', 8, 72, 112, 3, 2],
  ]),

  // Office tower with a computing-lab glow.
  tower: panel([
    ...backdrop(74),
    ...block(16, 46, 40, 28, { cols: 3, rows: 2 }),
    ...block(60, 14, 46, 60, { cols: 4, rows: 6 }),
    ['r', 58, 10, 50, 5, 2],
    ['o', 58, 10, 50, 5, 3],
    ['r', 74, 62, 16, 12, 3],
    ...tree(10, 68, 8, 7),
  ]),

  // Bronze tiger on a plinth.
  tiger: panel([
    ...backdrop(70),
    ['r', 0, 40, PANEL_W, 30, 1],
    ['d', 0, 40, PANEL_W, 30, 1, 2, 1],
    ['p', [[36, 58], [42, 40], [56, 34], [76, 34], [92, 42], [96, 58]], 3],
    ['p', [[88, 40], [102, 26], [106, 32], [96, 44]], 3],
    ['e', 42, 34, 10, 9, 3],
    ['e', 39, 32, 3, 2, 0],
    ['e', 46, 32, 3, 2, 0],
    ['r', 40, 58, 6, 10, 3],
    ['r', 54, 58, 6, 10, 3],
    ['r', 74, 58, 6, 10, 3],
    ['r', 86, 58, 6, 10, 3],
    ['g', 58, 38, 4, 1, 8, 0, 3, 14, 2],
    ['r', 28, 68, 76, 8, 2],
    ['o', 28, 68, 76, 8, 3],
  ]),

  // A plaza ringed by shopfronts.
  plazaScene: panel([
    ...backdrop(58),
    ...block(0, 24, 46, 34, { cols: 3, rows: 2 }),
    ...block(82, 20, 46, 38, { cols: 3, rows: 3 }),
    ...block(46, 30, 36, 28, { cols: 2, rows: 2 }),
    ['r', 0, 58, PANEL_W, 30, 0],
    ['d', 0, 58, PANEL_W, 30, 0, 1, 2],
    ['g', 0, 62, 9, 3, 15, 9, 13, 7, 1],
    ['r', 58, 66, 14, 3, 3],
    ['r', 63, 69, 4, 10, 3],
    ['e', 65, 64, 12, 4, 2],
  ]),

  // A bay: reeds, open water, a far shore.
  bay: panel([
    ['r', 0, 0, PANEL_W, PANEL_H, 0],
    ['d', 0, 0, PANEL_W, 20, 0, 1, 1],
    ['r', 0, 30, PANEL_W, 4, 2],
    ...water(34, 34),
    ['r', 0, 68, PANEL_W, 20, 1],
    ['d', 0, 68, PANEL_W, 20, 1, 2, 2],
    ...[6, 14, 20, 108, 118].flatMap((x) => [
      ['l', x, 88, x - 1, 62, 3],
      ['l', x + 3, 88, x + 5, 66, 3],
      ['e', x - 1, 60, 2, 4, 3],
    ]),
    ['p', [[70, 44], [84, 44], [82, 40], [72, 40]], 3],
    ['l', 76, 40, 76, 30, 3],
    ['p', [[76, 30], [88, 38], [76, 38]], 2],
    ['e', 30, 26, 4, 2, 3],
    ['e', 44, 20, 5, 2, 3],
  ]),

  // A long low mall behind its car park.
  mall: panel([
    ...backdrop(56),
    ['r', 6, 30, 116, 26, 1],
    ['r', 104, 30, 18, 26, 2],
    ['o', 6, 30, 116, 26, 3],
    ['r', 6, 26, 116, 5, 2],
    ['o', 6, 26, 116, 5, 3],
    ['g', 12, 38, 7, 1, 15, 0, 9, 12, 3],
    ['r', 48, 44, 20, 12, 3],
    ['r', 0, 56, PANEL_W, 32, 2],
    ['g', 4, 62, 8, 3, 15, 9, 10, 6, 1],
    ['l', 0, 60, PANEL_W - 1, 60, 1],
    ['r', 20, 12, 4, 18, 3],
    ['r', 12, 6, 20, 8, 1],
    ['o', 12, 6, 20, 8, 3],
  ]),

  // A pond between sandbars.
  pond: panel([
    ['r', 0, 0, PANEL_W, PANEL_H, 0],
    ['d', 0, 0, PANEL_W, 22, 0, 1, 1],
    ['r', 0, 26, PANEL_W, 6, 1],
    ['d', 0, 26, PANEL_W, 6, 1, 2, 2],
    ...water(32, 40),
    ['r', 0, 72, PANEL_W, 16, 1],
    ['d', 0, 72, PANEL_W, 16, 1, 0, 2],
    ...tree(16, 22, 8, 6),
    ...tree(104, 20, 9, 8),
    ['p', [[44, 62], [72, 62], [68, 58], [48, 58]], 3],
    ['l', 58, 58, 58, 48, 3],
    ['l', 58, 48, 68, 56, 2],
  ]),

  // A canal with its towpath.
  canal: panel([
    ...backdrop(40),
    ['r', 0, 40, PANEL_W, 8, 1],
    ...water(48, 22),
    ['r', 0, 70, PANEL_W, 18, 1],
    ['d', 0, 70, PANEL_W, 18, 1, 0, 2],
    ['l', 0, 74, PANEL_W - 1, 74, 2],
    ['l', 0, 80, PANEL_W - 1, 80, 2],
    ['p', [[30, 58], [86, 58], [82, 52], [34, 52]], 3],
    ['r', 44, 46, 26, 7, 2],
    ['o', 44, 46, 26, 7, 3],
    ...tree(12, 34, 9, 8),
    ...tree(110, 32, 10, 9),
  ]),

  // Civic building with a flag.
  townhall: panel([
    ...backdrop(74),
    ...block(18, 34, 92, 40, { cols: 5, rows: 2 }),
    ['t', 64, 18, 14, 34, 114, 34, 2],
    ['l', 64, 18, 14, 34, 3],
    ['l', 64, 18, 114, 34, 3],
    ['r', 14, 33, 100, 2, 3],
    ['r', 62, 4, 2, 14, 3],
    ['p', [[64, 5], [80, 9], [64, 13]], 2],
    ['r', 54, 56, 20, 18, 3],
    ['r', 58, 60, 12, 14, 0],
    ['r', 18, 74, 92, 4, 2],
  ]),

  // Roadside drive-in with a big sign.
  diner: panel([
    ...backdrop(66),
    ['r', 24, 38, 80, 28, 1],
    ['r', 92, 38, 12, 28, 2],
    ['o', 24, 38, 80, 28, 3],
    ['r', 20, 34, 88, 5, 3],
    ['g', 30, 44, 4, 1, 16, 0, 11, 10, 2],
    ['r', 56, 56, 16, 10, 3],
    ['r', 96, 8, 4, 26, 3],
    ['r', 78, 2, 40, 14, 1],
    ['o', 78, 2, 40, 14, 3],
    ['g', 82, 6, 5, 1, 7, 0, 4, 6, 3],
    ['r', 0, 66, PANEL_W, 22, 2],
    ['l', 0, 70, PANEL_W - 1, 70, 1],
    ['g', 6, 74, 6, 1, 20, 0, 12, 8, 1],
  ]),

  // School with its clock and buses.
  school: panel([
    ...backdrop(70),
    ...block(10, 32, 108, 38, { cols: 7, rows: 2 }),
    ['r', 6, 28, 116, 5, 2],
    ['o', 6, 28, 116, 5, 3],
    ['r', 56, 16, 16, 14, 1],
    ['o', 56, 16, 16, 14, 3],
    ['e', 64, 23, 5, 5, 0],
    ['E', 64, 23, 5, 5, 3],
    ['r', 56, 54, 16, 16, 3],
    ['r', 0, 70, PANEL_W, 18, 2],
    ['r', 8, 72, 30, 10, 1],
    ['o', 8, 72, 30, 10, 3],
    ['e', 14, 82, 3, 3, 3],
    ['e', 32, 82, 3, 3, 3],
  ]),

  // Fallback: a signpost, used if a landmark has no art yet.
  placeholder: panel([
    ...backdrop(70),
    ['r', 60, 30, 5, 40, 3],
    ['r', 38, 20, 50, 16, 1],
    ['o', 38, 20, 50, 16, 3],
    ['e', 63, 26, 4, 4, 3],
    ...tree(20, 62, 10, 9),
    ...tree(106, 64, 9, 8),
  ]),
});

/** Cartridge cover art for the launcher: a folded map with a pin. */
export const ICON_ART = {
  w: 64,
  h: 48,
  bg: 0,
  ops: [
    ['r', 0, 0, 64, 48, 0],
    ['p', [[4, 8], [22, 4], [42, 10], [60, 5], [60, 42], [42, 46], [22, 40], [4, 44]], 1],
    ['l', 22, 4, 22, 40, 2],
    ['l', 42, 10, 42, 46, 2],
    ['o', 4, 4, 56, 42, 3],
    ['l', 6, 30, 24, 22, 2],
    ['l', 24, 22, 40, 28, 2],
    ['l', 40, 28, 58, 18, 2],
    ['e', 34, 20, 9, 9, 3],
    ['e', 34, 18, 4, 4, 0],
    ['p', [[34, 34], [29, 24], [39, 24]], 3],
  ],
};
