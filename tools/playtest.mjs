#!/usr/bin/env node
// Play tests: can the game actually be played to the end?
//
// tools/validate.mjs asks whether the content is well formed. This asks the
// harder question - whether a player can finish it. Is every landmark joined to
// the ground you spawn on, or is one of them stranded across a motorway? Does
// the movement code ever leave the walker inside a wall? Does travelling out
// and back put you somewhere you can leave from again? Does every caption fit
// on the smallest screen the console will boot at?
//
// The engine is deliberately DOM-free, so none of this needs a browser: the
// real scenes out of games/explorer/main.js are driven through a stub console
// with a file-backed `fetch`, and the real WorldScene movement code is stepped
// frame by frame with seeded pseudo-random input.
//
//   node tools/playtest.mjs            every place
//   node tools/playtest.mjs greece     one place, while iterating

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// --- reporting -------------------------------------------------------------

const problems = [];
const skips = [];
let checks = 0;

const suite = (name) => console.log(`\n${name}\n${'-'.repeat(name.length)}`);
const note = (msg) => console.log(`  ${msg}`);

/** Record one assertion. Returns the boolean so callers can branch on it. */
function check(ok, msg) {
  checks++;
  if (!ok) problems.push(msg);
  return Boolean(ok);
}

const fail = (msg) => {
  checks++;
  problems.push(msg);
};

/**
 * Bow out of a suite without failing the run. Used when the game moves under
 * us: a missing export is worth saying out loud, but it should not turn the
 * harness itself into a wall of noise.
 */
const skip = (msg) => {
  skips.push(msg);
  console.log(`  SKIPPED: ${msg}`);
};

/** Fixed-width table; columns after the first are right-aligned. */
function table(headers, rows) {
  if (!rows.length) return;
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  const line = (cells) =>
    '  ' + cells.map((c, i) => (i === 0 ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ');
  console.log(line(headers));
  console.log('  ' + widths.map((w) => '-'.repeat(w)).join('  '));
  for (const row of rows) console.log(line(row));
}

// --- deterministic randomness ----------------------------------------------

/** mulberry32: small, fast, and reproducible from a seed. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable seed from a string, so a failure on "greece" reproduces exactly. */
function seedOf(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// --- module loading, tolerant of churn -------------------------------------

/** Import a module, recording a failure (and returning null) if it will not load. */
async function tryImport(spec) {
  try {
    return await import(spec);
  } catch (err) {
    fail(`cannot import ${spec}: ${err.message}`);
    return null;
  }
}

/** Names a module must export for a suite to mean anything. */
const missingExports = (mod, names) => names.filter((n) => mod[n] === undefined);

const gfx = await tryImport('../engine/gfx.js');
const tilesMod = await tryImport('../engine/tiles.js');
const uiMod = await tryImport('../engine/ui.js');
const inputMod = await tryImport('../engine/input.js');
const audioMod = await tryImport('../engine/audio.js');
const saveMod = await tryImport('../engine/save.js');
const shellMod = await tryImport('../engine/shell.js');
const levelsMod = await tryImport('../games/explorer/levels.js');
const travelMod = await tryImport('../games/explorer/travel.js');
const gameMod = await tryImport('../games/explorer/main.js');

if (!gfx || !tilesMod || !uiMod || !inputMod || !audioMod || !saveMod || !levelsMod || !gameMod) {
  console.error('\nCould not load the engine or the cartridge; nothing can be played.');
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}

const { Screen, wrapText, LOOKS } = gfx;
const { TILE } = tilesMod;
const { TextBox } = uiMod;
const { Input } = inputMod;
const { Audio } = audioMod;
const { Save } = saveMod;
const { LEVELS, LEVEL_BY_ID } = levelsMod;
const GAME = gameMod.default || gameMod;

if (typeof GAME?.create !== 'function') {
  console.error('\ngames/explorer/main.js no longer exports a cartridge with create(); nothing can be played.');
  process.exit(1);
}

const ARG = process.argv[2];
const TARGETS = ARG ? LEVELS.filter((l) => l.id === ARG) : LEVELS;
if (ARG && !TARGETS.length) {
  console.error(`No such place "${ARG}". Known: ${LEVELS.map((l) => l.id).join(', ')}`);
  process.exit(2);
}

// Arm's reach for the A button, in world pixels: REACH_WALK from main.js. A
// rider gets a little more (REACH_RIDE, 30, because a bike cannot stop dead),
// but a landmark that can only be read from the saddle is a landmark you cannot
// read before you have found a bike - so every reachability test here asks the
// stricter on-foot question.
const REACH = 22;

// The console's framebuffer is chosen at boot from the device, so every layout
// has to survive both ends of the range documented in engine/shell.js.
const SCREENS = [
  { w: 160, h: 128, label: 'smallest' },
  { w: 160, h: 288, label: 'narrow/tall' },
  { w: 320, h: 128, label: 'wide/short' },
  { w: 320, h: 288, label: 'largest' },
  { w: 208, h: 176, label: 'typical' },
];
const SMALLEST = SCREENS[0];

// --- fetch over the working tree -------------------------------------------
//
// The cartridge loads its map extracts and photo panels with `fetch` against
// its own module URL. Under Node that is a file: URL, which the built-in fetch
// refuses, so point it at the disk instead. This is what lets the harness run
// the cartridge's own loader rather than a copy of it.

const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = input instanceof URL ? input : new URL(String(input), 'file:///');
  if (url.protocol !== 'file:') return realFetch(input, init);
  try {
    const body = await readFile(fileURLToPath(url), 'utf8');
    return { ok: true, status: 200, url: url.href, json: async () => JSON.parse(body), text: async () => body };
  } catch {
    return { ok: false, status: 404, url: url.href, json: async () => null, text: async () => '' };
  }
};

// --- a console with no browser under it ------------------------------------

/**
 * Enough of engine/scene.js's Handheld to run real scenes: the scene stack, the
 * transition that owns the console while it fades, input, and saves. No canvas,
 * so drawing is done on demand into a bare Screen.
 */
class StubConsole {
  constructor(width = 208, height = 176, lookId = 'color') {
    this.screen = new Screen(width, height);
    this.input = new Input();
    // The real Audio class is inert with no AudioContext, so every SFX call is
    // exercised for free and makes no sound.
    this.audio = new Audio();
    this.lookId = lookId;
    this.look = LOOKS[lookId];
    this.stack = [];
    this.transition = null;
    this.imagePalette = null;
    this.time = 0;
  }

  get scene() {
    return this.stack[this.stack.length - 1];
  }

  push(scene) {
    this.stack.push(scene);
    scene.enter?.(this);
    return scene;
  }

  pop() {
    const scene = this.stack.pop();
    scene?.exit?.(this);
    return scene;
  }

  replace(scene) {
    while (this.stack.length) this.pop();
    return this.push(scene);
  }

  setImagePalette(palette) {
    this.imagePalette = palette || null;
  }

  applyFade() {}

  saveFor(gameId) {
    return new Save(`game:${gameId}`);
  }

  transitionTo(swap, { duration = 0.34 } = {}) {
    if (this.transition) return;
    const half = duration / 2;
    let t = 0;
    let swapped = false;
    this.transition = {
      update: (dt, sys) => {
        t += dt;
        if (t >= half && !swapped) {
          swapped = true;
          swap(sys);
        } else if (swapped && t >= duration) {
          sys.transition = null;
        }
      },
    };
  }

  tick(dt) {
    this.time += dt;
    this.input.poll(dt);
    // A transition owns the console while it runs, exactly as in scene.js.
    if (this.transition) {
      this.transition.update(dt, this);
      return;
    }
    this.scene?.update?.(dt, this);
  }

  /** One frame. setImmediate is enough to flush promises already resolved. */
  async frame(dt = 1 / 60) {
    await new Promise((r) => setImmediate(r));
    this.tick(dt);
  }

  /**
   * One frame that also yields to the timer queue. A file read finishes on the
   * libuv thread pool, and a whole spin of setImmediate callbacks can go by
   * before it lands - so anything waiting on the cartridge's `fetch` has to
   * give real time back, or the wait is a race the harness usually loses.
   */
  async frameIO(dt = 1 / 60) {
    await new Promise((r) => setTimeout(r, 1));
    this.tick(dt);
  }

  /** Press and release a button across two frames, the way a player does. */
  async tap(button) {
    this.input.setFrom('key', button, true);
    await this.frame();
    this.input.setFrom('key', button, false);
    await this.frame();
  }

  /** Run frames until no transition is in flight. */
  async settle(maxFrames = 240) {
    for (let i = 0; i < maxFrames && this.transition; i++) await this.frame();
    return !this.transition;
  }

  /** Run frames until `pred(scene)` holds, or give up. Waits on IO properly. */
  async waitFor(pred, maxFrames = 900) {
    for (let i = 0; i < maxFrames; i++) {
      if (pred(this.scene)) return this.scene;
      await this.frameIO();
    }
    return pred(this.scene) ? this.scene : null;
  }

  /** Run frames until `pred()` holds or the budget runs out. */
  async waitUntil(pred, maxFrames = 300) {
    for (let i = 0; i < maxFrames && !pred(); i++) await this.frameIO();
    return pred();
  }
}

const isWorldScene = (s) => Boolean(s && typeof s.blocked === 'function' && s.map && s.level);

/**
 * Boot the cartridge and walk the menus until the named place is loaded, the
 * same way a player would: title, place select, loading screen, world.
 * @returns {Promise<{sys: StubConsole, world: object}|null>}
 */
async function enterWorld(levelId) {
  const sys = new StubConsole();
  sys.push(GAME.create(sys));
  await sys.frame();
  await sys.tap('a'); // title -> place select
  await sys.settle();

  const index = LEVELS.findIndex((l) => l.id === levelId);
  for (let i = 0; i < index; i++) await sys.tap('down');
  await sys.tap('a'); // select -> loading -> world

  const world = await sys.waitFor(isWorldScene, 1800);
  // The scene stack swaps at the darkest point of the fade, so the WorldScene
  // is on top a beat before the console hands control back to it.
  await sys.settle();
  return world ? { sys, world } : null;
}

// --- walkability model -----------------------------------------------------
//
// The feet box in WorldScene.blocked is seven pixels square, x-3..x+3 by
// y-3..y+3, which is the largest that still fits inside one eight pixel tile.
// (It used to be nine wide; that version could never fit in a one-tile path,
// which is what the first run of this harness found. If it ever grows again,
// the self-check in suite 1 fails on the first tile it disagrees about.)
//
// Seven pixels on an eight pixel grid partitions each axis into three windows
// per tile. Taking x and column c:
//
//   x in [8c+3, 8c+5)   the box is wholly inside column c
//   x in [8c+5, 8c+11)  it leans east, covering columns c and c+1
//   x in [8c-3, 8c+3)   it leans west, covering columns c-1 and c
//
// and the same in y for rows. A position is legal exactly when every tile in
// (its columns x its rows) is open - so leaning both east and south needs the
// south-east diagonal open too, not just the two orthogonal neighbours.
//
// Two things fall out, and they are what the rest of the file is built on:
//
//   1. The box fits inside one tile, so "the walker can stand centred on this
//      tile" is simply "this tile is open". That is the flood-fill graph.
//   2. The positions the walker can hold *near* a tile are the union of up to
//      nine window rectangles, one per (x window, y window) pair whose tiles
//      are all open. That is what the arm's-reach tests measure against, and
//      it is exact rather than approximate - suite 1 checks both claims
//      against the game's own blocked() on every tile of every map.

/** Uint8 grid: 1 where the walker can stand centred on the tile. */
function standingGrid(map) {
  const { w, h, solid } = map;
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    for (let x = 0; x < w; x++) out[row + x] = solid[row + x] ? 0 : 1;
  }
  return out;
}

// Eight neighbours with integer costs: 5 for a step, 7 for a diagonal, which is
// 5*sqrt(2) rounded. Distances come back in fifths of a tile.
const STEP = 5;
const DIAG = 7;
const NEIGHBOURS = [
  [1, 0, STEP],
  [-1, 0, STEP],
  [0, 1, STEP],
  [0, -1, STEP],
  [1, 1, DIAG],
  [1, -1, DIAG],
  [-1, 1, DIAG],
  [-1, -1, DIAG],
];

/**
 * Walking distance from one tile to every tile the walker can reach, by Dial's
 * algorithm - a bucket queue, since there are only two edge weights. Typed
 * arrays throughout: the Greece map is 676x1171 tiles and a Set of "x,y"
 * strings would be unusable.
 *
 * @param {object} map compiled by engine/geo.js
 * @param {Uint8Array} stand grid from standingGrid
 * @param {number} sx start tile x
 * @param {number} sy start tile y
 * @returns {{dist: Int32Array, reached: number}} dist is -1 where unreachable,
 *   otherwise the walk length in fifths of a tile
 */
function walkField(map, stand, sx, sy) {
  const { w, h } = map;
  const dist = new Int32Array(w * h).fill(-1);
  const start = sy * w + sx;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || !stand[start]) return { dist, reached: 0 };

  const buckets = [[start]];
  dist[start] = 0;
  let reached = 0;

  for (let d = 0; d < buckets.length; d++) {
    const bucket = buckets[d];
    if (!bucket) continue;
    for (let k = 0; k < bucket.length; k++) {
      const i = bucket[k];
      if (dist[i] !== d) continue; // superseded by a shorter route
      reached++;
      const x = i % w;
      const y = (i / w) | 0;
      for (const [dx, dy, cost] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!stand[j]) continue;
        // A diagonal is resolved per axis in WorldScene.update, so it only
        // happens when the horizontal half of it is walkable too.
        if (dx && dy && !stand[y * w + nx]) continue;
        const nd = d + cost;
        if (dist[j] >= 0 && dist[j] <= nd) continue;
        dist[j] = nd;
        (buckets[nd] || (buckets[nd] = [])).push(j);
      }
    }
    buckets[d] = null; // let the collector have it back
  }
  return { dist, reached };
}

