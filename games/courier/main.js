// CAMPUS COURIER - the same three places as WORLD WALKER, ridden against a clock.
//
// Explorer is unhurried: you wander, you find a plaque, you read it. This is
// the opposite game on the same geography. A parcel is waiting at a named
// building, somebody else wants it at another named building, and the clock is
// already running. Miss a deadline and the shift is over.
//
// Everything is built from the committed OpenStreetMap extracts at load time;
// nothing is fetched at runtime beyond the site's own files.

import { SLOT, px, wrapText } from '../../engine/gfx.js';
import { ICON } from '../../engine/font.js';
import { MAT } from '../../engine/geo.js';
import { drawMap, cameraFor, minimap } from '../../engine/tilemap.js';
import { TILE } from '../../engine/tiles.js';
import { box, Menu, pips } from '../../engine/ui.js';
import { SFX } from '../../engine/audio.js';
import { LEVELS } from '../explorer/levels.js';
import { buildRound, metresOf } from './world.js';
import { Dispatcher, rankFor, isPromotion, RANKS } from './jobs.js';
import { Rider, bikeTopSpeed } from './movement.js';
import { BIKE } from '../explorer/sprites.js';
import { PICKUP, DROP, PARCEL_PIP, CHEVRON, ARROWS, headingIndex, ICON_ART } from './sprites.js';

const GAME_ID = 'courier';

/** How close counts as arriving. Two tiles, so you can ride through a pickup. */
const REACH = 16;

/** Height of the bottom HUD: two rows of 5x7 text with a rule above them. */
const HUD_H = 20;

/** Seconds of grace on top of the first job's allowance, to get going. */
const START_GRACE = 4;

/** Below this the clock ticks audibly and the numbers blink. */
const PANIC = 10;

/**
 * The cartridge's own sounds, built from the same two primitives as the
 * console's stock set in engine/audio.js.
 */
const JOB_SFX = {
  // Dispatch calling: two clipped tones, like a radio.
  issued: (a) => a.jingle([['C5', 0, 0.5], ['G5', 0.5, 1]], 300),
  collect: (a) => {
    a.blip('A5', { dur: 0.09, gain: 0.5 });
    a.blip('E6', { dur: 0.12, gain: 0.4, delay: 0.07 });
  },
  deliver: (a) => a.jingle([['G5', 0, 0.4], ['C6', 0.4, 0.4], ['E6', 0.8, 1.2]], 340),
  promote: (a) => a.jingle([['C5', 0, 0.4], ['E5', 0.4, 0.4], ['G5', 0.8, 0.4], ['C6', 1.2, 0.6], ['E6', 1.6, 1.4]], 380),
  tick: (a) => a.blip('B5', { dur: 0.035, gain: 0.3 }),
  lastTick: (a) => a.blip('E6', { dur: 0.05, gain: 0.45 }),
  timeUp: (a) => {
    a.blip('C4', { dur: 0.55, slide: 0.4, gain: 0.5 });
    a.noise({ dur: 0.45, gain: 0.22, cutoff: 500, delay: 0.08 });
  },
};

