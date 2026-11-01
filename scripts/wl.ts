import { Simulation } from '../src/simulation/engine/simulation';
import { defaultConfig } from '../src/simulation/core/config';
import { N_CONTENT, CONCEPTS } from '../src/simulation/language/concepts';
const sim = new Simulation({ ...defaultConfig('archipelago', 7) });
const T = Number(process.env.T || 600);
for (let i = 0; i < T; i++) sim.step();
const by: Record<number, number[]> = {};
const ex: Record<number, string[]> = {};
for (const a of sim.agents) { if ((sim.tick - a.born) / 4 < 16) continue;
  for (let c = 0; c < N_CONTENT; c++) { const b = a.lex.best(c); if (!b) continue; (by[b.origin] ??= []).push(b.form.length); if (b.form.length >= 8) (ex[b.origin] ??= []).push(`${CONCEPTS[c].key}:${b.form}`); } }
for (const k of Object.keys(by)) { const v = by[+k]; console.log(['inv','learned','borrowed','ext','inh'][+k], v.length, (v.reduce((x,y)=>x+y,0)/v.length).toFixed(2), (ex[+k]??[]).slice(0,12).join(' ')); }
// etymon form vs current form length
let grow = 0, n = 0; const gx: string[] = [];
for (const a of sim.agents.slice(0, 60)) for (let c = 0; c < N_CONTENT; c++) { const b = a.lex.best(c); if (!b) continue; const et = sim.etymons.get(b.etym); if (!et) continue; n++; if (b.form.length > et.form.length) { grow++; if (gx.length < 20) gx.push(`${et.form}->${b.form}`); } }
console.log('grown vs etymon', grow, '/', n, gx.join(' '));
