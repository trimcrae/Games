// Fast travel between the three places: airport coaches, highway ramps, and the
// little cut scenes that carry you from one map to the next.
//
// The hub and route data lives in levels.js, next to the landmark data it
// belongs with. This file turns it into something a scene can use: markers
// placed on a compiled map, a proximity test, menu strings, and the animation.
//
// Nothing here assumes a screen size. The console's framebuffer is decided at
// boot from the device, somewhere between 160x144 and 320x288, so every layout
// below is derived from `screen.w` and `screen.h`.

import { SLOT, px, TRANSPARENT } from '../../engine/gfx.js';
import { TILE } from '../../engine/tiles.js';
import { nearestOpen } from '../../engine/geo.js';
import { rasterizeOps } from '../../engine/art.js';
import { box } from '../../engine/ui.js';
import { TRAVEL_HUBS, LEVEL_BY_ID } from './levels.js';

// --- hub data --------------------------------------------------------------

/**
 * Fast-travel hubs keyed by level id.
 *
 * Each hub is `{ id, kind: 'airport'|'highway', name, at: [lat, lon], blurb,
 * routes }`, and each route is `{ from, to, kind: 'flight'|'drive', label,
 * minutes, arriveAt: [lat, lon], signs? }`. `from` is filled in here so a route
 * carries both ends of the journey and the cut scene can caption itself from
 * the route alone.
 */
export const HUBS = Object.fromEntries(
  Object.entries(TRAVEL_HUBS).map(([levelId, hubs]) => [
    levelId,
    hubs.map((hub) => ({
      ...hub,
      levelId,
      routes: hub.routes.map((route) => ({ ...route, from: levelId, hubId: hub.id })),
    })),
  ]),
);

/** The hubs on one level, or an empty list if it has none. */
export function hubsFor(levelId) {
  return HUBS[levelId] || [];
}

/** Every route leaving one level, flattened - handy for menus and for tests. */
export function routesFrom(levelId) {
  return hubsFor(levelId).flatMap((hub) => hub.routes);
}

/** "5H 40M", "28M". Journey times are stored in whole minutes. */
function duration(minutes) {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m}M`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}H ${String(rest).padStart(2, '0')}M` : `${h}H`;
}

/**
 * One line for a menu: the route's own label and how long it takes.
 * e.g. "ROC -> SFO  6H 05M", "I-390 N  28M".
 */
export function routeSummary(route) {
  return `${route.label}  ${duration(route.minutes)}`;
}

/** Display name of where a route ends up, e.g. "R I T". */
export function destinationName(route) {
  return LEVEL_BY_ID[route.to]?.name || route.to.toUpperCase();
}

/** Display name of where a route starts. */
export function originName(route) {
  return LEVEL_BY_ID[route.from]?.name || String(route.from).toUpperCase();
}

// --- placing hubs on a compiled map ----------------------------------------

/**
 * Attach this level's hubs to a compiled map as `map.hubs`, with pixel
 * positions. Hubs are anchored to real roads, and a road tile is walkable, but
 * the same belt-and-braces nudge the landmark posts get is applied anyway so a
 * hub can never end up inside a building after a data refresh.
 *
 * @param {object} map from compileMap
 * @returns {Array} the placed hubs
 */
export function placeHubs(map) {
  const placed = hubsFor(map.id).map((hub) => {
    const [tx, ty] = map.proj.toTile(hub.at[0], hub.at[1]);
    const open = nearestOpen(map, tx, ty, 40) || [Math.round(tx), Math.round(ty)];
    return {
      ...hub,
      tx,
      ty,
      x: tx * TILE,
      y: ty * TILE,
      postX: open[0] * TILE + TILE / 2,
      postY: open[1] * TILE + TILE / 2,
    };
  });
  map.hubs = placed;
  return placed;
}

/**
 * The nearest placed hub within `radius` pixels of a world position, or null.
 * Call `placeHubs` first. The default radius matches the landmark reach in
 * main.js so both prompts behave the same way.
 */
export function hubNear(map, x, y, radius = 22) {
  let best = radius;
  let found = null;
  for (const hub of map.hubs || []) {
    const d = Math.hypot(hub.postX - x, hub.postY - y);
    if (d < best) {
      best = d;
      found = hub;
    }
  }
  return found;
}

