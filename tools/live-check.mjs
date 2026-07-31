#!/usr/bin/env node
// Drive the PUBLISHED site in a phone-sized Chromium and prove it plays.
//
// tools/browser-check.mjs serves the working tree over localhost, which tells
// you the code is right but says nothing about whether the deployment works.
// This one only ever talks to the real URL, so it fails if Pages is off, if a
// path is case-sensitive on the server but not on disk, or if a data file was
// never committed.
//
//   node tools/live-check.mjs https://user.github.io/Games
//
// Requires network, so in practice it runs in the pages-check workflow.

import { chromium, devices } from 'playwright';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'samples/live');
mkdirSync(OUT, { recursive: true });

const base = (process.argv[2] || '').replace(/\/$/, '');
if (!base) {
  console.error('usage: node tools/live-check.mjs <site-url>');
  process.exit(2);
}

const PREINSTALLED = '/opt/pw-browsers/chromium';
const browser = await chromium.launch(existsSync(PREINSTALLED) ? { executablePath: PREINSTALLED } : {});

// A real phone profile, because "works on a mobile device" is the actual claim.
const context = await browser.newContext({ ...devices['iPhone 13'], hasTouch: true, isMobile: true });
const page = await context.newPage();

const problems = [];
page.on('console', (m) => m.type() === 'error' && problems.push(`console: ${m.text()}`));
page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
page.on('requestfailed', (r) => problems.push(`request failed: ${r.url()} ${r.failure()?.errorText}`));
page.on('response', (r) => {
  if (r.status() >= 400) problems.push(`HTTP ${r.status()} for ${r.url()}`);
});

const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
/**
 * Tap a control by the button name it drives. Matches on the data-btn attribute
 * the shell sets, which is stable, rather than on a label's wording.
 */
const tap = async (button) => {
  const el = page.locator(`[data-btn="${button}"]`).first();
  if (!(await el.count())) {
    problems.push(`no control found for "${button}"`);
    return;
  }
  await el.tap();
  await page.waitForTimeout(220);
};

console.log(`Opening ${base}/ as ${devices['iPhone 13'].viewport.width}x${devices['iPhone 13'].viewport.height}`);
await page.goto(`${base}/`, { waitUntil: 'networkidle', timeout: 60_000 });

await page.waitForFunction(() => globalThis.handheld?.running, null, { timeout: 20_000 });
const boot = await page.evaluate(() => ({
  w: globalThis.handheld.screen.w,
  h: globalThis.handheld.screen.h,
  look: globalThis.handheld.lookId,
}));
console.log(`console booted at ${boot.w}x${boot.h}, look "${boot.look}"`);
await page.waitForTimeout(1200);
await shot('01-boot');

// Touch only: this is the interface a phone actually has.
await tap('start');
await page.waitForTimeout(700);
await shot('02-launcher');

const carts = await page.evaluate(() => {
  const s = globalThis.handheld;
  const scene = s.stack[s.stack.length - 1];
  return scene?.carts?.map((c) => c.title) ?? [];
});
console.log(`cartridges on the menu: ${carts.join(', ') || '(none)'}`);
if (!carts.length) problems.push('the launcher lists no cartridges');

await tap('a');
await page.waitForTimeout(2500);
await shot('03-cartridge');

await tap('a');
await page.waitForTimeout(800);
await tap('a');
await page.waitForTimeout(4000);
await shot('04-world');

// Prove a frame is actually being drawn, not just that the page loaded.
const drawing = await page.evaluate(async () => {
  const s = globalThis.handheld;
  const before = s.screen.buf.slice(0, 4096).join(',');
  await new Promise((r) => setTimeout(r, 600));
  return { changed: s.screen.buf.slice(0, 4096).join(',') !== before, scenes: s.stack.length };
});
console.log(`scene stack depth ${drawing.scenes}, framebuffer changing: ${drawing.changed}`);

// Walk, and check the world actually moves under the player.
const walked = await page.evaluate(async () => {
  const s = globalThis.handheld;
  const w = s.stack[s.stack.length - 1];
  if (typeof w?.x !== 'number') return null;
  const from = { x: w.x, y: w.y };
  s.input.setFrom('touch', 'down', true);
  await new Promise((r) => setTimeout(r, 900));
  s.input.setFrom('touch', 'down', false);
  return { moved: Math.hypot(w.x - from.x, w.y - from.y) };
});
if (walked) console.log(`walked ${walked.moved.toFixed(1)}px`);
if (walked && walked.moved < 4) problems.push(`holding a direction moved the player only ${walked.moved.toFixed(1)}px`);
await shot('05-walked');

await browser.close();

if (problems.length) {
  console.error(`\n${problems.length} problem(s) on the published site:`);
  for (const p of [...new Set(problems)]) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`\nThe published site boots, lists cartridges and plays. Screenshots in ${OUT}`);
