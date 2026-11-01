/**
 * SOUND CHANGE
 * ------------
 * Sound changes are conditioned rewrite rules (A → B / environment) drawn from a typology of
 * cross-linguistically common processes (lenition, voicing, palatalisation, final-vowel loss ...).
 *
 * Life-cycle of a change in BABEL:
 *  1. A rule is *actuated* in one settlement (a few speakers start applying it: an accent feature).
 *  2. Each speaker applies a rule to a word only if hashUnit(etymon, rule) < strength, so the change
 *     spreads word-by-word (lexical diffusion) while staying consistent for the same word.
 *  3. Listeners exposed to the accent raise their own strength (imitation × prestige).
 *  4. Learners (especially children) store the *surface* forms they hear, so the change becomes part
 *     of the underlying lexicon — at which point it is permanent in that lineage.
 *
 * Abstraction: real sound change involves phonetic gradience, stress, and social indexing far beyond this.
 */
import { Rng, hashUnit } from '../core/rng';
import { isVowel, PHONEMES, CODE_INDEX } from './phonology';

export type Env = 'any' | 'V_V' | '_#' | '#_' | '_front' | '_C' | 'C_';

export interface SoundRule {
  id: number;
  from: string; // phoneme code(s): a set of single chars
  to: string; // replacement char or '' for deletion
  env: Env;
  label: string;
  origin: number; // settlement id where actuated
  tick: number;
}

const ENV_LABEL: Record<Env, string> = {
  any: '', V_V: ' / V_V', '_#': ' / _#', '#_': ' / #_', _front: ' / _[i,e]', _C: ' / _C', C_: ' / C_',
};

interface RuleType { from: string[]; to: string; env: Env; weight: number }

/** Typology of natural sound changes. `from` lists alternative targets; one is chosen based on usage. */
const TYPES: RuleType[] = [
  { from: ['p'], to: 'b', env: 'V_V', weight: 1 },
  { from: ['t'], to: 'd', env: 'V_V', weight: 1.2 },
  { from: ['k'], to: 'g', env: 'V_V', weight: 1.2 },
  { from: ['b'], to: 'v', env: 'V_V', weight: 0.8 },
  { from: ['g'], to: '', env: 'V_V', weight: 0.8 },
  { from: ['d'], to: 'r', env: 'V_V', weight: 0.5 },
  { from: ['k'], to: 'h', env: 'any', weight: 0.5 },
  { from: ['h'], to: '', env: '#_', weight: 0.7 },
  { from: ['h'], to: '', env: 'V_V', weight: 0.6 },
  { from: ['a', 'e', 'i', 'o', 'u'], to: '', env: '_#', weight: 1.0 },
  { from: ['t', 'k', 'n', 's', 'm', 'r', 'l'], to: '', env: '_#', weight: 0.8 },
  { from: ['k', 't', 's'], to: 'S', env: '_front', weight: 1.0 },
  { from: ['e'], to: 'i', env: 'any', weight: 0.6 },
  { from: ['o'], to: 'u', env: 'any', weight: 0.6 },
  { from: ['i'], to: 'e', env: 'any', weight: 0.4 },
  { from: ['u'], to: 'o', env: 'any', weight: 0.4 },
  { from: ['a'], to: 'o', env: 'any', weight: 0.5 },
  { from: ['a'], to: 'e', env: 'any', weight: 0.4 },
  { from: ['p'], to: 'f', env: 'any', weight: 0.6 },
  { from: ['b', 'd', 'g'], to: '', env: '_C', weight: 0.4 },
  { from: ['b'], to: 'p', env: '_#', weight: 0.4 },
  { from: ['d'], to: 't', env: '_#', weight: 0.4 },
  { from: ['r'], to: 'l', env: 'any', weight: 0.5 },
  { from: ['l'], to: 'r', env: 'any', weight: 0.3 },
  { from: ['s'], to: 'h', env: 'any', weight: 0.4 },
  { from: ['w'], to: 'v', env: 'any', weight: 0.4 },
  { from: ['n'], to: 'N', env: '_#', weight: 0.4 },
  { from: ['l', 'r', 'w', 'j'], to: '', env: 'C_', weight: 0.5 },
  { from: ['E'], to: '', env: 'any', weight: 0.3 },
  { from: ['u', 'i'], to: 'E', env: 'V_V', weight: 0.2 },
];

function matchesEnv(word: string, i: number, env: Env): boolean {
  const prev = word[i - 1];
  const next = word[i + 1];
  switch (env) {
    case 'any': return true;
    case 'V_V': return isVowel(prev) && isVowel(next);
    case '_#': return i === word.length - 1;
    case '#_': return i === 0;
    case '_front': return next === 'i' || next === 'e';
    case '_C': return next !== undefined && !isVowel(next);
    case 'C_': return prev !== undefined && !isVowel(prev);
  }
}

/** Apply rule to a whole form. Keeps words at least 2 segments long and containing a vowel. */
export function applyRule(form: string, rule: SoundRule): string {
  let out = '';
  let changed = false;
  for (let i = 0; i < form.length; i++) {
    const ch = form[i];
    if (rule.from.includes(ch) && matchesEnv(form, i, rule.env)) {
      out += rule.to;
      changed = true;
    } else out += ch;
  }
  if (!changed) return form;
  if (out.length < 2 || !/[aeiouE]/.test(out)) return form;
  return out;
}

export interface AccentRule { rule: number; strength: number }

/** Produce a surface form from an underlying form given a speaker's accent (lexical diffusion). */
export function realize(form: string, etym: number, accent: AccentRule[], rules: Map<number, SoundRule>): string {
  let out = form;
  for (const a of accent) {
    if (a.strength <= 0.02) continue;
    if (hashUnit(etym, a.rule) < a.strength) {
      const r = rules.get(a.rule);
      if (r) out = applyRule(out, r);
    }
  }
  return out;
}

/**
 * Create a new rule targeted at phonemes that the community actually uses.
 * `usage` is a phoneme frequency vector of the community.
 */
export function actuateRule(rng: Rng, id: number, usage: Float64Array, settlement: number, tick: number): SoundRule | null {
  const weights = TYPES.map((t) => {
    let u = 0;
    for (const f of t.from) u += usage[CODE_INDEX[f.charCodeAt(0)]] || 0;
    return u > 0 ? t.weight * Math.sqrt(u) : 0;
  });
  const k = rng.weighted(weights);
  if (k < 0) return null;
  const t = TYPES[k];
  // choose 1..n targets weighted by usage (a natural class subset)
  const used = t.from.filter((f) => (usage[CODE_INDEX[f.charCodeAt(0)]] || 0) > 0);
  const from = t.from.length > 1 && rng.chance(0.5) ? used.join('') : rng.pick(used);
  const label = `${[...from].map((c) => PHONEMES[CODE_INDEX[c.charCodeAt(0)]].ipa).join(',')} → ${t.to ? PHONEMES[CODE_INDEX[t.to.charCodeAt(0)]].ipa : '∅'}${ENV_LABEL[t.env]}`;
  return { id, from, to: t.to, env: t.env, label, origin: settlement, tick };
}
