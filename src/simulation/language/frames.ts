/**
 * EVENT FRAMES — structured meanings with semantic roles.
 * A frame is a predicate with role fillers: AGENT, PATIENT, RECIPIENT, LOCATION, plus tense,
 * negation and question force. Entities carry an optional property and plurality.
 * Agents observe frames in their environment and try to communicate one of them; listeners must
 * pick the intended frame from a shared context of similar frames (the "guessing game"),
 * which creates real functional pressure for word order and grammatical marking: distractors often
 * differ only in who-did-what-to-whom, tense or number.
 */
import { Rng } from '../core/rng';
import { C, CONCEPTS, N_CONTENT, OBJECTS, ANIMALS, PEOPLE, ACTIONS, LOCATIONS, PROPERTIES, EMOTIONS, ABSTRACT } from './concepts';

export interface Entity { h: number; p: number; pl: boolean }
export interface Frame {
  v: number;
  a: Entity | null;
  o: Entity | null;
  r: Entity | null;
  l: number;
  t: 0 | 1 | 2; // present, past, future
  n: boolean;
  q: boolean;
}

interface VerbSpec { agt: number[]; pat?: number[]; rec?: number[]; locReq?: boolean }
const HUMAN = PEOPLE;
const ANIMATE = [...PEOPLE, ...ANIMALS];
const FOOD = [C.fruit, C.meat, C.fish, C.deer, C.goat, C.bird];
const ARTIFACT = [C.hut, C.spear, C.basket, C.boat, C.fire, C.name];
const ALLNOUN = [...OBJECTS, ...ANIMALS, ...PEOPLE, ...ABSTRACT];

export const VERBS: Record<number, VerbSpec> = {
  [C.see]: { agt: ANIMATE, pat: ALLNOUN },
  [C.give]: { agt: HUMAN, pat: [...OBJECTS, C.goat, C.fish, C.name], rec: HUMAN },
  [C.eat]: { agt: ANIMATE, pat: FOOD },
  [C.go]: { agt: ANIMATE, locReq: true },
  [C.take]: { agt: HUMAN, pat: [...OBJECTS, ...ANIMALS] },
  [C.hit]: { agt: ANIMATE, pat: [...ANIMATE, C.stone, C.tree] },
  [C.make]: { agt: HUMAN, pat: ARTIFACT },
  [C.have]: { agt: HUMAN, pat: [...OBJECTS, ...ANIMALS, ...ABSTRACT] },
  [C.fear]: { agt: ANIMATE, pat: [...ANIMALS, ...PEOPLE, C.spirit, C.death, C.fire] },
  [C.love]: { agt: HUMAN, pat: [...PEOPLE, C.spirit, C.truth, C.dream] },
  [C.find]: { agt: ANIMATE, pat: [...OBJECTS, ...ANIMALS] },
};

function pickFrom(rng: Rng, pool: number[], sal: Float64Array): number {
  const w = pool.map((c) => sal[c]);
  const k = rng.weighted(w);
  return pool[k < 0 ? 0 : k];
}

function entity(rng: Rng, pool: number[], sal: Float64Array, propRate: number): Entity {
  const h = pickFrom(rng, pool, sal);
  let p = -1;
  if (rng.chance(propRate)) {
    const props = CONCEPTS[h].animate && rng.chance(0.4) ? EMOTIONS : PROPERTIES;
    p = pickFrom(rng, props, sal);
  }
  const pl = CONCEPTS[h].cat !== 'abstract' && rng.chance(0.2);
  return { h, p, pl };
}

