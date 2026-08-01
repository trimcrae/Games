// Geo -> tilemap compiler.
//
// Takes real-world features ([lat,lon] rings and polylines, whether fetched from
// OpenStreetMap or hand-authored) and rasterizes them into a tile grid with
// per-tile palette slots and collision. Any game can use it; the Explorer
// cartridge is just the first caller.
//
// DOM-free so tools/validate.mjs can compile every map under Node in CI.

import { SLOT } from './gfx.js';
import { T, TILE, N, E, S, W, variant, tileHash, patchHash } from './tiles.js';
import { M_PER_DEG_LAT, mPerDegLon } from './osm.js';

// --- materials -------------------------------------------------------------
//
// `group` drives edge detection: a tile is edged against any neighbour in a
// different group. `pick` chooses the tile art for a cell.
//
// Ground cover is picked from low-frequency noise rather than per-tile noise:
// `patchHash` is constant over a five-tile block and interpolated between
// blocks, and a small per-tile jitter is added to the threshold so the boundary
// between two tones frays instead of drawing a contour line. The result is a
// field that drifts in tone at the scale you actually see it, instead of a
// uniform slab with confetti on it.
const tone = (x, y, size) => patchHash(x, y, size) + (tileHash(x, y) - 0.5) * 0.14;

const grass = (x, y) => {
  const p = tone(x, y, 6);
  if (p < 0.36) return T.grassDeep;
  if (p > 0.68) return T.grassPale;
  return tileHash(x, y) > 0.9 ? T.grassTuft : T.grass;
};

// Mown lawn: broad alternating stripes, the way a groundsman leaves it. The
// phase is global, so neighbouring lawns line up and the campus reads as kept.
const mown = (x, y) => (Math.floor(y / 2) % 2 === 0 ? T.lawn : T.lawnStripe);

export const MATERIALS = [
  { name: 'grass', slot: SLOT.LAND, pick: grass },
  { name: 'park', slot: SLOT.TURF, pick: mown },
  {
    name: 'pitch',
    slot: SLOT.TURF,
    pick: (x, y) => (y % 8 === 0 ? T.pitchLine : Math.floor(y / 2) % 2 === 0 ? T.pitch : T.pitchStripe),
  },
  { name: 'meadow', slot: SLOT.LAND, pick: (x, y) => (tone(x, y, 5) > 0.6 ? T.meadowFlower : T.meadow) },
  { name: 'farm', slot: SLOT.LAND, pick: () => T.farm },
  {
    name: 'forest',
    slot: SLOT.TREE,
    group: 'wood',
    edge: 'canopy',
    pick: () => T.canopy,
    // A wood is drawn as one lit mass with individual crowns laid over it; the
    // crowns sit exactly where the collision is, so what blocks you is what you
    // can see.
    solidIf: (x, y) => tileHash(x, y) > 0.62,
    over: (x, y) => (tileHash(x, y) > 0.62 ? variant(['crown0', 'crown1', 'crown2'], x * 3, y) : 0),
  },
  { name: 'sand', slot: SLOT.SAND, pick: () => T.sand },
  { name: 'marsh', slot: SLOT.WATER, darkGround: true, pick: () => T.marsh, solid: true },
  {
    name: 'water',
    slot: SLOT.WATER,
    group: 'water',
    edge: 'water',
    darkGround: true,
    solid: true,
    pick: (x, y) => (tone(x, y, 5) > 0.58 ? T.waterRipple : T.waterCalm),
  },
  {
    name: 'waterDeep',
    slot: SLOT.WATER,
    group: 'water',
    edge: 'waterDeep',
    darkGround: true,
    solid: true,
    pick: (x, y) => (tone(x, y, 5) > 0.58 ? T.deepRipple : T.deepCalm),
  },
  { name: 'path', slot: SLOT.ROAD, group: 'walk', edge: 'path', pick: () => T.path },
  { name: 'plaza', slot: SLOT.ROAD, group: 'walk', edge: 'plaza', pick: () => T.plaza },
  { name: 'road', slot: SLOT.ROAD, darkGround: true, pick: (x, y) => (tone(x, y, 4) > 0.62 ? T.roadGrit : T.road) },
  { name: 'parking', slot: SLOT.ROAD, darkGround: true, pick: (x, y) => (x % 4 === 0 ? T.parkingLine : T.parking) },
  { name: 'rail', slot: SLOT.ROAD, darkGround: true, pick: () => T.rail },
  { name: 'steps', slot: SLOT.ROAD, pick: () => T.steps },
  // Buildings do not use `pick`/`edge` the way other materials do - they are
  // baked in three-quarter view below. `edge` is kept so validate.mjs still
  // guards the roof family, and `pick` is the flat fallback.
  { name: 'building', slot: SLOT.ROOF, group: 'building', edge: 'roof', solid: true, pick: () => T.roof },
  {
    name: 'buildingTall',
    slot: SLOT.ROOF,
    group: 'building',
    edge: 'roof',
    tall: true,
    solid: true,
    pick: () => T.roof,
  },
  { name: 'hedge', slot: SLOT.TREE, solid: true, pick: () => T.hedge },
  { name: 'fence', slot: SLOT.LAND, solid: true, pick: () => T.fence },
];

