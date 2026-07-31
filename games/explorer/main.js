// WORLD WALKER - walk real places and read about what you find.
//
// Geometry is compiled from the committed OpenStreetMap extracts at load time;
// nothing is fetched from the network at runtime beyond the site's own files.

import { SLOT, px, wrapText } from '../../engine/gfx.js';
import { ICON } from '../../engine/font.js';
import { compileMap, nearestOpen } from '../../engine/geo.js';
import { drawMap, cameraFor, minimap } from '../../engine/tilemap.js';
import { TILE } from '../../engine/tiles.js';
import { MAT } from '../../engine/geo.js';
import { box, Menu, TextBox, drawPanel, fitScale, pips } from '../../engine/ui.js';
import { SFX } from '../../engine/audio.js';
import { LEVELS, LEVEL_BY_ID } from './levels.js';
import { ART, ICON_ART } from './art.js';
import { PLAYER, BIKE, MARKER, MARKER_SEEN, HINT, RACK, BIKE_ICON } from './sprites.js';
import {
  placeHubs,
  hubNear,
  arrivalPixel,
  routesFrom,
  routeSummary,
  destinationName,
  createTravelCutscene,
  HUB_SPRITES,
} from './travel.js';

const ROOT = new URL('../../', import.meta.url);
const GAME_ID = 'explorer';

// --- getting about ---------------------------------------------------------
//
// Walking these places honestly is slow: Greece is 8 x 14 km, and even a campus
// is over a kilometre corner to corner. So there is a bicycle. You find it at a
// rack (Stanford has one outside every door and a roundabout built for bikes),
// and after that it is yours - it survives travelling and reloading.
//
// Speeds are multiples of the level's own walk speed rather than absolutes, so
// a 12 m/tile town and a 6 m/tile campus both end up feeling right.

const RUN_MULT = 2.1;
const BIKE_PAVED = 2.9; // roads, paths, plazas, car parks
const BIKE_ROUGH = 1.45; // grass, woods, sand, steps - slower than a run
const BIKE_ACCEL = 230; // px/s^2, spin-up
const BIKE_COAST = 330; // px/s^2, freewheeling with nothing held
const BIKE_BRAKE = 780; // px/s^2, B held

/**
 * The most any one collision test may advance. Tiles are 8px and the feet box
 * is 8px across, so a smaller step than this cannot skip past a solid tile:
 * consecutive tests always overlap. At 3x walking pace a frame's movement is
 * bigger than that, so movement is split into substeps.
 */
const MAX_STEP = 3;

/** Arm's reach for the A button. A little longer on a bike, which cannot stop dead. */
const REACH_WALK = 22;
const REACH_RIDE = 30;

/** Materials a bicycle is happy on. Everything else costs you two thirds of your speed. */
const PAVED = new Set([MAT.road, MAT.path, MAT.plaza, MAT.parking]);

/**
 * The cartridge's own sounds, built from the same two primitives as the console's
 * stock set in engine/audio.js.
 */
const RIDE_SFX = {
  // A bike bell: two sine pings with a long tail. Unmistakably "on the bike".
  bell: (a) => {
    a.blip('E6', { dur: 0.5, gain: 0.45, type: 'sine' });
    a.blip('B6', { dur: 0.62, gain: 0.32, type: 'sine', delay: 0.05 });
  },
  // Getting off: the freewheel ticking round, then the frame settling.
  rack: (a) => {
    for (let i = 0; i < 5; i++) a.noise({ dur: 0.02, gain: 0.15, cutoff: 3200, delay: i * 0.05 });
    a.blip('A4', { dur: 0.12, slide: 0.55, gain: 0.32 });
  },
  // Tyres: a low roll on tarmac, a louder crunch off it. Footsteps are brighter
  // and shorter, so the two never sound the same.
  tyre: (a, rough) => a.noise({ dur: 0.05, gain: rough ? 0.15 : 0.07, cutoff: rough ? 1900 : 700 }),
  locked: (a) => a.blip('D4', { dur: 0.1, slide: 0.7, gain: 0.28 }),
};

const cache = new Map();
async function loadJSON(path) {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(new URL(path, ROOT)).then((r) => {
        if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
        return r.json();
      }),
    );
  }
  return cache.get(path);
}

