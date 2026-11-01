/**
 * Test harness: a closed group of agents playing language games without geography or demography.
 * Used by unit tests and controlled experiments to isolate the linguistic mechanisms.
 */
import { Rng } from '../core/rng';
import { defaultConfig, TICKS_PER_YEAR, type SimConfig, type TraitMeans } from '../core/config';
import { createAgent, sampleTraits, type Agent } from '../agents/agent';
import { runEpisode, type LangContext } from '../communication/episode';
import { N_CONTENT, CONCEPTS } from '../language/concepts';
import type { SoundRule } from '../language/soundChange';
import { NP } from '../language/phonology';

export interface Group {
  agents: Agent[];
  rng: Rng;
  cfg: SimConfig;
  tick: number;
  sal: Float64Array;
  rules: Map<number, SoundRule>;
  etymons: Map<number, { form: string; concept: number; lang: number }>;
  nextEtym: number;
}

export function makeGroup(n: number, seed = 1, traits: Partial<TraitMeans> = {}, cfgOver: Partial<SimConfig> = {}): Group {
  const cfg: SimConfig = { ...defaultConfig('valley', seed), ...cfgOver };
  cfg.traits = { ...cfg.traits, ...traits };
  const rng = new Rng(seed);
  const agents: Agent[] = [];
  for (let i = 0; i < n; i++) {
    // adults (age 25) so critical-period effects are constant
    const a = createAgent(i, rng, 0, -25 * TICKS_PER_YEAR, sampleTraits(rng, cfg.traits, 0.02), 0);
    a.langId = 0;
    agents.push(a);
  }
  const sal = new Float64Array(N_CONTENT);
  for (let c = 0; c < N_CONTENT; c++) sal[c] = CONCEPTS[c].freq;
  return { agents, rng, cfg, tick: 0, sal, rules: new Map(), etymons: new Map(), nextEtym: 0 };
}

export function ctxOf(g: Group, learning = true, record = false): LangContext {
  return {
    tick: g.tick, cfg: g.cfg, rules: g.rules, learning, record,
    newEtym: (form, concept, agent) => { const id = g.nextEtym++; g.etymons.set(id, { form, concept, lang: agent.langId }); return id; },
    etymLang: (e) => g.etymons.get(e)?.lang ?? -1,
    isForeign: (e, l) => { const s = g.etymons.get(e)?.lang ?? -1; return s >= 0 && l >= 0 && s !== l; },
  };
}

/** Play `games` random games inside the group; returns first-turn success per game. */
export function play(g: Group, games: number, pick?: () => [Agent, Agent]): boolean[] {
  const out: boolean[] = [];
  for (let k = 0; k < games; k++) {
    const [sp, li] = pick ? pick() : pair(g);
    const r = runEpisode(sp, li, g.sal, ctxOf(g), g.rng, k);
    out.push(r.success && r.turns === 1);
    if (k % 40 === 39) yearPasses(g);
  }
  return out;
}

export function pair(g: Group, agents = g.agents): [Agent, Agent] {
  const i = g.rng.int(agents.length);
  let j = g.rng.int(agents.length - 1);
  if (j >= i) j++;
  return [agents[i], agents[j]];
}

/** A tick of time: one game per agent-ish passes as 1/4 year; decay applied yearly. */
export function yearPasses(g: Group) {
  g.tick += TICKS_PER_YEAR;
  for (const a of g.agents) {
    a.lex.decay(1 - a.traits.forgetting, a.traits.memoryCapacity, g.tick, TICKS_PER_YEAR * 2);
    for (let i = 0; i < NP; i++) a.habit[i] *= 0.85;
  }
}

export const rate = (xs: boolean[]) => xs.filter(Boolean).length / Math.max(1, xs.length);

/** Share of concepts on which all agents of the group share the same preferred etymon. */
export function consensus(agents: Agent[], concepts = N_CONTENT): number {
  let agree = 0, named = 0;
  for (let c = 0; c < concepts; c++) {
    const counts = new Map<number, number>();
    for (const a of agents) { const b = a.lex.best(c); if (b && b.score >= 0.1) counts.set(b.etym, (counts.get(b.etym) ?? 0) + 1); }
    if (!counts.size) continue;
    named++;
    if (Math.max(...counts.values()) >= 0.6 * agents.length) agree++;
  }
  return named ? agree / N_CONTENT : 0;
}

/** Fraction of concepts where two groups' majority etymon differs (lexical replacement distance). */
export function etymDistance(a: Agent[], b: Agent[]): number {
  const maj = (ag: Agent[], c: number) => {
    const m = new Map<number, number>();
    for (const x of ag) { const e = x.lex.best(c); if (e && e.score >= 0.1) m.set(e.etym, (m.get(e.etym) ?? 0) + 1); }
    let best = -1, bn = 0;
    for (const [k, v] of m) if (v > bn) { bn = v; best = k; }
    return best;
  };
  let diff = 0, n = 0;
  for (let c = 0; c < N_CONTENT; c++) {
    const x = maj(a, c), y = maj(b, c);
    if (x < 0 || y < 0) continue;
    n++;
    if (x !== y) diff++;
  }
  return n ? diff / n : 0;
}