export const MAT = Object.create(null);
MATERIALS.forEach((m, i) => {
  m.id = i;
  MAT[m.name] = i;
});

// --- projection ------------------------------------------------------------

export function makeProjection(originLat, originLon, metersPerTile, w, h) {
  const kx = mPerDegLon(originLat);
  const ky = M_PER_DEG_LAT;
  const cx = w / 2;
  const cy = h / 2;
  return {
    /** [lat,lon] -> fractional tile coordinates */
    toTile(lat, lon) {
      return [cx + ((lon - originLon) * kx) / metersPerTile, cy - ((lat - originLat) * ky) / metersPerTile];
    },
    /** fractional tile coordinates -> [lat,lon] */
    toLatLon(tx, ty) {
      return [originLat - ((ty - cy) * metersPerTile) / ky, originLon + ((tx - cx) * metersPerTile) / kx];
    },
  };
}

// --- rasterization ---------------------------------------------------------

function fillPolygon(pts, w, h, plot) {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p[1] < minY) minY = p[1];
    if (p[1] > maxY) maxY = p[1];
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  const xs = [];
  for (let y = y0; y <= y1; y++) {
    xs.length = 0;
    const cy = y + 0.5;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [xi, yi] = pts[i];
      const [xj, yj] = pts[j];
      if (yi <= cy ? yj > cy : yj <= cy) xs.push(xi + ((cy - yi) / (yj - yi)) * (xj - xi));
    }
    if (!xs.length) continue;
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.round(xs[k]));
      const bx = Math.min(w - 1, Math.round(xs[k + 1]) - 1);
      for (let x = a; x <= bx; x++) plot(x, y);
    }
  }
}

function strokePolyline(pts, halfWidth, w, h, plot) {
  const r = Math.max(0.5, halfWidth);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const x0 = Math.max(0, Math.floor(Math.min(ax, bx) - r));
    const x1 = Math.min(w - 1, Math.ceil(Math.max(ax, bx) + r));
    const y0 = Math.max(0, Math.floor(Math.min(ay, by) - r));
    const y1 = Math.min(h - 1, Math.ceil(Math.max(ay, by) + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const px = x + 0.5 - ax;
        const py = y + 0.5 - ay;
        let t = len2 ? (px * dx + py * dy) / len2 : 0;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        const ex = px - t * dx;
        const ey = py - t * dy;
        if (ex * ex + ey * ey <= r * r) plot(x, y);
      }
    }
  }
}

/**
 * Shoelace centroid and area of a closed ring, in whatever units the points
 * are in. Returns null for a degenerate ring - a sliver whose vertices are
 * collinear has no meaningful centre, and dividing by its area would give one
 * anyway, somewhere off the map.
 * @param {Array<[number,number]>} pts
 * @returns {{x:number, y:number, area:number}|null}
 */
