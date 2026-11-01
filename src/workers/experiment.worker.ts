/// <reference lib="webworker" />
/**
 * Experiment worker: runs headless batches (conditions × seeds) without blocking the live simulation.
 */
import { Simulation, type SimSnapshot } from '../simulation/engine/simulation';
import type { SimConfig } from '../simulation/core/config';
import { langSummaries } from '../simulation/engine/views';
import { TICKS_PER_YEAR } from '../simulation/core/config';
import { Rng, hash2 } from '../simulation/core/rng';

declare const self: DedicatedWorkerGlobalScope;

export interface RunSpec {
  runId: string; label: string; condition: string; seed: number; config: SimConfig; years: number;
  /** branch: start from this exact state, apply `params`, and reseed the random stream with `seed` */
  fromSnapshot?: SimSnapshot; params?: Partial<SimConfig>;
}
export type ExpIn = { type: 'run'; runs: RunSpec[] } | { type: 'cancel' };
export type ExpOut =
  | { type: 'progress'; runId: string; fraction: number; done: number; total: number }
  | { type: 'runDone'; runId: string; result: RunResult }
  | { type: 'allDone' }
  | { type: 'error'; message: string };

export interface RunResult {
  runId: string; label: string; condition: string; seed: number; years: number;
  samples: Simulation['history'];
  languages: ReturnType<typeof langSummaries>;
  finalYear: number;
  config: SimConfig;
}

let cancelled = false;

self.onmessage = async (ev: MessageEvent<ExpIn>) => {
  const m = ev.data;
  if (m.type === 'cancel') { cancelled = true; return; }
  cancelled = false;
  try {
    for (let k = 0; k < m.runs.length; k++) {
      const r = m.runs[k];
      let sim: Simulation;
      if (r.fromSnapshot) {
        sim = Simulation.deserialize(r.fromSnapshot);
        if (r.params && Object.keys(r.params).length) sim.intervene({ kind: 'params', params: r.params });
        // alternative futures from identical starting conditions: only the random stream differs
        sim.rng = new Rng(hash2(r.seed, sim.tick + 1));
      } else sim = new Simulation(r.config);
      const startTick = sim.tick;
      const ticks = Math.round(r.years * TICKS_PER_YEAR);
      for (let t = 0; t < ticks; t++) {
        sim.step();
        if (t % 40 === 0) {
          self.postMessage({ type: 'progress', runId: r.runId, fraction: t / ticks, done: k, total: m.runs.length } satisfies ExpOut);
          await new Promise((res) => setTimeout(res, 0));
          if (cancelled) return;
        }
      }
      const result: RunResult = {
        runId: r.runId, label: r.label, condition: r.condition, seed: r.seed, years: r.years,
        samples: sim.history.filter((s) => s.tick >= startTick), languages: langSummaries(sim), finalYear: sim.tick / TICKS_PER_YEAR, config: sim.cfg,
      };
      self.postMessage({ type: 'runDone', runId: r.runId, result } satisfies ExpOut);
    }
    self.postMessage({ type: 'allDone' } satisfies ExpOut);
  } catch (e) {
    self.postMessage({ type: 'error', message: (e as Error).stack ?? String(e) } satisfies ExpOut);
  }
};
