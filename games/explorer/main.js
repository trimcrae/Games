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
import { box, Menu, TextBox, drawPanel, fitScale } from '../../engine/ui.js';
import { SFX } from '../../engine/audio.js';
import { LEVELS, LEVEL_BY_ID } from './levels.js';
import { ART, ICON_ART } from './art.js';
import { PLAYER, MARKER, MARKER_SEEN, HINT } from './sprites.js';
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
async function buildLevel(level) {
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

  const spawn = nearestOpen(map, map.start ? map.start.x / TILE : map.w / 2, map.start ? map.start.y / TILE : map.h / 2, 80);
  map.spawn = spawn ? { x: spawn[0] * TILE + TILE / 2, y: spawn[1] * TILE + TILE / 2 } : { x: map.w * 4, y: map.h * 4 };
  return map;
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

class WorldScene {
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
    this.viewH = sys.screen.h - 16;
  }

  exit() {
    this.remember();
  }

  remember() {
    const at = this.save.get('at', {});
    at[this.level.id] = { x: Math.round(this.x), y: Math.round(this.y) };
    this.save.set('at', at);
  }

  markFound(id) {
    const all = this.save.get('found', {});
    all[this.level.id] = { ...(all[this.level.id] || {}), [id]: 1 };
    this.save.set('found', all);
    this.found = all[this.level.id];
  }

  /** Feet-box collision: the player's shoes, not the whole sprite. */
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

  update(dt, sys) {
    this.t += dt;
    this.bannerT = Math.max(0, this.bannerT - dt);

    if (sys.input.pressed('start')) {
      SFX.page(sys.audio);
      sys.push(new PauseScene(this));
      return;
    }

    let [dx, dy] = sys.input.axis();
    // Greece is a whole town rather than a campus; holding B to run keeps the
    // long stretches between landmarks from becoming a chore.
    const running = sys.input.isDown('b');
    this.running = running;
    if (dx || dy) {
      const len = Math.hypot(dx, dy) || 1;
      const speed = this.map.walkSpeed * (running ? 2.1 : 1) * dt;
      const nx = (dx / len) * speed;
      const ny = (dy / len) * speed;

      // Axes are resolved separately so a diagonal into a wall still slides.
      if (!this.blocked(this.x + nx, this.y)) this.x += nx;
      if (!this.blocked(this.x, this.y + ny)) this.y += ny;

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

    this.x = Math.max(4, Math.min(this.map.w * TILE - 4, this.x));
    this.y = Math.max(8, Math.min(this.map.h * TILE - 4, this.y));

    // Closest landmark within arm's reach.
    this.near = null;
    let best = 22;
    for (const poi of this.map.pois) {
      const d = Math.hypot(poi.postX - this.x, poi.postY - this.y);
      if (d < best) {
        best = d;
        this.near = poi;
      }
    }

    this.hub = this.near ? null : hubNear(this.map, this.x, this.y);

    if (this.hub && sys.input.pressed('a')) {
      SFX.confirm(sys.audio);
      this.remember();
      sys.push(new DepartureScene(this, this.hub));
      return;
    }

    if (this.near && sys.input.pressed('a')) {
      const first = !this.found[this.near.id];
      if (first) {
        this.markFound(this.near.id);
        this.remember();
      }
      sys.push(new LandmarkScene(this.near, first));
    }
  }

  draw(screen, sys) {
    const viewH = screen.h - 16;
    const [camX, camY] = cameraFor(this.map, this.x, this.y, screen.w, viewH);
    drawMap(screen, this.map, camX, camY, { viewH });
    screen.clip(0, 0, screen.w, viewH);

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

    // walker
    const frames = PLAYER[this.dir];
    const frame = this.animT > 0 ? frames[Math.floor(this.animT * 8) % frames.length] : frames[0];
    screen.blit(frame.px, frame.w, frame.h, Math.round(this.x - camX - frame.w / 2), Math.round(this.y - camY - frame.h + 4), {
      slot: SLOT.CHAR,
      flipX: this.dir === 'left',
    });

    // "there is something here" bubble
    const prompt = this.near || this.hub;
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

    // HUD
    screen.fill(0, viewH, screen.w, 16, px(SLOT.UI, 0));
    screen.hline(0, viewH, screen.w, px(SLOT.UI, 3));
    const label = this.near?.name || this.hub?.name || this.map.name;
    const maxChars = Math.max(6, Math.floor((screen.w - 60) / 6));
    screen.text(label.slice(0, maxChars), 4, viewH + 5, { slot: SLOT.UI, shade: 3 });
    const tally = `${Object.keys(this.found).length}/${this.map.pois.length}`;
    screen.text(tally, screen.w - 4 - screen.textWidth(tally), viewH + 5, { slot: SLOT.UI, shade: 3 });

    // Status sits to the left of the tally so the two never collide.
    const statusX = screen.w - 8 - screen.textWidth(tally) - 20;
    if ((this.near || this.hub) && Math.floor(this.t * 2) % 2) {
      screen.text(ICON.A, statusX + 14, viewH + 5, { slot: SLOT.UI, shade: 3 });
    } else if (this.running) {
      screen.text('RUN', statusX, viewH + 5, { slot: SLOT.ACCENT, shade: 3 });
    }

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
    for (const line of wrapText(this.hub.blurb || '', screen.w - 12).slice(0, 2)) {
      screen.text(line, 6, y, { slot: SLOT.UI, shade: 2 });
      y += 9;
    }

    const listY = y + 8;
    box(screen, 2, listY - 5, screen.w - 4, screen.h - listY - 8);
    this.menu.draw(screen, 14, listY, (r) => destinationName(r), { cursorTime: this.t, lineHeight: 18 });
    // The journey line sits under each destination, dimmer.
    const end = Math.min(this.menu.items.length, this.menu.top + this.menu.visible);
    for (let i = this.menu.top; i < end; i++) {
      screen.text(routeSummary(this.menu.items[i]), 14, listY + (i - this.menu.top) * 18 + 9, { slot: SLOT.UI, shade: 1 });
    }
    screen.text('B: STAY HERE', 4, screen.h - 9, { slot: SLOT.UI, shade: 2 });
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

    // The picture gets the whole screen below the header and the text box sits
    // on top of it. Stacking them instead would mean either a postage stamp on
    // a small screen or two lines of caption on a large one.
    const boxH = LandmarkScene.lineCount(screen.h) * 9 + 13;
    const boxY = screen.h - boxH;
    const artTop = headerH;
    const artBox = { w: screen.w, h: screen.h - artTop };

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
        const cy = boxY - 9;
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
      if (Math.floor(this.t * 4) % 2) {
        screen.fill(mx + Math.round(this.world.x * sx) - 1, my + Math.round(this.world.y * sy) - 1, 3, 3, px(SLOT.CHAR, 1));
      }
      screen.text('B: BACK', 4, screen.h - 9, { slot: SLOT.UI, shade: 2 });
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
