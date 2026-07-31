// Everything BEACON puts on the framebuffer.
//
// Two rules run through all of it. Nothing knows the screen size: every figure
// is derived in `layoutFor` from `screen.w`/`screen.h` and the rest is polar
// arithmetic around the rocks. And nothing is told apart by colour: water is
// dark, the beam and the hulls are light, the reef is mid-grey, so the picture
// survives the mono looks where every slot collapses to one four-shade ramp.

import { SLOT, px } from '../../engine/gfx.js';
import { rng } from './sim.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

export const HUD_H = 12;

/**
 * Derive the whole picture from a framebuffer size.
 *
 * The rocks sit on the bottom edge with the tower on them, and `spawnR` is the
 * radius at which a ship is comfortably off screen at any bearing - so on a
 * wide console you see more sea, not a different game.
 *
 * @param {number} w
 * @param {number} h
 */
export function layoutFor(w, h) {
  const hud = HUD_H;
  const cx = Math.round(w / 2);
  const rockY = h - 1;
  const field = rockY - hud;
  const rockR = clamp(Math.round(Math.min(w, field) * 0.17), 13, 40);
  const towerH = clamp(Math.round(rockR * 1.05), 13, 34);
  const spawnR = Math.hypot(Math.max(cx, w - cx) + 10, field + 12);
  return {
    w,
    h,
    hud,
    cx,
    rockY,
    rockR,
    towerH,
    lampX: cx,
    lampY: rockY - towerH,
    spawnR,
    rockRho: rockR / spawnR,
    // Hulls are authored at a 190px reference radius and scale with the screen,
    // so a sloop stays a readable speck rather than a single pixel.
    shipScale: clamp(spawnR / 190, 0.72, 1.7),
    swell: makeSwell(w, h),
  };
}

/** Fixed sea texture: short dashes that drift and wrap. Seeded, never random. */
function makeSwell(w, h) {
  const rand = rng(0x5ea1 ^ (w * 31 + h));
  const count = Math.round((w * h) / 1100);
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    out[i * 3] = rand() * w;
    out[i * 3 + 1] = rand() * h;
    out[i * 3 + 2] = 5 + rand() * 9; // drift speed, px/s
  }
  return out;
}

/** Screen position of a ship (or anything) at bearing `theta`, radius `rho`. */
export function polar(L, theta, rho) {
  return [L.cx + L.spawnR * rho * Math.sin(theta), L.rockY - L.spawnR * rho * Math.cos(theta)];
}

/**
 * A layout nudged by the wreck shake. The whole scene is drawn from the layout,
 * so displacing it displaces the world without touching any draw call.
 */
export function jitter(L, world) {
  if (world.shake <= 0) return L;
  const k = world.shake * 6;
  const ox = Math.round(Math.sin(world.time * 61) * k);
  const oy = Math.round(Math.sin(world.time * 47 + 1.7) * k * 0.6);
  return { ...L, cx: L.cx + ox, rockY: L.rockY + oy, lampX: L.lampX + ox, lampY: L.lampY + oy };
}

/**
 * Water, fog and beam in a single pass over the playfield. One pass because
 * all three are functions of the same distance from the lamp, and because
 * 60 frames a second of per-pixel work wants to be done once.
 *
 * @param {import('../../engine/gfx.js').Screen} screen
 * @param {object} L layout
 * @param {{beam:number, half:number, reach:number, fog:number}} lamp
 */
