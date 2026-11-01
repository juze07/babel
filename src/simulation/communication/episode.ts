/**
 * COMMUNICATION EPISODE — the language game.
 *
 *  1. Speaker and listener share attention on a context of K scenes (target + distractors).
 *  2. Speaker forms the intention to communicate the target frame.
 *  3. Speaker encodes it with its own lexicon + grammar (inventing, extending or gesturing when it lacks words).
 *  4. The utterance is articulated through the speaker's accent and perceived (noisily) by the listener.
 *  5. Listener segments words (known stems + affixes, fuzzy matching tolerant to accents),
 *     assigns semantic roles (case markers > word order > animacy plausibility) and picks a scene.
 *  6. Success = listener picks the target. Failures and non-understanding trigger repair turns with gestures.
 *  7. Both update: reinforcement / lateral inhibition (speaker), cross-situational + syntactic-bootstrapping
 *     word learning, affix discovery from residues, word-order alignment, accent adoption (listener).
 *
 * Abstraction: meanings are given symbolically (no perception model); "feedback" is idealised pointing.
 */
import { Rng } from '../core/rng';
import type { SimConfig } from '../core/config';
import { TICKS_PER_YEAR } from '../core/config';
import { type Agent, ORDER_SEQ, normalize, argmax } from '../agents/agent';
import { Origin, type LexEntry } from '../agents/lexicon';
import { CONCEPTS, G, GRAM_BASE, N_CONTENT, SEM_NEIGHBOURS, gesturable, type GramKey } from '../language/concepts';
import { type Frame, type Entity, VERBS, featureCount, frameKey, generateFrame, perturb, sameFrame, frameConcepts } from '../language/frames';
import { alignStem, alignStart, alignEnd, inventForm, perceive, phonSimilarity, addToHabit, formMask, popcount } from '../language/phonology';

let SEEN = new Int32Array(1024);
let STAMP = 0;
import { realize, type SoundRule } from '../language/soundChange';

/* ------------------------------------------------------------------ */
/* Context passed from the simulation                                  */
/* ------------------------------------------------------------------ */
export interface LangContext {
  tick: number;
  cfg: SimConfig;
  rules: Map<number, SoundRule>;
  newEtym(form: string, concept: number, agent: Agent): number;
  etymLang(etym: number): number;
  /** true if the etymon originated outside the lineage (language + ancestors) of `lang` */
  isForeign(etym: number, lang: number): boolean;
  onBorrow?(agent: Agent, entry: LexEntry): void;
  learning: boolean;
  record: boolean;
  /** gesture channel available (disabled in intelligibility tests, which measure language only) */
  gestures?: boolean;
}

export type Role = 'A' | 'V' | 'P' | 'R' | 'L' | 'M' | 'Q' | 'X';

export interface Morph {
  form: string; // surface
  under: string; // underlying (speaker's stored) form
  concept: number;
  etym: number;
  kind: 'stem' | 'affix' | 'particle';
  strategy: number; // for grammatical morphs: 0 prefix 1 suffix 2 particle-before 3 particle-after
  score: number;
  alts?: { form: string; score: number }[];
  how?: 'known' | 'invented' | 'extended' | 'variant';
}

export interface UWord {
  text: string;
  morphs: Morph[];
  role: Role;
  gesture: number; // concept conveyed by gesture (-1 none)
  ent?: 'a' | 'o' | 'r';
}

export interface Utterance {
  words: UWord[];
  order: number;
  adj: number; // -1 if unused
  obl: number; // -1 if unused
  used: LexEntry[];
  gramUsed: { g: number; s: number; entry: LexEntry }[];
  inventions: number;
}

/* ------------------------------------------------------------------ */
/* Production                                                          */
/* ------------------------------------------------------------------ */
const GK = (k: GramKey) => G[k];
const gramIdx = (concept: number) => concept - GRAM_BASE;

function pickEntry(sp: Agent, c: number, rng: Rng): LexEntry | undefined {
  const list = sp.lex.byConcept[c];
  if (!list.length) return undefined;
  let best: LexEntry | undefined, second: LexEntry | undefined;
  for (const e of list) {
    if (!best || e.score > best.score || (e.score === best.score && e.etym < best.etym)) { second = best; best = e; }
    else if (!second || e.score > second.score) second = e;
  }
  // occasionally try out a competing (e.g. recently learned) variant
  if (second && second.score > 0.1 && rng.chance(0.02 + (1 - sp.traits.confidence) * 0.04)) return second;
  return best;
}

function syllablesFor(c: number, rng: Rng): number {
  // Zipf-like economy: frequent concepts tend to get shorter words
  const f = CONCEPTS[c]?.freq ?? 0.5;
  if (c >= GRAM_BASE) return 1;
  if (f >= 1.2) return rng.chance(0.6) ? 1 : 2;
  if (f >= 0.8) return rng.chance(0.3) ? 1 : 2 + (rng.chance(0.2) ? 1 : 0);
  return 2 + (rng.chance(0.4) ? 1 : 0);
}

interface WordChoice { entry?: LexEntry; how: Morph['how']; gesture: boolean }

function chooseWord(sp: Agent, c: number, ctx: LangContext, rng: Rng, gestureBoost: boolean, out: Utterance): WordChoice {
  let e = pickEntry(sp, c, rng);
  let how: Morph['how'] = 'known';
  if (!e) {
    // 1) semantic extension: reuse a word for a related concept (metaphor / metonymy → polysemy)
    const nbs = SEM_NEIGHBOURS[c] ?? [];
    let donor: LexEntry | undefined;
    for (const n of nbs) {
      const b = sp.lex.best(n);
      if (b && b.score > 0.3 && (!donor || b.score > donor.score)) donor = b;
    }
    if (donor && rng.chance(0.15 + 0.3 * sp.traits.imitation)) {
      const ne: LexEntry = { form: donor.form, concept: c, score: 0.18, uses: 0, succ: 0, last: ctx.tick, etym: donor.etym, origin: Origin.Extended, srcLang: sp.langId, born: ctx.tick };
      e = ctx.learning ? sp.lex.add(ne) : ne;
      how = 'extended';
    } else if (ctx.learning && rng.chance((0.04 + 0.3 * sp.traits.innovation) * ((ctx.tick - sp.born) / TICKS_PER_YEAR < 12 ? 0.1 : 1))) {
      // (young children rarely coin words: they gesture and wait to be told)
      // 2) invent a new word using the speaker's phonological habits
      const form = inventForm(rng, sp.habit, syllablesFor(c, rng));
      const etym = ctx.newEtym(form, c, sp);
      e = sp.lex.add({ form, concept: c, score: 0.22, uses: 0, succ: 0, last: ctx.tick, etym, origin: Origin.Invented, srcLang: sp.langId, born: ctx.tick });
      how = 'invented';
      out.inventions++;
    }
  }
  const unsure = !e || e.score < 0.3 * (1.3 - sp.traits.confidence);
  const gesture = gesturable(c) && (gestureBoost || unsure);
  return { entry: e, how, gesture };
}

function stemMorph(sp: Agent, ch: WordChoice, c: number, ctx: LangContext): Morph | null {
  const e = ch.entry;
  if (!e) return null;
  const alts = sp.lex.byConcept[c].filter((x) => x !== e).sort((a, b) => b.score - a.score).slice(0, 3).map((x) => ({ form: x.form, score: x.score }));
  return { form: realize(e.form, e.etym, sp.accent, ctx.rules), under: e.form, concept: c, etym: e.etym, kind: 'stem', strategy: -1, score: e.score, alts, how: ch.how };
}

