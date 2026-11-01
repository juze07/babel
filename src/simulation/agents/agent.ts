/**
 * AGENTS — autonomous speakers with independent cognitive state.
 * Nothing linguistic is shared globally: every agent owns its lexicon, grammar weights, accent
 * (active sound-change rules), phonological habits and social ties.
 */
import { Rng } from '../core/rng';
import type { TraitMeans } from '../core/config';
import { Lexicon } from './lexicon';
import { NP } from '../language/phonology';
import { N_GRAM } from '../language/concepts';
import type { AccentRule } from '../language/soundChange';

export const ORDERS = ['SOV', 'SVO', 'VSO', 'VOS', 'OVS', 'OSV'] as const;
export type OrderName = (typeof ORDERS)[number];
/** Each order as constituent sequence: A = agent/subject, V = verb, P = patient/object. */
export const ORDER_SEQ: ('A' | 'V' | 'P')[][] = ORDERS.map((o) => [...o].map((c) => (c === 'S' ? 'A' : c === 'O' ? 'P' : 'V')) as ('A' | 'V' | 'P')[]);
export const STRATEGIES = ['prefix', 'suffix', 'particle before', 'particle after'] as const;

export interface Traits extends TraitMeans {
  sociability: number;
  prestige: number;
  mobility: number;
}

export interface Grammar {
  order: Float64Array; // 6 word-order weights
  adj: Float64Array; // [modifier before noun, after]
  obl: Float64Array; // obliques (recipient/location) [before core, after core]
  mark: Float64Array; // N_GRAM × 4 attachment strategy weights
  need: Float64Array; // functional pressure for each grammatical meaning (accumulated failures)
}

export interface Relation { w: number; k: 0 | 1 | 2 } // family, friend, trade

export interface MemoryItem { tick: number; ep: number; partner: number; role: 'S' | 'L'; ok: boolean; text: string; gloss: string }
export interface LearnItem { tick: number; kind: string; concept: number; form: string; partner: number }

export interface Travel { from: number; to: number; t0: number; t1: number; path: number[] }

export interface Agent {
  id: number;
  alive: boolean;
  born: number;
  died: number;
  generation: number;
  settlement: number;
  birthplace: number;
  mother: number;
  father: number;
  traits: Traits;
  lex: Lexicon;
  gram: Grammar;
  accent: AccentRule[];
  habit: Float64Array;
  accentFam: Map<number, number>;
  relations: Map<number, Relation>;
  memory: MemoryItem[];
  learnLog: LearnItem[];
  seen: Set<number>;
  stats: { spoke: number; heard: number; okS: number; okL: number };
  travel: Travel | null;
  langId: number;
  adultChecked: boolean;
  jx: number; // visual jitter around settlement
  jy: number;
}

export function newGrammar(rng: Rng): Grammar {
  const order = new Float64Array(6);
  for (let i = 0; i < 6; i++) order[i] = 1 + rng.next() * 0.25;
  normalize(order);
  const adj = new Float64Array([1 + rng.next() * 0.2, 1 + rng.next() * 0.2]); normalize(adj);
  const obl = new Float64Array([1 + rng.next() * 0.2, 1 + rng.next() * 0.2]); normalize(obl);
  const mark = new Float64Array(N_GRAM * 4);
  for (let g = 0; g < N_GRAM; g++) { for (let s = 0; s < 4; s++) mark[g * 4 + s] = 1 + rng.next() * 0.2; normalize(mark, g * 4, 4); }
  return { order, adj, obl, mark, need: new Float64Array(N_GRAM) };
}

export function normalize(a: Float64Array, off = 0, len = a.length - off) {
  let s = 0;
  for (let i = off; i < off + len; i++) s += a[i];
  if (s <= 0) { for (let i = off; i < off + len; i++) a[i] = 1 / len; return; }
  for (let i = off; i < off + len; i++) a[i] /= s;
}

export function argmax(a: ArrayLike<number>, off = 0, len = a.length - off): number {
  let b = off;
  for (let i = off; i < off + len; i++) if (a[i] > a[b]) b = i;
  return b - off;
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export function sampleTraits(rng: Rng, means: TraitMeans, variance: number, parents?: [Traits, Traits]): Traits {
  const jitter = (m: number, scale: number) => m + rng.normal() * variance * scale;
  const inh = (k: keyof TraitMeans) => (parents ? (parents[0][k] + parents[1][k]) / 2 * 0.5 + means[k] * 0.5 : means[k]);
  return {
    memoryCapacity: Math.max(40, Math.round(jitter(inh('memoryCapacity'), inh('memoryCapacity')))),
    learningRate: clamp01(jitter(inh('learningRate'), 1)),
    imitation: clamp01(jitter(inh('imitation'), 1)),
    innovation: clamp01(jitter(inh('innovation'), 1)),
    confidence: clamp01(jitter(inh('confidence'), 1)),
    attention: clamp01(jitter(inh('attention'), 0.6)),
    forgetting: clamp01(jitter(inh('forgetting'), 0.3)),
    sociability: clamp01(0.5 + rng.normal() * 0.2),
    prestige: clamp01(0.3 + rng.normal() * 0.15),
    mobility: clamp01(0.5 + rng.normal() * 0.25),
  };
}

export function createAgent(id: number, rng: Rng, settlement: number, tick: number, traits: Traits, generation: number, mother = -1, father = -1): Agent {
  return {
    id, alive: true, born: tick, died: -1, generation, settlement, birthplace: settlement, mother, father, traits,
    lex: new Lexicon(), gram: newGrammar(rng), accent: [], habit: new Float64Array(NP), accentFam: new Map(),
    relations: new Map(), memory: [], learnLog: [], seen: new Set(), stats: { spoke: 0, heard: 0, okS: 0, okL: 0 },
    travel: null, langId: -1, adultChecked: false, jx: rng.normal() * 2.2, jy: rng.normal() * 2.2,
  };
}

export function ageYears(a: Agent, tick: number, ticksPerYear: number) {
  return (tick - a.born) / ticksPerYear;
}
