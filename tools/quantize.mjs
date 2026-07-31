// Reduce a full-colour image to a small adaptive palette with error-diffused
// dithering - the colour equivalent of what tools/pixelize.mjs does in grey.
//
// Median cut for the palette, Floyd-Steinberg for the dither. No dependencies.

/** Apply a tone curve in place: contrast around mid, gamma, saturation. */
export function tone(rgb, { contrast = 1, gamma = 1, saturation = 1, brightness = 0 } = {}) {
  const out = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i += 3) {
    let r = rgb[i] / 255;
    let g = rgb[i + 1] / 255;
    let b = rgb[i + 2] / 255;

    if (saturation !== 1) {
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      r = l + (r - l) * saturation;
      g = l + (g - l) * saturation;
      b = l + (b - l) * saturation;
    }
    const curve = (v) => {
      let x = (v - 0.5) * contrast + 0.5 + brightness;
      x = x < 0 ? 0 : x > 1 ? 1 : x;
      return Math.pow(x, gamma) * 255;
    };
    out[i] = curve(r);
    out[i + 1] = curve(g);
    out[i + 2] = curve(b);
  }
  return out;
}

/**
 * Median-cut palette.
 * @param {Float32Array|Uint8Array} rgb interleaved samples
 * @param {number} colors target palette size (rounded down to a power of two)
 * @returns {number[][]} array of [r,g,b]
 */
export function medianCut(rgb, colors = 64) {
  const n = rgb.length / 3;
  let indices = new Uint32Array(n);
  for (let i = 0; i < n; i++) indices[i] = i;

  let boxes = [{ from: 0, to: n }];
  const channelRange = (box) => {
    const mins = [255, 255, 255];
    const maxs = [0, 0, 0];
    for (let i = box.from; i < box.to; i++) {
      const p = indices[i] * 3;
      for (let c = 0; c < 3; c++) {
        const v = rgb[p + c];
        if (v < mins[c]) mins[c] = v;
        if (v > maxs[c]) maxs[c] = v;
      }
    }
    const spans = [maxs[0] - mins[0], maxs[1] - mins[1], maxs[2] - mins[2]];
    // Weighted for perceived importance, so greens get more palette than blues.
    const weighted = [spans[0] * 0.3, spans[1] * 0.59, spans[2] * 0.11];
    let axis = 0;
    if (weighted[1] > weighted[axis]) axis = 1;
    if (weighted[2] > weighted[axis]) axis = 2;
    return { axis, span: weighted[axis] };
  };

  while (boxes.length < colors) {
    // Split whichever box covers the widest range of colour.
    let target = -1;
    let best = 0;
    let axis = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].to - boxes[i].from < 2) continue;
      const r = channelRange(boxes[i]);
      if (r.span > best) {
        best = r.span;
        target = i;
        axis = r.axis;
      }
    }
    if (target < 0) break;

    const box = boxes[target];
    const slice = Array.from(indices.subarray(box.from, box.to));
    slice.sort((a, b) => rgb[a * 3 + axis] - rgb[b * 3 + axis]);
    indices.set(slice, box.from);
    const mid = box.from + (slice.length >> 1);
    boxes.splice(target, 1, { from: box.from, to: mid }, { from: mid, to: box.to });
  }

  return boxes.map((box) => {
    let r = 0;
    let g = 0;
    let b = 0;
    const count = Math.max(1, box.to - box.from);
    for (let i = box.from; i < box.to; i++) {
      const p = indices[i] * 3;
      r += rgb[p];
      g += rgb[p + 1];
      b += rgb[p + 2];
    }
    return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
  });
}

/**
 * Map an image onto a palette with Floyd-Steinberg error diffusion.
 * @returns {Uint8Array} one palette index per pixel
 */
export function ditherToPalette(rgb, w, h, palette, { diffuse = true, strength = 1 } = {}) {
  const buf = Float32Array.from(rgb);
  const out = new Uint8Array(w * h);
  const pal = palette;

  const nearest = (r, g, b) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < pal.length; i++) {
      const dr = r - pal[i][0];
      const dg = g - pal[i][1];
      const db = b - pal[i][2];
      const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 3;
      const r = buf[i];
      const g = buf[i + 1];
      const b = buf[i + 2];
      const idx = nearest(r, g, b);
      out[y * w + x] = idx;
      if (!diffuse) continue;
      const er = (r - pal[idx][0]) * strength;
      const eg = (g - pal[idx][1]) * strength;
      const eb = (b - pal[idx][2]) * strength;
      const push = (dx, dy, k) => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) return;
        const j = (ny * w + nx) * 3;
        buf[j] += er * k;
        buf[j + 1] += eg * k;
        buf[j + 2] += eb * k;
      };
      push(1, 0, 7 / 16);
      push(-1, 1, 3 / 16);
      push(0, 1, 5 / 16);
      push(1, 1, 1 / 16);
    }
  }
  return out;
}

const hex = (c) => `#${c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

/**
 * Full pipeline: tone curve, adaptive palette, dither.
 * @returns {{pal:string[], px:Uint8Array}}
 */
export function quantizeColor(rgb, w, h, opts = {}) {
  const { colors = 96, ...toneOpts } = opts;
  const toned = tone(rgb, toneOpts);
  const palette = medianCut(toned, colors);
  const px = ditherToPalette(toned, w, h, palette, opts);
  return { pal: palette.map(hex), px };
}
