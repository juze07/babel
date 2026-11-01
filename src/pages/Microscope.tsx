import { useState } from 'react';
import { useSim } from '../store/store';
import { useQuery } from '../hooks/useQuery';
import { Panel, Empty, Bar, InfoTip } from '../components/ui';
import { Icon } from '../components/icons';
import { pct, yearOf } from '../utils/format';
import type { episodeList, episodeView } from '../simulation/engine/views';

type EpList = ReturnType<typeof episodeList>;
type Ep = NonNullable<ReturnType<typeof episodeView>>;

const STAGES = [
  { t: 'Intention', d: 'What the speaker wants to say, and the shared scene' },
  { t: 'Utterance', d: 'Words, order and markers the speaker chose' },
  { t: 'Interpretation', d: 'What the listener heard and how they parsed it' },
  { t: 'Outcome', d: 'Which scene the listener picked; repair if needed' },
  { t: 'Learning', d: 'How both minds changed afterwards' },
];
const ROLE: Record<string, string> = { A: 'agent', V: 'verb', P: 'patient', R: 'recipient', L: 'place', M: 'modifier', Q: 'particle', X: '?' };
const KIND: Record<string, string> = { swap: 'roles swapped', agent: 'different agent', patient: 'different patient', verb: 'different action', tense: 'different tense', neg: 'negated', plural: 'different number', prop: 'different property', loc: 'different place', random: 'unrelated scene' };

const targetOf = (ep: Ep) => Math.max(0, ep.distractorKinds.indexOf('target'));

export function Microscope() {
  const focus = useSim((s) => s.episodeFocus);
  const setFocus = useSim((s) => s.focusEpisode);
  const running = useSim((s) => s.running);
  const [frozen, setFrozen] = useState(false);
  const { data: list } = useQuery<EpList>('episodes', undefined, frozen ? 1e9 : 2000);
  const id = focus >= 0 ? focus : list?.[0]?.id ?? -1;
  const { data: ep } = useQuery<Ep | null>('episode', id, 1e9, id >= 0);
  const [stage, setStage] = useState(0);
  const [filter, setFilter] = useState<'all' | 'ok' | 'fail' | 'contact'>('all');
  const rows = (list ?? []).filter((e) => filter === 'all' || (filter === 'ok' ? e.success : filter === 'fail' ? !e.success : e.kind === 'contact'));

  return (
    <div className="micro fade-in">
      <div className="panel micro-list">
        <div className="panel-head">
          <div><h3>Recorded conversations</h3><div className="tiny muted">A sample of real language games, newest first</div></div>
          <button className="btn sm ghost" onClick={() => setFrozen(!frozen)} title="Stop refreshing the list">{frozen ? <><Icon.Play /> Live</> : <><Icon.Pause /> Freeze</>}</button>
        </div>
        <div style={{ padding: '8px 10px', borderBottom: '1px solid var(--line)' }}>
          <div className="seg">{(['all', 'ok', 'fail', 'contact'] as const).map((f) => <button key={f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>{{ all: 'All', ok: 'Understood', fail: 'Failed', contact: 'Contact' }[f]}</button>)}</div>
        </div>
        <div style={{ overflow: 'auto', flex: 1 }}>
          {!list ? <Empty>Loading…</Empty> : !rows.length ? <Empty>{running ? 'Waiting for conversations…' : 'No recorded conversations yet. Start or step the simulation.'}</Empty> : rows.map((e) => (
            <button key={e.id} className={`ep-item ${e.id === id ? 'on' : ''}`} onClick={() => { setFocus(e.id); setStage(0); }}>
              <div className="row between"><span className="word" style={{ fontSize: 14 }}>{e.text || '⟨gesture⟩'}</span><span className={`tag ${e.success ? 'ok' : 'bad'}`}>{e.success ? (e.turns > 1 ? 'repaired' : 'understood') : 'failed'}</span></div>
              <div className="tiny muted">‘{e.translation}’</div>
              <div className="tiny muted mono">y{yearOf(e.tick)} · #{e.speaker}→#{e.listener} · {e.sSet === e.lSet ? e.sSet : `${e.sSet}→${e.lSet}`} · {e.kind}</div>
            </button>
          ))}
        </div>
      </div>
      <div style={{ minWidth: 0 }}>
        {!ep ? <Empty>Select a conversation.</Empty> : <Episode ep={ep} stage={stage} setStage={setStage} />}
      </div>
    </div>
  );
}

function Episode({ ep, stage, setStage }: { ep: Ep; stage: number; setStage: (n: number) => void }) {
  const focusAgent = useSim((s) => s.focusAgent);
  const [turn, setTurn] = useState(0);
  const t = ep.turns[Math.min(turn, ep.turns.length - 1)];
  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <div className="eyebrow">Conversation #{ep.id} · year {yearOf(ep.tick)} · {ep.kind === 'family' ? 'child-directed / family' : ep.kind === 'contact' ? 'between communities' : 'peers'}</div>
          <h2>
            <a className="link" onClick={() => focusAgent(ep.speaker)}>Speaker #{ep.speaker}</a> <span className="muted">({ep.sSetName})</span> talks to <a className="link" onClick={() => focusAgent(ep.listener)}>listener #{ep.listener}</a> <span className="muted">({ep.lSetName})</span>
          </h2>
        </div>
        <div className="row">
          <span className={`tag ${ep.success ? 'ok' : 'bad'}`}>{ep.success ? `understood in ${ep.turns.length} turn${ep.turns.length > 1 ? 's' : ''}` : 'not understood'}</span>
          <span className="tag">fidelity {pct(ep.fidelity)}</span>
          {ep.novel && <span className="tag proxy" title="The listener had never encountered this combination of verb and participants">novel combination</span>}
        </div>
      </div>
      <div className="stages">
        {STAGES.map((s, i) => (
          <button key={i} className={`stage ${i === stage ? 'on' : i < stage ? 'done' : ''}`} onClick={() => setStage(i)}>
            <div className="n">{i + 1}</div><div className="t">{s.t}</div><div className="tiny" style={{ opacity: 0.7 }}>{s.d}</div>
          </button>
        ))}
      </div>
      {ep.turns.length > 1 && (stage === 1 || stage === 2 || stage === 3) && (
        <div className="row">
          <span className="small muted">Turn:</span>
          <div className="seg">{ep.turns.map((_, i) => <button key={i} className={turn === i ? 'on' : ''} onClick={() => setTurn(i)}>{i === 0 ? 'First attempt' : `Repair ${i}`}</button>)}</div>
        </div>
      )}
      {stage === 0 && <Intention ep={ep} />}
      {stage === 1 && <UtteranceStage ep={ep} t={t} />}
      {stage === 2 && <InterpretationStage ep={ep} t={t} />}
      {stage === 3 && <Outcome ep={ep} />}
      {stage === 4 && <Learning ep={ep} />}
      <div className="row between">
        <button className="btn" disabled={stage === 0} onClick={() => setStage(stage - 1)}>← Previous step</button>
        <button className="btn primary" disabled={stage === 4} onClick={() => setStage(stage + 1)}>Next step →</button>
      </div>
    </div>
  );
}

