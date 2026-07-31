// Cover art for the cartridge menu, as draw ops (see engine/art.js).
// Shade 0 is the lightest of the slot's four, 3 the darkest, so on a night
// scene the sea is 3 and everything that matters - the beam, the lamp, the
// ship - is 0.

export const ICON_ART = {
  w: 64,
  h: 48,
  bg: 3,
  ops: [
    ['r', 0, 0, 64, 48, 3],

    // a thin sky, a few stars, and a sea that dithers away toward the horizon
    ['r', 4, 3, 1, 1, 1],
    ['r', 19, 8, 1, 1, 1],
    ['r', 31, 2, 1, 1, 1],
    ['r', 57, 6, 1, 1, 1],
    ['r', 11, 14, 1, 1, 1],
    ['d', 0, 30, 64, 18, 3, 2, 1],
    ['l', 0, 30, 63, 30, 2],

    // the sweep, wide and soft, with a harder core down the middle
    ['p', [[45, 14], [1, 1], [0, 15]], 1],
    ['p', [[45, 14], [9, 4], [5, 11]], 0],

    // a ship caught in it, heeling away
    ['p', [[7, 27], [21, 26], [18, 31], [10, 31]], 0],
    ['l', 14, 19, 15, 26, 0],
    ['l', 15, 20, 19, 25, 0],
    ['l', 6, 32, 22, 32, 1],

    // the reef it is heading for
    ['p', [[24, 48], [30, 43], [36, 41], [44, 40], [54, 41], [60, 44], [64, 48]], 2],
    ['r', 28, 45, 5, 1, 3],
    ['r', 56, 44, 5, 1, 3],
    ['r', 36, 42, 3, 1, 1],

    // the tower: properly tapered, banded, with a door for scale
    ['p', [[43, 18], [49, 18], [54, 44], [38, 44]], 1],
    ['r', 42, 24, 8, 4, 2],
    ['r', 40, 33, 12, 4, 2],
    ['r', 38, 42, 16, 2, 2],
    ['l', 43, 18, 38, 44, 3],
    ['l', 49, 18, 54, 44, 3],
    ['r', 44, 39, 4, 5, 3],

    // gallery, lamp room, cap, finial
    ['r', 40, 17, 13, 2, 3],
    ['r', 42, 11, 9, 6, 0],
    ['o', 41, 10, 11, 8, 3],
    ['r', 40, 9, 13, 1, 3],
    ['r', 45, 6, 3, 3, 3],
  ],
};
