import { useState } from 'react';
import { useSim } from '../store/store';
import { WorldMap } from '../visualizations/world-map/WorldMap';
import { LangChip, Stat, Bar, Empty } from '../components/ui';
import { useQuery } from '../hooks/useQuery';
import { pct, EVENT_COLORS, EVENT_LABELS, cap } from '../utils/format';
import type { AgentView } from '../simulation/engine/views';
import { METRIC_DEFS } from '../simulation/metrics/metrics';
import { Sparkline } from '../visualizations/charts/Charts';
import { Icon } from '../components/icons';
import { simClient } from '../store/simClient';

const def = (k: string) => METRIC_DEFS.find((d) => d.key === k);

export function Observatory() {
  const frame = useSim((s) => s.frame);
  const selection = useSim((s) => s.selection);
  const [tradePick, setTradePick] = useState<number[] | null>(null);
  const intervene = useSim((s) => s.intervene);

  return (
    <div className="obs">
      <WorldMap
        pickMode={tradePick ? 'trade' : null}
        onPickSettlement={(id) => {
          if (!tradePick) return;
          const next = [...tradePick, id];
          if (next.length === 2) { if (next[0] !== next[1]) intervene({ kind: 'addTrade', a: next[0], b: next[1] }); setTradePick(null); }
          else setTradePick(next);
        }}
      />
      <aside className="side">
        {selection ? <SelectionPanel onTrade={() => setTradePick([])} /> : <Overview onTrade={() => setTradePick([])} />}
        <section>
          <div className="row between" style={{ marginBottom: 6 }}>
            <h3>Chronicle</h3>
            <span className="tiny muted">{frame?.events.length ?? 0} recent events</span>
          </div>
          <EventList />
        </section>
      </aside>
    </div>
  );
}

