import { describe, expect, it } from 'vitest';
import { Simulation } from './simulation';
import { defaultConfig, TICKS_PER_YEAR, type SimConfig } from '../core/config';
import { METRIC_DEFS } from '../metrics/metrics';

const small = (seed = 11, over: Partial<SimConfig> = {}): SimConfig => ({ ...defaultConfig('valley', seed), settlements: 4, agentsPerSettlement: 14, maxPopulation: 120, ...over });

describe('determinism and snapshots', () => {
  it('the same seed and configuration reproduce the same run', () => {
    const a = new Simulation(small(5)), b = new Simulation(small(5)), c = new Simulation(small(6));
    for (let i = 0; i < 60; i++) { a.step(); b.step(); c.step(); }
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.stateHash()).not.toBe(c.stateHash());
  });
  it('a restored snapshot continues exactly like the original', () => {
    const a = new Simulation(small(8));
    for (let i = 0; i < 80; i++) a.step();
    const snap = JSON.parse(JSON.stringify(a.serialize()));
    const b = Simulation.deserialize(snap);
    expect(b.stateHash()).toBe(a.stateHash());
    for (let i = 0; i < 80; i++) { a.step(); b.step(); }
    expect(b.stateHash()).toBe(a.stateHash());
    expect(b.tracker.languages.map((l) => l.name)).toEqual(a.tracker.languages.map((l) => l.name));
  });
});

describe('social dynamics', () => {
  it('migrants travel along routes and settle at their destination', () => {
    const s = new Simulation(small(12));
    for (let i = 0; i < 8; i++) s.step();
    const before = s.residents[1].length;
    s.intervene({ kind: 'migrate', from: 0, to: 1, count: 5 });
    const travellers = s.agents.filter((a) => a.travel && a.travel.to === 1).map((a) => a.id);
    expect(travellers.length).toBe(5);
    for (let i = 0; i < 6 * TICKS_PER_YEAR; i++) s.step();
    const arrived = travellers.filter((id) => s.agentById.get(id)?.settlement === 1);
    expect(arrived.length).toBeGreaterThanOrEqual(4); // one may die on the way
    expect(s.residents[1].length).toBeGreaterThan(before - 2);
  });
  it('children acquire their parents’ vocabulary (cultural transmission)', () => {
    const s = new Simulation(small(13));
    for (let i = 0; i < 70 * TICKS_PER_YEAR; i++) s.step();
    const recent = s.history.slice(-6).filter((h) => h.transmission > 0);
    expect(recent.length).toBeGreaterThan(0);
    const mean = recent.reduce((x, h) => x + h.transmission, 0) / recent.length;
    expect(mean).toBeGreaterThan(0.35);
    expect(s.agents.some((a) => a.generation >= 2)).toBe(true);
  });
  it('identifies languages from measured intelligibility and assigns every community', () => {
    const s = new Simulation(small(14));
    for (let i = 0; i < 40 * TICKS_PER_YEAR; i++) s.step();
    const alive = s.tracker.languages.filter((l) => l.fate === 'alive');
    expect(alive.length).toBeGreaterThan(0);
    for (const l of s.tracker.lects) if (l.established) expect(l.lang).toBeGreaterThanOrEqual(0);
    for (const l of alive) expect(l.name.length).toBeGreaterThan(1);
  });
});

describe('metrics', () => {
  it('every documented metric is computed, finite and in range', () => {
    const s = new Simulation(small(15));
    for (let i = 0; i < 30 * TICKS_PER_YEAR; i++) s.step();
    const h = s.history[s.history.length - 1];
    for (const d of METRIC_DEFS) {
      const v = h[d.key];
      expect(Number.isFinite(v), d.key).toBe(true);
      if (d.unit === '%') { expect(v, d.key).toBeGreaterThanOrEqual(0); expect(v, d.key).toBeLessThanOrEqual(1.0001); }
      expect(d.formula.length).toBeGreaterThan(10);
      expect(['direct', 'proxy']).toContain(d.kind);
    }
    expect(h.order.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
    expect(h.success).toBeGreaterThan(0.3);
  });
});
