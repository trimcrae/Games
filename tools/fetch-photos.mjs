#!/usr/bin/env node
// Download freely-licensed landmark photographs and convert them to the
// console's pixel-art panel format (adaptive colour palette + 4-shade mono).
//
// Runs in GitHub Actions (the dev sandbox has no outbound network). Results are
// committed to data/photos/ so the site never fetches images at runtime.
//
//   node tools/fetch-photos.mjs                 # everything in tools/photos.mjs
//   node tools/fetch-photos.mjs hoover-tower    # a subset
//   node tools/fetch-photos.mjs --force         # redo panels that already exist
//
// By default an entry whose data/photos/<id>.json is already a colour panel is
// skipped, so a re-run after a throttled run is cheap and only retries the gaps.
//
// Requires ImageMagick (`magick` or `convert`) on PATH for decode/resize.

import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
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
const GENERIC = new Set([
  'york', 'university', 'college', 'institute', 'technology', 'school', 'building', 'center', 'centre',
  'county', 'state', 'united', 'states', 'city', 'town', 'park', 'street', 'road', 'high', 'monroe',
  'rochester', 'stanford', 'greece', 'from', 'view',
  // Filler that only became visible once 3-letter terms were allowed through.
  'the', 'and', 'for', 'new', 'near', 'with', 'usa', 'photo', 'image',
]);

// Wikimedia throttles bursts hard, and a throttled request used to be
// indistinguishable from "nothing found" (every caller swallowed the throw).
// One request at a time, spaced out, with backoff on 429/5xx.
const MIN_INTERVAL_MS = 300;
const MAX_ATTEMPTS = 4;
const RETRY_BASE_MS = 1200;
const MAX_BACKOFF_MS = 60_000;
const RETRY_STATUS = new Set([429, 500, 502, 503, 504]);

// Fan-out caps. 30 entries x 3 queries x 12 hits x 2 hosts was ~2000 requests.
const MAX_QUERIES = 3;
const MAX_HITS_PER_QUERY = 4;
const MAX_CANDIDATES = 8;

/** Request tallies, so the run summary can tell throttling from absence. */
const NET = { calls: 0, retries: 0, throttled: 0, failed: 0 };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const strip = (s = '') =>
  String(s)
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

// --- polite HTTP -----------------------------------------------------------

let gate = Promise.resolve();
let lastRequestAt = 0;

/**
 * Run `fn` after every previously queued request, leaving at least
 * MIN_INTERVAL_MS between requests. The whole script is sequential anyway, so a
 * single chain is enough to keep the request rate civil.
 */
function queued(fn) {
  const result = gate.then(async () => {
    const wait = MIN_INTERVAL_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    try {
      return await fn();
    } finally {
      lastRequestAt = Date.now();
    }
  });
  // A rejection must not poison the chain for later requests.
  gate = result.then(
    () => {},
    () => {},
  );
  return result;
}

/** Milliseconds to wait before the next attempt, honouring `Retry-After`. */
function backoff(attempt, retryAfter) {
  if (retryAfter) {
    const secs = Number(retryAfter);
    const ms = Number.isFinite(secs) ? secs * 1000 : Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(ms) && ms > 0) return Math.min(ms, MAX_BACKOFF_MS);
  }
  // Exponential with a little jitter so parallel jobs do not resynchronise.
  return Math.min(RETRY_BASE_MS * 2 ** (attempt - 1) + Math.random() * 250, MAX_BACKOFF_MS);
}

/**
 * Fetch with rate limiting and retries. Throws (with `.throttled` set when the
 * server pushed back) rather than returning a bad response, so callers can log
 * "we were blocked" separately from "there is nothing there".
 */