function ringCentroid(pts) {
  let twice = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const cross = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    twice += cross;
    cx += (pts[j][0] + pts[i][0]) * cross;
    cy += (pts[j][1] + pts[i][1]) * cross;
  }
  if (Math.abs(twice) < 1e-9) return null;
  return { x: cx / (3 * twice), y: cy / (3 * twice), area: Math.abs(twice / 2) };
}

/** Walk the centreline of a linear feature, marking orientation for lane dashes. */
function markCentreline(pts, w, h, mark) {
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const steps = Math.ceil(Math.max(Math.abs(bx - ax), Math.abs(by - ay)) * 2);
    const horizontal = Math.abs(bx - ax) >= Math.abs(by - ay);
    for (let s = 0; s <= steps; s++) {
      const t = steps ? s / steps : 0;
      const x = Math.round(ax + (bx - ax) * t - 0.5);
      const y = Math.round(ay + (by - ay) * t - 0.5);
      if (x >= 0 && y >= 0 && x < w && y < h) mark(x, y, horizontal);
    }
  }
}

// --- compile ---------------------------------------------------------------

/**
 * @param {object} def
 * @param {string} def.id
 * @param {string} def.name
 * @param {[number,number,number,number]} [def.bbox] [south, west, north, east]
 * @param {[number,number]} [def.origin] map centre if no bbox
 * @param {number} def.metersPerTile
 * @param {number} [def.width] tiles, derived from bbox when omitted
 * @param {number} [def.height]
 * @param {string} [def.base='grass'] background material
 * @param {Array} def.features
 * @param {Array} [def.pois]
 * @param {[number,number]} [def.start] spawn point [lat,lon]
 * @param {number} [def.buildingSlot] palette slot for roofs, so a brick campus
 *   and a sandstone one do not come out the same colour
 */
