// BEACON's simulation: ships, the lamp, the fog and the night's score.
//
// Deliberately free of both the engine and the screen. Everything lives in
// normalized polar space around the rocks - an angle in radians and a radius
// `rho` where 1.0 is the horizon a ship sails in from and `rockRho` is the reef
// it breaks on. The renderer multiplies rho by whatever the console's current
// resolution allows, so a wide screen shows more sea rather than an easier or
// harder game: speeds, ranges and difficulty are identical at 160x128 and
// 320x288, which they would not be if any of this were in pixels.

/** mulberry32: small, fast, and seeded, so a run replays exactly. */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const approach = (v, target, rate) => (v < target ? Math.min(target, v + rate) : Math.max(target, v - rate));

/**
 * The three hulls. `len`/`beam` are pixels at the reference screen and are
 * scaled by the renderer; everything else is in simulation units.
 * `toughness` is how many seconds of full-power light it takes to turn away.
 */
export const SHIP_TYPES = [
  { id: 'sloop', name: 'SLOOP', len: 9, beam: 4, speed: 0.084, toughness: 0.65, score: 60 },
  { id: 'trawler', name: 'TRAWLER', len: 14, beam: 6, speed: 0.063, toughness: 1.2, score: 110 },
  { id: 'tanker', name: 'TANKER', len: 20, beam: 8, speed: 0.045, toughness: 2.1, score: 200 },
];

export const BEAM_LIMIT = 1.63; // radians either side of straight up
const TURN_SLOW = 1.05; // rad/s from a tap
const TURN_FAST = 2.65; // rad/s once the d-pad has been held a moment
const FOCUS_DRAG = 0.42; // a focused lamp is heavier to swing

/** Beam half-angle in radians, wide open (focus 0) to pencil (focus 1). */
export const beamHalf = (focus) => 0.238 - 0.165 * focus;
/** How far the beam carries, in rho. Fog eats the wide beam first. */
export const beamReach = (focus, fog) => (1.16 - 0.44 * fog) * (1 + 0.26 * focus);

const LIVES = 3;
const HORN_COST = 1 / 3;
const HORN_REFILL = 0.155; // full gauge in about 6.5s
const ECHO_TIME = 0.95;
const STALL_TIME = 0.75;

/**
 * One night at the lighthouse.
 *
 * `update(dt, controls)` is the whole game; `drain()` hands back the events the
 * presentation layer needs (sounds, flashes, score popups) so the simulation
 * never has to know that a console exists.
 */
export class World {
  /** @param {number} seed */
  constructor(seed = 1) {
    this.seed = seed >>> 0;
    this.reset();
  }

  reset() {
    this.rand = rng(this.seed);
    this.ships = [];
    this.events = [];
    this.time = 0;
    this.score = 0;
    this.lives = LIVES;
    this.streak = 0;
    this.best = 0; // filled in by the scene from the save
    this.wave = 1;
    this.pending = 0;
    this.spawnTimer = 0;
    this.beam = 0;
    this.beamVel = 0;
    this.held = 0;
    this.focus = 0;
    this.horn = 1;
    this.hornFlash = 0;
    this.fog = 0;
    this.fogTarget = 0;
    this.shake = 0;
    this.rockRho = 0.15; // the renderer overwrites this from its layout
    this.state = 'intro';
    this.stateT = 0;
    this.nextId = 1;
    this.beginWave(1);
  }

  /** Score multiplier from the current streak of ships turned away. */
  get multiplier() {
    return 1 + 0.5 * Math.min(4, Math.floor(this.streak / 3));
  }

  get running() {
    return this.state === 'intro' || this.state === 'running' || this.state === 'clear';
  }

  emit(event) {
    this.events.push(event);
    return event;
  }

  /** Take the events since the last call. */
  drain() {
    const out = this.events;
    this.events = [];
    return out;
  }

  // --- waves ---------------------------------------------------------------