function Overview({ onTrade }: { onTrade: () => void }) {
  const frame = useSim((s) => s.frame);
  const { data: hist } = useQuery<{ samples: { success: number; languages: number; population: number; year: number }[] }>('history', undefined, 4000);
  if (!frame) return null;
  const m = frame.metrics;
  const alive = frame.langs.filter((l) => l.fate === 'alive').sort((a, b) => b.speakers - a.speakers);
  const s = hist?.samples ?? [];
  return (
    <>
      <section>
        <div className="eyebrow">Observatory</div>
        <h2 style={{ marginTop: 2 }}>{frame.mixing ? 'Ancestral period' : alive.length ? `${alive.length} living language${alive.length > 1 ? 's' : ''}` : 'Before language'}</h2>
        <p className="small muted" style={{ margin: '4px 0 12px' }}>
          {frame.tick === 0 ? 'Press Start. Agents begin with gestures and no words; watch vocabularies form, spread and split.' : alive.length ? 'Language regions are inferred from measured mutual intelligibility, not assigned.' : 'Agents are still inventing and negotiating words. No community has a stable convention yet.'}
        </p>
        <div className="grid cols-2" style={{ gap: 12 }}>
          <div><Stat label="Success" value={pct(m?.success)} info={def('success')} /><Sparkline values={s.map((x) => x.success)} max={1} width={130} /></div>
          <div><Stat label="First-try" value={pct(m?.firstTry)} info={def('firstTry')} /></div>
          <Stat label="Shared vocabulary" value={pct(m?.sharedVocab)} info={def('sharedVocab')} />
          <Stat label="Gesture reliance" value={pct(m?.gestureRate)} info={def('gestureRate')} />
          <Stat label="Intelligibility" value={pct(m?.intelligibility)} info={def('intelligibility')} />
          <Stat label="Families" value={m?.families ?? 0} info={def('families')} />
        </div>
      </section>
      <section>
        <div className="row between" style={{ marginBottom: 8 }}><h3>Languages</h3><span className="tiny muted">speakers</span></div>
        {!alive.length && <div className="small muted">None identified yet.</div>}
        <div className="stack" style={{ gap: 7 }}>
          {alive.map((l) => (
            <div key={l.id} className="row between">
              <LangChip lang={l} />
              <div className="row" style={{ gap: 8 }}>
                <span className="tag">{l.order}</span>
                <span className="mono small" style={{ width: 32, textAlign: 'right' }}>{l.speakers}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
      <section>
        <h3 style={{ marginBottom: 8 }}>Intervene</h3>
        <div className="small muted" style={{ marginBottom: 8 }}>Click a settlement or a route on the map for targeted actions (migration, epidemic, isolation, cutting routes).</div>
        <div className="row wrap">
          <button className="btn sm" onClick={onTrade}><Icon.Plus /> Open a trade route</button>
          <GlobalParams />
        </div>
      </section>
    </>
  );
}

function GlobalParams() {
  const config = useSim((s) => s.config);
  const intervene = useSim((s) => s.intervene);
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({ contactRange: config.contactRange, innovation: config.traits.innovation, imitation: config.traits.imitation, soundChangeRate: config.soundChangeRate, migrationRate: config.migrationRate });
  if (!open) return <button className="btn sm" onClick={() => setOpen(true)}><Icon.Settings /> Change conditions…</button>;
  return (
    <div className="panel flat" style={{ padding: 10, width: '100%' }}>
      {([['contactRange', 'Contact range', 10, 150, 1], ['migrationRate', 'Migration rate', 0, 0.05, 0.001], ['soundChangeRate', 'Sound-change rate', 0, 0.15, 0.005], ['innovation', 'Innovation (all agents)', 0, 1, 0.01], ['imitation', 'Imitation (all agents)', 0, 1, 0.01]] as const).map(([k, label, min, max, step]) => (
        <label key={k} className="field" style={{ marginBottom: 6 }}>
          <span className="row between"><span>{label}</span><span className="mono">{v[k]}</span></span>
          <input type="range" min={min} max={max} step={step} value={v[k]} onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })} />
        </label>
      ))}
      <div className="row">
        <button className="btn sm primary" onClick={() => { intervene({ kind: 'params', params: { contactRange: v.contactRange, soundChangeRate: v.soundChangeRate, migrationRate: v.migrationRate, traits: { ...config.traits, innovation: v.innovation, imitation: v.imitation } } }); setOpen(false); }}>Apply now</button>
        <button className="btn sm ghost" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </div>
  );
}

function SelectionPanel({ onTrade }: { onTrade: () => void }) {
  const selection = useSim((s) => s.selection)!;
  const select = useSim((s) => s.select);
  return (
    <section className="fade-in">
      <div className="row between">
        <div className="eyebrow">{cap(selection.kind)}</div>
        <button className="btn sm ghost" onClick={() => select(null)}><Icon.X /> Close</button>
      </div>
      {selection.kind === 'settlement' && <SettlementCard id={selection.id} onTrade={onTrade} />}
      {selection.kind === 'agent' && <AgentCard id={selection.id} />}
      {selection.kind === 'route' && <RouteCard id={selection.id} />}
    </section>
  );
}

type SettlementData = { id: number; name: string; pop: number; capacity: number; food: number; climate: number; lang: number; langName: string | null; isolated: boolean; ages: number[]; biome: Record<string, number>; lect: { selfIntel: number; mixed: number; order: string; core: { concept: string; form: string | null; share: number }[] } | null; contacts: { id: number; name: string; w: number }[]; residents: { id: number; age: number; lex: number }[] };

