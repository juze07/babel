/**
 * VIEW MODELS — compact, serialisable projections of the simulation state for the UI.
 * The UI never touches engine objects directly (they live in a Web Worker).
 */
import type { Simulation } from './simulation';
import { TICKS_PER_YEAR } from '../core/config';
import { ORDERS, STRATEGIES, argmax, type Agent } from '../agents/agent';
import { CONCEPTS, CORE_LIST, GRAM_BASE, GRAM_KEYS, N_CONCEPTS, N_CONTENT, N_GRAM } from '../language/concepts';
import { PHONEMES, NP, romanize, toIPA } from '../language/phonology';
import { Rng, hash2 } from '../core/rng';
import { generateFrame, paraphrase, type Frame } from '../language/frames';
import { produce } from '../communication/episode';
import { cognateShare, grammarDistance, lexicalDistance, phonDistanceProfiles, type LangSnapshot } from '../evolution/languages';
import { Origin } from '../agents/lexicon';
import { METRIC_DEFS } from '../metrics/metrics';

export interface LangSummary {
  id: number; name: string; color: string; parent: number; root: number; born: number; died: number; fate: string; mergedInto: number;
  speakers: number; settlements: number[]; order: string; mixed: number;
}

export function langSummaries(sim: Simulation): LangSummary[] {
  return sim.tracker.languages.map((l) => ({
    id: l.id, name: l.name, color: l.color, parent: l.parent, root: l.root, born: l.born, died: l.died, fate: l.fate, mergedInto: l.mergedInto,
    speakers: l.speakers, settlements: l.settlements, order: l.current ? ORDERS[argmax(l.current.order)] : '—', mixed: l.mixed,
  }));
}

export function worldStatic(sim: Simulation) {
  return {
    W: sim.terrain.W, H: sim.terrain.H,
    height: Array.from(sim.terrain.height),
    biome: Array.from(sim.terrain.biome),
    cfg: sim.cfg,
  };
}

export function frameView(sim: Simulation) {
  const n = sim.agents.length;
  const pos = new Float32Array(n * 5); // x, y, lang, settlement, id
  const t = sim.tick;
  sim.agents.forEach((a, i) => {
    let x: number, y: number;
    if (a.travel) {
      const p = a.travel.path;
      const segs = p.length / 2 - 1;
      const f = Math.min(1, Math.max(0, (t - a.travel.t0) / Math.max(1, a.travel.t1 - a.travel.t0)));
      const k = Math.min(segs - 1, Math.floor(f * segs));
      const lf = f * segs - k;
      x = p[k * 2] + (p[k * 2 + 2] - p[k * 2]) * lf;
      y = p[k * 2 + 1] + (p[k * 2 + 3] - p[k * 2 + 1]) * lf;
    } else {
      const s = sim.settlements[a.settlement];
      x = s.x + a.jx; y = s.y + a.jy;
    }
    pos[i * 5] = x; pos[i * 5 + 1] = y; pos[i * 5 + 2] = a.langId; pos[i * 5 + 3] = a.travel ? -1 : a.settlement; pos[i * 5 + 4] = a.id;
  });
  const settlements = sim.settlements.map((s, i) => {
    const lect = sim.tracker.lects.find((l) => l.settlement === i);
    return { id: i, name: s.name, x: s.x, y: s.y, pop: sim.residents[i].length, capacity: s.capacity, food: s.food, lang: lect?.lang ?? -1, isolated: sim.isolated.has(i) };
  });
  const convs = sim.lastEpisodes.filter((e) => e.cross).slice(0, 30).map((e) => {
    const a = sim.agentById.get(e.s), b = sim.agentById.get(e.l);
    return a && b ? [a.settlement, b.settlement, e.ok ? 1 : 0] : null;
  }).filter(Boolean) as number[][];
  const last = sim.history[sim.history.length - 1] ?? null;
  return {
    tick: t, year: t / TICKS_PER_YEAR, population: n, pos, settlements,
    routes: sim.routes.map((r) => ({ a: r.a, b: r.b, trade: r.trade, blocked: r.blocked, path: r.path, sea: r.sea })),
    convs, metrics: last, langs: langSummaries(sim), events: sim.events.slice(-40), mixing: sim.mixing,
    episodes: sim.nextEpisode, follow: sim.follow, historyLength: sim.history.length,
  };
}
export type FrameView = ReturnType<typeof frameView>;

