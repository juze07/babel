import { useEffect, useMemo, useState } from 'react';
import { useLab, type Condition, type Expectation, type ExperimentRecord } from '../store/labStore';
import { defaultConfig, WORLD_DESCRIPTIONS, type SimConfig, type WorldType } from '../simulation/core/config';
import { METRIC_DEFS, type MetricKey } from '../simulation/metrics/metrics';
import type { RunResult } from '../workers/experiment.worker';
import type { SimSnapshot } from '../simulation/engine/simulation';
import { Panel, Slider, Seg, InfoTip } from '../components/ui';
import { LineChart, PALETTE } from '../visualizations/charts/Charts';
import { Icon } from '../components/icons';
import { db, download, type SnapshotMeta } from '../persistence/db';
import { pct } from '../utils/format';

type Knob = { key: string; label: string; min: number; max: number; step: number; trait?: boolean; fmt?: (v: number) => string };
const KNOBS: Record<string, Knob> = {
  externalContact: { key: 'externalContact', label: 'Contact between settlements', min: 0, max: 0.6, step: 0.01 },
  migrationRate: { key: 'migrationRate', label: 'Migration rate (per agent-year)', min: 0, max: 0.04, step: 0.001, fmt: (v) => v.toFixed(3) },
  contactRange: { key: 'contactRange', label: 'Contact range (travel cost scale)', min: 5, max: 150, step: 1, fmt: (v) => v.toFixed(0) },
  tradeRoutes: { key: 'tradeRoutes', label: 'Trade routes', min: 0, max: 8, step: 1, fmt: (v) => v.toFixed(0) },
  tradeStrength: { key: 'tradeStrength', label: 'Trade intensity', min: 0, max: 1.5, step: 0.05 },
  innovation: { key: 'innovation', label: 'Innovation tendency', min: 0, max: 1, step: 0.01, trait: true },
  imitation: { key: 'imitation', label: 'Imitation tendency', min: 0, max: 1, step: 0.01, trait: true },
  memoryCapacity: { key: 'memoryCapacity', label: 'Memory capacity (entries)', min: 40, max: 260, step: 5, trait: true, fmt: (v) => v.toFixed(0) },
  learningRate: { key: 'learningRate', label: 'Learning efficiency', min: 0.05, max: 1, step: 0.01, trait: true },
  forgetting: { key: 'forgetting', label: 'Forgetting (per year)', min: 0, max: 0.5, step: 0.01, trait: true },
};

interface Preset {
  id: string; letter: string; name: string; question: string; world: WorldType; years: number; knobs: string[];
  conditions: Condition[]; metrics: MetricKey[]; expectations: Expectation[];
}
const c = (id: string, label: string, params: Partial<SimConfig> = {}, traits: Partial<SimConfig['traits']> = {}): Condition => ({ id, label, params, traits });

