import { create } from 'zustand';
import { defaultConfig, type SimConfig } from '../simulation/core/config';
import type { FrameView } from '../simulation/engine/views';
import { simClient } from './simClient';
import type { Intervention } from '../simulation/engine/simulation';

export interface WorldStatic { W: number; H: number; height: number[]; biome: number[]; cfg: SimConfig }
export type Page = 'observatory' | 'atlas' | 'languages' | 'microscope' | 'agents' | 'metrics' | 'lab' | 'methods';
export type Selection = { kind: 'agent' | 'settlement' | 'language' | 'route'; id: number } | null;

interface State {
  world: WorldStatic | null;
  frame: FrameView | null;
  frameNo: number;
  running: boolean;
  tps: number;
  speed: number;
  config: SimConfig;
  page: Page;
  selection: Selection;
  langFocus: number;
  agentFocus: number;
  episodeFocus: number;
  setPage: (p: Page) => void;
  select: (s: Selection) => void;
  focusLanguage: (id: number) => void;
  focusAgent: (id: number) => void;
  focusEpisode: (id: number) => void;
  init: (cfg?: SimConfig) => void;
  play: () => void;
  pause: () => void;
  step: (n?: number) => void;
  setSpeed: (tps: number) => void;
  intervene: (a: Intervention) => void;
  follow: (id: number) => void;
}

export const SPEEDS = [2, 6, 20, 60, 200];

export const useSim = create<State>((set, get) => ({
  world: null,
  frame: null,
  frameNo: 0,
  running: false,
  tps: 0,
  speed: 20,
  config: defaultConfig('archipelago', 1234),
  page: 'observatory',
  selection: null,
  langFocus: -1,
  agentFocus: -1,
  episodeFocus: -1,
  setPage: (page) => set({ page }),
  select: (selection) => set({ selection }),
  focusLanguage: (id) => set({ langFocus: id, page: 'languages' }),
  focusAgent: (id) => set({ agentFocus: id, page: 'agents' }),
  focusEpisode: (id) => set({ episodeFocus: id, page: 'microscope' }),
  init: (cfg) => {
    const config = cfg ?? get().config;
    set({ config, frame: null, world: null, running: false, selection: null, langFocus: -1, agentFocus: -1, episodeFocus: -1 });
    simClient.send({ type: 'init', config });
  },
  play: () => { simClient.send({ type: 'speed', ticksPerSecond: get().speed }); simClient.send({ type: 'play' }); set({ running: true }); },
  pause: () => { simClient.send({ type: 'pause' }); set({ running: false }); },
  step: (n = 1) => simClient.send({ type: 'step', ticks: n }),
  setSpeed: (speed) => { set({ speed }); simClient.send({ type: 'speed', ticksPerSecond: speed }); },
  intervene: (action) => simClient.send({ type: 'intervene', action }),
  follow: (id) => simClient.send({ type: 'follow', agent: id }),
}));

simClient.on((m) => {
  if (m.type === 'world') useSim.setState({ world: m.world as WorldStatic, config: (m.world as WorldStatic).cfg });
  if (m.type === 'frame') useSim.setState((s) => ({ frame: m.frame as FrameView, running: m.running, tps: m.tps, frameNo: s.frameNo + 1 }));
});
