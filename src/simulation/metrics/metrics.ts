/**
 * SCIENTIFIC METRICS
 * Every metric has an operational definition below (`METRIC_DEFS`). We distinguish:
 *  - direct: an exact property of the simulated system (e.g., fraction of successful games);
 *  - proxy:  a rough operationalisation of a complex real-world linguistic notion
 *            (e.g., "compositionality" as success on unseen meaning combinations).
 */
import type { Simulation } from '../engine/simulation';
import { argmax } from '../agents/agent';
import { CONCEPTS, GRAM_BASE, N_CONTENT, N_GRAM, semSim } from '../language/concepts';
import { NP } from '../language/phonology';
import { TICKS_PER_YEAR } from '../core/config';
import { lexicalDistance } from '../evolution/languages';

export interface Counters {
  episodes: number;
  success: number;
  firstTry: number;
  misunderstood: number;
  turns: number;
  fidelity: number;
  novel: number;
  novelOk: number;
  familiar: number;
  familiarOk: number;
  gestures: number;
  words: number;
  inventions: number;
  borrowings: number;
  births: number;
  deaths: number;
  migrations: number;
  soundChanges: number;
  transmission: number;
  transmissionN: number;
  crossEpisodes: number;
  crossOk: number;
}

export const newCounters = (): Counters => ({
  episodes: 0, success: 0, firstTry: 0, misunderstood: 0, turns: 0, fidelity: 0, novel: 0, novelOk: 0, familiar: 0, familiarOk: 0,
  gestures: 0, words: 0, inventions: 0, borrowings: 0, births: 0, deaths: 0, migrations: 0, soundChanges: 0, transmission: 0, transmissionN: 0, crossEpisodes: 0, crossOk: 0,
});

export interface MetricSample {
  tick: number;
  year: number;
  population: number;
  inhabited: number;
  meanGeneration: number;
  // communication
  success: number;
  firstTry: number;
  misunderstanding: number;
  turns: number;
  fidelity: number;
  crossSuccess: number;
  intelligibility: number;
  gestureRate: number;
  inventionRate: number;
  // vocabulary
  vocabSize: number;
  distinctForms: number;
  coverage: number;
  sharedVocab: number;
  lexDiversity: number;
  synonymy: number;
  homonymy: number;
  polysemy: number;
  // grammar
  order: number[];
  orderEntropy: number;
  markerUse: number[];
  constructionDiversity: number;
  compNovel: number;
  compFamiliar: number;
  // phonology
  phonInventory: number;
  phonEntropy: number;
  wordLength: number;
  soundChanges: number;
  // evolution
  languages: number;
  families: number;
  dialects: number;
  dialectDistance: number;
  divergence: number;
  replacement: number;
  extinctions: number;
  borrowings: number;
  transmission: number;
}

export type MetricKey = Exclude<keyof MetricSample, 'tick' | 'year' | 'order' | 'markerUse'>;

export interface MetricDef {
  key: MetricKey;
  label: string;
  group: 'Population' | 'Communication' | 'Vocabulary' | 'Grammar' | 'Phonology' | 'Evolution';
  kind: 'direct' | 'proxy';
  unit?: '%' | '';
  formula: string;
  meaning: string;
  limits: string;
}

