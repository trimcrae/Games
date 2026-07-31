#!/usr/bin/env node
// Drive the real page in Chromium: boot, load the cartridge, walk, open a
// landmark. Fails loudly on any console error or unhandled rejection.
//
//   node tools/browser-check.mjs [outdir]

import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve, dirname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync, existsSync } from 'node:fs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, process.argv[2] || 'samples/browser');
mkdirSync(OUT, { recursive: true });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };

const server = createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(req.url.split('?')[0])).replace(/^(\.\.[/\\])+/, '');
  const file = join(ROOT, path === '/' ? 'index.html' : path);
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}/`;

// The image ships a Chromium that may not match this Playwright build's
// expected revision, so use it directly when it is there.
const PREINSTALLED = '/opt/pw-browsers/chromium';
const launchOpts = existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {};
const browser = await chromium.launch(launchOpts);
const page = await browser.newPage({ viewport: { width: 420, height: 900 }, deviceScaleFactor: 2 });

const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error') problems.push(`console: ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));

const shot = async (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
const key = async (code, ms = 120) => {
  await page.keyboard.down(code);
  await page.waitForTimeout(ms);
  await page.keyboard.up(code);
  await page.waitForTimeout(90);
};
const hold = async (code, ms) => {
  await page.keyboard.down(code);
  await page.waitForTimeout(ms);
  await page.keyboard.up(code);
};

await page.goto(base, { waitUntil: 'networkidle' });
await page.waitForFunction(() => globalThis.handheld?.running, null, { timeout: 10_000 });
await page.waitForTimeout(900);
await shot('01-boot');

await key('Enter'); // skip boot
await page.waitForTimeout(600);
await shot('02-launcher');

await key('KeyZ'); // load cartridge
await page.waitForTimeout(1200);
await shot('03-title');

await key('KeyZ'); // start
await page.waitForTimeout(600);
await shot('04-place-select');

await key('KeyZ'); // choose Stanford
await page.waitForTimeout(3500);
await shot('05-world');

// Walk about a bit, then look for the nearest landmark prompt.
await hold('ArrowDown', 700);
await hold('ArrowRight', 700);
await page.waitForTimeout(200);
await shot('06-walked');

// Teleport next to a landmark so the check is deterministic.
const near = await page.evaluate(() => {
  const sys = globalThis.handheld;
  const world = sys.stack[sys.stack.length - 1];
  if (!world?.map?.pois) return null;
  const poi = world.map.pois[0];
  world.x = poi.postX;
  world.y = poi.postY + 10;
  return poi.name;
});
await page.waitForTimeout(300);
await shot('07-at-landmark');

await key('KeyZ'); // read it
await page.waitForTimeout(900);
await shot('08-landmark-panel');

await key('KeyZ');
await page.waitForTimeout(600);
await shot('09-landmark-page2');

await key('KeyX'); // close
await page.waitForTimeout(400);
await key('Enter'); // pause map
await page.waitForTimeout(600);
await shot('10-pause-map');

await key('ShiftLeft'); // landmark list tab
await page.waitForTimeout(400);
await shot('11-landmark-list');

await key('KeyX'); // leave the pause screen
await page.waitForTimeout(400);

// Travel: stand at the first hub and open its departure menu.
const hub = await page.evaluate(() => {
  const sys = globalThis.handheld;
  const world = sys.stack[sys.stack.length - 1];
  const h = world?.map?.hubs?.[0];
  if (!h) return null;
  world.x = h.postX;
  world.y = h.postY;
  return h.name;
});
await page.waitForTimeout(300);
await shot('12-at-hub');
if (hub) {
  await key('KeyZ');
  await page.waitForTimeout(600);
  await shot('13-departures');
  await key('KeyZ'); // depart
  await page.waitForTimeout(1500);
  await shot('14-cutscene');
  await page.waitForTimeout(4000);
  await shot('15-cutscene-late');
  await key('KeyZ'); // skip to arrival
  await page.waitForTimeout(2500);
  await shot('16-arrived');
}

const state = await page.evaluate(() => {
  const sys = globalThis.handheld;
  return { look: sys.lookId, scenes: sys.stack.length, running: sys.running };
});

// Landscape, to prove the other layout works.
await page.setViewportSize({ width: 900, height: 420 });
await page.waitForTimeout(500);
await shot('17-landscape');

await browser.close();
server.close();

console.log(`nearest landmark: ${near}`);
console.log(`hub: ${hub}`);
console.log(`state: ${JSON.stringify(state)}`);
if (problems.length) {
  console.error(`\n${problems.length} problem(s):`);
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`\nNo console errors. Screenshots in ${OUT}`);