/**
 * Where to drop the player on the destination map. Feed it the freshly
 * compiled destination map and the route that was taken.
 * @returns {{x:number, y:number}} world pixels, on a walkable tile
 */
export function arrivalPixel(map, route) {
  const [tx, ty] = map.proj.toTile(route.arriveAt[0], route.arriveAt[1]);
  const open = nearestOpen(map, tx, ty, 60) || [Math.round(tx), Math.round(ty)];
  return { x: open[0] * TILE + TILE / 2, y: open[1] * TILE + TILE / 2 };
}

// --- sprites ---------------------------------------------------------------

// Same authoring format as sprites.js: digits are shades 0..3 within whatever
// palette slot the caller blits with, "." is transparent.
function sprite(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const data = new Uint8Array(w * h);
  rows.forEach((row, y) => {
    if (row.length !== w) throw new Error(`ragged sprite row ${y}: "${row}"`);
    for (let x = 0; x < w; x++) data[y * w + x] = row[x] === '.' ? TRANSPARENT : row[x].charCodeAt(0) - 48;
  });
  return { w, h, px: data };
}

/**
 * World markers for the two kinds of hub, drawn the same way as the landmark
 * posts in sprites.js: 12x14, on the ACCENT slot, standing on a short pole.
 */
export const HUB_SPRITES = {
  // A plane seen from above, the shape every airport sign in the world uses.
  airport: sprite([
    '.....33.....',
    '....3113....',
    '....3113....',
    '....3113....',
    '...331133...',
    '..33111133..',
    '.3311111133.',
    '331111111133',
    '.3333113333.',
    '....3113....',
    '...331133...',
    '....3113....',
    '.....33.....',
    '.....33.....',
  ]),
  // A route shield: dark crown, light body, a dark number band, on a post.
  highway: sprite([
    '..33333333..',
    '.3333333333.',
    '.3311111133.',
    '311111111113',
    '311333333113',
    '311333333113',
    '311111111113',
    '.3111111113.',
    '..31111113..',
    '...311113...',
    '....3113....',
    '.....33.....',
    '.....33.....',
    '.....33.....',
  ]),
};

// --- cut scene art ---------------------------------------------------------

/**
 * Shear a sprite's columns upward to fake a rotation. Small pitch angles are
 * all a takeoff needs, and a sheared copy of one airframe reads far better than
 * two hand-drawn ones that do not quite match.
 */
function pitched(spr, slope) {
  const rise = Math.abs(Math.round((spr.w - 1) * slope));
  const h = spr.h + rise;
  const out = new Uint8Array(spr.w * h).fill(TRANSPARENT);
  for (let x = 0; x < spr.w; x++) {
    // Positive slope lifts the nose (which is to the right); negative drops it.
    const lift = slope > 0 ? Math.round(x * slope) : Math.round((spr.w - 1 - x) * -slope);
    for (let y = 0; y < spr.h; y++) {
      const v = spr.px[y * spr.w + x];
      if (v === TRANSPARENT) continue;
      out[(y + lift) * spr.w + x] = v;
    }
  }
  return { w: spr.w, h, px: out };
}

// Airliner, nose to the right. The last two rows are the undercarriage, so a
// gear-up blit is just the same sprite drawn two rows short.
const PLANE = sprite([
  '..3333....................',
  '..3113....................',
  '.33113....................',
  '.31113....................',
  '.311113...................',
  '.31111111111111111133.....',
  '.3111111111111111111133...',
  '.3111111111111111111113...',
  '.33111111111111111111133..',
  '..3311113311111111133.....',
  '....33333..333333333......',
  '.....3.......3.3..........',
  '....333.....33.33.........',
]);
const PLANE_BODY_H = PLANE.h - 2; // airframe only, gear retracted
const PLANE_CLIMB = pitched({ w: PLANE.w, h: PLANE_BODY_H, px: PLANE.px.subarray(0, PLANE.w * PLANE_BODY_H) }, 0.3);
const PLANE_SINK = pitched(PLANE, -0.12);

// Saloon car seen from behind: blue body, dark glass, red lamps.
const CAR = sprite([
  '.......3333333333.......',
  '......322222222223......',
  '.....32333333333323.....',
  '.....32333333333323.....',
  '....3222222222222223....',
  '...322222222222222223...',
  '..32222222222222222223..',
  '..32222222222222222223..',
  '..31122222222222222113..',
  '..31122222222222222113..',
  '..33333333333333333333..',
  '...33.3..........3.33...',
  '...333............333...',
  '....3..............3....',
]);