export const METRIC_DEFS: MetricDef[] = [
  { key: 'population', label: 'Living agents', group: 'Population', kind: 'direct', formula: 'count(alive agents)', meaning: 'Total population.', limits: 'Agents are abstract speakers, not demographically realistic people.' },
  { key: 'meanGeneration', label: 'Mean generation', group: 'Population', kind: 'direct', formula: 'mean(agent.generation)', meaning: 'How many generations of transmission separate the population from the founders.', limits: 'Generation = max(parent generations) + 1.' },
  { key: 'success', label: 'Communicative success', group: 'Communication', kind: 'direct', unit: '%', formula: 'successful games / games in window (one repair turn with gestures allowed)', meaning: 'Share of language games in which the listener eventually picked the intended scene.', limits: 'Includes success obtained through gestures and repair, and lucky guesses among tied candidates.' },
  { key: 'firstTry', label: 'First-attempt success', group: 'Communication', kind: 'direct', unit: '%', formula: 'games understood on turn 1 / games', meaning: 'Understanding without any clarification.', limits: 'Context size (default 4 scenes) sets a chance baseline of about 25%.' },
  { key: 'misunderstanding', label: 'Misunderstanding rate', group: 'Communication', kind: 'direct', unit: '%', formula: 'games where the listener confidently chose a wrong scene at least once / games', meaning: 'Distinguishes active misunderstanding from non-understanding.', limits: 'A misunderstanding that is later repaired still counts.' },
  { key: 'turns', label: 'Turns to understand', group: 'Communication', kind: 'direct', formula: 'mean turns per game; 1 or 2 when understood, failed games count as 3', meaning: 'Average time to understand an expression, in conversational turns.', limits: 'At most one repair turn is attempted.' },
  { key: 'fidelity', label: 'Comprehension fidelity', group: 'Communication', kind: 'direct', unit: '%', formula: 'mean fraction of target features (predicate, roles, number, tense, negation…) recovered in the final interpretation', meaning: 'Graded understanding, independent of whether the context made guessing easy.', limits: 'Features are weighted equally.' },
  { key: 'crossSuccess', label: 'Cross-settlement success', group: 'Communication', kind: 'direct', unit: '%', formula: 'success rate of games between agents of different settlements', meaning: 'How well people understand visitors and traders.', limits: 'Depends on which settlements happen to meet.' },
  { key: 'intelligibility', label: 'Mutual intelligibility index', group: 'Communication', kind: 'proxy', unit: '%', formula: 'mean over pairs of inhabited settlements of S = EMA(0.65·RI + 0.35·C), where RI = ½[I(A→B)/I(B→B) + I(B→A)/I(A→A)], I = first-turn success in 6 test games per ordered pair with learning and gestures disabled, C = cognate share, EMA weights 0.6 old / 0.4 new', meaning: 'Measured understanding between communities, normalised by each community’s internal success and stabilised with exact lexical overlap. This is the quantity used to draw language boundaries.', limits: 'Proxy: the behavioural part is noisy (small samples) and is mixed with a lexical term to keep language identification stable.' },
  { key: 'gestureRate', label: 'Gesture reliance', group: 'Communication', kind: 'direct', unit: '%', formula: 'gesture tokens / word tokens produced', meaning: 'Reliance on pointing and pantomime, high in early language.', limits: 'Gestures are an idealised channel that conveys a concept with fixed probability.' },
  { key: 'inventionRate', label: 'Word inventions per game', group: 'Communication', kind: 'direct', formula: 'new word forms invented / games', meaning: 'Rate of lexical innovation.', limits: 'Counts invention, not adoption.' },
  { key: 'vocabSize', label: 'Vocabulary size (per agent)', group: 'Vocabulary', kind: 'direct', formula: 'mean count of content entries with association ≥ 0.1 per adult', meaning: 'Individual lexicon size including synonyms and variants.', limits: 'The meaning space is fixed at 64 concepts + 8 grammatical meanings.' },
  { key: 'distinctForms', label: 'Distinct word forms', group: 'Vocabulary', kind: 'direct', formula: 'number of distinct (form, concept) best-entries across all adults', meaning: 'Population-level lexical variety.', limits: 'Grows with population size.' },
  { key: 'coverage', label: 'Semantic coverage', group: 'Vocabulary', kind: 'direct', unit: '%', formula: 'mean over adults of (content concepts with an entry ≥ 0.1) / 64', meaning: 'How much of the meaning space individuals can name.', limits: 'Concepts rarely salient in an environment are expected to be lost.' },
  { key: 'sharedVocab', label: 'Shared vocabulary', group: 'Vocabulary', kind: 'direct', unit: '%', formula: 'mean over settlements of (concepts whose most common form is used by ≥ 60% of adult residents) / 64', meaning: 'Degree of convention within communities.', limits: 'Threshold of 60% is a modelling choice.' },
  { key: 'lexDiversity', label: 'Lexical diversity', group: 'Vocabulary', kind: 'direct', formula: 'mean over concepts of Shannon entropy (bits) of the distribution of adults’ preferred forms', meaning: 'High = many competing words; low = standardised.', limits: 'Pools all settlements, so geographic diversity raises it.' },
  { key: 'synonymy', label: 'Synonym frequency', group: 'Vocabulary', kind: 'direct', formula: 'mean number of forms ≥ 0.1 per named concept per adult', meaning: 'Lexical competition inside individual minds.', limits: 'Pronunciation variants of the same word count as synonyms.' },
  { key: 'homonymy', label: 'Homonymy', group: 'Vocabulary', kind: 'direct', unit: '%', formula: 'share of an adult’s forms linked to ≥ 2 semantically unrelated concepts (similarity < 0.5)', meaning: 'Accidental form collisions, e.g. after sound mergers.', limits: 'Semantic relatedness comes from hand-assigned tags.' },
  { key: 'polysemy', label: 'Polysemy', group: 'Vocabulary', kind: 'direct', unit: '%', formula: 'share of an adult’s forms linked to ≥ 2 related concepts (similarity ≥ 0.5)', meaning: 'Meaning extension by metaphor and metonymy.', limits: 'Same tag-based relatedness as homonymy.' },
  { key: 'orderEntropy', label: 'Word-order entropy', group: 'Grammar', kind: 'direct', formula: 'Shannon entropy (bits) of adults’ dominant basic word orders (max log2 6 ≈ 2.58)', meaning: 'Low = population converged on one order.', limits: 'Pools languages; use the atlas for per-language orders.' },
  { key: 'constructionDiversity', label: 'Construction diversity', group: 'Grammar', kind: 'direct', formula: 'mean over grammatical meanings of entropy of dominant attachment strategy (prefix/suffix/particle-before/after) among adults who mark it', meaning: 'Variety of morphosyntactic strategies.', limits: 'Strategy is a 4-way abstraction of morphology.' },
  { key: 'compNovel', label: 'Compositional generalisation', group: 'Grammar', kind: 'proxy', unit: '%', formula: 'success rate on games whose (verb, agent, patient) combination the listener has never encountered', meaning: 'Can agents understand new combinations of familiar words and constructions?', limits: 'Proxy: success can also come from context elimination, not composition.' },
  { key: 'compFamiliar', label: 'Success on familiar combinations', group: 'Grammar', kind: 'direct', unit: '%', formula: 'success rate on previously encountered combinations', meaning: 'Baseline for the generalisation metric.', limits: 'Listener memory of combinations is bounded by memory capacity.' },
  { key: 'phonInventory', label: 'Phoneme inventory', group: 'Phonology', kind: 'direct', formula: 'number of phonemes with ≥ 1% share of segments in settlements’ consensus words', meaning: 'Effective sound-system size.', limits: 'Out of a universal pool of 26 segments.' },
  { key: 'phonEntropy', label: 'Phonological diversity', group: 'Phonology', kind: 'direct', formula: 'Shannon entropy (bits) of segment frequencies in consensus words', meaning: 'How evenly sounds are used.', limits: 'Ignores phonotactics.' },
  { key: 'wordLength', label: 'Average word length', group: 'Phonology', kind: 'direct', formula: 'mean segment count of consensus content words', meaning: 'Erosion by sound change shortens words; invention resets length.', limits: 'Segments, not syllables.' },
  { key: 'soundChanges', label: 'Sound changes actuated', group: 'Phonology', kind: 'direct', formula: 'new conditioned sound-change rules actuated in window', meaning: 'Sound-change frequency.', limits: 'Most actuated changes die out; see atlas for those that spread.' },
  { key: 'languages', label: 'Languages', group: 'Evolution', kind: 'proxy', formula: 'average-linkage clusters of settlement lects whose intelligibility index ≥ threshold (hysteresis: −0.10 for lects already together, +0.05 to join)', meaning: 'Language diversity.', limits: 'Language boundaries depend on the configurable threshold (default 0.62).' },
  { key: 'families', label: 'Language families', group: 'Evolution', kind: 'proxy', formula: 'distinct root ancestors among living languages', meaning: 'Independently emerged lineages.', limits: 'A root = a language that emerged without a detectable parent.' },
  { key: 'dialects', label: 'Distinct dialects', group: 'Evolution', kind: 'proxy', formula: 'settlement lects whose lexical distance to their language consensus exceeds the dialect threshold', meaning: 'Internal variation within languages.', limits: 'Dialects are tied to settlements.' },
  { key: 'dialectDistance', label: 'Dialect distance', group: 'Evolution', kind: 'direct', formula: 'mean phonetically weighted lexical distance between lects of the same language', meaning: 'Internal divergence.', limits: 'Weighted Levenshtein over articulatory features.' },
  { key: 'divergence', label: 'Linguistic divergence', group: 'Evolution', kind: 'direct', formula: 'mean lexical distance between lects of different languages', meaning: 'How far apart languages have drifted.', limits: 'Unrelated words still score < 1 by chance similarity.' },
  { key: 'replacement', label: 'Vocabulary replacement', group: 'Evolution', kind: 'direct', unit: '%', formula: 'share of concepts whose consensus etymon changed since the previous analysis, mean over settlements', meaning: 'Rate of lexical turnover.', limits: 'Per analysis interval (default 5 years).' },
  { key: 'extinctions', label: 'Extinctions (cumulative)', group: 'Evolution', kind: 'direct', formula: 'languages whose last community disappeared', meaning: 'Language death by depopulation.', limits: 'Convergence/absorption is counted separately in the atlas.' },
  { key: 'borrowings', label: 'Borrowing events', group: 'Evolution', kind: 'direct', formula: 'new lexical entries whose etymon originated outside the learner’s language lineage, in window', meaning: 'Language contact intensity.', limits: 'Individual adoptions; many never spread.' },
  { key: 'transmission', label: 'Transmission fidelity', group: 'Evolution', kind: 'direct', unit: '%', formula: 'for agents reaching age 16: share of the parent’s named concepts for which the child’s preferred word has the same etymon', meaning: 'Generational transmission fidelity.', limits: 'Children also learn from peers, so <100% is expected even without loss.' },
];