/** Sample a frame salient in an environment described by the concept salience vector. */
export function generateFrame(rng: Rng, sal: Float64Array, complexity = 1): Frame {
  const v = pickFrom(rng, ACTIONS, sal);
  const spec = VERBS[v];
  const propRate = 0.22 * complexity;
  const a = entity(rng, spec.agt, sal, propRate);
  let o: Entity | null = null, r: Entity | null = null;
  if (spec.pat) {
    o = entity(rng, spec.pat, sal, propRate);
    let guard = 0;
    while (o.h === a.h && guard++ < 5) o = entity(rng, spec.pat, sal, propRate);
  }
  if (spec.rec) {
    r = entity(rng, spec.rec, sal, propRate * 0.5);
    let guard = 0;
    while (r.h === a.h && guard++ < 5) r = entity(rng, spec.rec, sal, 0);
  }
  let l = -1;
  if (spec.locReq || rng.chance(0.15 * complexity)) l = pickFrom(rng, LOCATIONS, sal);
  const tr = rng.next();
  const t: 0 | 1 | 2 = tr < 0.6 ? 0 : tr < 0.85 ? 1 : 2;
  return { v, a, o, r, l, t, n: rng.chance(0.12), q: rng.chance(0.08) };
}

export function cloneFrame(f: Frame): Frame {
  return { ...f, a: f.a && { ...f.a }, o: f.o && { ...f.o }, r: f.r && { ...f.r } };
}

export type Perturbation = 'swap' | 'agent' | 'patient' | 'verb' | 'tense' | 'neg' | 'plural' | 'prop' | 'loc' | 'random';

/** Create a distractor scene by minimally altering the target. */
export function perturb(rng: Rng, f: Frame, sal: Float64Array): { frame: Frame; kind: Perturbation } {
  const g = cloneFrame(f);
  const options: Perturbation[] = ['agent', 'verb', 'tense', 'neg', 'plural'];
  if (g.o && VERBS[g.v].pat!.includes(g.a!.h) && VERBS[g.v].agt.includes(g.o.h)) options.push('swap', 'swap', 'swap');
  if (g.o) options.push('patient');
  if (g.a!.p >= 0 || (g.o && g.o.p >= 0)) options.push('prop');
  if (g.l >= 0) options.push('loc');
  const kind = rng.pick(options);
  switch (kind) {
    case 'swap': { const t = g.a!; g.a = g.o; g.o = t; break; }
    case 'agent': g.a = { ...g.a!, h: altFrom(rng, VERBS[g.v].agt, g.a!.h, sal) }; break;
    case 'patient': g.o = { ...g.o!, h: altFrom(rng, VERBS[g.v].pat!, g.o!.h, sal) }; break;
    case 'verb': {
      const sameVal = ACTIONS.filter((x) => x !== g.v && !!VERBS[x].pat === !!g.o && !!VERBS[x].rec === !!g.r && VERBS[x].agt.includes(g.a!.h) && (!g.o || VERBS[x].pat!.includes(g.o.h)));
      if (sameVal.length) g.v = pickFrom(rng, sameVal, sal);
      else g.t = ((g.t + 1) % 3) as 0 | 1 | 2;
      break;
    }
    case 'tense': g.t = ((g.t + 1 + rng.int(2)) % 3) as 0 | 1 | 2; break;
    case 'neg': g.n = !g.n; break;
    case 'plural': { const e = g.o && rng.chance(0.5) ? g.o : g.a!; e.pl = !e.pl; break; }
    case 'prop': { const e = g.a!.p >= 0 ? g.a! : g.o!; e.p = altFrom(rng, CONCEPTS[e.h].animate ? [...PROPERTIES, ...EMOTIONS] : PROPERTIES, e.p, sal); break; }
    case 'loc': g.l = altFrom(rng, LOCATIONS, g.l, sal); break;
    default: break;
  }
  return { frame: g, kind };
}

function altFrom(rng: Rng, pool: number[], not: number, sal: Float64Array): number {
  const p = pool.filter((x) => x !== not);
  return p.length ? pickFrom(rng, p, sal) : not;
}

export function sameFrame(a: Frame, b: Frame): boolean {
  return a.v === b.v && sameEnt(a.a, b.a) && sameEnt(a.o, b.o) && sameEnt(a.r, b.r) && a.l === b.l && a.t === b.t && a.n === b.n && a.q === b.q;
}
function sameEnt(a: Entity | null, b: Entity | null) {
  if (!a || !b) return a === b;
  return a.h === b.h && a.p === b.p && a.pl === b.pl;
}

