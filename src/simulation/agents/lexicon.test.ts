import { describe, expect, it } from 'vitest';
import { Lexicon, Origin, type LexEntry } from './lexicon';

const E = (form: string, concept: number, score: number, last = 0): LexEntry => ({ form, concept, score, uses: 0, succ: 0, last, etym: concept * 100 + form.length, origin: Origin.Invented, srcLang: -1, born: 0 });

describe('lexicon', () => {
  it('stores competing forms per concept and returns the strongest', () => {
    const l = new Lexicon();
    l.add(E('taka', 1, 0.3)); l.add(E('mupo', 1, 0.7)); l.add(E('taka', 2, 0.5));
    expect(l.best(1)?.form).toBe('mupo');
    expect(l.byForm.get('taka')?.length).toBe(2); // homonym: one form, two concepts
    expect(l.get('taka', 2)?.score).toBe(0.5);
  });
  it('reform re-indexes the pronunciation without losing the association', () => {
    const l = new Lexicon();
    const e = l.add(E('pata', 3, 0.6));
    l.reform(e, 'pada');
    expect(l.get('pada', 3)?.score).toBe(0.6);
    expect(l.get('pata', 3)).toBeUndefined();
  });
  it('decay weakens unused associations and prunes beyond capacity', () => {
    const l = new Lexicon();
    for (let i = 0; i < 20; i++) l.add(E(`ka${String.fromCharCode(97 + i)}`, i, 0.05 + i * 0.04));
    l.decay(0.5, 10, 100, 0);
    expect(l.size).toBeLessThanOrEqual(10);
    // the strongest survive
    expect(l.best(19)).toBeDefined();
  });
  it('round-trips through JSON exactly', () => {
    const l = new Lexicon();
    l.add(E('sa', 5, 0.2)); l.add(E('tumi', 5, 0.9)); l.add(E('sa', 7, 0.4));
    const r = Lexicon.fromJSON(JSON.parse(JSON.stringify(l.toJSON())));
    expect(r.toJSON()).toEqual(l.toJSON());
    expect(r.best(5)?.form).toBe('tumi');
  });
});
