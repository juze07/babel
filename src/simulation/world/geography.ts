/**
 * WORLD GENERATION — procedural terrain, biomes, settlements and travel routes.
 * Geography matters linguistically through one channel: the *contact matrix*, derived from
 * least-cost travel paths (sea and mountains are expensive). Contact determines how often agents
 * from different settlements talk, which in turn controls convergence vs divergence.
 * Biomes determine what people talk about (concept salience), so vocabulary for unused things decays.
 */
import { Rng } from '../core/rng';
import type { SimConfig } from '../core/config';
import { CONCEPTS, N_CONTENT, type Biome } from '../language/concepts';
import { inventForm, romanize } from '../language/phonology';

export const MAP_W = 192;
export const MAP_H = 120;

export enum B { Deep, Shallow, Beach, Grass, Forest, Hills, Mountain, Snow, Desert }
export const BIOME_NAMES = ['Deep sea', 'Shallows', 'Coast', 'Grassland', 'Forest', 'Hills', 'Mountains', 'Peaks', 'Steppe'];
const MOVE_COST = [7, 3.2, 1, 1, 1.5, 2.2, 5, 10, 1.6];
const RICHNESS = [0.2, 0.9, 1.0, 0.95, 0.8, 0.6, 0.3, 0.1, 0.35];

export interface Terrain {
  W: number;
  H: number;
  height: Float32Array;
  moisture: Float32Array;
  biome: Uint8Array;
  region: Int16Array; // connected land component id, -1 water
}

export interface Settlement {
  id: number;
  name: string;
  x: number;
  y: number;
  region: number;
  biomeShare: Record<Biome, number>;
  salience: Float64Array; // concept discourse salience
  baseFood: number;
  climate: number;
  phase: number;
  food: number;
  capacity: number;
  alive: boolean;
  founded: number;
}

export interface Route {
  a: number;
  b: number;
  cost: number;
  path: number[]; // flattened x,y pairs (downsampled)
  sea: number; // fraction of path over water
  trade: boolean;
  blocked: boolean;
}

