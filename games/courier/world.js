// Building a courier's version of one of the three places.
//
// The geography is exactly the Explorer cartridge's: the same OpenStreetMap
// extracts, the same bounding boxes, the same metres per tile, compiled by the
// same engine/geo.js. What differs is what gets pulled out of it. Explorer
// wants a short hand-written list of landmarks with photographs; a courier
// wants an address book - every named building on the map that a parcel could
// plausibly be taken to - and it wants to know, before it hands out a job, that
// the player can actually get there.

import { compileMap, nearestOpen, walkField, reachable } from '../../engine/geo.js';
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

// --- the address book ------------------------------------------------------
//
// Reachability used to be a private flood fill in this file, because the engine
// only offered `nearestOpen` - "is there open ground near here", which is not
// the same question as "can the player get to it". It is `walkField` in
// engine/geo.js now, where any cartridge can have it.

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

/** How far from a centroid a door may be, in tiles. */
const DOOR_RADIUS = 8;

/**
 * Every named building on the map, as somewhere a parcel can be taken.
 *
 * The centroids come from `map.places`, which compileMap fills in while it
 * still has the projected rings in hand; this file used to re-load the source
 * document and repeat the shoelace sum itself.
 *
 * A depot is only kept if it survives all four of these, because a job to a
 * building that fails any of them is a job the player cannot finish:
 *   - it has a printable name that fits the screen;
 *   - its footprint is big enough to be a building rather than a shed;
 *   - there is open ground within a few tiles of its centroid to stand on;
 *   - that ground is in the same connected region as the spawn.
 *
 * @param {object} map compiled map
 * @param {Int32Array} reach walkField dist from the spawn
 * @returns {Array<{id:string,name:string,tx:number,ty:number,x:number,y:number,area:number}>}
 */
export function findDepots(map, reach) {
  const best = new Map();

  for (const place of map.places) {
    if (place.kind !== 'building') continue;
    const name = tidyName(place.name);
    if (!name || name.length > MAX_NAME) continue;
    // Some footprints are named for their street number and nothing else -
    // Greece has a "10-20". "TAKE IT TO 10-20" is not an instruction.
    if (!/[A-Z]{3}/.test(name)) continue;

    // Areas are in tile units, so the threshold means the same thing on a
    // 6 m/tile campus and a 12 m/tile town.
    const { tx: cx, ty: cy, area } = place;
    if (area < MIN_AREA) continue;
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
    //
    // Deliberately not `nearestOpen(map, cx, cy, DOOR_RADIUS, reach)`, which
    // the engine now supports: asking for the nearest *reachable* tile finds
    // doors for another 38 buildings across the three maps, all of them
    // genuinely deliverable-to, and so quietly changes which jobs the
    // dispatcher hands out. That is a content decision, not a refactor.
    const open = nearestOpen(map, d.cx, d.cy, DOOR_RADIUS);
    if (!open) continue;
    if (!reachable(map, reach, open[0], open[1])) continue;

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
 * Deliberately not games/explorer/main.js's `buildLevel`, which hangs landmark
 * posts, travel hubs and bike racks off the map, none of which a courier run
 * uses.
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

  const depots = findDepots(map, dist);
  if (depots.length < 4) throw new Error(`${level.id}: only ${depots.length} reachable addresses`);

  map.depots = depots;
  return { map, depots, spawn: { x: sx * TILE + TILE / 2, y: sy * TILE + TILE / 2 } };
}

/** World pixels -> metres on this map, for the distance readout. */
export const metresOf = (map, pixels) => (pixels / TILE) * map.metersPerTile;