  beginWave(n) {
    this.wave = n;
    this.pending = 2 + Math.round(n * 1.35);
    this.spawnTimer = 0.6;
    this.state = 'intro';
    this.stateT = 0;
    // Two clear nights to learn the lamp on, then the fog starts arriving in
    // banks: a thick wave, then a thinner one, so it never becomes a constant.
    const bank = n < 3 ? 0 : 0.16 * (n - 2) + 0.18 * this.rand();
    this.fogTarget = clamp(n % 4 === 0 ? bank * 0.35 : bank, 0, 0.82);
    this.emit({ type: 'wave', wave: n, fog: this.fogTarget });
  }

  /** Ships get faster, more numerous, and come round the sides as it goes on. */
  waveSpeed() {
    return Math.min(2.15, 1 + 0.085 * (this.wave - 1));
  }

  waveSpread() {
    return Math.min(1.5, 0.52 + 0.105 * (this.wave - 1));
  }

  pickType() {
    const r = this.rand();
    // Early waves are all small craft; the heavy hulls arrive with the fog.
    const tanker = Math.min(0.34, 0.03 * (this.wave - 1));
    const trawler = Math.min(0.5, 0.16 + 0.05 * (this.wave - 1));
    if (r < tanker) return SHIP_TYPES[2];
    if (r < tanker + trawler) return SHIP_TYPES[1];
    return SHIP_TYPES[0];
  }

  spawn() {
    const spread = this.waveSpread();
    const type = this.pickType();
    // Try a few bearings so two ships rarely arrive on top of each other; a
    // stack of hulls at the same angle is one sweep, which is not a game.
    let theta = 0;
    for (let attempt = 0; attempt < 5; attempt++) {
      theta = (this.rand() * 2 - 1) * spread;
      const clash = this.ships.some((s) => Math.abs(s.theta - theta) < 0.22 && s.rho > 0.7);
      if (!clash) break;
    }
    const ship = {
      id: this.nextId++,
      type,
      theta,
      rho: 1,
      speed: type.speed * this.waveSpeed() * (0.9 + 0.2 * this.rand()),
      drift: (this.rand() * 2 - 1) * 0.055, // a little set and leeway, so aim has to be kept
      charge: 0,
      lit: 0,
      echo: 0,
      stall: 0,
      bell: 0.4 + this.rand() * 0.6,
      warned: false,
      turning: 0,
    };
    this.ships.push(ship);
    this.emit({ type: 'arrive', ship });
    return ship;
  }

  // --- the night -----------------------------------------------------------

  /**
   * @param {number} dt fixed 1/60
   * @param {{turn?:number, focus?:boolean, horn?:boolean}} [controls]
   */
  update(dt, controls = {}) {
    if (this.state === 'over') {
      this.shake = Math.max(0, this.shake - dt);
      for (const s of this.ships) s.echo = Math.max(0, s.echo - dt);
      return;
    }

    this.time += dt;
    this.stateT += dt;
    this.shake = Math.max(0, this.shake - dt);
    this.hornFlash = Math.max(0, this.hornFlash - dt);

    this.updateLamp(dt, controls);

    // Fog drifts toward the wave's bank, with a slow swell on top so it is
    // never quite steady. Driven by simulation time, never a clock.
    const wobble = 0.05 * Math.sin(this.time * 0.21) + 0.03 * Math.sin(this.time * 0.53);
    const target = clamp(this.fogTarget + (this.fogTarget > 0.02 ? wobble : 0), 0, 0.88);
    this.fog = approach(this.fog, target, dt * 0.14);

    if (this.state === 'intro' && this.stateT > 1.7) {
      this.state = 'running';
      this.stateT = 0;
    }
    if (this.state === 'running') this.updateSpawning(dt);

    this.updateShips(dt);

    if (this.state === 'running' && this.pending === 0 && this.ships.length === 0) {
      this.state = 'clear';
      this.stateT = 0;
      const bonus = 40 * this.wave + 20 * this.lives;
      this.score += bonus;
      this.emit({ type: 'clear', wave: this.wave, bonus });
    }
    if (this.state === 'clear' && this.stateT > 1.5) this.beginWave(this.wave + 1);
  }

