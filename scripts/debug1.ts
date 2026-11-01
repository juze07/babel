import { Simulation } from '../src/simulation/engine/simulation';
import { defaultConfig } from '../src/simulation/core/config';
import { CONCEPTS, N_CONTENT, C } from '../src/simulation/language/concepts';
import { describeFrame } from '../src/simulation/language/frames';

const cfg = { ...defaultConfig('valley', 3), settlements: 1, agentsPerSettlement: 30, externalContact: 0, migrationRate: 0 };
const sim = new Simulation(cfg);
const t0 = performance.now();
for (let i = 0; i < 120; i++) {
  sim.step();
  if (sim.tick % 20 === 0) {
    const h = sim.history[sim.history.length - 1];
    const ag = sim.agents.filter(a => sim.tick - a.born > 40);
    let bs = 0, n = 0;
    for (const a of ag) for (let c = 0; c < N_CONTENT; c++) { const b = a.lex.best(c); if (b) { bs += b.score; n++; } }
    const fish = new Map<string, number>();
    for (const a of ag) { const b = a.lex.best(C.person); if (b) fish.set(b.form+'#'+b.etym, (fish.get(b.form) ?? 0) + 1); }
    let agreeE = 0;
    for (let c = 0; c < N_CONTENT; c++) { const m = new Map<number, number>(); for (const a of ag) { const b = a.lex.best(c); if (b) m.set(b.etym, (m.get(b.etym) ?? 0) + 1); } agreeE += Math.max(0, ...m.values()) / ag.length / N_CONTENT; }
    console.log(`agreeEtym ${(agreeE*100).toFixed(0)} t${sim.tick} succ ${(h.success*100).toFixed(0)} first ${(h.firstTry*100).toFixed(0)} fid ${(h.fidelity*100).toFixed(0)} gest ${(h.gestureRate*100).toFixed(0)} shared ${(h.sharedVocab*100).toFixed(0)} syn ${h.synonymy.toFixed(2)} vocab ${h.vocabSize.toFixed(0)} meanBest ${(bs/n).toFixed(2)} lexsize ${(ag.reduce((s,a)=>s+a.lex.size,0)/ag.length).toFixed(0)} person: ${[...fish.entries()].sort((a,b)=>b[1]-a[1]).slice(0,5).map(([f,k])=>f+':'+k).join(' ')} ms/tick ${((performance.now()-t0)/sim.tick).toFixed(1)}`);
  }
}
const ep = sim.episodes[sim.episodes.length - 1];
console.log('TARGET', describeFrame(ep.target));
for (const t of ep.turns) {
  console.log(' utter', t.words.map(w => `${w.text}${w.gesture>=0?'[g:'+CONCEPTS[w.gesture].key+']':''}`).join(' | '));
  console.log(' heard-analysis', t.analysis.map(a => `${a.heard}->${a.chosen ? CONCEPTS[a.chosen.concept].key + '(' + a.chosen.conf.toFixed(2) + ')' : '?'} marks:${a.marks.map(m=>CONCEPTS[m.g].key).join(',')} pre:${a.pre} suf:${a.suf}`).join(' | '));
  console.log(' scores', t.scores.map(s=>s.toFixed(1)).join(','), 'choice', t.choice, 'ctx', ep.context.map(describeFrame).join(' || '));
}
console.log(ep.updates.slice(0, 20).map(u => `${u.who} ${u.kind} ${u.form}=${CONCEPTS[u.concept].key} ${u.before.toFixed(2)}→${u.after.toFixed(2)}`).join('\n'));
const a = sim.agents[0];
console.log('agent0 lexicon for person:', a.lex.byConcept[C.person].map(e=>e.form+':'+e.score.toFixed(2)).join(' '));
console.log('agent0 grammar markers:', [64,65,66,67,68,69,70,71].map(g => a.lex.byConcept[g].map(e=>e.form+':'+e.score.toFixed(2)).join(' ')).join(' / '));
for (const a of sim.agents.slice(0, 30)) { const b = a.lex.best(C.person); console.log(a.id, ((sim.tick - a.born)/4).toFixed(0), b ? `${b.form}#${b.etym} o${b.origin} s${b.score.toFixed(2)} uses${b.uses}` : '-', a.lex.byConcept[C.person].map(e => e.form + '#' + e.etym + ':' + e.score.toFixed(2)).join(' ')); }