/** Compile a level, resolving its landmark art along the way. */
export async function buildLevel(level) {
  const doc = await loadJSON(level.data);
  const map = compileMap({
    id: level.id,
    name: level.name,
    subtitle: level.subtitle,
    bbox: level.bbox || doc.bbox,
    metersPerTile: level.metersPerTile,
    features: doc.features,
    pois: level.pois,
    start: level.start,
    walkSpeed: level.walkSpeed,
    buildingSlot: level.buildingSlot,
    attribution: doc.source,
  });

  // Landmarks sit on the building itself, which you cannot stand on. Put the
  // post on the nearest reachable tile so every one of them can be walked up to.
  for (const poi of map.pois) {
    const open = nearestOpen(map, poi.tx, poi.ty, 60);
    const [ox, oy] = open || [Math.round(poi.tx), Math.round(poi.ty)];
    poi.postX = ox * TILE + TILE / 2;
    poi.postY = oy * TILE + TILE / 2;
  }

  placeHubs(map);
  placeRacks(map, level);

  const spawn = nearestOpen(map, map.start ? map.start.x / TILE : map.w / 2, map.start ? map.start.y / TILE : map.h / 2, 80);
  map.spawn = spawn ? { x: spawn[0] * TILE + TILE / 2, y: spawn[1] * TILE + TILE / 2 } : { x: map.w * 4, y: map.h * 4 };
  return map;
}

/**
 * Attach the level's bike racks to a compiled map as `map.racks`, nudged onto a
 * walkable tile the same way landmark posts and travel hubs are - a rack you
 * cannot stand next to is a rack that does not exist.
 */
export function placeRacks(map, level) {
  map.racks = (level.racks || []).map((rack) => {
    const [tx, ty] = map.proj.toTile(rack.at[0], rack.at[1]);
    const open = nearestOpen(map, tx, ty, 40) || [Math.round(tx), Math.round(ty)];
    return { ...rack, postX: open[0] * TILE + TILE / 2, postY: open[1] * TILE + TILE / 2 };
  });
  return map.racks;
}

/** Photo panel if one exists and photos are switched on, else the drawing. */
async function landmarkArt(poi, colour) {
  if (poi.photo) {
    try {
      const doc = await loadJSON(`data/photos/${poi.photo}.json`);
      const credit = `${doc.credit.artist} / ${doc.credit.license}`;
      // Colour screens get the full palette; the monochrome screens get the
      // four-shade version, which was dithered for exactly that.
      return colour && doc.pal
        ? { w: doc.w, h: doc.h, pal: doc.pal, bits8: doc.bits8, credit }
        : { w: doc.w, h: doc.h, bits: doc.bits, credit };
    } catch (err) {
      console.warn(`landmark art fell back to a drawing: ${err.message}`);
    }
  }
  return ART[poi.art] || ART.placeholder;
}

// --- scenes ----------------------------------------------------------------

class LoadingScene {
  constructor(label, work, then) {
    this.label = label;
    this.work = work;
    this.then = then;
    this.t = 0;
    this.error = null;
  }

  enter() {
    // The result is stashed rather than acted on: this scene is usually pushed
    // by a transition that is still running, and a second transition started
    // while the first is mid-fade would be dropped on the floor.
    this.work()
      .then((result) => {
        this.result = result;
      })
      .catch((err) => {
        console.error(err);
        this.error = String(err.message || err);
      });
  }

  update(dt, sys) {
    this.t += dt;
    if (this.result && !this.handedOver && !sys.transition) {
      this.handedOver = true;
      sys.transitionTo((s) => this.then(s, this.result), { duration: 0.24 });
    }
  }

  draw(screen) {
    screen.clear(px(SLOT.UI, 0));
    screen.textCentred(this.label, 60, { slot: SLOT.UI, shade: 3 });
    if (this.error) {
      for (const [i, line] of wrapText(this.error, 148).slice(0, 3).entries()) {
        screen.text(line, 6, 78 + i * 9, { slot: SLOT.UI, shade: 2 });
      }
    } else {
      const dots = '.'.repeat(1 + (Math.floor(this.t * 3) % 3));
      screen.textCentred(dots, 74, { slot: SLOT.UI, shade: 2 });
    }
  }
}

class TitleScene {
  constructor() {
    this.t = 0;
  }

  enter(sys) {
    this.save = sys.saveFor(GAME_ID);
    this.t = 0;
  }

  update(dt, sys) {
    this.t += dt;
    if (sys.input.pressed('a') || sys.input.pressed('start')) {
      SFX.confirm(sys.audio);
      sys.transitionTo((s) => s.replace(new SelectScene()));
    }
  }