  updateLamp(dt, controls) {
    const turn = clamp(controls.turn || 0, -1, 1);
    this.focus = approach(this.focus, controls.focus ? 1 : 0, dt / 0.11);
    this.held = turn ? this.held + dt : 0;
    // Tap to nudge, hold to sweep: fine aim and fast search off one axis.
    const ramp = Math.min(1, this.held / 0.4);
    const rate = (TURN_SLOW + (TURN_FAST - TURN_SLOW) * ramp) * (1 - FOCUS_DRAG * this.focus);
    this.beamVel = turn * rate;
    this.beam = clamp(this.beam + this.beamVel * dt, -BEAM_LIMIT, BEAM_LIMIT);

    this.horn = Math.min(1, this.horn + HORN_REFILL * dt);
    if (controls.horn && this.horn >= HORN_COST) {
      this.horn -= HORN_COST;
      this.hornFlash = 0.5;
      for (const s of this.ships) {
        s.echo = ECHO_TIME;
        s.stall = STALL_TIME;
      }
      this.emit({ type: 'horn', ships: this.ships.length });
    }
  }

  updateSpawning(dt) {
    if (this.pending <= 0) return;
    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;
    this.spawn();
    this.pending--;
    this.spawnTimer = Math.max(0.75, 2.7 - 0.14 * this.wave) * (0.75 + 0.5 * this.rand());
  }

  updateShips(dt) {
    const half = beamHalf(this.focus);
    const reach = beamReach(this.focus, this.fog);
    const power = 0.86 + 1.05 * this.focus;

    for (let i = this.ships.length - 1; i >= 0; i--) {
      const s = this.ships[i];
      s.echo = Math.max(0, s.echo - dt);
      s.stall = Math.max(0, s.stall - dt);

      // Lighting test in beam space. The tolerance is angular slop for the
      // hull's own width, so a big ship is easier to hold than a small one.
      const d = Math.abs(((s.theta - this.beam + Math.PI) % (2 * Math.PI)) - Math.PI);
      const slop = (0.02 * s.type.beam) / Math.max(0.12, s.rho);
      const inBeam = d <= half + slop && s.rho <= reach;
      s.lit = inBeam ? Math.min(1, s.lit + dt * 8) : Math.max(0, s.lit - dt * 6);

      if (s.turning) {
        s.turning += dt;
        s.rho += s.speed * 1.5 * dt;
        s.theta += s.drift * 0.4 * dt;
        if (s.rho > 1.08) this.ships.splice(i, 1);
        continue;
      }

      if (inBeam) {
        s.charge += ((power * (1 - 0.32 * s.rho)) / s.type.toughness) * dt;
        if (s.charge >= 1) {
          this.turnAway(s);
          continue;
        }
      } else {
        s.charge = Math.max(0, s.charge - 0.2 * dt);
      }

      if (!s.stall) {
        s.rho -= s.speed * dt;
        s.theta = clamp(s.theta + s.drift * dt, -1.58, 1.58);
      }

      // The bell: every hull rings, and rings faster the closer it gets. In
      // thick fog it is the only thing telling you where a ship is.
      s.bell -= dt;
      if (s.bell <= 0) {
        s.bell = 0.42 + 1.5 * Math.max(0, s.rho - this.rockRho);
        this.emit({ type: 'bell', rho: s.rho, theta: s.theta, ship: s });
      }
      if (!s.warned && s.rho < 0.34) {
        s.warned = true;
        this.emit({ type: 'close', ship: s });
      }

      if (s.rho <= this.rockRho) {
        this.ships.splice(i, 1);
        this.wreck(s);
      }
    }
  }

  turnAway(ship) {
    ship.turning = 0.0001;
    ship.charge = 1;
    this.streak++;
    // Catching a ship far out is worth more than scraping it off the reef.
    const points = Math.round((ship.type.score * (0.55 + ship.rho) * this.multiplier) / 10) * 10;
    this.score += points;
    this.emit({ type: 'saved', ship, points, theta: ship.theta, rho: ship.rho });
  }

  wreck(ship) {
    this.streak = 0;
    this.lives--;
    this.shake = 0.45;
    this.emit({ type: 'wreck', ship, theta: ship.theta, lives: this.lives });
    if (this.lives <= 0) {
      this.state = 'over';
      this.stateT = 0;
      this.emit({ type: 'over', score: this.score });
    }
  }
}