/* ---------------- agent ---------------- */
export function agentView(sim: Simulation, id: number) {
  const a = sim.agentById.get(id);
  if (!a) return null;
  const t = sim.tick;
  const vocab = [] as { concept: string; cat: string; forms: { form: string; roman: string; ipa: string; score: number; origin: string; uses: number; etym: number }[] }[];
  for (let c = 0; c < N_CONCEPTS; c++) {
    const list = a.lex.byConcept[c].filter((e) => e.score >= 0.03).sort((x, y) => y.score - x.score);
    if (!list.length) continue;
    vocab.push({
      concept: CONCEPTS[c].key, cat: CONCEPTS[c].cat,
      forms: list.slice(0, 4).map((e) => ({ form: e.form, roman: romanize(e.form), ipa: toIPA(e.form), score: e.score, origin: originName(e.origin), uses: e.uses, etym: e.etym })),
    });
  }
  const rels = [...a.relations.entries()].map(([rid, r]) => {
    const b = sim.agentById.get(rid);
    return { id: rid, w: r.w, kind: ['family', 'friend', 'trade'][r.k], settlement: b ? sim.settlementName(b.settlement) : '—', alive: !!b, lang: b?.langId ?? -1 };
  }).sort((x, y) => y.w - x.w);
  const markers = GRAM_KEYS.map((g, i) => {
    const b = a.lex.best(GRAM_BASE + i);
    return { g, gloss: CONCEPTS[GRAM_BASE + i].gloss, form: b && b.score >= 0.1 ? romanize(b.form) : null, score: b?.score ?? 0, strategy: STRATEGIES[argmax(a.gram.mark, i * 4, 4)], weights: Array.from(a.gram.mark.slice(i * 4, i * 4 + 4)), need: a.gram.need[i] };
  });
  return {
    id: a.id, age: (t - a.born) / TICKS_PER_YEAR, generation: a.generation, settlement: a.settlement, settlementName: sim.settlementName(a.settlement),
    birthplace: sim.settlementName(a.birthplace), mother: a.mother, father: a.father, lang: a.langId, langName: sim.tracker.byId(a.langId)?.name ?? null,
    traveling: a.travel ? { to: sim.settlementName(a.travel.to), arrives: a.travel.t1 } : null,
    traits: a.traits, stats: a.stats, lexSize: a.lex.size, vocab,
    grammar: { order: Array.from(a.gram.order), orderNames: ORDERS, adj: Array.from(a.gram.adj), obl: Array.from(a.gram.obl), markers },
    accent: a.accent.map((x) => ({ rule: sim.rules.get(x.rule)?.label ?? '?', strength: x.strength })),
    relations: rels.slice(0, 20), memory: a.memory.slice().reverse(), learnLog: a.learnLog.slice().reverse().map((l) => ({ ...l, concept: CONCEPTS[l.concept]?.key ?? '?', roman: romanize(l.form) })),
    followed: sim.follow === a.id,
  };
}
export type AgentView = NonNullable<ReturnType<typeof agentView>>;

function originName(o: Origin) {
  return ['invented', 'learned', 'borrowed', 'extended', 'inherited'][o] ?? '?';
}

