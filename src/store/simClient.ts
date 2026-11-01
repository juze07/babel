/** Thin client around the simulation worker. */
import type { FromWorker, ToWorker, QueryKind } from '../workers/protocol';

type Listener = (m: FromWorker) => void;

class SimClient {
  worker: Worker;
  private reqId = 1;
  private pending = new Map<number, (d: unknown) => void>();
  private listeners = new Set<Listener>();

  constructor() {
    this.worker = new Worker(new URL('../workers/simulation.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<FromWorker>) => {
      const m = ev.data;
      if (m.type === 'result') {
        const r = this.pending.get(m.reqId);
        if (r) { this.pending.delete(m.reqId); r(m.data); }
        return;
      }
      if (m.type === 'error') console.error('[simulation worker]', m.message);
      for (const l of this.listeners) l(m);
    };
  }
  send(m: ToWorker) { this.worker.postMessage(m); }
  on(l: Listener) { this.listeners.add(l); return () => this.listeners.delete(l); }
  query<T>(kind: QueryKind, id?: number): Promise<T> {
    const reqId = this.reqId++;
    return new Promise((res) => {
      this.pending.set(reqId, res as (d: unknown) => void);
      this.send({ type: 'query', reqId, kind, id });
    });
  }
  snapshot<T>(): Promise<T> {
    const reqId = this.reqId++;
    return new Promise((res) => {
      this.pending.set(reqId, res as (d: unknown) => void);
      this.send({ type: 'snapshot', reqId });
    });
  }
}

export const simClient = new SimClient();