// Terminal pier and control tower, tiled along the horizon during a takeoff
// roll. Drawn as ops because it is static furniture, not animation: 3 is the
// building mass, 0 the lit glass.
const TERMINAL = {
  w: 72,
  h: 26,
  px: rasterizeOps(
    [
      ['r', 0, 14, 72, 12, 3],
      ['g', 3, 17, 11, 1, 6, 0, 3, 4, 0],
      ['r', 8, 8, 26, 6, 3],
      ['g', 11, 10, 5, 1, 5, 0, 3, 3, 0],
      ['r', 52, 2, 8, 24, 3],
      ['r', 50, 0, 12, 5, 3],
      ['r', 53, 1, 6, 3, 0],
      ['r', 55, 14, 2, 12, 3],
    ],
    72,
    26,
    TRANSPARENT,
  ),
};

// Overhead gantry sign board, scaled per distance at draw time.
const SIGN_SLOT = SLOT.TREE; // motorway signs are green, and TREE is the green ramp

// --- cut scene -------------------------------------------------------------

const FLIGHT_PLAN = [
  ['roll', 1.3],
  ['climb', 1.1],
  ['cruise', 1.9],
  ['descend', 1.1],
  ['land', 1.0],
];
const DRIVE_PLAN = [
  ['ramp', 1.1],
  ['run', 2.9],
  ['exit', 1.6],
];

const planTotal = (plan) => plan.reduce((n, p) => n + p[1], 0);

function phaseAt(plan, t) {
  let acc = 0;
  for (const [name, dur] of plan) {
    if (t < acc + dur) return { name, k: (t - acc) / dur, start: acc, dur };
    acc += dur;
  }
  const [name, dur] = plan[plan.length - 1];
  return { name, k: 1, start: acc - dur, dur };
}

const smooth = (k) => {
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
};
const lerp = (a, b, k) => a + (b - a) * k;

/** Deterministic 0..1 hash, so stars and trees sit still between frames. */
function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

class TravelCutscene {
  /**
   * @param {object} route a route out of HUBS
   * @param {(sys:object)=>void} onDone called once, on finish or skip
   */
  constructor(route, onDone) {
    this.route = route;
    this.onDone = onDone;
    this.flying = route.kind !== 'drive';
    this.plan = this.flying ? FLIGHT_PLAN : DRIVE_PLAN;
    this.total = planTotal(this.plan);
    this.t = 0;
    this.scroll = 0;
    this.travel = 0;
    this.finished = false;
    this.cue = 0;
    this.cues = this.flying ? this.flightCues() : this.driveCues();
    this.headline = `${originName(route)} > ${destinationName(route)}`;
    this.summary = routeSummary(route);
  }

  // Sound is a list of [time, fn] fired in order, so a skipped scene simply
  // stops firing rather than dumping every cue at once.
  flightCues() {
    const rumble = (a, cutoff, gain) => a.noise({ dur: 0.55, gain, cutoff });
    return [
      [0.0, (a) => rumble(a, 320, 0.3)],
      [0.5, (a) => rumble(a, 420, 0.34)],
      [1.0, (a) => rumble(a, 560, 0.38)],
      [1.3, (a) => a.blip(180, { dur: 0.9, slide: 3.4, type: 'sawtooth', gain: 0.5 })],
      [1.35, (a) => rumble(a, 900, 0.3)],
      [2.4, (a) => a.jingle([['G4', 0, 1], ['C5', 1, 1], ['E5', 2, 2]], 300, { type: 'triangle' })],
      [4.3, (a) => a.blip(640, { dur: 1.0, slide: 0.35, type: 'sawtooth', gain: 0.4 })],
      [5.4, (a) => a.noise({ dur: 0.3, gain: 0.5, cutoff: 900 })],
      [5.5, (a) => a.blip('D5', { dur: 0.12, slide: 0.6, gain: 0.4 })],
      [6.0, (a) => a.jingle([['C5', 0, 0.5], ['G5', 0.5, 1.2]], 320)],
    ];
  }