export function settlementView(sim: Simulation, id: number) {
  const s = sim.settlements[id];
  if (!s) return null;
  const res = sim.residents[id];
  const lect = sim.tracker.lects.find((l) => l.settlement === id);
  const ages = [0, 0, 0, 0, 0, 0];
  for (const a of res) ages[Math.min(5, Math.floor((sim.tick - a.born) / TICKS_PER_YEAR / 15))]++;
  const n = sim.settlements.length;
  const contacts = sim.settlements.map((o, j) => ({ id: j, name: o.name, w: sim.contact[id * n + j] })).filter((c) => c.id !== id && c.w > 0.005).sort((a, b) => b.w - a.w).slice(0, 6);
  return {
    id, name: s.name, x: s.x, y: s.y, pop: res.length, capacity: s.capacity, food: s.food, climate: s.climate, biome: s.biomeShare, ages,
    lang: lect?.lang ?? -1, langName: sim.tracker.byId(lect?.lang ?? -1)?.name ?? null, isolated: sim.isolated.has(id),
    lect: lect ? {
      selfIntel: lect.selfIntel, mixed: lect.mixed, order: ORDERS[argmax(lect.order)],
      core: CORE_LIST.map((c) => ({ concept: CONCEPTS[c].key, form: lect.forms[c] ? romanize(lect.forms[c]!) : null, share: lect.share[c] })),
    } : null,
    contacts,
    residents: res.slice(0, 80).map((a) => ({ id: a.id, age: (sim.tick - a.born) / TICKS_PER_YEAR, lex: a.lex.size })),
  };
}

/* ---------------- languages ---------------- */
function representative(sim: Simulation, langId: number, snap: LangSnapshot): Agent | null {
  let best: Agent | null = null, bs = -1;
  const rec = sim.tracker.byId(langId);
  if (!rec) return null;
  for (const si of rec.settlements) for (const a of sim.residents[si]) {
    if ((sim.tick - a.born) / TICKS_PER_YEAR < 14) continue;
    let s = 0;
    for (let c = 0; c < N_CONCEPTS; c++) { const b = a.lex.best(c); if (b && b.etym === snap.etyms[c]) s++; }
    if (s > bs) { bs = s; best = a; }
  }
  return best;
}

export function exampleSentences(sim: Simulation, langId: number, count = 6) {
  const rec = sim.tracker.byId(langId);
  if (!rec?.current) return [];
  const sp = representative(sim, langId, rec.current);
  if (!sp) return [];
  const rng = new Rng(hash2(sim.tick + 17, langId * 31 + 7));
  const ctx = sim.langCtx(false, false);
  const sal = sim.settlements[sp.settlement].salience;
  const out: { text: string; gloss: string; translation: string; words: { text: string; gloss: string; role: string }[] }[] = [];
  for (let tries = 0; tries < 80 && out.length < count; tries++) {
    const f: Frame = generateFrame(rng, sal, tries < 20 ? 0.6 : 1);
    const u = produce(sp, f, ctx, rng, false);
    // only sentences fully expressible in the speaker's actual lexicon (no gestures, no gaps)
    if (u.words.some((w) => !w.morphs.length || w.gesture >= 0) || u.inventions) continue;
    const words = u.words.map((w) => ({
      text: romanize(w.text),
      gloss: w.morphs.map((m) => (m.kind === 'stem' ? CONCEPTS[m.concept].key : CONCEPTS[m.concept].key)).join('-'),
      role: w.role,
    }));
    const text = words.map((w) => w.text).join(' ');
    if (out.some((o) => o.text === text)) continue;
    out.push({ text, gloss: words.map((w) => w.gloss).join(' '), translation: paraphrase(f), words });
  }
  return out;
}

