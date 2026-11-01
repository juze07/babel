import { useMemo, useState } from 'react';
import { useSim } from '../store/store';
import { useQuery } from '../hooks/useQuery';
import type { LanguageView, LangSummary } from '../simulation/engine/views';
import { Panel, Stat, Tabs, LangChip, Bar, Empty, InfoTip } from '../components/ui';
import { DistBar, LineChart, ORDER_COLORS } from '../visualizations/charts/Charts';
import { pct, yearOf, EVENT_COLORS, EVENT_LABELS, cap } from '../utils/format';

type Tab = 'overview' | 'vocabulary' | 'sounds' | 'grammar' | 'dialects' | 'relations' | 'history';

const STRATEGY_LABEL: Record<string, string> = { prefix: 'prefix', suffix: 'suffix', 'particle-before': 'particle before', 'particle-after': 'particle after' };
const PLACE_C = ['labial', 'alveolar', 'palatal', 'velar', 'glottal'];
const MANNER_C = ['stop', 'nasal', 'fricative', 'liquid', 'glide'];
const BACK_V = ['front', 'central', 'back'];
const HEIGHT_V = ['high', 'mid', 'low'];

export function Languages() {
  const frame = useSim((s) => s.frame);
  const focus = useSim((s) => s.langFocus);
  const setFocus = useSim((s) => s.focusLanguage);
  const langs = frame?.langs ?? [];
  const alive = langs.filter((l) => l.fate === 'alive');
  const id = focus >= 0 && langs.some((l) => l.id === focus) ? focus : alive.sort((a, b) => b.speakers - a.speakers)[0]?.id ?? -1;
  const [tab, setTab] = useState<Tab>('overview');
  const { data } = useQuery<LanguageView | null>('language', id, 2000, id >= 0);

  if (!langs.length) {
    return <Empty>No languages have been identified yet. Start the simulation: a community’s speech counts as a language once its speakers understand each other reliably in measured test games.</Empty>;
  }
  return (
    <div className="lang-layout fade-in">
      <LanguageList langs={langs} current={id} onPick={setFocus} />
      <div style={{ minWidth: 0 }}>
        {!data ? <Empty>Loading language…</Empty> : (
          <>
            <Header v={data} />
            <Tabs value={tab} onChange={setTab} tabs={[
              { v: 'overview', label: 'Overview' }, { v: 'vocabulary', label: `Vocabulary (${data.vocab.length})` }, { v: 'sounds', label: 'Sounds' },
              { v: 'grammar', label: 'Grammar' }, { v: 'dialects', label: `Dialects (${data.dialects.length})` }, { v: 'relations', label: 'Relations' }, { v: 'history', label: 'History' },
            ]} />
            {tab === 'overview' && <Overview v={data} />}
            {tab === 'vocabulary' && <Vocabulary v={data} />}
            {tab === 'sounds' && <Sounds v={data} />}
            {tab === 'grammar' && <Grammar v={data} />}
            {tab === 'dialects' && <Dialects v={data} />}
            {tab === 'relations' && <Relations v={data} langs={langs} />}
            {tab === 'history' && <History v={data} />}
          </>
        )}
      </div>
    </div>
  );
}