  draw(screen) {
    const h = screen.h;
    screen.clear(px(SLOT.UI, 0));

    const titleY = Math.round(h * 0.14);
    screen.fill(0, titleY - 10, screen.w, 2, px(SLOT.UI, 3));
    screen.textCentred('WORLD', titleY, { slot: SLOT.UI, shade: 3, scale: 2 });
    screen.textCentred('WALKER', titleY + 20, { slot: SLOT.UI, shade: 3, scale: 2 });
    screen.fill(0, titleY + 40, screen.w, 2, px(SLOT.UI, 3));

    const found = Object.values(this.save?.get('found', {}) || {}).reduce((n, set) => n + Object.keys(set).length, 0);
    const total = LEVELS.reduce((n, l) => n + l.pois.length, 0);
    screen.textCentred(`${ICON.STAR} ${found} / ${total} LANDMARKS`, Math.round(h * 0.52), { slot: SLOT.UI, shade: 2 });
    screen.textCentred('WALK REAL PLACES', Math.round(h * 0.63), { slot: SLOT.UI, shade: 2 });

    if (Math.floor(this.t * 2) % 2) {
      screen.textCentred('PRESS START', Math.round(h * 0.79), { slot: SLOT.UI, shade: 3 });
    }
    screen.textCentred('MAP DATA (C) OPENSTREETMAP', h - 10, { slot: SLOT.UI, shade: 1 });
  }
}

class SelectScene {
  constructor() {
    this.menu = new Menu(LEVELS, { visible: 3 });
    this.t = 0;
  }

  enter(sys) {
    this.save = sys.saveFor(GAME_ID);
    this.t = 0;
  }

  foundIn(level) {
    return Object.keys(this.save.get('found', {})[level.id] || {}).length;
  }

  update(dt, sys) {
    this.t += dt;
    if (sys.input.repeated('down')) {
      this.menu.move(1);
      SFX.cursor(sys.audio);
    }
    if (sys.input.repeated('up')) {
      this.menu.move(-1);
      SFX.cursor(sys.audio);
    }
    if (sys.input.pressed('b')) {
      SFX.cancel(sys.audio);
      sys.transitionTo((s) => s.replace(new TitleScene()));
      return;
    }
    if (sys.input.pressed('a') || sys.input.pressed('start')) {
      const level = this.menu.current;
      SFX.confirm(sys.audio);
      sys.transitionTo((s) =>
        s.replace(
          new LoadingScene(
            level.name,
            () => buildLevel(level),
            (s2, map) => s2.replace(new WorldScene(level, map)),
          ),
        ),
      );
    }
  }

  draw(screen) {
    screen.clear(px(SLOT.UI, 0));
    screen.fill(0, 0, screen.w, 13, px(SLOT.UI, 3));
    screen.text('CHOOSE A PLACE', 5, 3, { slot: SLOT.UI, shade: 0 });

    const level = this.menu.current;
    const infoY = 18;
    const infoH = 46;
    box(screen, 4, infoY, screen.w - 8, infoH);
    screen.text(level.name, 10, infoY + 6, { slot: SLOT.UI, shade: 3 });
    screen.text(level.subtitle, 10, infoY + 18, { slot: SLOT.UI, shade: 2 });
    const found = this.foundIn(level);
    screen.text(`${ICON.PIN} ${found}/${level.pois.length} FOUND`, 10, infoY + 32, { slot: SLOT.UI, shade: 3 });

    const listY = infoY + infoH + 6;
    box(screen, 4, listY, screen.w - 8, screen.h - listY - 4);
    this.menu.draw(screen, 16, listY + 8, (l) => `${l.name}`, { cursorTime: this.t, lineHeight: 12 });
  }
}

export class WorldScene {
  constructor(level, map, arriveAt = null) {
    this.level = level;
    this.map = map;
    this.arriveAt = arriveAt;
    this.t = 0;
    this.dir = 'down';
    this.animT = 0;
    this.stepT = 0;
    this.bannerT = 2.4;
    this.near = null;
    this.hub = null;
    this.rack = null;
    // Bike state. All of it lives on the scene, so a headless harness can drive
    // WorldScene directly without a DOM, a timer or a frame loop.
    this.hasBike = false;
    this.riding = false;
    this.speed = 0; // px/s along (hx, hy)
    this.hx = 0;
    this.hy = 1;
    this.rough = false;
    this.tip = '';
    this.tipT = 0;
  }

  enter(sys) {
    this.save = sys.saveFor(GAME_ID);
    const all = this.save.get('found', {});
    this.found = all[this.level.id] || {};
    // Arriving by plane or motorway beats both the saved position and the
    // level's own start point.
    const at = this.arriveAt || this.save.get('at', {})[this.level.id];
    this.x = at ? at.x : this.map.spawn.x;
    this.y = at ? at.y : this.map.spawn.y;
    // The bike is yours once you have found one, wherever you are: it comes on
    // the plane with you, and it is still there after a reload.
    this.hasBike = Boolean(this.save.get('bike', false));
    this.riding = this.hasBike && Boolean(this.save.get('riding', false));
    this.speed = 0;
    this.viewH = sys.screen.h - 16;
  }

  resized(w, h) {
    this.viewH = h - 16;
    void w;
  }

  exit() {
    this.remember();
  }

