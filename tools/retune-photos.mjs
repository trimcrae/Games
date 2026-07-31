#!/usr/bin/env node
// Regenerate landmark panels from the colour working copies in data/photos/src,
// with no network involved. This is the loop for changing panel size, palette
// size or tone: the expensive part (finding a freely-licensed photograph and
// downloading it) already happened in CI and its result is in the repo.
//
//   node tools/retune-photos.mjs              # rewrite every panel
//   node tools/retune-photos.mjs hoover-tower # just one
//   node tools/retune-photos.mjs --preview    # write a PNG contact sheet instead

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PANEL } from './photos.mjs';
import { COLOUR, TONE } from './fetch-photos.mjs';
import { quantizeColor } from './quantize.mjs';
import { quantize } from './pixelize.mjs';
import { decodePNG, encodePNG, montage } from './png.mjs';
import { packIndices, packBytes } from '../engine/art.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'data/photos');
const SRC_DIR = resolve(OUT_DIR, 'src');

/** Centre-crop and box-filter an RGB image down to w x h. */
export function resample(rgb, sw, sh, w, h) {
  const scale = Math.min(sw / w, sh / h);
  const cropW = w * scale;
  const cropH = h * scale;
  const ox = (sw - cropW) / 2;
  const oy = (sh - cropH) / 2;
  const out = new Uint8Array(w * h * 3);

  for (let y = 0; y < h; y++) {
    const sy0 = Math.floor(oy + y * scale);
    const sy1 = Math.max(sy0 + 1, Math.floor(oy + (y + 1) * scale));
    for (let x = 0; x < w; x++) {
      const sx0 = Math.floor(ox + x * scale);
      const sx1 = Math.max(sx0 + 1, Math.floor(ox + (x + 1) * scale));
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let sy = sy0; sy < sy1 && sy < sh; sy++) {
        for (let sx = sx0; sx < sx1 && sx < sw; sx++) {
          const p = (sy * sw + sx) * 3;
          r += rgb[p];
          g += rgb[p + 1];
          b += rgb[p + 2];
          n++;
        }
      }
      const d = (y * w + x) * 3;
      out[d] = r / Math.max(1, n);
      out[d + 1] = g / Math.max(1, n);
      out[d + 2] = b / Math.max(1, n);
    }
  }
  return out;
}

/** Luminance, matching the greyscale ImageMagick would have produced. */
function toGray(rgb) {
  const gray = new Uint8Array(rgb.length / 3);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = Math.round(0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2]);
  }
  return gray;
}

/** Build both panel formats for one source image. */
export function buildPanel(rgb, sw, sh, { panel = PANEL, colour = COLOUR, tone = TONE } = {}) {
  const small = resample(rgb, sw, sh, panel.w, panel.h);
  const col = quantizeColor(small, panel.w, panel.h, colour);
  const gray = quantize(toGray(small), panel.w, panel.h, tone);
  return { w: panel.w, h: panel.h, pal: col.pal, px: col.px, bits8: packBytes(col.px), bits: packIndices(gray) };
}

/** Entry point, so this module can also be imported as a library. */
function main() {
  const args = process.argv.slice(2);
  const preview = args.includes('--preview');
  const wanted = args.filter((a) => !a.startsWith('-'));

  if (!existsSync(SRC_DIR)) {
    console.error(`No working copies in ${SRC_DIR}. Run the fetch-photos workflow first.`);
    process.exit(1);
  }

  const ids = readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.png'))
    .map((f) => f.replace(/\.png$/, ''))
    .filter((id) => !wanted.length || wanted.includes(id));

  const sheets = [];
  let written = 0;

  for (const id of ids) {
    const src = decodePNG(readFileSync(resolve(SRC_DIR, `${id}.png`)));
    const built = buildPanel(src.rgb, src.w, src.h);

    if (preview) {
      const rgb = new Uint8Array(built.w * built.h * 3);
      for (let i = 0; i < built.px.length; i++) {
        const hex = built.pal[built.px[i]];
        rgb[i * 3] = parseInt(hex.slice(1, 3), 16);
        rgb[i * 3 + 1] = parseInt(hex.slice(3, 5), 16);
        rgb[i * 3 + 2] = parseInt(hex.slice(5, 7), 16);
      }
      sheets.push({ w: built.w, h: built.h, rgb });
      continue;
    }

    const path = resolve(OUT_DIR, `${id}.json`);
    if (!existsSync(path)) {
      console.log(`  ${id}: no panel json on disk, skipping (credit unknown)`);
      continue;
    }
    const doc = JSON.parse(readFileSync(path, 'utf8'));
    writeFileSync(
      path,
      JSON.stringify({ id, w: built.w, h: built.h, credit: doc.credit, pal: built.pal, bits8: built.bits8, bits: built.bits }),
    );
    written++;
    console.log(`  ${id}: ${built.w}x${built.h}, ${built.pal.length} colours`);
  }

  if (preview) {
    const out = resolve(ROOT, 'samples');
    mkdirSync(out, { recursive: true });
    const m = montage(sheets, 4, 6);
    writeFileSync(resolve(out, 'photo-panels.png'), encodePNG(m.w, m.h, m.rgb, 2));
    console.log(`Wrote a contact sheet of ${sheets.length} panels to samples/photo-panels.png`);
  } else {
    console.log(`\n${written} panels rewritten at ${PANEL.w}x${PANEL.h}.`);
  }
}

if (process.argv[1] && process.argv[1].endsWith('retune-photos.mjs')) main();
