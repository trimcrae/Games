#!/usr/bin/env node
// Render sample screens straight out of the engine, with no browser involved.
// Used to compare looks and art styles before committing to one.
//
//   node tools/render-samples.mjs [outdir]

import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Screen, LOOKS, rgbOf, SLOT, px } from '../engine/gfx.js';
import { compileMap, nearestOpen } from '../engine/geo.js';
import { drawMap, cameraFor } from '../engine/tilemap.js';
import { TILE } from '../engine/tiles.js';
import { decodeArt } from '../engine/art.js';
import { drawPanel } from '../engine/ui.js';
import { LEVELS } from '../games/explorer/levels.js';
import { PLAYER, MARKER } from '../games/explorer/sprites.js';
import { encodePNG, montage } from './png.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, process.argv[2] || 'samples');
mkdirSync(OUT, { recursive: true });

const load = (p) => JSON.parse(readFileSync(resolve(ROOT, p), 'utf8'));

/** Compile a level from its committed OSM extract. */
export function buildLevel(level) {
  const doc = load(level.data);
  return compileMap({
    id: level.id,
    name: level.name,
    subtitle: level.subtitle,
    bbox: level.bbox || doc.bbox,
    metersPerTile: level.metersPerTile,
    features: doc.features,
    pois: level.pois,
    start: level.start,
    walkSpeed: level.walkSpeed,
    buildingSlot: level.buildingSlot,
    attribution: doc.source,
  });
}

function toRGB(screen, look) {
  const rgb = new Uint8Array(screen.w * screen.h * 3);
  for (let i = 0; i < screen.buf.length; i++) {
    const [r, g, b] = rgbOf(look, screen.buf[i], screen.imagePalette);
    rgb[i * 3] = r;
    rgb[i * 3 + 1] = g;
    rgb[i * 3 + 2] = b;
  }
  return { w: screen.w, h: screen.h, rgb };
}

/** Draw one in-world screenshot centred on a lat/lon. */
function scene(map, at, { w = 160, h = 144, label, found = 3 } = {}) {
  const s = new Screen(w, h);
  const [ptx, pty] = map.proj.toTile(at[0], at[1]);
  const open = nearestOpen(map, ptx, pty) || [ptx, pty];
  const wx = open[0] * TILE + TILE / 2;
  const wy = open[1] * TILE + TILE / 2;
  const hudH = 16;
  const viewH = h - hudH;
  // Frame the landmark itself, not wherever the walker had to stand.
  const [camX, camY] = cameraFor(map, ptx * TILE, pty * TILE, w, viewH);

  drawMap(s, map, camX, camY, { viewH });

  // Landmark posts in view.
  for (const poi of map.pois) {
    const sx = Math.round(poi.x - camX) - 4;
    const sy = Math.round(poi.y - camY) - 10;
    if (sx < -16 || sy < -16 || sx > w || sy > viewH) continue;
    s.clip(0, 0, w, viewH);
    s.blit(MARKER.px, MARKER.w, MARKER.h, sx, sy, { slot: SLOT.ACCENT });
    s.noClip();
  }

  // Player, feet on the tile centre.
  const frame = PLAYER.down[1];
  s.clip(0, 0, w, viewH);
  s.blit(frame.px, frame.w, frame.h, Math.round(wx - camX - frame.w / 2), Math.round(wy - camY - frame.h + 4), {
    slot: SLOT.CHAR,
  });
  s.noClip();

  // HUD strip.
  s.fill(0, h - hudH, w, hudH, px(SLOT.UI, 0));
  s.hline(0, h - hudH, w, px(SLOT.UI, 3));
  s.text(label || map.name, 4, h - hudH + 5, { slot: SLOT.UI, shade: 3 });
  const tally = `${found}/${map.pois.length}`;
  s.text(tally, w - 4 - s.textWidth(tally), h - hudH + 5, { slot: SLOT.UI, shade: 3 });
  return s;
}

/** Draw a landmark panel the way the game will: art, name, credit, text. */
function panel(art, name, creditLine, body, w = 160, h = 144) {
  const s = new Screen(w, h);
  s.clear(px(SLOT.UI, 0));
  const a = decodeArt(art);
  s.imagePalette = a.pal || null;
  const ax = Math.round((w - a.w) / 2);
  const ay = 12;
  drawPanel(s, a, ax, ay, { slot: SLOT.UI });
  s.text(name, 4, 3, { slot: SLOT.UI, shade: 3 });
  if (creditLine) {
    const cy = ay + a.h - 8;
    s.fill(0, cy - 1, w, 9, px(SLOT.UI, 0));
    s.text(creditLine, 4, cy, { slot: SLOT.UI, shade: 2 });
  }
  let y = ay + a.h + 8;
  for (const line of body) {
    s.text(line, 4, y, { slot: SLOT.UI, shade: 3 });
    y += 9;
  }
  return s;
}

// --- build the maps --------------------------------------------------------
const maps = {};
for (const level of LEVELS) {
  const t0 = Date.now();
  maps[level.id] = buildLevel(level);
  const m = maps[level.id];
  console.log(
    `${level.id}: ${m.w}x${m.h} tiles (${((m.w * m.metersPerTile) / 1000).toFixed(1)}x${(
      (m.h * m.metersPerTile) /
      1000
    ).toFixed(1)} km) in ${Date.now() - t0}ms` + (m.skipped.length ? `  skipped: ${JSON.stringify(m.skipped)}` : ''),
  );
}

// --- look comparison -------------------------------------------------------
const LOOK_IDS = ['dmg', 'pocket', 'color'];
const SCENES = [
  ['stanford', [37.43007, -122.1694], 'THE OVAL'],
  ['stanford', [37.42772, -122.16698], 'HOOVER TOWER'],
  ['rit', [43.084629, -77.67436], 'THE SENTINEL'],
  ['greece', [43.31341, -77.71329], 'BRADDOCK BAY'],
  ['greece', [43.20565, -77.69238], 'GREECE RIDGE'],
];

for (const [id, at, label] of SCENES) {
  const s = scene(maps[id], at, { label });
  const slug = `${id}-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  const imgs = LOOK_IDS.map((lk) => toRGB(s, LOOKS[lk]));
  const m = montage(imgs, LOOK_IDS.length, 6);
  writeFileSync(resolve(OUT, `look-${slug}.png`), encodePNG(m.w, m.h, m.rgb, 3));
}

// One wide-screen (GBA-sized) render for scale comparison.
{
  const s = scene(maps.stanford, [37.42714, -122.17037], { w: 240, h: 160, label: 'MAIN QUAD' });
  const img = toRGB(s, LOOKS.dmg);
  writeFileSync(resolve(OUT, 'look-widescreen.png'), encodePNG(img.w, img.h, img.rgb, 3));
}

export { maps, scene, panel, toRGB };

console.log(`\nWrote samples to ${OUT}`);