export function drawSea(screen, L, lamp) {
  const { beam, half, fog } = lamp;
  const bx = Math.sin(beam);
  const by = -Math.cos(beam);
  const tanHalf = Math.tan(half);
  const reachPx = lamp.reach * L.spawnR;

  // Fog closes the sea in around the tower; on a clear night the pool of light
  // reaches most of the way out.
  const visR = L.spawnR * (1 - 0.6 * fog);
  const b1 = visR * 0.4;
  const b2 = visR * 0.86;
  const inv = 1 / Math.max(1, b2 - b1);

  const water0 = px(SLOT.DEEP, 2);
  const water1 = px(SLOT.DEEP, 3);
  const water2 = px(SLOT.NIGHT, 3);
  const glowA = px(SLOT.GOLD, 0);
  const glowB = px(SLOT.GOLD, 1);

  const buf = screen.buf;
  const W = screen.w;
  for (let y = L.hud; y < L.h; y++) {
    const dy = y - L.lampY;
    const row = y * W;
    const bandY = (y & 3) * 4;
    for (let x = 0; x < W; x++) {
      const dx = x - L.lampX;
      const dither = BAYER[bandY + (x & 3)] / 16;

      const along = dx * bx + dy * by;
      let byte = 0;
      if (along > 0 && along <= reachPx) {
        const perp = Math.abs(dx * -by + dy * bx);
        const edge = along * tanHalf;
        if (perp <= edge) {
          const e = perp / (edge + 0.001);
          const near = 1 - along / reachPx;
          const inten = (1 - e * e * 0.85) * (0.34 + 0.8 * near);
          if (inten > 0.6 + dither * 0.3) byte = glowA;
          else if (inten > 0.16 + dither * 0.34) byte = glowB;
        }
      }

      if (!byte) {
        const r = Math.hypot(dx, dy);
        if (r < b1) byte = water0;
        else if (r < b2) byte = (r - b1) * inv > dither ? water1 : water0;
        else if (r < visR) byte = water1;
        else byte = water2;
      }
      buf[row + x] = byte;
    }
  }
}

/** Drifting swell, catching the light where the beam crosses it. */
export function drawSwell(screen, L, lamp, time) {
  const s = L.swell;
  const bx = Math.sin(lamp.beam);
  const by = -Math.cos(lamp.beam);
  const tanHalf = Math.tan(lamp.half);
  const reachPx = lamp.reach * L.spawnR;
  const visR = L.spawnR * (1 - 0.6 * lamp.fog);
  const dark = px(SLOT.DEEP, 1);
  const bright = px(SLOT.GOLD, 0);
  const fieldH = L.h - L.hud;

  for (let i = 0; i < s.length; i += 3) {
    const x = s[i];
    const y = L.hud + ((s[i + 1] + time * s[i + 2]) % fieldH);
    const dx = x - L.lampX;
    const dy = y - L.lampY;
    if (Math.hypot(dx, dy) > visR) continue;
    const along = dx * bx + dy * by;
    const lit = along > 0 && along <= reachPx && Math.abs(dx * -by + dy * bx) <= along * tanHalf;
    screen.fill(Math.round(x) - 1, Math.round(y), 3, 1, lit ? bright : dark);
  }
}

/** The reef, the surf line, and the ring that says you have left it too late. */
export function drawRocks(screen, L, world, time) {
  const rock = px(SLOT.CONCRETE, 3);
  const face = px(SLOT.CONCRETE, 2);
  const surf = px(SLOT.UI, 0);
  const r = L.rockR;

  for (let y = -r; y <= 2; y++) {
    const yy = L.rockY + y;
    if (yy < L.hud || yy >= L.h) continue;
    const t = 1 - (y * y) / (r * r);
    if (t <= 0) continue;
    const halfW = Math.round(r * 1.25 * Math.sqrt(t));
    screen.fill(L.cx - halfW, yy, halfW * 2 + 1, 1, rock);
    // A lit face on the lamp side of every ledge, so the reef has a shape.
    if (y > -r + 2) {
      screen.set(L.cx - halfW + 1, yy, face);
      screen.set(L.cx + halfW - 1, yy, face);
    }
  }
  // Broken water around the rocks, moving with the swell.
  for (let i = 0; i < 14; i++) {
    const a = -1.35 + (i / 13) * 2.7;
    const wob = 1.5 * Math.sin(time * 2.1 + i * 1.9);
    const rr = r * 1.28 + wob;
    const x = Math.round(L.cx + rr * Math.sin(a) * 1.25);
    const y = Math.round(L.rockY - rr * Math.cos(a));
    if (y >= L.hud) screen.fill(x - 1, y, 2, 1, surf);
  }

  // The last ring: dotted normally, solid and bright when a hull is inside it.
  const ringRho = 0.34;
  const inside = world.ships.some((s) => !s.turning && s.rho < ringRho);
  const flash = inside && Math.floor(time * 6) % 2 === 0;
  dottedArc(screen, L, ringRho, flash ? px(SLOT.UI, 0) : px(SLOT.UI, 2), inside ? 2 : 5);
}