function request(url, { timeout = 60_000, label = 'request' } = {}) {
  return queued(async () => {
    let lastErr = 'unknown';
    let sawThrottle = false;
    let wait = 0;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (wait) {
        console.log(`    ${label}: ${lastErr}, retry ${attempt}/${MAX_ATTEMPTS} in ${Math.round(wait)}ms`);
        await sleep(wait);
        NET.retries++;
      }
      NET.calls++;
      let res;
      try {
        res = await fetch(url, {
          headers: { 'User-Agent': UA, 'Api-User-Agent': UA },
          signal: AbortSignal.timeout(timeout),
        });
      } catch (err) {
        // Network error or timeout: worth another go.
        lastErr = err.message || String(err);
        wait = backoff(attempt, null);
        continue;
      }
      if (res.ok) return res;
      if (!RETRY_STATUS.has(res.status)) {
        NET.failed++;
        throw new Error(`${label}: HTTP ${res.status}`);
      }
      if (res.status === 429 || res.status === 503) {
        NET.throttled++;
        sawThrottle = true;
      }
      lastErr = `HTTP ${res.status}`;
      wait = backoff(attempt, res.headers.get('retry-after'));
    }
    NET.failed++;
    const err = new Error(`${label}: gave up after ${MAX_ATTEMPTS} attempts (${lastErr})`);
    err.throttled = sawThrottle;
    throw err;
  });
}

async function api(host, params) {
  const url = new URL(`https://${host}/w/api.php`);
  url.search = new URLSearchParams({ format: 'json', formatversion: '2', ...params }).toString();
  const res = await request(url, { label: host });
  const json = await res.json();
  // MediaWiki reports some failures (rate limits included) in a 200 body.
  if (json?.error) throw new Error(`${host}: API error ${json.error.code || 'unknown'}`);
  return json;
}

// --- relevance guard -------------------------------------------------------

const words = (s = '') =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);

/** Distinctive terms of a search query: what a hit has to actually mention. */
export function distinctiveTerms(query) {
  return words(query).filter((t) => t.length >= 3 && !GENERIC.has(t));
}

/**
 * True when a Commons title plausibly names one of `terms`. Commons search will
 * happily return a scan of the Iliad for "Greece Athena High School", so a hit
 * has to name something we asked for.
 *
 * Long terms match as a substring, because Commons filenames run words together
 * ("GenePolisseniCenter.JPG"). Short terms (3-4 letters, e.g. "rit", "bay") only
 * match a whole word, or substring matching would accept "heritage" for "rit".
 */
export function relevant(title, terms) {
  if (!terms.length) return true;
  const flat = String(title).toLowerCase();
  const parts = words(title);
  return terms.some((t) =>
    t.length >= 5
      ? flat.includes(t)
      : parts.some((w) => w === t || w === `${t}s` || `${w}s` === t),
  );
}

/** True when the title names every required term (per-entry `must`). */
function required(title, terms) {
  return terms.every((t) => relevant(title, [t]));
}

// --- resolution ------------------------------------------------------------

/**
 * Resolve an entry to a usable, freely-licensed image on Commons/Wikipedia.
 * Returns `{ image, errors }`: `image` is null when nothing suitable was found,
 * and `errors` lists API failures so "found nothing" can be told apart from
 * "never got an answer".
 */