  driveCues() {
    const rumble = (a, gain = 0.26) => a.noise({ dur: 0.5, gain, cutoff: 380 });
    const cues = [
      [0.0, (a) => a.blip(90, { dur: 0.35, slide: 2.2, type: 'sawtooth', gain: 0.45 })],
      [0.15, (a) => rumble(a, 0.3)],
    ];
    for (let t = 0.7; t < 4.2; t += 0.5) cues.push([t, (a) => rumble(a)]);
    cues.push([1.6, (a) => a.blip('E5', { dur: 0.05, gain: 0.35 })]);
    cues.push([3.0, (a) => a.blip('E5', { dur: 0.05, gain: 0.35 })]);
    cues.push([4.0, (a) => a.blip(420, { dur: 0.7, slide: 0.4, type: 'sawtooth', gain: 0.35 })]);
    cues.push([5.1, (a) => a.jingle([['C5', 0, 0.5], ['G5', 0.5, 1.2]], 320)]);
    cues.sort((a, b) => a[0] - b[0]);
    return cues;
  }

  finish(sys) {
    if (this.finished) return;
    this.finished = true;
    this.onDone(sys);
  }

  update(dt, sys) {
    if (this.finished) return;
    this.t += dt;

    while (this.cue < this.cues.length && this.cues[this.cue][0] <= this.t) {
      this.cues[this.cue][1](sys.audio);
      this.cue++;
    }

    const ph = phaseAt(this.plan, this.t);
    this.scroll += dt * this.scrollSpeed(ph);
    this.travel += dt * this.driveSpeed(ph);

    if (sys.input.pressed('a') || sys.input.pressed('b') || sys.input.pressed('start')) {
      this.finish(sys);
      return;
    }
    if (this.t >= this.total) this.finish(sys);
  }

  /** Pixels per second the background slides past, per phase. */
  scrollSpeed(ph) {
    if (!this.flying) return 0;
    switch (ph.name) {
      case 'roll':
        return lerp(30, 210, smooth(ph.k));
      case 'climb':
        return lerp(210, 60, smooth(ph.k));
      case 'cruise':
        return 34;
      case 'descend':
        return lerp(34, 150, smooth(ph.k));
      default:
        return lerp(180, 10, smooth(ph.k));
    }
  }

  /** Depth units per second for the drive's perspective road. */
  driveSpeed(ph) {
    if (this.flying) return 0;
    switch (ph.name) {
      case 'ramp':
        return lerp(6, 26, smooth(ph.k));
      case 'run':
        return 26;
      default:
        return lerp(26, 3, smooth(ph.k));
    }
  }

  draw(screen, sys) {
    const bandH = this.bandHeight(screen);
    const sceneH = screen.h - bandH;
    screen.clip(0, 0, screen.w, sceneH);
    if (this.flying) this.drawFlight(screen, sceneH);
    else this.drawDrive(screen, sceneH);
    screen.noClip();
    this.drawCaption(screen, sceneH, bandH);
    void sys;
  }

  /** The caption strip grows a little on a taller screen, but never dominates. */
  bandHeight(screen) {
    return Math.min(34, Math.max(24, Math.round(screen.h * 0.17)));
  }

  /** Sprites are drawn at 1:1 on a small screen and doubled on a large one. */
  scaleFor(screen) {
    return Math.max(1, Math.min(2, Math.floor(screen.w / 200)));
  }

  drawCaption(screen, y, h) {
    const W = screen.w;
    box(screen, 0, y, W, h);
    screen.text(this.headline.slice(0, Math.floor((W - 10) / 6)), 5, y + 5, { slot: SLOT.UI, shade: 3 });
    screen.text(this.summary.slice(0, Math.floor((W - 10) / 6)), 5, y + 14, { slot: SLOT.UI, shade: 2 });

    // Progress along the journey, pinned to the foot of the box.
    const barY = y + h - 6;
    const barW = W - 10;
    screen.fill(5, barY, barW, 2, px(SLOT.UI, 1));
    screen.fill(5, barY, Math.round(barW * Math.min(1, this.t / this.total)), 2, px(SLOT.UI, 3));
  }

  // --- flight --------------------------------------------------------------

  drawFlight(screen, SH) {
    const W = screen.w;
    const ph = phaseAt(this.plan, this.t);
    const alt = this.altitude(ph);

    // The ground band shrinks from just under half the frame to a far-off
    // sliver, which is most of what sells the climb.
    const groundTop = Math.round(SH - (1 - alt) * SH * 0.42 - alt * Math.min(16, SH * 0.1));

    this.drawSky(screen, SH, groundTop, alt);
    if (alt < 0.45) this.drawAirfield(screen, SH, groundTop, alt);
    else this.drawCoast(screen, SH, groundTop);
    if (alt > 0.3) this.drawClouds(screen, SH, alt);

    this.drawPlane(screen, SH, ph, alt);
  }

