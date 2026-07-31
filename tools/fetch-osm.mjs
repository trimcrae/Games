#!/usr/bin/env node
// Fetch OpenStreetMap extracts for each region and normalize them into the
// map-feature format the game compiles at runtime.
//
// This runs in GitHub Actions, not in the dev sandbox: the sandbox has no
// outbound network to Overpass. Output is committed to data/osm/ so the
// published site never needs the network.
//
//   node tools/fetch-osm.mjs             # all regions
//   node tools/fetch-osm.mjs stanford    # one region

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGIONS, buildQuery } from './regions.mjs';
import { normalizeOverpass } from '../engine/osm.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = resolve(ROOT, 'data/osm');

const ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function overpass(query) {
  let lastErr;
  for (let attempt = 0; attempt < ENDPOINTS.length * 2; attempt++) {
    const url = ENDPOINTS[attempt % ENDPOINTS.length];
    try {
      process.stdout.write(`  -> ${url} (attempt ${attempt + 1})\n`);
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'games-handheld-mapbuilder/1.0 (github.com/trimcrae/games)',
        },
        body: new URLSearchParams({ data: query }),
        signal: AbortSignal.timeout(10 * 60 * 1000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const text = await res.text();
      process.stdout.write(`     received ${(text.length / 1e6).toFixed(1)} MB\n`);
      return JSON.parse(text);
    } catch (err) {
      lastErr = err;
      process.stdout.write(`     failed: ${err.message}\n`);
      await sleep(Math.min(60_000, 5000 * 2 ** Math.floor(attempt / ENDPOINTS.length)));
    }
  }
  throw new Error(`all Overpass endpoints failed: ${lastErr?.message}`);
}

function summarize(features) {
  const counts = {};
  for (const f of features) counts[f.kind] = (counts[f.kind] || 0) + 1;
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `${k}=${n}`)
    .join(' ');
}

async function fetchRegion(id) {
  const region = REGIONS[id];
  if (!region) throw new Error(`unknown region "${id}"`);
  console.log(`\n[${id}] ${region.name}  bbox=${region.bbox.join(',')}`);
  const raw = await overpass(buildQuery(region));
  const { features, landmarks } = normalizeOverpass(raw, {
    simplifyM: region.simplifyM,
    minBuildingArea: region.minBuildingArea,
    minAreaFeature: region.minAreaFeature,
  });
  const doc = {
    region: id,
    name: region.name,
    bbox: region.bbox,
    fetchedAt: new Date().toISOString().slice(0, 10),
    source: 'OpenStreetMap contributors (ODbL 1.0)',
    counts: { features: features.length, landmarks: landmarks.length },
    landmarks,
    features,
  };
  await mkdir(OUT_DIR, { recursive: true });
  const file = resolve(OUT_DIR, `${id}.json`);
  await writeFile(file, JSON.stringify(doc));
  const kb = (JSON.stringify(doc).length / 1024).toFixed(0);
  console.log(`[${id}] ${features.length} features, ${landmarks.length} landmarks, ${kb} KB`);
  console.log(`[${id}] ${summarize(features)}`);
  return doc;
}

const wanted = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const ids = wanted.length ? wanted : Object.keys(REGIONS);

const docs = [];
for (const id of ids) docs.push(await fetchRegion(id));

await writeFile(
  resolve(OUT_DIR, 'SOURCES.md'),
  `# Map data sources

Geometry in this directory is derived from **OpenStreetMap**, © OpenStreetMap
contributors, available under the [Open Database License](https://www.openstreetmap.org/copyright)
(ODbL 1.0). Extracts were downloaded from the Overpass API and reduced to the
feature classes the game renders (see \`engine/osm.js\`).

Regenerate with the \`fetch-osm\` workflow, or locally with
\`node tools/fetch-osm.mjs [region...]\`.

| Region | Name | bbox (S,W,N,E) | Fetched | Features |
| --- | --- | --- | --- | --- |
${docs.map((d) => `| \`${d.region}\` | ${d.name} | ${d.bbox.join(', ')} | ${d.fetchedAt} | ${d.counts.features} |`).join('\n')}
`,
);

console.log('\nDone.');
