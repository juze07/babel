/// <reference lib="webworker" />
/**
 * Simulation worker: owns the Simulation instance, advances it in time-budgeted batches so the UI
 * thread never blocks, and streams compact frames at a controlled rate (~8 Hz).
 */
import { Simulation } from '../simulation/engine/simulation';
import { frameView, worldStatic, agentView, settlementView, languageView, atlasView, episodeList, episodeView, historyView, treeView, agentList } from '../simulation/engine/views';
import type { ToWorker, FromWorker } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let sim: Simulation | null = null;
let running = false;
let tps = 20; // target ticks per second
let timer: ReturnType<typeof setTimeout> | null = null;
let lastFrame = 0;
let measuredTps = 0;
let tickDebt = 0;
let lastLoop = 0;

function post(msg: FromWorker, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

function sendFrame() {
  if (!sim) return;
  const f = frameView(sim);
  post({ type: 'frame', frame: f, running, tps: measuredTps }, [f.pos.buffer]);
  lastFrame = performance.now();
}

function loop() {
  timer = null;
  if (!sim || !running) return;
  const now = performance.now();
  const dt = Math.min(0.25, (now - (lastLoop || now)) / 1000);
  lastLoop = now;
  tickDebt += dt * tps;
  const budget = 40; // ms per batch
  const t0 = performance.now();
  let done = 0;
  while (tickDebt >= 1 && performance.now() - t0 < budget) {
    sim.step();
    tickDebt -= 1;
    done++;
  }
  if (tickDebt > tps) tickDebt = tps; // don't accumulate unbounded lag
  const el = (performance.now() - t0) / 1000;
  if (done) measuredTps = measuredTps * 0.8 + (done / Math.max(el, dt, 1e-3)) * 0.2;
  if (performance.now() - lastFrame > 120) sendFrame();
  timer = setTimeout(loop, done ? 4 : 16);
}

function start() {
  if (running) return;
  running = true;
  lastLoop = performance.now();
  tickDebt = 0;
  if (!timer) timer = setTimeout(loop, 0);
}

function stop() {
  running = false;
  if (timer) { clearTimeout(timer); timer = null; }
  sendFrame();
}

self.onmessage = (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    switch (m.type) {
      case 'init':
        stop();
        sim = new Simulation(m.config);
        post({ type: 'world', world: worldStatic(sim) });
        sim.analyze();
        sendFrame();
        break;
      case 'load':
        stop();
        sim = Simulation.deserialize(m.snapshot);
        post({ type: 'world', world: worldStatic(sim) });
        sendFrame();
        break;
      case 'play': start(); break;
      case 'pause': stop(); break;
      case 'step':
        if (sim) { for (let i = 0; i < m.ticks; i++) sim.step(); sendFrame(); }
        break;
      case 'speed': tps = Math.max(1, m.ticksPerSecond); break;
      case 'intervene':
        if (sim) { sim.intervene(m.action); sendFrame(); }
        break;
      case 'follow':
        if (sim) { sim.follow = m.agent; sendFrame(); }
        break;
      case 'snapshot':
        post({ type: 'result', reqId: m.reqId, data: sim ? sim.serialize() : null });
        break;
      case 'query': {
        if (!sim) { post({ type: 'result', reqId: m.reqId, data: null }); break; }
        const id = m.id ?? -1;
        let data: unknown = null;
        switch (m.kind) {
          case 'agent': data = agentView(sim, id); break;
          case 'settlement': data = settlementView(sim, id); break;
          case 'language': data = languageView(sim, id); break;
          case 'atlas': data = atlasView(sim); break;
          case 'episodes': data = episodeList(sim); break;
          case 'episode': data = episodeView(sim, id); break;
          case 'history': data = historyView(sim); break;
          case 'tree': data = treeView(sim); break;
          case 'agents': data = agentList(sim); break;
        }
        post({ type: 'result', reqId: m.reqId, data });
        break;
      }
    }
  } catch (e) {
    post({ type: 'error', message: (e as Error).stack ?? String(e) });
  }
};