function gramMarker(sp: Agent, g: number, ctx: LangContext, rng: Rng): { entry: LexEntry; s: number } | null {
  let e = sp.lex.best(g);
  const gi = gramIdx(g);
  if (!e || e.score < 0.2) {
    e = undefined;
    const need = sp.gram.need[gi];
    if (ctx.learning && need > 1.2 && rng.chance(sp.traits.innovation * 0.3 * Math.min(1, need / 4))) {
      let form = inventForm(rng, sp.habit, 1);
      if (form.length > 2) form = form.slice(0, 2);
      if (form.length < 2 || sp.lex.byForm.has(form)) form = inventForm(rng, sp.habit, 1).slice(0, 3);
      const etym = ctx.newEtym(form, g, sp);
      e = sp.lex.add({ form, concept: g, score: 0.3, uses: 0, succ: 0, last: ctx.tick, etym, origin: Origin.Invented, srcLang: sp.langId, born: ctx.tick });
      sp.gram.need[gi] = 0;
    }
  }
  if (!e) return null;
  const w = sp.gram.mark;
  let s: number;
  if (rng.chance(0.03 + 0.05 * sp.traits.innovation)) s = rng.int(4);
  else {
    const ws = [0, 1, 2, 3].map((k) => Math.pow(w[gi * 4 + k], 2.5));
    s = rng.weighted(ws);
  }
  // questions cannot be prefixed to nouns etc.; keep all strategies but Q-affixes go on the verb
  return { entry: e, s };
}

function sampleOrder(weights: Float64Array, innovation: number, rng: Rng, n: number): number {
  if (rng.chance(0.02 + 0.08 * innovation)) return rng.int(n);
  const ws: number[] = [];
  for (let i = 0; i < n; i++) ws.push(Math.pow(weights[i], 2.5));
  return rng.weighted(ws);
}

function makeGramMorph(sp: Agent, m: { entry: LexEntry; s: number }, ctx: LangContext): Morph {
  return { form: realize(m.entry.form, m.entry.etym, sp.accent, ctx.rules), under: m.entry.form, concept: m.entry.concept, etym: m.entry.etym, kind: m.s < 2 ? 'affix' : 'particle', strategy: m.s, score: m.entry.score };
}

function wordText(w: UWord): string {
  let pre = '', stem = '', suf = '';
  for (const m of w.morphs) {
    if (m.kind === 'stem' || m.kind === 'particle') stem += m.form;
    else if (m.strategy === 0) pre += m.form;
    else suf += m.form;
  }
  // haplology: an affix identical to the stem's own edge is not repeated (prevents i-i-i... pile-ups
  // when an earlier affix has been fused into the stem by learners)
  if (pre && stem.startsWith(pre)) pre = '';
  if (suf && stem.endsWith(suf)) suf = '';
  return pre + stem + suf;
}

/** Encode a frame as an utterance using only the speaker's own knowledge. */
export function produce(sp: Agent, f: Frame, ctx: LangContext, rng: Rng, gestureBoost = false): Utterance {
  const out: Utterance = { words: [], order: 0, adj: -1, obl: -1, used: [], gramUsed: [], inventions: 0 };
  const groups: Record<string, UWord[]> = { A: [], V: [], P: [], R: [], L: [] };

  const attachGram = (host: UWord, list: UWord[], g: number) => {
    const m = gramMarker(sp, g, ctx, rng);
    if (!m) return;
    out.gramUsed.push({ g, s: m.s, entry: m.entry });
    const morph = makeGramMorph(sp, m, ctx);
    if (m.s < 2) { host.morphs.push(morph); return; }
    const pw: UWord = { text: '', morphs: [morph], role: 'M', gesture: -1 };
    const i = list.indexOf(host);
    if (m.s === 2) list.splice(i, 0, pw); else list.splice(i + 1, 0, pw);
  };

  const np = (e: Entity, role: Role, key: 'a' | 'o' | 'r'): UWord[] => {
    const list: UWord[] = [];
    const ch = chooseWord(sp, e.h, ctx, rng, gestureBoost, out);
    const sm = stemMorph(sp, ch, e.h, ctx);
    if (ch.entry) out.used.push(ch.entry);
    const head: UWord = { text: '', morphs: sm ? [sm] : [], role, gesture: ch.gesture ? e.h : -1, ent: key };
    if (!sm && !ch.gesture) return list; // nothing to say
    list.push(head);
    if (e.p >= 0) {
      const pc = chooseWord(sp, e.p, ctx, rng, gestureBoost, out);
      const pm = stemMorph(sp, pc, e.p, ctx);
      if (pc.entry) out.used.push(pc.entry);
      if (pm || pc.gesture) {
        const mod: UWord = { text: '', morphs: pm ? [pm] : [], role: 'M', gesture: pc.gesture ? e.p : -1, ent: key };
        const before = sampleOrder(sp.gram.adj, sp.traits.innovation, rng, 2) === 0;
        out.adj = before ? 0 : 1;
        if (before) list.unshift(mod); else list.push(mod);
      }
    }
    if (sm && e.pl) attachGram(head, list, GK('PL'));
    if (sm && role === 'P') attachGram(head, list, GK('PAT'));
    if (sm && role === 'R') attachGram(head, list, GK('REC'));
    return list;
  };

  if (f.a) groups.A = np(f.a, 'A', 'a');
  if (f.o) groups.P = np(f.o, 'P', 'o');
  if (f.r) groups.R = np(f.r, 'R', 'r');
  if (f.l >= 0) {
    const ch = chooseWord(sp, f.l, ctx, rng, gestureBoost, out);
    const sm = stemMorph(sp, ch, f.l, ctx);
    if (ch.entry) out.used.push(ch.entry);
    if (sm || ch.gesture) {
      const w: UWord = { text: '', morphs: sm ? [sm] : [], role: 'L', gesture: ch.gesture ? f.l : -1 };
      groups.L = [w];
      if (sm) attachGram(w, groups.L, GK('LOC'));
    }
  }
  // verb
  {
    const ch = chooseWord(sp, f.v, ctx, rng, gestureBoost, out);
    const sm = stemMorph(sp, ch, f.v, ctx);
    if (ch.entry) out.used.push(ch.entry);
    if (sm || ch.gesture) {
      const w: UWord = { text: '', morphs: sm ? [sm] : [], role: 'V', gesture: ch.gesture ? f.v : -1 };
      groups.V = [w];
      if (sm) {
        if (f.t === 1) attachGram(w, groups.V, GK('PAST'));
        if (f.t === 2) attachGram(w, groups.V, GK('FUT'));
        if (f.n) attachGram(w, groups.V, GK('NEG'));
      }
    }
  }
  // clause assembly
  out.order = sampleOrder(sp.gram.order, sp.traits.innovation, rng, 6);
  let core: UWord[] = [];
  for (const r of ORDER_SEQ[out.order]) core = core.concat(groups[r]);
  const obliques = [...groups.R, ...groups.L];
  let words: UWord[];
  if (obliques.length) {
    out.obl = sampleOrder(sp.gram.obl, sp.traits.innovation, rng, 2);
    words = out.obl === 0 ? [...obliques, ...core] : [...core, ...obliques];
  } else words = core;
  // question marking: clause-level particle or verbal affix
  if (f.q) {
    const m = gramMarker(sp, GK('Q'), ctx, rng);
    if (m) {
      out.gramUsed.push({ g: GK('Q'), s: m.s, entry: m.entry });
      const morph = makeGramMorph(sp, m, ctx);
      const v = groups.V[0];
      if (m.s < 2 && v && v.morphs.length) v.morphs.push(morph);
      else {
        morph.kind = 'particle';
        const pw: UWord = { text: '', morphs: [morph], role: 'Q', gesture: -1 };
        if (m.s === 0 || m.s === 2) words.unshift(pw); else words.push(pw);
      }
    }
  }
  for (const w of words) w.text = wordText(w);
  out.words = words;
  return out;
}

