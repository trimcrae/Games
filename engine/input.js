// Button state for the eight controls, fed by touch, keyboard and gamepads.
//
// Games only ever ask questions like `input.pressed('a')`; where the press came
// from is the shell's problem.

export const BUTTONS = ['up', 'down', 'left', 'right', 'a', 'b', 'start', 'select'];

const KEYMAP = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
  KeyZ: 'a',
  KeyX: 'b',
  KeyJ: 'a',
  KeyK: 'b',
  Space: 'a',
  Enter: 'start',
  ShiftLeft: 'select',
  ShiftRight: 'select',
  Backspace: 'b',
  Escape: 'start',
};

/** Standard-gamepad button and axis mapping. */
const PAD_BUTTONS = { 0: 'a', 1: 'b', 2: 'b', 3: 'a', 8: 'select', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

export class Input {
  constructor() {
    this.down = new Set();
    this.prev = new Set();
    this.held = new Map(); // button -> seconds held, for key repeat
    this.sources = { touch: new Set(), key: new Set(), pad: new Set() };
    // A press that arrives and releases inside a single frame would otherwise
    // never be observed by poll() at all. Latching it means a quick tap - which
    // is how people actually use a touchscreen - always registers.
    this.latched = new Set();
    this.anyPressSincePoll = false;
  }

  /** Set or clear a button from one source; sources are OR'd together. */
  setFrom(source, button, isDown) {
    if (!BUTTONS.includes(button)) return;
    const set = this.sources[source];
    if (!set) return;
    if (isDown) {
      if (!set.has(button)) this.anyPressSincePoll = true;
      set.add(button);
      this.latched.add(button);
    } else {
      set.delete(button);
    }
  }

  clearSource(source) {
    this.sources[source]?.clear();
  }

  /** Drop everything, including latched presses. Used when focus is lost. */
  reset() {
    for (const set of Object.values(this.sources)) set.clear();
    this.latched.clear();
  }

  /** Called once per frame, before the scene updates. */
  poll(dt) {
    this.lastDt = dt;
    this.prev = new Set(this.down);
    this.down = new Set();
    for (const set of Object.values(this.sources)) for (const b of set) this.down.add(b);
    // Presses that came and went since the last poll still count for one frame.
    for (const b of this.latched) this.down.add(b);
    this.latched.clear();

    for (const b of BUTTONS) {
      if (this.down.has(b)) this.held.set(b, (this.held.get(b) || 0) + dt);
      else this.held.delete(b);
    }
  }

  isDown(b) {
    return this.down.has(b);
  }

  /** True on the frame the button went down. */
  pressed(b) {
    return this.down.has(b) && !this.prev.has(b);
  }

  released(b) {
    return !this.down.has(b) && this.prev.has(b);
  }

  /**
   * Press, then auto-repeat: how menus feel when a direction is held.
   * @param {number} [delay=0.35] seconds before the first repeat
   * @param {number} [rate=0.11] seconds between repeats
   */
  repeated(b, delay = 0.35, rate = 0.11) {
    if (this.pressed(b)) return true;
    const t = this.held.get(b);
    if (t === undefined || t < delay) return false;
    const since = t - delay;
    return Math.floor(since / rate) !== Math.floor((since - this.lastDt) / rate);
  }

  /** -1, 0 or 1 on each axis. */
  axis() {
    return [
      (this.isDown('right') ? 1 : 0) - (this.isDown('left') ? 1 : 0),
      (this.isDown('down') ? 1 : 0) - (this.isDown('up') ? 1 : 0),
    ];
  }

  anyPressed() {
    return BUTTONS.some((b) => this.pressed(b));
  }
}

/** Wire keyboard events into an Input. Returns a teardown function. */
export function attachKeyboard(input, target = window) {
  const onDown = (e) => {
    const b = KEYMAP[e.code];
    if (!b) return;
    e.preventDefault();
    if (!e.repeat) input.setFrom('key', b, true);
  };
  const onUp = (e) => {
    const b = KEYMAP[e.code];
    if (!b) return;
    e.preventDefault();
    input.setFrom('key', b, false);
  };
  const onBlur = () => input.clearSource('key');
  target.addEventListener('keydown', onDown);
  target.addEventListener('keyup', onUp);
  target.addEventListener('blur', onBlur);
  return () => {
    target.removeEventListener('keydown', onDown);
    target.removeEventListener('keyup', onUp);
    target.removeEventListener('blur', onBlur);
  };
}

/** Read connected gamepads into an Input. Call once per frame. */
export function pollGamepads(input) {
  if (typeof navigator === 'undefined' || !navigator.getGamepads) return;
  const pads = navigator.getGamepads();
  let sawPad = false;
  const pressed = new Set();
  for (const pad of pads) {
    if (!pad) continue;
    sawPad = true;
    for (const [idx, name] of Object.entries(PAD_BUTTONS)) {
      if (pad.buttons[idx]?.pressed) pressed.add(name);
    }
    const [ax = 0, ay = 0] = pad.axes;
    if (ax < -0.4) pressed.add('left');
    if (ax > 0.4) pressed.add('right');
    if (ay < -0.4) pressed.add('up');
    if (ay > 0.4) pressed.add('down');
  }
  if (!sawPad) return;
  for (const b of BUTTONS) input.setFrom('pad', b, pressed.has(b));
}