/** m:ss, which is how long a shift ever gets. */
function clockText(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** As many characters of `str` as will fit in `width` pixels. */
const fit = (screen, str, width) => str.slice(0, Math.max(0, Math.floor((width + 1) / 6)));

/** Distance readout, in the units of the real place. */
function distanceText(map, pixels) {
  const m = metresOf(map, pixels);
  return m >= 1000 ? `${(m / 1000).toFixed(1)}KM` : `${Math.round(m / 10) * 10}M`;
}

/** Minimap colours. The same reading of the materials as the Explorer's map. */
const miniPalette = (matId) => {
  if (matId === MAT.water || matId === MAT.waterDeep || matId === MAT.marsh) return px(SLOT.WATER, 2);
  if (matId === MAT.building || matId === MAT.buildingTall) return px(SLOT.ROOF, 3);
  if (matId === MAT.road || matId === MAT.parking || matId === MAT.rail) return px(SLOT.ROAD, 2);
  if (matId === MAT.forest) return px(SLOT.TREE, 2);
  if (matId === MAT.sand) return px(SLOT.SAND, 1);
  if (matId === MAT.path || matId === MAT.plaza) return px(SLOT.ROAD, 0);
  return px(SLOT.LAND, 1);
};

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
    // mid-fade would be dropped on the floor.
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
    screen.textCentred(this.label, Math.round(screen.h * 0.42), { slot: SLOT.UI, shade: 3 });
    if (this.error) {
      for (const [i, line] of wrapText(this.error, screen.w - 12).slice(0, 3).entries()) {
        screen.text(line, 6, Math.round(screen.h * 0.55) + i * 9, { slot: SLOT.UI, shade: 2 });
      }
    } else {
      screen.textCentred('SORTING THE ROUND' + '.'.repeat(1 + (Math.floor(this.t * 3) % 3)), Math.round(screen.h * 0.55), {
        slot: SLOT.UI,
        shade: 2,
      });
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
    screen.textCentred('CAMPUS', titleY, { slot: SLOT.UI, shade: 3, scale: 2 });
    screen.textCentred('COURIER', titleY + 20, { slot: SLOT.UI, shade: 3, scale: 2 });
    screen.fill(0, titleY + 40, screen.w, 2, px(SLOT.UI, 3));

    const best = this.save?.get('best', {}) || {};
    let top = 0;
    let rank = RANKS[0];
    for (const entry of Object.values(best)) {
      if (entry.score > top) top = entry.score;
      if (entry.delivered >= rank.at) rank = rankFor(entry.delivered);
    }
    // Laid out from the two fixed blocks - the title above and the road below -
    // rather than from fractions of the screen, so the middle can never land on
    // top of either at the console's shorter resolutions.
    const roadY = h - 26;
    const mid = Math.round((titleY + 46 + (roadY - 14)) / 2);
    screen.textCentred(`BEST ${top}  ${rank.name}`, mid - 10, { slot: SLOT.UI, shade: 2 });
    screen.textCentred('BEAT THE CLOCK', mid + 2, { slot: SLOT.UI, shade: 2 });

    if (Math.floor(this.t * 2) % 2) {
      screen.textCentred('PRESS START', roadY - 12, { slot: SLOT.UI, shade: 3 });
    }

    // A rider crossing the bottom of the screen, on the Explorer's own bicycle
    // sprite. It is the same bike in both cartridges because it is meant to be.
    screen.fill(0, roadY, screen.w, 10, px(SLOT.ROAD, 2));
    screen.hline(0, roadY, screen.w, px(SLOT.ROAD, 3));
    for (let x = Math.round(this.t * -34) % 16; x < screen.w; x += 16) screen.fill(x, roadY + 5, 8, 1, px(SLOT.ROAD, 0));
    const frames = BIKE.right;
    const frame = frames[Math.floor(this.t * 10) % frames.length];
    const rx = Math.round(((this.t * 46) % (screen.w + 40)) - 20);
    screen.blit(frame.px, frame.w, frame.h, rx, roadY + 6 - frame.h, { slot: SLOT.CHAR });

    screen.textCentred('MAP DATA (C) OPENSTREETMAP', h - 10, { slot: SLOT.UI, shade: 1 });
  }
}

class SelectScene {
  constructor(index = 0) {
    this.menu = new Menu(LEVELS, { visible: 3 });
    this.menu.index = index;
    this.t = 0;
  }

  enter(sys) {
    this.save = sys.saveFor(GAME_ID);
    this.t = 0;
  }

  bestFor(level) {
    return (this.save.get('best', {}) || {})[level.id] || null;
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
            () => buildRound(level),
            (s2, round) => s2.replace(new ShiftScene(level, round)),
          ),
        ),
      );
    }
  }

  draw(screen) {
    screen.clear(px(SLOT.UI, 0));
    screen.fill(0, 0, screen.w, 13, px(SLOT.UI, 3));
    screen.text('PICK A ROUND', 5, 3, { slot: SLOT.UI, shade: 0 });

    const level = this.menu.current;
    const infoY = 18;
    const infoH = 46;
    box(screen, 4, infoY, screen.w - 8, infoH);
    screen.text(fit(screen, level.name, screen.w - 20), 10, infoY + 6, { slot: SLOT.UI, shade: 3 });
    screen.text(fit(screen, level.subtitle, screen.w - 20), 10, infoY + 18, { slot: SLOT.UI, shade: 2 });
    const best = this.bestFor(level);
    const line = best ? `${ICON.STAR} ${best.score}  ${rankFor(best.delivered).name}` : `${ICON.STAR} NO SHIFT YET`;
    screen.text(fit(screen, line, screen.w - 20), 10, infoY + 32, { slot: SLOT.UI, shade: 3 });

    const listY = infoY + infoH + 6;
    box(screen, 4, listY, screen.w - 8, screen.h - listY - 4);
    this.menu.draw(screen, 16, listY + 8, (l) => l.name, { cursorTime: this.t, lineHeight: 12 });
  }
}

