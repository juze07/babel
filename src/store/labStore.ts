/**
 * Experiment Laboratory state. Lives outside the page component so batches keep running
 * while the user explores other pages. Runs are spread over a small pool of Web Workers.
 */
import { create } from 'zustand';
import type { SimConfig } from '../simulation/core/config';
import type { SimSnapshot } from '../simulation/engine/simulation';
import type { RunResult, RunSpec, ExpOut } from '../workers/experiment.worker';
import { db } from '../persistence/db';

export interface Condition { id: string; label: string; params: Partial<SimConfig>; traits: Partial<SimConfig['traits']> }
export interface Expectation { metric: string; higher: string; lower: string; text: string }
export interface ExperimentRecord {
  id: string;
  name: string;
  preset: string;
  created: number;
  world: SimConfig['worldType'];
  years: number;
  seeds: number[];
  conditions: Condition[];
  expectations: Expectation[];
  branchFrom?: { id: string; label: string; year: number } | null;
  results: RunResult[];
  status: 'running' | 'done' | 'cancelled';
}

interface LabState {
  current: ExperimentRecord | null;
  progress: Record<string, number>;
  saved: ExperimentRecord[];
  running: boolean;
  error: string | null;
  start: (exp: Omit<ExperimentRecord, 'results' | 'status' | 'created'>, base: (seed: number) => SimConfig, snapshot?: SimSnapshot) => void;
  cancel: () => void;
  open: (e: ExperimentRecord) => void;
  reload: () => Promise<void>;
  remove: (id: string) => Promise<void>;
}

let pool: Worker[] = [];
function killPool() { pool.forEach((w) => w.terminate()); pool = []; }

export const useLab = create<LabState>((set, get) => ({
  current: null,
  progress: {},
  saved: [],
  running: false,
  error: null,
  start: (spec, base, snapshot) => {
    killPool();
    const exp: ExperimentRecord = { ...spec, results: [], status: 'running', created: Date.now() };
    const runs: RunSpec[] = [];
    for (const c of spec.conditions) for (const seed of spec.seeds) {
      const b = base(seed);
      const config: SimConfig = { ...b, ...c.params, seed, traits: { ...b.traits, ...c.traits } };
      runs.push({
        runId: `${c.id}-${seed}`, label: `${c.label} · seed ${seed}`, condition: c.id, seed, config, years: spec.years,
        fromSnapshot: snapshot, params: snapshot ? { ...c.params, traits: Object.keys(c.traits).length ? { ...snapshot.cfg.traits, ...c.traits } : undefined } : undefined,
      });
    }
    set({ current: exp, progress: Object.fromEntries(runs.map((r) => [r.runId, 0])), running: true, error: null });
    const n = Math.max(1, Math.min(runs.length, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)));
    const queue = [...runs];
    let active = n;
    const finish = async () => {
      const cur = get().current;
      if (!cur) return;
      const done: ExperimentRecord = { ...cur, status: 'done' };
      set({ current: done, running: false });
      killPool();
      await db.saveExperiment(done as unknown as { id: string } & Record<string, unknown>);
      get().reload();
    };
    for (let i = 0; i < n; i++) {
      const w = new Worker(new URL('../workers/experiment.worker.ts', import.meta.url), { type: 'module' });
      pool.push(w);
      const next = () => {
        const r = queue.shift();
        if (!r) { w.terminate(); active--; if (active === 0) finish(); return; }
        w.postMessage({ type: 'run', runs: [r] });
      };
      w.onmessage = (ev: MessageEvent<ExpOut>) => {
        const m = ev.data;
        if (m.type === 'progress') set((s) => ({ progress: { ...s.progress, [m.runId]: m.fraction } }));
        if (m.type === 'runDone') {
          set((s) => ({ progress: { ...s.progress, [m.runId]: 1 }, current: s.current ? { ...s.current, results: [...s.current.results, m.result] } : s.current }));
        }
        if (m.type === 'allDone') next();
        if (m.type === 'error') { set({ error: m.message, running: false }); killPool(); }
      };
      next();
    }
  },
  cancel: () => {
    killPool();
    const cur = get().current;
    set({ running: false, current: cur ? { ...cur, status: 'cancelled' } : null });
  },
  open: (e) => { if (!get().running) set({ current: e, progress: {} }); },
  reload: async () => {
    const list = (await db.listExperiments()) as unknown as ExperimentRecord[];
    set({ saved: list.sort((a, b) => b.created - a.created) });
  },
  remove: async (id) => { await db.deleteExperiment(id); await get().reload(); },
}));
