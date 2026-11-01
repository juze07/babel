# BABEL: The Evolution of Language

BABEL is a browser-based multi-agent simulation in which a few hundred autonomous speakers, who start with no shared language, develop languages from scratch through repeated communication. Vocabulary, word order, grammatical markers, accents, dialects, separate languages and language families emerge from local interactions. Nothing linguistic is pre-assigned.

Every run is deterministic: the same seed and configuration reproduce the same history, and a restored snapshot continues exactly as the original would have. No external AI services are used.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 32 unit tests and controlled experiments (about 20 s)
npm run typecheck
npm run build      # static site in dist/
```

Press **Start** (or Space) to run. The `.` key steps one season (4 seasons = 1 year).

## What you can do

| Page | Purpose |
|---|---|
| **World** | Animated 2D map: settlements, routes, travelling migrants, cross-community conversations and inferred language territories. Click a settlement or route to intervene (migration, epidemic, isolation, cutting or opening routes, trade). Includes a chronicle of events. |
| **Atlas** | Family tree over time, similarity heatmaps (intelligibility, cognates, lexical, phonological, grammatical), language network, core-vocabulary comparison with cognate sets, grammatical typology and sound systems. |
| **Languages** | Inspector for each language: example sentences generated live by a representative speaker's grammar (interlinear glosses), lexicon with IPA and loanword sources, phoneme charts, word order and markers, dialects, relatives, history and the core list through time. |
| **Microscope** | Step through real recorded conversations in 5 stages (intention, utterance, interpretation, outcome, learning), including the exact association changes in both minds. |
| **Agents** | Explore individuals: mental lexicon with competing forms, grammar weights, accent, traits, social network, memory and learning log. Follow an agent on the map. |
| **Metrics** | 36 metrics with formulas, each labelled *direct measure* or *proxy*, with meaning, limitations, history charts and CSV export. |
| **Laboratory** | Experiments A–E (geographic isolation, population mixing, innovation vs imitation, generational learning, contact and borrowing). Configure conditions, run several seeds in parallel workers, compare averaged trajectories, check testable expectations, save results (IndexedDB), compare saved experiments and export CSV or JSON. Branch from a saved snapshot to explore alternative futures from identical starting conditions. |
| **Methods** | Full documentation of the model, its abstractions and its limitations. |

Snapshots (top bar) save the complete state, including every agent's mind and the RNG state. They can be restored, exported as JSON and imported again.

## Architecture

```
src/
  simulation/            engine (plain TypeScript, no UI dependencies)
    core/                seeded RNG, configuration
    world/               terrain, biomes, settlements, least-cost routes, contact matrix
    agents/              agent model, individual lexicon
    language/            concepts and scenes, phonology, sound change
    communication/       the language game: production, perception, interpretation, learning
    evolution/           lects, measured intelligibility, language identification, phylogeny
    metrics/             metric definitions (formula, kind, limitations) and sampling
    engine/              Simulation class (step loop, demography, interventions, snapshots), view models
    testing/             closed-group harness used by tests
  workers/               simulation worker (time-budgeted loop) and experiment worker pool
  persistence/           IndexedDB storage for snapshots and experiments
  store/                 zustand stores (live simulation, laboratory)
  pages/, components/, visualizations/   React UI (canvas map, SVG charts)
```

The engine runs inside a Web Worker. The UI receives compact frames (agent positions as a transferable `Float32Array`, about 8 per second) and fetches detailed views on demand.

## Model in brief

- **Agents** hold a private lexicon of weighted form–meaning associations (synonyms, homonyms and polysemy allowed, limited memory, decay), grammar weights (6 basic orders, modifier and oblique position, 4 morphological strategies for 8 grammatical meanings), an accent (adopted sound-change rules) and inherited cognitive traits.
- **Communication episode**: shared context of 4 scenes, mostly minimal pairs of the target. The speaker selects words and constructions, produces an utterance through its accent, the listener perceives it with noise, segments and parses it, and picks a scene. One repair turn with gestures is allowed. Both agents then learn (reinforcement with lateral inhibition, word learning from gestures, elimination, syntactic bootstrapping and cross-situational statistics, word-order alignment, affix discovery from residues, pressure for markers from minimal-pair failures).
- **Sound change**: conditioned rules from a typology of common processes, actuated locally, spread by imitation and prestige, applied word by word (lexical diffusion) and lexicalised by learners.
- **Languages are measured, not assigned**: test games between communities (learning and gestures off) give relative intelligibility. Combined with cognate share and smoothed, it drives average-linkage clustering with a configurable threshold. Clusters are tracked over time to detect splits, mergers, extinctions and new families.
- **Demography**: births limited by food and capacity, Gompertz mortality, migration along least-cost routes, family and peer transmission.

See the **Methods** page in the app for the full description and caveats.

## Tests

`npm test` runs unit tests for lexical learning, grammar acquisition (word order and affix discovery), phonological change, semantic interpretation, communication success and compositional generalisation, cultural transmission, migration, dialect divergence, language identification, metrics and snapshot restoration, plus controlled experiments:

- repeated interaction makes communication more efficient;
- isolation increases divergence between groups that once shared a language;
- extreme forgetting reduces lexical stability and understanding;
- contact and mixing keep communities more intelligible and increase borrowing.

These experiments encode testable expectations of the model, averaged over seeds. They are not claims about real languages.

## Known limitations

- Populations are small and lifetimes compressed, so change is faster and noisier than in real languages.
- The meaning space is closed (64 content concepts and 8 grammatical meanings).
- Grammar is parametric: no recursion, agreement or inflection classes.
- Language boundaries depend on a threshold, as in real dialect continua; the family tree is a reconstruction from simulated measurements.
- Speed is roughly 5 to 12 simulated years per second in a typical browser for about 250 agents.

## Dev scripts

`scripts/` holds headless tools used during development: `probe.ts` (metrics over a long run), `bench.ts`, `wl.ts` (word-length diagnostics), `shot.cjs` (Playwright screenshots). Bundle a script with esbuild and run it with Node, for example:

```bash
npx esbuild scripts/probe.ts --bundle --platform=node --outfile=/tmp/probe.cjs && T=800 node /tmp/probe.cjs
```