/* ---------- noise ---------- */
function makeNoise(rng: Rng) {
  const N = 256;
  const perm = new Uint8Array(N * 2);
  const vals = new Float32Array(N);
  const p = Array.from({ length: N }, (_, i) => i);
  rng.shuffle(p);
  for (let i = 0; i < N * 2; i++) perm[i] = p[i % N];
  for (let i = 0; i < N; i++) vals[i] = rng.next() * 2 - 1;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const fade = (t: number) => t * t * (3 - 2 * t);
  const v2 = (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = fade(x - xi), yf = fade(y - yi);
    const h = (i: number, j: number) => vals[perm[(perm[(i & 255)] + (j & 255)) & 511]];
    return lerp(lerp(h(xi, yi), h(xi + 1, yi), xf), lerp(h(xi, yi + 1), h(xi + 1, yi + 1), xf), yf);
  };
  return (x: number, y: number, oct = 5) => {
    let s = 0, a = 0.5, f = 1, n = 0;
    for (let o = 0; o < oct; o++) { s += a * v2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
    return s / n;
  };
}

/* ---------- terrain ---------- */
export function generateTerrain(cfg: SimConfig, rng: Rng): { terrain: Terrain; centers: { x: number; y: number; r: number }[] } {
  const W = MAP_W, H = MAP_H;
  const noise = makeNoise(rng);
  const moistNoise = makeNoise(rng);
  const height = new Float32Array(W * H);
  const moisture = new Float32Array(W * H);
  const centers: { x: number; y: number; r: number }[] = [];
  const aspect = W / H;

  const placeCenters = (k: number, minD: number, radius: number) => {
    for (let i = 0; i < k; i++) {
      let best = { x: 0.5, y: 0.5 }, bestD = -1;
      for (let t = 0; t < 60; t++) {
        const c = { x: rng.range(0.16, 0.84), y: rng.range(0.18, 0.82) };
        let d = Infinity;
        for (const o of centers) d = Math.min(d, Math.hypot((c.x - o.x) * aspect, c.y - o.y));
        if (d > bestD) { bestD = d; best = c; }
        if (d > minD) break;
      }
      centers.push({ ...best, r: radius * rng.range(0.8, 1.2) });
    }
  };

  const type = cfg.worldType;
  if (type === 'archipelago') placeCenters(Math.max(2, cfg.regions), 0.45, 0.17);
  if (type === 'custom') placeCenters(Math.max(1, cfg.regions), 0.25 + cfg.separation * 0.5, (0.12 + cfg.landRatio * 0.5) / Math.sqrt(Math.max(1, cfg.regions)));
  if (type === 'trading') placeCenters(Math.max(3, cfg.regions), 0.3, 0.12);

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H;
      const n = noise(u * 6, v * 6 * (H / W) * aspect);
      const ridge = 1 - Math.abs(noise(u * 4 + 9.1, v * 4 + 3.3, 4)) * 2;
      let h = 0;
      if (type === 'archipelago' || type === 'custom') {
        let m = -1;
        for (const c of centers) {
          const d = Math.hypot((u - c.x) * aspect, v - c.y);
          m = Math.max(m, (c.r - d) / c.r);
        }
        if (type === 'custom' && cfg.regions <= 1) {
          const d = Math.hypot((u - 0.5) * 1.3, (v - 0.5) * 1.6);
          m = (0.25 + cfg.landRatio * 0.4 - d) / 0.4;
        }
        const sepFactor = type === 'custom' ? 0.18 + (1 - cfg.separation) * 0.25 : 0.2;
        h = m * 0.85 + n * 0.55 - sepFactor + ridge * 0.12 * Math.max(0, m);
      } else if (type === 'continent') {
        const d = Math.hypot((u - 0.5) * 1.25, (v - 0.5) * 1.55);
        h = (0.62 - d) * 1.4 + n * 0.55 + Math.max(0, ridge - 0.55) * 1.1;
      } else if (type === 'valley') {
        const d = Math.hypot((u - 0.5) * 1.3, (v - 0.5) * 1.3 * (H / W) * aspect);
        const ang = Math.atan2(v - 0.5, u - 0.5);
        const pass = Math.exp(-Math.pow((ang - 0.4) / 0.18, 2));
        const ring = Math.exp(-Math.pow((d - 0.24) / 0.055, 2)) * (1.05 - pass * 0.75);
        const edge = Math.max(0, d - 0.55) * 3;
        h = 0.22 + n * 0.3 + ring * 0.9 - edge;
      } else if (type === 'trading') {
        const d = Math.hypot((u - 0.5) * 1.35, (v - 0.5) * 1.55);
        let m = 0.35 - Math.abs(d - 0.36) * 2.3;
        for (const c of centers) {
          const dc = Math.hypot((u - c.x) * aspect, v - c.y);
          m = Math.max(m, (c.r - dc) / c.r * 0.6);
        }
        h = m + n * 0.5 - 0.05;
      }
      height[y * W + x] = h;
      moisture[y * W + x] = 0.5 + moistNoise(u * 4, v * 4) * 0.9;
    }
  }

  const biome = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const h = height[i], m = moisture[i];
    let b: B;
    if (h < -0.22) b = B.Deep;
    else if (h < 0) b = B.Shallow;
    else if (h < 0.04) b = B.Beach;
    else if (h > 0.72) b = B.Snow;
    else if (h > 0.5) b = B.Mountain;
    else if (h > 0.34) b = B.Hills;
    else if (m > 0.58) b = B.Forest;
    else if (m < 0.3) b = B.Desert;
    else b = B.Grass;
    biome[i] = b;
  }

  // connected land components
  const region = new Int16Array(W * H).fill(-1);
  let rid = 0;
  const stack: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (region[i] !== -1 || biome[i] <= B.Shallow) continue;
    region[i] = rid; stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      const cx = c % W, cy = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (region[ni] === -1 && biome[ni] > B.Shallow) { region[ni] = rid; stack.push(ni); }
      }
    }
    rid++;
  }
  return { terrain: { W, H, height, moisture, biome, region }, centers };
}

/* ---------- settlements ---------- */
function biomeShareAt(t: Terrain, x: number, y: number, r: number): Record<Biome, number> {
  const share: Record<Biome, number> = { sea: 0, coast: 0, grass: 0, forest: 0, hills: 0, mountain: 0, desert: 0 };
  let n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= t.W || ny >= t.H || dx * dx + dy * dy > r * r) continue;
    const b = t.biome[ny * t.W + nx];
    const key: Biome = b <= B.Shallow ? 'sea' : b === B.Beach ? 'coast' : b === B.Grass ? 'grass' : b === B.Forest ? 'forest' : b === B.Hills ? 'hills' : b === B.Desert ? 'desert' : 'mountain';
    share[key]++; n++;
  }
  for (const k in share) share[k as Biome] /= Math.max(1, n);
  return share;
}

export function salienceFor(share: Record<Biome, number>): Float64Array {
  const sal = new Float64Array(N_CONTENT);
  for (let c = 0; c < N_CONTENT; c++) {
    const con = CONCEPTS[c];
    let m = 0;
    for (const k in share) m += share[k as Biome] * (con.biome?.[k as Biome] ?? 1);
    sal[c] = con.freq * m;
  }
  return sal;
}