function Knowledge({ title, k }: { title: string; k: Ep['speakerKnowledge'] }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 4 }}>{title}</div>
      <table className="t"><tbody>
        {k.map((c) => (
          <tr key={c.concept}><td><b>{c.concept}</b></td><td>{c.forms.length ? c.forms.map((f, i) => <span key={i} style={{ marginRight: 10, opacity: i ? 0.6 : 1 }}><span className="word">{f.roman}</span> <span className="mono tiny muted">{f.score.toFixed(2)}</span></span>) : <span className="muted small">no word</span>}</td></tr>
        ))}
      </tbody></table>
    </div>
  );
}

function Intention({ ep }: { ep: Ep }) {
  return (
    <div className="grid cols-2">
      <Panel title="The shared situation" eyebrow="Both agents see these scenes; the speaker must single out the target">
        <div className="stack" style={{ gap: 6 }}>
          {ep.contextText.map((c, i) => (
            <div key={i} className={`scene ${i === targetOf(ep) ? 'target' : ''}`}>
              <span className="mono tiny muted">{String.fromCharCode(65 + i)}</span>
              <span>{c}</span>
              <span className="score">{i === targetOf(ep) ? 'target' : KIND[ep.distractorKinds[i]] ?? ep.distractorKinds[i]}</span>
            </div>
          ))}
        </div>
        <p className="tiny muted" style={{ marginTop: 8 }}>Most distractors are minimal pairs of the target (only one feature differs). This is what creates pressure for word order and grammatical markers: words alone cannot tell “the wolf chases the child” from “the child chases the wolf”.</p>
      </Panel>
      <Panel title="What the speaker knows" eyebrow="Strongest associations for the concepts involved">
        <Knowledge title={`Speaker #${ep.speaker}`} k={ep.speakerKnowledge} />
        {ep.speakerOrder && <div className="small" style={{ marginTop: 8 }}>Word-order preference: {ep.speakerOrder.map((w, i) => ({ w, o: ['SOV', 'SVO', 'VSO', 'VOS', 'OVS', 'OSV'][i] })).sort((a, b) => b.w - a.w).slice(0, 3).map((x) => `${x.o} ${pct(x.w)}`).join(' · ')}</div>}
      </Panel>
    </div>
  );
}

