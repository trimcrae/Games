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
  { name: 'marsh', slot: SLOT.WATER, pick: () => T.marsh, solid: true },
  { name: 'water', slot: SLOT.WATER, group: 'water', edge: 'water', solid: true, pick: () => T.water },
  { name: 'waterDeep', slot: SLOT.WATER, group: 'water', edge: 'waterDeep', solid: true, pick: () => T.waterDeep },
  { name: 'path', slot: SLOT.ROAD, group: 'walk', edge: 'path', pick: () => T.path },
  { name: 'plaza', slot: SLOT.ROAD, group: 'walk', edge: 'plaza', pick: () => T.plaza },
  { name: 'road', slot: SLOT.ROAD, pick: (x, y) => (tone(x, y, 4) > 0.62 ? T.roadGrit : T.road) },
  { name: 'parking', slot: SLOT.ROAD, pick: (x, y) => (x % 4 === 0 ? T.parkingLine : T.parking) },
  { name: 'rail', slot: SLOT.ROAD, pick: () => T.rail },
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
  { name: 'fence', slot: SLOT.TREE, solid: true, pick: () => T.fence },
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
  const depth = new Uint8Array(n); // 1 = southernmost course of the footprint
  const runLen = new Uint8Array(n); // how deep this column of the footprint is
  for (let x = 0; x < width; x++) {
    let y = 0;
    while (y < height) {
      if (!isBuilding(y * width + x)) {
        y++;
        continue;
      }
      let y1 = y;
      while (y1 + 1 < height && isBuilding((y1 + 1) * width + x)) y1++;
      const len = Math.min(255, y1 - y + 1);
      for (let k = y; k <= y1; k++) {
        depth[k * width + x] = Math.min(255, y1 - k + 1);
        runLen[k * width + x] = len;
      }
      y = y1 + 2; // y1+1 is known not to be a building
    }
  }

  /** How many courses of facade a footprint this deep can carry. */
  const facadeCourses = (len, tall) =>
    tall ? (len >= 5 ? 3 : len >= 3 ? 2 : 1) : len >= 3 ? 2 : 1;

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
    // The course resting on the wall head falls into the eaves shadow.
    if (d === courses + 1) return T[`roofEave@${mask}`];
    if (mask === 0) {
      // Rooftop plant, sparsely, so a big roof has something on it that a
      // repeating texture cannot give you.
      const r = tileHash(x * 7 + 3, y * 11 + 5);
      if (r > 0.988) return T.roofPlant;
      if (r > 0.976) return T.roofVent;
      if (r > 0.966) return T.roofLight;
    }
    return T[`${patchHash(x, y, 7) > 0.62 ? 'roofWeather' : 'roof'}@${mask}`];
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
      let t = 0;
      if (above && left) t = T.shadowNW;
      else if (above) t = T.shadowN;
      else if (left) t = T.shadowW;
      else if (x > 0 && y > 0 && casts(i - width - 1)) t = T.shadowDiag;
      if (!t) continue;
      over[i] = t;
      overSlot[i] = slots[i];
    }
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

/**
 * Find the nearest walkable tile centre to a point, spiralling outward.
 * Used to place the player and to sanity-check POI reachability.
 */
export function nearestOpen(map, tx, ty, maxRadius = 40) {
  const cx = Math.round(tx);
  const cy = Math.round(ty);
  if (!map.solidAt(cx, cy)) return [cx, cy];
  for (let r = 1; r <= maxRadius; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (!map.solidAt(x, y)) return [x, y];
      }
    }
  }
  return null;
}
