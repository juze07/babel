import { useMemo, useState } from 'react';
import { useSim } from '../store/store';
import { useQuery } from '../hooks/useQuery';
import type { AgentListView, AgentView } from '../simulation/engine/views';
import { Panel, Stat, Empty, Bar, LangChip, Tabs, InfoTip } from '../components/ui';
import { DistBar, ORDER_COLORS } from '../visualizations/charts/Charts';
import { Icon } from '../components/icons';
import { pct, yearOf } from '../utils/format';

const TRAIT_INFO: Record<string, string> = {
  memoryCapacity: 'How many word–meaning associations the agent can hold before weak ones are forgotten.',
  learningRate: 'Size of each reinforcement or weakening step.',
  imitation: 'Tendency to align with the words and pronunciation of others.',
  innovation: 'Propensity to coin new words when it lacks one.',
  confidence: 'Lower confidence means more exploration of weaker synonyms.',
  attention: 'Lowers the threshold for recognising imperfect word matches.',
  forgetting: 'Yearly decay rate of unused associations.',
  sociability: 'How often the agent seeks partners beyond close relations.',
  prestige: 'How strongly others imitate this agent (affects accent and word spread).',
  mobility: 'Propensity to migrate.',
};

export function Agents() {
  const focus = useSim((s) => s.agentFocus);
  const setFocus = useSim((s) => s.focusAgent);
  const frame = useSim((s) => s.frame);
  const { data: list } = useQuery<AgentListView>('agents', undefined, 3000);
  const [q, setQ] = useState('');
  const [settl, setSettl] = useState(-1);
  const [sort, setSort] = useState<'id' | 'age' | 'lex' | 'success'>('lex');
  const rows = useMemo(() => (list ?? [])
    .filter((x) => (settl < 0 || x.settlement === settl) && (!q || String(x.id).includes(q)))
    .sort((x, y) => sort === 'id' ? x.id - y.id : sort === 'age' ? y.age - x.age : sort === 'lex' ? y.lex - x.lex : (y.successL ?? 0) - (x.successL ?? 0)), [list, settl, q, sort]);
  const id = focus >= 0 ? focus : rows[0]?.id ?? -1;
  const { data: a } = useQuery<AgentView | null>('agent', id, 1500, id >= 0);
  const alive = !list || list.some((x) => x.id === id);
  const langs = frame?.langs ?? [];
  return (
    <div className="micro fade-in">
      <div className="panel micro-list">
        <div className="panel-head"><div><h3>Population</h3><div className="tiny muted">{list?.length ?? 0} living agents</div></div></div>
        <div className="row" style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>
          <input type="text" placeholder="Agent #" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 70 }} />
          <select value={settl} onChange={(e) => setSettl(Number(e.target.value))} style={{ flex: 1 }}>
            <option value={-1}>All settlements</option>
            {frame?.settlements.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="lex">by lexicon</option><option value="age">by age</option><option value="success">by success</option><option value="id">by id</option></select>
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          {!list ? <Empty>Loading…</Empty> : rows.slice(0, 300).map((x) => (
            <button key={x.id} className={`ep-item ${x.id === id ? 'on' : ''}`} onClick={() => setFocus(x.id)}>
              <div className="row between">
                <span className="row" style={{ gap: 6 }}><span className="swatch" style={{ background: langs.find((l) => l.id === x.lang)?.color ?? '#ccc', borderRadius: '50%' }} /><b>#{x.id}</b> <span className="small muted">{x.settlementName}{x.traveling ? ' (travelling)' : ''}</span></span>
                <span className="mono tiny muted">{Math.floor(x.age)}y</span>
              </div>
              <div className="row tiny muted" style={{ gap: 10 }}><span>{x.lex} words</span><span>gen {x.generation}</span><span>understands {pct(x.successL)}</span><span>{x.order}</span></div>
            </button>
          ))}
        </div>
      </div>
      <div style={{ minWidth: 0 }}>{!a ? <Empty>{id < 0 ? 'Select an agent.' : alive ? 'Loading agent…' : `Agent #${id} has died.`}</Empty> : <AgentDetail a={a} />}</div>
    </div>
  );
}

