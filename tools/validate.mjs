#!/usr/bin/env node
// Content checks that run in CI and before any merge.
//
// Compiles every level for real and asserts the things that break a cartridge
// quietly: a landmark you cannot walk up to, a panel whose photo is missing, a
// draw op off the edge of its canvas.
//
//   node tools/validate.mjs

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOOKS, buildLUT, SLOT_COUNT, IMAGE_MAX } from '../engine/gfx.js';
import { TILESET, T } from '../engine/tiles.js';
import { MATERIALS, compileMap, nearestOpen } from '../engine/geo.js';
import { TILE } from '../engine/tiles.js';
import { decodeArt } from '../engine/art.js';
import { LEVELS } from '../games/explorer/levels.js';
import { ART } from '../games/explorer/art.js';
import { CARTRIDGES } from '../games/manifest.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

const problems = [];
const notes = [];
const fail = (msg) => problems.push(msg);

// --- palettes and tiles ----------------------------------------------------

for (const [id, look] of Object.entries(LOOKS)) {
  if (look.slots.length !== SLOT_COUNT) fail(`look "${id}" has ${look.slots.length} slots, expected ${SLOT_COUNT}`);
  const lut = buildLUT(look, ['#ff0000']);
  if (lut.length !== 256) fail(`look "${id}" produced a ${lut.length}-entry LUT`);
}
notes.push(`${Object.keys(LOOKS).length} looks, ${SLOT_COUNT} slots, ${IMAGE_MAX} image palette entries`);

if (TILESET.count < 20) fail(`tileset only has ${TILESET.count} tiles`);
for (const m of MATERIALS) {
  if (m.edge) {
    for (let mask = 1; mask < 16; mask++) {
      if (T[`${m.edge}@${mask}`] === undefined) fail(`material "${m.name}" is missing edge tile ${m.edge}@${mask}`);
    }
  }
}
notes.push(`${TILESET.count} tiles, ${MATERIALS.length} materials`);

// --- art -------------------------------------------------------------------

for (const [name, art] of Object.entries(ART)) {
  try {
    const a = decodeArt(art);
    if (!a || a.px.length !== a.w * a.h) fail(`art "${name}" decoded to the wrong size`);
  } catch (err) {
    fail(`art "${name}" failed to rasterize: ${err.message}`);
  }
}
notes.push(`${Object.keys(ART).length} hand-drawn panels`);

// --- levels ----------------------------------------------------------------

const seenPoi = new Set();
let totalPois = 0;
let photoBacked = 0;

for (const level of LEVELS) {
  if (!existsSync(resolve(ROOT, level.data))) {
    fail(`level "${level.id}" refers to missing map data ${level.data}`);
    continue;
  }
  const doc = load(level.data);
  const map = compileMap({
    id: level.id,
    name: level.name,
    bbox: level.bbox || doc.bbox,
    metersPerTile: level.metersPerTile,
    features: doc.features,
    pois: level.pois,
    start: level.start,
    buildingSlot: level.buildingSlot,
  });

  if (map.skipped.length) notes.push(`${level.id}: ignored feature kinds ${JSON.stringify(map.skipped)}`);
  if (map.w < 40 || map.h < 40) fail(`level "${level.id}" compiled to a tiny ${map.w}x${map.h} map`);

  const spawn = nearestOpen(map, map.start.x / TILE, map.start.y / TILE, 80);
  if (!spawn) fail(`level "${level.id}" has no walkable tile near its start point`);

  let walkable = 0;
  for (let i = 0; i < map.solid.length; i++) if (!map.solid[i]) walkable++;
  const openRatio = walkable / map.solid.length;
  if (openRatio < 0.25) fail(`level "${level.id}" is ${Math.round((1 - openRatio) * 100)}% impassable`);

  for (const poi of map.pois) {
    totalPois++;
    const key = `${level.id}/${poi.id}`;
    if (seenPoi.has(key)) fail(`duplicate landmark id ${key}`);
    seenPoi.add(key);

    if (poi.tx < 0 || poi.ty < 0 || poi.tx >= map.w || poi.ty >= map.h) {
      fail(`${key} at ${poi.at} falls outside the ${level.id} map`);
      continue;
    }
    const open = nearestOpen(map, poi.tx, poi.ty, 60);
    if (!open) {
      fail(`${key} has no walkable tile within 60 tiles - it cannot be reached`);
    } else {
      const distTiles = Math.hypot(open[0] - poi.tx, open[1] - poi.ty);
      if (distTiles > 12) {
        notes.push(`${key}: post sits ${Math.round(distTiles * map.metersPerTile)}m from the true location`);
      }
    }

    if (!poi.text?.length) fail(`${key} has no description`);
    for (const para of poi.text || []) {
      if (para.length > 320) fail(`${key} has a ${para.length}-character paragraph; keep them under 320`);
    }

    if (poi.photo) {
      const path = `data/photos/${poi.photo}.json`;
      if (!existsSync(resolve(ROOT, path))) {
        fail(`${key} points at missing photo ${path}`);
      } else {
        const doc2 = load(path);
        if (!doc2.credit?.license) fail(`${key} photo ${poi.photo} has no licence recorded`);
        if (doc2.pal && doc2.pal.length > IMAGE_MAX) {
          fail(`${key} photo palette has ${doc2.pal.length} colours, over the ${IMAGE_MAX} limit`);
        }
        const a = decodeArt(doc2.pal ? { w: doc2.w, h: doc2.h, pal: doc2.pal, bits8: doc2.bits8 } : doc2);
        if (a.px.length !== doc2.w * doc2.h) fail(`${key} photo decoded to the wrong size`);
        photoBacked++;
      }
    } else if (!ART[poi.art]) {
      fail(`${key} has neither a photo nor a known drawing (art: ${poi.art})`);
    }
  }

  notes.push(
    `${level.id}: ${map.w}x${map.h} tiles @ ${map.metersPerTile}m (${((map.w * map.metersPerTile) / 1000).toFixed(1)}x${(
      (map.h * map.metersPerTile) /
      1000
    ).toFixed(1)} km), ${map.pois.length} landmarks, ${Math.round(openRatio * 100)}% walkable`,
  );
}

// --- cartridges ------------------------------------------------------------

for (const cart of CARTRIDGES) {
  try {
    const mod = await cart.load();
    const game = mod.default || mod;
    for (const field of ['id', 'title', 'create']) {
      if (!game[field]) fail(`cartridge "${cart.id}" is missing ${field}`);
    }
  } catch (err) {
    fail(`cartridge "${cart.id}" failed to import: ${err.message}`);
  }
}

// --- report ----------------------------------------------------------------

for (const n of notes) console.log(`  ${n}`);
console.log(`\n${totalPois} landmarks, ${photoBacked} photo-backed`);

if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log('All content checks passed.');
