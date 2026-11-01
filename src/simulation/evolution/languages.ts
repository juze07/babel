/**
 * LANGUAGE IDENTIFICATION & PHYLOGENY
 * -----------------------------------
 * Languages are *not* labels assigned to populations. They are inferred, periodically, from measured
 * behaviour:
 *  1. For each inhabited settlement we compute a "lect": the consensus vocabulary (most common
 *     form per concept among adult residents), mean word-order weights, dominant grammatical markers.
 *  2. Mutual intelligibility between lects is *measured* by running test language games (learning
 *     disabled) between random speakers of A and listeners of B, relative to B's internal success.
 *  3. Lects are clustered by average-linkage on symmetric relative intelligibility; clusters above the
 *     configurable threshold are one language (with hysteresis to avoid flicker).
 *  4. Clusters are matched to the previous pass by speaker overlap → continuity, splits (branching),
 *     mergers, genesis (new roots = independent families) and extinctions.
 */
import { Rng, hash2 } from '../core/rng';
import type { Simulation } from '../engine/simulation';
import type { Agent } from '../agents/agent';
import { ORDERS, argmax } from '../agents/agent';
import { CONCEPTS, C, G, GRAM_BASE, GRAM_KEYS, N_CONCEPTS, N_CONTENT, N_GRAM } from '../language/concepts';
import { NP, PHONEMES, CODE_INDEX, phonSimilarity, romanize } from '../language/phonology';
import { runEpisode } from '../communication/episode';
import { TICKS_PER_YEAR } from '../core/config';

export interface Lect {
  settlement: number;
  speakers: number[];
  forms: (string | null)[];
  etyms: number[];
  share: number[];
  coverage: number[];
  order: number[];
  adj: number[];
  obl: number[];
  markStrategy: number[]; // per gram: dominant strategy index
  markRate: number[]; // share of speakers with a usable marker
  phon: number[];
  selfIntel: number;
  lang: number;
  established: boolean;
  mixed: number; // share of consensus etyms of foreign origin
}

export interface LangSnapshot {
  tick: number;
  forms: (string | null)[];
  etyms: number[];
  share: number[];
  order: number[];
  adj: number[];
  obl: number[];
  markStrategy: number[];
  markRate: number[];
  phon: number[];
  speakers: number;
  rules: { id: number; label: string; share: number }[];
}

export interface LangEvent { tick: number; type: string; text: string }

export interface LanguageRecord {
  id: number;
  name: string;
  hue: number;
  color: string;
  parent: number;
  root: number;
  born: number;
  died: number;
  fate: 'alive' | 'extinct' | 'merged';
  mergedInto: number;
  settlements: number[];
  speakers: number;
  history: { tick: number; speakers: number; settlements: number[] }[];
  snapshots: LangSnapshot[];
  current: LangSnapshot | null;
  events: LangEvent[];
  borrowedIn: Record<number, number>; // donor language → count of borrowed lexical adoptions observed
  mixed: number;
  isolation: number; // latest external-contact index (0 = totally isolated)
  isolatedSince: number; // tick, -1 if not isolated
}

const HUES = [28, 205, 140, 350, 48, 265, 175, 8, 95, 315, 230, 62];

export class LanguageTracker {
  languages: LanguageRecord[] = [];
  lects: Lect[] = [];
  intel: number[][] = []; // raw lect→lect success
  rel: number[][] = []; // symmetric relative intelligibility
  langIntel: { a: number; b: number; v: number }[] = [];
  nextId = 0;
  lastAnalysis = -1;
  /** exponentially smoothed relative intelligibility between settlements (key a*1000+b) */
  relEma: Record<number, number> = {};

  toJSON() {
    return { languages: this.languages, lects: this.lects, intel: this.intel, rel: this.rel, langIntel: this.langIntel, nextId: this.nextId, lastAnalysis: this.lastAnalysis, relEma: this.relEma };
  }
  static fromJSON(o: ReturnType<LanguageTracker['toJSON']>): LanguageTracker {
    const t = new LanguageTracker();
    Object.assign(t, JSON.parse(JSON.stringify(o)));
    return t;
  }

  byId(id: number) { return this.languages[id]; }
  alive() { return this.languages.filter((l) => l.fate === 'alive'); }

  lineage(id: number): number[] {
    const out: number[] = [];
    let l = this.languages[id];
    while (l) { out.push(l.id); l = this.languages[l.parent]; }
    return out;
  }

