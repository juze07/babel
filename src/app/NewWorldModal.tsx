import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal, Slider } from '../components/ui';
import { useSim } from '../store/store';
import { defaultConfig, WORLD_DESCRIPTIONS, type SimConfig, type WorldType } from '../simulation/core/config';
import { Rng, hash2 } from '../simulation/core/rng';
import { generateTerrain, placeSettlements, computeRoutes } from '../simulation/world/geography';
import { renderTerrain } from '../visualizations/world-map/terrain';
import { download } from '../persistence/db';

const TYPES: WorldType[] = ['archipelago', 'continent', 'valley', 'trading', 'custom'];

function Preview({ cfg }: { cfg: SimConfig }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const wrng = new Rng(hash2(cfg.seed, 0x5eed));
    const { terrain } = generateTerrain(cfg, wrng);
    const S = placeSettlements(cfg, wrng, terrain);
    const { routes } = computeRoutes(cfg, wrng, terrain, S);
    const t = renderTerrain(terrain, 2);
    cv.width = t.width; cv.height = t.height;
    const ctx = cv.getContext('2d')!;
    ctx.drawImage(t, 0, 0);
    for (const r of routes) {
      ctx.beginPath();
      for (let j = 0; j < r.path.length; j += 2) (j ? ctx.lineTo(r.path[j] * 2 + 1, r.path[j + 1] * 2 + 1) : ctx.moveTo(r.path[j] * 2 + 1, r.path[j + 1] * 2 + 1));
      ctx.setLineDash(r.trade ? [5, 3] : [2, 3]);
      ctx.strokeStyle = r.trade ? 'rgba(236,198,120,0.95)' : 'rgba(251,248,242,0.5)';
      ctx.lineWidth = r.trade ? 1.6 : 1;
      ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const s of S) {
      ctx.beginPath(); ctx.arc(s.x * 2 + 1, s.y * 2 + 1, 4, 0, Math.PI * 2);
      ctx.fillStyle = '#fbf8f2'; ctx.fill(); ctx.strokeStyle = '#c0643c'; ctx.lineWidth = 2; ctx.stroke();
    }
  }, [cfg]);
  return <canvas ref={ref} />;
}

