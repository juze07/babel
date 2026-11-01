/** Atlas-style terrain rendering (pre-rendered once per world into an offscreen canvas). */
export interface TerrainData { W: number; H: number; height: ArrayLike<number>; biome: ArrayLike<number> }

const C = {
  deep: [24, 45, 60], shallow: [44, 82, 99], coastWater: [86, 128, 140],
  beach: [218, 203, 164], grass: [170, 178, 128], forest: [110, 135, 92], hills: [178, 160, 118], mountain: [140, 124, 101], snow: [236, 231, 220], desert: [214, 186, 132],
};
const BIOME_COL = [C.deep, C.shallow, C.beach, C.grass, C.forest, C.hills, C.mountain, C.snow, C.desert];

function hash(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function renderTerrain(t: TerrainData, scale = 4): HTMLCanvasElement {
  const { W, H, height, biome } = t;
  const cw = W * scale, ch = H * scale;
  const cv = document.createElement('canvas');
  cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(cw, ch);
  const d = img.data;
  const hAt = (x: number, y: number) => {
    const x0 = Math.max(0, Math.min(W - 1, Math.floor(x))), y0 = Math.max(0, Math.min(H - 1, Math.floor(y)));
    const x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(H - 1, y0 + 1);
    const fx = Math.max(0, Math.min(1, x - x0)), fy = Math.max(0, Math.min(1, y - y0));
    const a = height[y0 * W + x0], b = height[y0 * W + x1], c = height[y1 * W + x0], e = height[y1 * W + x1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
  };
  for (let py = 0; py < ch; py++) {
    for (let px = 0; px < cw; px++) {
      const gx = px / scale - 0.5, gy = py / scale - 0.5;
      const h = hAt(gx, gy);
      const cx = Math.max(0, Math.min(W - 1, Math.round(gx))), cy = Math.max(0, Math.min(H - 1, Math.round(gy)));
      let r: number, g: number, b: number;
      const n = (hash(px, py) - 0.5) * 7;
      if (h < 0) {
        const f = Math.max(0, Math.min(1, (h + 0.55) / 0.55));
        r = C.deep[0] + (C.shallow[0] - C.deep[0]) * f;
        g = C.deep[1] + (C.shallow[1] - C.deep[1]) * f;
        b = C.deep[2] + (C.shallow[2] - C.deep[2]) * f;
        if (h > -0.035) { r = (r + C.coastWater[0]) / 2; g = (g + C.coastWater[1]) / 2; b = (b + C.coastWater[2]) / 2; }
        // faint contour ripples offshore
        const ripple = Math.abs(((h * 26) % 1) + 1) % 1;
        if (h > -0.3 && ripple < 0.06) { r += 8; g += 10; b += 10; }
      } else {
        // bilinear blend of neighbouring biome colours for soft transitions
        const bx0 = Math.max(0, Math.min(W - 1, Math.floor(gx))), by0 = Math.max(0, Math.min(H - 1, Math.floor(gy)));
        const bx1 = Math.min(W - 1, bx0 + 1), by1 = Math.min(H - 1, by0 + 1);
        const tx = Math.max(0, Math.min(1, gx - bx0)), ty = Math.max(0, Math.min(1, gy - by0));
        const pick = (xx: number, yy: number) => { const b = biome[yy * W + xx]; return b <= 1 ? C.beach : BIOME_COL[b] ?? C.grass; };
        const c00 = pick(bx0, by0), c10 = pick(bx1, by0), c01 = pick(bx0, by1), c11 = pick(bx1, by1);
        let col = [0, 1, 2].map((q) => (c00[q] * (1 - tx) + c10[q] * tx) * (1 - ty) + (c01[q] * (1 - tx) + c11[q] * tx) * ty);
        void cx; void cy;
        if (h < 0.025) col = C.beach;
        // hillshade from NW light
        const dx = hAt(gx + 0.6, gy) - hAt(gx - 0.6, gy);
        const dy = hAt(gx, gy + 0.6) - hAt(gx, gy - 0.6);
        const shade = Math.max(-0.35, Math.min(0.35, (-dx - dy) * 3.2));
        const lift = 1 + shade;
        r = col[0] * lift; g = col[1] * lift; b = col[2] * lift;
        // contour lines on land
        const cl = (h * 12) % 1;
        if (h > 0.08 && cl < 0.045) { r *= 0.9; g *= 0.9; b *= 0.88; }
        if (h < 0.012) { r = r * 0.6 + 60 * 0.4; g = g * 0.6 + 55 * 0.4; b = b * 0.6 + 45 * 0.4; } // coastline ink
      }
      const i = (py * cw + px) * 4;
      d[i] = Math.max(0, Math.min(255, r + n));
      d[i + 1] = Math.max(0, Math.min(255, g + n));
      d[i + 2] = Math.max(0, Math.min(255, b + n));
      d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // vignette
  const grad = ctx.createRadialGradient(cw / 2, ch / 2, Math.min(cw, ch) * 0.35, cw / 2, ch / 2, Math.max(cw, ch) * 0.75);
  grad.addColorStop(0, 'rgba(0,0,0,0)');
  grad.addColorStop(1, 'rgba(10,18,26,0.35)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);
  return cv;
}

export function hslToRgb(hsl: string): [number, number, number] {
  const m = hsl.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!m) return [128, 128, 128];
  const h = Number(m[1]) / 360, s = Number(m[2]) / 100, l = Number(m[3]) / 100;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [Math.round(f(h + 1 / 3) * 255), Math.round(f(h) * 255), Math.round(f(h - 1 / 3) * 255)];
}

/** Soft language-territory overlay: each land cell takes the colour of the nearest inhabited settlement's language. */
export function renderTerritories(t: TerrainData, settlements: { x: number; y: number; lang: number; pop: number }[], colorOf: (lang: number) => string | null, radius = 24): HTMLCanvasElement {
  const { W, H, height } = t;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const cols = settlements.map((s) => (s.lang >= 0 && s.pop > 0 ? colorOf(s.lang) : null)).map((c) => (c ? hslToRgb(c) : null));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (height[y * W + x] < -0.01) continue;
    let best = -1, bd = Infinity;
    settlements.forEach((s, i) => {
      if (!cols[i]) return;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bd) { bd = d; best = i; }
    });
    if (best < 0) continue;
    const dist = Math.sqrt(bd);
    if (dist > radius) continue;
    const c = cols[best]!;
    const i = (y * W + x) * 4;
    img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2];
    img.data[i + 3] = Math.round(140 * (1 - Math.pow(dist / radius, 2)));
  }
  ctx.putImageData(img, 0, 0);
  return cv;
}
