// Getting about, on foot and on the bike.
//
// This is the Explorer cartridge's movement, lifted out of its WorldScene into
// something a second game can hold. The numbers are deliberately identical -
// the same run multiplier, the same paved and rough bike speeds, the same
// spin-up, coast and brake, the same three-pixel substep and the same seven
// pixel feet box - because the point of the exercise is that the two cartridges
// are the same person walking the same streets. What has changed is only the
// shape: WorldScene owns its position and does its own collision, so nothing
// else can move a body through a compiled map without being that scene.
//
// One consequence of keeping the numbers honest is worth knowing before you
// play: a run is 2.1x walking pace and a bike off the tarmac is only 1.45x, so
// on grass you are genuinely faster on your feet. Cutting a corner across a
// lawn means getting off, and that is the whole tactical layer of the game.

import { MAT } from '../../engine/geo.js';
import { TILE } from '../../engine/tiles.js';
import { SFX } from '../../engine/audio.js';
import { PLAYER, BIKE } from '../explorer/sprites.js';

const RUN_MULT = 2.1;
const BIKE_PAVED = 2.9;
const BIKE_ROUGH = 1.45;
const BIKE_ACCEL = 230; // px/s^2, spin-up
const BIKE_COAST = 330; // px/s^2, freewheeling with nothing held
const BIKE_BRAKE = 780; // px/s^2, B held

/**
 * The most any one collision test may advance. Tiles are 8px and the feet box
 * is 7px across, so tests three pixels apart still overlap and no solid tile
 * can fall between two of them. A frame at bike speed covers far more ground
 * than that, so a move is split into substeps rather than tested once.
 */
const MAX_STEP = 3;

/** Materials a bicycle rolls properly on. */
const PAVED = new Set([MAT.road, MAT.path, MAT.plaza, MAT.parking]);

/** Top speed on the bike, for the HUD's speed meter. */
export const bikeTopSpeed = (map) => map.walkSpeed * BIKE_PAVED;

/**
 * Sounds for the bike. The Explorer has its own copy of these; they live in a
 * const inside its main.js rather than anywhere importable.
 */
export const RIDE_SFX = {
  bell: (a) => {
    a.blip('E6', { dur: 0.5, gain: 0.45, type: 'sine' });
    a.blip('B6', { dur: 0.62, gain: 0.32, type: 'sine', delay: 0.05 });
  },
  rack: (a) => {
    for (let i = 0; i < 5; i++) a.noise({ dur: 0.02, gain: 0.15, cutoff: 3200, delay: i * 0.05 });
    a.blip('A4', { dur: 0.12, slide: 0.55, gain: 0.32 });
  },
  tyre: (a, rough) => a.noise({ dur: 0.05, gain: rough ? 0.15 : 0.07, cutoff: rough ? 1900 : 700 }),
};

/**
 * A body that can walk or ride around a compiled map.
 *
 * Holds every bit of state the movement needs, so a headless harness can make
 * one, step it, and assert on where it ended up without a scene, a console or
 * a frame loop anywhere in sight.
 */
export class Rider {
  /**
   * @param {object} map compiled by engine/geo.js
   * @param {number} x world pixels
   * @param {number} y
   */
  constructor(map, x, y) {
    this.map = map;
    this.x = x;
    this.y = y;
    this.dir = 'down';
    this.riding = true; // a courier turns up on the bike
    this.running = false;
    this.rough = false;
    this.speed = 0; // px/s along (hx, hy)
    this.hx = 0;
    this.hy = 1;
    this.animT = 0;
    this.stepT = 0;
    this.bumped = false; // set on the frame a move was stopped by something
  }

  /**
   * Feet-box collision: the player's shoes, not the whole sprite. Seven pixels
   * square is the largest box that still fits inside one eight-pixel tile,
   * which is what lets a one-tile path be walked down at all. Four corners is
   * exact rather than approximate, since a 7px box can only touch a 2x2 block.
   */
  blocked(x, y) {
    const half = 3;
    const top = y - half;
    const bottom = y + half;
    for (const [cx, cy] of [
      [x - half, top],
      [x + half, top],
      [x - half, bottom],
      [x + half, bottom],
    ]) {
      if (this.map.solidAt(Math.floor(cx / TILE), Math.floor(cy / TILE))) return true;
    }
    return false;
  }

  /**
   * Move by a pixel delta. Each axis resolves separately so a diagonal into a
   * wall slides along it, and the whole move is split into substeps of at most
   * MAX_STEP px so that bike speed cannot put the rider out the far side of a
   * solid tile in one frame.
   * @returns {number} how far it actually got
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

  mount(sys, quiet = false) {
    this.riding = true;
    this.speed = 0;
    this.animT = 0;
    this.stepT = 0;
    if (!quiet && sys) RIDE_SFX.bell(sys.audio);
  }

  dismount(sys) {
    this.riding = false;
    this.speed = 0;
    this.animT = 0;
    if (sys) RIDE_SFX.rack(sys.audio);
  }

  /** On foot. B is run, exactly as in the Explorer. */
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
   * doorstep at speed is still possible.
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
      if (this.speed > this.map.walkSpeed) {
        this.bumped = true;
        if (sys) SFX.bump(sys.audio);
      }
      this.speed = 0;
    }

    this.animT += dt * (0.5 + this.speed / (this.map.walkSpeed * 1.2));
    this.stepT += dt;
    const interval = Math.max(0.09, 0.34 - this.speed / 900);
    if (this.speed > 8 && this.stepT > interval) {
      this.stepT = 0;
      if (sys) RIDE_SFX.tyre(sys.audio, this.rough);
    }
  }

  /**
   * One frame of movement.
   * @param {number} dt seconds
   * @param {object|null} sys the console, for sound; omit it headlessly
   * @param {{dx:number, dy:number, b:boolean}} controls
   */
  update(dt, sys, { dx = 0, dy = 0, b = false } = {}) {
    this.bumped = false;
    if (this.riding) this.ride(dt, dx, dy, sys, b);
    else this.walk(dt, dx, dy, sys, b);
    // Never off the edge of the world.
    this.x = Math.max(4, Math.min(this.map.w * TILE - 4, this.x));
    this.y = Math.max(8, Math.min(this.map.h * TILE - 4, this.y));
  }

  /** The sprite frame to draw this instant, and whether to mirror it. */
  frame() {
    const frames = (this.riding ? BIKE : PLAYER)[this.dir];
    const rate = this.riding ? 10 : 8;
    return {
      sprite: this.animT > 0 ? frames[Math.floor(this.animT * rate) % frames.length] : frames[0],
      flipX: this.dir === 'left',
    };
  }
}