async function resolveImage(entry) {
  const errors = [];
  const candidates = [];
  const seen = new Set();
  const must = [].concat(entry.must || []).map((t) => t.toLowerCase());

  const add = (title, origin) => {
    const key = title.toLowerCase();
    if (seen.has(key) || candidates.length >= MAX_CANDIDATES) return;
    seen.add(key);
    candidates.push({ title, origin });
  };

  // An explicitly named file could live on either host.
  if (entry.file) add(entry.file.startsWith('File:') ? entry.file : `File:${entry.file}`, 'both');

  if (entry.wiki) {
    try {
      const j = await api('en.wikipedia.org', {
        action: 'query',
        prop: 'pageimages',
        piprop: 'name',
        titles: entry.wiki,
      });
      const page = j?.query?.pages?.[0];
      if (page && !page.missing && page.pageimage) add(`File:${page.pageimage}`, 'en.wikipedia.org');
    } catch (err) {
      console.log(`    wiki lookup failed: ${err.message}`);
      errors.push(err);
    }
  }

  for (const query of [].concat(entry.search || []).slice(0, MAX_QUERIES)) {
    if (candidates.length >= MAX_CANDIDATES) break;
    try {
      const j = await api('commons.wikimedia.org', {
        action: 'query',
        list: 'search',
        srsearch: `${query} filetype:bitmap`,
        srnamespace: '6',
        srlimit: '12',
      });
      const terms = distinctiveTerms(query);
      const hits = j?.query?.search || [];
      let taken = 0;
      let rejected = 0;
      for (const hit of hits) {
        if (taken >= MAX_HITS_PER_QUERY || candidates.length >= MAX_CANDIDATES) break;
        if (!relevant(hit.title, terms) || !required(hit.title, must)) {
          rejected++;
          continue;
        }
        add(hit.title, 'commons.wikimedia.org');
        taken++;
      }
      console.log(`    search "${query}": ${hits.length} hits, ${taken} kept, ${rejected} off-topic`);
    } catch (err) {
      console.log(`    commons search failed: ${err.message}`);
      errors.push(err);
    }
  }

  for (const { title, origin } of candidates) {
    // A Commons search hit is on Commons and a page image is readable through
    // en.wikipedia (extmetadata is proxied from the shared repo), so one host
    // per candidate is normally enough; the other is only a fallback for when
    // that host has no metadata at all.
    const hosts =
      origin === 'both'
        ? ['commons.wikimedia.org', 'en.wikipedia.org']
        : [origin, origin === 'commons.wikimedia.org' ? 'en.wikipedia.org' : 'commons.wikimedia.org'];
    for (const host of hosts) {
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
      } catch (err) {
        errors.push(err);
        continue;
      }
      if (!info) continue;

      const meta = info.extmetadata || {};
      const license = strip(meta.LicenseShortName?.value) || strip(meta.License?.value);
      // No licence data here: worth asking the other host. Anything else is a
      // decision we can make now, so stop looking at this candidate.
      if (!license) continue;
      if (!/^image\/(jpeg|png|webp|tiff)$/.test(info.mime || '')) break;
      if (NONFREE.test(license) || !FREE.test(license)) {
        console.log(`    ${title}: rejected licence "${license}"`);
        break;
      }

      return {
        image: {
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
        },
        errors,
      };
    }
  }
  console.log(`    ${candidates.length} candidate(s) considered, none usable`);
  return { image: null, errors };
}

// --- conversion ------------------------------------------------------------

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
  const res = await request(imageUrl, { timeout: 120_000, label: 'download' });
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

// --- output ----------------------------------------------------------------

/**
 * True when a panel already exists on disk in the current colour format *and*
 * at the current panel size. The size check matters: when PANEL changes, every
 * existing panel is stale even though it is otherwise well-formed.
 */
async function hasColourPanel(id) {
  try {
    const doc = JSON.parse(await readFile(resolve(OUT_DIR, `${id}.json`), 'utf8'));
    return Array.isArray(doc.pal) && doc.pal.length > 0 && doc.w === PANEL.w && doc.h === PANEL.h;
  } catch {
    // Missing, unreadable, or an older mono-only panel: fetch it.
    return false;
  }
}

/**
 * Rebuild SOURCES.md from every panel on disk, not just this run's entries — a
 * partial or throttled run must not wipe the credits of landmarks it skipped.
 */