function LanguageList({ langs, current, onPick }: { langs: LangSummary[]; current: number; onPick: (id: number) => void }) {
  const [showDead, setShowDead] = useState(false);
  const roots = [...new Set(langs.map((l) => l.root))];
  return (
    <div className="panel lang-list">
      <div className="panel-head"><h3>Languages</h3><label className="tiny row" style={{ gap: 4 }}><input type="checkbox" checked={showDead} onChange={(e) => setShowDead(e.target.checked)} /> historical</label></div>
      <div style={{ overflow: 'auto', padding: '6px 0' }}>
        {roots.map((r) => {
          const fam = langs.filter((l) => l.root === r && (showDead || l.fate === 'alive'));
          if (!fam.length) return null;
          const root = langs.find((l) => l.id === r);
          return (
            <div key={r} style={{ marginBottom: 6 }}>
              <div className="eyebrow" style={{ padding: '4px 14px' }}>{root?.name ?? '?'} family</div>
              {fam.map((l) => (
                <button key={l.id} className={`lang-item ${l.id === current ? 'on' : ''} ${l.fate !== 'alive' ? 'dead' : ''}`} onClick={() => onPick(l.id)}>
                  <span className="swatch" style={{ background: l.color, borderRadius: '50%' }} />
                  <span style={{ flex: 1, textAlign: 'left' }}>{l.name}</span>
                  <span className="mono tiny muted">{l.fate === 'alive' ? l.speakers : l.fate === 'merged' ? 'merged' : '†'}</span>
                </button>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Header({ v }: { v: LanguageView }) {
  const frame = useSim((s) => s.frame);
  const langs = frame?.langs ?? [];
  const parent = langs.find((l) => l.id === v.parent);
  const merged = langs.find((l) => l.id === v.mergedInto);
  const borrowedPct = v.vocab.length ? v.vocab.filter((w) => w.origin === 'borrowed').length / v.vocab.length : 0;
  return (
    <div className="page-head" style={{ alignItems: 'flex-start' }}>
      <div>
        <div className="eyebrow">{v.fate === 'alive' ? 'Living language' : v.fate === 'merged' ? 'Absorbed language' : 'Extinct language'}</div>
        <h1 className="row" style={{ gap: 10 }}><span className="swatch" style={{ background: v.color, width: 16, height: 16, borderRadius: '50%' }} />{v.name}</h1>
        <p>
          Emerged in year {yearOf(v.born)}{parent ? <> by divergence from <LangChip lang={parent} /></> : ' without a detectable ancestor (a new family)'}.
          {v.fate === 'extinct' && <> Died out in year {yearOf(v.died)}.</>}
          {v.fate === 'merged' && merged && <> Converged with <LangChip lang={merged} /> in year {yearOf(v.died)}.</>}
          {v.fate === 'alive' && <> Spoken in {v.settlements.map((s) => s.name).join(', ')}.</>}
        </p>
      </div>
      <div className="row" style={{ gap: 24 }}>
        <Stat label="Speakers" value={v.speakers} />
        <Stat label="Basic order" value={v.order.length ? v.orderNames[v.order.indexOf(Math.max(...v.order))] : '—'} />
        <Stat label="Loanwords" value={pct(borrowedPct)} info="Share of the consensus vocabulary whose etymon was first coined outside this language’s lineage (tracked via a hidden etymological registry the agents cannot see)." />
      </div>
    </div>
  );
}

function Overview({ v }: { v: LanguageView }) {
  const core = v.coreList.map((c, i) => ({ c, w: v.vocab.find((x) => x.concept === c), i }));
  const shown = v.markers.filter((m) => m.rate >= 0.25 && m.form);
  return (
    <div className="grid cols-2">
      <Panel title="Sample sentences" eyebrow="Generated by a representative speaker’s actual grammar" right={<InfoTip def="Each sentence is produced live by the production procedure of the most typical adult speaker (the one whose preferred words best match the consensus). Only sentences the speaker can express without gestures or inventing words are shown. Glosses come from the speaker’s own morph analysis." />}>
        {!v.examples.length ? <Empty>{v.fate === 'alive' ? 'This language cannot yet express full sentences without gestures.' : 'No living speakers.'}</Empty> : (
          <div className="stack" style={{ gap: 14 }}>
            {v.examples.map((e, i) => (
              <div key={i}>
                <div className="interlinear">
                  {e.words.map((w, j) => (
                    <div key={j} className="il-word"><span className="word">{w.text}</span><span className="mono tiny muted">{w.gloss}</span></div>
                  ))}
                </div>
                <div className="small" style={{ color: 'var(--ink-2)', marginTop: 2 }}>‘{e.translation}’</div>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <div className="stack" style={{ gap: 14 }}>
        <Panel title="Core vocabulary" eyebrow="20-item basic list">
          <div className="core-grid">
            {core.map(({ c, w }) => (
              <div key={c} className="core-cell" title={w ? `${w.ipa} · ${pct(w.share)} of speakers · ${w.origin}${w.donor ? ` from ${w.donor}` : ''}` : 'no shared word'}>
                <span className="mono tiny muted">{c}</span>
                <span className="word">{w ? w.roman : '—'}</span>
                {w?.origin === 'borrowed' && <span className="tag proxy" style={{ fontSize: 9 }}>loan</span>}
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Grammar at a glance">
          <div className="stack">
            <div><div className="eyebrow" style={{ marginBottom: 4 }}>Basic word order (speaker share)</div><DistBar parts={v.orderNames.map((o, i) => ({ label: o, value: v.order[i] ?? 0, color: ORDER_COLORS[o] }))} /></div>
            <div className="small">Modifiers {v.adj[0] >= v.adj[1] ? 'precede' : 'follow'} nouns ({pct(Math.max(...v.adj))}); obliques {v.obl[0] >= v.obl[1] ? 'come before' : 'come after'} the core clause ({pct(Math.max(...v.obl))}).</div>
            <div className="small">{shown.length ? <>Grammatical markers in regular use: {shown.map((m, i) => <span key={m.g}>{i ? ', ' : ''}<b>{m.gloss}</b> <span className="word">-{m.form}</span> <span className="muted">({STRATEGY_LABEL[m.strategy ?? ''] ?? '—'})</span></span>)}.</> : 'No grammatical marker is yet used by a quarter of speakers; meaning relies on word order and context.'}</div>
          </div>
        </Panel>
        <Panel title="Active sound changes" eyebrow="Rules adopted by speakers">
          {!v.rules.length ? <Empty>No conditioned sound change has spread here yet.</Empty> : (
            <table className="t"><tbody>
              {v.rules.slice(0, 8).map((r) => <tr key={r.id}><td className="mono">{r.label}</td><td style={{ width: 120 }}><Bar value={r.share} color="var(--amber)" /></td><td className="num mono tiny">{pct(r.share)}</td></tr>)}
            </tbody></table>
          )}
        </Panel>
      </div>
    </div>
  );
}

function Vocabulary({ v }: { v: LanguageView }) {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('all');
  const [origin, setOrigin] = useState('all');
  const cats = [...new Set(v.vocab.map((w) => w.cat))];
  const rows = v.vocab.filter((w) => (cat === 'all' || w.cat === cat) && (origin === 'all' || w.origin === origin) && (!q || w.concept.includes(q.toLowerCase()) || w.roman.includes(q.toLowerCase())));
  return (
    <Panel title="Lexicon" eyebrow="Consensus word per concept (most common etymon, most common pronunciation)" right={
      <div className="row">
        <input type="text" placeholder="Search meaning or word" value={q} onChange={(e) => setQ(e.target.value)} />
        <select value={cat} onChange={(e) => setCat(e.target.value)}><option value="all">All categories</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select>
        <select value={origin} onChange={(e) => setOrigin(e.target.value)}><option value="all">All origins</option><option value="native">native</option><option value="borrowed">borrowed</option><option value="semantic extension">semantic extension</option></select>
      </div>}>
      <div style={{ maxHeight: 560, overflow: 'auto' }}>
        <table className="t">
          <thead><tr><th>Meaning</th><th>Category</th><th>Word</th><th>IPA</th><th>Agreement</th><th>Origin</th></tr></thead>
          <tbody>
            {rows.map((w) => (
              <tr key={w.concept}>
                <td><b>{w.concept}</b></td>
                <td className="muted small">{w.cat}</td>
                <td className="word">{w.roman}</td>
                <td className="ipa">/{w.ipa}/</td>
                <td style={{ width: 150 }}><div className="row"><Bar value={w.share} /><span className="mono tiny">{pct(w.share)}</span></div></td>
                <td>{w.origin === 'borrowed' ? <span className="tag proxy">from {w.donor ?? 'another language'}</span> : w.origin === 'semantic extension' ? <span className="tag">extended meaning</span> : <span className="tag direct">native</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && <Empty>No matching words.</Empty>}
      </div>
      <p className="tiny muted" style={{ marginTop: 8 }}>Agreement is the share of adult speakers whose preferred word for the meaning descends from the same etymon. Concepts without any shared word are omitted.</p>
    </Panel>
  );
}

function Sounds({ v }: { v: LanguageView }) {
  const cons = v.phon.filter((p) => !p.vowel);
  const vows = v.phon.filter((p) => p.vowel);
  const cell = (p: (typeof v.phon)[number] | undefined, k: string) => p ? (
    <td key={k} className={`ph ${p.share >= 0.01 ? 'on' : ''}`} title={`${pct(p.share, 1)} of segments`} style={{ background: p.share >= 0.01 ? `rgba(192,100,60,${Math.min(0.85, 0.12 + p.share * 6)})` : undefined, color: p.share > 0.08 ? '#fff' : undefined }}>
      {p.ipa}
    </td>
  ) : <td key={k} className="ph empty" />;
  return (
    <div className="grid cols-2">
      <Panel title="Consonants" eyebrow="Shading = frequency in consensus words">
        <table className="phon">
          <thead><tr><th />{PLACE_C.map((p) => <th key={p}>{p}</th>)}</tr></thead>
          <tbody>
            {MANNER_C.map((m, mi) => (
              <tr key={m}><th>{m}</th>{PLACE_C.map((_, pi) => {
                const here = cons.filter((p) => p.place === pi && p.manner === mi);
                return <td key={pi} style={{ padding: 0 }}><table className="phon-in"><tbody><tr>{here.length ? here.map((p, k) => cell(p, String(k))) : cell(undefined, 'x')}</tr></tbody></table></td>;
              })}</tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Vowels">
        <table className="phon">
          <thead><tr><th />{BACK_V.map((p) => <th key={p}>{p}</th>)}</tr></thead>
          <tbody>
            {HEIGHT_V.map((h, hi) => (
              <tr key={h}><th>{h}</th>{BACK_V.map((_, bi) => {
                const here = vows.filter((p) => p.place === bi && p.manner === 2 - hi);
                return <td key={bi} style={{ padding: 0 }}><table className="phon-in"><tbody><tr>{here.length ? here.map((p, k) => cell(p, String(k))) : cell(undefined, 'x')}</tr></tbody></table></td>;
              })}</tr>
            ))}
          </tbody>
        </table>
        <div className="divider" />
        <div className="small">Inventory: <b>{v.phon.filter((p) => p.share >= 0.01).length}</b> of 26 segments used at ≥1%. Sound changes are conditioned rules (e.g. intervocalic voicing, final devoicing, vowel raising) actuated in one community, adopted by imitation and applied word by word (lexical diffusion).</div>
      </Panel>
      <Panel title="Sound changes in progress" className="span-2">
        {!v.rules.length ? <Empty>None yet.</Empty> : (
          <table className="t"><thead><tr><th>Rule</th><th>Adoption among speakers</th><th /></tr></thead><tbody>
            {v.rules.map((r) => <tr key={r.id}><td className="mono">{r.label}</td><td style={{ width: '50%' }}><Bar value={r.share} color="var(--amber)" /></td><td className="mono tiny num">{pct(r.share)}</td></tr>)}
          </tbody></table>
        )}
      </Panel>
    </div>
  );
}

function Grammar({ v }: { v: LanguageView }) {
  return (
    <div className="grid cols-2">
      <Panel title="Word order" eyebrow="Share of speakers whose dominant order is…">
        <DistBar parts={v.orderNames.map((o, i) => ({ label: o, value: v.order[i] ?? 0, color: ORDER_COLORS[o] }))} />
        <div className="divider" />
        <table className="t"><tbody>
          <tr><td>Modifier position</td><td><b>{v.adj[0] >= v.adj[1] ? 'Modifier – Noun' : 'Noun – Modifier'}</b></td><td className="mono tiny">{pct(Math.max(...v.adj))}</td></tr>
          <tr><td>Oblique (place) position</td><td><b>{v.obl[0] >= v.obl[1] ? 'before clause' : 'after clause'}</b></td><td className="mono tiny">{pct(Math.max(...v.obl))}</td></tr>
        </tbody></table>
        <p className="tiny muted">Orders are not hard-coded: each agent holds weights over the six orders, uses the strongest, and shifts toward orders that let it parse what it hears.</p>
      </Panel>
      <Panel title="Grammatical markers" eyebrow="Functional morphemes that emerged under communicative pressure">
        <table className="t">
          <thead><tr><th>Meaning</th><th>Form</th><th>Strategy</th><th>Speakers using</th></tr></thead>
          <tbody>
            {v.markers.map((m) => (
              <tr key={m.g} style={{ opacity: m.rate < 0.1 ? 0.5 : 1 }}>
                <td><b>{m.gloss}</b> <span className="mono tiny muted">{m.g}</span></td>
                <td className="word">{m.form ? (m.strategy === 'prefix' ? `${m.form}-` : m.strategy === 'suffix' ? `-${m.form}` : m.form) : '—'}</td>
                <td className="small">{m.strategy ? STRATEGY_LABEL[m.strategy] : '—'}</td>
                <td style={{ width: 130 }}><div className="row"><Bar value={m.rate} color="var(--terracotta)" /><span className="mono tiny">{pct(m.rate)}</span></div></td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="tiny muted">A marker is invented only after a speaker repeatedly fails to distinguish minimal pairs (e.g. one vs many, done vs not done). Listeners discover affixes from residues left after recognising a known stem.</p>
      </Panel>
    </div>
  );
}

function Dialects({ v }: { v: LanguageView }) {
  const focus = useSim((s) => s.select);
  const setPage = useSim((s) => s.setPage);
  if (!v.dialects.length) return <Empty>No living communities.</Empty>;
  return (
    <Panel title="Settlement varieties" eyebrow="Each community’s consensus lect compared to the language as a whole">
      <table className="t">
        <thead><tr><th>Settlement</th><th>Speakers</th><th>Lexical distance from language consensus</th><th>Order</th><th>Internal intelligibility</th><th>Loanwords</th><th>Status</th></tr></thead>
        <tbody>
          {v.dialects.map((d) => (
            <tr key={d.settlement} className="clickable" onClick={() => { focus({ kind: 'settlement', id: d.settlement }); setPage('observatory'); }}>
              <td><b>{d.name}</b></td>
              <td className="num">{d.speakers}</td>
              <td style={{ width: 200 }}><div className="row"><Bar value={d.distance / 0.5} color="var(--amber)" /><span className="mono tiny">{d.distance.toFixed(2)}</span></div></td>
              <td>{d.order}</td>
              <td className="mono">{pct(d.selfIntel)}</td>
              <td className="mono">{pct(d.mixed)}</td>
              <td>{d.distinct ? <span className="tag proxy">distinct dialect</span> : <span className="tag">mainstream</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tiny muted" style={{ marginTop: 8 }}>A variety counts as a distinct dialect when its phonetically weighted lexical distance from the language consensus exceeds the dialect threshold (configurable). If varieties drift far enough that measured intelligibility drops below the language threshold, the language splits.</p>
    </Panel>
  );
}

function Relations({ v, langs }: { v: LanguageView; langs: LangSummary[] }) {
  const focus = useSim((s) => s.focusLanguage);
  return (
    <div className="stack" style={{ gap: 14 }}>
      <Panel title="Relatedness to other languages" eyebrow="Cognates are words that descend from the same original coinage">
        <table className="t">
          <thead><tr><th>Language</th><th>Relation</th><th>Shared cognates</th><th>Lexical similarity</th><th>Sound-system similarity</th><th>Grammar similarity</th><th>Mutual intelligibility</th></tr></thead>
          <tbody>
            {v.related.map((r) => (
              <tr key={r.id} className="clickable" onClick={() => focus(r.id)}>
                <td><LangChip lang={langs.find((l) => l.id === r.id)} onClick={() => focus(r.id)} /></td>
                <td className="small">{r.relation}</td>
                <td style={{ width: 120 }}><div className="row"><Bar value={r.cognates} color="var(--terracotta)" /><span className="mono tiny">{pct(r.cognates)}</span></div></td>
                <td className="mono">{pct(1 - r.lexDist)}</td>
                <td className="mono">{pct(1 - r.phonDist)}</td>
                <td className="mono">{pct(1 - r.grammarDist)}</td>
                <td className="mono">{r.intelligibility === null ? <span className="muted">not measured</span> : pct(r.intelligibility)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Language contact" eyebrow="Lexical adoptions from other languages observed among this language’s speakers">
        {!v.borrowedIn.length ? <Empty>No borrowing recorded.</Empty> : (
          <table className="t"><tbody>
            {v.borrowedIn.sort((a, b) => b.count - a.count).map((b) => <tr key={b.id}><td><LangChip lang={langs.find((l) => l.id === b.id)} /></td><td className="num mono">{b.count} adoptions</td></tr>)}
          </tbody></table>
        )}
      </Panel>
    </div>
  );
}

function History({ v }: { v: LanguageView }) {
  const hist = v.history;
  const x = hist.map((h) => yearOf(h.tick));
  const [filter, setFilter] = useState('all');
  const types = [...new Set(v.events.map((e) => e.type))];
  const events = v.events.filter((e) => filter === 'all' || e.type === filter);
  const coreIdx = useMemo(() => v.coreList.map((_, i) => i).filter((i) => v.timeline.some((t) => t.core[i])), [v]);
  return (
    <div className="grid cols-2">
      <Panel title="Speakers over time">
        {hist.length < 2 ? <Empty>Not enough history yet.</Empty> : <LineChart x={x} series={[{ key: 's', label: 'Speakers', color: v.color, values: hist.map((h) => h.speakers) }]} height={150} />}
        {v.ancestors.length > 0 && <div className="small" style={{ marginTop: 10 }}>Lineage: {[...v.ancestors].reverse().map((a) => a.name).join(' → ')} → <b>{v.name}</b></div>}
        {v.daughters.length > 0 && <div className="small">Daughter languages: {v.daughters.map((d) => d.name).join(', ')}</div>}
      </Panel>
      <Panel title="Chronicle" right={<select value={filter} onChange={(e) => setFilter(e.target.value)}><option value="all">All events</option>{types.map((t) => <option key={t} value={t}>{EVENT_LABELS[t] ?? cap(t)}</option>)}</select>}>
        <div className="events" style={{ maxHeight: 260, overflow: 'auto' }}>
          {events.slice(0, 120).map((e, i) => (
            <div className="event" key={i}><span className="y">y{yearOf(e.tick)}</span><span className="k" style={{ background: EVENT_COLORS[e.type] ?? '#999' }} /><span>{e.text}</span></div>
          ))}
          {!events.length && <Empty>No recorded changes yet.</Empty>}
        </div>
      </Panel>
      <Panel title="Core vocabulary through time" eyebrow="Snapshots taken at each analysis; watch words erode, get replaced or borrowed" className="span-2">
        <div style={{ overflow: 'auto' }}>
          <table className="t">
            <thead><tr><th>Year</th>{coreIdx.map((i) => <th key={i}>{v.coreList[i]}</th>)}</tr></thead>
            <tbody>
              {v.timeline.map((t, ti) => (
                <tr key={t.tick}>
                  <td className="mono">{yearOf(t.tick)}</td>
                  {coreIdx.map((i) => {
                    const prev = ti > 0 ? v.timeline[ti - 1].core[i] : t.core[i];
                    return <td key={i} className="word" style={{ background: prev !== t.core[i] ? '#fbf1df' : undefined }}>{t.core[i] ?? '—'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="tiny muted" style={{ marginTop: 6 }}>Highlighted cells changed since the previous snapshot (sound change, replacement or borrowing).</p>
      </Panel>
    </div>
  );
}