/** Plain 4-connected flood over open tiles, ignoring how wide the walker is. */
function openField(map, sx, sy) {
  const { w, h, solid } = map;
  const seen = new Uint8Array(w * h);
  const start = sy * w + sx;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h || solid[start]) return { seen, reached: 0 };
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = 1;
  let reached = 0;
  while (head < tail) {
    const i = queue[head++];
    reached++;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0 && !solid[i - 1] && !seen[i - 1]) ((seen[i - 1] = 1), (queue[tail++] = i - 1));
    if (x < w - 1 && !solid[i + 1] && !seen[i + 1]) ((seen[i + 1] = 1), (queue[tail++] = i + 1));
    if (y > 0 && !solid[i - w] && !seen[i - w]) ((seen[i - w] = 1), (queue[tail++] = i - w));
    if (y < h - 1 && !solid[i + w] && !seen[i + w]) ((seen[i + w] = 1), (queue[tail++] = i + w));
  }
  return { seen, reached };
}

/**
 * Label every connected region of standable ground, so a stranded spawn can be
 * reported against the size of the region it should have been in.
 * @returns {{label: Int32Array, sizes: number[], largest: number}}
 */
function componentsOf(map, stand) {
  const { w, h } = map;
  const label = new Int32Array(w * h).fill(-1);
  const queue = new Int32Array(w * h);
  const sizes = [];
  for (let s = 0; s < label.length; s++) {
    if (!stand[s] || label[s] >= 0) continue;
    const id = sizes.length;
    let head = 0;
    let tail = 0;
    queue[tail++] = s;
    label[s] = id;
    let size = 0;
    while (head < tail) {
      const i = queue[head++];
      size++;
      const x = i % w;
      const y = (i / w) | 0;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (!stand[j] || label[j] >= 0) continue;
        if (dx && dy && !stand[y * w + nx]) continue;
        label[j] = id;
        queue[tail++] = j;
      }
    }
    sizes.push(size);
  }
  let largest = 0;
  for (let i = 1; i < sizes.length; i++) if (sizes[i] > sizes[largest]) largest = i;
  return { label, sizes, largest };
}

