// Moving through a compiled map, on foot and on a bicycle.
//
// This is the movement that used to live inside the Explorer cartridge's
// WorldScene, in among its landmarks, its travel hubs, its save format and its
// HUD. The second cartridge could not reach any of it without being that scene,
// so it grew a parallel copy - and with it a second copy of the one number in
// the whole game that is genuinely dangerous to get wrong (see MAX_STEP below).
// A body knows where it is, what is solid, and how fast a bicycle goes. It has
// no opinion about what the player is riding towards.
//
// It lives beside the map compiler rather than inside it: engine/geo.js turns
// geography into a tilemap and answers questions about one, and a bicycle's
// spin-up rate is not a question about geography.
//
// DOM-free, so a headless harness can make a body, step it, and assert on where
// it ended up without a console, a canvas or a frame loop anywhere in sight.

import { MAT } from './geo.js';
import { TILE } from './tiles.js';
import { SFX, BIKE_SFX } from './audio.js';

// Speeds are multiples of the map's own walk speed rather than absolutes, so a
// 12 m/tile town and a 6 m/tile campus both end up feeling right.
//
// One consequence of these particular numbers is worth knowing before you play:
// a run is 2.1x walking pace and a bike off the tarmac is only 1.45x, so on
// grass you are genuinely faster on your feet. Cutting a corner across a lawn
// means getting off.
const RUN_MULT = 2.1;
const BIKE_PAVED = 2.9; // roads, paths, plazas, car parks
const BIKE_ROUGH = 1.45; // grass, woods, sand, steps - slower than a run
const BIKE_ACCEL = 230; // px/s^2, spin-up
const BIKE_COAST = 330; // px/s^2, freewheeling with nothing held
const BIKE_BRAKE = 780; // px/s^2, B held

/**
 * Half-width of the feet box, in pixels, derived from the tile size rather than
 * written down: the box is the largest odd square that still *fits* inside one
 * tile, which at 8px tiles is 7px across.
 *
 * That one pixel matters enormously. The box was once nine wide, and a nine
 * pixel box always straddles two tile columns, so every path exactly one tile
 * across - which on a 6 m/tile campus is most of them - was impassable, and
 * Stanford's start point resolved into a courtyard with no way out of it.
 */
const HALF = Math.floor((TILE - 1) / 2);

/**
 * The most any one collision test may advance, in pixels.
 *
 * This is the load-bearing invariant of the whole thing. Consecutive tests must
 * overlap by enough that no solid tile can fall between two of them and be
 * missed, so a step is capped at the box's own half-width: at 8px tiles that is
 * three pixels, tests three pixels apart still overlap by four, and nothing can
 * hide in the gap. A frame at bike speed covers far more ground than that, so a
 * move is split into substeps rather than tested once.
 *
 * This is the only place the number is derived. tools/playtest.mjs proves the
 * result against the game's own collision test on every tile of every map.
 */
const MAX_STEP = HALF;

/** Materials a bicycle rolls properly on. Everything else costs two thirds of your speed. */
const PAVED = new Set([MAT.road, MAT.path, MAT.plaza, MAT.parking]);

/** Top speed on the bike, for a HUD speed meter. */
export const bikeTopSpeed = (map) => map.walkSpeed * BIKE_PAVED;

/**
 * A body that can walk or ride around a compiled map.
 *
 * Holds every bit of state the movement needs. Sound is played through the
 * console passed to `update`; pass null and it moves in silence.
 */
export class Body {
  /**
   * @param {object} map compiled by engine/geo.js
   * @param {number} x world pixels
   * @param {number} y
   * @param {object} [opts]
   * @param {boolean} [opts.riding=false] start in the saddle
   */
  constructor(map, x, y, { riding = false } = {}) {
    this.map = map;
    this.x = x;
    this.y = y;
    this.dir = 'down';
    this.riding = riding;
    this.running = false;
    this.rough = false;
    this.speed = 0; // px/s along (hx, hy), on the bike
    this.hx = 0;
    this.hy = 1;
    this.animT = 0;
    this.stepT = 0;
    this.bumped = false; // set on the frame a move was stopped by something
  }

  /**
   * Feet-box collision: the player's shoes, not the whole sprite.
   *
   * Four corners is exact here rather than approximate - a box narrower than a
   * tile can only ever touch a 2x2 block of tiles, and the corners sample every
   * one of them.
   */
  blocked(x, y) {
    const top = y - HALF;
    const bottom = y + HALF;
    for (const [cx, cy] of [
      [x - HALF, top],
      [x + HALF, top],
      [x - HALF, bottom],
      [x + HALF, bottom],
    ]) {
      if (this.map.solidAt(Math.floor(cx / TILE), Math.floor(cy / TILE))) return true;
    }
    return false;
  }