  remember() {
    const at = this.save.get('at', {});
    at[this.level.id] = { x: Math.round(this.x), y: Math.round(this.y) };
    this.save.set('at', at);
    this.save.set('bike', this.hasBike);
    this.save.set('riding', this.riding);
  }

  /** A line of guidance across the HUD for a couple of seconds. */
  say(text) {
    this.tip = text;
    this.tipT = 2.2;
  }

  markFound(id) {
    const all = this.save.get('found', {});
    all[this.level.id] = { ...(all[this.level.id] || {}), [id]: 1 };
    this.save.set('found', all);
    this.found = all[this.level.id];
  }

  /**
   * Feet-box collision: the player's shoes, not the whole sprite. Four corners
   * is exact here rather than approximate - the box is 8px wide and 6px tall
   * against 8px tiles, so it can only ever touch a 2x2 block of tiles and the
   * corners sample every one of them.
   */
  blocked(x, y) {
    const half = 4;
    const top = y - 3;
    const bottom = y + 3;
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
   * Move by a pixel delta. Each axis is resolved separately, so a diagonal into
   * a wall still slides along it, and the whole move is split into substeps of
   * at most MAX_STEP px so that going three times walking pace cannot put the
   * player out the far side of a solid tile in one frame.
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

  mount(sys, quiet = false) {
    this.riding = true;
    this.speed = 0;
    this.animT = 0;
    this.stepT = 0;
    if (!quiet) RIDE_SFX.bell(sys.audio);
    this.remember();
  }

  dismount(sys) {
    this.riding = false;
    this.speed = 0;
    this.animT = 0;
    RIDE_SFX.rack(sys.audio);
    this.remember();
  }

  /** On foot. Unchanged from before the bike existed: B still means run. */
  walk(dt, dx, dy, sys) {
    const running = sys.input.isDown('b');
    this.running = running;
    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      const speed = this.map.walkSpeed * (running ? RUN_MULT : 1) * dt;
      this.step((dx / len) * speed, (dy / len) * speed);
      this.dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up';
      this.animT += dt * (running ? 1.7 : 1);
      this.stepT += dt;
      if (this.stepT > (running ? 0.18 : 0.3)) {
        this.stepT = 0;
        SFX.step(sys.audio);
      }
    } else {
      this.animT = 0;
      this.stepT = 0.28;
    }
  }

  /**
   * On the bike. A short spin-up and a coast-down rather than an instant top
   * speed, which is the whole difference between a bicycle and a fast walk; B
   * is the brake, and it stops you in about a fifth of a second so that landing
   * on a landmark post is still easy.
   */
  ride(dt, dx, dy, sys) {
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
    if (sys.input.isDown('b')) this.speed = Math.max(0, this.speed - BIKE_BRAKE * dt);
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
      if (this.speed > this.map.walkSpeed) SFX.bump(sys.audio);
      this.speed = 0;
    }

