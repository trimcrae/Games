// OpenStreetMap -> map-feature normalization.
//
// DOM-free and dependency-free on purpose: the CI fetch job (tools/fetch-osm.mjs)
// imports this to turn a raw Overpass response into the same compact feature
// format that hand-authored maps use, and tools/validate.mjs re-checks it.
//
// Output feature shape (coordinates are [lat, lon]):
//   { kind, name?, ring:  [[lat,lon], ...] }   closed area
//   { kind, name?, line:  [[lat,lon], ...], width }   linear feature, width in metres
//
// `kind` is a material name understood by engine/geo.js.

/** Road widths in metres, by OSM highway class. */
const ROAD_WIDTH = {
  motorway: 22,
  motorway_link: 12,
  trunk: 18,
  trunk_link: 11,
  primary: 16,
  primary_link: 10,
  secondary: 13,
  secondary_link: 9,
  tertiary: 11,
  tertiary_link: 8,
  residential: 9,
  unclassified: 8,
  living_street: 8,
  service: 6,
  pedestrian: 7,
  footway: 3,
  path: 2.5,
  cycleway: 3,
  steps: 3,
  track: 4,
  corridor: 3,
};

const FOOT_KINDS = new Set(['footway', 'path', 'cycleway', 'steps', 'track', 'corridor', 'pedestrian']);

/**
 * Decide what a tagged OSM element becomes in our world.
 * Returns null for anything we do not render.
 * @param {Record<string,string>} tags
 * @param {boolean} closed whether the geometry is a closed ring
 */
export function classify(tags = {}, closed = false) {
  const t = tags;

  if (t.building || t['building:part']) {
    return { kind: 'building', rank: 60 };
  }

  if (t.highway) {
    const hw = t.highway;
    const width = Number(t.width) || ROAD_WIDTH[hw];
    if (!width) return null;
    // Pedestrian areas are drawn as plazas, not as strips.
    if (closed && (t.area === 'yes' || hw === 'pedestrian')) return { kind: 'plaza', rank: 30 };
    return { kind: FOOT_KINDS.has(hw) ? 'path' : 'road', width, rank: FOOT_KINDS.has(hw) ? 40 : 45 };
  }

  if (t.railway === 'rail' || t.railway === 'light_rail' || t.railway === 'tram') {
    return { kind: 'rail', width: 6, rank: 44 };
  }

  if (t.natural === 'water' || t.water || t.landuse === 'reservoir' || t.landuse === 'basin') {
    return { kind: 'water', rank: 20 };
  }
  if (t.waterway === 'river' || t.waterway === 'canal') {
    return closed ? { kind: 'water', rank: 20 } : { kind: 'water', width: Number(t.width) || 14, rank: 21 };
  }
  if (t.waterway === 'stream' || t.waterway === 'ditch' || t.waterway === 'drain') {
    return closed ? { kind: 'water', rank: 20 } : { kind: 'water', width: 6, rank: 21 };
  }

  if (t.natural === 'beach' || t.natural === 'sand' || t.surface === 'sand') {
    return { kind: 'sand', rank: 22 };
  }
  if (t.natural === 'wetland' || t.natural === 'marsh') return { kind: 'marsh', rank: 22 };
  if (t.natural === 'wood' || t.landuse === 'forest') return { kind: 'forest', rank: 25 };
  if (t.natural === 'scrub' || t.landuse === 'meadow' || t.landuse === 'grassland') {
    return { kind: 'meadow', rank: 24 };
  }

  if (t.amenity === 'parking' || t.parking) return { kind: 'parking', rank: 35 };

  if (t.leisure === 'pitch' || t.leisure === 'track' || t.leisure === 'stadium') {
    return { kind: 'pitch', rank: 33 };
  }
  if (t.leisure === 'park' || t.leisure === 'garden' || t.leisure === 'common' || t.leisure === 'nature_reserve') {
    return { kind: 'park', rank: 15 };
  }
  if (t.landuse === 'grass' || t.landuse === 'village_green' || t.landuse === 'recreation_ground') {
    return { kind: 'park', rank: 15 };
  }
  if (t.landuse === 'cemetery' || t.amenity === 'grave_yard') return { kind: 'park', rank: 15 };
  if (t.landuse === 'farmland' || t.landuse === 'orchard' || t.landuse === 'vineyard') {
    return { kind: 'farm', rank: 14 };
  }

  if (t.barrier === 'hedge') return { kind: 'hedge', width: 2, rank: 50 };
  if (t.barrier === 'fence' || t.barrier === 'wall') return { kind: 'fence', width: 1.5, rank: 50 };

  return null;
}