  /* -------- lect computation -------- */
  computeLect(sim: Simulation, settlement: number, members: Agent[]): Lect {
    const sp = members.filter((a) => (sim.tick - a.born) / TICKS_PER_YEAR >= 8);
    const n = sp.length;
    const forms: (string | null)[] = new Array(N_CONCEPTS).fill(null);
    const etyms = new Array(N_CONCEPTS).fill(-1);
    const share = new Array(N_CONCEPTS).fill(0);
    const coverage = new Array(N_CONCEPTS).fill(0);
    const order = new Array(6).fill(0), adj = [0, 0], obl = [0, 0];
    const markStrategy = new Array(N_GRAM).fill(-1), markRate = new Array(N_GRAM).fill(0);
    const stratCount = new Array(N_GRAM * 4).fill(0);
    for (let c = 0; c < N_CONCEPTS; c++) {
      // consensus by *lexeme* (etymon); the displayed form is the most common pronunciation of it
      const counts = new Map<number, { n: number; forms: Map<string, number> }>();
      let cov = 0;
      for (const a of sp) {
        const b = a.lex.best(c);
        if (!b || b.score < 0.1) continue;
        cov++;
        let k = counts.get(b.etym);
        if (!k) { k = { n: 0, forms: new Map() }; counts.set(b.etym, k); }
        k.n++;
        k.forms.set(b.form, (k.forms.get(b.form) ?? 0) + 1);
      }
      coverage[c] = n ? cov / n : 0;
      let be = -1, bn = 0, bf: Map<string, number> | null = null;
      for (const [e, v] of counts) if (v.n > bn || (v.n === bn && e < be)) { be = e; bn = v.n; bf = v.forms; }
      if (bf && bn >= Math.max(2, n * 0.2)) {
        let best = '', fn = 0;
        for (const [f, k] of bf) if (k > fn || (k === fn && f < best)) { best = f; fn = k; }
        forms[c] = best; etyms[c] = be; share[c] = bn / n;
      }
      if (c >= GRAM_BASE) markRate[c - GRAM_BASE] = coverage[c];
    }
    for (const a of sp) {
      for (let i = 0; i < 6; i++) order[i] += a.gram.order[i] / Math.max(1, n);
      adj[0] += a.gram.adj[0] / n; adj[1] += a.gram.adj[1] / n;
      obl[0] += a.gram.obl[0] / n; obl[1] += a.gram.obl[1] / n;
      for (let g = 0; g < N_GRAM; g++) {
        const b = a.lex.best(GRAM_BASE + g);
        if (b && b.score >= 0.1) stratCount[g * 4 + argmax(a.gram.mark, g * 4, 4)]++;
      }
    }
    for (let g = 0; g < N_GRAM; g++) {
      let bs = -1, bv = 0;
      for (let s = 0; s < 4; s++) if (stratCount[g * 4 + s] > bv) { bv = stratCount[g * 4 + s]; bs = s; }
      markStrategy[g] = bs;
    }
    const phon = new Array(NP).fill(0);
    let tot = 0;
    for (let c = 0; c < N_CONTENT; c++) {
      const f = forms[c];
      if (!f) continue;
      for (const ch of f) { const k = CODE_INDEX[ch.charCodeAt(0)]; if (k >= 0) { phon[k]++; tot++; } }
    }
    if (tot) for (let i = 0; i < NP; i++) phon[i] /= tot;
    let covMean = 0;
    for (let c = 0; c < N_CONTENT; c++) covMean += coverage[c] / N_CONTENT;
    return {
      settlement, speakers: sp.map((a) => a.id), forms, etyms, share, coverage, order, adj, obl, markStrategy, markRate, phon,
      selfIntel: 0, lang: -1, established: n >= 3 && covMean >= 0.25, mixed: 0,
    };
  }

  /* -------- intelligibility (measured by test language games) -------- */
  testIntel(sim: Simulation, a: Lect, b: Lect, trials: number, rng: Rng): number {
    if (!a.speakers.length || !b.speakers.length) return 0;
    const ctx = { ...sim.langCtx(false, false), gestures: false };
    const sal = sim.globalSalience;
    let ok = 0;
    for (let t = 0; t < trials; t++) {
      const sp = sim.agentById.get(a.speakers[rng.int(a.speakers.length)]);
      const li = sim.agentById.get(b.speakers[rng.int(b.speakers.length)]);
      if (!sp || !li || sp === li) { t--; if (a.speakers.length < 2 && a === b) break; continue; }
      const r = runEpisode(sp, li, sal, ctx, rng, -1);
      // test games count only first-attempt understanding without gestures as intelligibility
      if (r.success && r.turns === 1) ok++;
    }
    return ok / trials;
  }

