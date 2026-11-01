/**
 * PHONOLOGY
 * ---------
 * Word forms are strings of single-character phoneme codes. Each phoneme carries articulatory
 * features, which define (a) a perceptual distance used for fuzzy word recognition and accent
 * tolerance, (b) natural misperception targets, and (c) natural classes for sound-change rules.
 *
 * Abstraction note: this is a drastically reduced feature geometry (place / manner / voicing for
 * consonants; height / backness / rounding for vowels). There is no stress, tone or prosody.
 */
import { Rng } from '../core/rng';

export interface Phoneme {
  code: string;
  ipa: string;
  vowel: boolean;
  // consonants: place 0 labial,1 alveolar,2 postalveolar/palatal,3 velar,4 glottal
  // manner 0 stop,1 nasal,2 fricative,3 liquid,4 glide ; voice 0/1
  // vowels: place = backness 0 front,1 central,2 back ; manner = height 0 low,1 mid,2 high ; voice = rounded
  place: number;
  manner: number;
  voice: number;
  /** Universal markedness prior: higher = more common cross-linguistically (used for invention). */
  base: number;
}

const P = (code: string, ipa: string, vowel: boolean, place: number, manner: number, voice: number, base: number): Phoneme => ({ code, ipa, vowel, place, manner, voice, base });

export const PHONEMES: Phoneme[] = [
  P('p', 'p', false, 0, 0, 0, 0.8), P('b', 'b', false, 0, 0, 1, 0.6),
  P('t', 't', false, 1, 0, 0, 1.0), P('d', 'd', false, 1, 0, 1, 0.6),
  P('k', 'k', false, 3, 0, 0, 1.0), P('g', 'g', false, 3, 0, 1, 0.5),
  P('q', 'ʔ', false, 4, 0, 0, 0.2),
  P('m', 'm', false, 0, 1, 1, 1.0), P('n', 'n', false, 1, 1, 1, 1.0), P('N', 'ŋ', false, 3, 1, 1, 0.3),
  P('f', 'f', false, 0, 2, 0, 0.35), P('v', 'v', false, 0, 2, 1, 0.25),
  P('s', 's', false, 1, 2, 0, 0.8), P('z', 'z', false, 1, 2, 1, 0.2),
  P('S', 'ʃ', false, 2, 2, 0, 0.3), P('h', 'h', false, 4, 2, 0, 0.5),
  P('l', 'l', false, 1, 3, 1, 0.7), P('r', 'r', false, 1, 3, 1, 0.6),
  P('w', 'w', false, 0, 4, 1, 0.6), P('j', 'j', false, 2, 4, 1, 0.5),
  P('a', 'a', true, 1, 0, 0, 1.0), P('e', 'e', true, 0, 1, 0, 0.7),
  P('i', 'i', true, 0, 2, 0, 0.9), P('o', 'o', true, 2, 1, 1, 0.7),
  P('u', 'u', true, 2, 2, 1, 0.85), P('E', 'ə', true, 1, 1, 0, 0.15),
];

export const NP = PHONEMES.length;
export const CODE_INDEX = new Int8Array(128).fill(-1);
PHONEMES.forEach((p, i) => (CODE_INDEX[p.code.charCodeAt(0)] = i));
export const VOWEL_IDX = PHONEMES.map((p, i) => (p.vowel ? i : -1)).filter((i) => i >= 0);
export const CONS_IDX = PHONEMES.map((p, i) => (!p.vowel ? i : -1)).filter((i) => i >= 0);
export const GLIDE_LIQUID_IDX = PHONEMES.map((p, i) => (!p.vowel && p.manner >= 3 ? i : -1)).filter((i) => i >= 0);

export function idx(ch: string): number {
  return CODE_INDEX[ch.charCodeAt(0)];
}
export function isVowel(ch: string | undefined): boolean {
  if (!ch) return false;
  const i = CODE_INDEX[ch.charCodeAt(0)];
  return i >= 0 && PHONEMES[i].vowel;
}

/** Perceptual distance between two phonemes in [0,1]. */
function featureDistance(a: Phoneme, b: Phoneme): number {
  if (a === b) return 0;
  if (a.vowel !== b.vowel) return 1;
  if (a.vowel) {
    return Math.min(1, 0.22 * Math.abs(a.place - b.place) + 0.25 * Math.abs(a.manner - b.manner) + 0.15 * Math.abs(a.voice - b.voice) + 0.1);
  }
  const placeD = Math.min(2, Math.abs(a.place - b.place));
  const mannerD = a.manner === b.manner ? 0 : 1;
  return Math.min(1, 0.18 * placeD + 0.32 * mannerD + 0.16 * Math.abs(a.voice - b.voice) + 0.08);
}