function UWords({ t, heard }: { t: Ep['turns'][number]; heard?: boolean }) {
  return (
    <div className="utter">
      {t.words.map((w, i) => (
        <div key={i} className={`uword ${w.gesture >= 0 ? 'gesture' : ''}`}>
          <span className="w">{w.gesture >= 0 ? `✋ ${w.gestureConcept}` : heard ? w.heardRoman : w.roman}</span>
          <span className="g">{w.gesture >= 0 ? 'gesture' : w.morphs.map((m) => m.gloss).join('-')}</span>
          <span className="r">{ROLE[w.role] ?? w.role}</span>
        </div>
      ))}
    </div>
  );
}

function UtteranceStage({ ep, t }: { ep: Ep; t: Ep['turns'][number] }) {
  void ep;
  return (
    <div className="grid cols-2">
      <Panel title="What the speaker said" eyebrow={`Word order used: ${t.orderName}`}>
        <UWords t={t} />
        <div className="divider" />
        <table className="t">
          <thead><tr><th>Morph</th><th>Meaning</th><th>Type</th><th>How chosen</th><th>Competitors</th></tr></thead>
          <tbody>
            {t.words.flatMap((w, wi) => w.morphs.map((m, mi) => (
              <tr key={`${wi}-${mi}`}>
                <td className="word">{m.roman}{m.form !== m.under && <span className="tiny muted" title="Stored form differs from pronunciation because of the speaker's accent (active sound changes)"> ← {m.under}</span>}</td>
                <td><b>{m.gloss}</b></td>
                <td className="small">{m.kind}{m.kind !== 'stem' ? ` (${['prefix', 'suffix', 'particle before', 'particle after'][m.strategy]})` : ''}</td>
                <td className="small">{m.how === 'invented' ? <span className="tag proxy">invented now</span> : m.how === 'extended' ? <span className="tag">meaning extended</span> : `known (${m.score.toFixed(2)})`}</td>
                <td className="small">{m.alts?.length ? m.alts.map((a, i) => <span key={i} style={{ marginRight: 8 }}><span className="word">{a.roman}</span> <span className="mono tiny muted">{a.score.toFixed(2)}</span></span>) : <span className="muted">—</span>}</td>
              </tr>
            )))}
          </tbody>
        </table>
      </Panel>
      <Panel title="Why this form?">
        <ul className="small" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.6 }}>
          <li>For each concept the speaker uses its strongest word, occasionally exploring a weaker synonym.</li>
          <li>With no word at all, it extends a related word’s meaning, invents a new form from its own sound habits, or gestures.</li>
          <li>Constituents are ordered by the speaker’s dominant word order; modifiers and places follow their own learned positions.</li>
          <li>Grammatical meanings (plural, past, negation…) are marked only if the speaker has a marker strong enough; otherwise left to context.</li>
          <li>The pronounced form passes through the speaker’s accent: the sound-change rules it has adopted, applied word by word.</li>
        </ul>
      </Panel>
    </div>
  );
}