export function languageView(sim: Simulation, id: number) {
  const rec = sim.tracker.byId(id);
  if (!rec) return null;
  const snap = rec.current ?? rec.snapshots[rec.snapshots.length - 1];
  const vocab = [] as { concept: string; cat: string; form: string; roman: string; ipa: string; share: number; origin: string; donor: string | null; etym: number }[];
  if (snap) for (let c = 0; c < N_CONCEPTS; c++) {
    const f = snap.forms[c];
    if (!f) continue;
    const e = snap.etyms[c];
    const foreign = sim.isForeign(e, id);
    const donor = foreign ? sim.tracker.byId(sim.etymLang(e))?.name ?? null : null;
    const et = sim.etymons.get(e);
    vocab.push({ concept: CONCEPTS[c].key, cat: CONCEPTS[c].cat, form: f, roman: romanize(f), ipa: toIPA(f), share: snap.share[c], origin: foreign ? 'borrowed' : et && et.concept !== c ? 'semantic extension' : 'native', donor, etym: e });
  }
  const phon = snap ? PHONEMES.map((p, i) => ({ ipa: p.ipa, vowel: p.vowel, place: p.place, manner: p.manner, voice: p.voice, share: snap.phon[i] })) : [];
  const markers = snap ? GRAM_KEYS.map((g, i) => ({ g, gloss: CONCEPTS[GRAM_BASE + i].gloss, rate: snap.markRate[i], strategy: snap.markStrategy[i] >= 0 ? STRATEGIES[snap.markStrategy[i]] : null, form: snap.forms[GRAM_BASE + i] ? romanize(snap.forms[GRAM_BASE + i]!) : null })) : [];
  const dialects = sim.tracker.lects.filter((l) => l.lang === id).map((l) => ({
    settlement: l.settlement, name: sim.settlementName(l.settlement), speakers: sim.residents[l.settlement].length,
    distance: snap ? lexicalDistance(l.forms, snap.forms) : 0, order: ORDERS[argmax(l.order)], selfIntel: l.selfIntel, mixed: l.mixed,
    distinct: snap ? lexicalDistance(l.forms, snap.forms) > sim.cfg.dialectThreshold : false,
  }));
  const related = sim.tracker.languages.filter((o) => o.id !== id && (o.current || o.snapshots.length)).map((o) => {
    const os = o.current ?? o.snapshots[o.snapshots.length - 1];
    const li = sim.tracker.langIntel.find((x) => (x.a === id && x.b === o.id) || (x.b === id && x.a === o.id));
    return {
      id: o.id, name: o.name, color: o.color, fate: o.fate,
      relation: o.id === rec.parent ? 'parent' : o.parent === id ? 'daughter' : o.root === rec.root ? 'same family' : 'unrelated',
      cognates: snap && os ? cognateShare(snap.etyms, os.etyms) : 0, lexDist: snap && os ? lexicalDistance(snap.forms, os.forms) : 1,
      grammarDist: snap && os ? grammarDistance(snap, os) : 1, phonDist: snap && os ? phonDistanceProfiles(snap.phon, os.phon) : 1,
      intelligibility: li?.v ?? null,
    };
  }).sort((a, b) => b.cognates - a.cognates);
  // diachronic view of the core list across snapshots
  const timeline = rec.snapshots.concat(rec.current && rec.snapshots[rec.snapshots.length - 1] !== rec.current ? [rec.current] : []).slice(-8).map((s) => ({
    tick: s.tick, core: CORE_LIST.map((c) => (s.forms[c] ? romanize(s.forms[c]!) : null)), order: ORDERS[argmax(s.order)], speakers: s.speakers,
  }));
  const ancestors: { id: number; name: string }[] = [];
  let p = sim.tracker.byId(rec.parent);
  while (p) { ancestors.push({ id: p.id, name: p.name }); p = sim.tracker.byId(p.parent); }
  return {
    id, name: rec.name, color: rec.color, fate: rec.fate, born: rec.born, died: rec.died, parent: rec.parent, mergedInto: rec.mergedInto, root: rec.root,
    speakers: rec.speakers, settlements: rec.settlements.map((s) => ({ id: s, name: sim.settlementName(s) })), mixed: rec.mixed,
    order: snap ? Array.from(snap.order) : [], orderNames: ORDERS, adj: snap?.adj ?? [0.5, 0.5], obl: snap?.obl ?? [0.5, 0.5],
    vocab, phon, markers, rules: snap?.rules ?? [], dialects, related, timeline, coreList: CORE_LIST.map((c) => CONCEPTS[c].key),
    events: rec.events.slice().reverse(), history: rec.history, ancestors,
    daughters: sim.tracker.languages.filter((o) => o.parent === id).map((o) => ({ id: o.id, name: o.name, fate: o.fate })),
    examples: rec.fate === 'alive' ? exampleSentences(sim, id) : [],
    borrowedIn: Object.entries(rec.borrowedIn).map(([k, v]) => ({ id: Number(k), name: sim.tracker.byId(Number(k))?.name ?? '?', count: v })),
    isolation: rec.isolation, isolatedSince: rec.isolatedSince,
  };
}
export type LanguageView = NonNullable<ReturnType<typeof languageView>>;