    // Pedalling and tyre noise both follow the actual speed, so freewheeling to
    // a halt looks and sounds like freewheeling to a halt.
    this.animT += dt * (0.5 + this.speed / (this.map.walkSpeed * 1.2));
    this.stepT += dt;
    const interval = Math.max(0.09, 0.34 - this.speed / 900);
    if (this.speed > 8 && this.stepT > interval) {
      this.stepT = 0;
      RIDE_SFX.tyre(sys.audio, this.rough);
    }
  }

  update(dt, sys) {
    this.t += dt;
    this.bannerT = Math.max(0, this.bannerT - dt);
    this.tipT = Math.max(0, this.tipT - dt);

    if (sys.input.pressed('start')) {
      SFX.page(sys.audio);
      sys.push(new PauseScene(this));
      return;
    }

    // SELECT does nothing else in this scene, so it is the bike.
    if (sys.input.pressed('select')) {
      if (!this.hasBike) {
        RIDE_SFX.locked(sys.audio);
        this.say('FIND A BIKE RACK');
      } else if (this.riding) {
        this.dismount(sys);
      } else {
        this.mount(sys);
      }
    }

    const [dx, dy] = sys.input.axis();
    if (this.riding) this.ride(dt, dx, dy, sys);
    else this.walk(dt, dx, dy, sys);

    this.x = Math.max(4, Math.min(this.map.w * TILE - 4, this.x));
    this.y = Math.max(8, Math.min(this.map.h * TILE - 4, this.y));

    // Closest landmark within arm's reach - a little longer on the bike, since
    // a bike cannot be parked on a sixpence.
    const reach = this.riding ? REACH_RIDE : REACH_WALK;
    this.near = null;
    let best = reach;
    for (const poi of this.map.pois) {
      const d = Math.hypot(poi.postX - this.x, poi.postY - this.y);
      if (d < best) {
        best = d;
        this.near = poi;
      }
    }

    this.hub = this.near ? null : hubNear(this.map, this.x, this.y, reach);
    this.rack = this.near || this.hub ? null : this.rackNear(reach);

    if (sys.input.pressed('a')) this.interact(sys);
  }

  /** Nearest bike rack within `radius` pixels, or null. */
  rackNear(radius) {
    let best = radius;
    let found = null;
    for (const rack of this.map.racks || []) {
      const d = Math.hypot(rack.postX - this.x, rack.postY - this.y);
      if (d < best) {
        best = d;
        found = rack;
      }
    }
    return found;
  }

  /** A, at whatever is under your nose. Whatever it is, you stop for it. */
  interact(sys) {
    if (this.near) {
      // You may read a plaque without getting off the bike, but not at speed.
      this.speed = 0;
      const first = !this.found[this.near.id];
      if (first) {
        this.markFound(this.near.id);
        this.remember();
      }
      sys.push(new LandmarkScene(this.near, first));
      return;
    }
    if (this.hub) {
      SFX.confirm(sys.audio);
      // Nobody boards a coach or a flight still sitting on the bike: it comes
      // off here and travels in the hold, and you have it again at the far end.
      if (this.riding) this.dismount(sys);
      this.remember();
      sys.push(new DepartureScene(this, this.hub));
      return;
    }
    if (this.rack) {
      if (!this.hasBike) {
        this.hasBike = true;
        SFX.found(sys.audio);
        this.say('GOT A BIKE - SELECT');
        this.mount(sys, true);
      } else if (this.riding) {
        this.dismount(sys);
      } else {
        this.mount(sys);
      }
    }
  }

  draw(screen, sys) {
    const viewH = screen.h - 16;
    const [camX, camY] = cameraFor(this.map, this.x, this.y, screen.w, viewH);
    drawMap(screen, this.map, camX, camY, { viewH });
    screen.clip(0, 0, screen.w, viewH);

    // bike racks: street furniture, so under the landmark posts
    for (const rack of this.map.racks || []) {
      const sx = Math.round(rack.postX - camX - RACK.w / 2);
      const sy = Math.round(rack.postY - camY - RACK.h + 3);
      if (sx < -RACK.w || sy < -RACK.h || sx > screen.w || sy > viewH) continue;
      screen.blit(RACK.px, RACK.w, RACK.h, sx, sy, { slot: SLOT.ACCENT });
    }

    // landmark posts
    for (const poi of this.map.pois) {
      const sx = Math.round(poi.postX - camX) - 4;
      const sy = Math.round(poi.postY - camY) - 12;
      if (sx < -12 || sy < -14 || sx > screen.w || sy > viewH) continue;
      const spr = this.found[poi.id] ? MARKER_SEEN : MARKER;
      screen.blit(spr.px, spr.w, spr.h, sx, sy, { slot: SLOT.ACCENT });
    }

    // travel hubs
    for (const hub of this.map.hubs || []) {
      const spr = HUB_SPRITES[hub.kind] || HUB_SPRITES.highway;
      const sx = Math.round(hub.postX - camX - spr.w / 2);
      const sy = Math.round(hub.postY - camY - spr.h);
      if (sx < -spr.w || sy < -spr.h || sx > screen.w || sy > viewH) continue;
      screen.blit(spr.px, spr.w, spr.h, sx, sy, { slot: SLOT.ACCENT });
    }

    // the player, walking or riding. Both sprite sets are 16 tall and share the
    // same anchor, so getting on the bike does not make the rider hop.
    const frames = (this.riding ? BIKE : PLAYER)[this.dir];
    const rate = this.riding ? 10 : 8;
    const frame = this.animT > 0 ? frames[Math.floor(this.animT * rate) % frames.length] : frames[0];
    screen.blit(frame.px, frame.w, frame.h, Math.round(this.x - camX - frame.w / 2), Math.round(this.y - camY - frame.h + 4), {
      slot: SLOT.CHAR,
      flipX: this.dir === 'left',
    });

    // "there is something here" bubble
    const prompt = this.near || this.hub || this.rack;
    if (prompt) {
      const bob = Math.sin(this.t * 7) * 1.5;
      screen.blit(
        HINT.px,
        HINT.w,
        HINT.h,
        Math.round(prompt.postX - camX) - 3,
        Math.round(prompt.postY - camY - 26 + bob),
        { slot: SLOT.ACCENT },
      );
    }
    screen.noClip();

    // HUD. Everything is laid out from the right-hand edge inward and the name
    // takes whatever is left, so it works at any of the console's resolutions.
    screen.fill(0, viewH, screen.w, 16, px(SLOT.UI, 0));
    screen.hline(0, viewH, screen.w, px(SLOT.UI, 3));
    const textY = viewH + 5;
    let right = screen.w - 4;

    const tally = `${Object.keys(this.found).length}/${this.map.pois.length}`;
    right -= screen.textWidth(tally);
    screen.text(tally, right, textY, { slot: SLOT.UI, shade: 3 });

    if (this.riding) {
      // Speed meter: three pips filling as the bike winds up. Rolling onto
      // grass drops it back to one, which is the surface rule made visible.
      const top = this.map.walkSpeed * BIKE_PAVED;
      const lit = Math.min(3, Math.floor((this.speed / top) * 3 + 0.34));
      right -= 15;
      pips(screen, right, viewH + 6, 3, lit, { slot: SLOT.ACCENT, gap: 4 });
      right -= BIKE_ICON.w + 3;
      screen.blit(BIKE_ICON.px, BIKE_ICON.w, BIKE_ICON.h, right, viewH + 4, {
        slot: SLOT.ACCENT,
        tint: px(SLOT.ACCENT, this.rough ? 2 : 3),
      });
    } else if (this.running) {
      right -= screen.textWidth('RUN') + 4;
      screen.text('RUN', right, textY, { slot: SLOT.ACCENT, shade: 3 });
    }

    if (prompt && Math.floor(this.t * 2) % 2) {
      right -= 10;
      screen.text(ICON.A, right, textY, { slot: SLOT.UI, shade: 3 });
    }

    const label = this.tipT > 0 ? this.tip : prompt?.name || this.map.name;
    const maxChars = Math.max(4, Math.floor((right - 8) / 6));
    screen.text(label.slice(0, maxChars), 4, textY, { slot: SLOT.UI, shade: 3 });

    // arrival banner
    if (this.bannerT > 0) {
      const a = Math.min(1, this.bannerT / 0.4);
      const h = Math.round(26 * a);
      if (h > 4) {
        box(screen, 8, 20, screen.w - 16, h);
        if (h > 20) {
          screen.textCentred(this.map.name, 26, { slot: SLOT.UI, shade: 3 });
          screen.textCentred(this.map.subtitle || '', 35, { slot: SLOT.UI, shade: 2 });
        }
      }
    }
    void sys;
  }
}