export function compileMap(def) {
  const mpt = def.metersPerTile;
  let { width, height } = def;
  let originLat;
  let originLon;

  if (def.bbox) {
    const [south, west, north, east] = def.bbox;
    originLat = (south + north) / 2;
    originLon = (west + east) / 2;
    width = width || Math.ceil(((east - west) * mPerDegLon(originLat)) / mpt);
    height = height || Math.ceil(((north - south) * M_PER_DEG_LAT) / mpt);
  } else {
    [originLat, originLon] = def.origin;
  }
  if (!width || !height) throw new Error(`map "${def.id}" has no size`);

  const proj = makeProjection(originLat, originLon, mpt, width, height);
  const n = width * height;
  const mat = new Uint8Array(n).fill(MAT[def.base || 'grass']);
  const dash = new Uint8Array(n); // 0 none, 1 horizontal, 2 vertical
  const skipped = new Map();

  const toTiles = (coords) => coords.map(([la, lo]) => proj.toTile(la, lo));

  for (const f of def.features || []) {
    let matId = MAT[f.kind];
    if (f.kind === 'building' && f.levels >= 4) matId = MAT.buildingTall;
    if (matId === undefined) {
      skipped.set(f.kind, (skipped.get(f.kind) || 0) + 1);
      continue;
    }
    const plot = (x, y) => {
      mat[y * width + x] = matId;
    };
    if (f.ring) {
      const pts = toTiles(f.ring);
      fillPolygon(pts, width, height, plot);
      // Thin slivers can vanish entirely after rounding; keep their outline.
      strokePolyline(pts, 0.5, width, height, plot);
    } else if (f.line) {
      const pts = toTiles(f.line);
      const halfWidth = (f.width || 6) / mpt / 2;
      strokePolyline(pts, halfWidth, width, height, plot);
      if (f.kind === 'road' && (f.width || 0) >= 11 && mpt <= 10) {
        markCentreline(pts, width, height, (x, y, horizontal) => {
          dash[y * width + x] = horizontal ? 1 : 2;
        });
      }
    }
  }

  // --- bake ---------------------------------------------------------------
  const tiles = new Uint16Array(n);
  const slots = new Uint8Array(n);
  const solid = new Uint8Array(n);
  // Second drawing pass: tile ids with transparent backgrounds laid over the
  // ground tile. 0 means "nothing" (tile 0 is plain grass and is never an
  // overlay). This is what carries tree crowns and cast shadows.
  const over = new Uint16Array(n);
  const overSlot = new Uint8Array(n);

  const groupOf = (i) => MATERIALS[mat[i]].group || '';
  const isBuilding = (i) => groupOf(i) === 'building';

  // --- building relief -----------------------------------------------------
  //
  // Real OSM footprints are huge: one campus building can be 25x20 tiles, and
  // in plan view that is a coloured slab. So find, for every building cell, how
  // far it is from the southern edge of its own footprint, and turn the nearest
  // one to three courses into a *facade* - wall, windows, a door here and
  // there, a hard line where it meets the ground. Everything behind that is
  // roof. A slab becomes a roof with a building front along the bottom, which
  // is what every overhead game of this era actually drew.
  const depth = new Uint8Array(n); // 1 = southernmost course of its range
  const runLen = new Uint8Array(n); // how deep that range is
  // Nothing anybody actually builds is 150 m deep in one span; a quadrangle is
  // ranges around a court, and OSM has merged them into one polygon. So a very
  // deep column is split into ranges of at most this many tiles, each of which
  // gets its own front. The split follows the footprint rather than a global
  // grid, so the fronts step with the building instead of ruling a lattice over
  // it - which is exactly what made the old seam tiles read as wallpaper.
  const maxRange = Math.max(8, Math.round(56 / mpt));
  for (let x = 0; x < width; x++) {
    let y = 0;
    while (y < height) {
      if (!isBuilding(y * width + x)) {
        y++;
        continue;
      }
      let y1 = y;
      while (y1 + 1 < height && isBuilding((y1 + 1) * width + x)) y1++;
      let left = y1 - y + 1;
      let ranges = Math.ceil(left / maxRange);
      let yy = y1;
      while (ranges > 0) {
        const len = Math.round(left / ranges);
        for (let k = 0; k < len; k++) {
          const i = (yy - k) * width + x;
          depth[i] = Math.min(255, k + 1);
          runLen[i] = Math.min(255, len);
        }
        yy -= len;
        left -= len;
        ranges--;
      }
      y = y1 + 2; // y1+1 is known not to be a building
    }
  }

  // How tall the wall front is, in tiles. A course is one tile, so this has to
  // be read off the map scale: at 6 m/tile two courses is a plausible four
  // storeys, but at 12 m/tile the same two courses would be a tower block and
  // would eat half of every roof.
  const storeys = Math.max(1, Math.min(2, Math.round(12 / mpt)));

  /** How many courses of facade a footprint this deep can carry. */
  const facadeCourses = (len, tall) =>
    Math.min(storeys + (tall ? 1 : 0), len <= 2 ? 1 : len <= 4 ? 2 : 3);

  /** Is this cell part of a wall front rather than a roof? */
  const isFacade = (i) =>
    isBuilding(i) && depth[i] <= facadeCourses(runLen[i], MATERIALS[mat[i]].tall);

  function bakeBuilding(x, y, i, m) {
    const d = depth[i];
    const courses = facadeCourses(runLen[i], m.tall);
    // Facades only ever butt up against neighbours to left and right; their top
    // and bottom edges are drawn into the art itself.
    let mask = 0;
    if (x === width - 1 || !isBuilding(i + 1)) mask |= E;
    if (x === 0 || !isBuilding(i - 1)) mask |= W;

    if (d <= courses) {
      const door = tileHash(x * 5 + 11, y * 3 + 7) > 0.9;
      if (courses === 1) return T[`${door ? 'wallOneDoor' : 'wallOne'}@${mask}`];
      if (d === 1) return T[`${door ? 'wallDoor' : 'wallLo'}@${mask}`];
      if (d === courses) return T[`wallHi@${mask}`];
      return T[`wallMid@${mask}`];
    }

    if (y === 0 || !isBuilding(i - width)) mask |= N;
    if (y === height - 1 || !isBuilding(i + width)) mask |= S;
    // The course resting on the wall head falls into the eaves shadow. Between
    // that and the ridge the roof is flat on purpose: a texture at tile pitch
    // is exactly what made this read as wallpaper before.
    if (d === courses + 1) return T[`roofEave@${mask}`];
    // Top course of a range that has another range standing behind it: it lies
    // in that range's shadow. Where the top course is the skyline instead, the
    // north rim of the edge tile already gives it its highlight.
    if (runLen[i] === d && !(mask & N) && isFacade(i - width)) return T[`roofBack@${mask}`];
    if (mask === 0) {
      // Rooftop plant, sparsely, so a big roof has something on it that a
      // repeating texture cannot give you.
      const r = tileHash(x * 7 + 3, y * 11 + 5);
      if (r > 0.988) return T.roofPlant;
      if (r > 0.976) return T.roofVent;
      if (r > 0.966) return T.roofLight;
    }
    const p = tone(x, y, 7);
    return T[`${p < 0.38 ? 'roofWeather' : p > 0.7 ? 'roofPale' : 'roof'}@${mask}`];
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const m = MATERIALS[mat[i]];
      slots[i] = m.group === 'building' && def.buildingSlot !== undefined ? def.buildingSlot : m.slot;
      solid[i] = m.solid ? 1 : m.solidIf && m.solidIf(x, y) ? 1 : 0;

      if (m.group === 'building') {
        tiles[i] = bakeBuilding(x, y, i, m);
      } else if (m.edge) {
        const g = m.group;
        let mask = 0;
        if (y === 0 || groupOf(i - width) !== g) mask |= N;
        if (x === width - 1 || groupOf(i + 1) !== g) mask |= E;
        if (y === height - 1 || groupOf(i + width) !== g) mask |= S;
        if (x === 0 || groupOf(i - 1) !== g) mask |= W;
        tiles[i] = mask ? T[`${m.edge}@${mask}`] : m.pick(x, y);
      } else {
        tiles[i] = m.pick(x, y);
      }

      if (m.over) {
        const t = m.over(x, y);
        if (t) {
          over[i] = t;
          overSlot[i] = slots[i];
        }
      }

      if (dash[i] && mat[i] === MAT.road) tiles[i] = dash[i] === 1 ? T.roadDashH : T.roadDashV;
    }
  }

  // --- cast shadows --------------------------------------------------------
  //
  // One light direction for the whole world: north-west. Anything tall drops a
  // dithered shadow onto the open ground to its south and east, drawn in that
  // ground's *own* palette slot at the darkest shade, so a shadow is always a
  // darker version of whatever it falls on - and stays visible on the
  // monochrome looks, where every slot shares one ramp.
  const casts = (i) => {
    const g = groupOf(i);
    return g === 'building' || g === 'wood';
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (over[i] || casts(i)) continue;
      const above = y > 0 && casts(i - width);
      const left = x > 0 && casts(i - 1);
      let name = '';
      if (above && left) name = 'shadowNW';
      else if (above) name = 'shadowN';
      else if (left) name = 'shadowW';
      else if (x > 0 && y > 0 && casts(i - width - 1)) name = 'shadowDiag';
      if (!name) continue;
      over[i] = T[MATERIALS[mat[i]].darkGround ? `${name}Dark` : name];
      overSlot[i] = slots[i];
    }
  }

  // --- named places --------------------------------------------------------
  //
  // Rasterizing throws the features away, and with them every name OSM knew:
  // once a footprint is a run of roof tiles there is nothing left to say it was
  // Wallace Library. A game that wants an address book - somewhere to deliver
  // to, something to label - would otherwise have to re-read the source
  // document and re-project the rings it just handed us. So the names are kept
  // here, while the projected rings are still to hand, as an index of centroids
  // in tile space.
  //
  // Rings only: a centroid and an area are what makes a place a place, and a
  // named road has neither. Nothing is filtered by size or by kind, because
  // "big enough to matter" means something different to every caller.
  const places = [];
  for (const f of def.features || []) {
    if (!f.name || !f.ring || f.ring.length < 3) continue;
    const c = ringCentroid(toTiles(f.ring));
    if (!c) continue;
    places.push({ name: f.name, kind: f.kind, tx: c.x, ty: c.y, area: c.area });
  }

  // --- points of interest --------------------------------------------------
  const pois = (def.pois || []).map((poi) => {
    const [tx, ty] = proj.toTile(poi.at[0], poi.at[1]);
    return { ...poi, tx, ty, x: tx * TILE, y: ty * TILE };
  });

  let start = null;
  if (def.start) {
    const [sx, sy] = proj.toTile(def.start[0], def.start[1]);
    start = { x: sx * TILE, y: sy * TILE };
  }

  return {
    id: def.id,
    name: def.name,
    subtitle: def.subtitle,
    w: width,
    h: height,
    metersPerTile: mpt,
    origin: [originLat, originLon],
    proj,
    tiles,
    slots,
    solid,
    // Second drawing pass (tree crowns, cast shadows); 0 = nothing to draw.
    over,
    overSlot,
    mat,
    // Every named footprint the features carried: { name, kind, tx, ty, area },
    // centroid and area in tile units, in source order.
    places,
    pois,
    start,
    walkSpeed: def.walkSpeed || 52,
    attribution: def.attribution,
    skipped: [...skipped.entries()],
    solidAt(tx, ty) {
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) return true;
      return solid[ty * width + tx] === 1;
    },
  };
}

