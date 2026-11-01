import { useState } from 'react';
import { useQuery } from '../hooks/useQuery';
import { useSim } from '../store/store';
import type { historyView } from '../simulation/engine/views';
import type { MetricDef, MetricSample } from '../simulation/metrics/metrics';
import { Panel, Empty, Tabs } from '../components/ui';
import { LineChart, StackedArea, ORDER_COLORS, PALETTE } from '../visualizations/charts/Charts';
import { Icon } from '../components/icons';
import { download } from '../persistence/db';
import { pct } from '../utils/format';

type H = ReturnType<typeof historyView>;
const GROUPS = ['Communication', 'Vocabulary', 'Grammar', 'Phonology', 'Evolution', 'Population'] as const;

export function Metrics() {
  const { data } = useQuery<H>('history', undefined, 2500);
  const config = useSim((s) => s.config);
  const [group, setGroup] = useState<(typeof GROUPS)[number]>('Communication');
  if (!data) return <Empty>Loading metrics…</Empty>;
  const S = data.samples;
  const x = S.map((s) => s.year);
  const defs = data.defs.filter((d) => d.group === group);
  const exportCsv = () => {
    const keys = data.defs.map((d) => d.key);
    const head = ['year', 'tick', ...keys, ...data.orders.map((o) => `order_${o}`), ...data.gram.map((g) => `marker_${g}`)];
    const rows = S.map((s) => [s.year, s.tick, ...keys.map((k) => s[k]), ...s.order, ...s.markerUse].join(','));
    download(`babel-metrics-${config.worldType}-seed${config.seed}.csv`, [head.join(','), ...rows].join('\n'), 'text/csv');
  };
  return (
    <div className="stack fade-in" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Metrics</div>
          <h1>Measuring emergence</h1>
          <p>Every indicator has an explicit formula. <span className="tag direct">direct measure</span> marks exact properties of the simulated system; <span className="tag proxy">proxy</span> marks rough operationalisations of richer linguistic notions. Samples are taken every {config.analysisInterval / 4} years.</p>
        </div>
        <button className="btn" onClick={exportCsv} disabled={!S.length}><Icon.Download /> Export CSV</button>
      </div>
      {S.length < 2 ? <Empty>Run the simulation for a few years to collect history.</Empty> : (
        <>
          <Tabs value={group} onChange={setGroup} tabs={GROUPS.map((g) => ({ v: g, label: g }))} />
          {group === 'Grammar' && <GrammarCharts S={S} x={x} orders={data.orders} gram={data.gram} />}
          {group === 'Communication' && (
            <Panel title="Communication overview" eyebrow="Success vs chance">
              <LineChart x={x} percent yMax={1} height={180} series={[
                { key: 's', label: 'Success (with repair)', color: PALETTE[1], values: S.map((s) => s.success) },
                { key: 'f', label: 'First-attempt success', color: PALETTE[0], values: S.map((s) => s.firstTry) },
                { key: 'c', label: 'Cross-settlement success', color: PALETTE[3], values: S.map((s) => s.crossSuccess) },
                { key: 'g', label: 'Gesture reliance', color: PALETTE[2], values: S.map((s) => s.gestureRate), dashed: true },
                { key: 'chance', label: `Chance (1/${config.contextSize})`, color: '#9c8f7a', values: S.map(() => 1 / config.contextSize), dashed: true },
              ]} />
            </Panel>
          )}
          <div className="grid cols-2">
            {defs.map((d) => <MetricCard key={d.key} d={d} x={x} S={S} />)}
          </div>
        </>
      )}
    </div>
  );
}

function MetricCard({ d, x, S }: { d: MetricDef; x: number[]; S: MetricSample[] }) {
  const vals = S.map((s) => s[d.key] as number);
  const last = vals[vals.length - 1];
  const fmt = (v: number) => (d.unit === '%' ? pct(v) : Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2));
  return (
    <Panel title={<span className="row" style={{ gap: 8 }}>{d.label} <span className={`tag ${d.kind}`}>{d.kind === 'direct' ? 'direct' : 'proxy'}</span></span>} right={<span className="stat"><span className="v" style={{ fontSize: 18 }}>{fmt(last)}</span></span>}>
      <LineChart x={x} series={[{ key: d.key, label: d.label, color: d.kind === 'direct' ? '#2d4a5c' : '#c0643c', values: vals }]} percent={d.unit === '%'} yMax={d.unit === '%' ? 1 : undefined} height={120} />
      <div className="metric-def">
        <div><span className="eyebrow">Formula</span> <code>{d.formula}</code></div>
        <div><span className="eyebrow">Meaning</span> {d.meaning}</div>
        <div><span className="eyebrow">Limitation</span> {d.limits}</div>
      </div>
    </Panel>
  );
}

function GrammarCharts({ S, x, orders, gram }: { S: MetricSample[]; x: number[]; orders: readonly string[]; gram: readonly string[] }) {
  return (
    <div className="grid cols-2">
      <Panel title="Basic word order across the population" eyebrow="Share of adults by dominant order">
        <StackedArea x={x} height={170} layers={orders.map((o, i) => ({ label: o, color: ORDER_COLORS[o], values: S.map((s) => s.order[i] ?? 0) }))} />
      </Panel>
      <Panel title="Grammatical markers in use" eyebrow="Share of adults with a usable marker for each meaning">
        <LineChart x={x} percent yMax={1} height={170} series={gram.map((g, i) => ({ key: g, label: g, color: PALETTE[i % PALETTE.length], values: S.map((s) => s.markerUse[i] ?? 0) }))} />
      </Panel>
    </div>
  );
}
