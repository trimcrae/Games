#!/usr/bin/env node
// Download freely-licensed landmark photographs and convert them to the
// console's 4-shade pixel-art panel format.
//
// Runs in GitHub Actions (the dev sandbox has no outbound network). Results are
// committed to data/photos/ so the site never fetches images at runtime.
//
//   node tools/fetch-photos.mjs                 # everything in tools/photos.mjs
//   node tools/fetch-photos.mjs hoover-tower    # a subset
//
// Requires ImageMagick (`magick` or `convert`) on PATH for decode/resize.

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { PHOTOS, PANEL } from './photos.mjs';
import { quantize, readPGM } from './pixelize.mjs';
import { quantizeColor } from './quantize.mjs';
import { encodePNG } from './png.mjs';
import { packIndices, packBytes } from '../engine/art.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'data/photos');
const SRC_DIR = resolve(ROOT, 'data/photos/src');
const UA = 'games-handheld-artbuilder/1.0 (https://github.com/trimcrae/games; pixel-art conversion)';

const FREE = /^(cc0|cc[ -]by([ -]sa)?([ -][\d.]+)?|public domain|pd([ -]|$)|no restrictions|attribution)/i;
const NONFREE = /(fair use|non[- ]free|copyrighted|all rights reserved)/i;

/** Words too common to prove a search hit is on topic. */
const GENERIC = new Set(['york', 'university', 'college', 'institute', 'technology', 'school', 'building', 'center', 'centre', 'county', 'state', 'united', 'states', 'city', 'town', 'park', 'street', 'road', 'high', 'monroe', 'rochester', 'stanford', 'greece', 'from', 'view']);

const strip = (s = '') =>
  String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function api(host, params) {
  const url = new URL(`https://${host}/w/api.php`);
  url.search = new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${host} HTTP ${res.status}`);
  return res.json();
}

/** Resolve an entry to a usable, freely-licensed image on Commons/Wikipedia. */
async function resolveImage(entry) {
  const candidates = [];

  if (entry.wiki) {
    try {
      const j = await api('en.wikipedia.org', {
        action: 'query',
        prop: 'pageimages',
        piprop: 'name',
        titles: entry.wiki,
      });
      const page = j?.query?.pages?.[0];
      if (page && !page.missing && page.pageimage) candidates.push(`File:${page.pageimage}`);
    } catch (err) {
      console.log(`    wiki lookup failed: ${err.message}`);
    }
  }

  if (entry.file) candidates.unshift(entry.file.startsWith('File:') ? entry.file : `File:${entry.file}`);

  for (const query of [].concat(entry.search || [])) {
    try {
      const j = await api('commons.wikimedia.org', {
        action: 'query',
        list: 'search',
        srsearch: `${query} filetype:bitmap`,
        srnamespace: '6',
        srlimit: '12',
      });
      // Commons search will happily return a scan of the Iliad for a query
      // about Greece Athena High School, so a hit has to actually name
      // something we asked for.
      const terms = query
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, ' ')
        .split(/\s+/)
        .filter((t) => t.length > 3 && !GENERIC.has(t));
      for (const hit of j?.query?.search || []) {
        const title = hit.title.toLowerCase();
        if (!terms.length || terms.some((t) => title.includes(t))) candidates.push(hit.title);
      }
    } catch (err) {
      console.log(`    commons search failed: ${err.message}`);
    }
  }

  for (const title of candidates) {
    for (const host of ['commons.wikimedia.org', 'en.wikipedia.org']) {
      let info;
      try {
        const j = await api(host, {
          action: 'query',
          prop: 'imageinfo',
          iiprop: 'url|extmetadata|mime|size',
          iiurlwidth: String(PANEL.w * 6),
          titles: title,
        });
        info = j?.query?.pages?.[0]?.imageinfo?.[0];
      } catch {
        continue;
      }
      if (!info) continue;
      if (!/^image\/(jpeg|png|webp|tiff)$/.test(info.mime || '')) continue;

      const meta = info.extmetadata || {};
      const license = strip(meta.LicenseShortName?.value) || strip(meta.License?.value);
      if (!license || NONFREE.test(license) || !FREE.test(license)) continue;

      return {
        title,
        url: info.thumburl || info.url,
        credit: {
          file: title,
          artist: strip(meta.Artist?.value) || 'Unknown',
          license,
          licenseUrl: strip(meta.LicenseUrl?.value) || '',
          page: info.descriptionurl || `https://commons.wikimedia.org/wiki/${encodeURIComponent(title)}`,
          source: host === 'commons.wikimedia.org' ? 'Wikimedia Commons' : 'English Wikipedia',
        },
      };
    }
  }
  return null;
}