export function atlasView(sim: Simulation) {
  const langs = sim.tracker.languages;
  const alive = langs.filter((l) => l.fate === 'alive');
  const snapOf = (l: (typeof langs)[number]) => l.current ?? l.snapshots[l.snapshots.length - 1];
  const M = alive.length;
  const mat = (fn: (a: LangSnapshot, b: LangSnapshot) => number) => alive.map((a) => alive.map((b) => (a === b ? 1 : fn(snapOf(a)!, snapOf(b)!))));
  const intel = alive.map((a) => alive.map((b) => (a === b ? 1 : sim.tracker.langIntel.find((x) => (x.a === a.id && x.b === b.id) || (x.a === b.id && x.b === a.id))?.v ?? 0)));
  const core = alive.map((l) => ({ id: l.id, words: CORE_LIST.map((c) => { const s = snapOf(l); return s?.forms[c] ? { roman: romanize(s.forms[c]!), etym: s.etyms[c] } : null; }) }));
  const grammar = alive.map((l) => {
    const s = snapOf(l)!;
    return { id: l.id, order: ORDERS[argmax(s.order)], orderW: Array.from(s.order), adj: s.adj[0] >= s.adj[1] ? 'Mod–N' : 'N–Mod', obl: s.obl[0] >= s.obl[1] ? 'Obl–Core' : 'Core–Obl', markers: GRAM_KEYS.map((g, i) => (s.markRate[i] >= 0.4 && s.markStrategy[i] >= 0 ? STRATEGIES[s.markStrategy[i]] : null)) };
  });
  const phon = alive.map((l) => ({ id: l.id, shares: Array.from(snapOf(l)!.phon) }));
  void M;
  return {
    languages: langSummaries(sim), alive: alive.map((l) => l.id), tick: sim.tick,
    cognates: mat((a, b) => cognateShare(a.etyms, b.etyms)),
    lexical: mat((a, b) => 1 - lexicalDistance(a.forms, b.forms)),
    phonological: mat((a, b) => 1 - phonDistanceProfiles(a.phon, b.phon)),
    grammatical: mat((a, b) => 1 - grammarDistance(a, b)),
    intel, core, coreList: CORE_LIST.map((c) => CONCEPTS[c].key), grammar, gramKeys: GRAM_KEYS, phon, phonemes: PHONEMES.map((p) => ({ ipa: p.ipa, vowel: p.vowel })),
    lects: sim.tracker.lects.map((l) => ({ settlement: l.settlement, name: sim.settlementName(l.settlement), lang: l.lang, established: l.established })),
  };
}
export type AtlasView = ReturnType<typeof atlasView>;

export function episodeList(sim: Simulation) {
  return sim.episodes.slice().reverse().map((e) => ({
    id: e.id, tick: e.tick, speaker: e.speaker, listener: e.listener, success: e.success, kind: e.kind, sSet: sim.settlementName(e.sSet), lSet: sim.settlementName(e.lSet),
    turns: e.turns.length, text: e.turns[0]?.words.map((w) => (w.text ? romanize(w.text) : '⟨gesture⟩')).join(' ') ?? '', translation: paraphrase(e.target),
  }));
}

