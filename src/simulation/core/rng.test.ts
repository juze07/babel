import { describe, expect, it } from 'vitest';
import { Rng, hash2, hashUnit } from './rng';

describe('deterministic random numbers', () => {
  it('same seed gives the same stream; state can be saved and resumed', () => {
    const a = new Rng(42), b = new Rng(42);
    const xs = Array.from({ length: 50 }, () => a.next());
    expect(Array.from({ length: 50 }, () => b.next())).toEqual(xs);
    const c = new Rng(7);
    for (let i = 0; i < 10; i++) c.next();
    const saved = c.s;
    const tail = Array.from({ length: 5 }, () => c.next());
    const d = new Rng(0); d.s = saved;
    expect(Array.from({ length: 5 }, () => d.next())).toEqual(tail);
  });
  it('different seeds diverge and hashes are stable', () => {
    expect(new Rng(1).next()).not.toEqual(new Rng(2).next());
    expect(hash2(3, 4)).toEqual(hash2(3, 4));
    const u = hashUnit(10, 20);
    expect(u).toBeGreaterThanOrEqual(0);
    expect(u).toBeLessThan(1);
  });
});
