import { simClient } from '../store/simClient';
import { useSim } from '../store/store';
import { db, type SnapshotMeta } from '../persistence/db';
import type { SimSnapshot } from '../simulation/engine/simulation';
import { WORLD_DESCRIPTIONS } from '../simulation/core/config';

export async function saveCurrentSnapshot(label?: string, parent?: string): Promise<SnapshotMeta | null> {
  const snap = await simClient.snapshot<SimSnapshot>();
  if (!snap) return null;
  const year = Math.floor(snap.tick / 4);
  const langs = snap.tracker.languages.filter((l) => l.fate === 'alive').length;
  const meta: SnapshotMeta = {
    id: `snap-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
    label: label ?? `${WORLD_DESCRIPTIONS[snap.cfg.worldType].title} · year ${year}`,
    created: Date.now(), tick: snap.tick, year, world: snap.cfg.worldType, seed: snap.cfg.seed, population: snap.agents.length, languages: langs, parent,
  };
  await db.saveSnapshot(meta, snap);
  return meta;
}

export async function restoreSnapshot(id: string) {
  const data = (await db.loadSnapshot(id)) as SimSnapshot | undefined;
  if (!data) return false;
  useSim.setState({ running: false, selection: null, world: null, frame: null });
  simClient.send({ type: 'load', snapshot: data });
  return true;
}