/* ------------------------------------------------------------------ */
/* Interpretation                                                      */
/* ------------------------------------------------------------------ */
export interface Sense { concept: number; entry: LexEntry; conf: number }
export interface WordAnalysis {
  heard: string;
  stem: string; // segmented stem material
  senses: Sense[];
  chosen: Sense | null;
  sim: number;
  marks: { g: number; side: 0 | 1 | 2; entry: LexEntry }[]; // side: 0 prefix,1 suffix,2 whole-word particle
  pre: string;
  suf: string;
  gesture: number;
  role: Role;
  slot: 'a' | 'o' | 'r' | null;
  host: number; // for particles: index of word they attach to
}

export interface Interpretation {
  words: WordAnalysis[];
  frame: { v: number; a: Entity | null; o: Entity | null; r: Entity | null; l: number; t: 0 | 1 | 2; n: boolean; q: boolean };
  scores: number[];
  choice: number; // index into context, -1 = not understood
  knows: { pl: boolean; tense: boolean; neg: boolean };
}

function isNounCat(c: number) {
  const cat = CONCEPTS[c]?.cat;
  return cat === 'object' || cat === 'animal' || cat === 'person' || cat === 'relation' || cat === 'abstract';
}
function isModCat(c: number) {
  const cat = CONCEPTS[c]?.cat;
  return cat === 'property' || cat === 'emotion';
}

function analyzeWord(li: Agent, word: string, threshold: number, contextConcepts: Set<number>): WordAnalysis {
  const a: WordAnalysis = { heard: word, stem: word, senses: [], chosen: null, sim: 0, marks: [], pre: '', suf: '', gesture: -1, role: 'X', slot: null, host: -1 };
  const lex = li.lex;
  const exact = lex.byForm.get(word);
  if (exact) {
    for (const e of exact) {
      if (e.concept >= GRAM_BASE) a.marks.push({ g: e.concept, side: 2, entry: e });
      else a.senses.push({ concept: e.concept, entry: e, conf: e.score });
    }
    if (a.senses.length) a.sim = 1;
  }
  if (!a.senses.length && !a.marks.length) {
    // segmentation with known affixes
    for (let g = GRAM_BASE; g < GRAM_BASE + 8; g++) {
      for (const ge of lex.byConcept[g]) {
        if (ge.score < 0.05 || ge.form.length >= word.length - 1) continue;
        let rest: string | null = null, side: 0 | 1 = 0;
        if (word.startsWith(ge.form)) { rest = word.slice(ge.form.length); side = 0; }
        else if (word.endsWith(ge.form)) { rest = word.slice(0, word.length - ge.form.length); side = 1; }
        if (rest === null) continue;
        const st = lex.byForm.get(rest);
        if (!st) continue;
        for (const e of st) if (e.concept < GRAM_BASE) a.senses.push({ concept: e.concept, entry: e, conf: e.score * 0.95 });
        if (a.senses.length) {
          a.marks.push({ g, side, entry: ge });
          a.stem = rest;
          if (side === 0) a.pre = ge.form; else a.suf = ge.form;
          a.sim = 0.95;
          break;
        }
      }
      if (a.senses.length) break;
    }
  }
  if (!a.senses.length && !a.marks.length) {
    // fuzzy, accent-tolerant matching with free affix residue
    let best = -1, bestForm = '', bestAl = { sim: 0, pre: '', suf: '' };
    const { forms, masks, byFirst, byLast } = lex.contentIndex();
    const wm = formMask(word);
    const wl = word.length;
    STAMP++;
    const consider = (fi: number) => {
      if (SEEN[fi] === STAMP) return;
      SEEN[fi] = STAMP;
      const form = forms[fi];
      const fl = form.length;
      if (fl < 2 || fl > wl + 1 || fl < wl - 3) return;
      const fm = masks[fi];
      // pre-filter: (almost) all of the stem's phoneme types must occur in the heard word
      if (popcount(fm & wm) < popcount(fm) - 1) return;
      const al = alignStem(word, form, threshold - 0.05);
      if (al.sim <= 0) return;
      const res = alignStart + (wl - alignEnd);
      if (res > 3) return;
      const s = al.sim - 0.07 * res - (Math.min(fl, wl) <= 2 ? 0.25 : 0) - (wl - res < 2 ? 0.3 : 0);
      if (s > best) { best = s; bestForm = form; bestAl = { sim: al.sim, pre: word.slice(0, alignStart), suf: word.slice(alignEnd) }; }
    };
    if (SEEN.length < forms.length) SEEN = new Int32Array(forms.length * 2);
    // candidates: forms sharing one of the first or last three segments (tolerates affix residue)
    for (let k = 0; k < 3 && k < wl; k++) {
      const b1 = byFirst.get(word.charCodeAt(k)); if (b1) for (const fi of b1) consider(fi);
      const b2 = byLast.get(word.charCodeAt(wl - 1 - k)); if (b2) for (const fi of b2) consider(fi);
    }
    if (best >= threshold) {
      a.sim = bestAl.sim;
      a.pre = bestAl.pre; a.suf = bestAl.suf;
      a.stem = word.slice(bestAl.pre.length, word.length - bestAl.suf.length);
      for (const e of lex.byForm.get(bestForm)!) if (e.concept < GRAM_BASE) a.senses.push({ concept: e.concept, entry: e, conf: e.score * bestAl.sim });
      // residues might be known affixes
      const tryRes = (res: string, side: 0 | 1) => {
        if (!res) return;
        let bm: { g: number; entry: LexEntry; s: number } | null = null;
        for (let g = GRAM_BASE; g < GRAM_BASE + 8; g++) for (const ge of lex.byConcept[g]) {
          const s = res === ge.form ? 1 : phonSimilarity(res, ge.form);
          if (s >= 0.7 && (!bm || s * ge.score > bm.s)) bm = { g, entry: ge, s: s * ge.score };
        }
        if (bm) { a.marks.push({ g: bm.g, side, entry: bm.entry }); if (side === 0) a.pre = ''; else a.suf = ''; }
      };
      tryRes(a.pre, 0);
      tryRes(a.suf, 1);
    }
  }
  // sense disambiguation: prefer senses present in the shared context
  if (a.senses.length) {
    let best: Sense | null = null, bs = -1;
    for (const s of a.senses) {
      const v = s.conf * (contextConcepts.has(s.concept) ? 2.5 : 1);
      if (v > bs) { bs = v; best = s; }
    }
    // a fuzzy match to something not in view is more likely an unknown word than a mispronunciation
    if (best && a.sim < 1 && !contextConcepts.has(best.concept)) best = null;
    a.chosen = best;
  }
  return a;
}

/** P(observed relative sequence of present constituents | order weights). */
function orderLikelihood(w: Float64Array, seq: ('A' | 'V' | 'P')[]): number {
  if (seq.length < 2) return 1;
  let p = 0;
  for (let o = 0; o < 6; o++) {
    const full = ORDER_SEQ[o].filter((x) => seq.includes(x));
    let ok = true;
    for (let i = 0; i < seq.length; i++) if (full[i] !== seq[i]) { ok = false; break; }
    if (ok) p += w[o];
  }
  return p;
}