  altitude(ph) {
    switch (ph.name) {
      case 'climb':
        return smooth(ph.k);
      case 'cruise':
        return 1;
      case 'descend':
        return 1 - smooth(ph.k);
      default:
        return 0;
    }
  }

  drawSky(screen, SH, groundTop, alt) {
    const W = screen.w;
    screen.fill(0, 0, W, SH, px(SLOT.NIGHT, 2));
    const deepH = Math.round(SH * (0.3 + 0.5 * alt));
    screen.fill(0, 0, W, deepH, px(SLOT.NIGHT, 3));
    // A checkered seam instead of a hard edge, the usual four-shade dodge.
    for (let y = deepH; y < deepH + 6 && y < SH; y++) {
      const step = y - deepH < 3 ? 2 : 4;
      for (let x = (y & 1) * (step >> 1); x < W; x += step) screen.set(x, y, px(SLOT.NIGHT, 3));
    }

    // Stars come out as the air thins.
    if (alt > 0.25) {
      const n = Math.round((W * SH) / 900);
      for (let i = 0; i < n; i++) {
        const sy = Math.round(hash(i * 3 + 1) * (groundTop - 4));
        if (sy < 1 || sy > deepH + 10) continue;
        if (hash(i * 3 + 2) > alt) continue;
        if ((hash(i * 3 + 3) * 5 + this.t) % 3 > 2.4) continue;
        screen.set(Math.round(hash(i * 3) * W), sy, px(SLOT.UI, hash(i) > 0.7 ? 1 : 0));
      }
    }

    // Dawn sits on the horizon at low level and burns off as you climb.
    const glow = Math.round((1 - alt) * SH * 0.13);
    if (glow > 2) {
      screen.fill(0, groundTop - glow, W, glow, px(SLOT.DEEP, 1));
      for (let x = 0; x < W; x += 2) screen.set(x, groundTop - glow, px(SLOT.NIGHT, 2));
      screen.fill(0, groundTop - 3, W, 3, px(SLOT.GOLD, 1));
      for (let x = 1; x < W; x += 2) screen.set(x, groundTop - 4, px(SLOT.GOLD, 1));
    }
  }

  drawAirfield(screen, SH, groundTop, alt) {
    const W = screen.w;
    const gH = SH - groundTop;
    screen.fill(0, groundTop, W, gH, px(SLOT.LAND, 3));

    // Terminal pier along the horizon, sliding past behind the runway.
    const s = Math.max(1, Math.round(W / 200));
    const tw = TERMINAL.w * s;
    const th = TERMINAL.h * s;
    const base = groundTop + 2;
    let tx = -Math.round(this.scroll * 0.35) % (tw + 40 * s);
    while (tx < W) {
      screen.blit(TERMINAL.px, TERMINAL.w, TERMINAL.h, tx, base - th, { slot: SLOT.NIGHT, scale: s });
      // Beacon on the tower, on the strobe.
      if (Math.floor(this.t * 3) % 2) screen.fill(tx + 54 * s, base - th, 2 * s, 2 * s, px(SLOT.ACCENT, 1));
      tx += tw + 40 * s;
    }

    const rwY = groundTop + Math.round(gH * 0.4);
    const rwH = Math.max(5, Math.round(gH * 0.36));
    screen.fill(0, rwY, W, rwH, px(SLOT.ROAD, 2));
    screen.hline(0, rwY, W, px(SLOT.ROAD, 3));
    screen.hline(0, rwY + rwH - 1, W, px(SLOT.ROAD, 3));

    // Centreline, and the edge lights that make the roll read as motion.
    const gap = Math.max(18, Math.round(W * 0.17));
    const dashW = Math.round(gap * 0.5);
    const dashY = rwY + Math.round(rwH / 2) - 1;
    const off = ((this.scroll % gap) + gap) % gap;
    for (let x = -gap + (gap - off); x < W; x += gap) screen.fill(Math.round(x), dashY, dashW, 2, px(SLOT.ROAD, 0));

    const lightGap = gap * 2;
    const loff = ((this.scroll % lightGap) + lightGap) % lightGap;
    for (let x = -lightGap + (lightGap - loff); x < W; x += lightGap) {
      const lx = Math.round(x);
      screen.fill(lx, rwY - 2, 2, 2, px(SLOT.ACCENT, 1));
      screen.fill(lx, rwY + rwH, 2, 2, px(SLOT.ACCENT, 2));
    }
    void alt;
  }