// The three windows one axis of the box can occupy relative to a tile: wholly
// inside it, leaning into the next tile, leaning into the previous one. `off`
// lists the tiles covered, `lo`/`hi` the half-open range of positions. The
// body is never pinned to tile centres, which is why arm's reach is measured
// against these rectangles rather than against a point.
const WINDOWS = [
  { off: [0], lo: 3, hi: 5 },
  { off: [0, 1], lo: 5, hi: 11 },
  { off: [-1, 0], lo: -3, hi: 3 },
];

/**
 * Every rectangle of legal walker positions anchored on tile (tx,ty): the pairs
 * of windows whose whole tile footprint is open. Up to nine of them, always at
 * least one when the tile itself is open.
 * @returns {Array<{x0:number,x1:number,y0:number,y1:number}>}
 */
function standingRects(map, stand, tx, ty) {
  const out = [];
  for (const xw of WINDOWS) {
    for (const yw of WINDOWS) {
      let ok = true;
      for (const dx of xw.off) {
        for (const dy of yw.off) {
          const x = tx + dx;
          const y = ty + dy;
          if (x < 0 || y < 0 || x >= map.w || y >= map.h || !stand[y * map.w + x]) {
            ok = false;
            break;
          }
        }
        if (!ok) break;
      }
      if (!ok) continue;
      // hi is exclusive in the model; step back a hair so clamping to it stays
      // on the legal side of the boundary.
      out.push({ x0: tx * TILE + xw.lo, x1: tx * TILE + xw.hi - 0.01, y0: ty * TILE + yw.lo, y1: ty * TILE + yw.hi - 0.01 });
    }
  }
  return out;
}

const clampTo = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

const rectDistance = (r, px, py) => Math.hypot(px - clampTo(px, r.x0, r.x1), py - clampTo(py, r.y0, r.y1));

/** How close the walker can get to a point while standing on tile (tx,ty). */
function reachDistance(map, stand, tx, ty, px, py) {
  let best = Infinity;
  for (const r of standingRects(map, stand, tx, ty)) best = Math.min(best, rectDistance(r, px, py));
  return best;
}

/** The legal walker position on tile (tx,ty) that gets closest to a point. */
function standingPosition(map, stand, tx, ty, px, py) {
  let best = null;
  let bestD = Infinity;
  for (const r of standingRects(map, stand, tx, ty)) {
    const d = rectDistance(r, px, py);
    if (d < bestD) ((bestD = d), (best = r));
  }
  if (!best) return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
  return { x: clampTo(px, best.x0, best.x1), y: clampTo(py, best.y0, best.y1) };
}

/**
 * The cheapest place to stand to read a post: the reachable tile from which the
 * walker can get within arm's reach of it.
 * @returns {{tx:number, ty:number, cost:number, gap:number}|null}
 */
function standingSpotNear(map, stand, dist, px, py, { reach = REACH, by = 'cost' } = {}) {
  const span = Math.ceil(reach / TILE) + 2;
  const cx = Math.floor(px / TILE);
  const cy = Math.floor(py / TILE);
  let best = null;
  for (let ty = cy - span; ty <= cy + span; ty++) {
    for (let tx = cx - span; tx <= cx + span; tx++) {
      if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) continue;
      const i = ty * map.w + tx;
      if (!stand[i]) continue;
      if (dist && dist[i] < 0) continue;
      const gap = reachDistance(map, stand, tx, ty, px, py);
      if (gap >= reach) continue;
      const cost = dist ? dist[i] : 0;
      const better = by === 'gap' ? !best || gap < best.gap : !best || cost < best.cost;
      if (better) best = { tx, ty, cost, gap };
    }
  }
  return best;
}

/** Put the walker as close to a post as the collision box allows. */
function standBeside(place, px, py) {
  const { map, stand, field } = place;
  const spot =
    standingSpotNear(map, stand, field.dist, px, py, { by: 'gap' }) || standingSpotNear(map, stand, null, px, py, { by: 'gap' });
  if (!spot) return null;
  return { spot, ...standingPosition(map, stand, spot.tx, spot.ty, px, py) };
}

/** Cost in fifths of a tile -> metres on the ground. */
const metresOf = (map, cost) => (cost / STEP) * map.metersPerTile;
/** Cost in fifths of a tile -> seconds of walking at the level's walk speed. */
const secondsOf = (map, cost) => ((cost / STEP) * TILE) / map.walkSpeed;

const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

// --- state shared between suites -------------------------------------------

/** Everything the suites need about one place, computed once. */
const places = new Map();

async function placeFor(levelId) {
  if (places.has(levelId)) return places.get(levelId);
  let session = null;
  try {
    session = await enterWorld(levelId);
  } catch (err) {
    // The cartridge is being worked on by other people; a shape change should
    // read as one clear failure, not a stack trace out of the harness.
    fail(`${levelId}: playing into the world threw - ${err.stack?.split('\n').slice(0, 2).join(' | ') || err}`);
  }
  if (!session) {
    places.set(levelId, null);
    fail(`${levelId}: could not reach a WorldScene by playing the menus - the cartridge may not boot`);
    return null;
  }
  const map = session.world.map;
  const stand = standingGrid(map);
  const spawn = map.spawn || { x: map.w * 4, y: map.h * 4 };
  const sx = Math.floor(spawn.x / TILE);
  const sy = Math.floor(spawn.y / TILE);
  const comps = componentsOf(map, stand);
  const entry = {
    session,
    world: session.world,
    map,
    stand,
    spawnTile: [sx, sy],
    field: walkField(map, stand, sx, sy),
    open: openField(map, sx, sy),
    comps,
  };

  // When the spawn is stranded, distances measured from it are all "infinity",
  // which tells nobody anything. Measure from the main walkable region instead,
  // so the report still shows what the level looks like once the spawn is
  // moved, and say plainly that is what happened.
  const spawnComp = comps.label[sy * map.w + sx];
  if (spawnComp === comps.largest) {
    entry.refField = entry.field;
    entry.refLabel = 'the spawn point';
  } else {
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < comps.label.length; i++) {
      if (comps.label[i] !== comps.largest) continue;
      const d = (i % map.w - sx) ** 2 + (((i / map.w) | 0) - sy) ** 2;
      if (d < bestD) ((bestD = d), (best = i));
    }
    entry.refTile = best >= 0 ? [best % map.w, (best / map.w) | 0] : [sx, sy];
    entry.refField = walkField(map, stand, entry.refTile[0], entry.refTile[1]);
    entry.refLabel = `tile ${entry.refTile[0]},${entry.refTile[1]} in the main region (the spawn is stranded)`;
  }

  places.set(levelId, entry);
  return entry;
}

/**
 * Landmarks, travel hubs and bike racks together: everything on the map the
 * player has to be able to walk up to. A rack that cannot be reached on foot is
 * a bicycle that does not exist.
 */
const targetsOn = (map) => [
  ...map.pois.map((p) => ({ kind: 'landmark', id: p.id, name: p.name, x: p.postX ?? p.x, y: p.postY ?? p.y, at: p.at })),
  ...(map.hubs || []).map((h) => ({ kind: 'hub', id: h.id, name: h.name, x: h.postX, y: h.postY, at: h.at })),
  ...(map.racks || []).map((r) => ({ kind: 'rack', id: r.id, name: r.name, x: r.postX, y: r.postY, at: r.at })),
];

/** Prefix used for a target in the report tables. */
const tag = (t) => (t.kind === 'landmark' ? '' : `(${t.kind}) `);

// --- suite 1: reachability -------------------------------------------------