export function interpret(li: Agent, heard: string[], gestures: number[], context: Frame[], speakerSettlement: number, cfg: SimConfig, cache?: Map<string, WordAnalysis>): Interpretation {
  const fam = li.accentFam.get(speakerSettlement) ?? (li.settlement === speakerSettlement ? 1 : 0);
  const threshold = 0.74 - 0.14 * fam - 0.06 * li.traits.attention;
  const cc = new Set<number>();
  for (const f of context) for (const c of frameConcepts(f)) cc.add(c);
  const words = heard.map((w) => {
    const hit = cache?.get(w);
    if (hit) return { ...hit, marks: hit.marks.slice(), senses: hit.senses };
    const a = analyzeWord(li, w, threshold, cc);
    cache?.set(w, { ...a, marks: a.marks.slice() });
    return a;
  });
  words.forEach((w, i) => {
    if (gestures[i] >= 0) {
      w.gesture = gestures[i];
      if (!w.chosen || w.chosen.concept !== gestures[i]) {
        const fake: Sense = { concept: gestures[i], entry: null as unknown as LexEntry, conf: 0.6 };
        w.chosen = fake;
      }
    }
  });
  const knowsG = (k: GramKey) => (li.lex.best(G[k])?.score ?? 0) > 0.15;
  const knows = { pl: knowsG('PL'), tense: knowsG('PAST') || knowsG('FUT'), neg: knowsG('NEG') };

  // particles: attach to neighbouring host
  const isContent = (w: WordAnalysis) => !!w.chosen;
  words.forEach((w, i) => {
    if (w.chosen || !w.marks.length) return;
    const g = w.marks[0].g;
    const gi = gramIdx(g);
    const before = li.gram.mark[gi * 4 + 2] >= li.gram.mark[gi * 4 + 3];
    const nounish = g === G.PL || g === G.PAT || g === G.REC || g === G.LOC;
    const candidates = [before ? i + 1 : i - 1, before ? i - 1 : i + 1];
    for (const h of candidates) {
      const hw = words[h];
      if (!hw || !isContent(hw)) continue;
      if (nounish && !isNounCat(hw.chosen!.concept) && CONCEPTS[hw.chosen!.concept].cat !== 'location') continue;
      w.host = h;
      break;
    }
  });

  // verb
  let vIdx = -1, vConf = 0;
  words.forEach((w, i) => {
    if (w.chosen && CONCEPTS[w.chosen.concept].cat === 'action' && w.chosen.conf > vConf) { vIdx = i; vConf = w.chosen.conf; }
  });
  if (vIdx >= 0) words[vIdx].role = 'V';
  const v = vIdx >= 0 ? words[vIdx].chosen!.concept : -1;
  const spec = v >= 0 ? VERBS[v] : null;

  const marksOn = (i: number): number[] => {
    const out = words[i].marks.filter((m) => m.side !== 2).map((m) => m.g);
    words.forEach((w) => { if (w.host === i && w.marks.length) out.push(w.marks[0].g); });
    return out;
  };

  // nouns & locations
  const nounIdx: number[] = [];
  let l = -1;
  words.forEach((w, i) => {
    if (!w.chosen || i === vIdx) return;
    const c = w.chosen.concept;
    if (CONCEPTS[c].cat === 'location') { l = c; w.role = 'L'; return; }
    if (isNounCat(c)) nounIdx.push(i);
  });
  // modifiers attach to adjacent noun
  const modOf = new Map<number, number>();
  const preferBefore = li.gram.adj[0] >= li.gram.adj[1];
  words.forEach((w, i) => {
    if (!w.chosen || !isModCat(w.chosen.concept)) return;
    w.role = 'M';
    const nb = preferBefore ? [i + 1, i - 1] : [i - 1, i + 1];
    for (const h of nb) if (nounIdx.includes(h) && !modOf.has(h)) { modOf.set(h, w.chosen.concept); break; }
  });

  // role assignment for nouns: case markers first, then order + plausibility
  const assigned = new Map<number, 'a' | 'o' | 'r'>();
  const free: number[] = [];
  for (const i of nounIdx) {
    const ms = marksOn(i);
    if (ms.includes(G.PAT)) assigned.set(i, 'o');
    else if (ms.includes(G.REC)) assigned.set(i, 'r');
    else free.push(i);
  }
  const taken = new Set(assigned.values());
  const avail: ('a' | 'o' | 'r')[] = (['a', 'o', 'r'] as const).filter((r) => !taken.has(r) && (r === 'a' || !spec || (r === 'o' ? !!spec.pat : !!spec.rec)));
  if (free.length) {
    const plaus = (c: number, r: 'a' | 'o' | 'r') => {
      if (!spec) return r === 'a' ? (CONCEPTS[c].animate ? 1 : 0.3) : r === 'o' ? 0.7 : CONCEPTS[c].human ? 0.4 : 0.1;
      const list = r === 'a' ? spec.agt : r === 'o' ? spec.pat : spec.rec;
      return list && list.includes(c) ? 1 : 0.15;
    };
    const perms: ('a' | 'o' | 'r' | null)[][] = [];
    const rec = (k: number, cur: ('a' | 'o' | 'r' | null)[], used: Set<string>) => {
      if (k === free.length) { perms.push([...cur]); return; }
      for (const r of avail) if (!used.has(r)) { used.add(r); cur.push(r); rec(k + 1, cur, used); cur.pop(); used.delete(r); }
      if (free.length > avail.length || avail.length === 0) { cur.push(null); rec(k + 1, cur, used); cur.pop(); }
    };
    rec(0, [], new Set());
    let best: ('a' | 'o' | 'r' | null)[] | null = null, bs = -1;
    for (const p of perms) {
      let s = 1;
      const items: { pos: number; r: 'A' | 'V' | 'P' }[] = [];
      if (vIdx >= 0) items.push({ pos: vIdx, r: 'V' });
      p.forEach((r, k) => {
        if (!r) { s *= 0.2; return; }
        s *= plaus(words[free[k]].chosen!.concept, r);
        if (r === 'a') items.push({ pos: free[k], r: 'A' });
        if (r === 'o') items.push({ pos: free[k], r: 'P' });
        if (r === 'r') {
          const core = [vIdx, ...free.filter((_, j) => p[j] === 'a' || p[j] === 'o')].filter((x) => x >= 0);
          const before = core.every((c) => free[k] < c), after = core.every((c) => free[k] > c);
          s *= before ? li.gram.obl[0] + 0.05 : after ? li.gram.obl[1] + 0.05 : 0.08;
        }
      });
      // a transitive verb with only one noun: the noun could be either role
      items.sort((x, y) => x.pos - y.pos);
      s *= orderLikelihood(li.gram.order, items.map((x) => x.r)) + 0.02;
      if (s > bs) { bs = s; best = p; }
    }
    best?.forEach((r, k) => { if (r) assigned.set(free[k], r); });
  }
  const ent = (slot: 'a' | 'o' | 'r'): Entity | null => {
    for (const [i, r] of assigned) if (r === slot) {
      words[i].role = slot === 'a' ? 'A' : slot === 'o' ? 'P' : 'R';
      words[i].slot = slot;
      return { h: words[i].chosen!.concept, p: modOf.get(i) ?? -1, pl: marksOn(i).includes(G.PL) };
    }
    return null;
  };
  const frame: Interpretation['frame'] = { v, a: ent('a'), o: ent('o'), r: ent('r'), l, t: 0, n: false, q: false };
  // clause-level grammatical meanings
  const allMarks: number[] = [];
  words.forEach((w) => w.marks.forEach((m) => allMarks.push(m.g)));
  if (allMarks.includes(G.PAST)) frame.t = 1;
  else if (allMarks.includes(G.FUT)) frame.t = 2;
  frame.n = allMarks.includes(G.NEG);
  frame.q = allMarks.includes(G.Q);

  // pragmatic inference: which scene in the shared context matches best?
  const mentioned = new Set<number>();
  words.forEach((w) => w.chosen && mentioned.add(w.chosen.concept));
  const scores = context.map((sc) => scoreScene(frame, sc, mentioned, knows));
  let choice = -1, best = 0.25;
  scores.forEach((s, i) => { if (s > best + 1e-9) { best = s; choice = i; } });
  // ties → ambiguous: listener must guess between tied candidates
  if (choice >= 0) {
    const tied = scores.map((s, i) => (Math.abs(s - best) < 1e-9 ? i : -1)).filter((i) => i >= 0);
    if (tied.length > 1) choice = tied[(li.id + heard.length + Math.floor(best * 100)) % tied.length];
  }
  return { words, frame, scores, choice, knows };
}