/** Number of semantic features in a frame (denominator for fidelity). */
export function featureCount(f: Frame): number {
  let n = 2; // verb + tense
  for (const e of [f.a, f.o, f.r]) if (e) n += 2 + (e.p >= 0 ? 1 : 0);
  if (f.l >= 0) n++;
  n += 2; // neg + q
  return n;
}

/** Concepts present in a frame (content only). */
export function frameConcepts(f: Frame): number[] {
  const out = [f.v];
  for (const e of [f.a, f.o, f.r]) if (e) { out.push(e.h); if (e.p >= 0) out.push(e.p); }
  if (f.l >= 0) out.push(f.l);
  return out;
}

export function frameKey(f: Frame): number {
  return f.v * N_CONTENT * N_CONTENT + (f.a ? f.a.h : 0) * N_CONTENT + (f.o ? f.o.h : f.l >= 0 ? f.l : 0);
}

const TENSE = ['', 'PAST ', 'FUT '];
export function describeFrame(f: Frame): string {
  const ent = (e: Entity | null) => (e ? `${e.p >= 0 ? CONCEPTS[e.p].key + ' ' : ''}${CONCEPTS[e.h].key}${e.pl ? 's' : ''}` : '');
  let s = `${f.q ? 'Q: ' : ''}${ent(f.a)} ${f.n ? 'NOT ' : ''}${TENSE[f.t]}${CONCEPTS[f.v].key}`;
  if (f.o) s += ` ${ent(f.o)}`;
  if (f.r) s += ` → ${ent(f.r)}`;
  if (f.l >= 0) s += ` @${CONCEPTS[f.l].key}`;
  return s;
}

/** English-ish paraphrase for the UI. */
const IRREG_PL: Record<string, string> = { man: 'men', woman: 'women', child: 'children', person: 'people', fish: 'fish', deer: 'deer', wolf: 'wolves', enemy: 'enemies', spirit: 'spirits', truth: 'truths' };
const PAST: Record<string, string> = { see: 'saw', give: 'gave', eat: 'ate', go: 'went', take: 'took', hit: 'hit', make: 'made', have: 'had', fear: 'feared', love: 'loved', find: 'found' };
const plural = (w: string) => IRREG_PL[w] ?? (/(s|sh|ch|x)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's');
const third = (v: string) => (v === 'have' ? 'has' : v === 'go' ? 'goes' : /(s|sh|ch|x)$/.test(v) ? v + 'es' : v + 's');

/** Plain-English rendering of a scene (for the UI only; agents never see it). */
export function paraphrase(f: Frame): string {
  const ent = (e: Entity | null, def = false) => {
    if (!e) return '';
    const head = e.pl ? plural(CONCEPTS[e.h].key) : CONCEPTS[e.h].key;
    const np = (e.p >= 0 ? CONCEPTS[e.p].key + ' ' : '') + head;
    const art = e.pl || def ? 'the' : /^[aeiou]/.test(np) ? 'an' : 'a';
    return `${art} ${np}`;
  };
  const verb = CONCEPTS[f.v].key;
  const subj = ent(f.a);
  const sg = !f.a?.pl;
  let core: string;
  if (f.q) {
    const aux = f.t === 1 ? 'did' : f.t === 2 ? 'will' : sg ? 'does' : 'do';
    core = `${aux}${f.n ? ' not' : ''} ${subj} ${verb}`;
  } else if (f.n) {
    core = `${subj} ${f.t === 1 ? 'did not' : f.t === 2 ? 'will not' : sg ? 'does not' : 'do not'} ${verb}`;
  } else {
    core = `${subj} ${f.t === 1 ? PAST[verb] ?? verb + 'ed' : f.t === 2 ? 'will ' + verb : sg ? third(verb) : verb}`;
  }
  let s = core;
  if (f.o) s += ` ${ent(f.o)}`;
  if (f.r) s += ` to ${ent(f.r)}`;
  if (f.l >= 0) s += `${f.v === C.go ? ' to' : ' at'} the ${CONCEPTS[f.l].key}`;
  s = s.trim();
  s = s[0].toUpperCase() + s.slice(1);
  return s + (f.q ? '?' : '.');
}

export { N_CONTENT };
