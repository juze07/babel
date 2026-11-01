/**
 * CONTROLLED QUALITATIVE EXPERIMENTS
 * These encode the model's testable expectations (not guarantees about real languages). Each compares
 * conditions that differ in exactly one factor, averaged over seeds.
 */
import { describe, expect, it } from 'vitest';
import { makeGroup, play, rate, consensus, pair, etymDistance } from './testing/harness';
import { Simulation } from './engine/simulation';
import { defaultConfig, TICKS_PER_YEAR, type SimConfig } from './core/config';

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('controlled experiments', () => {
  it('repeated interaction makes communication more efficient', () => {
    const r = [21, 22].map((seed) => {
      const g = makeGroup(10, seed);
      const first = rate(play(g, 500));
      play(g, 4000);
      return rate(play(g, 500)) - first;
    });
    expect(Math.min(...r)).toBeGreaterThan(0.15);
  });

  it('isolation increases divergence between groups that once shared a language', () => {
    const res = [31, 32].map((seed) => {
      const iso = makeGroup(16, seed), mix = makeGroup(16, seed);
      play(iso, 6000); play(mix, 6000);
      const [A, B] = [iso.agents.slice(0, 8), iso.agents.slice(8)];
      const [A2, B2] = [mix.agents.slice(0, 8), mix.agents.slice(8)];
      play(iso, 8000, () => (iso.rng.chance(0.5) ? pair(iso, A) : pair(iso, B)));
      play(mix, 8000, () => pair(mix));
      return { iso: etymDistance(A, B), mix: etymDistance(A2, B2) };
    });
    expect(mean(res.map((r) => r.iso))).toBeGreaterThan(mean(res.map((r) => r.mix)) + 0.05);
  });

  it('extreme forgetting reduces lexical stability and understanding', () => {
    const res = [41, 42].map((seed) => {
      const base = makeGroup(10, seed), weak = makeGroup(10, seed, { forgetting: 0.6, memoryCapacity: 40 });
      play(base, 6000); play(weak, 6000);
      return { b: consensus(base.agents), w: consensus(weak.agents), bs: rate(play(base, 600)), ws: rate(play(weak, 600)) };
    });
    expect(mean(res.map((r) => r.w))).toBeLessThan(mean(res.map((r) => r.b)) - 0.2);
    expect(mean(res.map((r) => r.ws))).toBeLessThan(mean(res.map((r) => r.bs)));
  });

  it('contact and mixing keep communities more intelligible and increase borrowing', () => {
    const run = (seed: number, over: Partial<SimConfig>) => {
      const cfg: SimConfig = { ...defaultConfig('archipelago', seed), settlements: 4, agentsPerSettlement: 14, maxPopulation: 130, initialMixingYears: 0, ...over };
      const s = new Simulation(cfg);
      for (let i = 0; i < 70 * TICKS_PER_YEAR; i++) s.step();
      const tail = s.history.slice(-5);
      return { intel: mean(tail.map((h) => h.intelligibility)), borrow: s.history.reduce((a, h) => a + h.borrowings, 0), cross: mean(tail.map((h) => h.crossSuccess)) };
    };
    const iso = [51, 52].map((s) => run(s, { externalContact: 0.01, migrationRate: 0, contactRange: 10 }));
    const mix = [51, 52].map((s) => run(s, { externalContact: 0.45, migrationRate: 0.015, contactRange: 120 }));
    expect(mean(mix.map((r) => r.intel))).toBeGreaterThan(mean(iso.map((r) => r.intel)));
    expect(mean(mix.map((r) => r.borrow))).toBeGreaterThan(mean(iso.map((r) => r.borrow)));
  });
});
