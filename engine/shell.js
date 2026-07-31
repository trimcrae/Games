// Builds the handheld around the canvas: a screen across the top half of the
// viewport, then the controls — d-pad, A/B, START/SELECT and the system strip.
// Touch, mouse and pen all arrive as pointer events.
//
// The screen is the point of the device, so it is sized first and the console
// is built to fit it (see pickSize): the framebuffer resolution is derived from
// the space available at a whole-number pixel scale, rather than a fixed
// resolution being stretched to fit.

const TILE = 8; // framebuffer tile grid: keep logical sizes on it
const TARGET_W = 208; // aim for a logical width near this, so pixels stay chunky
const MIN_SCALE = 2;
const MAX_SCALE = 6;
const MIN_W = 160;
const MAX_W = 320;
// 128 rather than the Game Boy's 144: on a short phone (320x568) the extra two
// tiles of slack are what keeps the scale at 2 instead of collapsing to 1.
const MIN_H = 128;
const MAX_H = 288;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const snap = (v) => Math.max(TILE, Math.round(v / TILE) * TILE);

/**
 * Choose a framebuffer size for a screen area of `availW` x `availH` CSS px.
 *
 * Pixel art at a fractional scale shimmers, so the scale is always an integer
 * and the resolution floats instead: pick the scale that lands the logical
 * width near TARGET_W, then derive width and height from the area, on the 8px
 * tile grid. The result never overflows the area — any remainder (at most a
 * tile) shows as bezel.
 *
 * @returns {{width:number, height:number, scale:number}}
 */
export function pickSize(availW, availH) {
  const aw = Math.max(1, availW);
  const ah = Math.max(1, availH);
  let scale = clamp(Math.round(aw / TARGET_W), MIN_SCALE, MAX_SCALE);
  const derive = (s) => ({
    width: clamp(snap(aw / s), MIN_W, MAX_W),
    height: clamp(snap(ah / s), MIN_H, MAX_H),
  });
  let { width, height } = derive(scale);

  // Rounding (or the minimum resolution) can overrun the area. Give back a tile
  // at a time, and only drop a scale step when there are no tiles left to give.
  while (scale > 1 && (width * scale > aw || height * scale > ah)) {
    if (width * scale > aw && width - TILE >= MIN_W) width -= TILE;
    else if (height * scale > ah && height - TILE >= MIN_H) height -= TILE;
    else {
      scale -= 1;
      ({ width, height } = derive(scale));
    }
  }
  return { width, height, scale };
}

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/**
 * @param {HTMLElement} mount
 * @param {{title?:string}} opts
 * @returns {{
 *   root: HTMLElement,
 *   canvas: HTMLCanvasElement,
 *   size: {width:number, height:number, scale:number},
 *   bind:(sys:object)=>void,
 *   onResize:(cb:(size:object)=>void)=>()=>void,
 * }}
 */