/** A dotted arc at radius `rho`, across the bearings ships can arrive from. */
export function dottedArc(screen, L, rho, byte, step = 4) {
  const r = L.spawnR * rho;
  const n = Math.max(12, Math.round((r * 2.6) / step));
  for (let i = 0; i <= n; i++) {
    const a = -1.5 + (i / n) * 3.0;
    const x = Math.round(L.cx + r * Math.sin(a));
    const y = Math.round(L.rockY - r * Math.cos(a));
    if (y >= L.hud && y < L.h) screen.set(x, y, byte);
  }
}

/** The tower: banded, with the lamp room burning at the top. */
export function drawTower(screen, L, world, time) {
  const light = px(SLOT.UI, 0);
  const dark = px(SLOT.UI, 3);
  const mid = px(SLOT.UI, 2);
  const lamp = px(SLOT.GOLD, 0);
  const top = L.lampY;
  const baseW = Math.max(7, Math.round(L.towerH * 0.42) | 1);
  const topW = Math.max(5, baseW - 2);

  for (let y = top; y <= L.rockY; y++) {
    const k = (y - top) / Math.max(1, L.rockY - top);
    const half = Math.round((topW + (baseW - topW) * k) / 2);
    if (y < L.hud) continue;
    // Bands rather than a colour: the stripes read on every look.
    const band = Math.floor(((y - top) / Math.max(3, L.towerH / 3.5)) % 2) === 1;
    screen.fill(L.cx - half, y, half * 2 + 1, 1, band ? mid : light);
    screen.set(L.cx - half, y, dark);
    screen.set(L.cx + half, y, dark);
  }

  // Gallery and lamp room.
  const gw = topW + 2;
  screen.fill(L.cx - (gw >> 1) - 1, top - 1, gw + 3, 2, dark);
  screen.fill(L.cx - (gw >> 1), top - 5, gw + 1, 4, lamp);
  screen.frame(L.cx - (gw >> 1) - 1, top - 6, gw + 3, 6, dark);
  screen.fill(L.cx - 1, top - 8, 3, 2, dark);

  // Halo, breathing slightly, brighter while the horn is answering.
  const pulse = 2 + Math.sin(time * 2.3) + (world.hornFlash > 0 ? 2 : 0);
  ring(screen, L.cx, top - 3, Math.round(3 + pulse), px(SLOT.GOLD, 0), L.hud);
}

function ring(screen, cx, cy, r, byte, minY) {
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const y = Math.round(cy + r * Math.sin(a));
    if (y < minY) continue;
    screen.set(Math.round(cx + r * Math.cos(a)), y, byte);
  }
}

/**
 * A hull, drawn as an oriented blob so it points where it is going. Sizes come
 * from the ship type scaled by the layout, not from a fixed sprite, so ships
 * stay in proportion to the sea they are crossing.
 */