/**
 * Pick a destination at a travel hub, then hand over to the cutscene. The
 * destination map is compiled while the cutscene plays, so the journey covers
 * the load rather than a spinner doing it.
 */
class DepartureScene {
  constructor(world, hub) {
    this.world = world;
    this.hub = hub;
    this.t = 0;
    // Each hub carries its own routes; a level can have more than one hub.
    this.routes = hub.routes?.length ? hub.routes : routesFrom(world.level.id);
    this.menu = new Menu(this.routes, { visible: 4 });
  }

  update(dt, sys) {
    this.t += dt;
    if (sys.input.pressed('b')) {
      SFX.cancel(sys.audio);
      sys.pop();
      return;
    }
    if (sys.input.repeated('down')) {
      this.menu.move(1);
      SFX.cursor(sys.audio);
    }
    if (sys.input.repeated('up')) {
      this.menu.move(-1);
      SFX.cursor(sys.audio);
    }
    if (sys.input.pressed('a') || sys.input.pressed('start')) {
      const route = this.menu.current;
      if (!route) return;
      SFX.confirm(sys.audio);
      const level = LEVEL_BY_ID[route.to];
      const pending = buildLevel(level).catch((err) => {
        console.error(err);
        return null;
      });
      sys.pop();
      sys.push(
        createTravelCutscene(route, sys, async (s) => {
          const map = await pending;
          if (!map) {
            s.pop();
            return;
          }
          s.transitionTo((s2) => s2.replace(new WorldScene(level, map, arrivalPixel(map, route))), { duration: 0.3 });
        }),
      );
    }
  }

  draw(screen) {
    screen.clear(px(SLOT.UI, 0));
    screen.fill(0, 0, screen.w, 11, px(SLOT.UI, 3));
    screen.text(this.hub.name.slice(0, Math.floor(screen.w / 6) - 1), 4, 2, { slot: SLOT.UI, shade: 0 });

    let y = 16;
    for (const line of wrapText(this.hub.blurb || '', screen.w - 12).slice(0, 4)) {
      screen.text(line, 6, y, { slot: SLOT.UI, shade: 2 });
      y += 9;
    }

    const listY = y + 10;
    const listH = Math.min(screen.h - listY - 6, this.routes.length * 18 + 12);
    box(screen, 2, listY - 5, screen.w - 4, listH);
    this.menu.draw(screen, 14, listY, (r) => destinationName(r), { cursorTime: this.t, lineHeight: 18 });
    // The journey line sits under each destination, dimmer.
    const end = Math.min(this.menu.items.length, this.menu.top + this.menu.visible);
    for (let i = this.menu.top; i < end; i++) {
      screen.text(routeSummary(this.menu.items[i]), 14, listY + (i - this.menu.top) * 18 + 9, { slot: SLOT.UI, shade: 1 });
    }
    // The bike is not left behind: it goes in the hold and comes out at the
    // other end, which is the only reason boarding is allowed to dismount you.
    const footer = this.world.hasBike ? 'B: STAY  BIKE IN HOLD' : 'B: STAY HERE';
    screen.text(footer.slice(0, Math.max(6, Math.floor((screen.w - 8) / 6))), 4, screen.h - 9, { slot: SLOT.UI, shade: 2 });
  }
}