  /* -------- main analysis pass -------- */
  analyze(sim: Simulation) {
    const tick = sim.tick;
    const prevLects = this.lects;
    const lects: Lect[] = [];
    sim.settlements.forEach((s, i) => {
      const members = sim.residents[i];
      if (members.length >= 3) lects.push(this.computeLect(sim, s.id, members));
    });
    const prevLangOf = new Map<number, number>();
    for (const pl of prevLects) prevLangOf.set(pl.settlement, pl.lang);
    const L = lects.length;
    const rng = new Rng(hash2(sim.cfg.seed, tick * 7919 + 13));
    const trials = 6;
    const intel: number[][] = lects.map(() => new Array(L).fill(0));
    for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) intel[i][j] = this.testIntel(sim, lects[i], lects[j], trials, rng);
    for (let i = 0; i < L; i++) lects[i].selfIntel = intel[i][i];
    const rel: number[][] = lects.map(() => new Array(L).fill(0));
    for (let i = 0; i < L; i++) for (let j = 0; j < L; j++) {
      if (i === j) { rel[i][j] = 1; continue; }
      const rij = intel[i][j] / Math.max(0.1, intel[j][j]);
      const rji = intel[j][i] / Math.max(0.1, intel[i][i]);
      const raw = Math.min(1, (rij + rji) / 2);
      // combine the noisy behavioural measure with exact lexical (cognate) overlap, then smooth over time
      const cog = cognateShare(lects[i].etyms, lects[j].etyms);
      const v = 0.65 * raw + 0.35 * cog;
      const key = Math.min(lects[i].settlement, lects[j].settlement) * 1000 + Math.max(lects[i].settlement, lects[j].settlement);
      const prev = this.relEma[key];
      rel[i][j] = prev === undefined ? v : prev * 0.6 + v * 0.4;
    }
    for (let i = 0; i < L; i++) for (let j = i + 1; j < L; j++) {
      const m = (rel[i][j] + rel[j][i]) / 2;
      rel[i][j] = rel[j][i] = m;
      this.relEma[Math.min(lects[i].settlement, lects[j].settlement) * 1000 + Math.max(lects[i].settlement, lects[j].settlement)] = m;
    }
    for (const l of lects) {
      const had = (prevLangOf.get(l.settlement) ?? -1) >= 0;
      if (had && l.speakers.length >= 3) l.established = true;
      else if (l.selfIntel < 0.3) l.established = false;
    }