export function episodeView(sim: Simulation, id: number) {
  const e = sim.episodes.find((x) => x.id === id);
  if (!e) return null;
  const sp = sim.agentById.get(e.speaker), li = sim.agentById.get(e.listener);
  const knowledge = (a: Agent | undefined, concepts: number[]) => (a ? concepts.map((c) => ({ concept: CONCEPTS[c].key, forms: a.lex.byConcept[c].slice().sort((x, y) => y.score - x.score).slice(0, 3).map((x) => ({ roman: romanize(x.form), score: x.score })) })) : []);
  const tc = new Set<number>();
  const f = e.target;
  [f.v, f.a?.h, f.a?.p, f.o?.h, f.o?.p, f.r?.h, f.l].forEach((c) => c !== undefined && c >= 0 && tc.add(c));
  return {
    ...e,
    sSetName: sim.settlementName(e.sSet), lSetName: sim.settlementName(e.lSet),
    targetText: paraphrase(e.target), contextText: e.context.map(paraphrase),
    turns: e.turns.map((t) => ({
      ...t,
      words: t.words.map((w) => ({ ...w, roman: romanize(w.text), heardRoman: romanize(w.heard || ''), gestureConcept: w.gesture >= 0 ? CONCEPTS[w.gesture].key : null, morphs: w.morphs.map((m) => ({ ...m, roman: romanize(m.form), gloss: CONCEPTS[m.concept].key, alts: m.alts?.map((x) => ({ roman: romanize(x.form), score: x.score })) })) })),
      analysis: t.analysis.map((a) => ({ heard: romanize(a.heard), stem: romanize(a.stem), chosen: a.chosen ? CONCEPTS[a.chosen.concept].key : null, conf: a.chosen?.conf ?? 0, sim: a.sim, senses: a.senses.slice(0, 3).map((s) => ({ concept: CONCEPTS[s.concept].key, conf: s.conf })), marks: a.marks.map((m) => CONCEPTS[m.g].key), pre: romanize(a.pre), suf: romanize(a.suf), role: a.role, gesture: a.gesture >= 0 ? CONCEPTS[a.gesture].key : null })),
      interpretation: interpText(t.frame),
      orderName: ORDERS[t.order],
    })),
    updates: e.updates.map((u) => ({ ...u, concept: CONCEPTS[u.concept].key, roman: romanize(u.form) })),
    speakerKnowledge: knowledge(sp, [...tc]), listenerKnowledge: knowledge(li, [...tc]),
    speakerOrder: sp ? Array.from(sp.gram.order) : null, listenerOrder: li ? Array.from(li.gram.order) : null,
  };
}

function interpText(fr: { v: number; a: { h: number; p: number; pl: boolean } | null; o: { h: number; p: number; pl: boolean } | null; r: { h: number; p: number; pl: boolean } | null; l: number; t: number; n: boolean; q: boolean }) {
  const e = (x: { h: number; p: number; pl: boolean } | null) => (x ? `${x.p >= 0 ? CONCEPTS[x.p].key + ' ' : ''}${CONCEPTS[x.h].key}${x.pl ? ' (pl)' : ''}` : '?');
  return {
    agent: e(fr.a), verb: fr.v >= 0 ? CONCEPTS[fr.v].key : '?', patient: fr.o ? e(fr.o) : null, recipient: fr.r ? e(fr.r) : null, location: fr.l >= 0 ? CONCEPTS[fr.l].key : null,
    tense: ['present', 'past', 'future'][fr.t], neg: fr.n, q: fr.q,
  };
}

export function agentList(sim: Simulation) {
  const t = sim.tick;
  return sim.agents.map((a) => ({
    id: a.id, age: (t - a.born) / TICKS_PER_YEAR, generation: a.generation, settlement: a.settlement, settlementName: sim.settlementName(a.settlement),
    lang: a.langId, lex: a.lex.size, traveling: !!a.travel,
    successS: a.stats.spoke ? a.stats.okS / a.stats.spoke : null, successL: a.stats.heard ? a.stats.okL / a.stats.heard : null,
    innovation: a.traits.innovation, prestige: a.traits.prestige, order: ORDERS[argmax(a.gram.order)],
  }));
}
export type AgentListView = ReturnType<typeof agentList>;

export function historyView(sim: Simulation) {
  return { samples: sim.history, defs: METRIC_DEFS, orders: ORDERS, gram: GRAM_KEYS };
}

export function treeView(sim: Simulation) {
  return {
    languages: langSummaries(sim), tick: sim.tick,
    history: sim.tracker.languages.map((l) => {
      const h = l.history;
      const step = Math.max(1, Math.ceil(h.length / 80));
      return h.filter((_, i) => i % step === 0 || i === h.length - 1).map((x) => [x.tick, x.speakers]);
    }),
    events: sim.tracker.languages.map((l) => ({ id: l.id, events: l.events.filter((e) => ['split', 'merge', 'contact', 'isolation', 'grammar', 'birth', 'extinct'].includes(e.type)).slice(-12) })),
  };
}
export type TreeView = ReturnType<typeof treeView>;

export { N_CONTENT, N_GRAM, NP };
