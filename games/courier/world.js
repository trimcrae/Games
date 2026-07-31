// Building a courier's version of one of the three places.
//
// The geography is exactly the Explorer cartridge's: the same OpenStreetMap
// extracts, the same bounding boxes, the same metres per tile, compiled by the
// same engine/geo.js. What differs is what gets pulled out of it. Explorer
// wants a short hand-written list of landmarks with photographs; a courier
// wants an address book - every named building on the map that a parcel could
// plausibly be taken to - and it wants to know, before it hands out a job, that
// the player can actually get there.

import { compileMap, nearestOpen } from '../../engine/geo.js';
import { TILE } from '../../engine/tiles.js';

const ROOT = new URL('../../', import.meta.url);

const cache = new Map();
async function loadJSON(path) {
  if (!cache.has(path)) {
    cache.set(
      path,
      fetch(new URL(path, ROOT)).then((r) => {
        if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
        return r.json();
      }),
    );
  }
  return cache.get(path);
}

// --- reachability ----------------------------------------------------------
//
// The walker's feet box is seven pixels square, which is the largest that fits
// inside one eight-pixel tile, so "can stand centred on this tile" is just
// "this tile is open" and the walkable graph is a four-connected flood over
// open tiles. (tools/playtest.mjs proves that claim against the game's own
// collision code; the same reasoning is what makes this flood trustworthy.)
//
// Diagonals are deliberately left out: a move is resolved one axis at a time,
// so a diagonal squeeze between two solid tiles is not a legal route, and a
// four-connected flood is exactly the set of tiles the player can reach.

const NO_ROUTE = -1;

/**
 * Walking distance in tile steps from one tile to every tile reachable from it.
 * @param {object} map compiled by engine/geo.js
 * @param {number} sx start tile x
 * @param {number} sy start tile y
 * @param {number} [maxSteps] stop expanding past this radius. Greece is
 *   676x1171 tiles; a job never spans more than a few hundred of them, so
 *   capping the flood turns a 25ms full sweep into a couple of milliseconds.
 * @returns {{dist: Int32Array, reached: number}} dist is -1 where unreachable
 */
export function walkField(map, sx, sy, maxSteps = Infinity) {
  const { w, h, solid } = map;
  const dist = new Int32Array(w * h).fill(NO_ROUTE);
  let reached = 0;
  if (sx < 0 || sy < 0 || sx >= w || sy >= h) return { dist, reached };
  const start = sy * w + sx;
  if (solid[start]) return { dist, reached };

  // A plain ring buffer is enough: every edge costs one step, so the queue is
  // already in distance order.
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  dist[start] = 0;

  while (head < tail) {
    const i = queue[head++];
    reached++;
    const d = dist[i] + 1;
    if (d > maxSteps) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0 && !solid[i - 1] && dist[i - 1] === NO_ROUTE) ((dist[i - 1] = d), (queue[tail++] = i - 1));
    if (x < w - 1 && !solid[i + 1] && dist[i + 1] === NO_ROUTE) ((dist[i + 1] = d), (queue[tail++] = i + 1));
    if (y > 0 && !solid[i - w] && dist[i - w] === NO_ROUTE) ((dist[i - w] = d), (queue[tail++] = i - w));
    if (y < h - 1 && !solid[i + w] && dist[i + w] === NO_ROUTE) ((dist[i + w] = d), (queue[tail++] = i + w));
  }
  return { dist, reached };
}

// --- the address book ------------------------------------------------------

/**
 * Tidy an OpenStreetMap name into something the 5x7 font can print.
 * Accents are folded, bracketed building numbers dropped ("Golisano Hall (70)"
 * is signposted as Golisano Hall), and anything left outside ASCII removed -
 * the font would draw it as a row of question marks.
 */
function tidyName(raw) {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // combining marks left by the decomposition
    .replace(/\s*\([^)]*\)\s*/g, ' ')
    .replace(/[\u2010-\u2015]/g, '-') // the several dashes OSM data uses
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[^\x20-\x7e]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

/**
 * Buildings that are one of a numbered set - RIVERKNOLL APARTMENTS 4-16,
 * UNIVERSITY COMMONS 9, RESIDENCE HALL B - collapse to a single entry. A
 * courier run where three of the five jobs are to identical addresses on the
 * same block reads as a bug even when it is the truth.
 */
const familyKey = (name) => name.replace(/\s+([0-9]+([-\/][0-9]+)?|[A-Z])$/, '');

/** Longest name the HUD can print at the console's smallest width. */
const MAX_NAME = 22;

