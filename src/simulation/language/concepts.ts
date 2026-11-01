/**
 * SEMANTICS — the concept inventory.
 * Concepts are structured: each has a category, semantic tags (used for similarity, metaphor/metonymy
 * extension and semantic shift), animacy, and environmental affinities (what is salient where).
 * Grammatical meanings (plural, tense, negation, case roles …) are also "concepts" that can acquire
 * forms; *how* they attach (affix vs particle, before vs after) is learned separately by the grammar.
 */

export type Category =
  | 'object' | 'animal' | 'person' | 'relation' | 'action' | 'location' | 'property' | 'emotion' | 'abstract' | 'grammar';

export type Biome = 'sea' | 'coast' | 'grass' | 'forest' | 'hills' | 'mountain' | 'desert';

export interface Concept {
  id: number;
  key: string;
  gloss: string;
  cat: Category;
  tags: string[];
  animate?: boolean;
  human?: boolean;
  /** base discourse frequency */
  freq: number;
  /** salience multipliers by biome */
  biome?: Partial<Record<Biome, number>>;
}

type Def = [key: string, cat: Category, tags: string, freq: number, biome?: Partial<Record<Biome, number>>];

const DEFS: Def[] = [
  // objects
  ['stone', 'object', 'natural solid hard', 1, { hills: 2, mountain: 2.5 }],
  ['water', 'object', 'natural liquid water', 1.4, { coast: 1.3 }],
  ['tree', 'object', 'natural plant tall', 1, { forest: 2.5, grass: 0.6, desert: 0.2 }],
  ['fruit', 'object', 'natural plant food', 1.1, { forest: 1.6, grass: 1.2 }],
  ['fire', 'object', 'natural hot danger', 1, {}],
  ['hut', 'object', 'artifact dwelling', 0.9, {}],
  ['spear', 'object', 'artifact tool weapon', 0.8, { grass: 1.4, forest: 1.3 }],
  ['basket', 'object', 'artifact tool container', 0.7, { grass: 1.2 }],
  ['boat', 'object', 'artifact water motion', 0.6, { sea: 3, coast: 3, grass: 0.2, hills: 0.1, mountain: 0.05 }],
  ['meat', 'object', 'food animal-part', 1, { grass: 1.3 }],
  // animals
  ['deer', 'animal', 'animal food wild', 0.9, { forest: 2, grass: 1.5, coast: 0.3 }],
  ['fish', 'animal', 'animal food water', 1.1, { sea: 3, coast: 3, grass: 0.3, mountain: 0.1 }],
  ['bird', 'animal', 'animal wild sky', 0.9, {}],
  ['wolf', 'animal', 'animal wild danger', 0.7, { forest: 1.8, mountain: 1.6, coast: 0.3 }],
  ['goat', 'animal', 'animal food tame', 0.7, { hills: 2.5, mountain: 2, sea: 0.2 }],
  ['snake', 'animal', 'animal wild danger', 0.6, { desert: 3, grass: 1.2 }],
  // people
  ['person', 'person', 'human', 1.6],
  ['child', 'person', 'human young kin', 1.1],
  ['elder', 'person', 'human old wise', 0.8],
  ['woman', 'person', 'human', 1],
  ['man', 'person', 'human', 1],
  ['stranger', 'person', 'human outsider', 0.6],
  // relationships
  ['mother', 'relation', 'human kin', 0.9],
  ['father', 'relation', 'human kin', 0.8],
  ['kin', 'relation', 'human kin group', 0.6],
  ['friend', 'relation', 'human ally', 0.8],
  ['enemy', 'relation', 'human outsider danger', 0.5],
  // actions
  ['see', 'action', 'perception', 1.5],
  ['give', 'action', 'transfer possession', 1.1],
  ['eat', 'action', 'ingest food', 1.2],
  ['go', 'action', 'motion', 1.4],
  ['take', 'action', 'transfer possession', 1],
  ['hit', 'action', 'contact danger', 0.7],
  ['make', 'action', 'create artifact', 0.8],
  ['have', 'action', 'possession', 1],
  ['fear', 'action', 'mental danger', 0.6],
  ['love', 'action', 'mental ally', 0.6],
  ['find', 'action', 'perception possession', 0.8],
  // locations
  ['river', 'location', 'place water natural', 0.9, { grass: 1.4, forest: 1.3 }],
  ['hill', 'location', 'place high natural', 0.8, { hills: 2.5, mountain: 2 }],
  ['sea', 'location', 'place water natural', 0.8, { sea: 3, coast: 3, grass: 0.15, hills: 0.1, mountain: 0.05 }],
  ['forest', 'location', 'place plant natural', 0.8, { forest: 2.5, desert: 0.1 }],
  ['village', 'location', 'place dwelling group', 1.1],
  ['cave', 'location', 'place dark natural', 0.5, { mountain: 2.5, hills: 1.5 }],
  ['field', 'location', 'place plant open', 0.7, { grass: 2 }],
  // properties
  ['big', 'property', 'size', 1.2],
  ['small', 'property', 'size', 1.1],
  ['red', 'property', 'colour', 0.6],
  ['far', 'property', 'distance', 0.8],
  ['near', 'property', 'distance', 0.8],
  ['good', 'property', 'evaluation', 1],
  ['bad', 'property', 'evaluation', 0.9],
  ['hot', 'property', 'temperature', 0.6, { desert: 2 }],
  ['cold', 'property', 'temperature', 0.6, { mountain: 2 }],
  ['old', 'property', 'age', 0.6],
  // emotions (attributes of animates)
  ['happy', 'emotion', 'mental evaluation', 0.6],
  ['afraid', 'emotion', 'mental danger', 0.6],
  ['angry', 'emotion', 'mental danger', 0.5],
  ['sad', 'emotion', 'mental', 0.5],
  // abstract
  ['spirit', 'abstract', 'mental invisible sacred', 0.4],
  ['dream', 'abstract', 'mental invisible', 0.35],
  ['name', 'abstract', 'social sign', 0.4],
  ['truth', 'abstract', 'mental evaluation', 0.3],
  ['death', 'abstract', 'danger invisible', 0.35],
];