/**
 * The shift itself: one place, one bicycle, one clock, and a queue of jobs.
 *
 * All of the state lives on the scene rather than in module scope, so a
 * headless harness can build one, step it and assert on the clock without a
 * DOM, a timer or a frame loop.
 */
export class ShiftScene {
  constructor(level, round, seed) {
    this.level = level;
    this.round = round;
    this.map = round.map;
    this.depots = round.depots;
    this.spawn = round.spawn;
    this.rider = new Rider(this.map, round.spawn.x, round.spawn.y);
    this.dispatcher = new Dispatcher(this.map, this.depots, seed);
    this.t = 0;
    this.clock = 0;
    this.score = 0;
    this.jobT = 0; // seconds spent on the job in hand
    this.banner = null;
    this.tickedAt = -1;
    this.over = false;
    this.viewH = 0;
  }

  enter(sys) {
    this.save = sys.saveFor(GAME_ID);
    this.viewH = sys.screen.h - HUD_H;
    const job = this.dispatcher.start(this.rider.x, this.rider.y);
    if (!job) {
      // Nothing reachable from the spawn. buildRound already rules this out;
      // ending the shift rather than throwing keeps the console alive if it
      // ever happens anyway.
      this.endShift(sys);
      return;
    }
    this.clock = job.allowance + START_GRACE;
    this.say(`JOB ${job.n}`, `COLLECT AT ${job.pickup.name}`);
    JOB_SFX.issued(sys.audio);
  }

  resized(w, h) {
    this.viewH = h - HUD_H;
    void w;
  }

  /** A two-line card over the world for a couple of seconds. */
  say(title, line) {
    this.banner = { title, line, t: 2.2 };
  }

  get job() {
    return this.dispatcher.current;
  }

  /** Where the arrow points: the pickup, or the drop once you are carrying. */
  get target() {
    return this.dispatcher.target;
  }

  /** Straight-line pixels to the target, for the HUD readout. */
  distanceToTarget() {
    const t = this.target;
    return t ? Math.hypot(t.x - this.rider.x, t.y - this.rider.y) : 0;
  }

  endShift(sys) {
    if (this.over) return;
    this.over = true;
    const best = this.save.get('best', {}) || {};
    const prev = best[this.level.id];
    const record = this.score > 0 && (!prev || this.score > prev.score);
    if (record) {
      best[this.level.id] = { score: this.score, delivered: this.dispatcher.delivered };
      this.save.set('best', best);
    }
    JOB_SFX.timeUp(sys.audio);
    sys.transitionTo(
      (s) => s.replace(new ResultScene(this.level, this.round, this.score, this.dispatcher.delivered, record)),
      { duration: 0.5 },
    );
  }

  /**
   * Run the clock down by `dt`, ticking audibly through the last few seconds
   * and ending the shift at zero.
   *
   * The job board calls this too. Standing in a menu does not stop a deadline,
   * and a game about deadlines that hands out a free look at the map has given
   * away the thing it is about.
   * @returns {boolean} true if the shift is still running
   */
  advanceClock(dt, sys) {
    if (this.over) return false;
    this.clock -= dt;
    const whole = Math.ceil(this.clock);
    if (this.clock <= PANIC && whole !== this.tickedAt) {
      this.tickedAt = whole;
      if (whole > 0) (whole <= 3 ? JOB_SFX.lastTick : JOB_SFX.tick)(sys.audio);
    }
    if (this.clock <= 0) {
      this.clock = 0;
      this.endShift(sys);
      return false;
    }
    return true;
  }

