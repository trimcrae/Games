// The console itself: a fixed-timestep loop, a scene stack, and the plumbing
// that gets a 160x144 framebuffer onto a canvas.

import { Screen, LOOKS, buildLUT, SLOT_COUNT } from './gfx.js';
import { Input, attachKeyboard, pollGamepads } from './input.js';
import { Audio } from './audio.js';
import { Save } from './save.js';

const STEP = 1 / 60;
const MAX_FRAME = 0.25; // never simulate more than this after a stall

/**
 * A scene is any object with some of:
 *   enter(sys), exit(sys), update(dt, sys), draw(screen, sys)
 * Set `transparent = true` to have the scene below keep drawing underneath.
 */
export class Scene {
  enter() {}
  exit() {}
  update() {}
  draw() {}
}

export class Handheld {
  constructor({ canvas, width = 160, height = 144, look = 'color' }) {
    this.canvas = canvas;
    this.screen = new Screen(width, height);
    this.input = new Input();
    this.audio = new Audio();
    this.settings = new Save('system');
    this.stack = [];
    this.running = false;
    this.acc = 0;
    this.last = 0;
    this.time = 0;
    this.fade = 0; // 0 = normal, 1 = black

    this.ctx = canvas.getContext('2d', { alpha: false });
    this.ctx.imageSmoothingEnabled = false;
    canvas.width = width;
    canvas.height = height;
    this.image = this.ctx.createImageData(width, height);
    this.out32 = new Uint32Array(this.image.data.buffer);

    this.setLook(this.settings.get('look', look));
    this.audio.setEnabled(this.settings.get('sound', true));
    this.detachKeys = attachKeyboard(this.input);
  }

  // --- looks ---------------------------------------------------------------

  setLook(id) {
    this.lookId = LOOKS[id] ? id : 'dmg';
    this.look = LOOKS[this.lookId];
    this.baseLUT = buildLUT(this.look, this.imagePalette);
    this.lut = this.baseLUT;
    this.settings.set('look', this.lookId);
    this.applyFade(this.fade);
    this.onLookChange?.(this.lookId, this.look);
  }

  cycleLook(step = 1) {
    const ids = Object.keys(LOOKS);
    const next = ids[(ids.indexOf(this.lookId) + step + ids.length) % ids.length];
    this.setLook(next);
    return next;
  }

  /**
   * Fade toward black by pushing every shade down, which is how the hardware
   * did it: the palette registers changed, not the pixels.
   */
  applyFade(level) {
    this.fade = Math.max(0, Math.min(1, level));
    if (this.fade === 0) {
      this.lut = this.baseLUT;
      return;
    }
    const steps = Math.round(this.fade * 3);
    const lut = new Uint32Array(256);
    for (let slot = 0; slot < SLOT_COUNT; slot++) {
      for (let shade = 0; shade < 4; shade++) {
        lut[(slot << 2) | shade] = this.baseLUT[(slot << 2) | Math.min(3, shade + steps)];
      }
    }
    for (let b = SLOT_COUNT * 4; b < 256; b++) lut[b] = lut[b % (SLOT_COUNT * 4)];
    this.lut = lut;
  }

  /**
   * Install the colour table an image panel needs (or null to clear it).
   * Only one image is on screen at a time, which is what makes 192 free
   * palette entries enough.
   */
  setImagePalette(palette) {
    this.imagePalette = palette || null;
    this.baseLUT = buildLUT(this.look, this.imagePalette);
    this.applyFade(this.fade);
    if (!this.fade) this.lut = this.baseLUT;
  }

  toggleSound() {
    const on = !this.audio.enabled;
    this.audio.setEnabled(on);
    this.settings.set('sound', on);
    return on;
  }

  // --- scene stack ---------------------------------------------------------

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

  // --- loop ----------------------------------------------------------------

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now) => {
      if (!this.running) return;
      const dt = Math.min(MAX_FRAME, (now - this.last) / 1000);
      this.last = now;
      this.acc += dt;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        this.tick(STEP);
      }
      this.render();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  stop() {
    this.running = false;
  }

  tick(dt) {
    this.time += dt;
    pollGamepads(this.input);
    this.input.poll(dt);
    // A transition owns the console while it runs: the world freezes and input
    // is ignored, so a double tap cannot start two scene changes at once.
    if (this.transition) {
      this.transition.update(dt, this);
      return;
    }
    this.scene?.update?.(dt, this);
  }

  /**
   * Fade to black, swap scenes, fade back. `swap` runs at the darkest point,
   * so it is free to replace the whole stack.
   */
  transitionTo(swap, { duration = 0.34 } = {}) {
    if (this.transition) return;
    const half = duration / 2;
    let t = 0;
    let swapped = false;
    this.transition = {
      update: (dt, sys) => {
        t += dt;
        if (t < half) {
          sys.applyFade(t / half);
        } else if (!swapped) {
          swapped = true;
          sys.applyFade(1);
          swap(sys);
        } else if (t >= duration) {
          sys.applyFade(0);
          sys.transition = null;
        } else {
          sys.applyFade(1 - (t - half) / half);
        }
      },
    };
  }

  render() {
    // Draw from the deepest opaque scene upward, so pause menus and dialogs
    // can sit on top of a still-visible world.
    let base = this.stack.length - 1;
    while (base > 0 && this.stack[base].transparent) base--;
    for (let i = base; i < this.stack.length; i++) this.stack[i].draw?.(this.screen, this);
    this.screen.present(this.out32, this.lut);
    this.ctx.putImageData(this.image, 0, 0);
  }

  /** Per-cartridge save data. */
  saveFor(gameId) {
    return new Save(`game:${gameId}`);
  }
}