const PRESETS: Preset[] = [
  {
    id: 'A', letter: 'A', name: 'Geographic isolation', world: 'archipelago', years: 150,
    question: 'Two populations in separate regions: do their languages drift apart when nobody travels between them?',
    knobs: ['externalContact', 'migrationRate', 'contactRange'],
    conditions: [c('iso', 'Isolated regions', { externalContact: 0.01, migrationRate: 0, contactRange: 12 }), c('con', 'Connected regions', { externalContact: 0.3, migrationRate: 0.008, contactRange: 90 })],
    metrics: ['languages', 'divergence', 'intelligibility', 'crossSuccess'],
    expectations: [
      { metric: 'divergence', higher: 'iso', lower: 'con', text: 'Isolated regions diverge lexically more than connected ones.' },
      { metric: 'languages', higher: 'iso', lower: 'con', text: 'Isolation yields more distinct languages.' },
      { metric: 'intelligibility', higher: 'con', lower: 'iso', text: 'Connected communities remain more mutually intelligible.' },
    ],
  },
  {
    id: 'B', letter: 'B', name: 'Population mixing', world: 'continent', years: 150,
    question: 'Let separate populations migrate and interact: how much vocabulary and grammar is exchanged?',
    knobs: ['migrationRate', 'externalContact'],
    conditions: [c('none', 'No migration', { migrationRate: 0, externalContact: 0.05 }), c('some', 'Moderate migration', { migrationRate: 0.006, externalContact: 0.2 }), c('high', 'Heavy mixing', { migrationRate: 0.025, externalContact: 0.45 })],
    metrics: ['borrowings', 'intelligibility', 'languages', 'orderEntropy'],
    expectations: [
      { metric: 'intelligibility', higher: 'high', lower: 'none', text: 'Heavy mixing keeps communities more intelligible to each other.' },
      { metric: 'languages', higher: 'none', lower: 'high', text: 'Mixing reduces the number of languages.' },
      { metric: 'orderEntropy', higher: 'none', lower: 'high', text: 'Mixing homogenises basic word order across the population.' },
    ],
  },
  {
    id: 'C', letter: 'C', name: 'Innovation vs imitation', world: 'valley', years: 120,
    question: 'Populations with different innovation and imitation tendencies: diverse or standardised languages?',
    knobs: ['innovation', 'imitation'],
    conditions: [c('innov', 'Innovators', {}, { innovation: 0.8, imitation: 0.25 }), c('base', 'Baseline'), c('imit', 'Imitators', {}, { innovation: 0.12, imitation: 0.9 })],
    metrics: ['lexDiversity', 'sharedVocab', 'synonymy', 'firstTry'],
    expectations: [
      { metric: 'lexDiversity', higher: 'innov', lower: 'imit', text: 'Innovators sustain more competing words (higher lexical diversity).' },
      { metric: 'sharedVocab', higher: 'imit', lower: 'innov', text: 'Imitators standardise more of their vocabulary.' },
      { metric: 'synonymy', higher: 'innov', lower: 'imit', text: 'Innovators carry more synonyms per concept.' },
    ],
  },
  {
    id: 'D', letter: 'D', name: 'Generational learning', world: 'valley', years: 150,
    question: 'Change memory capacity and learning efficiency: how does information loss affect transmission?',
    knobs: ['memoryCapacity', 'learningRate', 'forgetting'],
    conditions: [c('low', 'Poor learners', {}, { memoryCapacity: 55, learningRate: 0.25, forgetting: 0.3 }), c('base', 'Baseline'), c('high', 'Strong learners', {}, { memoryCapacity: 220, learningRate: 0.8, forgetting: 0.03 })],
    metrics: ['transmission', 'coverage', 'success', 'replacement'],
    expectations: [
      { metric: 'transmission', higher: 'high', lower: 'low', text: 'Strong learners transmit vocabulary across generations more faithfully.' },
      { metric: 'coverage', higher: 'high', lower: 'low', text: 'Information loss shrinks the meaning space speakers can express.' },
      { metric: 'replacement', higher: 'low', lower: 'high', text: 'Extreme forgetting makes vocabulary less stable (more turnover).' },
    ],
  },
  {
    id: 'E', letter: 'E', name: 'Contact and borrowing', world: 'trading', years: 150,
    question: 'Introduce trade connections between linguistically different populations: borrowing and intelligibility.',
    knobs: ['tradeRoutes', 'tradeStrength', 'externalContact'],
    conditions: [c('notrade', 'No trade', { tradeRoutes: 0, tradeStrength: 0 }), c('trade', 'Trade network', { tradeRoutes: 6, tradeStrength: 1.2 })],
    metrics: ['borrowings', 'intelligibility', 'crossSuccess', 'divergence'],
    expectations: [
      { metric: 'borrowings', higher: 'trade', lower: 'notrade', text: 'Trade contact increases lexical borrowing.' },
      { metric: 'crossSuccess', higher: 'trade', lower: 'notrade', text: 'Traders’ communities understand each other better.' },
      { metric: 'divergence', higher: 'notrade', lower: 'trade', text: 'Trade slows lexical divergence.' },
    ],
  },
];

const SCALES = { small: { label: 'Fast (≈60%)', f: 0.6 }, standard: { label: 'Standard', f: 1 } } as const;

