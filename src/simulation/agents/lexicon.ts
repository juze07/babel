/**
 * INDIVIDUAL LEXICON
 * Each agent owns a private, bidirectional associative memory between word forms and concepts.
 * Entries carry an association strength ("score"), usage statistics and hidden provenance metadata
 * (etymon id, origin) which agents never use for cognition — it exists only so the analytics can trace
 * cognates and borrowings exactly.
 *
 * Data structure: concept-indexed arrays (O(1) production lookup) + a form→entries hash map
 * (O(1) exact recognition). Fuzzy recognition scans the form map (~100 entries per agent).
 */
import { N_CONCEPTS, GRAM_BASE } from '../language/concepts';
import { formMask } from '../language/phonology';

export const enum Origin { Invented = 0, Learned = 1, Borrowed = 2, Extended = 3, Inherited = 4 }

export interface LexEntry {
  form: string;
  concept: number;
  score: number;
  uses: number;
  succ: number;
  last: number;
  etym: number;
  origin: Origin;
  srcLang: number;
  born: number;
}

export class Lexicon {
  byConcept: LexEntry[][] = Array.from({ length: N_CONCEPTS }, () => []);
  byForm = new Map<string, LexEntry[]>();
  size = 0;
  /** structural version, bumped whenever forms are added/removed (invalidates the fuzzy-match index) */
  version = 0;
  private _iv = -1;
  private _forms: string[] = [];
  private _masks = new Int32Array(0);
  private _byFirst = new Map<number, number[]>();
  private _byLast = new Map<number, number[]>();

  /**
   * Index of forms that carry at least one content meaning: phoneme bitmasks for fast pre-filtering, and
   * buckets by first/last segment so fuzzy recognition only aligns against plausible candidates.
   */
  contentIndex(): { forms: string[]; masks: Int32Array; byFirst: Map<number, number[]>; byLast: Map<number, number[]> } {
    if (this._iv !== this.version) {
      const forms: string[] = [];
      for (const [f, l] of this.byForm) { for (const e of l) if (e.concept < GRAM_BASE) { forms.push(f); break; } }
      const masks = new Int32Array(forms.length);
      const byFirst = new Map<number, number[]>(), byLast = new Map<number, number[]>();
      for (let i = 0; i < forms.length; i++) {
        const f = forms[i];
        masks[i] = formMask(f);
        const a = f.charCodeAt(0), z = f.charCodeAt(f.length - 1);
        (byFirst.get(a) ?? byFirst.set(a, []).get(a)!).push(i);
        (byLast.get(z) ?? byLast.set(z, []).get(z)!).push(i);
      }
      this._forms = forms; this._masks = masks; this._byFirst = byFirst; this._byLast = byLast; this._iv = this.version;
    }
    return { forms: this._forms, masks: this._masks, byFirst: this._byFirst, byLast: this._byLast };
  }

  best(concept: number): LexEntry | undefined {
    const list = this.byConcept[concept];
    let b: LexEntry | undefined;
    for (const e of list) if (!b || e.score > b.score || (e.score === b.score && e.etym < b.etym)) b = e;
    return b;
  }
  get(form: string, concept: number): LexEntry | undefined {
    const l = this.byForm.get(form);
    if (!l) return undefined;
    for (const e of l) if (e.concept === concept) return e;
    return undefined;
  }
  add(e: LexEntry): LexEntry {
    const existing = this.get(e.form, e.concept);
    if (existing) return existing;
    this.byConcept[e.concept].push(e);
    const l = this.byForm.get(e.form);
    if (l) l.push(e); else this.byForm.set(e.form, [e]);
    this.size++;
    this.version++;
    return e;
  }
  remove(e: LexEntry) {
    const lc = this.byConcept[e.concept];
    const i = lc.indexOf(e);
    if (i < 0) return;
    lc.splice(i, 1);
    const lf = this.byForm.get(e.form)!;
    const j = lf.indexOf(e);
    lf.splice(j, 1);
    if (!lf.length) this.byForm.delete(e.form);
    this.size--;
    this.version++;
  }
  /** Change the stored form of an entry (e.g., aligning to a heard pronunciation). */
  reform(e: LexEntry, form: string) {
    if (e.form === form) return;
    const clash = this.get(form, e.concept);
    if (clash) { clash.score = Math.max(clash.score, e.score); this.remove(e); return; }
    const lf = this.byForm.get(e.form)!;
    lf.splice(lf.indexOf(e), 1);
    if (!lf.length) this.byForm.delete(e.form);
    e.form = form;
    this.version++;
    const l = this.byForm.get(form);
    if (l) l.push(e); else this.byForm.set(form, [e]);
  }
  *entries(): IterableIterator<LexEntry> {
    for (const l of this.byConcept) for (const e of l) yield e;
  }
  /** Decay all associations and prune weak ones; enforce memory capacity. */
  decay(factor: number, capacity: number, tick: number, protectRecent = 8) {
    const dead: LexEntry[] = [];
    for (const l of this.byConcept) for (const e of l) {
      if (tick - e.last > protectRecent) e.score *= factor;
      if (e.score < 0.015) dead.push(e);
    }
    for (const e of dead) this.remove(e);
    if (this.size > capacity) {
      const all = [...this.entries()].sort((a, b) => a.score - b.score || b.etym - a.etym);
      const excess = this.size - capacity;
      for (let i = 0; i < excess && i < all.length; i++) this.remove(all[i]);
    }
  }
  /** Serialise preserving both index orders exactly (needed for bit-identical snapshot restoration). */
  toJSON(): LexiconJSON {
    const entries: LexEntry[] = [];
    const index = new Map<LexEntry, number>();
    for (const l of this.byConcept) for (const e of l) { index.set(e, entries.length); entries.push({ ...e }); }
    const concepts = this.byConcept.map((l) => l.map((e) => index.get(e)!));
    const forms: [string, number[]][] = [...this.byForm.entries()].map(([f, l]) => [f, l.map((e) => index.get(e)!)]);
    return { entries, concepts, forms };
  }
  static fromJSON(o: LexiconJSON): Lexicon {
    const lx = new Lexicon();
    const entries = o.entries.map((e) => ({ ...e }));
    lx.byConcept = o.concepts.map((l) => l.map((i) => entries[i]));
    for (const [f, l] of o.forms) lx.byForm.set(f, l.map((i) => entries[i]));
    lx.size = entries.length;
    return lx;
  }
}

export interface LexiconJSON { entries: LexEntry[]; concepts: number[][]; forms: [string, number[]][] }