function SettlementCard({ id, onTrade }: { id: number; onTrade: () => void }) {
  const { data } = useQuery<SettlementData>('settlement', id, 1200);
  const frame = useSim((s) => s.frame);
  const intervene = useSim((s) => s.intervene);
  const select = useSim((s) => s.select);
  const [migTo, setMigTo] = useState(-1);
  const [count, setCount] = useState(8);
  if (!data) return <Empty>Loading…</Empty>;
  const lang = frame?.langs.find((l) => l.id === data.lang);
  const biomes = Object.entries(data.biome).filter(([, v]) => v > 0.04).sort((a, b) => b[1] - a[1]);
  return (
    <div className="stack">
      <h2>{data.name}</h2>
      <div className="row wrap"><LangChip lang={lang} />{data.isolated && <span className="tag bad">isolated</span>}{data.lect && data.lect.mixed > 0.2 && <span className="tag proxy">contact variety</span>}</div>
      <div className="grid cols-3">
        <Stat label="People" value={data.pop} sub={`capacity ${data.capacity}`} />
        <Stat label="Food" value={data.food.toFixed(2)} sub={`climate ×${data.climate.toFixed(2)}`} />
        <Stat label="Order" value={data.lect?.order ?? '—'} />
      </div>
      <div className="tiny muted">Environment: {biomes.map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' · ')}</div>
      {data.lect && (
        <div>
          <div className="eyebrow" style={{ marginBottom: 4 }}>Local core vocabulary</div>
          <div className="grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)', gap: '2px 12px' }}>
            {data.lect.core.slice(0, 14).map((c) => (
              <div key={c.concept} className="row between small" style={{ borderBottom: '1px dashed #e6dece', padding: '2px 0' }}>
                <span className="muted">{c.concept}</span>
                <span className="word" style={{ opacity: c.form ? 0.4 + c.share * 0.6 : 0.4 }}>{c.form ?? '—'}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Strongest contacts</div>
        {data.contacts.map((c) => (
          <div key={c.id} className="row small" style={{ gap: 8, marginBottom: 3 }}>
            <span style={{ width: 90 }} className="clickable" onClick={() => select({ kind: 'settlement', id: c.id })}>{c.name}</span>
            <div style={{ flex: 1 }}><Bar value={Math.min(1, c.w * 1.5)} color="#d6a03d" /></div>
          </div>
        ))}
      </div>
      <div className="divider" />
      <div className="eyebrow">Intervene</div>
      <div className="row wrap">
        <select value={migTo} onChange={(e) => setMigTo(Number(e.target.value))} style={{ flex: 1 }}>
          <option value={-1}>Send migrants to…</option>
          {frame?.settlements.filter((s) => s.id !== id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="number" value={count} min={1} max={60} onChange={(e) => setCount(Number(e.target.value))} style={{ width: 56 }} />
        <button className="btn sm" disabled={migTo < 0} onClick={() => intervene({ kind: 'migrate', from: id, to: migTo, count })}>Migrate</button>
      </div>
      <div className="row wrap">
        <button className="btn sm" onClick={() => intervene({ kind: 'plague', settlement: id, fraction: 0.5 })}>Epidemic (≈50%)</button>
        {data.isolated ? <button className="btn sm" onClick={() => intervene({ kind: 'reconnect', settlement: id })}>Reconnect</button> : <button className="btn sm" onClick={() => intervene({ kind: 'isolate', settlement: id })}>Isolate completely</button>}
        <button className="btn sm" onClick={onTrade}>Trade route…</button>
      </div>
      <div className="divider" />
      <div className="eyebrow">Residents</div>
      <div className="row wrap" style={{ gap: 4 }}>
        {data.residents.slice(0, 40).map((r) => (
          <button key={r.id} className="btn sm" title={`Age ${r.age.toFixed(0)} · ${r.lex} lexical entries`} onClick={() => select({ kind: 'agent', id: r.id })}>#{r.id}</button>
        ))}
      </div>
    </div>
  );
}

function AgentCard({ id }: { id: number }) {
  const { data } = useQuery<AgentView | null>('agent', id, 1200);
  const frame = useSim((s) => s.frame);
  const focusAgent = useSim((s) => s.focusAgent);
  if (!data) return <Empty>This agent is no longer alive.</Empty>;
  const lang = frame?.langs.find((l) => l.id === data.lang);
  const top = data.vocab.filter((v) => v.cat !== 'grammar').sort((a, b) => b.forms[0].score - a.forms[0].score).slice(0, 10);
  return (
    <div className="stack">
      <h2>Agent #{data.id}</h2>
      <div className="row wrap"><LangChip lang={lang} /><span className="tag">{data.settlementName}</span>{data.traveling && <span className="tag proxy">travelling → {data.traveling.to}</span>}</div>
      <div className="grid cols-3">
        <Stat label="Age" value={data.age.toFixed(0)} sub={`gen ${data.generation}`} />
        <Stat label="Words" value={data.vocab.filter((v) => v.cat !== 'grammar').length} sub={`${data.lexSize} entries`} />
        <Stat label="Success" value={pct((data.stats.okS + data.stats.okL) / Math.max(1, data.stats.spoke + data.stats.heard))} />
      </div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 4 }}>Strongest words</div>
        {top.map((v) => (
          <div key={v.concept} className="row between small" style={{ padding: '2px 0', borderBottom: '1px dashed #e6dece' }}>
            <span className="muted">{v.concept}</span>
            <span><span className="word">{v.forms[0].roman}</span> <span className="mono tiny muted">{v.forms[0].score.toFixed(2)}</span></span>
          </div>
        ))}
      </div>
      <div className="row">
        <button className="btn sm primary" onClick={() => focusAgent(data.id)}>Open in Agent Explorer</button>
        <button className="btn sm" onClick={() => simClient.send({ type: 'follow', agent: data.followed ? -1 : data.id })}><Icon.Eye /> {data.followed ? 'Unfollow' : 'Follow'}</button>
      </div>
    </div>
  );
}

function RouteCard({ id }: { id: number }) {
  const frame = useSim((s) => s.frame);
  const intervene = useSim((s) => s.intervene);
  const r = frame?.routes[id];
  if (!r || !frame) return null;
  return (
    <div className="stack">
      <h2>{frame.settlements[r.a].name} – {frame.settlements[r.b].name}</h2>
      <div className="row wrap">{r.trade && <span className="tag proxy">trade route</span>}{r.blocked && <span className="tag bad">blocked</span>}<span className="tag">{Math.round(r.sea * 100)}% by sea</span></div>
      <p className="small muted">Routes carry migrants and traders. Cutting one sets the contact between these two settlements to zero (e.g. a rising sea or a hostile border); people can still reach each other via other routes if any exist.</p>
      <div className="row">
        {r.blocked ? <button className="btn sm primary" onClick={() => intervene({ kind: 'openRoute', route: id })}>Reopen route</button> : <button className="btn sm accent" onClick={() => intervene({ kind: 'blockRoute', route: id })}>Cut this route</button>}
      </div>
    </div>
  );
}

function EventList() {
  const frame = useSim((s) => s.frame);
  const focus = useSim((s) => s.focusLanguage);
  const [filter, setFilter] = useState<string>('all');
  if (!frame) return null;
  const evs = frame.events.slice().reverse().filter((e) => filter === 'all' || e.type === filter || (filter === 'language' && ['birth', 'split', 'merge', 'extinct'].includes(e.type)));
  return (
    <>
      <div className="row wrap" style={{ gap: 4, marginBottom: 6 }}>
        {['all', 'language', 'grammar', 'sound', 'borrowing', 'semantic', 'migration', 'intervention'].map((f) => (
          <button key={f} className={`btn sm ${filter === f ? 'primary' : 'ghost'}`} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : f === 'language' ? 'Languages' : EVENT_LABELS[f]}</button>
        ))}
      </div>
      <div className="events">
        {!evs.length && <div className="small muted">Nothing yet.</div>}
        {evs.map((e, i) => (
          <div key={`${e.tick}-${i}`} className="event fade-in">
            <span className="y">y{Math.floor(e.tick / 4)}</span>
            <span className="k" style={{ background: EVENT_COLORS[e.type] ?? '#999' }} title={EVENT_LABELS[e.type]} />
            <span className={e.lang !== undefined ? 'clickable' : ''} onClick={() => e.lang !== undefined && focus(e.lang)}>{e.text}</span>
          </div>
        ))}
      </div>
    </>
  );
}