export function Lab() {
  const lab = useLab();
  const [presetId, setPresetId] = useState('A');
  useEffect(() => { lab.reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="stack fade-in" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Experiment laboratory</div>
          <h1>Controlled experiments</h1>
          <p>Run conditions × random seeds headlessly in parallel Web Workers, compare averaged trajectories, test qualitative expectations, save results in your browser and export datasets. Branch from a saved snapshot to explore alternative futures from identical starting conditions.</p>
        </div>
      </div>
      <div className="preset-row">
        {PRESETS.map((p) => (
          <button key={p.id} className={`world-card ${presetId === p.id ? 'on' : ''}`} onClick={() => setPresetId(p.id)} disabled={lab.running}>
            <div className="row" style={{ gap: 8 }}><span className="letter">{p.letter}</span><b style={{ fontFamily: 'var(--serif)', fontSize: 14 }}>{p.name}</b></div>
            <span className="tiny muted">{p.question}</span>
          </button>
        ))}
      </div>
      <Designer key={presetId} preset={PRESETS.find((p) => p.id === presetId)!} />
      {lab.current && <Results exp={lab.current} />}
      <Saved />
    </div>
  );
}

function Designer({ preset }: { preset: Preset }) {
  const lab = useLab();
  const [conds, setConds] = useState<Condition[]>(() => preset.conditions.map((x) => ({ ...x, params: { ...x.params }, traits: { ...x.traits } })));
  const [years, setYears] = useState(preset.years);
  const [nSeeds, setNSeeds] = useState(3);
  const [seed0, setSeed0] = useState(100);
  const [world, setWorld] = useState<WorldType>(preset.world);
  const [scale, setScale] = useState<keyof typeof SCALES>('small');
  const [snaps, setSnaps] = useState<SnapshotMeta[]>([]);
  const [branch, setBranch] = useState('');
  useEffect(() => { db.listSnapshots().then((l) => setSnaps(l.sort((a, b) => b.created - a.created))); }, []);
  const base = (seed: number): SimConfig => {
    const b = defaultConfig(world, seed);
    const f = SCALES[scale].f;
    return { ...b, agentsPerSettlement: Math.max(12, Math.round(b.agentsPerSettlement * f)), maxPopulation: Math.round(b.maxPopulation * f) };
  };
  const value = (cd: Condition, k: Knob) => {
    const d = base(1);
    return k.trait ? (cd.traits as Record<string, number>)[k.key] ?? (d.traits as unknown as Record<string, number>)[k.key] : (cd.params as Record<string, number>)[k.key] ?? (d as unknown as Record<string, number>)[k.key];
  };
  const setV = (i: number, k: Knob, v: number) => setConds((cs) => cs.map((cd, j) => j !== i ? cd : k.trait ? { ...cd, traits: { ...cd.traits, [k.key]: v } } : { ...cd, params: { ...cd.params, [k.key]: v } }));
  const seeds = Array.from({ length: nSeeds }, (_, i) => seed0 + i);
  const totalRuns = conds.length * nSeeds;
  const run = async () => {
    const snapMeta = snaps.find((s) => s.id === branch);
    const snapshot = snapMeta ? await db.loadSnapshot(snapMeta.id) : undefined;
    lab.start({
      id: `exp-${Date.now().toString(36)}`, name: `${preset.letter}. ${preset.name}${snapMeta ? ` (branch of ${snapMeta.label})` : ''}`, preset: preset.id,
      world: snapMeta ? (snapMeta.world as WorldType) : world, years, seeds, conditions: conds, expectations: preset.expectations,
      branchFrom: snapMeta ? { id: snapMeta.id, label: snapMeta.label, year: snapMeta.year } : null,
    }, base, (snapshot ?? undefined) as SimSnapshot | undefined);
  };
  return (
    <Panel title={`Experiment ${preset.letter}: ${preset.name}`} eyebrow="Design" right={<span className="tiny muted">{totalRuns} runs × {years} years</span>}>
      <div className="lab-design">
        <div className="stack">
          <label className="field">World type
            <select value={world} onChange={(e) => setWorld(e.target.value as WorldType)} disabled={!!branch}>
              {(['archipelago', 'continent', 'valley', 'trading'] as WorldType[]).map((w) => <option key={w} value={w}>{WORLD_DESCRIPTIONS[w].title}</option>)}
            </select>
          </label>
          <Slider label="Years per run" value={years} min={20} max={400} step={10} onChange={setYears} format={(v) => `${v}`} />
          <Slider label="Seeds per condition" value={nSeeds} min={1} max={8} step={1} onChange={setNSeeds} format={(v) => `${v}`} hint={`Seeds ${seeds.join(', ')}`} />
          <label className="field">First seed<input type="number" value={seed0} onChange={(e) => setSeed0(Number(e.target.value) || 1)} /></label>
          <label className="field">Population scale<Seg value={scale} onChange={setScale} options={Object.entries(SCALES).map(([k, v]) => ({ v: k as keyof typeof SCALES, label: v.label }))} /></label>
          <label className="field"><span className="row" style={{ gap: 4 }}>Branch from snapshot <InfoTip def="Every run starts from the exact saved state (all agents, their lexicons, history). Each condition’s parameters are applied at that moment, and each seed gives an alternative future from identical starting conditions." /></span>
            <select value={branch} onChange={(e) => setBranch(e.target.value)}>
              <option value="">— fresh worlds (no branch) —</option>
              {snaps.map((s) => <option key={s.id} value={s.id}>{s.label} · {s.world} y{s.year}</option>)}
            </select>
          </label>
        </div>
        <div className="cond-grid" style={{ gridTemplateColumns: `repeat(${conds.length}, minmax(0, 1fr))` }}>
          {conds.map((cd, i) => (
            <div key={cd.id} className="cond">
              <div className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: PALETTE[i], borderRadius: '50%' }} /><input type="text" value={cd.label} onChange={(e) => setConds((cs) => cs.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} style={{ flex: 1, fontFamily: 'var(--serif)' }} /></div>
              {preset.knobs.map((kk) => { const k = KNOBS[kk]; return <Slider key={kk} label={k.label} value={value(cd, k)} min={k.min} max={k.max} step={k.step} onChange={(v) => setV(i, k, v)} format={k.fmt ?? ((v) => v.toFixed(2))} />; })}
            </div>
          ))}
        </div>
      </div>
      <div className="callout sage" style={{ marginTop: 12 }}>
        <b>Testable expectations</b> (qualitative predictions, not guaranteed outcomes):
        <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{preset.expectations.map((e, i) => <li key={i}>{e.text}</li>)}</ul>
      </div>
      <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end' }}>
        {lab.running ? <button className="btn" onClick={lab.cancel}><Icon.X /> Cancel</button> : <button className="btn accent" onClick={run}><Icon.Play /> Run {totalRuns} simulations</button>}
      </div>
    </Panel>
  );
}