function richnessAt(t: Terrain, x: number, y: number, r: number): number {
  let s = 0, n = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= t.W || ny >= t.H) continue;
    s += RICHNESS[t.biome[ny * t.W + nx]]; n++;
  }
  return s / n;
}

export function settlementName(rng: Rng): string {
  const f = romanize(inventForm(rng, null, rng.chance(0.5) ? 2 : 3, 0));
  return f[0].toUpperCase() + f.slice(1);
}

export function placeSettlements(cfg: SimConfig, rng: Rng, t: Terrain): Settlement[] {
  const { W, H } = t;
  const cands: { x: number; y: number; score: number; region: number }[] = [];
  for (let y = 4; y < H - 4; y += 2) for (let x = 4; x < W - 4; x += 2) {
    const i = y * W + x;
    const b = t.biome[i];
    if (b < B.Beach || b >= B.Mountain) continue;
    const rich = richnessAt(t, x, y, 4);
    cands.push({ x, y, score: rich + rng.next() * 0.35, region: t.region[i] });
  }
  // region sizes
  const sizes = new Map<number, number>();
  for (const c of cands) sizes.set(c.region, (sizes.get(c.region) ?? 0) + 1);
  const regionsSorted = [...sizes.entries()].filter(([, n]) => n >= 12).sort((a, b) => b[1] - a[1]).map(([r]) => r);
  const quota = new Map<number, number>();
  const S = cfg.settlements;
  if (cfg.worldType === 'archipelago' || cfg.worldType === 'custom' || cfg.worldType === 'trading') {
    const used = regionsSorted.slice(0, Math.min(regionsSorted.length, S));
    let total = 0; for (const r of used) total += Math.sqrt(sizes.get(r)!);
    let assigned = 0;
    for (const r of used) { const q = Math.max(1, Math.floor((S * Math.sqrt(sizes.get(r)!)) / total)); quota.set(r, q); assigned += q; }
    let k = 0;
    while (assigned < S && used.length) { const r = used[k++ % used.length]; quota.set(r, quota.get(r)! + 1); assigned++; }
  }
  const out: Settlement[] = [];
  const minSpacing = cfg.worldType === 'valley' ? 11 : 15;
  cands.sort((a, b) => b.score - a.score);
  const isInsideValley = (x: number, y: number) => Math.hypot((x / W - 0.5) * 1.3, (y / H - 0.5) * 1.3 * (H / W) * (W / H)) < 0.17;
  const valleyInside = cfg.worldType === 'valley' ? Math.min(3, S - 1) : 0;
  for (let pass = 0; pass < 3 && out.length < S; pass++) {
    const spacing = minSpacing * (1 - pass * 0.3);
    for (const c of cands) {
      if (out.length >= S) break;
      if (out.some((s) => Math.hypot(s.x - c.x, s.y - c.y) < spacing)) continue;
      if (quota.size && pass < 2) {
        const q = quota.get(c.region) ?? 0;
        if (q <= 0) continue;
      }
      if (cfg.worldType === 'valley' && pass < 2) {
        const inside = isInsideValley(c.x, c.y);
        const nInside = out.filter((s) => isInsideValley(s.x, s.y)).length;
        if (inside && nInside >= valleyInside) continue;
        if (!inside && nInside < valleyInside) continue;
      }
      if (quota.size) quota.set(c.region, (quota.get(c.region) ?? 1) - 1);
      const share = biomeShareAt(t, c.x, c.y, 7);
      const baseFood = richnessAt(t, c.x, c.y, 6);
      out.push({
        id: out.length, name: settlementName(rng), x: c.x, y: c.y, region: c.region, biomeShare: share,
        salience: salienceFor(share), baseFood, climate: 1, phase: rng.next() * Math.PI * 2, food: baseFood, capacity: 0, alive: true, founded: 0,
      });
    }
  }
  return out;
}

/* ---------- routes (least-cost paths via Dijkstra) ---------- */
class Heap {
  k: number[] = []; v: number[] = [];
  push(key: number, val: number) {
    const k = this.k, v = this.v; k.push(key); v.push(val);
    let i = k.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (v[p] <= v[i]) break; [k[p], k[i]] = [k[i], k[p]]; [v[p], v[i]] = [v[i], v[p]]; i = p; }
  }
  pop(): number {
    const k = this.k, v = this.v; const top = k[0];
    const lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      k[0] = lk; v[0] = lv; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < k.length && v[l] < v[m]) m = l; if (r < k.length && v[r] < v[m]) m = r; if (m === i) break; [k[m], k[i]] = [k[i], k[m]]; [v[m], v[i]] = [v[i], v[m]]; i = m; }
    }
    return top;
  }
  get size() { return this.k.length; }
}

