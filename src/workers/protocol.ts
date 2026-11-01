import type { SimConfig } from '../simulation/core/config';
import type { Intervention, SimSnapshot } from '../simulation/engine/simulation';

export type QueryKind = 'agent' | 'settlement' | 'language' | 'atlas' | 'episodes' | 'episode' | 'history' | 'tree' | 'agents';

export type ToWorker =
  | { type: 'init'; config: SimConfig }
  | { type: 'load'; snapshot: SimSnapshot }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'step'; ticks: number }
  | { type: 'speed'; ticksPerSecond: number }
  | { type: 'intervene'; action: Intervention }
  | { type: 'follow'; agent: number }
  | { type: 'snapshot'; reqId: number }
  | { type: 'query'; reqId: number; kind: QueryKind; id?: number };

export type FromWorker =
  | { type: 'world'; world: unknown }
  | { type: 'frame'; frame: unknown; running: boolean; tps: number }
  | { type: 'result'; reqId: number; data: unknown }
  | { type: 'error'; message: string };