function scoreScene(fr: Interpretation['frame'], sc: Frame, mentioned: Set<number>, knows: Interpretation['knows']): number {
  let s = 0;
  if (fr.v >= 0) s += fr.v === sc.v ? 2 : -1;
  const roles: ['a' | 'o' | 'r', Entity | null][] = [['a', fr.a], ['o', fr.o], ['r', fr.r]];
  const scEnt = { a: sc.a, o: sc.o, r: sc.r };
  for (const [k, e] of roles) {
    if (!e) continue;
    const t = scEnt[k];
    if (t && t.h === e.h) {
      s += 1.5;
      if (e.p >= 0) s += t.p === e.p ? 0.6 : -0.4;
      if (knows.pl) s += t.pl === e.pl ? 0.4 : -0.5;
    } else if ((sc.a && sc.a.h === e.h) || (sc.o && sc.o.h === e.h) || (sc.r && sc.r.h === e.h)) s += 0.3;
    else s -= 0.8;
  }
  for (const c of mentioned) {
    if (sc.v === c || sc.l === c || sc.a?.h === c || sc.o?.h === c || sc.r?.h === c || sc.a?.p === c || sc.o?.p === c) s += 0.25;
  }
  if (fr.l >= 0) s += fr.l === sc.l ? 1 : -0.6;
  if (knows.tense || fr.t !== 0) s += fr.t === sc.t ? 0.7 : -0.7;
  if (knows.neg || fr.n) s += fr.n === sc.n ? 0.7 : -0.7;
  if (fr.q) s += sc.q ? 0.5 : -0.3;
  return s;
}

/** Fraction of target features recovered by the interpretation (graded comprehension). */
export function fidelity(fr: Interpretation['frame'], target: Frame): number {
  let hit = 0;
  if (fr.v === target.v) hit++;
  if (fr.t === target.t) hit++;
  for (const k of ['a', 'o', 'r'] as const) {
    const t = target[k], e = fr[k];
    if (!t) continue;
    if (e && e.h === t.h) hit++;
    if (e && e.pl === t.pl) hit++;
    if (t.p >= 0 && e && e.p === t.p) hit++;
  }
  if (target.l >= 0 && fr.l === target.l) hit++;
  if (fr.n === target.n) hit++;
  if (fr.q === target.q) hit++;
  return hit / featureCount(target);
}

/* ------------------------------------------------------------------ */
/* Episode orchestration                                               */
/* ------------------------------------------------------------------ */
export interface UpdateRecord { who: 'S' | 'L'; kind: string; concept: number; form: string; before: number; after: number }
export interface TurnRecord {
  words: { text: string; heard: string; gesture: number; morphs: Morph[]; role: Role }[];
  order: number;
  analysis: WordAnalysis[];
  frame: Interpretation['frame'];
  scores: number[];
  choice: number;
}
export interface EpisodeRecord {
  id: number;
  tick: number;
  speaker: number;
  listener: number;
  sSet: number;
  lSet: number;
  target: Frame;
  context: Frame[];
  distractorKinds: string[];
  turns: TurnRecord[];
  success: boolean;
  fidelity: number;
  novel: boolean;
  updates: UpdateRecord[];
  kind: 'peer' | 'family' | 'contact';
}

export interface EpisodeResult {
  success: boolean;
  turns: number;
  fidelity: number;
  misunderstood: boolean; // listener confidently picked a wrong scene at least once
  novel: boolean;
  gestures: number;
  inventions: number;
  text: string;
  gloss: string;
  record?: EpisodeRecord;
}

export function buildContext(rng: Rng, sal: Float64Array, k: number, complexity = 1): { context: Frame[]; target: number; kinds: string[] } {
  const target = generateFrame(rng, sal, complexity);
  const ctx: Frame[] = [target];
  const kinds: string[] = ['target'];
  let guard = 0;
  while (ctx.length < k && guard++ < 30) {
    let d: Frame, kind: string;
    if (rng.chance(0.75)) { const p = perturb(rng, target, sal); d = p.frame; kind = p.kind; }
    else { d = generateFrame(rng, sal, complexity); kind = 'random'; }
    if (ctx.some((c) => sameFrame(c, d))) continue;
    ctx.push(d); kinds.push(kind);
  }
  // shuffle positions
  const idx = ctx.map((_, i) => i);
  rng.shuffle(idx);
  return { context: idx.map((i) => ctx[i]), target: idx.indexOf(0), kinds: idx.map((i) => kinds[i]) };
}

function ageMult(a: Agent, tick: number) {
  const y = (tick - a.born) / TICKS_PER_YEAR;
  return y < 12 ? 1.6 : y < 25 ? 1.0 : 0.7; // critical-period effect
}

export function prestigeFactor(sp: Agent, cfg: SimConfig) {
  return Math.min(2, Math.max(0.3, 1 + cfg.prestigeWeight * (sp.traits.prestige - 0.3) * 2));
}

export function glossUtterance(u: Utterance): string {
  return u.words.map((w) => {
    if (!w.morphs.length) return w.gesture >= 0 ? `[${CONCEPTS[w.gesture].key}]` : '?';
    return w.morphs.map((m) => (m.kind === 'stem' ? CONCEPTS[m.concept].key : CONCEPTS[m.concept].key)).join('-');
  }).join(' ');
}

export function utteranceText(u: Utterance): string {
  return u.words.map((w) => (w.text ? w.text : w.gesture >= 0 ? '⟨gesture⟩' : '…')).join(' ');
}

/**
 * Run one full language game between speaker and listener. Mutates both agents when ctx.learning.
 */
