import { useEffect, useRef, useState } from 'react';
import { Modal, Empty } from '../components/ui';
import { Icon } from '../components/icons';
import { db, download, type SnapshotMeta } from '../persistence/db';
import { restoreSnapshot, saveCurrentSnapshot } from './snapshots';
import { useSim } from '../store/store';
import { WORLD_DESCRIPTIONS } from '../simulation/core/config';

export function SnapshotsModal({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<SnapshotMeta[]>([]);
  const [label, setLabel] = useState('');
  const setPage = useSim((s) => s.setPage);
  const fileRef = useRef<HTMLInputElement>(null);
  const reload = () => db.listSnapshots().then((l) => setList(l.sort((a, b) => b.created - a.created)));
  useEffect(() => { reload(); }, []);
  return (
    <Modal title="Snapshots & branches" sub="A snapshot stores the complete state (every agent's mind, the RNG state, history). Restoring one and continuing reproduces exactly the same future; changing parameters after restoring creates a branch." onClose={onClose}
      foot={<>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          try {
            const data = JSON.parse(await f.text());
            const meta: SnapshotMeta = { id: `snap-${Date.now().toString(36)}`, label: `Imported · year ${Math.floor(data.tick / 4)}`, created: Date.now(), tick: data.tick, year: Math.floor(data.tick / 4), world: data.cfg.worldType, seed: data.cfg.seed, population: data.agents.length, languages: data.tracker.languages.filter((l: { fate: string }) => l.fate === 'alive').length };
            await db.saveSnapshot(meta, data); reload();
          } catch { alert('Not a valid BABEL snapshot'); }
        }} />
        <button className="btn ghost" onClick={() => fileRef.current?.click()}><Icon.Upload /> Import snapshot</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={() => { setPage('lab'); onClose(); }}><Icon.Flask /> Branch experiments in the Laboratory</button>
      </>}>
      <div className="row" style={{ marginBottom: 14 }}>
        <input type="text" placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} style={{ flex: 1 }} />
        <button className="btn primary" onClick={async () => { await saveCurrentSnapshot(label || undefined); setLabel(''); reload(); }}><Icon.Camera /> Save current state</button>
      </div>
      {!list.length ? <Empty>No snapshots yet.</Empty> : (
        <table className="t">
          <thead><tr><th>Label</th><th>World</th><th>Year</th><th>Agents</th><th>Languages</th><th>Saved</th><th /></tr></thead>
          <tbody>
            {list.map((s) => (
              <tr key={s.id}>
                <td style={{ fontFamily: 'var(--serif)' }}>{s.label}</td>
                <td>{WORLD_DESCRIPTIONS[s.world as keyof typeof WORLD_DESCRIPTIONS]?.title ?? s.world} <span className="muted mono tiny">#{s.seed}</span></td>
                <td className="num">{s.year}</td>
                <td className="num">{s.population}</td>
                <td className="num">{s.languages}</td>
                <td className="tiny muted">{new Date(s.created).toLocaleString()}</td>
                <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                  <button className="btn sm primary" onClick={async () => { await restoreSnapshot(s.id); onClose(); }}>Restore</button>{' '}
                  <button className="btn sm" title="Export as JSON" onClick={async () => { const d = await db.loadSnapshot(s.id); download(`babel-${s.world}-y${s.year}.json`, JSON.stringify(d)); }}><Icon.Download /></button>{' '}
                  <button className="btn sm ghost" title="Delete" onClick={async () => { await db.deleteSnapshot(s.id); reload(); }}><Icon.Trash /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