function AgentDetail({ a }: { a: AgentView }) {
  const frame = useSim((s) => s.frame);
  const follow = useSim((s) => s.follow);
  const setPage = useSim((s) => s.setPage);
  const select = useSim((s) => s.select);
  const focusEp = useSim((s) => s.focusEpisode);
  const focusAgent = useSim((s) => s.focusAgent);
  const [tab, setTab] = useState<'lexicon' | 'grammar' | 'social' | 'memory'>('lexicon');
  const lang = frame?.langs.find((l) => l.id === a.lang);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Agent · generation {a.generation}</div>
          <h1>#{a.id} <span className="muted" style={{ fontSize: 16 }}>of {a.settlementName}</span></h1>
          <p>
            {Math.floor(a.age)} years old, born in {a.birthplace}{a.mother >= 0 ? <> to <a className="link" onClick={() => focusAgent(a.mother)}>#{a.mother}</a>{a.father >= 0 && <> and <a className="link" onClick={() => focusAgent(a.father)}>#{a.father}</a></>}</> : ' as a founder'}. Speaks <LangChip lang={lang} />.
            {a.traveling && <> Currently travelling to {a.traveling.to}.</>}
          </p>
        </div>
        <div className="row">
          <button className={`btn ${a.followed ? 'primary' : ''}`} onClick={() => { follow(a.followed ? -1 : a.id); }}><Icon.Eye /> {a.followed ? 'Following' : 'Follow on map'}</button>
          <button className="btn" onClick={() => { select({ kind: 'agent', id: a.id }); setPage('observatory'); }}><Icon.Globe /> Show on map</button>
        </div>
      </div>
      <div className="grid cols-4">
        <Panel><Stat label="Lexicon" value={a.lexSize} sub="word–meaning links" /></Panel>
        <Panel><Stat label="Understood" value={pct(a.stats.heard ? a.stats.okL / a.stats.heard : null)} sub={`as listener, ${a.stats.heard} games`} /></Panel>
        <Panel><Stat label="Was understood" value={pct(a.stats.spoke ? a.stats.okS / a.stats.spoke : null)} sub={`as speaker, ${a.stats.spoke} games`} /></Panel>
        <Panel><Stat label="Accent" value={a.accent.length} sub="sound-change rules adopted" /></Panel>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ v: 'lexicon', label: 'Mental lexicon' }, { v: 'grammar', label: 'Grammar & accent' }, { v: 'social', label: 'Traits & relations' }, { v: 'memory', label: 'Memory & learning' }]} />
      {tab === 'lexicon' && (
        <Panel title="Mental lexicon" eyebrow="Every meaning this agent can express, with competing forms and association strengths">
          <div style={{ maxHeight: 520, overflow: 'auto' }}>
            <table className="t">
              <thead><tr><th>Meaning</th><th>Preferred word</th><th>Strength</th><th>Origin</th><th>Uses</th><th>Competitors</th></tr></thead>
              <tbody>
                {a.vocab.map((v) => {
                  const b = v.forms[0];
                  return (
                    <tr key={v.concept}>
                      <td><b>{v.concept}</b> <span className="tiny muted">{v.cat}</span></td>
                      <td><span className="word">{b.roman}</span> <span className="ipa tiny muted">/{b.ipa}/</span></td>
                      <td style={{ width: 110 }}><div className="row"><Bar value={b.score} /><span className="mono tiny">{b.score.toFixed(2)}</span></div></td>
                      <td className="small">{b.origin}</td>
                      <td className="mono tiny">{b.uses}</td>
                      <td className="small">{v.forms.slice(1).map((f, i) => <span key={i} style={{ marginRight: 8 }}><span className="word">{f.roman}</span> <span className="mono tiny muted">{f.score.toFixed(2)}</span></span>)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
      {tab === 'grammar' && (
        <div className="grid cols-2">
          <Panel title="Word-order weights">
            <DistBar parts={a.grammar.orderNames.map((o, i) => ({ label: o, value: a.grammar.order[i], color: ORDER_COLORS[o] }))} />
            <div className="small" style={{ marginTop: 10 }}>Modifier before noun: {pct(a.grammar.adj[0])} · Place before clause: {pct(a.grammar.obl[0])}</div>
          </Panel>
          <Panel title="Grammatical markers" right={<InfoTip def="Need = accumulated pressure from failures on minimal pairs. When need is high and the agent has no marker, it may invent one." />}>
            <table className="t">
              <thead><tr><th>Meaning</th><th>Form</th><th>Strength</th><th>Strategy</th><th>Need</th></tr></thead>
              <tbody>
                {a.grammar.markers.map((m) => (
                  <tr key={m.g} style={{ opacity: m.form ? 1 : 0.55 }}>
                    <td><b>{m.gloss}</b></td><td className="word">{m.form ?? '—'}</td><td className="mono tiny">{m.score.toFixed(2)}</td><td className="small">{m.form ? m.strategy : '—'}</td>
                    <td style={{ width: 80 }}><Bar value={Math.min(1, m.need / 2)} color="var(--amber)" /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
          <Panel title="Accent (adopted sound changes)" className="span-2">
            {!a.accent.length ? <Empty>This agent pronounces words as stored.</Empty> : (
              <table className="t"><tbody>{a.accent.map((r, i) => <tr key={i}><td className="mono">{r.rule}</td><td style={{ width: '40%' }}><Bar value={r.strength} color="var(--amber)" /></td><td className="mono tiny">{pct(r.strength)} of eligible words</td></tr>)}</tbody></table>
            )}
          </Panel>
        </div>
      )}
      {tab === 'social' && (
        <div className="grid cols-2">
          <Panel title="Cognitive traits" eyebrow="Inherited from parents with mutation">
            <table className="t"><tbody>
              {Object.entries(a.traits).map(([k, v]) => (
                <tr key={k}><td className="small">{k} <InfoTip def={TRAIT_INFO[k] ?? k} /></td><td style={{ width: '45%' }}><Bar value={k === 'memoryCapacity' ? (v as number) / 250 : (v as number)} /></td><td className="mono tiny">{k === 'memoryCapacity' ? v : (v as number).toFixed(2)}</td></tr>
              ))}
            </tbody></table>
          </Panel>
          <Panel title="Social network" eyebrow="Strongest relations">
            {!a.relations.length ? <Empty>No relations.</Empty> : (
              <table className="t">
                <thead><tr><th>Agent</th><th>Tie</th><th>Settlement</th><th>Strength</th></tr></thead>
                <tbody>{a.relations.map((r) => (
                  <tr key={r.id} className={r.alive ? 'clickable' : ''} onClick={() => r.alive && focusAgent(r.id)} style={{ opacity: r.alive ? 1 : 0.5 }}>
                    <td><span className="swatch" style={{ background: frame?.langs.find((l) => l.id === r.lang)?.color ?? '#ccc', borderRadius: '50%', marginRight: 6 }} />#{r.id}{!r.alive && ' †'}</td>
                    <td className="small">{r.kind}</td><td className="small">{r.settlement}</td><td style={{ width: 90 }}><Bar value={r.w} /></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </Panel>
        </div>
      )}
      {tab === 'memory' && (
        <div className="grid cols-2">
          <Panel title="Recent conversations" eyebrow="Episodic memory (click to open in the microscope when recorded)">
            {!a.memory.length ? <Empty>No conversations remembered.</Empty> : (
              <div style={{ maxHeight: 440, overflow: 'auto' }}>
                <table className="t"><tbody>
                  {a.memory.map((m, i) => (
                    <tr key={i} className={m.ep >= 0 ? 'clickable' : ''} onClick={() => m.ep >= 0 && focusEp(m.ep)}>
                      <td className="mono tiny muted">y{yearOf(m.tick)}</td>
                      <td className="small">{m.role === 'S' ? 'said to' : 'heard from'} #{m.partner}</td>
                      <td><span className="word">{m.text}</span><div className="mono tiny muted">{m.gloss}</div></td>
                      <td><span className={`tag ${m.ok ? 'ok' : 'bad'}`}>{m.ok ? 'ok' : 'fail'}</span></td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
            )}
          </Panel>
          <Panel title="Learning log" eyebrow="New words acquired and how">
            {!a.learnLog.length ? <Empty>Nothing learned recently.</Empty> : (
              <div style={{ maxHeight: 440, overflow: 'auto' }}>
                <table className="t"><tbody>
                  {a.learnLog.map((l, i) => (
                    <tr key={i}><td className="mono tiny muted">y{yearOf(l.tick)}</td><td className="small">{l.kind}</td><td><b>{l.concept}</b></td><td className="word">{l.roman}</td><td className="tiny muted">{l.partner >= 0 ? `from #${l.partner}` : ''}</td></tr>
                  ))}
                </tbody></table>
              </div>
            )}
          </Panel>
        </div>
      )}
    </div>
  );
}