export function runEpisode(sp: Agent, li: Agent, sal: Float64Array, ctx: LangContext, rng: Rng, epId: number, kind: EpisodeRecord['kind'] = 'peer'): EpisodeResult {
  const cfg = ctx.cfg;
  const { context, target: ti, kinds } = buildContext(rng, sal, cfg.contextSize);
  const target = context[ti];
  const fkey = frameKey(target);
  const novel = !li.seen.has(fkey);
  const pErr = cfg.perceptionNoise * (1.2 - li.traits.attention);
  const rec: EpisodeRecord | undefined = ctx.record ? { id: epId, tick: ctx.tick, speaker: sp.id, listener: li.id, sSet: sp.settlement, lSet: li.settlement, target, context, distractorKinds: kinds, turns: [], success: false, fidelity: 0, novel, updates: [], kind } : undefined;

  let success = false, misunderstood = false, turns = 0, fid = 0, gestures = 0, inventions = 0;
  let utt: Utterance | null = null;
  let interp: Interpretation | null = null;
  let heard: string[] = [];
  const maxTurns = 2;
  const cache = new Map<string, WordAnalysis>();
  for (turns = 1; turns <= maxTurns; turns++) {
    utt = produce(sp, target, ctx, rng, turns > 1);
    inventions += utt.inventions;
    heard = utt.words.map((w) => (w.text ? perceive(rng, w.text, pErr) : ''));
    const gest = utt.words.map((w) => (ctx.gestures !== false && w.gesture >= 0 && rng.chance(cfg.gestureClarity) ? w.gesture : -1));
    gestures += utt.words.filter((w) => w.gesture >= 0).length;
    // drop empty (pure gesture) words from heard string but keep gesture channel aligned
    interp = interpret(li, heard.map((h) => h || '∅'), gest, context, sp.settlement, cfg, cache);
    fid = fidelity(interp.frame, target);
    if (rec) rec.turns.push({
      words: utt.words.map((w, i) => ({ text: w.text, heard: heard[i], gesture: w.gesture, morphs: w.morphs, role: w.role })),
      order: utt.order, analysis: interp.words, frame: interp.frame, scores: interp.scores, choice: interp.choice,
    });
    if (interp.choice === ti) { success = true; break; }
    if (interp.choice >= 0) misunderstood = true;
  }
  if (turns > maxTurns) turns = maxTurns;

  if (ctx.learning && utt && interp) {
    learnSpeaker(sp, utt, success, turns, target, interp, context, ctx, rec);
    learnListener(li, sp, utt, interp, heard, target, success, ctx, rng, rec);
    // social bonds strengthen through communication
    bond(sp, li, success ? 0.06 : 0.02, sp.settlement === li.settlement ? 1 : 2);
    bond(li, sp, success ? 0.06 : 0.02, sp.settlement === li.settlement ? 1 : 2);
    if (li.seen.size > li.traits.memoryCapacity * 3) li.seen.delete(li.seen.values().next().value as number);
    li.seen.add(fkey);
    sp.stats.spoke++; li.stats.heard++;
    if (success) { sp.stats.okS++; li.stats.okL++; }
  }
  if (rec) { rec.success = success; rec.fidelity = fid; }
  const text = utt ? utteranceText(utt) : '';
  const gloss = utt ? glossUtterance(utt) : '';
  return { success, turns, fidelity: fid, misunderstood, novel, gestures, inventions, text, gloss, record: rec };
}

export function bond(a: Agent, b: Agent, dw: number, kind: 0 | 1 | 2) {
  const r = a.relations.get(b.id);
  if (r) { r.w = Math.min(1, r.w + dw); if (r.k !== 0 && kind === 2) r.k = 2; }
  else {
    if (a.relations.size >= 24) {
      // forget weakest non-family tie
      let weakest = -1, ww = Infinity;
      for (const [id, rel] of a.relations) if (rel.k !== 0 && rel.w < ww) { ww = rel.w; weakest = id; }
      if (weakest >= 0 && ww < dw + 0.05) a.relations.delete(weakest); else return;
    }
    a.relations.set(b.id, { w: dw, k: kind === 0 ? 0 : kind === 2 ? 2 : 1 });
  }
}

/* ------------------------------------------------------------------ */
/* Learning                                                            */
/* ------------------------------------------------------------------ */
function upd(rec: EpisodeRecord | undefined, who: 'S' | 'L', kind: string, e: LexEntry, before: number) {
  if (rec && rec.updates.length < 40) rec.updates.push({ who, kind, concept: e.concept, form: e.form, before, after: e.score });
}

function learnSpeaker(sp: Agent, u: Utterance, success: boolean, turns: number, target: Frame, interp: Interpretation, context: Frame[], ctx: LangContext, rec?: EpisodeRecord) {
  const lr = sp.traits.learningRate * ageMult(sp, ctx.tick);
  const t = ctx.tick;
  const g = sp.gram;
  const used = new Set<LexEntry>();
  // Credit assignment: the speaker sees which scene the listener pointed at. Words whose concept is
  // present in that scene were evidently understood (reinforce); words whose concept is absent failed.
  const chosen = interp.choice >= 0 ? context[interp.choice] : null;
  const understood = new Set<number>(chosen ? frameConcepts(chosen) : []);
  for (const e of u.used) {
    if (used.has(e)) continue;
    used.add(e);
    e.uses++; e.last = t;
    const before = e.score;
    const ok = success || understood.has(e.concept);
    if (ok) {
      const gain = success ? (turns === 1 ? 0.12 : 0.06) : 0.03;
      e.score += lr * gain * (1 - e.score);
      if (success) e.succ++;
      // lateral inhibition of synonyms
      for (const o of sp.lex.byConcept[e.concept]) if (o !== e) o.score -= Math.min(0.9, lr * (success ? 0.8 : 0.2)) * o.score;
      upd(rec, 'S', success ? 'reinforce' : 'reinforce (understood)', e, before);
    } else {
      e.score -= lr * 0.15 * e.score;
      upd(rec, 'S', 'weaken', e, before);
    }
  }
  for (const gu of u.gramUsed) {
    const gi = gu.g - GRAM_BASE;
    const before = gu.entry.score;
    gu.entry.last = t; gu.entry.uses++;
    if (success) {
      gu.entry.score += lr * 0.25 * (1 - gu.entry.score);
      for (const o of sp.lex.byConcept[gu.g]) if (o !== gu.entry) o.score -= lr * 0.12 * o.score;
      g.mark[gi * 4 + gu.s] += lr * 0.06; normalize(g.mark, gi * 4, 4);
    } else gu.entry.score -= lr * 0.05 * gu.entry.score;
    upd(rec, 'S', success ? 'reinforce marker' : 'weaken marker', gu.entry, before);
  }
  const eta = lr * 0.05;
  if (success) {
    g.order[u.order] += eta; normalize(g.order);
    if (u.adj >= 0) { g.adj[u.adj] += eta; normalize(g.adj); }
    if (u.obl >= 0) { g.obl[u.obl] += eta; normalize(g.obl); }
  } else {
    // diagnose the misunderstanding → functional pressure for grammatical marking
    const chosen = interp.choice >= 0 ? context[interp.choice] : null;
    if (chosen) {
      // only *minimal-pair* confusions create functional pressure: the listener understood everything
      // except one grammatical distinction the speaker's language does not (yet) encode
      const swapped = !!(chosen.a && target.o && chosen.a.h === target.o.h && chosen.o && target.a && chosen.o.h === target.a.h);
      const diffs: number[] = [];
      if (swapped) diffs.push(G.PAT);
      if (chosen.t !== target.t) diffs.push(target.t === 2 || chosen.t === 2 ? G.FUT : G.PAST);
      if (chosen.n !== target.n) diffs.push(G.NEG);
      if (chosen.q !== target.q) diffs.push(G.Q);
      if ((chosen.a?.pl ?? false) !== (target.a?.pl ?? false) || (chosen.o?.pl ?? false) !== (target.o?.pl ?? false)) diffs.push(G.PL);
      const lexicalDiff = chosen.v !== target.v || (!swapped && (chosen.a?.h !== target.a?.h || chosen.o?.h !== target.o?.h)) || chosen.l !== target.l || chosen.r?.h !== target.r?.h;
      if (diffs.length === 1 && !lexicalDiff) {
        g.need[diffs[0] - GRAM_BASE] += 1;
        if (swapped) { g.order[u.order] *= 1 - eta; normalize(g.order); }
      }
    }
  }
  for (let i = 0; i < g.need.length; i++) g.need[i] *= 0.995;
}