export function computeRoutes(cfg: SimConfig, rng: Rng, t: Terrain, S: Settlement[]): { routes: Route[]; cost: Float64Array } {
  const { W, H } = t;
  const n = S.length;
  const cost = new Float64Array(n * n);
  const prevs: Int32Array[] = [];
  for (let s = 0; s < n; s++) {
    const dist = new Float64Array(W * H).fill(Infinity);
    const prev = new Int32Array(W * H).fill(-1);
    const start = S[s].y * W + S[s].x;
    dist[start] = 0;
    const heap = new Heap(); heap.push(start, 0);
    while (heap.size) {
      const c = heap.pop();
      const cx = c % W, cy = (c / W) | 0;
      const dc = dist[c];
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        const step = (MOVE_COST[t.biome[ni]] + MOVE_COST[t.biome[c]]) * 0.5 * (dx && dy ? 1.414 : 1);
        const nd = dc + step;
        if (nd < dist[ni]) { dist[ni] = nd; prev[ni] = c; heap.push(ni, nd); }
      }
    }
    for (let o = 0; o < n; o++) cost[s * n + o] = dist[S[o].y * W + S[o].x];
    prevs.push(prev);
  }
  const routes: Route[] = [];
  const pathFor = (a: number, b: number): { path: number[]; sea: number } => {
    const prev = prevs[a];
    let c = S[b].y * W + S[b].x;
    const pts: number[] = [];
    let water = 0, total = 0, k = 0;
    while (c !== -1) {
      if (k++ % 3 === 0) pts.push(c % W, (c / W) | 0);
      if (t.biome[c] <= B.Shallow) water++;
      total++;
      c = prev[c];
    }
    const sx = S[a].x, sy = S[a].y;
    if (pts[pts.length - 2] !== sx || pts[pts.length - 1] !== sy) pts.push(sx, sy);
    return { path: pts, sea: water / Math.max(1, total) };
  };
  // Each settlement connects to its nearest neighbours by travel cost (migration routes).
  const linked = new Set<string>();
  for (let a = 0; a < n; a++) {
    const order = [...Array(n).keys()].filter((b) => b !== a).sort((x, y) => cost[a * n + x] - cost[a * n + y]);
    for (const b of order.slice(0, 2)) {
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (linked.has(key)) continue;
      linked.add(key);
      const { path, sea } = pathFor(a, b);
      routes.push({ a: Math.min(a, b), b: Math.max(a, b), cost: cost[a * n + b], path, sea, trade: false, blocked: false });
    }
  }
  // Trade routes: medium/long-distance links, preferring different regions.
  const pairs: [number, number, number][] = [];
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
    if (linked.has(`${a}-${b}`)) continue;
    const diff = S[a].region !== S[b].region ? 1.6 : 1;
    pairs.push([a, b, diff / (1 + cost[a * n + b] / 200) + rng.next() * 0.3]);
  }
  pairs.sort((x, y) => y[2] - x[2]);
  for (const [a, b] of pairs.slice(0, cfg.tradeRoutes)) {
    const { path, sea } = pathFor(a, b);
    routes.push({ a, b, cost: cost[a * n + b], path, sea, trade: true, blocked: false });
    linked.add(`${a}-${b}`);
  }
  return { routes, cost };
}

/**
 * Contact matrix: w_ij = exp(-travelCost_ij / contactRange), boosted by trade routes, zeroed by blocked
 * routes (a blocked direct route sets the pair's contact to 0 — interventions such as "raise the sea"),
 * and floored during an initial mixing period (shared ancestral community).
 */
export function computeContact(cfg: SimConfig, S: Settlement[], cost: Float64Array, routes: Route[], mixing: boolean): Float64Array {
  const n = S.length;
  const w = new Float64Array(n * n);
  for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
    if (a === b) continue;
    w[a * n + b] = Math.exp(-cost[a * n + b] / cfg.contactRange);
  }
  for (const r of routes) {
    if (r.blocked) { w[r.a * n + r.b] = 0; w[r.b * n + r.a] = 0; continue; }
    if (r.trade) {
      const v = Math.min(1, w[r.a * n + r.b] + cfg.tradeStrength * 0.5);
      w[r.a * n + r.b] = v; w[r.b * n + r.a] = v;
    }
  }
  if (mixing) for (let i = 0; i < n * n; i++) if (i % (n + 1) !== 0) w[i] = Math.max(w[i], 0.6);
  for (let a = 0; a < n; a++) if (!S[a].alive) for (let b = 0; b < n; b++) { w[a * n + b] = 0; w[b * n + a] = 0; }
  return w;
}
