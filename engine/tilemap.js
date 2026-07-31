// Camera + tilemap drawing, shared by any game that uses a compiled geo map.

import { TILESET, TILE } from './tiles.js';

/** Clamp a camera so it never shows outside the map. */
export function clampCamera(map, cx, cy, viewW, viewH) {
  const maxX = Math.max(0, map.w * TILE - viewW);
  const maxY = Math.max(0, map.h * TILE - viewH);
  return [Math.max(0, Math.min(maxX, Math.round(cx))), Math.max(0, Math.min(maxY, Math.round(cy)))];
}

/** Centre the camera on a world position. */
export function cameraFor(map, x, y, viewW, viewH) {
  return clampCamera(map, x - viewW / 2, y - viewH / 2, viewW, viewH);
}

/**
 * Draw the visible slice of a compiled map.
 * @param {Screen} screen
 * @param {object} map compiled by engine/geo.js
 * @param {number} camX world pixel of the left edge
 * @param {number} camY world pixel of the top edge
 * @param {object} [opts]
 * @param {number} [opts.viewH] height of the map viewport (the rest is HUD)
 */
export function drawMap(screen, map, camX, camY, opts = {}) {
  const viewH = opts.viewH ?? screen.h;
  const viewY = opts.viewY ?? 0;
  const tx0 = Math.floor(camX / TILE);
  const ty0 = Math.floor(camY / TILE);
  const offX = camX - tx0 * TILE;
  const offY = camY - ty0 * TILE;
  const cols = Math.ceil((screen.w + offX) / TILE);
  const rows = Math.ceil((viewH + offY) / TILE);
  const over = map.over;

  screen.clip(0, viewY, screen.w, viewH);
  for (let row = 0; row < rows; row++) {
    const ty = ty0 + row;
    const dy = viewY + row * TILE - offY;
    if (ty < 0 || ty >= map.h) {
      screen.fill(0, dy, screen.w, TILE, 0);
      continue;
    }
    const base = ty * map.w;
    for (let col = 0; col < cols; col++) {
      const tx = tx0 + col;
      const dx = col * TILE - offX;
      if (tx < 0 || tx >= map.w) {
        screen.fill(dx, dy, TILE, TILE, 0);
        continue;
      }
      const i = base + tx;
      screen.tile(TILESET, map.tiles[i], dx, dy, map.slots[i]);
      // Second pass: tree crowns and cast shadows. These tiles are mostly
      // TRANSPARENT, so they blend with the ground underneath - the framebuffer
      // has no alpha channel, but a dithered overlay gets the same effect.
      const o = over && over[i];
      if (o) screen.tile(TILESET, o, dx, dy, map.overSlot[i]);
    }
  }
  screen.noClip();
}

/**
 * Render the whole map, heavily downsampled, into a small preview buffer.
 * Used by the in-game pause map. Returns { w, h, px } of framebuffer bytes.
 */
export function minimap(map, maxW, maxH, palette) {
  const step = Math.max(1, Math.ceil(Math.max(map.w / maxW, map.h / maxH)));
  const w = Math.ceil(map.w / step);
  const h = Math.ceil(map.h / step);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(map.w - 1, x * step);
      const sy = Math.min(map.h - 1, y * step);
      out[y * w + x] = palette(map.mat[sy * map.w + sx]);
    }
  }
  return { w, h, px: out };
}