async function suiteReachability() {
  suite('1. REACHABILITY  (flood fill of walkable ground from the spawn point)');

  for (const level of TARGETS) {
    const place = await placeFor(level.id);
    if (!place) continue;
    const { world, map, stand, field, open, comps, spawnTile } = place;
    const [sx, sy] = spawnTile;

    // Self-check, and the thing that keeps this file honest while the game
    // moves: the model has to agree with the game's own collision test, or
    // every verdict in this suite is worthless.
    //
    // Claim 1, over every tile of the map: an open tile is one the walker can
    // stand centred on, and a solid one is not.
    let mismatches = 0;
    for (let y = 1; y < map.h - 1 && mismatches === 0; y++) {
      for (let x = 1; x < map.w - 1; x++) {
        const model = stand[y * map.w + x] === 1;
        if (model === !world.blocked(x * TILE + TILE / 2, y * TILE + TILE / 2)) continue;
        mismatches++;
        fail(
          `${level.id}: the harness collision model disagrees with WorldScene.blocked at tile ${x},${y} - ` +
            `the model says ${model ? 'standable' : 'solid'}. The feet box has changed size; update standingGrid and WINDOWS.`,
        );
        break;
      }
    }

    // Claim 2, on a seeded sample: every position the model calls legal really
    // is, and every position the game calls legal is one the model knows about.
    // A quarter-pixel sweep of the whole map would be exact but takes minutes,
    // and a few thousand samples catch a broken window table immediately.
    const rand = prng(seedOf(`${level.id}:rects`));
    let unsound = 0;
    let uncovered = 0;
    for (let n = 0; n < 3000 && !unsound && !uncovered; n++) {
      const tx = 1 + Math.floor(rand() * (map.w - 2));
      const ty = 1 + Math.floor(rand() * (map.h - 2));
      if (!stand[ty * map.w + tx]) continue;
      for (const r of standingRects(map, stand, tx, ty)) {
        for (const [px, py] of [
          [r.x0, r.y0],
          [r.x1, r.y1],
          [r.x0, r.y1],
          [r.x1, r.y0],
          [(r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2],
        ]) {
          if (!world.blocked(px, py)) continue;
          unsound++;
          fail(
            `${level.id}: the model calls ${px.toFixed(2)},${py.toFixed(2)} a legal position on tile ${tx},${ty}, ` +
              `but WorldScene.blocked disagrees`,
          );
          break;
        }
        if (unsound) break;
      }
      // And the other direction, from a position the game accepts.
      const px = tx * TILE + rand() * TILE;
      const py = ty * TILE + rand() * TILE;
      if (world.blocked(px, py)) continue;
      const home = standingRects(map, stand, Math.floor(px / TILE), Math.floor(py / TILE));
      if (home.some((r) => px >= r.x0 && px <= r.x1 + 0.01 && py >= r.y0 && py <= r.y1 + 0.01)) continue;
      uncovered++;
      fail(`${level.id}: WorldScene.blocked allows ${px.toFixed(2)},${py.toFixed(2)} but no window in the model covers it`);
    }

    const spawnComp = comps.label[sy * map.w + sx];
    const spawnSize = spawnComp >= 0 ? comps.sizes[spawnComp] : 0;
    const largestSize = comps.sizes[comps.largest] || 0;
    let standCount = 0;
    for (let i = 0; i < stand.length; i++) standCount += stand[i];

    note(
      `${level.id}: spawn tile ${sx},${sy}; ${standCount} standable tiles in ${comps.sizes.length} regions, ` +
        `largest ${largestSize}; the spawn's region holds ${spawnSize} (${Math.round((spawnSize / (largestSize || 1)) * 100)}% of it); ` +
        `${open.reached} tiles are open ground around the spawn`,
    );

    if (!check(stand[sy * map.w + sx] === 1, `${level.id}: the spawn point is not somewhere the walker fits - it starts clipping a wall`)) {
      continue;
    }
    check(
      spawnSize >= largestSize * 0.5,
      `${level.id}: the spawn point is in a ${spawnSize}-tile pocket while the main walkable region is ${largestSize} tiles - ` +
        `the player starts boxed in and can never leave (spawn tile ${sx},${sy}, from start ${JSON.stringify(level.start)})`,
    );

    const spawnIsMain = spawnComp === comps.largest;
    const rows = [];
    const stranded = [];
    const unreadable = [];
    const islanded = [];
    for (const target of targetsOn(map)) {
      const spot = standingSpotNear(map, stand, field.dist, target.x, target.y);
      const anywhere = standingSpotNear(map, stand, null, target.x, target.y);
      const tx = Math.floor(target.x / TILE);
      const ty = Math.floor(target.y / TILE);
      const comp = comps.label[ty * map.w + tx];
      const inOpen = open.seen[ty * map.w + tx] === 1;

      let verdict;
      if (spot) verdict = 'ok';
      else if (!anywhere) {
        verdict = 'no standing room';
        unreadable.push(target);
      } else {
        // Open ground that joins up while walkable ground does not means the
        // only way through is a gap the walker is too wide for.
        verdict = inOpen ? 'cut off (narrow gap)' : 'cut off';
        stranded.push({ ...target, inOpen });
      }
      // Which walkable region you would be standing in to read it - the post
      // itself usually sits on the building, which is nobody's region.
      const stance = spot || anywhere;
      const stanceComp = stance ? comps.label[stance.ty * map.w + stance.tx] : comp;
      // Islanded is a separate fault from a badly placed spawn: this landmark
      // is off the map's main walkable region no matter where you start.
      if (anywhere && stanceComp !== comps.largest) islanded.push({ ...target, size: comps.sizes[stanceComp] ?? 0 });
      rows.push([
        `${tag(target)}${target.id}`,
        `${tx},${ty}`,
        stanceComp >= 0 ? `#${stanceComp} (${comps.sizes[stanceComp]})` : '-',
        verdict,
      ]);
    }
    table(['target', 'post tile', 'region', 'verdict'], rows);

    // One failure per level rather than one per landmark: nine stranded
    // landmarks on one map is one bug, not nine.
    if (unreadable.length) {
      fail(
        `${level.id}: ${unreadable.length} landmark(s) have no tile within ${REACH}px that the walker can stand on, ` +
          `so the A prompt can never appear: ${unreadable.map((t) => `${t.id} "${t.name}" at ${t.at}`).join(', ')}`,
      );
    }
    for (const t of islanded) {
      fail(
        `${level.id}/${t.id} "${t.name}" (${t.kind}) sits on an island: the only ground you ` +
          `can read it from is a ${t.size}-tile region with no walkable link to the ${largestSize}-tile main region, ` +
          `so it is unreachable wherever the player starts (post at ${t.at})`,
      );
    }
    if (stranded.length) {
      // With a broken spawn every target is stranded by definition; that is one
      // bug, already reported above, not one per landmark.
      const unexplained = stranded.filter((t) => !islanded.some((i) => i.id === t.id));
      if (spawnIsMain && unexplained.length) {
        fail(
          `${level.id}: ${unexplained.length} of ${rows.length} landmarks, hubs or bike racks cannot be walked to from the spawn point: ` +
            unexplained.map((t) => `${t.id} "${t.name}"`).join(', '),
        );
      } else if (!spawnIsMain) {
        note(
          `${level.id}: ${stranded.length} of ${rows.length} targets are unreachable from the spawn, all of it downstream of the ` +
            `spawn pocket above; ${unexplained.length} of them come back the moment the spawn is moved`,
        );
      }
    }
    console.log('');
  }
}

// --- suite 2: simulated walking --------------------------------------------

/** One frame of held input, applied to the real WorldScene update. */
async function driveFrame(sys, held, dt = 1 / 60) {
  for (const b of ['up', 'down', 'left', 'right', 'b']) sys.input.setFrom('key', b, held.has(b));
  await new Promise((r) => setImmediate(r));
  sys.tick(dt);
}

const DIRS = ['up', 'down', 'left', 'right'];

/**
 * Put the body on a bicycle the way a player does: the bike is yours once you
 * have found a rack, and SELECT is the toggle.
 * @returns {Promise<boolean>} true if it is now riding
 */
async function mountBike(sys, world) {
  sys.input.clearSource('key');
  world.hasBike = true;
  await sys.tap('select');
  return Boolean(world.riding);
}

/**
 * The anti-tunnelling substep in WorldScene.step, tested where it bites: a body
 * asked to cross a one-tile wall in a single call. Without substepping the one
 * collision test lands on the open ground beyond and the wall is simply not
 * there; with it, the move is cut into pieces no larger than the feet box and
 * the body stops against the wall.
 *
 * This is a direct test of `step`, not of a frame: at the console's fixed
 * 1/60s a bicycle covers under 3px, so ordinary play never exercises the
 * substep at all. It is insurance against a faster body or a longer frame, and
 * insurance nobody tests is not insurance.
 */
function checkSubstepping(level, place) {
  const { world, map, stand } = place;
  if (typeof world.step !== 'function') {
    skip(`${level.id}: WorldScene has no step(); the anti-tunnelling substep is untested`);
    return 0;
  }

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const savedX = world.x;
  const savedY = world.y;
  let tested = 0;
  let tunnels = 0;

  for (const [dx, dy] of dirs) {
    // Somewhere with a wall exactly one tile thick and open ground behind it,
    // which is the geometry a single long collision test jumps straight over.
    const spots = [];
    const stride = Math.max(1, Math.floor((map.w * map.h) / 4000));
    for (let i = 0; i < stand.length && spots.length < 8; i += stride) {
      const x = i % map.w;
      const y = (i / map.w) | 0;
      const x1 = x + dx;
      const y1 = y + dy;
      const x2 = x + dx * 2;
      const y2 = y + dy * 2;
      if (x2 < 0 || y2 < 0 || x2 >= map.w || y2 >= map.h) continue;
      if (!stand[i] || stand[y1 * map.w + x1] || !stand[y2 * map.w + x2]) continue;
      spots.push([x, y, x1, y1]);
    }

    for (const [x, y, wallX, wallY] of spots) {
      for (const distance of [TILE * 2, TILE * 6]) {
        world.x = x * TILE + TILE / 2;
        world.y = y * TILE + TILE / 2;
        const got = world.step(dx * distance, dy * distance);
        tested++;

        const landedX = Math.floor(world.x / TILE);
        const landedY = Math.floor(world.y / TILE);
        const past = dx ? (dx > 0 ? landedX >= wallX : landedX <= wallX) : dy > 0 ? landedY >= wallY : landedY <= wallY;
        if (past) {
          tunnels++;
          if (tunnels === 1) {
            fail(
              `${level.id}: a ${distance}px step from tile ${x},${y} went through the solid tile at ${wallX},${wallY} ` +
                `and came to rest on ${landedX},${landedY} - the move is not being split into substeps`,
            );
          }
        }
        if (world.blocked(world.x, world.y)) {
          fail(`${level.id}: a ${distance}px step from tile ${x},${y} ended inside a solid tile`);
        }
        // step() documents its return as how far it actually got.
        const actual = Math.hypot(world.x - (x * TILE + TILE / 2), world.y - (y * TILE + TILE / 2));
        check(
          Math.abs(got - actual) < 0.01,
          `${level.id}: step() reported ${got.toFixed(2)}px of movement but the body moved ${actual.toFixed(2)}px`,
        );
      }
    }
  }

  world.x = savedX;
  world.y = savedY;
  return { tested, tunnels };
}

async function suiteWalking() {
  suite('2. SIMULATED WALKING AND RIDING  (the real WorldScene movement code)');

  for (const level of TARGETS) {
    const place = await placeFor(level.id);
    if (!place) continue;
    const { world, session, map } = place;
    const sys = session.sys;

    // Start from the spawn and from a legal standing spot beside every landmark,
    // hub and bike rack - the places the game actually drops a body.
    const starts = [{ name: 'spawn', x: map.spawn.x, y: map.spawn.y }];
    for (const target of targetsOn(map)) {
      const stance = standBeside(place, target.x, target.y);
      if (!stance) continue; // suite 1 has already reported this one
      starts.push({ name: target.id, x: stance.x, y: stance.y });
    }

    for (const mode of ['walk', 'ride']) {
      if (mode === 'ride') {
        if (typeof world.mount !== 'function') {
          skip(`${level.id}: WorldScene has no mount(); the bicycle is untested`);
          continue;
        }
        if (!check(await mountBike(sys, world), `${level.id}: SELECT with a bike in the saddlebag did not start riding`)) continue;
      }

      const rand = prng(seedOf(`${level.id}:${mode}`));
      // Ceiling on how far any body can travel in one frame: the bike's paved
      // top speed from main.js. If the bike gets faster, raise this - but read
      // the collision failures first, because a faster body is exactly what
      // finds holes in a tile grid.
      const topMult = mode === 'ride' ? 2.9 : 2.1;
      const maxStep = map.walkSpeed * topMult * (1 / 60) * 1.02;
      let overlaps = 0;
      let escapes = 0;
      let wedges = 0;
      let jumps = 0;
      let frames = 0;
      let travelled = 0;
      let fastest = 0;
      const wedgedAt = [];

      for (const start of starts) {
        world.x = start.x;
        world.y = start.y;
        world.speed = 0; // no momentum carried over from the last starting point
        check(
          !world.blocked(world.x, world.y),
          `${level.id}: the body is inside a solid tile the moment it is placed at "${start.name}" (${start.x},${start.y})`,
        );

        // A scripted pass first - each direction, then every diagonal, so the
        // per-axis slide is exercised against walls - and then a random one.
        const runs = [];
        for (const d of DIRS) runs.push([new Set([d]), 90]);
        for (const a of ['up', 'down']) for (const b of ['left', 'right']) runs.push([new Set([a, b]), 60]);
        runs.push([new Set(['right', 'b']), 90]); // running on foot, braking on the bike
        for (let i = 0; i < 26; i++) {
          const held = new Set([DIRS[Math.floor(rand() * 4)]]);
          if (rand() > 0.55) held.add(DIRS[Math.floor(rand() * 4)]);
          if (rand() > 0.75) held.add('b');
          runs.push([held, 6 + Math.floor(rand() * 20)]);
        }

        for (const [held, count] of runs) {
          for (let f = 0; f < count; f++) {
            const px = world.x;
            const py = world.y;
            await driveFrame(sys, held);
            frames++;

            if (world.blocked(world.x, world.y)) {
              overlaps++;
              if (overlaps === 1) {
                fail(
                  `${level.id}: ${mode}ing ended a frame overlapping a solid tile at ` +
                    `${world.x.toFixed(1)},${world.y.toFixed(1)} (started at "${start.name}", ` +
                    `holding ${[...held].join('+')}, seed ${seedOf(`${level.id}:${mode}`)})`,
                );
              }
            }
            if (world.x < 4 || world.y < 8 || world.x > map.w * TILE - 4 || world.y > map.h * TILE - 4) {
              escapes++;
              if (escapes === 1) {
                fail(`${level.id}: ${mode}ing left the map at ${world.x.toFixed(1)},${world.y.toFixed(1)} (started at "${start.name}")`);
              }
            }
            const moved = Math.hypot(world.x - px, world.y - py);
            travelled += moved;
            if (moved > fastest) fastest = moved;
            if (moved > maxStep) {
              jumps++;
              if (jumps === 1) {
                fail(
                  `${level.id}: ${mode}ing covered ${moved.toFixed(2)}px in one frame, past the ${maxStep.toFixed(2)}px a body at ` +
                    `${topMult}x walk speed can manage (started at "${start.name}")`,
                );
              }
            }
          }

          // Wedged: nothing at all can move it, in any direction, at walking pace.
          const probe = map.walkSpeed / 60;
          const boxedIn =
            world.blocked(world.x + probe, world.y) &&
            world.blocked(world.x - probe, world.y) &&
            world.blocked(world.x, world.y + probe) &&
            world.blocked(world.x, world.y - probe);
          if (boxedIn) {
            wedges++;
            if (wedgedAt.length < 3) wedgedAt.push(`${world.x.toFixed(1)},${world.y.toFixed(1)} from "${start.name}"`);
          }
        }
      }

      if (wedges) {
        fail(
          `${level.id}: ${mode}ing wedged with no way out on ${wedges} occasion(s) - e.g. ${wedgedAt.join('; ')} ` +
            `(seed ${seedOf(`${level.id}:${mode}`)})`,
        );
      }

      note(
        `${level.id} ${mode}: ${frames} frames from ${starts.length} starting points, seed ${seedOf(`${level.id}:${mode}`)} - ` +
          `${Math.round((travelled / TILE) * map.metersPerTile)}m covered, top ${fastest.toFixed(2)}px/frame, ` +
          `${overlaps} overlaps, ${escapes} escapes, ${wedges} wedges, ${jumps} over-long steps`,
      );
    }

    // Back on foot, with nothing held: later suites place the body by hand and
    // must not have it riding away on its own.
    if (world.riding) await sys.tap('select');
    sys.input.clearSource('key');
    await sys.frame();
    check(!world.riding, `${level.id}: SELECT did not get the rider off the bike again`);

    const substep = checkSubstepping(level, place);
    if (substep?.tested) {
      note(
        `${level.id}: ${substep.tested} long single steps driven into one-tile walls, ` +
          `${substep.tunnels} of them went through`,
      );
    }
  }
}

// --- suite 3: how far is everything ----------------------------------------

async function suiteDistances() {
  suite('3. WALKING DISTANCE TO EVERY LANDMARK');

  for (const level of TARGETS) {
    const place = await placeFor(level.id);
    if (!place) continue;
    const { map, stand, refField, refLabel } = place;

    const rows = [];
    for (const target of targetsOn(map)) {
      const spot = standingSpotNear(map, stand, refField.dist, target.x, target.y);
      if (!spot) {
        rows.push([`${tag(target)}${target.id}`, 'UNREACHABLE', '-', '-']);
        continue;
      }
      const m = metresOf(map, spot.cost);
      const s = secondsOf(map, spot.cost);
      rows.push([`${tag(target)}${target.id}`, `${Math.round(m)} m`, mmss(s), Math.round(s)]);
      // Nothing on a campus or a suburb map is a half-hour walk from the spawn
      // unless the spawn or the landmark is in the wrong place.
      check(
        s < 600,
        `${level.id}/${target.id} "${target.name}" is a ${Math.round(m)}m walk from ${refLabel} - ` +
          `${mmss(s)} of holding one direction, which is not a level, it is a commute`,
      );
    }

    console.log(`  ${level.id}: from ${refLabel}; walk speed ${map.walkSpeed}px/s, ${map.metersPerTile}m per tile`);
    table(['target', 'on foot', 'walk time', 'seconds'], rows);
    console.log('');
  }
}

// --- suite 4: travel -------------------------------------------------------

/** Run one cut scene under a stub console and count its completion callbacks. */
function cutsceneRunner(createTravelCutscene, route, sys) {
  let done = 0;
  const scene = createTravelCutscene(route, sys, () => {
    done++;
  });
  return { scene, calls: () => done };
}

async function suiteTravel() {
  suite('4. TRAVEL ROUND TRIPS AND CUT SCENES');

  if (!travelMod) return skip('games/explorer/travel.js did not load; travel is untested');
  const needed = ['hubsFor', 'routesFrom', 'arrivalPixel', 'createTravelCutscene'];
  const missing = missingExports(travelMod, needed);
  if (missing.length) return skip(`travel.js no longer exports ${missing.join(', ')}; travel is untested`);
  const { hubsFor, routesFrom, arrivalPixel, createTravelCutscene } = travelMod;

  // The route graph: everywhere should be reachable from everywhere, or a
  // player can strand themselves at one end of the world.
  const edges = new Map(LEVELS.map((l) => [l.id, routesFrom(l.id).map((r) => r.to)]));
  for (const from of LEVELS) {
    const seen = new Set([from.id]);
    const stack = [from.id];
    while (stack.length) {
      for (const to of edges.get(stack.pop()) || []) if (!seen.has(to)) ((seen.add(to)), stack.push(to));
    }
    const unreachable = LEVELS.filter((l) => !seen.has(l.id)).map((l) => l.id);
    check(!unreachable.length, `no sequence of travel routes gets you from ${from.id} to ${unreachable.join(', ')}`);
  }

  const rows = [];
  const seenRoutes = new Set();

  /**
   * Check where one route puts you down: in bounds, standable, joined to the
   * rest of the map, and near enough to a hub that you can turn around again.
   */
  const checkArrival = (label, route) => {
    if (seenRoutes.has(label)) return;
    seenRoutes.add(label);
    const dest = places.get(route.to);
    if (!dest) return;

    const arrival = arrivalPixel(dest.map, route);
    const atx = Math.floor(arrival.x / TILE);
    const aty = Math.floor(arrival.y / TILE);
    if (!check(
      atx >= 0 && aty >= 0 && atx < dest.map.w && aty < dest.map.h,
      `${label}: the arrival point ${route.arriveAt} falls outside the ${route.to} map`,
    )) return;

    const i = aty * dest.map.w + atx;
    check(dest.stand[i] === 1, `${label}: you arrive on a tile too narrow for the walker to stand on (${route.arriveAt})`);

    // Connectivity is measured against the map's main walkable region, not the
    // spawn: a badly placed spawn is suite 1's finding, not this one's.
    const comp = dest.comps.label[i];
    const inMain = comp === dest.comps.largest;
    check(
      inMain,
      `${label}: you arrive in a ${comp >= 0 ? dest.comps.sizes[comp] : 0}-tile pocket, cut off from the ` +
        `${dest.comps.sizes[dest.comps.largest]}-tile main region of ${route.to}`,
    );

    // And you must be able to leave again: a hub within a short walk of where
    // the journey drops you, or the trip is one-way in practice.
    let nearest = Infinity;
    let nearestId = '-';
    for (const h of dest.map.hubs || []) {
      const d = Math.hypot(h.postX - arrival.x, h.postY - arrival.y);
      if (d < nearest) ((nearest = d), (nearestId = h.id));
    }
    const metres = (nearest / TILE) * dest.map.metersPerTile;
    check(
      Number.isFinite(metres) && metres < 400,
      `${label}: you land ${Math.round(metres)}m from the nearest travel hub on ${route.to}; there is no obvious way back`,
    );

    const walkCost = dest.refField.dist[i];
    rows.push([
      label,
      route.kind,
      inMain ? 'main' : 'POCKET',
      walkCost >= 0 ? `${Math.round(metresOf(dest.map, walkCost))} m` : 'no route',
      `${Math.round(metres)} m`,
      nearestId,
    ]);
  };

  for (const level of TARGETS) {
    for (const hub of hubsFor(level.id)) {
      for (const route of hub.routes) {
        const label = `${level.id}/${hub.id} -> ${route.to}`;
        if (!check(Boolean(LEVEL_BY_ID[route.to]), `${label}: route points at unknown level "${route.to}"`)) continue;
        if (!check(Boolean(await placeFor(route.to)), `${label}: the destination level would not compile or would not load`)) continue;
        checkArrival(label, route);

        // The return leg, so a round trip is tested even when the run is
        // narrowed to one place with an argument.
        const back = routesFrom(route.to).filter((r) => r.to === level.id);
        check(back.length > 0, `${label}: there is no route back from ${route.to} to ${level.id}; the journey is one-way`);
        for (const r of back) {
          if (await placeFor(r.from)) checkArrival(`${r.from}/${r.hubId ?? 'hub'} -> ${r.to}`, r);
        }
      }
    }
  }
  table(['route', 'by', 'region', 'walk to rest of map', 'to hub', 'return hub'], rows);
  console.log('');

  // --- cut scenes ---------------------------------------------------------
  //
  // These are time based and they own the console while they run, so one that
  // never reaches its end soft-locks the game between two places.
  const sys = new StubConsole();
  const cutRows = [];
  for (const level of TARGETS) {
    for (const route of routesFrom(level.id)) {
      const label = `${level.id} -> ${route.to} (${route.kind})`;

      const run = cutsceneRunner(createTravelCutscene, route, sys);
      let frames = 0;
      const limit = 60 * 30; // thirty seconds, many times any plausible journey
      while (run.calls() === 0 && frames < limit) {
        sys.input.poll(1 / 60);
        run.scene.update(1 / 60, sys);
        frames++;
      }
      const seconds = frames / 60;
      if (!check(run.calls() === 1, `${label}: the cut scene ran ${seconds.toFixed(1)}s without ever calling back - the game soft-locks here`)) {
        continue;
      }
      // Keep updating past the end: a second callback would swap the
      // destination scene in twice and leave the stack in a mess.
      for (let i = 0; i < 120; i++) {
        sys.input.poll(1 / 60);
        run.scene.update(1 / 60, sys);
      }
      check(run.calls() === 1, `${label}: the cut scene called its completion callback ${run.calls()} times, expected exactly once`);
      check(seconds > 1, `${label}: the cut scene finished in ${seconds.toFixed(2)}s, which is not a journey`);

      // ...and A must skip it, or a player who has seen it twice is trapped.
      const skipRun = cutsceneRunner(createTravelCutscene, route, sys);
      for (let i = 0; i < 12; i++) {
        sys.input.setFrom('key', 'a', i === 6);
        sys.input.poll(1 / 60);
        skipRun.scene.update(1 / 60, sys);
      }
      sys.input.setFrom('key', 'a', false);
      check(skipRun.calls() === 1, `${label}: pressing A did not skip the cut scene`);

      // Draw it at both ends of the resolution range, at points all along the
      // journey, so no phase throws or writes outside the framebuffer.
      let drawError = null;
      for (const size of [SCREENS[0], SCREENS[3]]) {
        const screen = new Screen(size.w, size.h);
        const probe = cutsceneRunner(createTravelCutscene, route, sys);
        for (let i = 0; i < 600 && probe.calls() === 0 && !drawError; i++) {
          sys.input.poll(1 / 60);
          probe.scene.update(1 / 60, sys);
          if (i % 5 === 0) {
            try {
              probe.scene.draw(screen, sys);
            } catch (err) {
              drawError = `at ${size.w}x${size.h}: ${err.message}`;
            }
          }
        }
        if (drawError) break;
      }
      check(!drawError, `${label}: the cut scene threw while drawing ${drawError}`);

      cutRows.push([label, `${seconds.toFixed(1)}s`, frames]);
    }
  }
  table(['cut scene', 'runs for', 'frames'], cutRows);
}

// --- suite 5: text and layout ----------------------------------------------

/**
 * True when wrapping broke a word in half. wrapText only ever does that in its
 * overflow path, so re-joining the lines with single spaces reproduces the
 * source exactly unless a word was cut.
 */
function brokeAWord(source, lines) {
  const words = String(source).split(/\s+/).filter(Boolean).join(' ');
  return lines.join(' ').replace(/\s+/g, ' ').trim() !== words;
}

async function suiteText() {
  suite('5. TEXT AND LAYOUT AT EVERY RESOLUTION');

  // The console picks its own resolution at boot; if that ever lands outside
  // the range the layouts were written for, every check below is moot.
  if (shellMod?.pickSize) {
    const viewports = [
      [320, 480],
      [360, 640],
      [390, 844],
      [414, 896],
      [768, 1024],
      [1280, 800],
      [1920, 1080],
    ];
    let worstW = Infinity;
    let worstH = Infinity;
    for (const [vw, vh] of viewports) {
      const s = shellMod.pickSize(vw, Math.round(vh / 2));
      worstW = Math.min(worstW, s.width);
      worstH = Math.min(worstH, s.height);
      check(
        s.width >= 160 && s.width <= 320 && s.height >= 128 && s.height <= 288,
        `pickSize(${vw}, ${Math.round(vh / 2)}) returned ${s.width}x${s.height}, outside the documented 160-320 x 128-288 range`,
      );
    }
    note(`pickSize over ${viewports.length} viewports stays in range; the smallest it ever hands back is ${worstW}x${worstH}`);
  } else {
    skip('engine/shell.js no longer exports pickSize; the resolution range is untested');
  }

  const rows = [];
  let worst = null;

  for (const level of TARGETS) {
    const place = await placeFor(level.id);
    if (!place) continue;

    for (const poi of place.map.pois) {
      const key = `${level.id}/${poi.id}`;
      const paragraphs = Array.isArray(poi.text) ? poi.text : [poi.text];

      for (const size of SCREENS) {
        const width = size.w - 12; // LandmarkScene builds its TextBox this way
        const lines = size.h < 170 ? 2 : 3;
        for (const para of paragraphs) {
          const wrapped = wrapText(para, width);
          if (brokeAWord(para, wrapped)) {
            const longest = para.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), '');
            fail(
              `${key}: wrapping at ${size.w}x${size.h} (${size.label}) breaks a word in half - ` +
                `"${longest}" is ${longest.length} characters and the line holds ${Math.floor((width + 1) / 6)}`,
            );
          }
          for (const line of wrapped) {
            check(
              line.length * 6 - 1 <= width,
              `${key}: a wrapped line overflows the ${size.w}px text box ("${line.slice(0, 30)}")`,
            );
          }
        }
        const box = new TextBox(paragraphs, { width, lines });
        for (const page of box.pages) {
          check(page.length <= lines, `${key}: a caption page has ${page.length} lines but only ${lines} fit at ${size.w}x${size.h}`);
        }
        if (size === SMALLEST) {
          const flat = box.pages.flat();
          rows.push([key, box.pages.length, flat.length, Math.max(...flat.map((l) => l.length))]);
          if (!worst || box.pages.length > worst.pages) worst = { key, pages: box.pages.length };
        }
      }
    }
  }

  console.log(`  caption paging at the smallest screen (${SMALLEST.w}x${SMALLEST.h}, ${SMALLEST.h < 170 ? 2 : 3} lines a page)`);
  table(['landmark', 'pages', 'lines', 'longest line'], rows);
  if (worst) {
    // Not a crash, but a landmark that takes a dozen A presses to read through
    // is a design smell worth having in the report.
    check(worst.pages <= 10, `${worst.key} takes ${worst.pages} pages of A-presses to read on the smallest screen`);
    note(`longest caption: ${worst.key} at ${worst.pages} pages`);
  }

  // --- the scenes themselves, drawn at both extremes ----------------------
  //
  // Drawing is where a layout bug actually bites, and the console re-allocates
  // its framebuffer whenever the viewport changes shape, so every scene is
  // handed a new Screen and told to re-lay itself out, exactly as scene.js
  // does in Handheld.resize.
  for (const level of TARGETS) {
    const place = await placeFor(level.id);
    if (!place) continue;
    const { world, session, map } = place;
    const sys = session.sys;
    const original = sys.screen;

    /** Re-lay a live scene at `size` and draw it. Returns an error string or ''. */
    const drawAt = (scene, size) => {
      const screen = new Screen(size.w, size.h);
      sys.screen = screen;
      try {
        scene.resized?.(size.w, size.h, sys);
        scene.draw(screen, sys);
        return '';
      } catch (err) {
        return `${size.w}x${size.h}: ${err.message}`;
      } finally {
        sys.screen = original;
      }
    };

    for (const size of SCREENS) {
      const err = drawAt(world, size);
      if (err) fail(`${level.id}: the world scene threw while drawing at ${err}`);

      // The HUD writes the current landmark name on the left and the tally on
      // the right of the same 16px strip; they must not run into each other.
      const longest = [map.name, ...map.pois.map((p) => p.name), ...(map.hubs || []).map((h) => h.name)].reduce(
        (a, b) => (b.length > a.length ? b : a),
        '',
      );
      const maxChars = Math.max(6, Math.floor((size.w - 60) / 6));
      const labelEnd = 4 + Math.min(longest.length, maxChars) * 6 - 1;
      const tally = `${map.pois.length}/${map.pois.length}`;
      const tallyX = size.w - 4 - (tally.length * 6 - 1);
      check(
        labelEnd < tallyX,
        `${level.id}: at ${size.w}x${size.h} the HUD label "${longest.slice(0, maxChars)}" runs to x=${labelEnd}, ` +
          `over the "${tally}" counter at x=${tallyX}`,
      );
    }

    // Open every landmark panel for real - stand beside the post, press A -
    // and draw it at every resolution, checking the picture, the photo credit
    // and the caption box never end up on top of one another. Panel art is
    // per-landmark, so one sample would not prove much.
    for (const poi of map.pois) {
      const stance = standBeside(place, poi.postX, poi.postY);
      if (!stance) continue; // suite 1 has already reported this one
      sys.input.clearSource('key');
      world.x = stance.x;
      world.y = stance.y;
      await sys.tap('a');
      const panel = await sys.waitFor((s) => s && s.poi === poi, 120);
      if (
        !check(
          Boolean(panel),
          `${level.id}: standing ${stance.spot.gap.toFixed(1)}px from "${poi.name}" (the closest the walker can get) and pressing A ` +
            `did not open its landmark panel - the game offered ${world.near ? `"${world.near.name}"` : world.hub ? `the ${world.hub.name} hub` : 'nothing'} instead`,
        )
      ) {
        // Whatever did open has to come off the stack or the next test is lost.
        while (sys.stack.length > 1) {
          await sys.tap('b');
          await sys.settle();
        }
        continue;
      }

      // The panel loads its photograph asynchronously; give it real time.
      await sys.waitUntil(() => panel.art, 300);
      check(Boolean(panel.art), `${level.id}/${poi.id}: the landmark panel never resolved its picture`);

      const lineCount = panel.constructor?.lineCount;
      for (const size of SCREENS) {
        const err = drawAt(panel, size);
        if (err) {
          fail(`${level.id}/${poi.id}: the landmark panel threw while drawing at ${err}`);
          continue;
        }
        if (typeof lineCount !== 'function') continue;
        const boxH = lineCount(size.h) * 9 + 13;
        const boxY = size.h - boxH;
        const artH = boxY - 11; // the header strip is 11px
        check(artH >= 24, `${level.id}/${poi.id}: at ${size.w}x${size.h} the caption box leaves only ${artH}px for the picture`);
        if (panel.art && uiMod.fitScale) {
          const scale = uiMod.fitScale(panel.art, size.w, artH);
          const ah = panel.art.h * scale;
          const ay = 11 + Math.round((artH - ah) / 2);
          const creditY = Math.min(boxY - 9, ay + ah + 1);
          check(
            creditY >= 11 && creditY + 9 <= boxY,
            `${level.id}/${poi.id}: at ${size.w}x${size.h} the photo credit (y=${creditY}) overlaps the caption box (y=${boxY})`,
          );
        }
      }
      await sys.tap('b'); // close it again
      await sys.settle();
    }

    // The pause screen rebuilds its minimap from the whole compiled map every
    // time the resolution changes, so it is worth drawing at every size.
    await sys.tap('start');
    const pause = await sys.waitFor((s) => s && s.mini, 60);
    if (check(Boolean(pause), `${level.id}: START did not open the pause screen`)) {
      for (const size of SCREENS) {
        const err = drawAt(pause, size);
        if (err) fail(`${level.id}: the pause screen threw while drawing at ${err}`);
      }
      await sys.tap('b');
      await sys.settle();
    }

    // Departure menus: the blurb is wrapped and then everything past the
    // fourth line is thrown away, which is where a long blurb quietly loses
    // its ending. Check that, and draw the real scene at every size.
    for (const hub of map.hubs || []) {
      if (hub.blurb) {
        const lines = wrapText(hub.blurb, SMALLEST.w - 12);
        check(
          lines.length <= 4,
          `${level.id}/${hub.id}: the departure blurb needs ${lines.length} lines at ${SMALLEST.w}x${SMALLEST.h} but ` +
            `DepartureScene only draws 4 - the player never sees "...${hub.blurb.slice(-40).trim()}"`,
        );
      }

      const stance = standBeside(place, hub.postX, hub.postY);
      if (!stance) continue;
      sys.input.clearSource('key');
      world.x = stance.x;
      world.y = stance.y;
      await sys.tap('a');
      const departures = await sys.waitFor((s) => s && s.hub === hub, 60);
      if (!check(Boolean(departures), `${level.id}/${hub.id}: standing at the hub and pressing A did not open the departure menu`)) {
        continue;
      }
      for (const size of SCREENS) {
        const err = drawAt(departures, size);
        if (err) fail(`${level.id}/${hub.id}: the departure menu threw while drawing at ${err}`);
        // Its route list is laid out below the blurb; the last row must still
        // clear the "B: STAY HERE" footer.
        const listY = 16 + 9 * Math.min(4, wrapText(hub.blurb || '', size.w - 12).length) + 10;
        const lastRow = listY + (Math.min(departures.menu?.visible ?? 4, departures.routes.length) - 1) * 18 + 9;
        check(
          lastRow + 7 <= size.h - 10,
          `${level.id}/${hub.id}: at ${size.w}x${size.h} the last destination row ends at y=${lastRow + 7}, ` +
            `over the footer at y=${size.h - 10}`,
        );
      }
      await sys.tap('b');
      await sys.settle();
    }
  }
}

