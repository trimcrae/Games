// Dispatch: what to collect, where to take it, and how long you get.
//
// Every job is planned against the real walkable map rather than against
// straight lines, because the three places punish straight lines. Greece has a
// chain of ponds down its middle and a motorway across it; a delivery two
// hundred metres away as the gull flies can be a kilometre of pedalling round
// the water. Planning on a flood fill from the pickup means the clock is set
// from the route the player actually has to ride, and - more importantly - a
// job is only ever offered between two addresses that are genuinely joined.

import { TILE } from '../../engine/tiles.js';
import { walkField } from './world.js';

/**
 * The ladder. `at` is deliveries completed; a run's rank is the last one
 * reached, so it only ever goes up during a shift.
 */
export const RANKS = [
  { at: 0, name: 'TRAINEE' },
  { at: 3, name: 'RUNNER' },
  { at: 7, name: 'COURIER' },
  { at: 12, name: 'DISPATCHER' },
  { at: 18, name: 'ROAD ACE' },
  { at: 26, name: 'LEGEND' },
];

/** The rank held after `delivered` deliveries. */
export function rankFor(delivered) {
  let rank = RANKS[0];
  for (const r of RANKS) if (delivered >= r.at) rank = r;
  return rank;
}

/** True when this delivery is the one that promotes you. */
export const isPromotion = (delivered) => RANKS.some((r) => r.at === delivered && r.at > 0);

// How fast the dispatcher assumes you travel, as a multiple of the level's own
// walking speed. Top speed on the bike on tarmac is 2.9x, and the route length
// comes off a four-connected flood that cannot count a diagonal, so it already
// overstates the distance by up to two fifths; 2.2x is what is left over for
// junctions, kerbs, spinning up from a standing start, and going the wrong way
// round a building once.
//
// These three numbers are the difficulty. They were set by running a bot that
// steers downhill on a flood field from the target - a worse rider than a
// person, since it re-aims from tile centres and never cuts a corner - and
// tuning until it ran out of time somewhere between six and nineteen
// deliveries on the three maps. Loosen them and the shift never ends.
const ASSUMED_PACE = 2.2;

/** Seconds added on top of every allowance, so a very short hop is not a trap. */
const BASE_SECONDS = 5;

/** The clock tightens as the shift goes on; this is as tight as it gets. */
const MIN_TIGHTNESS = 0.55;

/** Distance bands for a job, in tile steps, widened until something fits. */
const PICKUP_BAND = [5, 90];
const LEG_BAND = [28, 150];

/** mulberry32: small, fast, reproducible - a seed replays a whole shift. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick one depot whose walking distance falls in [lo, hi], widening the band
 * until something does. Returns null only when nothing on the map is reachable
 * at all, which findDepots has already made impossible.
 */
function pickInBand(depots, dist, mapW, lo, hi, reject, rng) {
  for (let attempt = 0; attempt < 7; attempt++) {
    const pool = [];
    for (const d of depots) {
      if (reject(d)) continue;
      const steps = dist[d.ty * mapW + d.tx];
      if (steps < 0 || steps < lo || steps > hi) continue;
      pool.push({ depot: d, steps });
    }
    if (pool.length) return pool[Math.floor(rng() * pool.length)];
    lo = Math.max(0, Math.floor(lo * 0.5));
    hi = Math.ceil(hi * 1.7);
  }
  return null;
}

/**
 * The job queue for one shift.
 *
 * One job is always in hand and one is always waiting behind it, which is what
 * the board shows. Planning the next one the moment the current one is issued
 * also puts the two flood fills it costs at the start of a job rather than at
 * the instant of a delivery, where a hitch would be felt.
 */
export class Dispatcher {
  /**
   * @param {object} map compiled map
   * @param {Array} depots from findDepots
   * @param {number} [seed]
   */
  constructor(map, depots, seed = (Math.random() * 0xffffffff) >>> 0) {
    this.map = map;
    this.depots = depots;
    this.rng = prng(seed);
    this.seed = seed;
    this.issued = 0;
    this.delivered = 0;
    this.current = null;
    this.next = null;
    this.recent = [];
  }

  /** Keep the last few addresses out of the pool, so a shift has variety. */
  remember(depot) {
    this.recent.push(depot.id);
    while (this.recent.length > Math.min(6, Math.floor(this.depots.length / 2))) this.recent.shift();
  }

  used(depot) {
    return this.recent.includes(depot.id);
  }

  /**
   * Plan a job for someone standing at (x, y).
   * @returns {object|null} null only if the position is walled in
   */
  plan(x, y) {
    const tx = Math.floor(x / TILE);
    const ty = Math.floor(y / TILE);
    const cap = PICKUP_BAND[1] * 6;
    const here = walkField(this.map, tx, ty, cap).dist;
    const from = pickInBand(this.depots, here, this.map.w, PICKUP_BAND[0], PICKUP_BAND[1], (d) => this.used(d), this.rng);
    if (!from) return null;

    const legCap = LEG_BAND[1] * 6;
    const out = walkField(this.map, from.depot.tx, from.depot.ty, legCap).dist;
    const to = pickInBand(
      this.depots,
      out,
      this.map.w,
      LEG_BAND[0],
      LEG_BAND[1],
      (d) => d.id === from.depot.id || this.used(d),
      this.rng,
    );
    if (!to) return null;

    this.remember(from.depot);
    this.remember(to.depot);

    const routePx = (from.steps + to.steps) * TILE;
    const tightness = Math.max(MIN_TIGHTNESS, 1 - 0.05 * this.issued);
    const allowance = Math.round(((routePx / (this.map.walkSpeed * ASSUMED_PACE)) * tightness + BASE_SECONDS) * 10) / 10;

    this.issued++;
    return {
      n: this.issued,
      pickup: from.depot,
      drop: to.depot,
      toPickupPx: from.steps * TILE,
      legPx: to.steps * TILE,
      routePx,
      allowance,
      // Paid by the length of the round trip, rounded to something a scoreboard
      // can print: long jobs are worth taking, short ones keep the clock alive.
      fee: Math.round((20 + routePx / 12) / 5) * 5,
      collected: false,
    };
  }

  /** Fill both slots for a shift that starts at (x, y). */
  start(x, y) {
    this.current = this.plan(x, y);
    if (this.current) this.next = this.plan(this.current.drop.x, this.current.drop.y);
    return this.current;
  }

  /**
   * Bank the current job and promote the queued one.
   * @returns {object|null} the new current job
   */
  advance() {
    this.delivered++;
    this.current = this.next;
    if (this.current) this.next = this.plan(this.current.drop.x, this.current.drop.y);
    return this.current;
  }

  /** Where the player is being sent right now. */
  get target() {
    if (!this.current) return null;
    return this.current.collected ? this.current.drop : this.current.pickup;
  }

  get rank() {
    return rankFor(this.delivered);
  }
}