  /** Arrived at the pickup: the parcel is on the bike, the target moves on. */
  collect(sys) {
    this.job.collected = true;
    JOB_SFX.collect(sys.audio);
    this.say('COLLECTED', `TAKE TO ${this.job.drop.name}`);
  }

  /** Arrived at the drop: paid, promoted if it is due, next job issued. */
  deliver(sys) {
    const job = this.job;
    const bonus = Math.max(0, Math.round((job.allowance - this.jobT) * 4));
    this.score += job.fee + bonus;
    const promoted = isPromotion(this.dispatcher.delivered + 1);

    const next = this.dispatcher.advance();
    this.jobT = 0;
    if (!next) {
      this.endShift(sys);
      return;
    }
    this.clock += next.allowance;

    if (promoted) {
      JOB_SFX.promote(sys.audio);
      this.say(this.dispatcher.rank.name, `+${job.fee + bonus}  ${this.dispatcher.delivered} DELIVERED`);
    } else {
      JOB_SFX.deliver(sys.audio);
      this.say(`+${job.fee + bonus}`, `COLLECT AT ${next.pickup.name}`);
    }
  }

  update(dt, sys) {
    if (this.over) return;
    this.t += dt;
    this.jobT += dt;
    if (this.banner) {
      this.banner.t -= dt;
      if (this.banner.t <= 0) this.banner = null;
    }

    if (sys.input.pressed('start')) {
      SFX.page(sys.audio);
      sys.push(new BoardScene(this));
      return;
    }
    // SELECT is the bike, as it is in the Explorer - the same button does the
    // same thing in both cartridges.
    if (sys.input.pressed('select')) {
      if (this.rider.riding) this.rider.dismount(sys);
      else this.rider.mount(sys);
    }

    const [dx, dy] = sys.input.axis();
    this.rider.update(dt, sys, { dx, dy, b: sys.input.isDown('b') });

    if (!this.advanceClock(dt, sys)) return;

    const target = this.target;
    if (target && Math.hypot(target.x - this.rider.x, target.y - this.rider.y) < REACH) {
      if (this.job.collected) this.deliver(sys);
      else this.collect(sys);
    }
  }

  // --- drawing -------------------------------------------------------------

  /** A job marker, or a flat silhouette of one when it is only a hint. */
  drawMarker(screen, spr, wx, wy, camX, camY, { dim = false } = {}) {
    const sx = Math.round(wx - camX - spr.w / 2);
    const sy = Math.round(wy - camY - spr.h + 2);
    if (sx < -spr.w || sy < -spr.h || sx > screen.w || sy > this.viewH) return false;
    screen.blit(spr.px, spr.w, spr.h, sx, sy, {
      slot: SLOT.GOLD,
      tint: dim ? px(SLOT.GOLD, 2) : null,
    });
    return true;
  }

  /**
   * The compass. When the target is off the screen - which on a 200 pixel
   * screen it usually is - an arrow rides the edge of the view pointing at it.
   */
  drawCompass(screen, camX, camY) {
    const target = this.target;
    if (!target) return;
    const cx = screen.w / 2;
    const cy = this.viewH / 2;
    const dx = target.x - camX - cx;
    const dy = target.y - camY - cy;
    const inset = 10;
    const rx = Math.max(1, cx - inset);
    const ry = Math.max(1, cy - inset);
    const k = Math.min(rx / Math.max(1e-6, Math.abs(dx)), ry / Math.max(1e-6, Math.abs(dy)));
    if (k >= 1) return; // on screen; the marker itself is doing the work
    const arrow = ARROWS[headingIndex(dx, dy)];
    // A slow pulse in and out from the rim, so a static arrow still reads as
    // live when the player is standing still.
    const pulse = Math.sin(this.t * 5) * 1.5;
    const ax = Math.round(cx + dx * k * (1 - pulse / 100));
    const ay = Math.round(cy + dy * k * (1 - pulse / 100));
    screen.blit(arrow.px, arrow.w, arrow.h, ax - (arrow.w >> 1), ay - (arrow.h >> 1), { slot: SLOT.GOLD });
  }