export const PDIST = new Float64Array(NP * NP);
for (let i = 0; i < NP; i++) for (let j = 0; j < NP; j++) PDIST[i * NP + j] = featureDistance(PHONEMES[i], PHONEMES[j]);

/** For each phoneme, the perceptually closest alternatives (misperception targets). */
export const NEIGHBOURS: number[][] = PHONEMES.map((_, i) =>
  PHONEMES.map((_, j) => j)
    .filter((j) => j !== i && PHONEMES[j].vowel === PHONEMES[i].vowel)
    .sort((x, y) => PDIST[i * NP + x] - PDIST[i * NP + y])
    .slice(0, 3),
);

const INDEL_C = 0.75;
const INDEL_V = 0.55;
const _row0 = new Float64Array(64);
const _row1 = new Float64Array(64);

/** Weighted Levenshtein distance using articulatory feature distances. */
export function phonDistance(a: string, b: string): number {
  const n = a.length, m = b.length;
  if (n === 0 || m === 0) return Math.max(n, m) * INDEL_C;
  let prev = _row0, cur = _row1;
  prev[0] = 0;
  for (let j = 1; j <= m; j++) prev[j] = prev[j - 1] + (isVowel(b[j - 1]) ? INDEL_V : INDEL_C);
  for (let i = 1; i <= n; i++) {
    const ai = CODE_INDEX[a.charCodeAt(i - 1)];
    const del = PHONEMES[ai]?.vowel ? INDEL_V : INDEL_C;
    cur[0] = prev[0] + del;
    for (let j = 1; j <= m; j++) {
      const bj = CODE_INDEX[b.charCodeAt(j - 1)];
      const sub = prev[j - 1] + (ai === bj ? 0 : PDIST[ai * NP + bj]);
      const ins = cur[j - 1] + (PHONEMES[bj]?.vowel ? INDEL_V : INDEL_C);
      const dl = prev[j] + del;
      cur[j] = sub < ins ? (sub < dl ? sub : dl) : ins < dl ? ins : dl;
    }
    const t = prev; prev = cur; cur = t;
  }
  return prev[m];
}

/** Similarity in [0,1]: 1 - distance normalised by the longer word length. */
export function phonSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const L = Math.max(a.length, b.length);
  return Math.max(0, 1 - phonDistance(a, b) / (L * 0.85));
}

const _alDp = new Float64Array(4096);
const _alSt = new Int32Array(4096);

export interface StemAlignment {
  sim: number;
  pre: string; // unmatched material before the stem
  suf: string; // unmatched material after the stem
}

/**
 * Semi-global alignment: find `stem` inside `word` allowing free unmatched material at the word edges.
 * This is how listeners segment affixes they may not know yet: "makuta" ~ stem "maku" + residue "ta".
 */
export function alignStem(word: string, stem: string, minSim = 0): StemAlignment {
  const n = stem.length, m = word.length;
  if (n === 0) return { sim: 0, pre: word, suf: '' };
  // dp[i][j]: cost aligning stem[0..i) with word[s..j) for best start s (free leading gap)
  const W = m + 1;
  const need = (n + 1) * W;
  const dp = need <= _alDp.length ? _alDp : new Float64Array(need);
  const start = need <= _alSt.length ? _alSt : new Int32Array(need);
  for (let j = 0; j <= m; j++) { dp[j] = 0; start[j] = j; }
  const maxCost = (1 - minSim) * n * 0.85;
  for (let i = 1; i <= n; i++) {
    const si = CODE_INDEX[stem.charCodeAt(i - 1)];
    const del = PHONEMES[si]?.vowel ? INDEL_V : INDEL_C;
    dp[i * W] = dp[(i - 1) * W] + del;
    start[i * W] = 0;
    let rowMin = dp[i * W];
    for (let j = 1; j <= m; j++) {
      const wj = CODE_INDEX[word.charCodeAt(j - 1)];
      const sub = dp[(i - 1) * W + j - 1] + (si === wj ? 0 : PDIST[si * NP + wj]);
      const ins = dp[i * W + j - 1] + (PHONEMES[wj]?.vowel ? INDEL_V : INDEL_C);
      const dl = dp[(i - 1) * W + j] + del;
      if (sub <= ins && sub <= dl) { dp[i * W + j] = sub; start[i * W + j] = start[(i - 1) * W + j - 1]; }
      else if (ins <= dl) { dp[i * W + j] = ins; start[i * W + j] = start[i * W + j - 1]; }
      else { dp[i * W + j] = dl; start[i * W + j] = start[(i - 1) * W + j]; }
      if (dp[i * W + j] < rowMin) rowMin = dp[i * W + j];
    }
    if (minSim > 0 && rowMin > maxCost) return NO_ALIGN;
  }
  let best = Infinity, bj = m;
  for (let j = 0; j <= m; j++) {
    const c = dp[n * W + j];
    if (c < best - 1e-9) { best = c; bj = j; }
  }
  const s = start[n * W + bj];
  const sim = Math.max(0, 1 - best / (n * 0.85));
  alignStart = s; alignEnd = bj;
  return sim > 0 ? { sim, pre: '', suf: '' } : NO_ALIGN;
}
const NO_ALIGN: StemAlignment = { sim: 0, pre: '', suf: '' };
/** Span of the last successful alignStem call (start/end index of the stem inside the word). */
export let alignStart = 0;
export let alignEnd = 0;


