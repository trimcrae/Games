// BEACON - keep the ships off the rocks.
//
// You have a lamp and a horn. Ships make for your reef out of the dark; sweep
// the beam onto one and hold it there and it puts its helm over. Hold B and the
// beam narrows to a pencil that reaches further and works faster, but lights
// almost nothing else. Press A and the foghorn sounds: every ship answers, so
// for a second you can see where they all are, and every one of them hesitates.
//
// No map, no tiles, no geography: this cartridge exists to lean on the console
// itself - framebuffer, palette slots, input, the two square voices and the
// noise channel, the scene stack, the save, and the adaptive resolution.

import { SLOT, px } from '../../engine/gfx.js';
import { ICON } from '../../engine/font.js';
import { box, Menu, TextBox } from '../../engine/ui.js';
import { SFX } from '../../engine/audio.js';
import { World, beamHalf, beamReach, lampBearing, BEAM_LIMIT } from './sim.js';
import { layoutFor, jitter, polar, drawSea, drawSwell, drawRocks, drawTower, drawShip, drawWreck, HUD_H } from './render.js';
import { ICON_ART } from './art.js';

const GAME_ID = 'beacon';

/**
 * Runs need to differ from each other without anything reaching for the wall
 * clock or Math.random, so the seed comes off a counter that advances once per
 * run. A fresh session always plays the same sequence of nights, which is what
 * makes the headless tests worth anything.
 */
let seedSource = 0x9e3779b9;
function nextSeed() {
  seedSource = (Math.imul(seedSource, 1664525) + 1013904223) >>> 0;
  return seedSource;
}

// --- the cartridge's own voice ---------------------------------------------
//
// Two square voices and a noise channel. The horn is the whole sound of the
// game, so it gets both voices and a puff of low noise for the air.

const SEA_SFX = {
  horn: (a) => {
    a.blip(104, { dur: 0.9, gain: 0.5, slide: 0.93 });
    a.blip(78, { dur: 1.05, gain: 0.42, type: 'triangle', slide: 0.88, delay: 0.04 });
    a.noise({ dur: 0.35, gain: 0.09, cutoff: 340 });
  },
  hornDry: (a) => a.noise({ dur: 0.22, gain: 0.14, cutoff: 500 }),
  // A ship's bell. Nearer hulls ring higher, louder and more often, which in
  // thick fog is the only thing telling you where they are.
  bell: (a, rho) => {
    const f = 500 + (1 - Math.min(1, rho)) * 620;
    a.blip(f, { dur: 0.16 + 0.22 * rho, gain: 0.1 + 0.2 * (1 - rho), type: 'sine' });
    a.blip(f * 2.02, { dur: 0.07, gain: 0.05, type: 'sine' });
  },
  close: (a) => {
    a.blip('C6', { dur: 0.04, gain: 0.3 });
    a.blip('C6', { dur: 0.04, gain: 0.3, delay: 0.13 });
  },
  saved: (a) => a.jingle([['A5', 0, 0.5], ['E6', 0.45, 1.1]], 340),
  wreck: (a) => {
    a.noise({ dur: 0.55, gain: 0.5, cutoff: 300 });
    a.blip(170, { dur: 0.55, gain: 0.4, slide: 0.3 });
  },
  wave: (a) => a.jingle([['C5', 0, 0.6], ['G5', 0.6, 1.2]], 280, { type: 'triangle' }),
  clear: (a) => a.jingle([['C5', 0, 0.4], ['E5', 0.4, 0.4], ['G5', 0.8, 0.4], ['C6', 1.2, 1.2]], 340),
  over: (a) => a.jingle([['G4', 0, 1], ['E4', 1, 1], ['C4', 2, 2.4]], 190, { type: 'triangle' }),
  focus: (a) => a.blip('B5', { dur: 0.03, gain: 0.22 }),
};

/** Turn the world's events into sound, popups and flashes. */
function playEvents(scene, sys, events) {
  for (const e of events) {
    switch (e.type) {
      case 'bell':
        SEA_SFX.bell(sys.audio, e.rho);
        break;
      case 'close':
        SEA_SFX.close(sys.audio);
        break;
      case 'horn':
        SEA_SFX.horn(sys.audio);
        break;
      case 'saved':
        SEA_SFX.saved(sys.audio);
        scene.popups.push({ theta: e.theta, rho: e.rho, text: `+${e.points}`, age: 0 });
        break;
      case 'wreck':
        SEA_SFX.wreck(sys.audio);
        scene.marks.push({ theta: e.theta, age: 0 });
        scene.flash = 0.1;
        break;
      case 'wave':
        SEA_SFX.wave(sys.audio);
        break;
      case 'clear':
        SEA_SFX.clear(sys.audio);
        scene.popups.push({ theta: 0, rho: 0.55, text: `+${e.bonus}`, age: 0 });
        break;
      case 'over':
        SEA_SFX.over(sys.audio);
        break;
      default:
        break;
    }
  }
}