    // average-linkage clustering of established lects
    const thr = sim.cfg.languageThreshold;
    let clusters: number[][] = lects.map((l, i) => (l.established ? [i] : [])).filter((c) => c.length);
    for (;;) {
      let bi = -1, bj = -1, bv = -1;
      for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
        let s = 0, n = 0, wasSame = 0;
        for (const x of clusters[i]) for (const y of clusters[j]) {
          s += rel[x][y]; n++;
          const px = prevLangOf.get(lects[x].settlement), py = prevLangOf.get(lects[y].settlement);
          if (px !== undefined && px >= 0 && px === py) wasSame++;
        }
        const v = s / n;
        const t = wasSame > n / 2 ? thr - 0.1 : thr + 0.05;
        if (v >= t && v - t > bv) { bv = v - t; bi = i; bj = j; }
      }
      if (bi < 0) break;
      clusters[bi] = clusters[bi].concat(clusters[bj]);
      clusters.splice(bj, 1);
    }
    clusters = clusters.sort((a, b) => lects[b[0]].settlement - lects[a[0]].settlement);

    // match clusters to previous languages by speaker overlap
    const prevLangOfAgent = (id: number) => sim.agentById.get(id)?.langId ?? -1;
    const overlap: { c: number; l: number; n: number }[] = [];
    const sizes = clusters.map((cl) => cl.reduce((s, i) => s + lects[i].speakers.length, 0));
    clusters.forEach((cl, ci) => {
      const counts = new Map<number, number>();
      for (const i of cl) for (const id of lects[i].speakers) {
        const pl = prevLangOfAgent(id);
        if (pl >= 0) counts.set(pl, (counts.get(pl) ?? 0) + 1);
      }
      for (const [l, n] of counts) overlap.push({ c: ci, l, n });
    });
    overlap.sort((a, b) => b.n - a.n || a.l - b.l);
    const clusterLang = new Array(clusters.length).fill(-1);
    const usedOld = new Set<number>();
    for (const o of overlap) {
      if (clusterLang[o.c] >= 0 || usedOld.has(o.l)) continue;
      if (this.languages[o.l]?.fate !== 'alive') continue;
      clusterLang[o.c] = o.l; usedOld.add(o.l);
    }
    const prevAlive = this.alive().map((l) => l.id);
    clusters.forEach((cl, ci) => {
      if (clusterLang[ci] >= 0) return;
      let parent = -1, pn = 0;
      for (const o of overlap) if (o.c === ci && o.n > pn) { pn = o.n; parent = o.l; }
      const lectList = cl.map((i) => lects[i]);
      if (parent >= 0 && pn >= sizes[ci] * 0.3) {
        const rec = this.create(sim, lectList, parent, tick);
        clusterLang[ci] = rec.id;
        const p = this.languages[parent];
        this.event(rec, tick, 'split', `${rec.name} branched from ${p.name}`);
        this.event(p, tick, 'split', `${rec.name} branched off (${cl.map((i) => sim.settlements[lects[i].settlement].name).join(', ')})`);
        sim.addEvent('split', `${rec.name} has diverged from ${p.name} and is now a separate language`, { lang: rec.id, parent });
      } else {
        const rec = this.create(sim, lectList, -1, tick);
        clusterLang[ci] = rec.id;
        this.event(rec, tick, 'birth', `A conventional language emerged in ${cl.map((i) => sim.settlements[lects[i].settlement].name).join(', ')}`);
        sim.addEvent('birth', `${rec.name}: a shared language has emerged in ${cl.map((i) => sim.settlements[lects[i].settlement].name).join(', ')}`, { lang: rec.id });
      }
    });
    // languages that lost their cluster
    for (const id of prevAlive) {
      if (clusterLang.includes(id)) continue;
      const rec = this.languages[id];
      // where did its former speakers go?
      const counts = new Map<number, number>();
      clusters.forEach((cl, ci) => {
        for (const i of cl) for (const sid of lects[i].speakers) if (prevLangOfAgent(sid) === id) counts.set(clusterLang[ci], (counts.get(clusterLang[ci]) ?? 0) + 1);
      });
      let into = -1, n = 0;
      for (const [l, c] of counts) if (c > n) { n = c; into = l; }
      rec.died = tick;
      if (into >= 0) {
        rec.fate = 'merged'; rec.mergedInto = into;
        this.event(rec, tick, 'merge', `Converged with ${this.languages[into].name}`);
        this.event(this.languages[into], tick, 'merge', `Absorbed ${rec.name}`);
        sim.addEvent('merge', `${rec.name} has converged into ${this.languages[into].name}`, { lang: into, other: id });
      } else {
        rec.fate = 'extinct';
        this.event(rec, tick, 'extinct', `Last speakers lost`);
        sim.addEvent('extinct', `${rec.name} is extinct — no community speaks it any more`, { lang: id });
      }
      rec.speakers = 0; rec.settlements = [];
    }

    // assign languages to agents & lects; update records
    for (const a of sim.agents) a.langId = -1;
    clusters.forEach((cl, ci) => {
      const id = clusterLang[ci];
      const rec = this.languages[id];
      const settl: number[] = [];
      for (const i of cl) {
        lects[i].lang = id;
        settl.push(lects[i].settlement);
        for (const a of sim.residents[lects[i].settlement]) a.langId = id;
      }
      rec.settlements = settl;
      rec.speakers = settl.reduce((s, si) => s + sim.residents[si].length, 0);
      const prev = rec.current;
      const snap = this.snapshot(sim, settl, tick);
      this.detectChanges(sim, rec, prev, snap);
      rec.current = snap;
      if (!rec.snapshots.length || tick - rec.snapshots[rec.snapshots.length - 1].tick >= sim.cfg.analysisInterval * 5) {
        rec.snapshots.push(snap);
        if (rec.snapshots.length > 40) rec.snapshots.splice(1, 1);
      }
      rec.history.push({ tick, speakers: rec.speakers, settlements: settl });
      if (rec.history.length > 400) rec.history.splice(1, 1);
      // contact-variety index: share of consensus vocabulary from outside the lineage
      let foreign = 0, tot = 0;
      for (let c = 0; c < N_CONTENT; c++) {
        const e = snap.etyms[c];
        if (e < 0) continue;
        tot++;
        if (sim.isForeign(e, id)) foreign++;
      }
      const mixed = tot ? foreign / tot : 0;
      if (mixed >= 0.25 && rec.mixed < 0.25) {
        this.event(rec, tick, 'contact', `Became a contact variety: ${(mixed * 100).toFixed(0)}% of core vocabulary is borrowed`);
        sim.addEvent('contact', `${rec.name} is now a mixed contact variety (${(mixed * 100).toFixed(0)}% borrowed vocabulary)`, { lang: id });
      }
      rec.mixed = mixed;
      // isolation: contact weight from its settlements to other languages' settlements
      let ext = 0;
      for (const si of settl) for (let sj = 0; sj < sim.settlements.length; sj++) {
        if (settl.includes(sj) || sim.residents[sj].length < 3) continue;
        ext += sim.contact[si * sim.settlements.length + sj];
      }
      rec.isolation = ext / Math.max(1, settl.length);
      if (rec.isolation < 0.02 && rec.isolatedSince < 0) { rec.isolatedSince = tick; this.event(rec, tick, 'isolation', 'Entered a period of isolation from other speech communities'); }
      if (rec.isolation >= 0.04 && rec.isolatedSince >= 0) { this.event(rec, tick, 'isolation', `Isolation ended after ${((tick - rec.isolatedSince) / TICKS_PER_YEAR).toFixed(0)} years`); rec.isolatedSince = -1; }
    });
    for (const l of lects) {
      let foreign = 0, tot = 0;
      for (let c = 0; c < N_CONTENT; c++) { const e = l.etyms[c]; if (e < 0) continue; tot++; if (l.lang >= 0 && sim.isForeign(e, l.lang)) foreign++; }
      l.mixed = tot ? foreign / tot : 0;
    }
    // language-level intelligibility
    const langIntel: { a: number; b: number; v: number }[] = [];
    const langs = [...new Set(clusterLang)];
    for (let x = 0; x < langs.length; x++) for (let y = x + 1; y < langs.length; y++) {
      let s = 0, n = 0;
      lects.forEach((li, i) => lects.forEach((lj, j) => { if (li.lang === langs[x] && lj.lang === langs[y]) { s += rel[i][j]; n++; } }));
      if (n) langIntel.push({ a: langs[x], b: langs[y], v: s / n });
    }
    this.lects = lects;
    this.intel = intel;
    this.rel = rel;
    this.langIntel = langIntel;
    this.lastAnalysis = tick;
  }

  create(sim: Simulation, lects: Lect[], parent: number, tick: number): LanguageRecord {
    const id = this.nextId++;
    const settl = lects.map((l) => l.settlement);
    const snap = this.snapshot(sim, settl, tick);
    const p = this.languages[parent];
    // daughters stay recognisably related to the parent but must be distinguishable on the map:
    // alternate sides of the colour wheel, moving further away with each new sibling
    const sib = this.languages.filter((l) => l.parent === parent).length;
    const hue = p ? (p.hue + (sib % 2 ? 1 : -1) * (40 + 22 * Math.floor(sib / 2)) + 720) % 360 : HUES[this.languages.filter((l) => l.parent < 0).length % HUES.length];
    const light = p ? 34 + ((id * 13) % 24) : 44;
    const rec: LanguageRecord = {
      id, name: this.nameFor(snap, id), hue, color: `hsl(${hue.toFixed(0)} 48% ${light}%)`, parent, root: p ? p.root : id, born: tick, died: -1, fate: 'alive', mergedInto: -1,
      settlements: settl, speakers: 0, history: [], snapshots: [snap], current: null, events: [], borrowedIn: {}, mixed: 0, isolation: 1, isolatedSince: -1,
    };
    this.languages.push(rec);
    return rec;
  }

  nameFor(snap: LangSnapshot, id: number): string {
    // A language is named after its own word for "person" (or kin, village...), like many endonyms.
    const keys = ['person', 'kin', 'village', 'name', 'friend', 'mother', 'home', 'water', 'sun', 'land'].filter((k) => C[k] !== undefined);
    const extra = Object.keys(snap.forms).map(Number).sort((a, b) => a - b);
    const cands: number[] = [...keys.map((k) => C[k]), ...extra];
    for (const suffix of [0, 1, 2]) {
      for (const c of cands) {
        const f = snap.forms[c];
        if (!f) continue;
        let r = romanize(f).replace(/'/g, '');
        if (r.length < 2) continue;
        const v = /[aeiouë]$/.test(r);
        r = suffix === 0 ? (v ? r + 'n' : r + 'i') : suffix === 1 ? (v ? r + 'ra' : r + 'an') : r + 'ese';
        r = r[0].toUpperCase() + r.slice(1);
        if (!this.languages.some((l) => l.name === r)) return r;
      }
    }
    return `Lect ${id + 1}`;
  }

  snapshot(sim: Simulation, settl: number[], tick: number): LangSnapshot {
    const members: Agent[] = [];
    for (const s of settl) for (const a of sim.residents[s]) members.push(a);
    const l = this.computeLect(sim, -1, members);
    const ruleCounts = new Map<number, number>();
    const adults = members.filter((a) => (tick - a.born) / TICKS_PER_YEAR >= 8);
    for (const a of adults) for (const ar of a.accent) if (ar.strength >= 0.5) ruleCounts.set(ar.rule, (ruleCounts.get(ar.rule) ?? 0) + 1);
    const rules = [...ruleCounts.entries()].map(([id, n]) => ({ id, label: sim.rules.get(id)?.label ?? '?', share: n / Math.max(1, adults.length) })).filter((r) => r.share >= 0.2).sort((a, b) => b.share - a.share);
    return { tick, forms: l.forms, etyms: l.etyms, share: l.share, order: l.order, adj: l.adj, obl: l.obl, markStrategy: l.markStrategy, markRate: l.markRate, phon: l.phon, speakers: members.length, rules };
  }

  event(rec: LanguageRecord, tick: number, type: string, text: string) {
    rec.events.push({ tick, type, text });
    if (rec.events.length > 200) rec.events.splice(0, rec.events.length - 200);
  }

  detectChanges(sim: Simulation, rec: LanguageRecord, prev: LangSnapshot | null, cur: LangSnapshot) {
    if (!prev) return;
    const tick = sim.tick;
    const po = argmax(prev.order), co = argmax(cur.order);
    if (po !== co && cur.order[co] > 0.3) {
      this.event(rec, tick, 'grammar', `Dominant word order shifted ${ORDERS[po]} → ${ORDERS[co]}`);
      sim.addEvent('grammar', `${rec.name}: basic word order shifted from ${ORDERS[po]} to ${ORDERS[co]}`, { lang: rec.id });
    }
    const STRAT = ['prefix', 'suffix', 'particle', 'particle'];
    for (let g = 0; g < N_GRAM; g++) {
      const was = prev.markRate[g] >= 0.4, now = cur.markRate[g] >= 0.4;
      const f = cur.forms[GRAM_BASE + g];
      if (!was && now && f) {
        const strat = cur.markStrategy[g];
        const txt = `${CONCEPTS[GRAM_BASE + g].gloss} is now marked with the ${STRAT[Math.max(0, strat)]} “${romanize(f)}”`;
        this.event(rec, tick, 'grammar', txt);
        sim.addEvent('grammar', `${rec.name}: ${txt}`, { lang: rec.id });
      } else if (was && cur.markRate[g] < 0.2) {
        this.event(rec, tick, 'grammar', `Lost its ${CONCEPTS[GRAM_BASE + g].gloss} marking`);
      }
    }
    let replaced = 0;
    const shifts: string[] = [];
    for (let c = 0; c < N_CONCEPTS; c++) {
      const pe = prev.etyms[c], ce = cur.etyms[c];
      if (pe >= 0 && ce >= 0 && pe !== ce && cur.share[c] >= 0.35) {
        replaced++;
        if (sim.isForeign(ce, rec.id)) {
          const src = sim.etymLang(ce);
          const donor = this.languages[src];
          const txt = `adopted “${romanize(cur.forms[c]!)}” for '${CONCEPTS[c].key}'${donor ? ` from ${donor.name}` : ''}`;
          this.event(rec, tick, 'borrowing', txt[0].toUpperCase() + txt.slice(1));
          if (donor) rec.borrowedIn[donor.id] = (rec.borrowedIn[donor.id] ?? 0) + 1;
          sim.addEvent('borrowing', `${rec.name} ${txt}`, { lang: rec.id, other: src });
        } else if (c < N_CONTENT && replaced <= 3) {
          // semantic shift: did the new word previously mean something else here?
          const prevConcept = prev.etyms.findIndex((e, k) => e === ce && k !== c);
          if (prevConcept >= 0 && prevConcept < N_CONTENT && cur.etyms[prevConcept] !== ce) {
            shifts.push(`“${romanize(cur.forms[c]!)}” shifted meaning from '${CONCEPTS[prevConcept].key}' to '${CONCEPTS[c].key}'`);
          } else this.event(rec, tick, 'lexicon', `New dominant word for '${CONCEPTS[c].key}': “${romanize(cur.forms[c]!)}” replaced “${romanize(prev.forms[c] ?? '?')}”`);
        }
      }
      if (c < N_CONTENT && prev.forms[c] && prev.share[c] >= 0.5 && !cur.forms[c]) {
        this.event(rec, tick, 'loss', `Lost its word for '${CONCEPTS[c].key}' (“${romanize(prev.forms[c]!)}”)`);
        if (CONCEPTS[c].biome) sim.addEvent('loss', `${rec.name} lost its word for '${CONCEPTS[c].key}'`, { lang: rec.id });
      }
      // phonological change of the same etymon
      if (pe >= 0 && pe === ce && prev.forms[c] !== cur.forms[c] && cur.forms[c] && c < N_CONTENT) {
        if (rec.events.filter((e) => e.tick === tick && e.type === 'sound').length < 3)
          this.event(rec, tick, 'sound', `'${CONCEPTS[c].key}': “${romanize(prev.forms[c]!)}” → “${romanize(cur.forms[c]!)}”`);
      }
    }
    for (const s of shifts) {
      this.event(rec, tick, 'semantic', s[0].toUpperCase() + s.slice(1));
      sim.addEvent('semantic', `${rec.name}: ${s}`, { lang: rec.id });
    }
    const prevRules = new Set(prev.rules.filter((r) => r.share >= 0.5).map((r) => r.id));
    for (const r of cur.rules) if (r.share >= 0.5 && !prevRules.has(r.id)) {
      this.event(rec, tick, 'sound', `Sound change ${r.label} spread to most speakers`);
      sim.addEvent('sound', `${rec.name}: sound change ${r.label} has spread to most speakers`, { lang: rec.id });
    }
  }
}