/** Smallest footprint worth a delivery, in square tiles. */
const MIN_AREA = 6;

/**
 * Every named building on the map, as somewhere a parcel can be taken.
 *
 * A depot is only kept if it survives all four of these, because a job to a
 * building that fails any of them is a job the player cannot finish:
 *   - it has a printable name that fits the screen;
 *   - its footprint is big enough to be a building rather than a shed;
 *   - there is open ground within a few tiles of its centroid to stand on;
 *   - that ground is in the same connected region as the spawn.
 *
 * @param {object} map compiled map
 * @param {Array} features the raw OSM features the map was compiled from
 * @param {Uint8Array|Int32Array} reach walkField dist from the spawn
 * @returns {Array<{id:string,name:string,tx:number,ty:number,x:number,y:number,area:number}>}
 */
export function findDepots(map, features, reach) {
  const best = new Map();

  for (const f of features) {
    if (f.kind !== 'building' || !f.name || !f.ring || f.ring.length < 3) continue;
    const name = tidyName(f.name);
    if (!name || name.length > MAX_NAME) continue;

    // Centroid and area by the shoelace formula, in tile space, so the area
    // threshold means the same thing on a 6 m/tile campus and a 12 m/tile town.
    const pts = f.ring.map(([lat, lon]) => map.proj.toTile(lat, lon));
    let twice = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const cross = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
      twice += cross;
      cx += (pts[j][0] + pts[i][0]) * cross;
      cy += (pts[j][1] + pts[i][1]) * cross;
    }
    if (Math.abs(twice) < 1e-9) continue;
    const area = Math.abs(twice / 2);
    if (area < MIN_AREA) continue;
    cx /= 3 * twice;
    cy /= 3 * twice;
    if (cx < 1 || cy < 1 || cx >= map.w - 1 || cy >= map.h - 1) continue;

    const key = familyKey(name);
    const prev = best.get(key);
    if (prev && prev.area >= area) continue;
    best.set(key, { name, cx, cy, area });
  }

  const depots = [];
  const usedIds = new Set();
  for (const d of best.values()) {
    // The door: the nearest open tile to the centroid. Eight tiles is roughly
    // fifty metres on a campus - far enough to step off a big footprint, close
    // enough that the marker is still obviously that building.
    const open = nearestOpen(map, d.cx, d.cy, 8);
    if (!open) continue;
    if (reach[open[1] * map.w + open[0]] < 0) continue;

    let id = d.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    while (usedIds.has(id)) id += '-x';
    usedIds.add(id);
    depots.push({
      id,
      name: d.name,
      area: d.area,
      tx: open[0],
      ty: open[1],
      x: open[0] * TILE + TILE / 2,
      y: open[1] * TILE + TILE / 2,
    });
  }
  // Biggest first, so a shortlist of the map's landmark buildings is just the
  // head of the array - which is what the job board shows.
  depots.sort((a, b) => b.area - a.area);
  return depots;
}

/**
 * Compile a place and work out everywhere a parcel can go in it.
 *
 * Deliberately not games/explorer/main.js's `buildLevel`: that one throws the
 * source features away once the map is baked, and this game needs the building
 * names that are in them. It also hangs landmark posts, travel hubs and bike
 * racks off the map, none of which a courier run uses.
 *
 * @param {object} level an entry from games/explorer/levels.js
 * @returns {Promise<{map: object, depots: Array, spawn: {x:number,y:number}}>}
 */
export async function buildRound(level) {
  const doc = await loadJSON(level.data);
  const map = compileMap({
    id: level.id,
    name: level.name,
    subtitle: level.subtitle,
    bbox: level.bbox || doc.bbox,
    metersPerTile: level.metersPerTile,
    features: doc.features,
    start: level.start,
    walkSpeed: level.walkSpeed,
    buildingSlot: level.buildingSlot,
    attribution: doc.source,
  });

  const startTile = nearestOpen(map, map.start ? map.start.x / TILE : map.w / 2, map.start ? map.start.y / TILE : map.h / 2, 80);
  const [sx, sy] = startTile || [Math.round(map.w / 2), Math.round(map.h / 2)];
  const { dist } = walkField(map, sx, sy);

  const depots = findDepots(map, doc.features, dist);
  if (depots.length < 4) throw new Error(`${level.id}: only ${depots.length} reachable addresses`);

  map.depots = depots;
  return { map, depots, spawn: { x: sx * TILE + TILE / 2, y: sy * TILE + TILE / 2 } };
}

/** World pixels -> metres on this map, for the distance readout. */
export const metresOf = (map, pixels) => (pixels / TILE) * map.metersPerTile;