/** The lamp's current shape, shared by the simulation and the renderer. */
const lampOf = (world) => ({
  beam: world.beam,
  half: beamHalf(world.focus),
  reach: beamReach(world.focus, world.fog, world.reachCap),
  fog: world.fog,
});

/** Hand the simulation the three figures that depend on the screen's shape. */
function applyLayout(world, L) {
  world.rockRho = L.rockRho;
  world.reachCap = L.reachCap;
  world.lampRho = L.lampRho;
}

/** How far a hull can be seen without the beam on it. */
const visRadius = (L, fog) => L.spawnR * (1 - 0.6 * fog);

/**
 * Draw the sea, the reef, the ships and the tower. Shared by the game and by
 * the title screen, which plays itself behind the menu.
 */
function drawWorld(screen, L0, world, time) {
  const L = jitter(L0, world);
  const lamp = lampOf(world);
  drawSea(screen, L, lamp);
  drawSwell(screen, L, lamp, time);
  drawRocks(screen, L, world, time);

  const vis = visRadius(L, world.fog) + 6;
  for (const ship of world.ships) {
    const [x, y] = polar(L, ship.theta, ship.rho);
    const seen = ship.lit > 0.15 || Math.hypot(x - L.lampX, y - L.lampY) < vis;
    drawShip(screen, L, ship, { visible: seen, time });
  }
  drawTower(screen, L, world, time);
  return L;
}

// --- title ------------------------------------------------------------------

/**
 * A very small autopilot, so the title screen is the game playing itself rather
 * than a still. It also keeps the attract loop honest: if the game were
 * unplayable this would be visibly drowning.
 */
function autopilot(world) {
  let target = null;
  for (const s of world.ships) {
    if (s.turning) continue;
    if (!target || s.rho < target.rho) target = s;
  }
  if (!target) return { turn: Math.sin(world.time * 0.7) > 0 ? 0.5 : -0.5 };
  const diff = lampBearing(world, target) - world.beam;
  const near = Math.abs(diff) < 0.05;
  return {
    turn: near ? 0 : Math.sign(diff),
    focus: near && target.dist > 0.4,
    horn: world.horn > 0.99 && world.ships.length > 2,
  };
}

const HELP = [
  `${ICON.CURSOR}${ICON.CURSOR} SWEEP THE BEAM. HOLD A SHIP IN THE LIGHT AND IT PUTS ITS HELM OVER.`,
  'HOLD B TO FOCUS THE LAMP: NARROWER, BUT IT REACHES FURTHER AND WORKS FASTER.',
  `${ICON.A} SOUNDS THE FOGHORN. EVERY SHIP ANSWERS, SO YOU SEE THEM ALL FOR A MOMENT, AND EVERY ONE HESITATES.`,
  'FOG HIDES THE SEA. LISTEN FOR THE BELLS: THE NEARER A SHIP IS, THE FASTER IT RINGS.',
  'CATCH THEM FAR OUT FOR MORE. THREE WRECKS AND THE NIGHT IS OVER.',
];

class TitleScene {
  constructor() {
    this.t = 0;
    this.menu = new Menu(['PLAY', 'HOW TO PLAY'], { visible: 2 });
    this.demo = new World(0xbeac04);
    this.help = null;
  }

  enter(sys) {
    this.save = sys.saveFor(GAME_ID);
    this.best = this.save.get('best', 0);
    this.t = 0;
  }

  resized(w, h) {
    this.L = layoutFor(w, h);
    applyLayout(this.demo, this.L);
  }

  ensure(screen) {
    if (!this.L || this.L.w !== screen.w || this.L.h !== screen.h) this.resized(screen.w, screen.h);
    return this.L;
  }