/** Lexical distance between two consensus vocabularies (mean normalised phonetic distance over shared concepts). */
export function lexicalDistance(a: (string | null)[], b: (string | null)[], upto = N_CONTENT): number {
  let s = 0, n = 0;
  for (let c = 0; c < upto; c++) {
    const x = a[c], y = b[c];
    if (!x || !y) continue;
    s += 1 - phonSimilarity(x, y); n++;
  }
  return n ? s / n : 1;
}

/** Share of shared concepts whose consensus words descend from the same etymon (true cognates). */
export function cognateShare(a: number[], b: number[], upto = N_CONTENT): number {
  let s = 0, n = 0;
  for (let c = 0; c < upto; c++) {
    if (a[c] < 0 || b[c] < 0) continue;
    n++; if (a[c] === b[c]) s++;
  }
  return n ? s / n : 0;
}

export function grammarDistance(a: { order: number[]; adj: number[]; obl: number[]; markRate: number[] }, b: typeof a): number {
  let d = 0;
  for (let i = 0; i < 6; i++) d += Math.abs(a.order[i] - b.order[i]) / 2;
  d += Math.abs(a.adj[0] - b.adj[0]) * 0.5 + Math.abs(a.obl[0] - b.obl[0]) * 0.5;
  let m = 0;
  for (let g = 0; g < N_GRAM; g++) m += Math.abs((a.markRate[g] >= 0.4 ? 1 : 0) - (b.markRate[g] >= 0.4 ? 1 : 0));
  return (d + m / N_GRAM) / 3;
}

export function phonDistanceProfiles(a: number[], b: number[]): number {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += Math.abs(a[i] - b[i]);
  return d / 2;
}

export { GRAM_KEYS, PHONEMES, G };
