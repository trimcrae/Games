// Shared UI furniture: boxes, menus, and the typewriter text box.

import { SLOT, px, wrapText } from './gfx.js';
import { ICON } from './font.js';
import { decodeArt } from './art.js';

/** A window box: light fill, dark border, and a lighter inner bevel. */
export function box(screen, x, y, w, h, { slot = SLOT.UI, fill = 0 } = {}) {
  screen.fill(x, y, w, h, px(slot, fill));
  screen.frame(x, y, w, h, px(slot, 3));
  screen.frame(x + 1, y + 1, w - 2, h - 2, px(slot, fill === 0 ? 1 : 0));
  // knock the corners off so the box reads as rounded
  for (const [cx, cy] of [
    [x, y],
    [x + w - 1, y],
    [x, y + h - 1],
    [x + w - 1, y + h - 1],
  ]) {
    screen.set(cx, cy, px(slot, fill));
  }
}

/**
 * Text that types itself out, one character at a time, a page at a time.
 * `next()` advances: first it completes the current page, then it turns it.
 */
export class TextBox {
  /**
   * @param {string[]|string} paragraphs
   * @param {object} opts
   * @param {number} opts.width pixels available for text
   * @param {number} opts.lines lines visible at once
   * @param {number} [opts.speed] characters per second
   */
  constructor(paragraphs, { width, lines = 3, speed = 46 }) {
    const all = (Array.isArray(paragraphs) ? paragraphs : [paragraphs]).flatMap((p) => wrapText(p, width));
    this.pages = [];
    for (let i = 0; i < all.length; i += lines) this.pages.push(all.slice(i, i + lines));
    if (!this.pages.length) this.pages = [['']];
    this.page = 0;
    this.speed = speed;
    this.shown = 0;
    this.done = false;
  }

  get pageText() {
    return this.pages[this.page];
  }

  get pageLength() {
    return this.pageText.reduce((n, l) => n + l.length, 0);
  }

  get pageComplete() {
    return this.shown >= this.pageLength;
  }

  get lastPage() {
    return this.page >= this.pages.length - 1;
  }

  update(dt) {
    if (!this.pageComplete) this.shown = Math.min(this.pageLength, this.shown + this.speed * dt);
  }

  /** Returns true when there was nothing left to advance to. */
  next() {
    if (!this.pageComplete) {
      this.shown = this.pageLength;
      return false;
    }
    if (this.lastPage) {
      this.done = true;
      return true;
    }
    this.page++;
    this.shown = 0;
    return false;
  }

  draw(screen, x, y, { slot = SLOT.UI, shade = 3, lineHeight = 9 } = {}) {
    let budget = Math.floor(this.shown);
    let ly = y;
    for (const line of this.pageText) {
      const visible = line.slice(0, Math.max(0, budget));
      screen.text(visible, x, ly, { slot, shade });
      budget -= line.length;
      ly += lineHeight;
      if (budget <= 0) break;
    }
  }

  /** Blinking "there is more" arrow, drawn at the box's bottom-right. */
  drawMore(screen, x, y, time, { slot = SLOT.UI } = {}) {
    if (!this.pageComplete || this.done) return;
    if (Math.floor(time * 3) % 2) return;
    screen.text(ICON.MORE, x, y, { slot, shade: 3 });
  }
}

/** A vertical list with a cursor and a scrolling window. */
export class Menu {
  constructor(items, { visible = 5, wrap = true } = {}) {
    this.items = items;
    this.index = 0;
    this.top = 0;
    this.visible = visible;
    this.wrap = wrap;
  }

  get current() {
    return this.items[this.index];
  }

  set(items) {
    this.items = items;
    this.index = Math.min(this.index, Math.max(0, items.length - 1));
    this.clampWindow();
  }

  move(delta) {
    if (!this.items.length) return false;
    const next = this.index + delta;
    if (next < 0 || next >= this.items.length) {
      if (!this.wrap) return false;
      this.index = (next + this.items.length) % this.items.length;
    } else {
      this.index = next;
    }
    this.clampWindow();
    return true;
  }

  clampWindow() {
    if (this.index < this.top) this.top = this.index;
    if (this.index >= this.top + this.visible) this.top = this.index - this.visible + 1;
    this.top = Math.max(0, Math.min(this.top, Math.max(0, this.items.length - this.visible)));
  }

  /**
   * @param {(item:any, i:number) => string} label
   */
  draw(screen, x, y, label, { slot = SLOT.UI, lineHeight = 10, cursorTime = 0 } = {}) {
    const end = Math.min(this.items.length, this.top + this.visible);
    for (let i = this.top; i < end; i++) {
      const ly = y + (i - this.top) * lineHeight;
      if (i === this.index) {
        const bob = Math.floor(cursorTime * 6) % 2;
        screen.text(ICON.CURSOR, x - 7 + bob, ly, { slot, shade: 3 });
      }
      screen.text(label(this.items[i], i), x, ly, { slot, shade: 3 });
    }
    // scroll hints
    if (this.top > 0) screen.text('^', x + 2, y - 7, { slot, shade: 2 });
    if (end < this.items.length) screen.text(ICON.MORE, x + 2, y + this.visible * lineHeight - 1, { slot, shade: 2 });
  }
}

/** Draw an art panel (hand-drawn or photo-derived) with a border. */
export function drawPanel(screen, art, x, y, { slot = SLOT.UI, border = true } = {}) {
  const a = decodeArt(art);
  if (!a) return null;
  if (border) screen.frame(x - 1, y - 1, a.w + 2, a.h + 2, px(slot, 3));
  screen.blit(a.px, a.w, a.h, x, y, { slot });
  return a;
}

/** Horizontal progress pip row, e.g. landmarks found. */
export function pips(screen, x, y, total, filled, { slot = SLOT.UI, gap = 4 } = {}) {
  for (let i = 0; i < total; i++) {
    const cx = x + i * gap;
    if (i < filled) screen.fill(cx, y, 3, 3, px(slot, 3));
    else screen.frame(cx, y, 3, 3, px(slot, 2));
  }
}