function addOrReinforce(li: Agent, form: string, concept: number, gain: number, etym: number, ctx: LangContext, rec: EpisodeRecord | undefined, kind: string): LexEntry | null {
  if (form.length < 1 || form === '∅') return null;
  let e = li.lex.get(form, concept);
  // an unsegmented chunk that is too long is not memorised as a new word; the learner waits to hear
  // the word in a simpler (less inflected) context
  if (!e && concept < GRAM_BASE && form.length > MAX_NEW_WORD) return null;
  const before = e?.score ?? 0;
  if (e) { e.score = Math.min(1, e.score + gain * (1 - e.score)); e.last = ctx.tick; }
  else {
    // hearing others use a different word for something weakens one's own preference (alignment)
    if (concept < GRAM_BASE && (kind === 'gesture-learned' || kind === 'inferred')) {
      const inh = Math.min(0.5, gain * (0.5 + li.traits.imitation));
      for (const o of li.lex.byConcept[concept]) o.score -= inh * o.score;
    }
    const srcLang = etym >= 0 ? ctx.etymLang(etym) : -1;
    const borrowed = etym >= 0 && li.langId >= 0 && ctx.isForeign(etym, li.langId);
    const youth = (ctx.tick - li.born) / TICKS_PER_YEAR < 6;
    e = li.lex.add({ form, concept, score: Math.min(0.6, gain), uses: 0, succ: 0, last: ctx.tick, etym, origin: borrowed ? Origin.Borrowed : youth ? Origin.Inherited : Origin.Learned, srcLang, born: ctx.tick });
    if (borrowed) ctx.onBorrow?.(li, e);
    if (li.learnLog.length >= 24) li.learnLog.shift();
    li.learnLog.push({ tick: ctx.tick, kind, concept, form, partner: rec?.speaker ?? -1 });
  }
  upd(rec, 'L', kind, e, before);
  return e;
}