  update(dt, sys) {
    this.t += dt;
    // The demo never ends: when it loses the night it simply starts another.
    this.demo.update(dt, autopilot(this.demo));
    this.demo.drain();
    if (this.demo.state === 'over') this.demo.reset();

    if (this.help) {
      this.help.update(dt);
      if (sys.input.pressed('b')) {
        SFX.cancel(sys.audio);
        this.help = null;
      } else if (sys.input.pressed('a') || sys.input.pressed('start')) {
        SFX.page(sys.audio);
        if (this.help.next()) this.help = null;
      }
      return;
    }
    if (sys.input.repeated('down') || sys.input.repeated('up')) {
      this.menu.move(sys.input.repeated('down') ? 1 : -1);
      SFX.cursor(sys.audio);
    }
    if (sys.input.pressed('a') || sys.input.pressed('start')) {
      if (this.menu.index === 1) {
        SFX.confirm(sys.audio);
        this.help = this.makeHelp(sys.screen);
        return;
      }
      SFX.confirm(sys.audio);
      sys.transitionTo((s) => s.replace(new PlayScene(nextSeed())));
    }
  }

  draw(screen, sys) {
    const L = this.ensure(screen);
    drawWorld(screen, L, this.demo, this.t);

    if (this.help) {
      this.drawHelp(screen);
      return;
    }

    const w = screen.w;
    const titleY = Math.max(6, Math.round(screen.h * 0.1));
    // A dark plate behind the type: the sea underneath is busy and moving.
    screen.fill(0, titleY - 5, w, 34, px(SLOT.NIGHT, 3));
    screen.hline(0, titleY - 5, w, px(SLOT.UI, 3));
    screen.hline(0, titleY + 28, w, px(SLOT.UI, 3));
    screen.textCentred('BEACON', titleY, { slot: SLOT.UI, shade: 0, scale: 2 });
    screen.textCentred('KEEP THEM OFF THE ROCKS', titleY + 19, { slot: SLOT.UI, shade: 1 });

    const boxH = 30;
    const boxY = Math.round(screen.h * 0.46);
    box(screen, 12, boxY, w - 24, boxH);
    this.menu.draw(screen, 24, boxY + 6, (item) => item, { cursorTime: this.t, lineHeight: 10 });

    const bestY = boxY + boxH + 8;
    screen.fill(0, bestY - 2, w, 11, px(SLOT.NIGHT, 3));
    screen.textCentred(`BEST ${this.best}`, bestY, { slot: SLOT.UI, shade: 0 });
    void sys;
  }

  /**
   * The instructions, paged through the console's own TextBox so they fit
   * whatever screen the shell handed us instead of assuming a tall one.
   */
  makeHelp(screen) {
    const lines = Math.max(3, Math.min(9, Math.floor((screen.h - 58) / 9)));
    const help = new TextBox(HELP, { width: screen.w - 26, lines, speed: 420 });
    help.lines = lines;
    return help;
  }

  drawHelp(screen) {
    const help = this.help;
    const lh = 9;
    const h = help.lines * lh + 28;
    const y = Math.max(2, Math.round((screen.h - h) / 2));
    box(screen, 6, y, screen.w - 12, Math.min(screen.h - y - 2, h));
    screen.textCentred('HOW TO PLAY', y + 5, { slot: SLOT.UI, shade: 3 });
    screen.hline(10, y + 14, screen.w - 20, px(SLOT.UI, 2));
    help.draw(screen, 12, y + 19, { lineHeight: lh });
    help.drawMore(screen, screen.w - 16, y + h - 12, this.t);
  }
}

// --- the night --------------------------------------------------------------

class PlayScene {
  /** @param {number} seed */
  constructor(seed = 1) {
    this.world = new World(seed);
    this.seed = seed;
    this.t = 0;
    this.popups = [];
    this.marks = [];
    this.flash = 0;
    this.paused = false;
    this.recorded = false;
    this.pauseMenu = new Menu(['RESUME', 'RESTART', 'GIVE UP'], { visible: 3 });
  }

  enter(sys) {
    this.save = sys.saveFor(GAME_ID);
    this.world.best = this.save.get('best', 0);
    this.t = 0;
  }

  resized(w, h) {
    this.L = layoutFor(w, h);
    // The reef's share of the sea changes a little with the screen's shape;
    // the simulation is told, so a wreck happens where the rocks are drawn and
    // the lamp reaches exactly as far as the player can see.
    applyLayout(this.world, this.L);
  }

  ensure(screen) {
    if (!this.L || this.L.w !== screen.w || this.L.h !== screen.h) this.resized(screen.w, screen.h);
    return this.L;
  }

  restart(sys) {
    this.world = new World(nextSeed());
    this.world.best = this.save?.get('best', 0) || 0;
    if (this.L) applyLayout(this.world, this.L);
    this.popups.length = 0;
    this.marks.length = 0;
    this.flash = 0;
    this.recorded = false;
    this.paused = false;
    void sys;
  }