  /** Clock top right, rank top left, both in their own little plates. */
  drawOverlay(screen) {
    const label = clockText(this.clock);
    const cw = screen.textWidth(label) + 8;
    const panic = this.clock <= PANIC && Math.floor(this.t * 6) % 2 === 0;
    screen.fill(screen.w - cw, 0, cw, 11, px(SLOT.UI, panic ? 3 : 0));
    screen.text(label, screen.w - cw + 4, 2, { slot: SLOT.UI, shade: panic ? 0 : 3 });

    const rank = this.dispatcher.rank.name;
    const rw = screen.textWidth(rank) + 8;
    if (rw < screen.w - cw - 8) {
      screen.fill(0, 0, rw, 11, px(SLOT.UI, 0));
      screen.text(rank, 4, 2, { slot: SLOT.UI, shade: 2 });
    }
  }

  drawBanner(screen) {
    if (!this.banner) return;
    const a = Math.min(1, this.banner.t / 0.35);
    const h = Math.round(24 * a);
    if (h <= 6) return;
    const y = 14;
    box(screen, 4, y, screen.w - 8, h);
    if (h > 18) {
      screen.textCentred(fit(screen, this.banner.title, screen.w - 16), y + 4, { slot: SLOT.UI, shade: 3 });
      screen.textCentred(fit(screen, this.banner.line, screen.w - 16), y + 13, { slot: SLOT.UI, shade: 2 });
    }
  }

  drawHUD(screen) {
    const top = this.viewH;
    screen.fill(0, top, screen.w, HUD_H, px(SLOT.UI, 0));
    screen.hline(0, top, screen.w, px(SLOT.UI, 3));

    const job = this.job;
    const carrying = Boolean(job?.collected);
    const rowA = top + 3;
    const rowB = top + 12;

    // Right of the top row: the running score, with the parcel pip beside it
    // whenever there is something on the bike.
    let right = screen.w - 4;
    const score = String(this.score);
    right -= screen.textWidth(score);
    screen.text(score, right, rowA, { slot: SLOT.UI, shade: 3 });
    if (carrying) {
      right -= PARCEL_PIP.w + 4;
      screen.blit(PARCEL_PIP.px, PARCEL_PIP.w, PARCEL_PIP.h, right, rowA, { slot: SLOT.GOLD });
    }

    screen.text(carrying ? 'DELIVER' : 'COLLECT', 4, rowA, { slot: SLOT.ACCENT, shade: 3 });

    // Distance to the target sits between the verb and the score.
    if (this.target) {
      const dist = distanceText(this.map, this.distanceToTarget());
      const dx = 4 + screen.textWidth('DELIVER') + 8;
      if (dx + screen.textWidth(dist) < right - 4) screen.text(dist, dx, rowA, { slot: SLOT.UI, shade: 2 });
    }

    // The address gets the whole second row: an abbreviated delivery address is
    // no use to anybody.
    const name = this.target ? this.target.name : this.map.name;
    screen.text(fit(screen, name, screen.w - 8), 4, rowB, { slot: SLOT.UI, shade: 3 });
  }

  draw(screen, sys) {
    const viewH = this.viewH;
    const [camX, camY] = cameraFor(this.map, this.rider.x, this.rider.y, screen.w, viewH);
    drawMap(screen, this.map, camX, camY, { viewH });
    screen.clip(0, 0, screen.w, viewH);

    const job = this.job;
    if (job) {
      // The far end of the job is drawn as a silhouette from the start, so the
      // route can be planned while riding to the pickup.
      if (!job.collected) this.drawMarker(screen, DROP, job.drop.x, job.drop.y, camX, camY, { dim: true });
      const target = this.target;
      const spr = job.collected ? DROP : PICKUP;
      const bob = Math.round(Math.sin(this.t * 7) * 1.5);
      const onScreen = this.drawMarker(screen, spr, target.x, target.y, camX, camY);
      if (onScreen) {
        screen.blit(
          CHEVRON.px,
          CHEVRON.w,
          CHEVRON.h,
          Math.round(target.x - camX - CHEVRON.w / 2),
          Math.round(target.y - camY - spr.h - 3 + bob),
          { slot: SLOT.GOLD },
        );
      }
    }

    const { sprite, flipX } = this.rider.frame();
    screen.blit(
      sprite.px,
      sprite.w,
      sprite.h,
      Math.round(this.rider.x - camX - sprite.w / 2),
      Math.round(this.rider.y - camY - sprite.h + 4),
      { slot: SLOT.CHAR, flipX },
    );

    this.drawCompass(screen, camX, camY);
    this.drawOverlay(screen);
    this.drawBanner(screen);
    screen.noClip();
    this.drawHUD(screen);

    // Speed meter, bottom right of the map, only while riding: three pips that
    // drop back to one the moment the tyres leave the tarmac.
    if (this.rider.riding) {
      const lit = Math.min(3, Math.floor((this.rider.speed / bikeTopSpeed(this.map)) * 3 + 0.34));
      pips(screen, screen.w - 16, viewH - 7, 3, lit, { slot: SLOT.ACCENT, gap: 4 });
    }
    void sys;
  }
}