function InterpretationStage({ ep, t }: { ep: Ep; t: Ep['turns'][number] }) {
  const it = t.interpretation;
  return (
    <div className="grid cols-2">
      <Panel title="What the listener heard" eyebrow="After perception noise and accent">
        <UWords t={t} heard />
        <div className="divider" />
        <table className="t">
          <thead><tr><th>Heard</th><th>Segmented</th><th>Recognised as</th><th>Match</th><th>Other candidates</th><th>Role</th></tr></thead>
          <tbody>
            {t.analysis.map((a, i) => (
              <tr key={i}>
                <td className="word">{a.heard || '✋'}</td>
                <td className="mono tiny">{a.pre && <span className="muted">{a.pre}-</span>}{a.stem}{a.suf && <span className="muted">-{a.suf}</span>}{a.marks.length > 0 && <span className="tag" style={{ marginLeft: 4 }}>{a.marks.join(',')}</span>}</td>
                <td>{a.gesture ? <span className="tag">gesture: {a.gesture}</span> : a.chosen ? <b>{a.chosen}</b> : <span className="muted">unknown</span>}</td>
                <td style={{ width: 90 }}>{a.chosen && !a.gesture ? <div className="row"><Bar value={a.conf} /><span className="mono tiny">{a.conf.toFixed(2)}</span></div> : null}</td>
                <td className="small">{a.senses.filter((s) => s.concept !== a.chosen).map((s) => `${s.concept} ${s.conf.toFixed(2)}`).join(', ') || '—'}</td>
                <td className="small">{ROLE[a.role] ?? a.role}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Panel>
      <div className="stack" style={{ gap: 14 }}>
        <Panel title="The listener’s reading" eyebrow="Roles assigned by word order, markers and plausibility">
          <table className="t"><tbody>
            <tr><td>Action</td><td><b>{it.verb}</b></td></tr>
            <tr><td>Agent (who)</td><td><b>{it.agent}</b></td></tr>
            {it.patient && <tr><td>Patient (whom/what)</td><td><b>{it.patient}</b></td></tr>}
            {it.recipient && <tr><td>Recipient</td><td><b>{it.recipient}</b></td></tr>}
            {it.location && <tr><td>Place</td><td><b>{it.location}</b></td></tr>}
            <tr><td>Tense / polarity / mood</td><td>{it.tense}{it.neg ? ', negated' : ''}{it.q ? ', question' : ''}</td></tr>
          </tbody></table>
        </Panel>
        <Panel title="What the listener knows">
          <Knowledge title={`Listener #${ep.listener}`} k={ep.listenerKnowledge} />
        </Panel>
      </div>
    </div>
  );
}

function Outcome({ ep }: { ep: Ep }) {
  return (
    <div className="grid cols-2">
      {ep.turns.map((t, ti) => (
        <Panel key={ti} title={ti === 0 ? 'First attempt' : `Repair turn ${ti}`} eyebrow={ti > 0 ? 'Speaker adds gestures for words the listener did not get' : 'Listener scores every scene against its reading'}>
          <div className="stack" style={{ gap: 6 }}>
            {ep.contextText.map((c, i) => {
              const max = Math.max(...t.scores, 1e-9);
              return (
                <div key={i} className={`scene ${i === targetOf(ep) ? 'target' : ''} ${t.choice === i ? 'chosen' : ''}`}>
                  <span className="mono tiny muted">{String.fromCharCode(65 + i)}</span>
                  <span style={{ flex: 1 }}>{c}</span>
                  <div style={{ width: 70 }}><Bar value={t.scores[i] / max} color={i === targetOf(ep) ? 'var(--sage)' : 'var(--terracotta)'} /></div>
                  <span className="score">{t.scores[i]?.toFixed(2)}{t.choice === i ? ' ← chosen' : ''}</span>
                </div>
              );
            })}
          </div>
          <div className="small" style={{ marginTop: 8 }}>
            {t.choice === targetOf(ep) ? <span className="tag ok">correct scene</span> : t.choice < 0 ? <span className="tag bad">no confident choice: asks for clarification</span> : <span className="tag bad">misunderstanding</span>}
          </div>
        </Panel>
      ))}
      <Panel title="Result">
        <p className="small" style={{ marginTop: 0 }}>
          {ep.success ? (ep.turns.length > 1 ? 'Understanding was reached only after repair, so learning is weaker than for a first-try success.' : 'Understood at the first attempt: both agents strongly reinforce the words and constructions they used.') : 'Communication failed: the speaker weakens the words it used, and both register which distinctions caused confusion (this builds pressure for new grammatical markers).'}
        </p>
        <div className="small">Comprehension fidelity <b>{pct(ep.fidelity)}</b> <InfoTip def="Fraction of the target’s features (action, participants, number, tense, negation…) that the listener’s final reading got right, regardless of which scene was chosen." /></div>
      </Panel>
    </div>
  );
}

function Learning({ ep }: { ep: Ep }) {
  const S = ep.updates.filter((u) => u.who === 'S'), L = ep.updates.filter((u) => u.who === 'L');
  const Table = ({ rows }: { rows: Ep['updates'] }) => !rows.length ? <Empty>No change.</Empty> : (
    <table className="t">
      <thead><tr><th>Change</th><th>Meaning</th><th>Form</th><th>Strength</th></tr></thead>
      <tbody>
        {rows.map((u, i) => {
          const up = u.after >= u.before;
          return (
            <tr key={i}>
              <td className="small">{u.kind}</td>
              <td><b>{u.concept}</b></td>
              <td className="word">{u.roman}</td>
              <td className="mono tiny" style={{ color: up ? 'var(--success)' : 'var(--danger)' }}>{u.before.toFixed(2)} → {u.after.toFixed(2)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
  return (
    <div className="grid cols-2">
      <Panel title={`Speaker #${ep.speaker}`} eyebrow="Reinforcement, lateral inhibition of synonyms, marker pressure"><Table rows={S} /></Panel>
      <Panel title={`Listener #${ep.listener}`} eyebrow="Word learning from context, gestures and syntax; order and accent alignment"><Table rows={L} /></Panel>
    </div>
  );
}