async function writeSources() {
  const files = await readdir(OUT_DIR, { withFileTypes: true });
  const ids = files
    .filter((f) => f.isFile() && f.name.endsWith('.json'))
    .map((f) => f.name.slice(0, -'.json'.length));

  // Manifest order first (so the table reads like the game), strays after.
  const order = new Map(PHOTOS.map((p, i) => [p.id, i]));
  ids.sort((a, b) => {
    const ra = order.has(a) ? order.get(a) : PHOTOS.length;
    const rb = order.has(b) ? order.get(b) : PHOTOS.length;
    return ra - rb || a.localeCompare(b);
  });

  const rows = [];
  for (const id of ids) {
    let credit;
    try {
      credit = JSON.parse(await readFile(resolve(OUT_DIR, `${id}.json`), 'utf8')).credit;
    } catch {
      /* unreadable panel: still list it, without a credit */
    }
    const file = credit?.file ? credit.file.replace('File:', '') : '';
    const link = credit?.page ? `[${file}](${credit.page})` : file || '—';
    rows.push(
      `| \`${id}\` | ${link} | ${(credit?.artist || '—').replace(/\|/g, '/')} | ${credit?.license || '—'} |`,
    );
  }

  const have = new Set(ids);
  const missing = PHOTOS.filter((p) => !have.has(p.id)).map((p) => p.id);

  await writeFile(
    resolve(OUT_DIR, 'SOURCES.md'),
    `# Photograph sources

Landmark panels are pixel-art reductions of freely-licensed photographs. Each
source, its author, and its licence are listed below; the same credit is shown
in-game beneath the panel. Only public-domain / CC0 / CC BY / CC BY-SA images
are accepted (see \`tools/fetch-photos.mjs\`).

Regenerate with the \`fetch-photos\` workflow, or locally with
\`node tools/fetch-photos.mjs [id...]\` (needs ImageMagick). Existing colour
panels are skipped unless \`--force\` is passed; this file is rebuilt from every
panel in \`data/photos/\`, so a partial run keeps the other credits intact.

| Panel | Source file | Author | Licence |
| --- | --- | --- | --- |
${rows.join('\n')}

${missing.length ? `## No free photo found\n\nThese landmarks use hand-drawn pixel art instead:\n\n${missing.map((m) => `- \`${m}\``).join('\n')}\n` : ''}`,
  );
  return { listed: ids.length, missing };
}

async function run() {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const wanted = args.filter((a) => !a.startsWith('-'));
  const list = wanted.length ? PHOTOS.filter((p) => wanted.includes(p.id)) : PHOTOS;
  await mkdir(OUT_DIR, { recursive: true });

  const written = [];
  const skipped = [];
  const empty = [];
  const failed = [];

  for (const entry of list) {
    console.log(`\n[${entry.id}]`);
    if (!force && (await hasColourPanel(entry.id))) {
      console.log('    skip: colour panel already on disk (--force to refetch)');
      skipped.push(entry.id);
      continue;
    }

    let found = null;
    let errors = [];
    try {
      ({ image: found, errors } = await resolveImage(entry));
    } catch (err) {
      console.log(`    resolve error: ${err.message}`);
      errors = [err];
    }
    if (!found) {
      if (errors.length) {
        // The distinction that matters: we may simply never have been answered.
        console.log(`    UNRESOLVED after ${errors.length} API failure(s) - retry this id, it may not be missing`);
        failed.push(entry.id);
      } else {
        console.log('    no freely-licensed image found');
        empty.push(entry.id);
      }
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
      written.push(entry.id);
      console.log(`    wrote ${w}x${h} panel, ${colour.pal.length} colours`);
    } catch (err) {
      console.log(`    convert failed: ${err.message}`);
      failed.push(entry.id);
    }
  }

  const { listed, missing } = await writeSources();

  console.log(
    `\n${written.length} written, ${skipped.length} skipped, ${empty.length} with no free photo, ${failed.length} failed`,
  );
  if (empty.length) console.log(`  no free photo: ${empty.join(', ')}`);
  if (failed.length) console.log(`  failed (network or convert): ${failed.join(', ')}`);
  console.log(
    `  http: ${NET.calls} requests, ${NET.retries} retries, ${NET.throttled} rate-limited, ${NET.failed} gave up`,
  );
  if (NET.throttled || NET.failed) {
    console.log('  NOTE: Wikimedia pushed back during this run, so a "no free photo" above may just');
    console.log('        mean we never got an answer. Re-run: finished panels are skipped.');
  }
  console.log(`  SOURCES.md: ${listed} panels credited, ${missing.length} manifest ids with no panel`);
}

// Only fetch when run as a script, so the tone constants and the relevance
// helpers can be imported (and unit-tested) without touching the network.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await run();