/**
 * START: the job board. The whole round on one map, with the job in hand and
 * the one behind it written out in full.
 */
class BoardScene {
  constructor(shift) {
    this.shift = shift;
    this.t = 0;
  }

  enter(sys) {
    this.build(sys.screen.w, sys.screen.h);
  }

  resized(w, h) {
    this.build(w, h);
  }

  build(w, h) {
    this.mini = minimap(this.shift.map, w - 16, Math.round(h * 0.46), miniPalette);
  }

  update(dt, sys) {
    this.t += dt;
    // The clock keeps running while the board is open, so consulting it costs
    // what consulting a map costs.
    if (!this.shift.advanceClock(dt, sys)) return;
    if (sys.input.pressed('start') || sys.input.pressed('b')) {
      SFX.cancel(sys.audio);
      sys.pop();
      return;
    }
    if (sys.input.pressed('select')) {
      // Give up on the shift deliberately rather than by standing still.
      SFX.cancel(sys.audio);
      sys.pop();
      this.shift.clock = 0;
      this.shift.endShift(sys);
    }
  }

  /** Plot a world position onto the minimap. */
  dot(screen, mx, my, wx, wy, byte, size = 3) {
    const sx = this.mini.w / (this.shift.map.w * TILE);
    const sy = this.mini.h / (this.shift.map.h * TILE);
    const half = size >> 1;
    screen.fill(mx + Math.round(wx * sx) - half, my + Math.round(wy * sy) - half, size, size, byte);
  }

  draw(screen) {
    const shift = this.shift;
    screen.clear(px(SLOT.UI, 0));
    screen.fill(0, 0, screen.w, 11, px(SLOT.UI, 3));
    screen.text('JOB BOARD', 4, 2, { slot: SLOT.UI, shade: 0 });
    const clock = clockText(shift.clock);
    screen.text(clock, screen.w - 4 - screen.textWidth(clock), 2, { slot: SLOT.UI, shade: 0 });

    const mx = Math.round((screen.w - this.mini.w) / 2);
    const my = 14;
    screen.frame(mx - 1, my - 1, this.mini.w + 2, this.mini.h + 2, px(SLOT.UI, 3));
    screen.blit(this.mini.px, this.mini.w, this.mini.h, mx, my, { slot: SLOT.UI });

    const job = shift.job;
    if (job) {
      this.dot(screen, mx, my, job.pickup.x, job.pickup.y, px(SLOT.GOLD, job.collected ? 1 : 3));
      this.dot(screen, mx, my, job.drop.x, job.drop.y, px(SLOT.ACCENT, 3));
    }
    if (Math.floor(this.t * 4) % 2) {
      this.dot(screen, mx, my, shift.rider.x, shift.rider.y, px(SLOT.CHAR, 1));
    }

    // Addresses are up to 22 characters and the smallest screen fits 26, so
    // each one gets a line of its own with a one-word tag in front of it
    // rather than sharing a line with "TAKE TO" and being cut in half.
    let y = my + this.mini.h + 6;
    const line = (tag, text, shade) => {
      if (y > screen.h - 10) return;
      const x = 4 + screen.textWidth('THEN') + 4;
      screen.text(tag, 4, y, { slot: SLOT.ACCENT, shade: 3 });
      screen.text(fit(screen, text, screen.w - x - 4), x, y, { slot: SLOT.UI, shade });
      y += 9;
    };
    if (job) {
      if (job.collected) {
        line('DROP', job.drop.name, 3);
      } else {
        line('GET', job.pickup.name, 3);
        line('THEN', job.drop.name, 2);
      }
    }
    const next = shift.dispatcher.next;
    if (next) line('NEXT', next.pickup.name, 2);
    y += 2;
    if (y <= screen.h - 10) {
      screen.text(
        fit(screen, `${shift.dispatcher.rank.name}  ${shift.dispatcher.delivered} DONE  ${shift.score}`, screen.w - 8),
        4,
        y,
        { slot: SLOT.UI, shade: 3 },
      );
    }
    screen.text('B: BACK  SEL: END', 4, screen.h - 9, { slot: SLOT.UI, shade: 2 });
  }
}