function learnListener(li: Agent, sp: Agent, u: Utterance, it: Interpretation, heard: string[], target: Frame, success: boolean, ctx: LangContext, rng: Rng, rec?: EpisodeRecord) {
  const lr = li.traits.learningRate * ageMult(li, ctx.tick) * (0.6 + 0.4 * li.traits.attention);
  const pf = prestigeFactor(sp, ctx.cfg);
  const imit = li.traits.imitation;
  const tick = ctx.tick;
  // target slots
  const slots: { c: number; role: Role; ent?: 'a' | 'o' | 'r' }[] = [{ c: target.v, role: 'V' }];
  for (const k of ['a', 'o', 'r'] as const) {
    const e = target[k];
    if (!e) continue;
    slots.push({ c: e.h, role: k === 'a' ? 'A' : k === 'o' ? 'P' : 'R', ent: k });
    if (e.p >= 0) slots.push({ c: e.p, role: 'M', ent: k });
  }
  if (target.l >= 0) slots.push({ c: target.l, role: 'L' });
  const accounted = new Set<number>();
  const wordSlot: (typeof slots[number] | null)[] = it.words.map(() => null);

  // 1. recognised words
  it.words.forEach((w, i) => {
    const s = w.chosen;
    if (!s || !s.entry) return;
    const slot = slots.find((x) => x.c === s.concept && !accounted.has(x.c));
    const e = s.entry;
    const before = e.score;
    if (slot) {
      accounted.add(slot.c);
      wordSlot[i] = slot;
      e.score += lr * (success ? 0.25 : 0.15) * (1 - e.score);
      e.last = tick;
      for (const o of li.lex.byConcept[e.concept]) if (o !== e) o.score -= Math.min(0.95, (success ? 1.2 : 0.4) * lr * (0.5 + imit)) * o.score;
      upd(rec, 'L', 'reinforce', e, before);
      // pronunciation alignment: occasionally re-store the word as heard (lexicalisation of accents);
      // children do this far more readily than adults. Sound changes never insert segments, so a
      // longer heard stem means unsegmented affix material: never fuse it into the stored form.
      if (w.stem !== e.form && w.stem.length >= 2 && w.stem.length <= e.form.length && w.sim >= 0.8) {
        const young = (tick - li.born) / TICKS_PER_YEAR < 14;
        if (rng.chance(0.05 * imit * pf * (young ? 4 : 1))) {
          const old = e.form;
          li.lex.reform(e, w.stem);
          if (rec && rec.updates.length < 40) rec.updates.push({ who: 'L', kind: `re-pronounced (was ${old})`, concept: e.concept, form: w.stem, before: e.score, after: e.score });
        }
      }
    } else {
      e.score -= lr * 0.3 * e.score;
      upd(rec, 'L', 'misinterpret', e, before);
    }
  });
  // also, speaker's chosen word for a concept the listener knows differently → adopt (naming-game alignment)
  // handled implicitly: unknown words below get associated with unaccounted concepts.

  // 2. gestures: ostensive learning
  it.words.forEach((w, i) => {
    if (w.gesture < 0) return;
    const slot = slots.find((x) => x.c === w.gesture);
    if (!slot) return;
    if (wordSlot[i] === null && heard[i] && heard[i] !== '∅') {
      const sm = u.words[i]?.morphs.find((m) => m.kind === 'stem');
      const stem = w.sim > 0 ? w.stem : stripKnownAffixes(li, heard[i]);
      addOrReinforce(li, stem, w.gesture, lr * 0.45, sm?.etym ?? -1, ctx, rec, 'gesture-learned');
      wordSlot[i] = slot;
    }
    accounted.add(slot.c);
  });

  // 3. cross-situational learning with syntactic bootstrapping
  const unknownIdx = it.words.map((w, i) => (wordSlot[i] === null && !w.marks.length && heard[i] && heard[i] !== '∅' ? i : -1)).filter((i) => i >= 0);
  const unacc = slots.filter((s) => !accounted.has(s.c));
  if (unknownIdx.length && unacc.length) {
    // expected linear order of the unaccounted slots under the listener's own grammar
    const ord = ORDER_SEQ[argmax(li.gram.order)];
    const rank = (s: typeof slots[number]) => {
      const base = s.role === 'R' || s.role === 'L' ? (li.gram.obl[0] > li.gram.obl[1] ? -1 : 10) : ord.indexOf(s.role === 'M' ? (s.ent === 'o' ? 'P' : 'A') : (s.role as 'A' | 'V' | 'P'));
      return base + (s.role === 'M' ? (li.gram.adj[0] > li.gram.adj[1] ? -0.5 : 0.5) : 0);
    };
    const exp = [...unacc].sort((x, y) => rank(x) - rank(y));
    const single = unknownIdx.length === 1 && unacc.length === 1;
    const orderConf = Math.max(...li.gram.order);
    if (single || (unknownIdx.length === exp.length && unknownIdx.length <= 3 && orderConf >= 0.3)) {
      const gain = single ? lr * 0.35 : lr * 0.08;
      unknownIdx.forEach((wi, k) => {
        const s = exp[k];
        const sm = u.words[wi]?.morphs.find((m) => m.kind === 'stem');
        const stem = stripKnownAffixes(li, heard[wi]);
        addOrReinforce(li, stem, s.c, gain, sm?.etym ?? -1, ctx, rec, single ? 'inferred' : 'syntactic bootstrapping');
        wordSlot[wi] = s; accounted.add(s.c);
      });
    } else if (unknownIdx.length <= 2 && exp.length <= 2) {
      // uncertain mapping: weak hypotheses (cross-situational statistics sort them out over time)
      for (const wi of unknownIdx) for (const s of exp) {
        const sm = u.words[wi]?.morphs.find((m) => m.kind === 'stem');
        addOrReinforce(li, stripKnownAffixes(li, heard[wi]), s.c, lr * 0.04, sm?.etym ?? -1, ctx, rec, 'cross-situational');
      }
    }
  }
  const allContent = slots.every((x) => accounted.has(x.c));

  // 4. grammatical morphology: residues and particles
  const gramTargets = (slot: typeof slots[number] | null): number[] => {
    if (!slot) return [];
    const out: number[] = [];
    if (slot.role === 'V') {
      if (target.t === 1) out.push(G.PAST);
      if (target.t === 2) out.push(G.FUT);
      if (target.n) out.push(G.NEG);
      if (target.q) out.push(G.Q);
    } else if (slot.role === 'P') out.push(G.PAT);
    else if (slot.role === 'R') out.push(G.REC);
    else if (slot.role === 'L') out.push(G.LOC);
    if (slot.ent && slot.role !== 'M' && target[slot.ent]?.pl) out.push(G.PL);
    return out;
  };
  it.words.forEach((w, i) => {
    const slot = wordSlot[i];
    const cands = gramTargets(slot);
    // recognised markers: confirm or disconfirm
    for (const m of w.marks) {
      if (m.side === 2) continue;
      const before = m.entry.score;
      if (cands.includes(m.g)) { m.entry.score += lr * 0.2 * (1 - m.entry.score); learnStrategy(li, m.g, m.side, lr * imit * pf); }
      else m.entry.score -= lr * 0.08 * m.entry.score;
      upd(rec, 'L', 'marker', m.entry, before);
    }
    if (!slot || w.sim < 0.88 || w.stem.length < 3) return;
    const sm = u.words[i]?.morphs;
    for (const [res, side] of [[w.pre, 0], [w.suf, 1]] as [string, 0 | 1][]) {
      if (!res || res.length > 2) continue;
      const known = new Set(w.marks.map((m) => m.g));
      const open = cands.filter((g) => !known.has(g));
      if (!open.length) continue;
      const share = lr * (open.length === 1 ? 0.2 : 0.08);
      for (const g of open) {
        const gm = sm?.find((m) => m.concept === g);
        addOrReinforce(li, res, g, share, gm?.etym ?? -1, ctx, rec, 'affix discovered');
        learnStrategy(li, g, side, lr * 0.5 * imit);
      }
    }
  });
  // free particles
  it.words.forEach((w, i) => {
    if (!allContent || wordSlot[i] || !heard[i] || heard[i] === '∅' || heard[i].length > 3) return;
    const isUnknown = !w.chosen;
    if (!isUnknown) return;
    // which host does it neighbour?
    const prevSlot = wordSlot[i - 1] ?? null, nextSlot = wordSlot[i + 1] ?? null;
    const opts: { g: number; s: 2 | 3 }[] = [];
    for (const [sl, s] of [[nextSlot, 2], [prevSlot, 3]] as [typeof slots[number] | null, 2 | 3][]) for (const g of gramTargets(sl)) opts.push({ g, s });
    if (target.q && (i === 0 || i === it.words.length - 1)) opts.push({ g: G.Q, s: i === 0 ? 2 : 3 });
    if (!opts.length) return;
    const pm = u.words[i]?.morphs[0];
    for (const o of opts) {
      if (w.marks.some((m) => m.g === o.g)) {
        const m = w.marks.find((mm) => mm.g === o.g)!;
        const before = m.entry.score;
        m.entry.score += lr * 0.2 * (1 - m.entry.score);
        upd(rec, 'L', 'particle', m.entry, before);
      } else addOrReinforce(li, heard[i], o.g, lr * (opts.length === 1 ? 0.2 : 0.07), pm?.concept === o.g ? pm.etym : -1, ctx, rec, 'particle discovered');
      learnStrategy(li, o.g, o.s, lr * 0.5 * imit);
    }
  });

  // 5. word-order alignment from the observed sequence of identified constituents
  const seq: ('A' | 'V' | 'P')[] = [];
  let adjObs = -1, oblObs = -1;
  wordSlot.forEach((s, i) => {
    if (!s) return;
    if (s.role === 'A' || s.role === 'V' || s.role === 'P') seq.push(s.role);
    if (s.role === 'M' && s.ent) {
      const headIdx = wordSlot.findIndex((x) => x && x.ent === s.ent && x.role !== 'M');
      if (headIdx >= 0) adjObs = i < headIdx ? 0 : 1;
    }
  });
  const obIdx = wordSlot.findIndex((s) => s && (s.role === 'R' || s.role === 'L'));
  const coreIdx = wordSlot.map((s, i) => (s && (s.role === 'A' || s.role === 'V' || s.role === 'P') ? i : -1)).filter((i) => i >= 0);
  if (obIdx >= 0 && coreIdx.length) oblObs = coreIdx.every((c) => obIdx < c) ? 0 : coreIdx.every((c) => obIdx > c) ? 1 : -1;
  const eta = lr * 0.08 * imit * pf;
  if (seq.length >= 2) {
    const consistent: number[] = [];
    for (let o = 0; o < 6; o++) {
      const full = ORDER_SEQ[o].filter((x) => seq.includes(x));
      if (full.every((x, k) => x === seq[k])) consistent.push(o);
    }
    if (consistent.length && consistent.length < 6) {
      for (const o of consistent) li.gram.order[o] += eta / consistent.length;
      normalize(li.gram.order);
    }
  }
  if (adjObs >= 0) { li.gram.adj[adjObs] += eta; normalize(li.gram.adj); }
  if (oblObs >= 0) { li.gram.obl[oblObs] += eta; normalize(li.gram.obl); }

  // 6. phonological habits & accent exposure
  for (const h of heard) if (h && h !== '∅') addToHabit(li.habit, h, 1);
  const same = sp.settlement === li.settlement;
  li.accentFam.set(sp.settlement, Math.min(1, (li.accentFam.get(sp.settlement) ?? 0) + 0.02));
  for (const ar of sp.accent) {
    if (ar.strength < 0.15) continue;
    const gain = 0.035 * imit * pf * ar.strength * (same ? 1 : 0.5);
    const mine = li.accent.find((x) => x.rule === ar.rule);
    if (mine) mine.strength = Math.min(1, mine.strength + gain);
    else if (li.accent.length < 8 && rng.chance(0.5)) li.accent.push({ rule: ar.rule, strength: gain });
  }
}

function learnStrategy(li: Agent, g: number, side: number, eta: number) {
  const gi = g - GRAM_BASE;
  li.gram.mark[gi * 4 + side] += eta * 0.1;
  normalize(li.gram.mark, gi * 4, 4);
}

function stripKnownAffixes(li: Agent, word: string): string {
  // peel off affixes the listener already knows, repeatedly (words can carry several markers)
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let g = GRAM_BASE; g < GRAM_BASE + 8 && !changed; g++) for (const ge of li.lex.byConcept[g]) {
      if (ge.score < 0.12 || word.length - ge.form.length < 2) continue;
      const gi = (g - GRAM_BASE) * 4;
      if (word.startsWith(ge.form) && li.gram.mark[gi] > 0.25) { word = word.slice(ge.form.length); changed = true; break; }
      if (word.endsWith(ge.form) && li.gram.mark[gi + 1] > 0.25) { word = word.slice(0, word.length - ge.form.length); changed = true; break; }
    }
    if (!changed) break;
  }
  return word;
}

/** Longest form a learner will memorise as one new word from a single exposure (working-memory span). */
const MAX_NEW_WORD = 8;

export { N_CONTENT };
