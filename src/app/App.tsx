import { useEffect, useState } from 'react';
import { useSim, type Page } from '../store/store';
import { Icon, Logo } from '../components/icons';
import { TopBar } from './TopBar';
import { Observatory } from '../pages/Observatory';
import { Atlas } from '../pages/Atlas';
import { Languages } from '../pages/Languages';
import { Microscope } from '../pages/Microscope';
import { Agents } from '../pages/Agents';
import { Metrics } from '../pages/Metrics';
import { Lab } from '../pages/Lab';
import { Methods } from '../pages/Methods';
import { NewWorldModal } from './NewWorldModal';
import { SnapshotsModal } from './SnapshotsModal';

const NAV: { p: Page; label: string; icon: keyof typeof Icon }[] = [
  { p: 'observatory', label: 'World', icon: 'Globe' },
  { p: 'atlas', label: 'Atlas', icon: 'Tree' },
  { p: 'languages', label: 'Languages', icon: 'Book' },
  { p: 'microscope', label: 'Microscope', icon: 'Lens' },
  { p: 'agents', label: 'Agents', icon: 'Person' },
  { p: 'metrics', label: 'Metrics', icon: 'Chart' },
  { p: 'lab', label: 'Laboratory', icon: 'Flask' },
];

export function App() {
  const page = useSim((s) => s.page);
  const setPage = useSim((s) => s.setPage);
  const init = useSim((s) => s.init);
  const world = useSim((s) => s.world);
  const [newWorld, setNewWorld] = useState(false);
  const [snaps, setSnaps] = useState(false);

  useEffect(() => { init(); }, [init]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
      const s = useSim.getState();
      if (e.code === 'Space') { e.preventDefault(); s.running ? s.pause() : s.play(); }
      if (e.key === '.') s.step(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="shell">
      <nav className="rail">
        <div className="logo"><Logo /><div className="logo-word">BABEL</div></div>
        {NAV.map((n) => {
          const I = Icon[n.icon];
          return (
            <button key={n.p} className={`rail-btn ${page === n.p ? 'active' : ''}`} onClick={() => setPage(n.p)} title={n.label}>
              <I />{n.label}
            </button>
          );
        })}
        <div className="spacer" />
        <button className={`rail-btn ${page === 'methods' ? 'active' : ''}`} onClick={() => setPage('methods')} title="Methods & abstractions"><Icon.Info />Methods</button>
      </nav>
      <div className="main">
        <TopBar onNewWorld={() => setNewWorld(true)} onSnapshots={() => setSnaps(true)} />
        {!world ? (
          <div className="page"><div className="empty pulse">Generating world…</div></div>
        ) : (
          <>
            {page === 'observatory' && <div className="page full"><Observatory /></div>}
            {page === 'atlas' && <div className="page"><Atlas /></div>}
            {page === 'languages' && <div className="page"><Languages /></div>}
            {page === 'microscope' && <div className="page"><Microscope /></div>}
            {page === 'agents' && <div className="page"><Agents /></div>}
            {page === 'metrics' && <div className="page"><Metrics /></div>}
            {page === 'lab' && <div className="page"><Lab /></div>}
            {page === 'methods' && <div className="page"><Methods /></div>}
          </>
        )}
      </div>
      {newWorld && <NewWorldModal onClose={() => setNewWorld(false)} />}
      {snaps && <SnapshotsModal onClose={() => setSnaps(false)} />}
    </div>
  );
}
