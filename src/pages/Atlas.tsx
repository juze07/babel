import { useMemo, useState } from 'react';
import { useSim } from '../store/store';
import { useQuery } from '../hooks/useQuery';
import type { AtlasView, LangSummary, TreeView } from '../simulation/engine/views';
import { Panel, Seg, Empty, LangChip, InfoTip } from '../components/ui';
import { Heatmap, ORDER_COLORS } from '../visualizations/charts/Charts';
import { pct, yearOf } from '../utils/format';

type Matrix = 'intel' | 'cognates' | 'lexical' | 'phonological' | 'grammatical';
const MATRIX_INFO: Record<Matrix, { label: string; text: string }> = {
  intel: { label: 'Intelligibility', text: 'The index used to draw language boundaries: relative first-turn success in test games between communities of the two languages (learning and gestures disabled), combined 65/35 with cognate share and smoothed across analyses.' },
  cognates: { label: 'Cognates', text: 'Share of concepts (named in both) whose consensus words descend from the same original coinage. Uses the hidden etymological registry; agents never see it.' },
  lexical: { label: 'Lexical', text: '1 − mean normalised, feature-weighted edit distance between consensus words for the same concepts.' },
  phonological: { label: 'Sounds', text: '1 − distance between segment-frequency profiles (half L1 norm).' },
  grammatical: { label: 'Grammar', text: '1 − mean of word-order distribution distance, modifier/oblique order distance and marker-strategy mismatch.' },
};

