// Builds the physical handheld around the canvas: d-pad, A/B, Start/Select,
// and the system strip. Touch, mouse and pen all arrive as pointer events.

function el(tag, className, html) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (html !== undefined) node.innerHTML = html;
  return node;
}

/**
 * @param {HTMLElement} mount
 * @returns {{root:HTMLElement, canvas:HTMLCanvasElement, bind:(sys)=>void}}
 */
export function buildShell(mount, { title = 'HANDHELD', tagline = 'DOT MATRIX WITH STEREO SOUND' } = {}) {
  const root = el('div', 'hh');

  const deck = el('div', 'hh-deck');
  const top = el('div', 'hh-deck-top', `<span>${tagline}</span>`);
  const power = el('div', 'hh-power', '<i class="hh-led"></i><span>BATTERY</span>');
  top.appendChild(power);

  const screenBox = el('div', 'hh-screen');
  const canvas = document.createElement('canvas');
  canvas.setAttribute('aria-label', 'Game screen');
  screenBox.appendChild(canvas);

  const bottom = el('div', 'hh-deck-bottom', `<span>${title}</span>`);
  deck.append(top, screenBox, bottom);

  const brand = el('div', 'hh-brand', `${title}<small>POCKET</small>`);

  // --- controls ---
  const controls = el('div', 'hh-controls');
  const dpad = el('div', 'hh-dpad');
  dpad.appendChild(el('div', 'hh-dpad-dot'));

  const ab = el('div', 'hh-ab');
  const bBtn = el('button', 'hh-btn hh-round', 'B');
  const aBtn = el('button', 'hh-btn hh-round', 'A');
  bBtn.dataset.btn = 'b';
  aBtn.dataset.btn = 'a';
  ab.append(bBtn, aBtn);

  const menu = el('div', 'hh-menu');
  const selectBtn = el('button', 'hh-btn hh-pill', 'SELECT');
  const startBtn = el('button', 'hh-btn hh-pill', 'START');
  selectBtn.dataset.btn = 'select';
  startBtn.dataset.btn = 'start';
  menu.append(selectBtn, startBtn);

  controls.append(dpad, ab, menu);

  const speaker = el('div', 'hh-speaker', '<i></i>'.repeat(6));

  const sys = el('div', 'hh-sys');
  const lookBtn = el('button', '', 'SCREEN: DMG');
  const soundBtn = el('button', '', 'SOUND: ON');
  const fullBtn = el('button', '', 'FULLSCREEN');
  sys.append(lookBtn, soundBtn, fullBtn);

  root.append(deck, brand, controls, speaker, sys);
  mount.appendChild(root);

  // --- scaling ---
  // Integer scale only: a 160x144 grid stretched to a fractional size shimmers.
  /** Let the screen claim the space the controls do not need. */
  function layout() {
    const shellRect = root.getBoundingClientRect();
    const reserved = controls.getBoundingClientRect().height + brand.getBoundingClientRect().height + sys.getBoundingClientRect().height;
    const available = Math.max(90, shellRect.height - reserved - 60);
    const scale = Math.max(1, Math.floor(Math.min((shellRect.width - 48) / canvas.width, available / canvas.height)));
    canvas.style.width = `${canvas.width * scale}px`;
    canvas.style.height = `${canvas.height * scale}px`;
  }

  return {
    root,
    canvas,
    elements: { deck, screenBox, dpad, lookBtn, soundBtn, fullBtn, power },

    /** Connect the shell's controls to a running console. */
    bind(sys_) {
      const input = sys_.input;
      const wake = () => sys_.audio.unlock();

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
        lookBtn.textContent = `SCREEN: ${sys_.look.name}`;
        const shell = sys_.look.shell || {};
        root.style.setProperty('--hh-case', shell.case || '#c8c4bc');
        root.style.setProperty('--hh-screen', shell.screen || '#8b9440');
        root.style.setProperty('--hh-accent', shell.accent || '#7c1c48');
      };
      sys_.onLookChange = paintLook;
      paintLook();
      soundBtn.textContent = `SOUND: ${sys_.audio.enabled ? 'ON' : 'OFF'}`;

      lookBtn.addEventListener('click', () => {
        wake();
        sys_.cycleLook(1);
        paintLook();
      });
      soundBtn.addEventListener('click', () => {
        wake();
        soundBtn.textContent = `SOUND: ${sys_.toggleSound() ? 'ON' : 'OFF'}`;
      });
      fullBtn.addEventListener('click', () => {
        wake();
        if (document.fullscreenElement) document.exitFullscreen?.();
        else root.requestFullscreen?.().catch(() => {});
      });

      // --- sizing ---
      layout();
      const ro = new ResizeObserver(() => layout());
      ro.observe(root);
      window.addEventListener('orientationchange', () => setTimeout(layout, 120));
      window.addEventListener('resize', layout);
      document.addEventListener('pointerdown', wake, { once: true });
      document.addEventListener('keydown', wake, { once: true });
    },
  };
}