  /** Seen from the cruise: a coastline crawling past a long way below. */
  drawCoast(screen, SH, groundTop) {
    const W = screen.w;
    for (let x = 0; x < W; x++) {
      const s = this.scroll * 0.6 + x;
      const edge = groundTop + 3 + Math.round(2.5 * Math.sin(s * 0.055) + 1.8 * Math.sin(s * 0.017 + 1.3));
      const cut = Math.max(groundTop, Math.min(SH - 1, edge));
      screen.fill(x, groundTop, 1, cut - groundTop, px(SLOT.LAND, 3));
      screen.fill(x, cut, 1, SH - cut, px(SLOT.DEEP, 2));
      if ((x + Math.round(this.scroll * 0.6)) % 11 === 0) screen.set(x, cut, px(SLOT.SAND, 2));
    }
    screen.hline(0, groundTop, W, px(SLOT.NIGHT, 3));
  }

  drawClouds(screen, SH, alt) {
    const W = screen.w;
    const top = Math.round(SH * 0.42);
    for (let i = 0; i < 5; i++) {
      const cw = Math.round(W * (0.16 + 0.14 * hash(i * 7 + 1)));
      const span = W + cw * 2;
      const cx = Math.round(W - (((this.scroll * (0.7 + 0.4 * hash(i))) + i * span * 0.31) % span));
      const cy = top + Math.round(hash(i * 7 + 2) * (SH * 0.38));
      if (cy > SH - 6) continue;
      const shade = alt > 0.7 ? 1 : 2;
      screen.fill(cx, cy, cw, 2, px(SLOT.UI, shade));
      screen.fill(cx + 3, cy - 2, Math.max(2, cw - 8), 2, px(SLOT.UI, shade === 1 ? 0 : 1));
    }
  }

  drawPlane(screen, SH, ph, alt) {
    const W = screen.w;
    const s = this.scaleFor(screen);

    // Runway geometry at zero altitude, which is where the wheels have to be.
    const g0 = Math.round(SH * 0.58);
    const rwY = g0 + Math.round((SH - g0) * 0.4);
    const rwH = Math.max(5, Math.round((SH - g0) * 0.36));
    const wheelY = rwY + Math.round(rwH * 0.55);
    const cruiseY = Math.round(SH * 0.3);

    let art = PLANE;
    let bodyH = PLANE.h;
    if (ph.name === 'climb') {
      art = PLANE_CLIMB;
      bodyH = PLANE_CLIMB.h;
    } else if (ph.name === 'cruise') {
      art = PLANE;
      bodyH = PLANE_BODY_H;
    } else if (ph.name === 'descend') {
      art = ph.k < 0.6 ? PLANE_SINK : PLANE;
      bodyH = art === PLANE_SINK ? PLANE_SINK.h - 2 : PLANE.h;
    }

    let fx;
    switch (ph.name) {
      case 'roll':
        fx = lerp(0.1, 0.36, smooth(ph.k));
        break;
      case 'climb':
        fx = lerp(0.36, 0.5, smooth(ph.k));
        break;
      case 'cruise':
        fx = 0.5 + Math.sin(this.t * 1.6) * 0.012;
        break;
      case 'descend':
        fx = lerp(0.5, 0.46, smooth(ph.k));
        break;
      default:
        fx = lerp(0.46, 0.2, smooth(ph.k));
    }

    const x = Math.round(W * fx - (art.w * s) / 2);
    const groundY = wheelY - art.h * s + (ph.name === 'climb' ? 0 : 0);
    const y = Math.round(lerp(groundY, cruiseY, alt) + (alt > 0.9 ? Math.sin(this.t * 2.2) * 1.5 : 0));

    // Contrails at height, tyre smoke on the ground.
    if (alt > 0.5) {
      for (let i = 1; i < 7; i++) {
        const tx = x - i * 5 * s;
        if (tx < -4) break;
        screen.fill(tx, y + Math.round(art.h * s * 0.55), 3, 1, px(SLOT.UI, i < 4 ? 1 : 2));
      }
    } else if (ph.name === 'land' && ph.k < 0.45) {
      for (let i = 0; i < 6; i++) {
        const pxx = x + Math.round(art.w * s * 0.5) + i * 4 * s;
        screen.fill(pxx, wheelY - 2 - (i % 2), 3, 2, px(SLOT.UI, 2));
      }
    }

    screen.blit(art.px, art.w, Math.min(art.h, bodyH), x, y, { slot: SLOT.CHAR, scale: s });
    // Navigation strobe on the tail.
    if (Math.floor(this.t * 6) % 2) screen.fill(x + 2 * s, y, 2 * s, 2 * s, px(SLOT.ACCENT, 0));
  }