export const GRAM_KEYS = ['PL', 'PAST', 'FUT', 'NEG', 'Q', 'PAT', 'REC', 'LOC'] as const;
export type GramKey = (typeof GRAM_KEYS)[number];
const GRAM_GLOSS: Record<GramKey, string> = {
  PL: 'plural', PAST: 'past tense', FUT: 'future tense', NEG: 'negation', Q: 'question', PAT: 'patient (object) marker', REC: 'recipient marker', LOC: 'locative marker',
};

export const CONCEPTS: Concept[] = DEFS.map(([key, cat, tags, freq, biome], id) => ({
  id, key, gloss: key, cat, tags: tags.split(' '), freq, biome,
  animate: cat === 'animal' || cat === 'person' || cat === 'relation',
  human: cat === 'person' || cat === 'relation',
}));

export const N_CONTENT = CONCEPTS.length;
export const GRAM_BASE = N_CONTENT;
GRAM_KEYS.forEach((g, i) => {
  CONCEPTS.push({ id: GRAM_BASE + i, key: g, gloss: GRAM_GLOSS[g], cat: 'grammar', tags: ['grammar'], freq: 0 });
});
export const N_CONCEPTS = CONCEPTS.length;
export const N_GRAM = GRAM_KEYS.length;
export const G = Object.fromEntries(GRAM_KEYS.map((g, i) => [g, GRAM_BASE + i])) as Record<GramKey, number>;

export const C = Object.fromEntries(CONCEPTS.map((c) => [c.key, c.id])) as Record<string, number>;

export const byCat = (cat: Category) => CONCEPTS.filter((c) => c.cat === cat).map((c) => c.id);

export const OBJECTS = byCat('object');
export const ANIMALS = byCat('animal');
export const PEOPLE = [...byCat('person'), ...byCat('relation')];
export const ACTIONS = byCat('action');
export const LOCATIONS = byCat('location');
export const PROPERTIES = byCat('property');
export const EMOTIONS = byCat('emotion');
export const ABSTRACT = byCat('abstract');
export const NOUNS = [...OBJECTS, ...ANIMALS, ...PEOPLE, ...ABSTRACT];

/** Semantic similarity in [0,1] — Jaccard over tags, boosted for same category. */
const SIM = new Float64Array(N_CONTENT * N_CONTENT);
for (let i = 0; i < N_CONTENT; i++) {
  for (let j = 0; j < N_CONTENT; j++) {
    if (i === j) { SIM[i * N_CONTENT + j] = 1; continue; }
    const a = CONCEPTS[i], b = CONCEPTS[j];
    const inter = a.tags.filter((t) => b.tags.includes(t)).length;
    const uni = new Set([...a.tags, ...b.tags]).size;
    const sameCat = a.cat === b.cat ? 0.25 : 0;
    SIM[i * N_CONTENT + j] = Math.min(0.95, (inter / uni) * 0.75 + sameCat);
  }
}
export function semSim(a: number, b: number): number {
  if (a >= N_CONTENT || b >= N_CONTENT) return a === b ? 1 : 0;
  return SIM[a * N_CONTENT + b];
}
/** Neighbours eligible for semantic extension (metaphor / metonymy). */
export const SEM_NEIGHBOURS: number[][] = CONCEPTS.slice(0, N_CONTENT).map((c) =>
  CONCEPTS.slice(0, N_CONTENT).filter((d) => d.id !== c.id && semSim(c.id, d.id) >= 0.5).map((d) => d.id),
);

/** Concepts that can be conveyed by pointing/pantomime (gesture channel in early communication). */
export function gesturable(id: number): boolean {
  const cat = CONCEPTS[id]?.cat;
  return cat === 'object' || cat === 'animal' || cat === 'person' || cat === 'action' || cat === 'location' || cat === 'emotion' || (cat === 'property' && ['big', 'small', 'far', 'near'].includes(CONCEPTS[id].key));
}

/** Swadesh-like core list for comparisons in the atlas. */
export const CORE_LIST = ['person', 'water', 'fire', 'stone', 'tree', 'fish', 'bird', 'mother', 'child', 'see', 'eat', 'go', 'give', 'big', 'small', 'good', 'sea', 'hill', 'village', 'spirit'].map((k) => C[k]);
