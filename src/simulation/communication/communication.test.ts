import { describe, expect, it } from 'vitest';
import { makeGroup, play, rate, consensus, ctxOf, pair } from '../testing/harness';
import { produce, interpret, runEpisode } from './episode';
import { Origin } from '../agents/lexicon';
import { ORDERS, argmax, createAgent, sampleTraits, type Agent } from '../agents/agent';
import { C, G, N_CONTENT } from '../language/concepts';
import { inventForm } from '../language/phonology';
import { Rng } from '../core/rng';
import type { Frame } from '../language/frames';

/** Give agents an identical, fully specified vocabulary (to isolate grammar from word learning). */
function shareVocabulary(agents: Agent[], seed = 3) {
  const rng = new Rng(seed);
  const used = new Set<string>();
  for (let c = 0; c < N_CONTENT; c++) {
    let f = '';
    do { f = inventForm(rng, null, 2); } while (used.has(f) || f.length < 4);
    used.add(f);
    for (const a of agents) a.lex.add({ form: f, concept: c, score: 0.9, uses: 0, succ: 0, last: 0, etym: c, origin: Origin.Invented, srcLang: 0, born: 0 });
  }
}
const setOrder = (a: Agent, name: (typeof ORDERS)[number], w = 0.95) => { a.gram.order.fill((1 - w) / 5); a.gram.order[ORDERS.indexOf(name)] = w; };

describe('lexical learning (naming game dynamics)', () => {
  it('repeated interaction creates shared conventions from nothing', () => {
    const g = makeGroup(10, 3);
    const early = rate(play(g, 600));
    play(g, 5000);
    const late = rate(play(g, 1000));
    expect(early).toBeLessThan(late);
    expect(late).toBeGreaterThan(0.6); // chance with 4 scenes is 0.25
    expect(consensus(g.agents)).toBeGreaterThan(0.6);
  });
  it('a newcomer acquires the community’s words', () => {
    const g = makeGroup(8, 4);
    play(g, 5000);
    const rng = new Rng(9);
    const kid = createAgent(99, rng, 0, g.tick - 20 * 4, sampleTraits(rng, g.cfg.traits, 0.02), 1);
    kid.langId = 0;
    expect(kid.lex.size).toBe(0);
    play(g, 1500, () => [g.agents[g.rng.int(g.agents.length)], kid]);
    let shared = 0, named = 0;
    for (let c = 0; c < N_CONTENT; c++) {
      const k = kid.lex.best(c); const m = g.agents[0].lex.best(c);
      if (!k || !m) continue;
      named++;
      if (k.etym === m.etym) shared++;
    }
    expect(named).toBeGreaterThan(20);
    expect(shared / named).toBeGreaterThan(0.6);
  });
});

describe('semantic interpretation', () => {
  it('word order lets a listener tell “wolf sees child” from “child sees wolf”', () => {
    const g = makeGroup(2, 5);
    const [sp, li] = g.agents;
    shareVocabulary(g.agents);
    setOrder(sp, 'SVO'); setOrder(li, 'SVO');
    const target: Frame = { v: C.see, a: { h: C.wolf, p: -1, pl: false }, o: { h: C.child, p: -1, pl: false }, r: null, l: -1, t: 0, n: false, q: false };
    const swapped: Frame = { ...target, a: target.o, o: target.a };
    const other: Frame = { ...target, v: C.eat };
    const ctx = ctxOf(g, false);
    let ok = 0;
    for (let i = 0; i < 20; i++) {
      const context = i % 2 ? [swapped, target, other] : [target, other, swapped];
      const u = produce(sp, target, ctx, g.rng);
      const it = interpret(li, u.words.map((w) => w.text), u.words.map(() => -1), context, 0, g.cfg);
      if (context[it.choice] === target) ok++;
      expect(it.frame.v).toBe(C.see);
    }
    expect(ok).toBeGreaterThanOrEqual(18);
  });
  it('a listener with a different word order misreads role-swapped scenes', () => {
    const g = makeGroup(2, 6);
    const [sp, li] = g.agents;
    shareVocabulary(g.agents);
    setOrder(sp, 'SVO'); setOrder(li, 'OVS');
    const target: Frame = { v: C.hit, a: { h: C.man, p: -1, pl: false }, o: { h: C.snake, p: -1, pl: false }, r: null, l: -1, t: 0, n: false, q: false };
    const swapped: Frame = { ...target, a: target.o, o: target.a };
    const u = produce(sp, target, ctxOf(g, false), g.rng);
    const it = interpret(li, u.words.map((w) => w.text), u.words.map(() => -1), [target, swapped], 0, g.cfg);
    expect(it.choice).toBe(1);
  });
});

describe('grammar acquisition', () => {
  it('a learner adopts the word order it hears', () => {
    const g = makeGroup(2, 7);
    const [sp, li] = g.agents;
    shareVocabulary(g.agents);
    setOrder(sp, 'SOV', 0.97);
    li.gram.order.fill(1 / 6);
    for (let i = 0; i < 400; i++) { runEpisode(sp, li, g.sal, ctxOf(g), g.rng, i); setOrder(sp, 'SOV', 0.97); }
    expect(ORDERS[argmax(li.gram.order)]).toBe('SOV');
    expect(li.gram.order[ORDERS.indexOf('SOV')]).toBeGreaterThan(0.4);
  });
  it('a learner discovers a plural suffix from residues after known stems', () => {
    const g = makeGroup(2, 8);
    const [sp, li] = g.agents;
    shareVocabulary(g.agents);
    setOrder(sp, 'SVO'); setOrder(li, 'SVO');
    sp.lex.add({ form: 'ke', concept: G.PL, score: 0.95, uses: 0, succ: 0, last: 0, etym: 500, origin: Origin.Invented, srcLang: 0, born: 0 });
    const pl = (G.PL - 64) * 4;
    sp.gram.mark.fill(0.25, pl, pl + 4); sp.gram.mark[pl + 1] = 0.97; // suffix
    for (let i = 0; i < 800; i++) runEpisode(sp, li, g.sal, ctxOf(g), g.rng, i);
    const learned = li.lex.byConcept[G.PL].find((e) => e.form === 'ke');
    expect(learned).toBeDefined();
    expect(learned!.score).toBeGreaterThan(0.1);
  });
  it('a group converges on one dominant word order', () => {
    const g = makeGroup(10, 9);
    play(g, 8000);
    const counts = new Map<number, number>();
    for (const a of g.agents) counts.set(argmax(a.gram.order), (counts.get(argmax(a.gram.order)) ?? 0) + 1);
    expect(Math.max(...counts.values())).toBeGreaterThanOrEqual(7);
  });
});

describe('communication success and compositionality', () => {
  it('converged agents understand novel combinations of familiar words above chance', () => {
    const g = makeGroup(10, 10);
    play(g, 7000);
    let novel = 0, novelOk = 0;
    for (let i = 0; i < 1500; i++) {
      const [sp, li] = pair(g);
      const r = runEpisode(sp, li, g.sal, ctxOf(g), g.rng, i);
      if (r.novel) { novel++; if (r.success && r.turns === 1) novelOk++; }
    }
    expect(novel).toBeGreaterThan(100);
    expect(novelOk / novel).toBeGreaterThan(0.45); // chance = 0.25
  });
});