  // --- drive ---------------------------------------------------------------

  drawDrive(screen, SH) {
    const W = screen.w;
    const ph = phaseAt(this.plan, this.t);
    const horizon = Math.round(SH * 0.38);

    // Camera drift: the on-ramp swings in from the right, the run has a lazy
    // curve, and the exit swings the carriageway away to the left.
    let bend = Math.sin(this.travel * 0.035) * W * 0.06;
    if (ph.name === 'ramp') bend += lerp(W * 0.4, 0, smooth(ph.k));
    if (ph.name === 'exit') bend -= lerp(0, W * 0.42, smooth(ph.k));
    const vpX = W / 2 + bend;

    this.drawDriveSky(screen, SH, horizon);
    this.drawRoad(screen, SH, horizon, vpX);
    this.drawGantries(screen, SH, horizon, vpX);
    this.drawCar(screen, SH, ph);
  }

  drawDriveSky(screen, SH, horizon) {
    const W = screen.w;
    screen.fill(0, 0, W, horizon, px(SLOT.WATER, 1));
    screen.fill(0, 0, W, Math.round(horizon * 0.45), px(SLOT.WATER, 2));
    for (let y = Math.round(horizon * 0.45); y < Math.round(horizon * 0.45) + 5 && y < horizon; y++) {
      for (let x = (y & 1) * 2; x < W; x += 4) screen.set(x, y, px(SLOT.WATER, 2));
    }
    screen.fill(0, horizon, W, SH - horizon, px(SLOT.LAND, 2));
    for (let y = horizon + 2; y < SH; y += 3) {
      for (let x = (y & 1) * 3; x < W; x += 6) screen.set(x, y, px(SLOT.LAND, 3));
    }

    // Tree line, in step with the road so the scenery does not stand still.
    const period = 13;
    const off = ((this.travel * 2.4) % period) + period;
    for (let i = -1; i < Math.ceil(W / period) + 2; i++) {
      const x = Math.round(i * period - off);
      const seed = i + Math.floor((this.travel * 2.4) / period);
      const h = 4 + Math.round(hash(seed) * 7);
      const w = 4 + Math.round(hash(seed + 100) * 4);
      screen.fill(x, horizon - h, w, h + 1, px(SLOT.TREE, 3));
    }
    screen.hline(0, horizon, W, px(SLOT.LAND, 3));
  }

  /**
   * Pseudo-3D road: every scanline below the horizon is one depth, y = K/z, so
   * width and dash length fall off the way they should without a matrix in
   * sight.
   */
  drawRoad(screen, SH, horizon, vpX) {
    const W = screen.w;
    const K = SH - horizon;
    const half0 = W * 0.62;
    const shoulder0 = W * 0.1;

    for (let y = horizon + 1; y < SH; y++) {
      const z = K / (y - horizon);
      const half = half0 / z;
      const shoulder = shoulder0 / z;
      // The vanishing point slides with depth, which is what makes it a curve.
      const cx = vpX + ((W / 2 - vpX) * (z - 1)) / Math.max(1, z);
      const left = Math.round(cx - half);
      const width = Math.max(1, Math.round(half * 2));

      screen.fill(Math.round(left - shoulder), y, Math.round(width + shoulder * 2), 1, px(SLOT.SAND, 2));
      screen.fill(left, y, width, 1, px(SLOT.ROAD, 2));

      const line = Math.max(1, Math.round(half * 0.06));
      screen.fill(left, y, line, 1, px(SLOT.ROAD, 0));
      screen.fill(left + width - line, y, line, 1, px(SLOT.ROAD, 0));

      // Dashes down the middle, phased by distance travelled.
      const world = z * 2 + this.travel;
      if (world % 4 < 1.9) screen.fill(Math.round(cx - line), y, line * 2, 1, px(SLOT.ROAD, 0));
      // Rumble strip on the far shoulder, alternating so it flickers past.
      if (world % 6 < 3) screen.fill(Math.round(left - shoulder), y, Math.max(1, Math.round(shoulder * 0.5)), 1, px(SLOT.UI, 0));
    }
  }

