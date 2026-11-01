import { Simulation } from '../src/simulation/engine/simulation';
import { defaultConfig } from '../src/simulation/core/config';
const type = (process.env.WT as any) || 'archipelago';
const sim = new Simulation({ ...defaultConfig(type, 7), ...(process.env.CPT ? { conversationsPerTick: Number(process.env.CPT) } : {}) });
const T = Number(process.env.T || 100);
const t0 = performance.now();
sim.run(T);
const dt = performance.now() - t0;
console.log(`agents ${sim.agents.length} episodes ${sim.nextEpisode} ms/tick ${(dt / T).toFixed(1)} µs/episode ${(dt * 1000 / sim.nextEpisode).toFixed(0)}`);