// --- reachability ----------------------------------------------------------
//
// "Is there open ground near here" and "can the player get to it" are different
// questions, and only the second one is worth anything. A map compiled from
// real geometry is full of sealed pockets - a quadrangle ringed by its own
// building, the inside of a stadium concourse - and a target dropped in one of
// them looks perfectly fine to every test that only counts open tiles. It once
// shipped a Stanford spawn point sealed inside a 52-tile courtyard.
//
// The walkable graph is a four-connected flood over open tiles. Both halves of
// that are load-bearing:
//   - the walker's feet box is seven pixels square, the largest that fits
//     inside one eight-pixel tile, so "can stand centred on this tile" is
//     exactly "this tile is open". tools/playtest.mjs proves that claim against
//     the game's own collision code on every tile of every map;
//   - a move is resolved one axis at a time, so a diagonal squeeze between two
//     solid tiles is not a legal route and diagonals are left out.

const NO_ROUTE = -1;

/**
 * Walking distance in tile steps from one tile to every tile reachable from it.
 *
 * @param {object} map compiled by compileMap
 * @param {number} tx start tile x
 * @param {number} ty start tile y
 * @param {number} [maxSteps] stop expanding past this radius. Greece is
 *   676x1171 tiles; a caller that only cares about its own neighbourhood turns
 *   a 25ms full sweep into a couple of milliseconds by capping the flood.
 * @returns {{dist: Int32Array, reached: number}} dist is -1 where unreachable
 */