  drawGantries(screen, SH, horizon, vpX) {
    const W = screen.w;
    const K = SH - horizon;
    const signs = this.route.signs || [this.route.label];
    for (let i = 0; i < signs.length; i++) {
      const z = 26 - i * 12 - this.travel * 0.55;
      if (z < 1.3 || z > 30) continue;
      const y = horizon + K / z;
      const cx = vpX + ((W / 2 - vpX) * (z - 1)) / Math.max(1, z);
      const boardW = Math.round((W * 1.15) / z);
      const boardH = Math.round((SH * 0.55) / z);
      if (boardW < 8 || boardH < 4) continue;
      const bx = Math.round(cx - boardW / 2);
      const by = Math.round(y - K / z - boardH); // hung above the road surface

      // Legs down to the shoulder.
      screen.fill(bx, by + boardH, Math.max(1, Math.round(boardW * 0.04)), Math.round(y - by - boardH), px(SLOT.UI, 2));
      screen.fill(
        bx + boardW - Math.max(1, Math.round(boardW * 0.04)),
        by + boardH,
        Math.max(1, Math.round(boardW * 0.04)),
        Math.round(y - by - boardH),
        px(SLOT.UI, 2),
      );

      screen.fill(bx, by, boardW, boardH, px(SIGN_SLOT, 2));
      screen.frame(bx, by, boardW, boardH, px(SLOT.UI, 0));
      const text = signs[i];
      const tw = screen.textWidth(text);
      if (tw + 6 <= boardW && boardH >= 11) {
        screen.text(text, Math.round(bx + (boardW - tw) / 2), Math.round(by + (boardH - 7) / 2), {
          slot: SLOT.UI,
          shade: 0,
        });
      }
    }
  }

  drawCar(screen, SH, ph) {
    const W = screen.w;
    const s = this.scaleFor(screen);
    let fx = 0.5;
    if (ph.name === 'ramp') fx = lerp(0.82, 0.5, smooth(ph.k));
    if (ph.name === 'exit') fx = lerp(0.5, 0.78, smooth(ph.k));

    const cw = CAR.w * s;
    const chh = CAR.h * s;
    const bob = ph.name === 'exit' && ph.k > 0.8 ? 0 : Math.round(Math.sin(this.travel * 3.1) * s);
    const x = Math.round(W * fx - cw / 2);
    const y = SH - chh - Math.round(SH * 0.06) + bob;

    // Shadow first, so the car sits on the tarmac rather than floating.
    screen.fill(x + 2 * s, y + chh - 2 * s, cw - 4 * s, 2 * s, px(SLOT.ROAD, 3));
    screen.blit(CAR.px, CAR.w, CAR.h, x, y, { slot: SLOT.CHAR, scale: s });
    // Brake lights come on as it slows for the ramp.
    if (ph.name === 'exit' && ph.k > 0.45) {
      screen.fill(x + 2 * s, y + 8 * s, 2 * s, 2 * s, px(SLOT.ACCENT, 1));
      screen.fill(x + cw - 4 * s, y + 8 * s, 2 * s, 2 * s, px(SLOT.ACCENT, 1));
    }
  }
}

/**
 * Build the cut scene for one route.
 *
 * The returned object is a plain scene: `update(dt, sys)` and
 * `draw(screen, sys)`. It runs for five or six seconds and then calls
 * `onDone(sys)` exactly once; A, B or START skip straight to it.
 *
 * @param {object} route a route out of HUBS (needs `kind`, `from`, `to`, `label`)
 * @param {object} sys the console, for the initial state
 * @param {(sys:object)=>void} onDone
 * @returns {{update:(dt:number, sys:object)=>void, draw:(screen:object, sys:object)=>void}}
 */
export function createTravelCutscene(route, sys, onDone) {
  void sys;
  return new TravelCutscene(route, onDone || (() => {}));
}