class LandmarkScene {
  constructor(poi, isNew) {
    this.poi = poi;
    this.isNew = isNew;
    this.t = 0;
    this.art = null;
    this.credit = '';
    this.text = null;
  }

  /** Three lines of caption on a tall screen, two when there is no room. */
  static lineCount(h) {
    return h < 170 ? 2 : 3;
  }

  resized(w, h) {
    const page = this.text?.page ?? 0;
    this.text = new TextBox(this.poi.text, { width: w - 12, lines: LandmarkScene.lineCount(h), speed: 52 });
    this.text.page = Math.min(page, this.text.pages.length - 1);
  }

  enter(sys) {
    this.text = new TextBox(this.poi.text, {
      width: sys.screen.w - 12,
      lines: LandmarkScene.lineCount(sys.screen.h),
      speed: 52,
    });
    if (this.isNew) SFX.found(sys.audio);
    landmarkArt(this.poi, Boolean(sys.look.colour)).then((art) => {
      this.art = art;
      this.credit = art.credit || '';
      if (art.pal) sys.setImagePalette(art.pal);
    });
  }

  exit(sys) {
    sys.setImagePalette(null);
  }

  update(dt, sys) {
    this.t += dt;
    this.text.update(dt);
    if (sys.input.pressed('a') || sys.input.pressed('start')) {
      if (this.text.next()) {
        SFX.cancel(sys.audio);
        sys.pop();
      } else {
        SFX.page(sys.audio);
      }
    }
    if (sys.input.pressed('b')) {
      SFX.cancel(sys.audio);
      sys.pop();
    }
  }

  draw(screen) {
    screen.clear(px(SLOT.UI, 0));
    const headerH = 11;
    screen.fill(0, 0, screen.w, headerH, px(SLOT.UI, 3));
    screen.text(this.poi.name.slice(0, Math.floor(screen.w / 6) - 1), 4, 2, { slot: SLOT.UI, shade: 0 });

    // The picture is centred in what is actually visible - between the header
    // and the text box - rather than in the whole screen, which would push it
    // behind the caption and leave a band of empty paper above it.
    const boxH = LandmarkScene.lineCount(screen.h) * 9 + 13;
    const boxY = screen.h - boxH;
    const artTop = headerH;
    const artBox = { w: screen.w, h: boxY - artTop };

    if (this.art) {
      const scale = fitScale(this.art, artBox.w, artBox.h);
      const aw = this.art.w * scale;
      const ah = this.art.h * scale;
      const ax = Math.round((screen.w - aw) / 2);
      const ay = artTop + Math.round((artBox.h - ah) / 2);
      // Clipped, so an oversized panel on a small screen crops rather than
      // spilling over the header.
      screen.clip(0, artTop, screen.w, artBox.h);
      drawPanel(screen, this.art, ax, ay, { slot: SLOT.UI, scale, border: false });
      screen.noClip();
      if (this.credit) {
        // Tucked under the picture, or over its foot when the picture is
        // taller than the space and had to be cropped.
        const cy = Math.min(boxY - 9, ay + ah + 1);
        screen.fill(0, cy - 1, screen.w, 9, px(SLOT.UI, 0));
        screen.text(this.credit.slice(0, Math.floor(screen.w / 6) - 1), 3, cy, { slot: SLOT.UI, shade: 2 });
      }
    } else {
      screen.textCentred('...', artTop + Math.round(artBox.h / 3), { slot: SLOT.UI, shade: 2 });
    }

    box(screen, 0, boxY, screen.w, boxH);
    this.text.draw(screen, 6, boxY + 6);
    this.text.drawMore(screen, screen.w - 12, boxY + boxH - 11, this.t);
  }
}

class PauseScene {
  constructor(world) {
    this.world = world;
    this.transparent = false;
    this.t = 0;
    this.tab = 0;
  }

  resized(w, h, sys) {
    this.enter(sys);
  }