export function NewWorldModal({ onClose }: { onClose: () => void }) {
  const current = useSim((s) => s.config);
  const init = useSim((s) => s.init);
  const [cfg, setCfg] = useState<SimConfig>(() => structuredClone(current));
  const set = <K extends keyof SimConfig>(k: K, v: SimConfig[K]) => setCfg((c) => ({ ...c, [k]: v }));
  const setT = (k: keyof SimConfig['traits'], v: number) => setCfg((c) => ({ ...c, traits: { ...c.traits, [k]: v } }));
  const chooseType = (t: WorldType) => setCfg((c) => ({ ...defaultConfig(t, c.seed), traits: c.traits }));
  const previewCfg = useMemo(() => cfg, [cfg.worldType, cfg.seed, cfg.settlements, cfg.regions, cfg.landRatio, cfg.separation, cfg.tradeRoutes]); // eslint-disable-line react-hooks/exhaustive-deps
  const importRef = useRef<HTMLInputElement>(null);

  return (
    <Modal
      title="Create a new world"
      sub="Every run is fully determined by its configuration and random seed. Same seed + same settings = same history."
      onClose={onClose}
      foot={<>
        <input ref={importRef} type="file" accept="application/json" style={{ display: 'none' }} onChange={async (e) => {
          const f = e.target.files?.[0]; if (!f) return;
          try { const c = JSON.parse(await f.text()); setCfg({ ...defaultConfig(c.worldType ?? 'archipelago'), ...c }); } catch { alert('Not a valid BABEL configuration file'); }
        }} />
        <button className="btn ghost" onClick={() => importRef.current?.click()}>Import config…</button>
        <button className="btn ghost" onClick={() => download(`babel-config-${cfg.worldType}-${cfg.seed}.json`, JSON.stringify(cfg, null, 2))}>Export config</button>
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={onClose}>Cancel</button>
        <button className="btn primary" onClick={() => { init(cfg); onClose(); }}>Generate world</button>
      </>}
    >
      <div className="grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', marginBottom: 16 }}>
        {TYPES.map((t) => (
          <button key={t} className={`world-card ${cfg.worldType === t ? 'on' : ''}`} onClick={() => chooseType(t)}>
            <div style={{ fontFamily: 'var(--serif)', fontSize: 15 }}>{WORLD_DESCRIPTIONS[t].title}</div>
            <div className="tiny muted">{WORLD_DESCRIPTIONS[t].blurb}</div>
          </button>
        ))}
      </div>
      <div className="grid" style={{ gridTemplateColumns: '1.3fr 1fr', gap: 20 }}>
        <div className="stack">
          <div className="world-card on" style={{ cursor: 'default' }}><Preview cfg={previewCfg} /></div>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>Random seed
              <input type="number" value={cfg.seed} onChange={(e) => set('seed', Number(e.target.value) | 0)} />
            </label>
            <button className="btn" style={{ alignSelf: 'flex-end' }} onClick={() => set('seed', Math.floor(Math.random() * 99999))}>Shuffle</button>
          </div>
          <div className="callout sage small">Agents start with <b>no words at all</b>. Each has its own memory, learning rate, imitation and innovation tendencies. Language emerges only from their interactions.</div>
        </div>
        <div className="stack">
          <div className="eyebrow">Geography & population</div>
          <Slider label="Settlements" value={cfg.settlements} min={2} max={14} step={1} onChange={(v) => set('settlements', v)} />
          <Slider label="Initial agents per settlement" value={cfg.agentsPerSettlement} min={8} max={60} step={1} onChange={(v) => set('agentsPerSettlement', v)} />
          <Slider label="Population cap" value={cfg.maxPopulation} min={100} max={900} step={10} onChange={(v) => set('maxPopulation', v)} hint="Above ~600 the simulation slows noticeably." />
          {cfg.worldType === 'custom' && (<>
            <Slider label="Regions / islands" value={cfg.regions} min={1} max={7} step={1} onChange={(v) => set('regions', v)} />
            <Slider label="Land amount" value={cfg.landRatio} min={0.1} max={0.9} onChange={(v) => set('landRatio', v)} format={(v) => v.toFixed(2)} />
            <Slider label="Separation between regions" value={cfg.separation} min={0} max={1} onChange={(v) => set('separation', v)} format={(v) => v.toFixed(2)} />
          </>)}
          <Slider label="Contact range" value={cfg.contactRange} min={10} max={150} step={1} onChange={(v) => set('contactRange', v)} hint="How far (in travel cost) people regularly meet. Lower = more isolation." />
          <Slider label="Trade routes" value={cfg.tradeRoutes} min={0} max={10} step={1} onChange={(v) => set('tradeRoutes', v)} />
          <Slider label="Shared ancestral period (years)" value={cfg.initialMixingYears} min={0} max={200} step={5} onChange={(v) => set('initialMixingYears', v)} hint="Populations mix freely at first, then geography separates them — produces a family tree from a common ancestor." />
          <div className="eyebrow" style={{ marginTop: 6 }}>Cognition (population means)</div>
          <Slider label="Innovation" value={cfg.traits.innovation} min={0} max={1} onChange={(v) => setT('innovation', v)} format={(v) => v.toFixed(2)} />
          <Slider label="Imitation" value={cfg.traits.imitation} min={0} max={1} onChange={(v) => setT('imitation', v)} format={(v) => v.toFixed(2)} />
          <Slider label="Learning rate" value={cfg.traits.learningRate} min={0.05} max={1} onChange={(v) => setT('learningRate', v)} format={(v) => v.toFixed(2)} />
          <Slider label="Memory capacity (entries)" value={cfg.traits.memoryCapacity} min={40} max={250} step={5} onChange={(v) => setT('memoryCapacity', v)} />
          <Slider label="Forgetting (per year)" value={cfg.traits.forgetting} min={0} max={0.5} onChange={(v) => setT('forgetting', v)} format={(v) => v.toFixed(2)} />
          <Slider label="Sound-change rate" value={cfg.soundChangeRate} min={0} max={0.15} step={0.005} onChange={(v) => set('soundChangeRate', v)} format={(v) => v.toFixed(3)} />
        </div>
      </div>
    </Modal>
  );
}
