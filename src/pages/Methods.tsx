import { useState, type ReactNode } from 'react';
import { METRIC_DEFS } from '../simulation/metrics/metrics';
import { useSim } from '../store/store';

interface Section { id: string; title: string; body: ReactNode }

const S: Section[] = [
  {
    id: 'overview', title: 'What BABEL is',
    body: (
      <>
        <p>BABEL is an agent-based model in which a few hundred simulated speakers, starting with no shared language, play repeated <em>language games</em> about scenes in their environment. Words, word order, grammatical markers, accents, dialects and eventually separate languages and families emerge from these local interactions. Nothing linguistic is pre-assigned to a population: every word is coined by some agent and every convention spreads (or dies) through use.</p>
        <p>The model is deterministic. All randomness comes from a seeded <code>mulberry32</code> generator whose 32-bit state is saved in snapshots, so the same seed and configuration always reproduce the same history, and a restored snapshot continues exactly as the original would have. There are no external AI services.</p>
        <p><b>Architecture.</b> The engine (<code>src/simulation</code>) is plain TypeScript with no UI dependencies. It runs in a Web Worker; the React interface receives compact view models (positions as a transferable <code>Float32Array</code>, summaries, and on-demand queries). Experiments run in a separate pool of workers. Snapshots and experiment results are stored in IndexedDB.</p>
      </>
    ),
  },
  {
    id: 'world', title: 'World and environment',
    body: (
      <>
        <p>The world is a 192×120 grid generated from fractal value noise shaped by the preset (Archipelago, Continent, Isolated Valley, Trading Network or Custom). Height and moisture give biomes (sea, coast, grassland, forest, hills, mountain, snow, desert). Settlements are placed on habitable land with regional quotas. Travel costs come from Dijkstra least-cost paths in which mountains are expensive and sea crossings carry a fixed penalty; each settlement links to its nearest neighbours, plus configured trade routes.</p>
        <p>The contact between two settlements is <code>exp(−cost / contactRange)</code>, boosted on trade routes, zero across blocked routes or for isolated settlements, and raised during the first years of initial mixing. The environment changes over time: climate drifts per settlement, and harvests change food supply and therefore births, deaths and migration pressure.</p>
        <p>Each settlement has a <em>salience</em> vector over the 64 concepts derived from its biomes (fish are salient on coasts, snow in mountains). Scenes are sampled with that salience, so communities talk about different things. Concepts that are rarely salient tend to lose their words.</p>
      </>
    ),
  },
  {
    id: 'agents', title: 'Agents and cognition',
    body: (
      <>
        <p>Each agent has an identity, age, family, settlement, a social network (family, friends and trade partners with tie strengths), episodic memory of recent conversations, a learning log, and its own:</p>
        <ul>
          <li><b>Lexicon.</b> A set of weighted form–meaning associations <code>(form, concept, score ∈ [0,1], uses, successes, etymon)</code>. Several forms may compete for one concept (synonymy) and one form may serve several concepts (homonymy or polysemy). Capacity is limited by <code>memoryCapacity</code>; unused associations decay at the <code>forgetting</code> rate and the weakest are lost when capacity is exceeded.</li>
          <li><b>Grammar.</b> Weights over the six basic orders (SOV, SVO, VSO, VOS, OVS, OSV), modifier–noun order, oblique position, and for each of 8 grammatical meanings (plural, past, future, negation, question, patient, recipient, locative) weights over four strategies (prefix, suffix, particle before, particle after), plus an accumulated <em>need</em> for each meaning.</li>
          <li><b>Accent.</b> The conditioned sound-change rules it applies, each with a strength, plus familiarity with other accents (which makes them easier to understand).</li>
          <li><b>Traits.</b> Memory capacity, learning rate, imitation, innovation, confidence, attention, forgetting, sociability, prestige and mobility. Children inherit the parental mean with mutation.</li>
        </ul>
        <p className="muted">Abstraction: cognition is reduced to association strengths and a handful of tendencies. There is no theory of mind beyond assuming a shared visual context.</p>
      </>
    ),
  },
  {
    id: 'semantics', title: 'Meaning: concepts and scenes',
    body: (
      <>
        <p>The meaning space has 64 content concepts (objects, animals, people, kin, actions, places, properties, emotions, abstractions), each with semantic tags, a base frequency and biome affinities, plus 8 grammatical meanings. Semantic similarity is the Jaccard overlap of tags; concepts with similarity ≥ 0.5 are “neighbours” for metaphorical extension.</p>
        <p>A scene is a structured predicate frame: <code>{'{verb, agent, patient?, recipient?, location?, tense, negation, question}'}</code>, where each participant is an entity with a head noun, an optional property and a number. Verbs have valence specifications, so “give” takes a recipient and “sleep” takes no patient. Scenes include modifiers, places, tense, negation and questions at fixed rates, so the same pressures act on every community from the start.</p>
      </>
    ),
  },
  {
    id: 'episode', title: 'The communication episode',
    body: (
      <>
        <ol>
          <li><b>Observe.</b> Both agents share a context of 4 scenes; one is the target. About 75% of distractors are <em>minimal pairs</em> of the target, differing in one feature: roles swapped, another agent, patient or verb, tense, negation, number, property or place.</li>
          <li><b>Intend.</b> The speaker forms the intention to single out the target.</li>
          <li><b>Select.</b> For each concept, it uses its strongest word, occasionally exploring a weaker synonym. If it has no word, it extends a semantically related word, invents a new form from its own sound habits, or plans a gesture. Grammatical meanings are marked only if it has a marker strong enough; markers are invented only under accumulated need.</li>
          <li><b>Produce.</b> Constituents are ordered by the speaker’s dominant order; affixes and particles are attached according to their strategies; the speaker’s accent rules are applied word by word.</li>
          <li><b>Hear.</b> The listener perceives the utterance through noise: each segment may be confused with a featurally close one.</li>
          <li><b>Infer.</b> Each heard word is matched to the listener’s lexicon by exact match, segmentation with known affixes, or fuzzy matching. Fuzzy matching uses a feature-weighted Levenshtein distance; its threshold relaxes with familiarity with the speaker’s accent and with attention. Roles are assigned from word order, markers and plausibility, giving a reading that is scored against every scene.</li>
          <li><b>Evaluate.</b> If the chosen scene is the target, communication succeeded. Otherwise the listener signals non-understanding and the speaker gets <em>one repair turn</em>: it repeats the utterance, adding gestures for concepts the listener did not recognise. Gestures convey a concept with probability <code>gestureClarity</code>, so they work best for concrete things.</li>
          <li><b>Update.</b> Both agents learn from the outcome (see next section).</li>
        </ol>
        <p>The Microscope page shows these steps for real recorded episodes, including the speaker’s alternatives, the listener’s candidate senses and the exact association changes.</p>
      </>
    ),
  },
  {
    id: 'learning', title: 'Learning, alignment and memory',
    body: (
      <>
        <ul>
          <li><b>Reinforcement and lateral inhibition</b> (naming-game dynamics). On success the speaker strengthens the words it used and weakens their synonyms; the listener does the same for the words it recognised. A first-try success teaches more than a repaired one. Failure weakens the speaker’s words.</li>
          <li><b>Credit assignment.</b> The speaker sees which scene the listener chose, so a word that was understood still gets some credit even when the game failed for another reason.</li>
          <li><b>Word learning.</b> Unknown words are learned from gestures (ostensive learning), from elimination when only one concept is unaccounted for, from <em>syntactic bootstrapping</em> (the role slot predicts the meaning when the order is known) and, weakly, by cross-situational association.</li>
          <li><b>Grammar acquisition.</b> Listeners shift their order weights toward orders consistent with the parse they made, and do the same for modifier and oblique positions. Residues left after recognising a known stem (e.g. <code>-ka</code> on a plural noun) are hypothesised as affixes for the grammatical meaning the scene shows; short leftover words become particles.</li>
          <li><b>Functional pressure.</b> When a game fails on a minimal pair that differs in a grammatical feature (e.g. past vs present), both agents raise their need for that meaning. Markers are invented only when need is high, which is why grammar arrives after vocabulary.</li>
          <li><b>Alignment.</b> Listeners occasionally adopt the speaker’s pronunciation of a shared word (more often children, and more often for prestigious speakers). They also adopt accent rules and update accent familiarity.</li>
          <li><b>Decay.</b> Once a year all associations decay toward zero unless used; recently learned words are briefly protected.</li>
        </ul>
      </>
    ),
  },
  {
    id: 'phonology', title: 'Phonology and sound change',
    body: (
      <>
        <p>Word forms are strings over 26 segments with articulatory features (consonants: place, manner, voicing; vowels: height, backness, rounding). Feature distances define confusability, fuzzy recognition and natural classes. New words are invented from each agent’s <em>sound habits</em>, the segment frequencies it has heard, mixed with a universal markedness prior.</p>
        <p>Sound changes are conditioned rewrite rules drawn from a typology of common processes: intervocalic voicing and lenition, final devoicing, palatalisation before front vowels, debuccalisation (s → h, k → h), h-loss, rhotacism, vowel raising and lowering, loss of final vowels and consonants, cluster simplification and so on. Their life cycle:</p>
        <ol>
          <li><b>Actuation.</b> Rules are actuated in one settlement with probability <code>soundChangeRate</code> per year.</li>
          <li><b>Lexical diffusion.</b> A speaker applies the rule to a word only if <code>hashUnit(etymon, rule) &lt; strength</code>, so the same words change first everywhere and each speaker stays consistent.</li>
          <li><b>Spread.</b> Strength spreads by imitation, weighted by the speaker’s prestige.</li>
          <li><b>Lexicalisation.</b> Learners, especially children, store the surface forms they hear. The change then becomes part of the underlying lexicon and is permanent in that lineage.</li>
        </ol>
        <p className="muted">Abstraction: no stress, tone, syllable weight or phonetic gradience.</p>
      </>
    ),
  },
  {
    id: 'social', title: 'Social structure and demography',
    body: (
      <>
        <p>Partners are chosen from relations (weighted by tie strength), from co-residents, or with probability set by <code>externalContact</code> and the contact matrix, from other settlements. Parents and older relatives speak to children (child-directed speech, ages 1 to 14), so children learn mostly from family first and then from peers. Mortality follows a Gompertz hazard scaled to <code>lifespan</code>; births depend on food and capacity. Migration follows least-cost routes and is driven by mobility, food pressure and <code>migrationRate</code>; migrants are visible travelling on the map.</p>
        <p>Interventions (block or open routes, add trade, force migration, epidemic, isolate or reconnect a settlement, change parameters) take effect immediately and are logged in the chronicle.</p>
      </>
    ),
  },
  {
    id: 'languages', title: 'How languages are identified',
    body: (
      <>
        <p>Languages are <em>measured</em>, never assigned. Every analysis interval:</p>
        <ol>
          <li>Each settlement’s <b>lect</b> is computed: for each concept, the most common etymon among adult speakers (shown with its most common pronunciation), plus word-order, marker and phoneme profiles.</li>
          <li><b>Test games</b> are run between every ordered pair of settlements (6 per pair, learning and gestures disabled) to estimate how well speakers of one community understand another, relative to how well each community understands itself.</li>
          <li>This relative intelligibility is combined with the cognate share (0.65 / 0.35) and smoothed over time (exponential moving average) to reduce sampling noise.</li>
          <li>Settlements are clustered by average linkage at the <b>language threshold</b> (default 0.62), with hysteresis so boundaries do not flicker.</li>
          <li>Clusters are matched to the previous analysis by speaker overlap. A cluster that takes most of a language’s speakers continues it; a breakaway becomes a <b>daughter language</b> (a split); two languages falling into one cluster <b>merge</b>; a language with no speakers is <b>extinct</b>; a cluster with no predecessor founds a new <b>family</b>.</li>
        </ol>
        <p>Within a language, a settlement whose lexical distance from the language consensus exceeds the <b>dialect threshold</b> counts as a distinct dialect. Both thresholds can be changed in the world settings.</p>
        <p>A hidden <b>etymon registry</b> records where and when every word form was first coined. Agents never see it. It is used only to measure cognates, identify loanwords (an etymon from outside the borrowing language’s lineage) and classify semantic shifts.</p>
      </>
    ),
  },
  {
    id: 'metrics', title: 'Metrics',
    body: <MetricsTable />,
  },
  {
    id: 'limits', title: 'Limitations and honest caveats',
    body: (
      <ul>
        <li>Populations are small (hundreds) and lifetimes are compressed, so change is faster and noisier than in real languages.</li>
        <li>The meaning space is closed (72 meanings). Agents cannot create genuinely new concepts, only new words for existing ones.</li>
        <li>Grammar is a parametric abstraction: six orders, two positional choices and a four-way morphology strategy. There is no recursion, agreement, case paradigm or inflection class.</li>
        <li>The repair channel (gestures) is idealised and always available in normal conversation.</li>
        <li>Language boundaries depend on a threshold, as they do in real-world dialect continua. The family tree is a reconstruction from simulated measurements, not ground truth.</li>
        <li>Qualitative experiments (Laboratory) are testable expectations. With few seeds an observed difference is an indication, not a statistical result.</li>
      </ul>
    ),
  },
];