export function buildShell(mount, { title = 'HANDHELD' } = {}) {
  const root = el('div', 'hh');

  // --- screen ---
  const screenBox = el('div', 'hh-screen');
  const canvas = document.createElement('canvas');
  canvas.className = 'hh-canvas';
  canvas.setAttribute('aria-label', `${title} game screen`);
  screenBox.appendChild(canvas);

  // --- controls ---
  const pad = el('div', 'hh-pad');
  const dpad = el('div', 'hh-dpad');
  dpad.setAttribute('role', 'group');
  dpad.setAttribute('aria-label', 'Direction pad');
  dpad.append(el('i', 'hh-dpad-v'), el('i', 'hh-dpad-h'), el('i', 'hh-dpad-hub'));

  const ab = el('div', 'hh-ab');
  const bBtn = el('button', 'hh-btn hh-round', 'B');
  const aBtn = el('button', 'hh-btn hh-round', 'A');
  bBtn.dataset.btn = 'b';
  aBtn.dataset.btn = 'a';
  bBtn.setAttribute('aria-label', 'B button');
  aBtn.setAttribute('aria-label', 'A button');
  ab.append(bBtn, aBtn);

  const menu = el('div', 'hh-menu');
  const selectBtn = el('button', 'hh-btn hh-pill', 'SELECT');
  const startBtn = el('button', 'hh-btn hh-pill', 'START');
  selectBtn.dataset.btn = 'select';
  startBtn.dataset.btn = 'start';
  menu.append(selectBtn, startBtn);

  const sysBar = el('div', 'hh-sys');
  const lookBtn = el('button', '', 'SCREEN');
  const soundBtn = el('button', '', 'SOUND');
  const fullBtn = el('button', '', 'FULLSCREEN');
  sysBar.append(lookBtn, soundBtn, fullBtn);

  pad.append(dpad, ab, menu, sysBar);
  root.append(screenBox, pad);
  mount.appendChild(root);

  // --- sizing -------------------------------------------------------------
  // CSS owns *where* the screen is; this owns what resolution fits in it.

  const listeners = new Set();
  let bound = null;

  /** The screen area in CSS px (border box minus the bezel border). */
  function measure() {
    let w = screenBox.clientWidth;
    let h = screenBox.clientHeight;
    if (w < 40 || h < 40) {
      // Not laid out yet (display:none, detached): estimate from the viewport.
      w = Math.max(160, window.innerWidth - 12);
      h = Math.max(144, window.innerHeight / 2 - 12);
    }
    return { w, h };
  }

  /** Point the canvas at `next`: backing store, then displayed size. */
  function applySize(next) {
    if (canvas.width !== next.width || canvas.height !== next.height) {
      canvas.width = next.width;
      canvas.height = next.height;
    }
    canvas.style.width = `${next.width * next.scale}px`;
    canvas.style.height = `${next.height * next.scale}px`;
    size = next;
  }

  /** Keep the current framebuffer, just re-fit it at the best integer scale. */
  function refit(area) {
    const scale = Math.max(1, Math.floor(Math.min(area.w / size.width, area.h / size.height)));
    canvas.style.width = `${size.width * scale}px`;
    canvas.style.height = `${size.height * scale}px`;
    size = { ...size, scale };
  }

  const first = measure();
  let size = pickSize(first.w, first.h);
  applySize(size);

  function relayout() {
    const area = measure();
    const next = pickSize(area.w, area.h);
    // A console that cannot change resolution keeps the one it booted with;
    // only the scale is re-fitted so it still sits neatly in the bezel.
    if (bound && typeof bound.resize !== 'function') {
      refit(area);
      return;
    }
    const changed = next.width !== size.width || next.height !== size.height;
    applySize(next);
    if (changed) for (const cb of listeners) cb({ ...size });
  }

  let pending = 0;
  const scheduleLayout = () => {
    cancelAnimationFrame(pending);
    pending = requestAnimationFrame(relayout);
  };

  const ro = new ResizeObserver(scheduleLayout);
  ro.observe(screenBox);
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('orientationchange', () => setTimeout(scheduleLayout, 150));

  return {
    root,
    canvas,
    get size() {
      return { ...size };
    },
    elements: { screenBox, dpad, ab, menu, lookBtn, soundBtn, fullBtn },

    /** Called with {width, height, scale} whenever the resolution changes. */
    onResize(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },

    /** Connect the shell's controls to a running console. */
    bind(sys) {
      bound = sys;
      const input = sys.input;
      const wake = () => sys.audio.unlock();

      // --- buttons ---
      const held = new Map(); // pointerId -> button
      const setBtn = (node, name, on) => {
        node.dataset.on = on ? '1' : '0';
        input.setFrom('touch', name, on);
      };

      for (const node of [aBtn, bBtn, startBtn, selectBtn]) {
        const name = node.dataset.btn;
        node.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          wake();
          node.setPointerCapture(e.pointerId);
          held.set(e.pointerId, name);
          setBtn(node, name, true);
        });
        const release = (e) => {
          if (!held.has(e.pointerId)) return;
          held.delete(e.pointerId);
          setBtn(node, name, false);
        };
        node.addEventListener('pointerup', release);
        node.addEventListener('pointercancel', release);
        node.addEventListener('pointerleave', release);
        node.addEventListener('contextmenu', (e) => e.preventDefault());
      }

      // --- d-pad: direction from where the finger sits, diagonals included ---
      const DIRS = ['up', 'down', 'left', 'right'];
      let padPointer = null;
      const applyPad = (e) => {
        const r = dpad.getBoundingClientRect();
        const nx = (e.clientX - r.left) / r.width - 0.5;
        const ny = (e.clientY - r.top) / r.height - 0.5;
        const dead = 0.14;
        const active = new Set();
        if (ny < -dead) active.add('up');
        if (ny > dead) active.add('down');
        if (nx < -dead) active.add('left');
        if (nx > dead) active.add('right');
        // Outside a generous circle, treat it as released.
        if (Math.hypot(nx, ny) > 0.95) active.clear();
        for (const d of DIRS) input.setFrom('touch', d, active.has(d));
        dpad.dataset.dir = [...active].join(' ');
      };
      const clearPad = () => {
        padPointer = null;
        for (const d of DIRS) input.setFrom('touch', d, false);
        dpad.dataset.dir = '';
      };

      dpad.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        wake();
        padPointer = e.pointerId;
        dpad.setPointerCapture(e.pointerId);
        applyPad(e);
      });
      dpad.addEventListener('pointermove', (e) => {
        if (padPointer !== e.pointerId) return;
        e.preventDefault();
        applyPad(e);
      });
      for (const type of ['pointerup', 'pointercancel']) {
        dpad.addEventListener(type, (e) => {
          if (padPointer !== e.pointerId) return;
          clearPad();
        });
      }
      dpad.addEventListener('contextmenu', (e) => e.preventDefault());
      window.addEventListener('blur', clearPad);

      // --- system strip ---
      const paintLook = () => {
        lookBtn.textContent = `SCREEN: ${sys.look.name}`;
        const look = sys.look.shell || {};
        root.style.setProperty('--hh-case', look.case || '#c8c4bc');
        root.style.setProperty('--hh-screen', look.screen || '#8b9440');
        root.style.setProperty('--hh-accent', look.accent || '#7c1c48');
      };
      sys.onLookChange = paintLook;
      paintLook();
      soundBtn.textContent = `SOUND: ${sys.audio.enabled ? 'ON' : 'OFF'}`;

      lookBtn.addEventListener('click', () => {
        wake();
        sys.cycleLook(1);
        paintLook();
      });
      soundBtn.addEventListener('click', () => {
        wake();
        soundBtn.textContent = `SOUND: ${sys.toggleSound() ? 'ON' : 'OFF'}`;
      });
      fullBtn.addEventListener('click', () => {
        wake();
        if (document.fullscreenElement) document.exitFullscreen?.();
        else root.requestFullscreen?.().catch(() => {});
      });

      document.addEventListener('pointerdown', wake, { once: true });
      document.addEventListener('keydown', wake, { once: true });
      scheduleLayout();
    },
  };
}