/** Interesting standalone nodes worth remembering as candidate landmarks. */
export function classifyPoint(tags = {}) {
  const t = tags;
  if (!t.name) return null;
  if (t.tourism === 'artwork' || t.historic === 'memorial' || t.historic === 'monument') return 'artwork';
  if (t.tourism === 'museum' || t.tourism === 'attraction' || t.tourism === 'viewpoint') return t.tourism;
  if (t.amenity === 'fountain') return 'fountain';
  if (t.man_made === 'tower' || t.man_made === 'lighthouse') return t.man_made;
  return null;
}

/** Metres per degree, good enough over a few kilometres. */
export const M_PER_DEG_LAT = 110574;
export function mPerDegLon(lat) {
  return 111320 * Math.cos((lat * Math.PI) / 180);
}

/** Shoelace area of a [lat,lon] ring, in square metres. */
export function ringArea(ring) {
  if (ring.length < 3) return 0;
  const lat0 = ring[0][0];
  const kx = mPerDegLon(lat0);
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][1] * kx;
    const yi = ring[i][0] * M_PER_DEG_LAT;
    const xj = ring[j][1] * kx;
    const yj = ring[j][0] * M_PER_DEG_LAT;
    a += xj * yi - xi * yj;
  }
  return Math.abs(a) / 2;
}