  /** Remember the night if it was a good one. */
  record() {
    if (this.recorded) return;
    this.recorded = true;
    this.beat = this.world.score > (this.save?.get('best', 0) || 0);
    if (this.beat) this.save?.set('best', this.world.score);
    this.save?.set('lastScore', this.world.score);
    this.save?.set('lastWave', this.world.wave);
  }

  update(dt, sys) {
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt);
    for (const p of this.popups) p.age += dt;
    for (const m of this.marks) m.age += dt;
    this.popups = this.popups.filter((p) => p.age < 1.1);
    this.marks = this.marks.filter((m) => m.age < 0.6);

    if (this.paused) {
      this.updatePaused(sys);
      return;
    }

    if (this.world.state === 'over') {
      this.record();
      this.world.update(dt);
      if (sys.input.pressed('a') || sys.input.pressed('start')) {
        SFX.confirm(sys.audio);
        this.restart(sys);
      } else if (sys.input.pressed('b')) {
        SFX.cancel(sys.audio);
        sys.transitionTo((s) => s.replace(new TitleScene()));
      }
      return;
    }

    if (sys.input.pressed('start')) {
      SFX.cursor(sys.audio);
      this.paused = true;
      this.pauseMenu.index = 0;
      return;
    }

    const focus = sys.input.isDown('b');
    if (focus && !this.wasFocus) SEA_SFX.focus(sys.audio);
    this.wasFocus = focus;