export function drawShip(screen, L, ship, opts = {}) {
  const { visible = true, time = 0 } = opts;
  const [x, y] = polar(L, ship.theta, ship.rho);
  if (y < L.hud - 12 || y > L.h + 12 || x < -20 || x > L.w + 20) return;

  const scale = L.shipScale;
  const len = ship.type.len * scale;
  const wid = ship.type.beam * scale;
  // Inbound ships point at the rocks; a ship that has been turned runs out.
  const sgn = ship.turning ? -1 : 1;
  const hx = -Math.sin(ship.theta) * sgn;
  const hy = Math.cos(ship.theta) * sgn;

  const echoing = ship.echo > 0;
  if (!visible && !echoing) return;

  if (!visible) {
    // Answering the horn out in the fog: a position, not a portrait.
    const blink = Math.floor(ship.echo * 12) % 2 === 0;
    diamond(screen, x, y, Math.round(4 + 3 * ship.echo), blink ? px(SLOT.UI, 0) : px(SLOT.UI, 2), L.hud);
    blob(screen, x, y, hx, hy, len, wid, px(SLOT.UI, 2), L.hud);
    return;
  }

  // Close in and still unlit: blink, so a hull about to strike is never quiet.
  const danger = !ship.turning && ship.rho < 0.3 && Math.floor(time * 7) % 2 === 0;
  const hull = ship.turning ? px(SLOT.UI, 1) : ship.lit > 0.4 ? px(SLOT.UI, 0) : danger ? px(SLOT.UI, 3) : px(SLOT.UI, 1);
  blob(screen, x, y, hx, hy, len + 2, wid + 2, px(SLOT.NIGHT, 3), L.hud);
  blob(screen, x, y, hx, hy, len, wid, hull, L.hud);
  if (echoing) diamond(screen, x, y, Math.round(5 + 3 * ship.echo), px(SLOT.UI, 0), L.hud);

  // Superstructure aft, and a bow lantern, both in shade rather than colour.
  const sx = x - hx * len * 0.18;
  const sy = y - hy * len * 0.18;
  if (ship.type.len > 10) screen.fill(Math.round(sx) - 1, Math.round(sy) - 1, 2, 2, px(SLOT.UI, 3));
  screen.set(Math.round(x + hx * len * 0.44), Math.round(y + hy * len * 0.44), px(SLOT.ACCENT, 0));

  // Warning charge: how close this hull is to putting its helm over.
  if (ship.charge > 0.03 && !ship.turning) {
    const bw = Math.max(6, Math.round(len));
    const bx = Math.round(x - bw / 2);
    const by = Math.round(y - wid / 2 - 5);
    if (by >= L.hud) {
      screen.fill(bx, by, bw, 3, px(SLOT.NIGHT, 3));
      screen.fill(bx, by, Math.max(1, Math.round(bw * ship.charge)), 3, px(SLOT.GOLD, 0));
      screen.frame(bx - 1, by - 1, bw + 2, 5, px(SLOT.UI, 3));
    }
  }
}

function blob(screen, x, y, hx, hy, len, wid, byte, minY) {
  const half = len / 2;
  for (let u = -half; u <= half; u += 0.5) {
    const t = u / half;
    const k = 1 - t * t;
    if (k <= 0) continue;
    // Pointed forward, full aft: a hull, not a lozenge.
    const hw = (wid / 2) * Math.sqrt(k) * (t > 0 ? 1 - 0.42 * t : 1);
    for (let v = -hw; v <= hw; v += 0.5) {
      const py = Math.round(y + u * hy + v * hx);
      if (py < minY) continue;
      screen.set(Math.round(x + u * hx - v * hy), py, byte);
    }
  }
}

function diamond(screen, x, y, r, byte, minY) {
  for (let i = 0; i <= r; i++) {
    const j = r - i;
    for (const [dx, dy] of [
      [i, j],
      [-i, j],
      [i, -j],
      [-i, -j],
    ]) {
      const py = Math.round(y + dy);
      if (py < minY) continue;
      screen.set(Math.round(x + dx), py, byte);
    }
  }
}

/** An expanding ring where a hull went onto the reef. */
export function drawWreck(screen, L, mark) {
  const [x, y] = polar(L, mark.theta, L.rockRho);
  const r = Math.round(4 + mark.age * 46);
  ring(screen, x, y, r, px(SLOT.UI, mark.age < 0.2 ? 0 : 2), L.hud);
  ring(screen, x, y, Math.max(1, r - 3), px(SLOT.UI, 3), L.hud);
}