function entropy(counts: number[]): number {
  const tot = counts.reduce((a, b) => a + b, 0);
  if (!tot) return 0;
  let h = 0;
  for (const c of counts) if (c > 0) { const p = c / tot; h -= p * Math.log2(p); }
  return h;
}

export function computeSample(sim: Simulation, k: Counters, prevEtyms: Map<number, number[]>): MetricSample {
  const tick = sim.tick;
  const adults = sim.agents.filter((a) => (tick - a.born) / TICKS_PER_YEAR >= 10);
  const nA = Math.max(1, adults.length);
  let vocab = 0, cov = 0, syn = 0, synN = 0, hom = 0, poly = 0, formsN = 0;
  const orderCounts = new Array(6).fill(0);
  const markerUse = new Array(N_GRAM).fill(0);
  const stratCounts = Array.from({ length: N_GRAM }, () => [0, 0, 0, 0]);
  const conceptForms: Map<string, number>[] = Array.from({ length: N_CONTENT }, () => new Map());
  const distinct = new Set<string>();
  for (const a of adults) {
    let named = 0;
    for (let c = 0; c < N_CONTENT; c++) {
      const list = a.lex.byConcept[c];
      let n = 0;
      let best = null as null | { form: string; score: number };
      for (const e of list) if (e.score >= 0.1) { n++; if (!best || e.score > best.score) best = e; }
      if (n) { named++; syn += n; synN++; }
      vocab += n;
      if (best) {
        const m = conceptForms[c];
        m.set(best.form, (m.get(best.form) ?? 0) + 1);
        distinct.add(c + ':' + best.form);
      }
    }
    cov += named / N_CONTENT;
    for (const [, list] of a.lex.byForm) {
      const cs = list.filter((e) => e.score >= 0.1 && e.concept < N_CONTENT).map((e) => e.concept);
      if (!cs.length) continue;
      formsN++;
      if (cs.length >= 2) {
        let related = false, unrelated = false;
        for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) (semSim(cs[i], cs[j]) >= 0.5 ? (related = true) : (unrelated = true));
        if (unrelated) hom++; else if (related) poly++;
      }
    }
    orderCounts[argmax(a.gram.order)]++;
    for (let g = 0; g < N_GRAM; g++) {
      const b = a.lex.best(GRAM_BASE + g);
      if (b && b.score >= 0.15) { markerUse[g]++; stratCounts[g][argmax(a.gram.mark, g * 4, 4)]++; }
    }
  }
  let lexDiv = 0;
  for (let c = 0; c < N_CONTENT; c++) lexDiv += entropy([...conceptForms[c].values()]) / N_CONTENT;
  let cdiv = 0, cdn = 0;
  for (let g = 0; g < N_GRAM; g++) if (markerUse[g] > 0) { cdiv += entropy(stratCounts[g]); cdn++; }

  // lect-based measures (from latest analysis, which runs on the same tick)
  const lects = sim.tracker.lects;
  let shared = 0;
  const phonTot = new Array(NP).fill(0);
  let wl = 0, wn = 0, repl = 0, replN = 0;
  for (const l of lects) {
    let s = 0;
    for (let c = 0; c < N_CONTENT; c++) if (l.share[c] >= 0.6) s++;
    shared += s / N_CONTENT / Math.max(1, lects.length);
    for (let c = 0; c < N_CONTENT; c++) {
      const f = l.forms[c];
      if (!f) continue;
      wl += f.length; wn++;
    }
    for (let i = 0; i < NP; i++) phonTot[i] += l.phon[i];
    const prev = prevEtyms.get(l.settlement);
    if (prev) {
      let ch = 0, n = 0;
      for (let c = 0; c < N_CONTENT; c++) if (prev[c] >= 0 && l.etyms[c] >= 0) { n++; if (prev[c] !== l.etyms[c]) ch++; }
      if (n) { repl += ch / n; replN++; }
    }
  }
  const phonSum = phonTot.reduce((a, b) => a + b, 0) || 1;
  const phonShares = phonTot.map((x) => x / phonSum);
  let dd = 0, ddn = 0, dv = 0, dvn = 0, ri = 0, rin = 0;
  const rel = sim.tracker.rel;
  for (let i = 0; i < lects.length; i++) for (let j = i + 1; j < lects.length; j++) {
    const d = lexicalDistance(lects[i].forms, lects[j].forms);
    if (lects[i].lang >= 0 && lects[i].lang === lects[j].lang) { dd += d; ddn++; } else { dv += d; dvn++; }
    ri += rel[i]?.[j] ?? 0; rin++;
  }
  const alive = sim.tracker.alive();
  let dialects = 0;
  for (const l of lects) {
    const lang = sim.tracker.byId(l.lang);
    if (lang?.current && lang.settlements.length > 1 && lexicalDistance(l.forms, lang.current.forms) > sim.cfg.dialectThreshold) dialects++;
  }
  const genMean = sim.agents.reduce((s, a) => s + a.generation, 0) / Math.max(1, sim.agents.length);
  const E = Math.max(1, k.episodes);
  return {
    tick, year: tick / TICKS_PER_YEAR, population: sim.agents.length, inhabited: sim.residents.filter((r) => r.length > 0).length, meanGeneration: genMean,
    success: k.success / E, firstTry: k.firstTry / E, misunderstanding: k.misunderstood / E, turns: k.turns / E, fidelity: k.fidelity / E,
    crossSuccess: k.crossEpisodes ? k.crossOk / k.crossEpisodes : 0, intelligibility: rin ? ri / rin : 1,
    gestureRate: k.words ? k.gestures / k.words : 0, inventionRate: k.inventions / E,
    vocabSize: vocab / nA, distinctForms: distinct.size, coverage: cov / nA, sharedVocab: shared, lexDiversity: lexDiv,
    synonymy: synN ? syn / synN : 0, homonymy: formsN ? hom / formsN : 0, polysemy: formsN ? poly / formsN : 0,
    order: orderCounts.map((c) => c / nA), orderEntropy: entropy(orderCounts), markerUse: markerUse.map((c) => c / nA), constructionDiversity: cdn ? cdiv / cdn : 0,
    compNovel: k.novel ? k.novelOk / k.novel : 0, compFamiliar: k.familiar ? k.familiarOk / k.familiar : 0,
    phonInventory: phonShares.filter((p) => p >= 0.01).length, phonEntropy: entropy(phonTot), wordLength: wn ? wl / wn : 0, soundChanges: k.soundChanges,
    languages: alive.length, families: new Set(alive.map((l) => l.root)).size, dialects, dialectDistance: ddn ? dd / ddn : 0, divergence: dvn ? dv / dvn : 0,
    replacement: replN ? repl / replN : 0, extinctions: sim.tracker.languages.filter((l) => l.fate === 'extinct').length, borrowings: k.borrowings,
    transmission: k.transmissionN ? k.transmission / k.transmissionN : 0,
  };
}

export { CONCEPTS };