export function walkField(map, tx, ty, maxSteps = Infinity) {
  const { w, h, solid } = map;
  const dist = new Int32Array(w * h).fill(NO_ROUTE);
  let reached = 0;
  const sx = Math.round(tx);
  const sy = Math.round(ty);
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

/** True where `reach` says the player can get to this tile. */
export const reachable = (map, reach, tx, ty) =>
  tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && reach[ty * map.w + tx] !== NO_ROUTE;

/**
 * Find the nearest walkable tile centre to a point, spiralling outward.
 * Used to place the player and to sanity-check POI reachability.
 *
 * @param {object} map compiled by compileMap
 * @param {number} tx
 * @param {number} ty
 * @param {number} [maxRadius] tiles
 * @param {Int32Array} [reach] a `walkField` dist array. With one, the answer is
 *   the nearest open tile the player can actually *get to*, rather than the
 *   nearest one that merely exists - which is the difference between a target
 *   and a target sealed in a courtyard.
 * @returns {[number,number]|null}
 */
export function nearestOpen(map, tx, ty, maxRadius = 40, reach = null) {
  const open = (x, y) => !map.solidAt(x, y) && (!reach || reachable(map, reach, x, y));
  const cx = Math.round(tx);
  const cy = Math.round(ty);
  if (open(cx, cy)) return [cx, cy];
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (open(x, y)) return [x, y];
      }
    }
  }
  return null;
}