export function Atlas() {
  const { data: atlas } = useQuery<AtlasView>('atlas', undefined, 2500);
  const { data: tree } = useQuery<TreeView>('tree', undefined, 2500);
  const [matrix, setMatrix] = useState<Matrix>('intel');
  const focus = useSim((s) => s.focusLanguage);
  if (!atlas || !tree) return <Empty>Loading atlas…</Empty>;
  if (!atlas.languages.length) return <Empty>No languages yet. Start the simulation; languages are identified from measured mutual intelligibility between communities.</Empty>;
  const byId = new Map(atlas.languages.map((l) => [l.id, l]));
  const alive = atlas.alive.map((id) => byId.get(id)!);
  const m = matrix === 'intel' ? atlas.intel : atlas[matrix];
  return (
    <div className="stack fade-in" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <div className="eyebrow">Language atlas</div>
          <h1>Families, relationships and comparisons</h1>
          <p>The family tree is reconstructed from the history of measured intelligibility: a language splits when its communities stop understanding each other above the threshold, merges when they converge, and dies with its last community.</p>
        </div>
      </div>
      <Panel title="Family tree" eyebrow="Phylogeny over time · line width ∝ speakers · click a language to inspect" right={<span className="tiny muted">{alive.length} living · {atlas.languages.length - alive.length} historical</span>}>
        <Phylogeny tree={tree} onPick={focus} />
      </Panel>
      <div className="grid cols-2">
        <Panel title="Similarity matrix" right={<Seg value={matrix} onChange={setMatrix} options={(Object.keys(MATRIX_INFO) as Matrix[]).map((k) => ({ v: k, label: MATRIX_INFO[k].label }))} />}>
          {alive.length < 2 ? <Empty>Only one living language.</Empty> : (
            <>
              <Heatmap labels={alive.map((l) => l.name)} colors={alive.map((l) => l.color)} matrix={m} size={alive.length > 12 ? 26 : 34} onCell={(i) => focus(alive[i].id)} />
              <p className="tiny muted" style={{ marginTop: 8 }}><b>{MATRIX_INFO[matrix].label}.</b> {MATRIX_INFO[matrix].text} Values in %.</p>
            </>
          )}
        </Panel>
        <Panel title="Language network" eyebrow="Edges: intelligibility (solid) and shared cognates (dashed)">
          {alive.length < 2 ? <Empty>Only one living language.</Empty> : <Network atlas={atlas} alive={alive} onPick={focus} />}
        </Panel>
      </div>
      <Panel title="Core vocabulary comparison" eyebrow="Cells with the same colour in a column are cognates (descend from one coinage)" right={<InfoTip def="Like a Swadesh-list comparison. Colour classes are computed from the hidden etymon registry, so they show true descent, including words that have changed shape through sound change." />}>
        <CoreTable atlas={atlas} byId={byId} />
      </Panel>
      <div className="grid cols-2">
        <Panel title="Grammatical typology">
          <table className="t">
            <thead><tr><th>Language</th><th>Order</th><th>Modifier</th><th>Oblique</th>{atlas.gramKeys.map((g) => <th key={g}>{g}</th>)}</tr></thead>
            <tbody>
              {atlas.grammar.map((g) => (
                <tr key={g.id}>
                  <td><LangChip lang={byId.get(g.id)} /></td>
                  <td><span className="tag" style={{ borderColor: ORDER_COLORS[g.order], color: ORDER_COLORS[g.order] }}>{g.order}</span></td>
                  <td className="small">{g.adj}</td>
                  <td className="small">{g.obl}</td>
                  {g.markers.map((mk, i) => <td key={i} className="tiny" title={mk ?? 'unmarked'}>{mk ? STRAT_SHORT[mk] : <span className="muted">·</span>}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="tiny muted" style={{ marginTop: 6 }}>Marker columns show the dominant strategy where ≥40% of speakers mark the meaning: <b>pre</b>fix, <b>suf</b>fix, particle <b>bef</b>ore or <b>aft</b>er its host.</p>
        </Panel>
        <Panel title="Sound systems" eyebrow="Segment frequency in consensus vocabulary">
          <PhonTable atlas={atlas} byId={byId} />
        </Panel>
      </div>
    </div>
  );
}

const STRAT_SHORT: Record<string, string> = { prefix: 'pre', suffix: 'suf', 'particle-before': 'bef', 'particle-after': 'aft' };

/* ---------- phylogeny ---------- */
function Phylogeny({ tree, onPick }: { tree: TreeView; onPick: (id: number) => void }) {
  const [hover, setHover] = useState<number | null>(null);
  const langs = tree.languages;
  const now = tree.tick;
  const layout = useMemo(() => {
    // depth-first ordering: roots by birth, children placed after their parent
    const kids = new Map<number, LangSummary[]>();
    for (const l of langs) if (l.parent >= 0) { const a = kids.get(l.parent) ?? []; a.push(l); kids.set(l.parent, a); }
    const order: LangSummary[] = [];
    const visit = (l: LangSummary) => { order.push(l); (kids.get(l.id) ?? []).sort((a, b) => a.born - b.born).forEach(visit); };
    langs.filter((l) => l.parent < 0 || !langs.some((p) => p.id === l.parent)).sort((a, b) => a.root - b.root || a.born - b.born).forEach(visit);
    return order;
  }, [langs]);
  const maxSp = Math.max(1, ...tree.history.flat().map((h) => h[1]));
  const rowH = 26, W = 1000, pl = 10, pr = 120, H = layout.length * rowH + 30;
  const t0 = 0, t1 = Math.max(now, 4);
  const sx = (t: number) => pl + ((t - t0) / (t1 - t0)) * (W - pl - pr);
  const yOf = new Map(layout.map((l, i) => [l.id, 14 + i * rowH + rowH / 2]));
  const ticks = Array.from({ length: 6 }, (_, i) => t0 + ((t1 - t0) * i) / 5);
  return (
    <div style={{ overflowX: 'auto' }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ minWidth: 640, display: 'block' }}>
        {ticks.map((t, i) => (
          <g key={i}>
            <line x1={sx(t)} x2={sx(t)} y1={6} y2={H - 16} stroke="#ece5d7" />
            <text x={sx(t)} y={H - 3} fontSize="10" textAnchor={i === 0 ? 'start' : 'middle'} fill="#8d8676" fontFamily="JetBrains Mono">year {yearOf(t)}</text>
          </g>
        ))}
        {layout.map((l) => {
          const y = yOf.get(l.id)!;
          const end = l.fate === 'alive' ? now : l.died;
          const hist = tree.history[l.id] ?? [];
          const parentY = l.parent >= 0 ? yOf.get(l.parent) : undefined;
          const dim = hover !== null && hover !== l.id && hover !== l.parent && l.parent !== hover ? 0.35 : 1;
          // band path with variable width
          let top = '', bot = '';
          const pts = hist.length ? hist : [[l.born, l.speakers], [end, l.speakers]];
          pts.forEach(([t, s], i) => { const w = 1.5 + (s / maxSp) * 9; top += `${i ? 'L' : 'M'}${sx(t).toFixed(1)},${(y - w / 2).toFixed(1)}`; bot = `L${sx(t).toFixed(1)},${(y + w / 2).toFixed(1)}` + bot; });
          if (l.fate === 'alive' && pts.length) { const last = pts[pts.length - 1]; const w = 1.5 + (last[1] / maxSp) * 9; top += `L${sx(now)},${y - w / 2}`; bot = `L${sx(now)},${y + w / 2}` + bot; }
          return (
            <g key={l.id} opacity={dim} style={{ cursor: 'pointer' }} onClick={() => onPick(l.id)} onMouseEnter={() => setHover(l.id)} onMouseLeave={() => setHover(null)}>
              {parentY !== undefined && <path d={`M${sx(l.born)},${parentY} C${sx(l.born) + 10},${parentY} ${sx(l.born) - 4},${y} ${sx(l.born) + 6},${y}`} fill="none" stroke={l.color} strokeWidth={1.4} strokeDasharray="3 2" />}
              <rect x={sx(l.born)} y={y - rowH / 2} width={Math.max(4, sx(end) - sx(l.born))} height={rowH} fill="transparent" />
              <path d={top + bot + 'Z'} fill={l.color} opacity={l.fate === 'alive' ? 0.95 : 0.55} />
              <circle cx={sx(l.born)} cy={y} r={3.2} fill="#fbf8f2" stroke={l.color} strokeWidth={1.5} />
              {l.fate === 'extinct' && <text x={sx(end) + 4} y={y + 4} fontSize="11" fill="#3d4757">†</text>}
              {l.fate === 'merged' && l.mergedInto >= 0 && yOf.has(l.mergedInto) && <path d={`M${sx(end)},${y} C${sx(end) + 14},${y} ${sx(end) - 6},${yOf.get(l.mergedInto)!} ${sx(end) + 8},${yOf.get(l.mergedInto)!}`} stroke={l.color} strokeWidth={1.2} fill="none" strokeDasharray="1 2" />}
              <text x={l.fate === 'alive' ? sx(now) + 8 : sx(end) + (l.fate === 'extinct' ? 14 : 12)} y={y + 4} fontSize="12.5" fontFamily="Fraunces, serif" fill={l.fate === 'alive' ? '#1d2533' : '#8d8676'} fontStyle={l.fate === 'alive' ? 'normal' : 'italic'}>
                {l.name}{l.fate === 'alive' ? ` · ${l.speakers}` : ''}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (() => {
        const l = langs.find((x) => x.id === hover)!;
        const p = langs.find((x) => x.id === l.parent);
        return <div className="tiny muted" style={{ marginTop: 4 }}><b style={{ color: 'var(--ink)' }}>{l.name}</b>: born year {yearOf(l.born)}{p ? ` from ${p.name}` : ' (new family)'}{l.fate !== 'alive' ? `, ${l.fate} in year ${yearOf(l.died)}` : `, ${l.speakers} speakers in ${l.settlements.length} settlement(s), ${l.order}`}.</div>;
      })()}
    </div>
  );
}

/* ---------- network ---------- */
function Network({ atlas, alive, onPick }: { atlas: AtlasView; alive: LangSummary[]; onPick: (id: number) => void }) {
  const n = alive.length;
  const W = 420, H = 340, cx = W / 2, cy = H / 2, R = Math.min(W, H) / 2 - 50;
  // order around the circle by family to keep relatives adjacent
  const idx = alive.map((_, i) => i).sort((a, b) => alive[a].root - alive[b].root || alive[a].id - alive[b].id);
  const pos = new Map(idx.map((i, k) => [i, [cx + R * Math.cos((k / n) * Math.PI * 2 - Math.PI / 2), cy + R * Math.sin((k / n) * Math.PI * 2 - Math.PI / 2)]]));
  const maxSp = Math.max(1, ...alive.map((l) => l.speakers));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block', maxHeight: 380 }}>
      {alive.map((_, i) => alive.map((__, j) => {
        if (j <= i) return null;
        const [x1, y1] = pos.get(i)!, [x2, y2] = pos.get(j)!;
        const iv = atlas.intel[i][j], cg = atlas.cognates[i][j];
        return (
          <g key={`${i}-${j}`}>
            {cg > 0.15 && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#c0643c" strokeOpacity={0.25 + cg * 0.5} strokeWidth={1} strokeDasharray="4 3" />}
            {iv > 0.15 && <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#2d4a5c" strokeOpacity={0.15 + iv * 0.6} strokeWidth={1 + iv * 5} />}
          </g>
        );
      }))}
      {alive.map((l, i) => {
        const [x, y] = pos.get(i)!;
        const r = 7 + Math.sqrt(l.speakers / maxSp) * 12;
        const lx = x + (x - cx) * 0.22, ly = y + (y - cy) * 0.22;
        return (
          <g key={l.id} style={{ cursor: 'pointer' }} onClick={() => onPick(l.id)}>
            <circle cx={x} cy={y} r={r} fill={l.color} stroke="#fbf8f2" strokeWidth={2} />
            <text x={lx} y={ly + 4} fontSize="12" textAnchor={lx < cx - 10 ? 'end' : lx > cx + 10 ? 'start' : 'middle'} fontFamily="Fraunces, serif" fill="#1d2533">{l.name}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- core table ---------- */
const COG = ['#f3d9c9', '#d9e4cf', '#f4e3b8', '#d3dde9', '#e2d6ec', '#cfe6e3', '#efd3e2', '#e6e0d3', '#c9d3db', '#f6dccb'];
function CoreTable({ atlas, byId }: { atlas: AtlasView; byId: Map<number, LangSummary> }) {
  const classes = atlas.coreList.map((_, ci) => {
    const count = new Map<number, number>();
    atlas.core.forEach((l) => { const w = l.words[ci]; if (w) count.set(w.etym, (count.get(w.etym) ?? 0) + 1); });
    const ranked = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
    return new Map(ranked.map((e, k) => [e, k]));
  });
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="t core-cmp">
        <thead><tr><th>Language</th>{atlas.coreList.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>
          {atlas.core.map((l) => (
            <tr key={l.id}>
              <td style={{ whiteSpace: 'nowrap' }}><LangChip lang={byId.get(l.id)} /></td>
              {l.words.map((w, ci) => {
                const k = w ? classes[ci].get(w.etym) ?? 0 : -1;
                const shared = w && atlas.core.filter((o) => o.words[ci]?.etym === w.etym).length > 1;
                return <td key={ci} className="word" style={{ background: w && shared ? COG[k % COG.length] : undefined }}>{w ? w.roman : <span className="muted">—</span>}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function PhonTable({ atlas, byId }: { atlas: AtlasView; byId: Map<number, LangSummary> }) {
  const used = atlas.phonemes.map((_, i) => i).filter((i) => atlas.phon.some((p) => p.shares[i] >= 0.01));
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="t">
        <thead><tr><th>Language</th>{used.map((i) => <th key={i} className="ipa" style={{ textTransform: 'none', fontSize: 13, textAlign: 'center' }}>{atlas.phonemes[i].ipa}</th>)}</tr></thead>
        <tbody>
          {atlas.phon.map((p) => (
            <tr key={p.id}>
              <td style={{ whiteSpace: 'nowrap' }}><LangChip lang={byId.get(p.id)} /></td>
              {used.map((i) => <td key={i} title={pct(p.shares[i], 1)} style={{ padding: 2 }}><div style={{ height: 18, borderRadius: 3, background: p.shares[i] >= 0.005 ? (atlas.phonemes[i].vowel ? `rgba(127,148,116,${Math.min(1, 0.15 + p.shares[i] * 5)})` : `rgba(192,100,60,${Math.min(1, 0.15 + p.shares[i] * 7)})`) : '#f2ece1' }} /></td>)}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="tiny muted" style={{ marginTop: 6 }}>Green: vowels; terracotta: consonants. Darker = more frequent. Diverging sound systems come from different sound-change histories.</p>
    </div>
  );
}
