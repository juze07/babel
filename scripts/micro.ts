import { Rng } from '../src/simulation/core/rng';
import { defaultConfig } from '../src/simulation/core/config';
import { createAgent, sampleTraits } from '../src/simulation/agents/agent';
import { runEpisode, type LangContext } from '../src/simulation/communication/episode';
import { N_CONTENT, CONCEPTS } from '../src/simulation/language/concepts';

const cfg = defaultConfig('valley', 1);
const N = Number(process.env.N || 2);
const rng = new Rng(5);
const agents = Array.from({ length: N }, (_, i) => createAgent(i, rng, 0, -100, sampleTraits(rng, cfg.traits, 0.1), 0));
let etym = 0;
const ctx: LangContext = { tick: 0, cfg, rules: new Map(), learning: true, record: true, newEtym: () => etym++, etymLang: () => -1, isForeign: () => false };
const sal = new Float64Array(N_CONTENT).map((_, c) => CONCEPTS[c].freq);
let ok = 0, first = 0, inv = 0;
for (let i = 1; i <= Number(process.env.E || 4000); i++) {
  const s = agents[rng.int(N)]; let l = agents[rng.int(N)]; while (l === s) l = agents[rng.int(N)];
  ctx.tick = Math.floor(i / N);
  const r = runEpisode(s, l, sal, ctx, rng, i);
  inv += r.inventions; if (r.success) ok++; if (r.success && r.turns === 1) first++;
  if (i % 500 === 0) {
    let agree = 0, n = 0;
    for (let c = 0; c < N_CONTENT; c++) { const f = new Map<string, number>(); for (const a of agents) { const b = a.lex.best(c); if (b) f.set(String(b.etym), (f.get(String(b.etym)) ?? 0) + 1); } const m = Math.max(0, ...f.values()); agree += m / N; n++; }
    console.log(i, 'succ', (ok / 500).toFixed(2), 'first', (first / 500).toFixed(2), 'agree', (agree / n).toFixed(2), 'lex', agents[0].lex.size, 'syn', (agents[0].lex.size / N_CONTENT).toFixed(2), 'inv', inv); inv = 0;
    ok = 0; first = 0;
    if (false) { const rec = r.record!; console.log(rec.turns.map(t => t.words.map(w => w.text + (w.gesture >= 0 ? '[g]' : '')).join(' ') + ' -> ' + t.analysis.map(a => a.chosen ? CONCEPTS[a.chosen.concept].key : '?').join(' ') + ' choice ' + t.choice).join('\n')); }
  }
}
const a0 = agents[0];
const byKind = new Map<string, number>();
for (const l of a0.learnLog) byKind.set(l.kind, (byKind.get(l.kind) ?? 0) + 1);
const all = [...a0.lex.entries()];
console.log('entries', all.length, 'score<0.05', all.filter(e => e.score < 0.05).length, 'gram', all.filter(e => e.concept >= 64).length);
console.log(all.filter(e=>e.concept<64).sort((a,b)=>a.concept-b.concept).slice(0,60).map(e => `${CONCEPTS[e.concept].key}:${e.form}:${e.score.toFixed(2)}:o${e.origin}`).join(' '));
let rec_ = 0, unk = 0, wrong = 0, knowsTarget = 0;
for (let i = 0; i < 1500; i++) {
  const s = agents[rng.int(N)]; let l = agents[rng.int(N)]; while (l === s) l = agents[rng.int(N)];
  const r = runEpisode(s, l, sal, { ...ctx, learning: false }, rng, i);
  const t = r.record!.turns[0];
  t.words.forEach((w, k) => {
    const st = w.morphs.find(m => m.kind === 'stem'); if (!st) return;
    const a = t.analysis[k];
    if (a.chosen && a.chosen.concept === st.concept) rec_++; else if (!a.chosen) { unk++; if (l.lex.byConcept[st.concept].length) knowsTarget++; } else wrong++;
  });
}
console.log('recognized', rec_, 'unknown', unk, '(listener has other word for concept:', knowsTarget, ') wrong', wrong);
const tiers: [string, number][] = [];
for (let c = 0; c < N_CONTENT; c++) { const f = new Map<number, number>(); for (const a of agents) { const b = a.lex.best(c); if (b) f.set(b.etym, (f.get(b.etym) ?? 0) + 1); } tiers.push([CONCEPTS[c].key + '(' + CONCEPTS[c].freq + ')', Math.max(0, ...f.values()) / N]); }
tiers.sort((a, b) => b[1] - a[1]);
console.log(tiers.map(([k, v]) => k + ':' + v.toFixed(2)).join(' '));