    const [ax] = sys.input.axis();
    this.world.update(dt, { turn: ax, focus, horn: sys.input.pressed('a') });
    if (sys.input.pressed('a') && this.world.horn < 1 / 3 && !this.world.hornFlash) SEA_SFX.hornDry(sys.audio);
    playEvents(this, sys, this.world.drain());
  }

  updatePaused(sys) {
    if (sys.input.repeated('down') || sys.input.repeated('up')) {
      this.pauseMenu.move(sys.input.repeated('down') ? 1 : -1);
      SFX.cursor(sys.audio);
    }
    if (sys.input.pressed('start') || sys.input.pressed('b')) {
      SFX.cancel(sys.audio);
      this.paused = false;
      return;
    }
    if (!sys.input.pressed('a')) return;
    SFX.confirm(sys.audio);
    if (this.pauseMenu.index === 0) this.paused = false;
    else if (this.pauseMenu.index === 1) this.restart(sys);
    else {
      this.record();
      sys.transitionTo((s) => s.replace(new TitleScene()));
    }
  }

  draw(screen, sys) {
    const L0 = this.ensure(screen);
    const world = this.world;
    const L = drawWorld(screen, L0, world, this.t);

    for (const m of this.marks) drawWreck(screen, L, m);

    for (const p of this.popups) {
      const [x, y] = polar(L, p.theta, p.rho);
      const ly = Math.round(y - 8 - p.age * 12);
      if (ly < L.hud) continue;
      screen.text(p.text, Math.round(x - screen.textWidth(p.text) / 2), ly, {
        slot: SLOT.UI,
        shade: 0,
        shadow: 3,
      });
    }

    // The blink on a wreck. Dithered rather than a solid white-out: this is a
    // dark game played on a phone at night, and a full-screen flash hurts.
    if (this.flash > 0) {
      const byte = px(SLOT.UI, 0);
      const step = this.flash > 0.06 ? 2 : 3;
      for (let y = L.hud; y < screen.h; y++) {
        for (let x = y % step; x < screen.w; x += step) screen.set(x, y, byte);
      }
    }

    this.drawHud(screen);
    this.drawBanner(screen);

    if (this.paused) this.drawPause(screen);
    else if (world.state === 'over') this.drawOver(screen);
    void sys;
  }

  drawHud(screen) {
    const world = this.world;
    const w = screen.w;
    screen.fill(0, 0, w, HUD_H, px(SLOT.UI, 0));
    screen.hline(0, HUD_H - 1, w, px(SLOT.UI, 3));

    screen.text(String(world.score), 3, 2, { slot: SLOT.UI, shade: 3 });
    const mult = world.multiplier;
    if (mult > 1) {
      const tag = `x${mult % 1 ? mult.toFixed(1) : mult}`;
      screen.text(tag, 3 + screen.textWidth(String(world.score)) + 4, 2, { slot: SLOT.UI, shade: 2 });
    }

    const wave = `W${world.wave}`;
    screen.text(wave, Math.round((w - screen.textWidth(wave)) / 2), 2, { slot: SLOT.UI, shade: 2 });

    // Lives as lamps still burning, right-aligned: filled is lit, hollow is lost.
    for (let i = 0; i < 3; i++) {
      const x = w - 5 - (3 - i) * 6;
      if (i < world.lives) screen.fill(x, 3, 4, 6, px(SLOT.UI, 3));
      else screen.frame(x, 3, 4, 6, px(SLOT.UI, 2));
    }

    // Horn charges, bottom left, labelled with the button that fires them.
    const y = screen.h - 8;
    screen.text(ICON.A, 3, y - 1, { slot: SLOT.UI, shade: 0, shadow: 3 });
    for (let i = 0; i < 3; i++) {
      const x = 11 + i * 6;
      const level = Math.max(0, Math.min(1, this.world.horn * 3 - i));
      screen.frame(x, y, 5, 6, px(SLOT.UI, 3));
      screen.fill(x, y, 5, 6, px(SLOT.NIGHT, 3));
      if (level > 0) screen.fill(x + 1, y + 5 - Math.round(level * 4), 3, Math.max(1, Math.round(level * 4)), px(SLOT.GOLD, 0));
    }
  }

  drawBanner(screen) {
    const world = this.world;
    const y = Math.round(screen.h * 0.3);
    if (world.state === 'intro' && world.stateT < 1.6) {
      const label = `WAVE ${world.wave}`;
      screen.fill(0, y - 3, screen.w, 22, px(SLOT.NIGHT, 3));
      screen.hline(0, y - 3, screen.w, px(SLOT.UI, 3));
      screen.hline(0, y + 18, screen.w, px(SLOT.UI, 3));
      screen.textCentred(label, y, { slot: SLOT.UI, shade: 0 });
      const note = world.fogTarget > 0.45 ? 'THICK FOG' : world.fogTarget > 0.15 ? 'FOG SETTING IN' : 'CLEAR NIGHT';
      screen.textCentred(note, y + 9, { slot: SLOT.UI, shade: 1 });
    } else if (world.state === 'clear') {
      screen.fill(0, y - 3, screen.w, 13, px(SLOT.NIGHT, 3));
      screen.textCentred('ALL CLEAR', y, { slot: SLOT.UI, shade: 0 });
    } else if (world.wave === 1 && world.state === 'running' && world.time < 8) {
      screen.textCentred(`${ICON.CURSOR}${ICON.CURSOR} SWEEP   B FOCUS   ${ICON.A} HORN`, screen.h - 20, {
        slot: SLOT.UI,
        shade: 0,
        shadow: 3,
      });
    }
  }

  drawPause(screen) {
    const w = Math.min(screen.w - 20, 120);
    const h = 52;
    const x = Math.round((screen.w - w) / 2);
    const y = Math.round((screen.h - h) / 2);
    box(screen, x, y, w, h);
    screen.textCentred('PAUSED', y + 6, { slot: SLOT.UI, shade: 3 });
    this.pauseMenu.draw(screen, x + 20, y + 18, (item) => item, { cursorTime: this.t, lineHeight: 10 });
  }

  drawOver(screen) {
    const world = this.world;
    const w = Math.min(screen.w - 12, 148);
    const h = 62;
    const x = Math.round((screen.w - w) / 2);
    const y = Math.round((screen.h - h) / 2);
    box(screen, x, y, w, h);
    screen.textCentred('THE LAMP IS OUT', y + 6, { slot: SLOT.UI, shade: 3 });
    screen.hline(x + 6, y + 15, w - 12, px(SLOT.UI, 2));
    screen.textCentred(`SCORE ${world.score}`, y + 20, { slot: SLOT.UI, shade: 3 });
    screen.textCentred(`WAVE ${world.wave}`, y + 30, { slot: SLOT.UI, shade: 2 });
    if (this.beat) {
      if (Math.floor(this.t * 3) % 2) screen.textCentred('A NEW BEST', y + 40, { slot: SLOT.UI, shade: 3 });
    } else {
      screen.textCentred(`BEST ${this.save?.get('best', 0) || 0}`, y + 40, { slot: SLOT.UI, shade: 2 });
    }
    screen.textCentred(`${ICON.A} AGAIN   B TITLE`, y + h - 12, { slot: SLOT.UI, shade: 3 });
  }
}

export { TitleScene, PlayScene, BEAM_LIMIT };

export default {
  id: GAME_ID,
  title: 'BEACON',
  subtitle: 'KEEP THEM OFF THE ROCKS',
  icon: ICON_ART,
  create() {
    return new TitleScene();
  },
};