// --- suite 6: saves --------------------------------------------------------

async function suiteSave() {
  suite('6. SAVE DATA WITH NO BATTERY');

  let save;
  try {
    save = new Save('playtest');
  } catch (err) {
    return fail(`Save threw when constructed with no localStorage: ${err.message}`);
  }

  const backed = save.persistent;
  note(backed ? 'localStorage is available here; exercising the persistent path' : 'no localStorage: exercising the null-store fallback');

  try {
    check(save.get('missing', 'fallback') === 'fallback', 'Save.get did not return the fallback for an unset field');
    check(save.set('found', { a: 1 })?.a === 1, 'Save.set did not return the value it stored');
    check(save.get('found').a === 1, 'Save.get did not read back what Save.set wrote in the same session');
    save.update({ at: { x: 1, y: 2 } });
    check(save.get('at').x === 1, 'Save.update did not merge its fields');
    save.clear();
    check(save.get('found', null) === null, 'Save.clear did not empty the store');
    check(typeof save.persistent === 'boolean', 'Save.persistent is not a boolean');
  } catch (err) {
    fail(`Save threw during an ordinary round trip: ${err.message}`);
  }

  // A fresh cartridge save, the way every scene in the game asks for one.
  try {
    const sys = new StubConsole();
    const a = sys.saveFor('explorer');
    a.set('found', { stanford: { 'hoover-tower': 1 } });
    a.set('at', { stanford: { x: 100, y: 200 } });
    const b = sys.saveFor('explorer');
    const persisted = Object.keys(b.get('found', {})).length > 0;
    check(
      backed === persisted,
      backed
        ? 'a second Save for the same cartridge did not see what the first one wrote'
        : 'a second Save saw data even though there is no backing store',
    );
    note('with no battery the game forgets between sessions and keeps running, which is the intended degradation');
  } catch (err) {
    fail(`saveFor threw: ${err.message}`);
  }

  // The scenes write to the save on every landmark found and every step taken,
  // so the real test is that a live WorldScene can do both with no store under
  // it. Everything above this line has already been running that way.
  const place = places.get(TARGETS[0]?.id);
  if (place) {
    try {
      place.world.markFound(place.map.pois[0].id);
      place.world.remember();
      check(
        Object.keys(place.world.found || {}).length > 0,
        'a landmark read with no backing store was not remembered for the rest of the session',
      );
      note(`the whole run above played ${TARGETS.length} place(s) on a dead battery without throwing`);
    } catch (err) {
      fail(`the world scene threw while saving with no backing store: ${err.message}`);
    }
  }
}

// --- run -------------------------------------------------------------------

const t0 = Date.now();
console.log(`Playing ${TARGETS.map((l) => l.id).join(', ')}...`);

await suiteReachability();
await suiteWalking();
await suiteDistances();
await suiteTravel();
await suiteText();
await suiteSave();

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
console.log(`\n${checks} checks over ${TARGETS.length} place(s) in ${elapsed}s`);
if (skips.length) {
  console.log(`${skips.length} suite(s) skipped:`);
  for (const s of skips) console.log(`  - ${s}`);
}

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('The game is playable end to end.');
