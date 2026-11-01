import { useState } from 'react';
import { useSim, SPEEDS } from '../store/store';
import { Icon } from '../components/icons';
import { Stat } from '../components/ui';
import { pct } from '../utils/format';
import { WORLD_DESCRIPTIONS } from '../simulation/core/config';
import { saveCurrentSnapshot } from './snapshots';

export function TopBar({ onNewWorld, onSnapshots }: { onNewWorld: () => void; onSnapshots: () => void }) {
  const { running, play, pause, step, speed, setSpeed, frame, tps, config, init } = useSim();
  const [flash, setFlash] = useState<string | null>(null);
  const m = frame?.metrics;
  const alive = frame?.langs.filter((l) => l.fate === 'alive').length ?? 0;
  const families = new Set(frame?.langs.filter((l) => l.fate === 'alive').map((l) => l.root) ?? []).size;
  const snap = async () => {
    const meta = await saveCurrentSnapshot();
    if (meta) { setFlash(`Saved “${meta.label}”`); setTimeout(() => setFlash(null), 2200); }
  };
  return (
    <header className="topbar">
      <div className="brand-title">
        <b>BABEL</b>
        <span>{WORLD_DESCRIPTIONS[config.worldType].title} · seed {config.seed}</span>
      </div>
      <div className="transport">
        <div className="clock" title={`Tick ${frame?.tick ?? 0} (4 ticks = 1 year)`}>
          <span className="u">Year</span>
          <span className="y">{Math.floor(frame?.year ?? 0)}</span>
        </div>
        <button className="btn primary" onClick={running ? pause : play} style={{ width: 92, justifyContent: 'center' }} title="Space">
          {running ? <><Icon.Pause /> Pause</> : <><Icon.Play /> {frame && frame.tick > 0 ? 'Resume' : 'Start'}</>}
        </button>
        <button className="btn icon" onClick={() => step(1)} disabled={running} title="Step one season (.)"><Icon.Step /></button>
        <button className="btn sm" onClick={() => step(4 * 10)} disabled={running} title="Advance 10 years">+10y</button>
        <div className="seg" title="Simulation speed (seasons per second)">
          {SPEEDS.map((s, i) => <button key={s} className={speed === s ? 'on' : ''} onClick={() => setSpeed(s)}>{['½', '1×', '3×', '10×', 'max'][i]}</button>)}
        </div>
        <span className="mono muted tiny" style={{ width: 70 }}>{running ? `${(tps / 4).toFixed(1)} yr/s` : 'paused'}</span>
        <button className="btn icon" onClick={() => init({ ...config })} title="Reset to year 0 (same seed & settings)"><Icon.Reset /></button>
        <button className="btn" onClick={snap} title="Save a snapshot of the full simulation state"><Icon.Camera /> <span className="lbl">Snapshot</span></button>
        <button className="btn" onClick={onSnapshots} title="Snapshots, restore and branching"><Icon.Branch /> <span className="lbl">Branches</span></button>
        <button className="btn accent" onClick={onNewWorld}><Icon.Plus /> New world</button>
        {flash && <span className="tag ok fade-in">{flash}</span>}
      </div>
      <div className="topstats">
        <Stat label="Agents" value={frame?.population ?? '—'} />
        <Stat label="Languages" value={alive} sub={families ? `${families} famil${families === 1 ? 'y' : 'ies'}` : undefined} />
        <Stat label="Success" value={pct(m?.success)} />
        <Stat label="Generation" value={m ? m.meanGeneration.toFixed(1) : '—'} />
      </div>
    </header>
  );
}