let MAGICK = null;
function magick(args) {
  if (!MAGICK) {
    for (const cmd of ['magick', 'convert']) {
      try {
        execFileSync(cmd, ['-version'], { stdio: 'ignore' });
        MAGICK = cmd;
        break;
      } catch {
        /* keep looking */
      }
    }
    if (!MAGICK) throw new Error('ImageMagick not found (need `magick` or `convert` on PATH)');
  }
  return execFileSync(MAGICK, args, { maxBuffer: 1 << 28 });
}

/** The shipped tone curve. Kept here so the retune tool and CI agree. */
export const TONE = { mode: 'floyd', contrast: 1.45, gamma: 1.15 };

/** Colour panels: an adaptive palette this size, error-diffused. */
export const COLOUR = { colors: 96, contrast: 1.32, gamma: 1.06, saturation: 1.22 };

/** Larger working copy kept in the repo so tone curves can be retuned offline. */
const SRC = { w: 256, h: 176 };

async function convert(entry, imageUrl) {
  const res = await fetch(imageUrl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`download HTTP ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const src = resolve(tmpdir(), `poi-src-${entry.id}`);
  writeFileSync(src, bytes);
  const gravity = entry.gravity || 'center';
  const render = (w, h) =>
    readPGM(
      new Uint8Array(
        magick([
          src,
          '-auto-orient',
          '-resize', `${w}x${h}^`,
          '-gravity', gravity,
          '-extent', `${w}x${h}`,
          '-normalize',
          '-unsharp', '0x1+1.0+0',
          '-depth', '8',
          'ppm:-',
        ]),
      ),
    );
  const panel = render(PANEL.w, PANEL.h);
  const source = render(SRC.w, SRC.h);
  await rm(src, { force: true });
  return { panel, source };
}

async function run() {
  const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const list = wanted.length ? PHOTOS.filter((p) => wanted.includes(p.id)) : PHOTOS;
  await mkdir(OUT_DIR, { recursive: true });

  const ok = [];
  const missing = [];

  for (const entry of list) {
    console.log(`\n[${entry.id}]`);
    let found;
    try {
      found = await resolveImage(entry);
    } catch (err) {
      console.log(`    resolve error: ${err.message}`);
    }
    if (!found) {
      console.log('    no freely-licensed image found');
      missing.push(entry.id);
      continue;
    }
    console.log(`    ${found.title}`);
    console.log(`    ${found.credit.license} - ${found.credit.artist}`);
    try {
      const { panel, source } = await convert(entry, found.url);
      const { w, h, gray, rgb } = panel;
      const tune = entry.tune || {};
      const colour = quantizeColor(rgb, w, h, { ...COLOUR, ...(entry.colour || {}) });
      const doc = {
        id: entry.id,
        w,
        h,
        credit: found.credit,
        // Full-colour panel: adaptive palette, error-diffused.
        pal: colour.pal,
        bits8: packBytes(colour.px),
        // 4-shade version for the monochrome screens.
        bits: packIndices(quantize(gray, w, h, { ...TONE, ...tune })),
      };
      await writeFile(resolve(OUT_DIR, `${entry.id}.json`), JSON.stringify(doc));
      // Build-time only: a larger colour working copy, so palettes and tone
      // curves can be retuned offline without going back to the network.
      await mkdir(SRC_DIR, { recursive: true });
      await writeFile(resolve(SRC_DIR, `${entry.id}.png`), encodePNG(source.w, source.h, source.rgb));
      ok.push({ id: entry.id, ...found.credit });
      console.log(`    wrote ${w}x${h} panel, ${colour.pal.length} colours`);
    } catch (err) {
      console.log(`    convert failed: ${err.message}`);
      missing.push(entry.id);
    }
  }

  const rows = ok
    .map(
      (c) =>
        `| \`${c.id}\` | [${c.file.replace('File:', '')}](${c.page}) | ${c.artist.replace(/\|/g, '/')} | ${c.license} |`,
    )
    .join('\n');

  await writeFile(
    resolve(OUT_DIR, 'SOURCES.md'),
    `# Photograph sources

Landmark panels are pixel-art reductions of freely-licensed photographs. Each
source, its author, and its licence are listed below; the same credit is shown
in-game beneath the panel. Only public-domain / CC0 / CC BY / CC BY-SA images
are accepted (see \`tools/fetch-photos.mjs\`).

Regenerate with the \`fetch-photos\` workflow, or locally with
\`node tools/fetch-photos.mjs [id...]\` (needs ImageMagick).

| Panel | Source file | Author | Licence |
| --- | --- | --- | --- |
${rows}

${missing.length ? `## No free photo found\n\nThese landmarks use hand-drawn pixel art instead:\n\n${missing.map((m) => `- \`${m}\``).join('\n')}\n` : ''}`,
  );

  console.log(`\n${ok.length} panels written, ${missing.length} missing: ${missing.join(', ') || 'none'}`);
}

await run();