/** Douglas-Peucker simplification with a tolerance in metres. */
export function simplify(points, toleranceM) {
  if (points.length <= 2) return points.slice();
  const lat0 = points[0][0];
  const kx = mPerDegLon(lat0);
  const px = points.map(([la, lo]) => [lo * kx, la * M_PER_DEG_LAT]);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  const tol2 = toleranceM * toleranceM;
  while (stack.length) {
    const [i0, i1] = stack.pop();
    let best = -1;
    let bestD = tol2;
    const [ax, ay] = px[i0];
    const [bx, by] = px[i1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    for (let i = i0 + 1; i < i1; i++) {
      const [cx, cy] = px[i];
      let t = len2 ? ((cx - ax) * dx + (cy - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const ex = ax + t * dx - cx;
      const ey = ay + t * dy - cy;
      const d = ex * ex + ey * ey;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

const round6 = (n) => Math.round(n * 1e6) / 1e6;

const ptKey = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
const isClosed = (ring) => ring.length > 3 && ptKey(ring[0]) === ptKey(ring[ring.length - 1]);

/**
 * Stitch the outer members of a multipolygon relation into closed rings.
 * Overpass returns each member way separately, so a lake arrives as a handful
 * of unclosed fragments that have to be joined end-to-end before they mean
 * anything. Holes (inner members) are ignored; the fill pass tolerates that.
 */
export function assembleRings(members) {
  const pool = members
    .filter((m) => (m.role === 'outer' || !m.role) && m.geometry && m.geometry.length > 1)
    .map((m) => m.geometry.filter((p) => p && Number.isFinite(p.lat)).map((p) => [p.lat, p.lon]))
    .filter((g) => g.length > 1);

  const rings = [];
  while (pool.length) {
    let cur = pool.shift();
    let joined = true;
    while (joined && !isClosed(cur)) {
      joined = false;
      const head = ptKey(cur[0]);
      const tail = ptKey(cur[cur.length - 1]);
      for (let i = 0; i < pool.length; i++) {
        const s = pool[i];
        const sHead = ptKey(s[0]);
        const sTail = ptKey(s[s.length - 1]);
        if (tail === sHead) cur = cur.concat(s.slice(1));
        else if (tail === sTail) cur = cur.concat(s.slice(0, -1).reverse());
        else if (head === sTail) cur = s.slice(0, -1).concat(cur);
        else if (head === sHead) cur = s.slice(1).reverse().concat(cur);
        else continue;
        pool.splice(i, 1);
        joined = true;
        break;
      }
    }
    if (cur.length >= 3) rings.push(cur);
  }
  return rings;
}

/** Force a ring closed, as area features must be. */
function closeRing(pts) {
  return isClosed(pts) ? pts : [...pts, pts[0]];
}

/**
 * Turn an Overpass `out geom` response into normalized features.
 * @param {object} overpass parsed Overpass JSON
 * @param {object} [opts]
 * @param {number} [opts.simplifyM=3] simplification tolerance in metres
 * @param {number} [opts.minBuildingArea=0] drop buildings smaller than this (m^2)
 * @param {number} [opts.minAreaFeature=0] drop non-building areas smaller than this (m^2)
 */
export function normalizeOverpass(overpass, opts = {}) {
  const { simplifyM = 3, minBuildingArea = 0, minAreaFeature = 0 } = opts;
  const features = [];
  const landmarks = [];
  const seen = new Set();

  const addPoints = (points, tags, id) => {
    let pts = points;
    if (pts.length < 2) return;
    const c = classify(tags, isClosed(pts));
    if (!c) return;

    // A classification without a width is an area, however its geometry
    // arrived: a lake tagged natural=water is a lake even if the way that
    // carries it was left unclosed.
    const isArea = !c.width;
    if (isArea) {
      if (pts.length < 3) return;
      pts = closeRing(pts);
      const area = ringArea(pts);
      const min = c.kind === 'building' ? minBuildingArea : minAreaFeature;
      if (min && area < min && !tags.name) return;
      pts = simplify(pts, simplifyM);
      if (pts.length < 4) return;
    } else {
      pts = simplify(pts, simplifyM);
      if (pts.length < 2) return;
    }

    const key = `${c.kind}:${id}`;
    if (seen.has(key)) return;
    seen.add(key);

    const coords = pts.map(([la, lo]) => [round6(la), round6(lo)]);
    const f = { kind: c.kind };
    if (tags.name) f.name = tags.name;
    if (isArea) f.ring = coords;
    else {
      f.line = coords;
      f.width = c.width || 6;
    }
    if (c.kind === 'building' && tags['building:levels']) {
      const lv = parseInt(tags['building:levels'], 10);
      if (Number.isFinite(lv)) f.levels = Math.max(1, Math.min(40, lv));
    }
    f.rank = c.rank;
    features.push(f);
  };

  for (const el of overpass.elements || []) {
    const tags = el.tags || {};
    if (el.type === 'node') {
      const kind = classifyPoint(tags);
      if (kind && Number.isFinite(el.lat)) {
        landmarks.push({ kind, name: tags.name, at: [round6(el.lat), round6(el.lon)] });
      }
      continue;
    }
    if (el.type === 'way') {
      const pts = (el.geometry || [])
        .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon))
        .map((p) => [p.lat, p.lon]);
      addPoints(pts, tags, `w${el.id}`);
      continue;
    }
    if (el.type === 'relation') {
      // `out geom` inlines member geometry; stitch the outers into real rings.
      assembleRings(el.members || []).forEach((ring, n) => addPoints(ring, tags, `r${el.id}:${n}`));
    }
  }

  // Painter's order: big background areas first, detail last.
  features.sort((a, b) => a.rank - b.rank);
  for (const f of features) delete f.rank;
  return { features, landmarks };
}