/* ---------------- results ---------------- */
const finalValue = (r: RunResult, k: MetricKey) => {
  const s = r.samples.slice(-3);
  return s.length ? s.reduce((a, x) => a + (x[k] as number), 0) / s.length : NaN;
};
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
const sd = (a: number[]) => { const m = mean(a); return Math.sqrt(mean(a.map((x) => (x - m) ** 2))); };

function Results({ exp }: { exp: ExperimentRecord }) {
  const lab = useLab();
  const preset = PRESETS.find((p) => p.id === exp.preset);
  const [metric, setMetric] = useState<MetricKey>(preset?.metrics[0] ?? 'success');
  const [showSeeds, setShowSeeds] = useState(true);
  const total = exp.conditions.length * exp.seeds.length;
  const def = METRIC_DEFS.find((d) => d.key === metric)!;
  const byCond = exp.conditions.map((cd) => exp.results.filter((r) => r.condition === cd.id));
  const fmt = (v: number) => (Number.isNaN(v) ? '—' : def?.unit === '%' ? pct(v) : v.toFixed(2));
  const series = useMemo(() => {
    const out: { key: string; label: string; color: string; values: (number | null)[]; dashed?: boolean }[] = [];
    const xs = new Set<number>();
    exp.results.forEach((r) => r.samples.forEach((s) => xs.add(Math.round(s.year))));
    const x = [...xs].sort((a, b) => a - b);
    exp.conditions.forEach((cd, ci) => {
      const runs = byCond[ci];
      if (!runs.length) return;
      const at = (r: RunResult, yr: number) => { const s = r.samples.find((q) => Math.round(q.year) === yr); return s ? (s[metric] as number) : null; };
      out.push({ key: cd.id, label: `${cd.label} (mean)`, color: PALETTE[ci], values: x.map((yr) => { const v = runs.map((r) => at(r, yr)).filter((q): q is number => q !== null); return v.length ? mean(v) : null; }) });
      if (showSeeds) runs.forEach((r) => out.push({ key: r.runId, label: `seed ${r.seed}`, color: PALETTE[ci] + '55', values: x.map((yr) => at(r, yr)), dashed: true }));
    });
    return { x, out };
  }, [exp, metric, showSeeds]); // eslint-disable-line react-hooks/exhaustive-deps
  const exportJson = () => download(`babel-${exp.id}.json`, JSON.stringify(exp));
  const exportCsv = () => {
    const keys = METRIC_DEFS.map((d) => d.key);
    const rows = exp.results.flatMap((r) => r.samples.map((s) => [exp.id, r.condition, JSON.stringify(exp.conditions.find((cd) => cd.id === r.condition)?.label ?? ''), r.seed, s.year, ...keys.map((k) => s[k])].join(',')));
    download(`babel-${exp.id}.csv`, [['experiment', 'condition', 'label', 'seed', 'year', ...keys].join(','), ...rows].join('\n'), 'text/csv');
  };
  return (
    <Panel title={exp.name} eyebrow={`${exp.status === 'running' ? 'Running' : exp.status === 'cancelled' ? 'Cancelled' : 'Results'} · ${exp.results.length}/${total} runs · ${WORLD_DESCRIPTIONS[exp.world]?.title ?? exp.world}${exp.branchFrom ? ` · branched from “${exp.branchFrom.label}” (year ${exp.branchFrom.year})` : ''}`}
      right={<div className="row"><button className="btn sm" onClick={exportCsv} disabled={!exp.results.length}><Icon.Download /> CSV</button><button className="btn sm" onClick={exportJson} disabled={!exp.results.length}><Icon.Download /> JSON</button></div>}>
      {exp.status === 'running' && (
        <div className="run-grid">
          {Object.entries(lab.progress).map(([id, f]) => (
            <div key={id} className="tiny"><div className="row between"><span className="mono">{id}</span><span className="mono muted">{Math.round(f * 100)}%</span></div><div className="progress"><i style={{ width: `${f * 100}%` }} /></div></div>
          ))}
        </div>
      )}
      {lab.error && <div className="callout" style={{ borderColor: 'var(--danger)' }}><b>Error:</b> <span className="mono tiny">{lab.error}</span></div>}
      {exp.results.length > 0 && (
        <>
          <div className="row between" style={{ margin: '10px 0' }}>
            <select value={metric} onChange={(e) => setMetric(e.target.value as MetricKey)}>
              {preset && <optgroup label="Key metrics">{preset.metrics.map((k) => <option key={k} value={k}>{METRIC_DEFS.find((d) => d.key === k)?.label}</option>)}</optgroup>}
              <optgroup label="All metrics">{METRIC_DEFS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}</optgroup>
            </select>
            <label className="tiny row" style={{ gap: 4 }}><input type="checkbox" checked={showSeeds} onChange={(e) => setShowSeeds(e.target.checked)} /> show individual seeds</label>
          </div>
          <LineChart x={series.x} series={series.out} percent={def?.unit === '%'} yMax={def?.unit === '%' ? 1 : undefined} height={220} />
          <div className="tiny muted" style={{ margin: '6px 0 12px' }}><span className={`tag ${def.kind}`}>{def.kind}</span> <code className="mono">{def.formula}</code></div>
          <div className="grid cols-2">
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Final values (mean of last 3 samples; mean ± sd across seeds)</div>
              <table className="t">
                <thead><tr><th>Metric</th>{exp.conditions.map((cd, i) => <th key={cd.id}><span className="swatch" style={{ background: PALETTE[i], marginRight: 4 }} />{cd.label}</th>)}</tr></thead>
                <tbody>
                  {(preset?.metrics ?? ['success', 'languages'] as MetricKey[]).concat(['languages', 'success'].filter((k) => !preset?.metrics.includes(k as MetricKey)) as MetricKey[]).map((k) => {
                    const d = METRIC_DEFS.find((x) => x.key === k)!;
                    const f = (v: number) => (d.unit === '%' ? pct(v) : v.toFixed(2));
                    return (
                      <tr key={k} className="clickable" onClick={() => setMetric(k)}>
                        <td className="small">{d.label}</td>
                        {byCond.map((runs, i) => { const v = runs.map((r) => finalValue(r, k)); return <td key={i} className="mono tiny">{v.length ? `${f(mean(v))} ± ${f(sd(v))}` : '—'}</td>; })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Expectations vs outcome</div>
              {exp.expectations.map((e, i) => <ExpectationRow key={i} e={e} exp={exp} fmt={fmt} />)}
              <p className="tiny muted">“Supported” means the condition means differ in the predicted direction; “consistent across seeds” means every seed pairing agrees. With few seeds these are indications, not statistical tests.</p>
            </div>
          </div>
        </>
      )}
    </Panel>
  );
}

function ExpectationRow({ e, exp, fmt }: { e: Expectation; exp: ExperimentRecord; fmt: (v: number) => string }) {
  void fmt;
  const k = e.metric as MetricKey;
  const hi = exp.results.filter((r) => r.condition === e.higher), lo = exp.results.filter((r) => r.condition === e.lower);
  const d = METRIC_DEFS.find((x) => x.key === k);
  if (!hi.length || !lo.length) return <div className="small" style={{ marginBottom: 6 }}>{e.text} <span className="tag">pending</span></div>;
  const mh = mean(hi.map((r) => finalValue(r, k))), ml = mean(lo.map((r) => finalValue(r, k)));
  const pairs = hi.flatMap((h) => lo.filter((l) => l.seed === h.seed).map((l) => finalValue(h, k) > finalValue(l, k)));
  const supported = mh > ml;
  const consistent = pairs.length > 0 && pairs.every((p) => p === supported);
  const f = (v: number) => (d?.unit === '%' ? pct(v) : v.toFixed(2));
  return (
    <div className="small" style={{ marginBottom: 8 }}>
      <div>{e.text}</div>
      <div className="row" style={{ gap: 6, marginTop: 2 }}>
        <span className={`tag ${supported ? 'ok' : 'bad'}`}>{supported ? 'supported' : 'not supported'}</span>
        {supported && <span className="tag">{consistent ? 'consistent across seeds' : 'mixed across seeds'}</span>}
        <span className="mono tiny muted">{f(mh)} vs {f(ml)}</span>
      </div>
    </div>
  );
}

function Saved() {
  const lab = useLab();
  const [cmp, setCmp] = useState<string[]>([]);
  if (!lab.saved.length) return null;
  const compare = () => {
    const exps = lab.saved.filter((e) => cmp.includes(e.id));
    if (exps.length < 2) return;
    // merge: each (experiment, condition) becomes a condition of a virtual comparison
    const conditions: Condition[] = exps.flatMap((e) => e.conditions.map((cd) => ({ ...cd, id: `${e.id}:${cd.id}`, label: `${e.name.split(' (')[0]} – ${cd.label}` })));
    const results = exps.flatMap((e) => e.results.map((r) => ({ ...r, condition: `${e.id}:${r.condition}`, runId: `${e.id}:${r.runId}` })));
    lab.open({ id: `cmp-${Date.now().toString(36)}`, name: `Comparison of ${exps.length} experiments`, preset: exps[0].preset, created: Date.now(), world: exps[0].world, years: Math.max(...exps.map((e) => e.years)), seeds: [...new Set(exps.flatMap((e) => e.seeds))], conditions, expectations: [], results, status: 'done' });
  };
  return (
    <Panel title="Saved experiments" eyebrow="Stored in this browser (IndexedDB)" right={<button className="btn sm" disabled={cmp.length < 2 || lab.running} onClick={compare}>Compare selected ({cmp.length})</button>}>
      <table className="t">
        <thead><tr><th /><th>Experiment</th><th>World</th><th>Runs</th><th>Years</th><th>Saved</th><th /></tr></thead>
        <tbody>
          {lab.saved.map((e) => (
            <tr key={e.id}>
              <td><input type="checkbox" checked={cmp.includes(e.id)} onChange={(ev) => setCmp((c) => ev.target.checked ? [...c, e.id] : c.filter((x) => x !== e.id))} /></td>
              <td style={{ fontFamily: 'var(--serif)' }}>{e.name}</td>
              <td className="small">{WORLD_DESCRIPTIONS[e.world]?.title ?? e.world}</td>
              <td className="num">{e.results.length}</td>
              <td className="num">{e.years}</td>
              <td className="tiny muted">{new Date(e.created).toLocaleString()}</td>
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <button className="btn sm" disabled={lab.running} onClick={() => lab.open(e)}>Open</button>{' '}
                <button className="btn sm ghost" onClick={() => lab.remove(e.id)}><Icon.Trash /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}