/** End of the shift: what you earned, and whether it beat the last one. */
class ResultScene {
  constructor(level, round, score, delivered, record) {
    this.level = level;
    this.round = round;
    this.score = score;
    this.delivered = delivered;
    this.record = record;
    this.t = 0;
  }

  enter(sys) {
    this.save = sys.saveFor(GAME_ID);
    if (this.record) SFX.found(sys.audio);
    this.t = 0;
  }

  update(dt, sys) {
    this.t += dt;
    if (this.t < 0.6) return; // no accidental skip on the button that ran out
    if (sys.input.pressed('a') || sys.input.pressed('start')) {
      // Straight back out, no loading screen: the compiled map is immutable
      // once built, so another shift can be run on the one already in hand.
      SFX.confirm(sys.audio);
      sys.transitionTo((s) => s.replace(new ShiftScene(this.level, this.round)));
    }
    if (sys.input.pressed('b')) {
      SFX.cancel(sys.audio);
      const index = Math.max(0, LEVELS.indexOf(this.level));
      sys.transitionTo((s) => s.replace(new SelectScene(index)));
    }
  }

  draw(screen) {
    screen.clear(px(SLOT.UI, 0));
    screen.fill(0, 0, screen.w, 13, px(SLOT.UI, 3));
    screen.text('OUT OF TIME', 5, 3, { slot: SLOT.UI, shade: 0 });

    screen.textCentred(fit(screen, this.level.name, screen.w - 8), 18, { slot: SLOT.UI, shade: 2 });

    const midY = Math.round(screen.h * 0.32);
    screen.textCentred(String(this.score), midY, { slot: SLOT.UI, shade: 3, scale: 2 });
    screen.textCentred(`${this.delivered} DELIVERED`, midY + 22, { slot: SLOT.UI, shade: 2 });
    screen.textCentred(rankFor(this.delivered).name, midY + 34, { slot: SLOT.UI, shade: 3 });

    const best = (this.save?.get('best', {}) || {})[this.level.id];
    if (this.record && Math.floor(this.t * 3) % 2) {
      screen.textCentred('NEW BEST', midY + 48, { slot: SLOT.UI, shade: 3 });
    } else if (best) {
      screen.textCentred(`BEST ${best.score}`, midY + 48, { slot: SLOT.UI, shade: 2 });
    }

    // What the next rung costs, which is the reason to go round again.
    const next = RANKS.find((r) => r.at > this.delivered);
    if (next && midY + 62 < screen.h - 18) {
      screen.textCentred(`${next.at - this.delivered} MORE FOR ${next.name}`, midY + 62, { slot: SLOT.UI, shade: 2 });
    }

    if (this.t > 0.6 && Math.floor(this.t * 2) % 2) {
      screen.textCentred(`${ICON.A} AGAIN   B: ROUNDS`, screen.h - 14, { slot: SLOT.UI, shade: 3 });
    }
  }
}

export default {
  id: GAME_ID,
  title: 'CAMPUS COURIER',
  subtitle: 'BEAT THE CLOCK',
  icon: ICON_ART,
  create() {
    return new TitleScene();
  },
};

// Exported so a harness can drive a shift directly, without walking the menus
// to get to one. Everything else is reachable from create().
export { buildRound };
