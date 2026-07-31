// The system ROM: the boot screen and the cartridge launcher.
// Games are ordinary ES modules, loaded on demand when you pick one.

import { SLOT, px } from './gfx.js';
import { ICON } from './font.js';
import { Menu, box, drawPanel, fitScale } from './ui.js';
import { decodeArt } from './art.js';
import { SFX } from './audio.js';

/** Falling logo, chime, then the launcher. Any button skips it. */
export class BootScene {
  constructor(next, { title = 'HANDHELD', skippable = true } = {}) {
    this.next = next;
    this.title = title;
    this.skippable = skippable;
    this.t = 0;
    this.chimed = false;
  }

  enter(sys) {
    this.t = 0;
    this.chimed = false;
    sys.audio.unlock();
  }

  update(dt, sys) {
    this.t += dt;
    const rest = this.restY(sys.screen);
    if (!this.chimed && this.y >= rest) {
      this.chimed = true;
      SFX.boot(sys.audio);
    }
    const finished = this.t > 2.6;
    const skipped = this.skippable && this.t > 0.4 && sys.input.anyPressed();
    if (finished || skipped) sys.transitionTo((s) => s.replace(this.next()), { duration: 0.28 });
  }

  restY(screen) {
    return Math.round(screen.h / 2 - 12);
  }

  draw(screen, sys) {
    screen.clear(px(SLOT.UI, 0));
    const rest = this.restY(screen);
    // Ease the logo down over the first second, then let it sit.
    const k = Math.min(1, this.t / 1);
    const eased = 1 - (1 - k) ** 3;
    this.y = Math.round(-24 + (rest + 24) * eased);

    screen.textCentred(this.title, this.y, { slot: SLOT.UI, shade: 3, scale: 2 });
    if (this.chimed) {
      screen.textCentred('POCKET SERIES', this.y + 20, { slot: SLOT.UI, shade: 2 });
      if (Math.floor(this.t * 2) % 2) {
        screen.textCentred('PRESS START', screen.h - 28, { slot: SLOT.UI, shade: 3 });
      }
    }
    void 0;
    void sys;
  }
}

/** Cartridge select. */
export class LauncherScene {
  /**
   * @param {Array<{id:string,title:string,subtitle?:string,year?:string,icon?:object,load:()=>Promise<any>}>} carts
   */
  constructor(carts) {
    this.carts = carts;
    this.menu = new Menu(carts, { visible: 3 });
    this.t = 0;
    this.loading = null;
    this.error = null;
  }

  enter(sys) {
    this.t = 0;
    this.loading = null;
    this.error = null;
    void sys;
  }

  update(dt, sys) {
    this.t += dt;
    if (this.loading) return;

    if (sys.input.repeated('down')) {
      this.menu.move(1);
      SFX.cursor(sys.audio);
    }
    if (sys.input.repeated('up')) {
      this.menu.move(-1);
      SFX.cursor(sys.audio);
    }
    if (sys.input.pressed('a') || sys.input.pressed('start')) {
      const cart = this.menu.current;
      if (!cart) return;
      SFX.confirm(sys.audio);
      this.loading = cart.title;
      this.error = null;
      cart
        .load()
        .then((mod) => {
          const game = mod.default || mod;
          sys.transitionTo((s) => s.replace(game.create(s)), { duration: 0.3 });
        })
        .catch((err) => {
          console.error(err);
          this.loading = null;
          this.error = String(err.message || err).slice(0, 60);
        });
    }
  }

  draw(screen, sys) {
    screen.clear(px(SLOT.UI, 0));

    // title bar
    screen.fill(0, 0, screen.w, 13, px(SLOT.UI, 3));
    screen.text('CARTRIDGES', 5, 3, { slot: SLOT.UI, shade: 0 });
    screen.text(sys.look.name, screen.w - 5 - screen.textWidth(sys.look.name), 3, { slot: SLOT.UI, shade: 0 });

    const cart = this.menu.current;

    // Cover art fills whatever room the list does not need, at a whole scale.
    const listH = Math.min(70, Math.max(40, this.menu.visible * 12 + 16));
    const listY = screen.h - listH;
    const artTop = 16;
    const artBox = { w: screen.w - 16, h: listY - artTop - 12 };

    if (cart?.icon) {
      const icon = decodeArt(cart.icon);
      const scale = fitScale(icon, artBox.w, artBox.h);
      drawPanel(screen, icon, Math.round((screen.w - icon.w * scale) / 2), artTop + Math.round((artBox.h - icon.h * scale) / 2), {
        slot: SLOT.UI,
        scale,
      });
    } else {
      box(screen, Math.round((screen.w - 64) / 2), artTop, 64, 48);
    }

    // Clear of the list box, which starts at listY - 5.
    if (cart) screen.textCentred(cart.subtitle || '', listY - 16, { slot: SLOT.UI, shade: 2 });

    box(screen, 2, listY - 5, screen.w - 4, screen.h - listY + 3);
    this.menu.draw(screen, 12, listY, (c) => c.title, { cursorTime: this.t });

    const midY = Math.round(screen.h / 2);
    if (this.loading) {
      box(screen, 16, midY - 15, screen.w - 32, 30);
      screen.textCentred('LOADING', midY - 7, { slot: SLOT.UI, shade: 3 });
      screen.textCentred(this.loading.slice(0, 22), midY + 3, { slot: SLOT.UI, shade: 2 });
    } else if (this.error) {
      box(screen, 8, midY - 20, screen.w - 16, 40);
      screen.textCentred('CARTRIDGE ERROR', midY - 14, { slot: SLOT.UI, shade: 3 });
      screen.text(this.error.slice(0, 25), 12, midY - 2, { slot: SLOT.UI, shade: 2 });
      screen.text(this.error.slice(25, 50), 12, midY + 7, { slot: SLOT.UI, shade: 2 });
    }
  }
}

/** Small helper for games: a uniform "press A" footer hint. */
export function hint(screen, text, y = null, time = 0) {
  const ly = y ?? screen.h - 10;
  if (Math.floor(time * 2) % 2 === 0) return;
  screen.text(`${ICON.A} ${text}`, 5, ly, { slot: SLOT.UI, shade: 3 });
}
