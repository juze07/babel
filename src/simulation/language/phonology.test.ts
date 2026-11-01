import { describe, expect, it } from 'vitest';
import { phonDistance, phonSimilarity, alignStem, alignStart, alignEnd, inventForm, perceive, toIPA, romanize } from './phonology';
import { applyRule, realize, actuateRule, type SoundRule } from './soundChange';
import { Rng, hashUnit } from '../core/rng';

const rule = (from: string, to: string, env: SoundRule['env'], id = 1): SoundRule => ({ id, from, to, env, label: '', origin: 0, tick: 0 });

describe('phonological similarity', () => {
  it('feature-weighted distance: similar sounds are closer than dissimilar ones', () => {
    expect(phonDistance('pata', 'pata')).toBe(0);
    expect(phonDistance('pata', 'bata')).toBeLessThan(phonDistance('pata', 'sata'));
    expect(phonSimilarity('kamu', 'kamo')).toBeGreaterThan(phonSimilarity('kamu', 'tilo'));
  });
  it('finds a known stem inside an affixed word (affix segmentation)', () => {
    const al = alignStem('makuta', 'maku', 0.5);
    expect(al.sim).toBeGreaterThan(0.9);
    expect('makuta'.slice(alignStart, alignEnd)).toBe('maku');
    const al2 = alignStem('nimaku', 'maku', 0.5);
    expect('nimaku'.slice(0, alignStart)).toBe('ni');
    expect(al2.sim).toBeGreaterThan(0.9);
  });
  it('invents pronounceable forms deterministically and renders IPA/romanisation', () => {
    const a = inventForm(new Rng(5), null, 2), b = inventForm(new Rng(5), null, 2);
    expect(a).toBe(b);
    expect(/[aeiouE]/.test(a)).toBe(true);
    expect(toIPA('SaN')).toBe('ʃaŋ');
    expect(romanize('SaN')).toBe('shang');
  });
  it('perception noise substitutes featurally close segments only at the given rate', () => {
    expect(perceive(new Rng(1), 'patakumi', 0)).toBe('patakumi');
    const rng = new Rng(2);
    let changed = 0;
    for (let i = 0; i < 500; i++) if (perceive(rng, 'patakumi', 0.1) !== 'patakumi') changed++;
    expect(changed).toBeGreaterThan(100);
    expect(changed).toBeLessThan(450);
  });
});

describe('sound change', () => {
  it('applies conditioned rules only in their environment', () => {
    expect(applyRule('pata', rule('t', 'd', 'V_V'))).toBe('pada'); // intervocalic voicing
    expect(applyRule('tapa', rule('t', 'd', 'V_V'))).toBe('tapa'); // word-initial t is not intervocalic
    expect(applyRule('kitu', rule('k', 'S', '_front'))).toBe('Situ'); // palatalisation before i
    expect(applyRule('kotu', rule('aeiou', '', '_#'))).toBe('kot'); // final vowel loss
  });
  it('never destroys a word (keeps ≥ 2 segments and a vowel)', () => {
    expect(applyRule('ta', rule('aeiou', '', '_#'))).toBe('ta');
  });
  it('spreads by lexical diffusion: same words change first, consistently', () => {
    const rules = new Map([[9, rule('t', 'd', 'V_V', 9)]]);
    const etyms = Array.from({ length: 200 }, (_, i) => i);
    const changedAt = (s: number) => etyms.filter((e) => realize('pata', e, [{ rule: 9, strength: s }], rules) === 'pada');
    const low = changedAt(0.3), high = changedAt(0.8);
    expect(low.length).toBeGreaterThan(30);
    expect(low.length).toBeLessThan(high.length);
    expect(low.every((e) => high.includes(e))).toBe(true); // words affected early stay affected
    expect(realize('pata', 5, [{ rule: 9, strength: 1 }], rules)).toBe('pada');
    expect(hashUnit(5, 9)).toBe(hashUnit(5, 9));
  });
  it('actuates rules that target sounds the community actually uses', () => {
    const usage = new Float64Array(26);
    usage[2] = 1; usage[20] = 1; // t and a only
    for (let i = 0; i < 20; i++) {
      const r = actuateRule(new Rng(i), i, usage, 0, 0);
      if (r) expect([...r.from].every((c) => c === 't' || c === 'a')).toBe(true);
    }
  });
});