export function toIPA(form: string): string {
  let out = '';
  for (let i = 0; i < form.length; i++) {
    const k = CODE_INDEX[form.charCodeAt(i)];
    out += k >= 0 ? PHONEMES[k].ipa : form[i];
  }
  return out;
}

/** Romanised display: like IPA but friendlier glyphs. */
const ROMAN: Record<string, string> = { N: 'ng', S: 'sh', q: "'", E: 'ë', j: 'y' };
export function romanize(form: string): string {
  let out = '';
  for (const ch of form) out += ROMAN[ch] ?? ch;
  return out;
}

/**
 * Generate a new word form, biased by an agent's phonological habits (phoneme frequencies it has heard)
 * and universal markedness. Syllables follow simple templates with phonotactic restrictions.
 */
export function inventForm(rng: Rng, habit: Float64Array | null, syllables: number, habitWeight = 0.7): string {
  const w = new Float64Array(NP);
  let habitTotal = 0;
  if (habit) for (let i = 0; i < NP; i++) habitTotal += habit[i];
  for (let i = 0; i < NP; i++) {
    const h = habit && habitTotal > 0 ? (habit[i] / habitTotal) * NP : 1;
    w[i] = PHONEMES[i].base * ((1 - habitWeight) + habitWeight * h);
  }
  const vw = VOWEL_IDX.map((i) => w[i]);
  const cw = CONS_IDX.map((i) => w[i]);
  const pickV = () => PHONEMES[VOWEL_IDX[rng.weighted(vw)]].code;
  const pickC = (initial: boolean): string => {
    for (let tries = 0; tries < 6; tries++) {
      const c = PHONEMES[CONS_IDX[rng.weighted(cw)]].code;
      if (initial && c === 'N') continue;
      return c;
    }
    return 't';
  };
  let out = '';
  for (let s = 0; s < syllables; s++) {
    const r = rng.next();
    const first = s === 0;
    if (r < 0.58) out += pickC(first) + pickV();
    else if (r < 0.7 && (first || !isVowel(out[out.length - 1]))) out += pickV();
    else if (r < 0.9) {
      let coda = pickC(false);
      if (coda === 'h' || coda === 'w' || coda === 'j') coda = 'n';
      out += pickC(first) + pickV() + coda;
    } else {
      const c1 = PHONEMES[CONS_IDX[rng.weighted(cw.map((x, k) => (PHONEMES[CONS_IDX[k]].manner === 0 ? x : 0)))]]?.code ?? 'k';
      const c2 = rng.pick(['l', 'r', 'w', 'j']);
      out += c1 + c2 + pickV();
    }
  }
  // avoid vowel hiatus of identical vowels
  out = out.replace(/([aeiouE])\1/g, '$1');
  if (out.length < 2) out += pickV();
  return out;
}

/** Count phoneme occurrences of a form into a habit vector. */
export function addToHabit(habit: Float64Array, form: string, weight: number) {
  for (let i = 0; i < form.length; i++) {
    const k = CODE_INDEX[form.charCodeAt(i)];
    if (k >= 0) habit[k] += weight;
  }
}

/** Misperceive a form with per-phoneme error probability. Returns the (possibly unchanged) form. */
export function perceive(rng: Rng, form: string, pErr: number): string {
  if (pErr <= 0) return form;
  let out = '';
  for (let i = 0; i < form.length; i++) {
    const ch = form[i];
    if (rng.next() < pErr) {
      const k = CODE_INDEX[ch.charCodeAt(0)];
      const nb = NEIGHBOURS[k];
      out += PHONEMES[nb[rng.int(nb.length > 1 ? 2 : 1)]].code;
    } else out += ch;
  }
  return out;
}

/** 32-bit set of phonemes present in a form (cheap similarity pre-filter). */
export function formMask(form: string): number {
  let m = 0;
  for (let i = 0; i < form.length; i++) {
    const k = CODE_INDEX[form.charCodeAt(i)];
    if (k >= 0) m |= 1 << k;
  }
  return m;
}
export function popcount(x: number): number {
  x = x - ((x >>> 1) & 0x55555555);
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333);
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}
