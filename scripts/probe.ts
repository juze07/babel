import { Simulation } from '../src/simulation/engine/simulation';
import { defaultConfig } from '../src/simulation/core/config';
import { ORDERS } from '../src/simulation/agents/agent';

const type = (process.env.WT as any) || 'archipelago';
const sim = new Simulation({ ...defaultConfig(type, Number(process.env.SEED || 7)) });
const T = Number(process.env.T || 400);
const t0 = performance.now();
for (let i = 0; i < T; i++) {
  sim.step();
  if (sim.tick % 40 === 0) {
    const h = sim.history[sim.history.length - 1];
    console.log(`y${h.year.toFixed(0)} pop ${h.population} succ ${(h.success*100).toFixed(0)} first ${(h.firstTry*100).toFixed(0)} fid ${(h.fidelity*100).toFixed(0)} gest ${(h.gestureRate*100).toFixed(0)} cov ${(h.coverage*100).toFixed(0)} shared ${(h.sharedVocab*100).toFixed(0)} syn ${h.synonymy.toFixed(2)} vocab ${h.vocabSize.toFixed(0)} langs ${h.languages} fam ${h.families} intel ${(h.intelligibility*100).toFixed(0)} ordH ${h.orderEntropy.toFixed(2)} marks ${h.markerUse.map(x=>(x*100).toFixed(0)).join('/')} wl ${h.wordLength.toFixed(1)} comp ${(h.compNovel*100).toFixed(0)}/${(h.compFamiliar*100).toFixed(0)} trans ${(h.transmission*100).toFixed(0)} borrow ${h.borrowings} ms/tick ${((performance.now()-t0)/sim.tick).toFixed(1)}`);
  }
}
for (const l of sim.tracker.languages) console.log(l.id, l.name, l.fate, 'parent', l.parent, 'spk', l.speakers, 'set', l.settlements.join(','), l.current ? ORDERS[l.current.order.indexOf(Math.max(...l.current.order))] : '');
console.log(sim.events.slice(-25).map(e => `${(e.tick/4).toFixed(0)} ${e.type}: ${e.text}`).join('\n'));