  enter(sys) {
    this.map = this.world.map;
    this.mini = minimap(this.map, sys.screen.w - 16, sys.screen.h - 46, (matId) => {
      if (matId === MAT.water || matId === MAT.waterDeep || matId === MAT.marsh) return px(SLOT.WATER, 2);
      if (matId === MAT.building || matId === MAT.buildingTall) return px(SLOT.ROOF, 3);
      if (matId === MAT.road || matId === MAT.parking || matId === MAT.rail) return px(SLOT.ROAD, 2);
      if (matId === MAT.forest) return px(SLOT.TREE, 2);
      if (matId === MAT.sand) return px(SLOT.SAND, 1);
      if (matId === MAT.path || matId === MAT.plaza) return px(SLOT.ROAD, 0);
      return px(SLOT.LAND, 1);
    });
    this.list = new Menu(this.map.pois, { visible: 6 });
  }

  update(dt, sys) {
    this.t += dt;
    if (sys.input.pressed('start') || sys.input.pressed('b')) {
      SFX.cancel(sys.audio);
      sys.pop();
      return;
    }
    if (sys.input.pressed('select')) {
      this.tab = (this.tab + 1) % 2;
      SFX.page(sys.audio);
    }
    if (this.tab === 1) {
      if (sys.input.repeated('down')) this.list.move(1);
      if (sys.input.repeated('up')) this.list.move(-1);
    }
    if (sys.input.pressed('a') && this.tab === 1) {
      SFX.confirm(sys.audio);
      sys.transitionTo((s) => s.replace(new SelectScene()));
    }
  }

  draw(screen) {
    screen.clear(px(SLOT.UI, 0));
    screen.fill(0, 0, screen.w, 11, px(SLOT.UI, 3));
    screen.text(this.tab === 0 ? 'MAP' : 'LANDMARKS', 4, 2, { slot: SLOT.UI, shade: 0 });
    screen.text('SEL', screen.w - 22, 2, { slot: SLOT.UI, shade: 0 });

    if (this.tab === 0) {
      const mx = Math.round((screen.w - this.mini.w) / 2);
      const my = 16;
      screen.frame(mx - 1, my - 1, this.mini.w + 2, this.mini.h + 2, px(SLOT.UI, 3));
      screen.blit(this.mini.px, this.mini.w, this.mini.h, mx, my, { slot: SLOT.UI });

      const sx = this.mini.w / (this.map.w * TILE);
      const sy = this.mini.h / (this.map.h * TILE);
      for (const poi of this.map.pois) {
        const dotX = mx + Math.round(poi.postX * sx);
        const dotY = my + Math.round(poi.postY * sy);
        const seen = this.world.found[poi.id];
        screen.fill(dotX - 1, dotY - 1, 3, 3, px(SLOT.ACCENT, seen ? 2 : 3));
      }
      // Bike racks as little crosses. Without these the racks would be a
      // guessing game on a map 14 km tall, and a feature you cannot find is
      // not a feature.
      for (const rack of this.map.racks || []) {
        const dotX = mx + Math.round(rack.postX * sx);
        const dotY = my + Math.round(rack.postY * sy);
        screen.fill(dotX, dotY - 1, 1, 3, px(SLOT.GOLD, 1));
        screen.fill(dotX - 1, dotY, 3, 1, px(SLOT.GOLD, 1));
      }
      if (Math.floor(this.t * 4) % 2) {
        screen.fill(mx + Math.round(this.world.x * sx) - 1, my + Math.round(this.world.y * sy) - 1, 3, 3, px(SLOT.CHAR, 1));
      }
      screen.text('B: BACK', 4, screen.h - 9, { slot: SLOT.UI, shade: 2 });
      if (this.map.racks?.length) {
        const legend = 'RACKS';
        const lx = screen.w - 4 - screen.textWidth(legend);
        if (lx > 70) {
          screen.fill(lx - 7, screen.h - 8, 1, 3, px(SLOT.GOLD, 1));
          screen.fill(lx - 8, screen.h - 7, 3, 1, px(SLOT.GOLD, 1));
          screen.text(legend, lx, screen.h - 9, { slot: SLOT.UI, shade: 2 });
        }
      }
    } else {
      this.list.draw(screen, 14, 18, (p) => `${this.world.found[p.id] ? ICON.STAR : '-'} ${p.name.slice(0, 17)}`, {
        cursorTime: this.t,
        lineHeight: 11,
      });
      screen.text(`${ICON.A} LEAVE THIS PLACE`, 4, screen.h - 9, { slot: SLOT.UI, shade: 2 });
    }
  }
}

export default {
  id: GAME_ID,
  title: 'WORLD WALKER',
  subtitle: 'EXPLORE REAL PLACES',
  icon: ICON_ART,
  create() {
    return new TitleScene();
  },
};