function MetricsTable() {
  const setPage = useSim((s) => s.setPage);
  return (
    <>
      <p>Every metric has a formula and is labelled either a <span className="tag direct">direct measure</span> (an exact property of the simulation) or a <span className="tag proxy">proxy</span> (an operationalisation of a richer linguistic notion). Live charts are on the <a className="link" onClick={() => setPage('metrics')}>Metrics</a> page.</p>
      <table className="t">
        <thead><tr><th>Metric</th><th>Kind</th><th>Formula</th><th>Limitation</th></tr></thead>
        <tbody>
          {METRIC_DEFS.map((d) => (
            <tr key={d.key}><td><b>{d.label}</b><div className="tiny muted">{d.group}</div></td><td><span className={`tag ${d.kind}`}>{d.kind}</span></td><td className="mono tiny">{d.formula}</td><td className="tiny">{d.limits}</td></tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function Methods() {
  const [active, setActive] = useState('overview');
  return (
    <div className="methods fade-in">
      <nav className="methods-toc">
        <div className="eyebrow" style={{ marginBottom: 8 }}>Methods</div>
        {S.map((s) => <a key={s.id} className={active === s.id ? 'on' : ''} onClick={() => { setActive(s.id); document.getElementById(`m-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{s.title}</a>)}
      </nav>
      <article className="methods-body">
        <h1>Methods and abstractions</h1>
        <p className="lede">How the simulation works, what each number means, and where the model simplifies reality.</p>
        {S.map((s) => (
          <section key={s.id} id={`m-${s.id}`}>
            <h2>{s.title}</h2>
            {s.body}
          </section>
        ))}
      </article>
    </div>
  );
}