  /**
   * Move by a pixel delta. Each axis resolves separately, so a diagonal into a
   * wall still slides along it, and the whole move is split into substeps of at
   * most MAX_STEP px so that bike speed cannot put the body out the far side of
   * a solid tile in one frame.
   * @returns {number} how far it actually got, which is less than asked for
   *   when something was in the way
   */
  step(nx, ny) {
    const parts = Math.max(1, Math.ceil(Math.max(Math.abs(nx), Math.abs(ny)) / MAX_STEP));
    const sx = nx / parts;
    const sy = ny / parts;
    const x0 = this.x;
    const y0 = this.y;
    for (let i = 0; i < parts; i++) {
      if (sx && !this.blocked(this.x + sx, this.y)) this.x += sx;
      if (sy && !this.blocked(this.x, this.y + sy)) this.y += sy;
    }
    return Math.hypot(this.x - x0, this.y - y0);
  }

  /** True where a bicycle rolls properly: roads, paths, plazas, car parks. */
  paved(x, y) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.map.w || ty >= this.map.h) return false;
    return PAVED.has(this.map.mat[ty * this.map.w + tx]);
  }

  /** @param {boolean} [quiet] mount without ringing the bell */
  mount(sys, quiet = false) {
    this.riding = true;
    this.speed = 0;
    this.animT = 0;
    this.stepT = 0;
    if (!quiet && sys) BIKE_SFX.bell(sys.audio);
  }

  dismount(sys) {
    this.riding = false;
    this.speed = 0;
    this.animT = 0;
    if (sys) BIKE_SFX.rack(sys.audio);
  }

  /** On foot. B is run. */
  walk(dt, dx, dy, sys, run) {
    this.running = run;
    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      const speed = this.map.walkSpeed * (run ? RUN_MULT : 1) * dt;
      this.step((dx / len) * speed, (dy / len) * speed);
      this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      this.animT += dt * (run ? 1.7 : 1);
      this.stepT += dt;
      if (this.stepT > (run ? 0.18 : 0.3)) {
        this.stepT = 0;
        if (sys) SFX.step(sys.audio);
      }
    } else {
      this.animT = 0;
      this.stepT = 0.28;
    }
  }

  /**
   * On the bike: a short spin-up and a coast-down rather than an instant top
   * speed, which is the whole difference between a bicycle and a fast walk. B
   * is the brake and stops you in about a fifth of a second, so arriving on a
   * doorstep - or on a landmark post - at speed is still possible.
   */
  ride(dt, dx, dy, sys, brake) {
    this.running = false;
    this.rough = !this.paved(this.x, this.y);
    const top = this.map.walkSpeed * (this.rough ? BIKE_ROUGH : BIKE_PAVED);

    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      this.hx = dx / len;
      this.hy = dy / len;
      this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      this.speed = Math.min(top, this.speed + BIKE_ACCEL * dt);
    } else {
      this.speed = Math.max(0, this.speed - BIKE_COAST * dt);
    }
    if (brake) this.speed = Math.max(0, this.speed - BIKE_BRAKE * dt);
    // Rolling off the tarmac scrubs speed off over a moment rather than
    // stopping you dead, which is the polite way to teach the surface rule.
    if (this.speed > top) this.speed = Math.max(top, this.speed - BIKE_COAST * dt);

    if (this.speed <= 0) {
      this.animT = 0;
      this.stepT = 0.3;
      return;
    }

    const want = this.speed * dt;
    const got = this.step(this.hx * want, this.hy * want);
    if (got < want * 0.3) {
      // Into a wall, a hedge or the water. Stop, and say so if it was a real hit.
      if (this.speed > this.map.walkSpeed) {
        this.bumped = true;
        if (sys) SFX.bump(sys.audio);
      }
      this.speed = 0;
    }

    // Pedalling and tyre noise both follow the actual speed, so freewheeling to
    // a halt looks and sounds like freewheeling to a halt.
    this.animT += dt * (0.5 + this.speed / (this.map.walkSpeed * 1.2));
    this.stepT += dt;
    const interval = Math.max(0.09, 0.34 - this.speed / 900);
    if (this.speed > 8 && this.stepT > interval) {
      this.stepT = 0;
      if (sys) BIKE_SFX.tyre(sys.audio, this.rough);
    }
  }

  /**
   * One frame of movement.
   * @param {number} dt seconds
   * @param {object|null} sys the console, for sound; omit it headlessly
   * @param {{dx:number, dy:number, b:boolean}} controls B is run on foot, brake on the bike
   */
  update(dt, sys, { dx = 0, dy = 0, b = false } = {}) {
    this.bumped = false;
    if (this.riding) this.ride(dt, dx, dy, sys, b);
    else this.walk(dt, dx, dy, sys, b);
    // Never off the edge of the world.
    this.x = Math.max(4, Math.min(this.map.w * TILE - 4, this.x));
    this.y = Math.max(8, Math.min(this.map.h * TILE - 4, this.y));
  }
}
