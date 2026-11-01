/**
 * SIMULATION ENGINE — orchestrates world, population, communication and analysis.
 * Fully deterministic given (config, seed, intervention sequence). UI-independent: runs in a Web Worker,
 * in Node tests, and in headless experiment batches.
 */
import { Rng, hash2 } from '../core/rng';
import { type SimConfig, TICKS_PER_YEAR } from '../core/config';
import { type Agent, createAgent, sampleTraits, ageYears, type Traits } from '../agents/agent';
import { Lexicon, type LexEntry } from '../agents/lexicon';
import { generateTerrain, placeSettlements, computeRoutes, computeContact, type Terrain, type Settlement, type Route, MAP_W } from '../world/geography';
import { runEpisode, type LangContext, type EpisodeRecord } from '../communication/episode';
import { actuateRule, type SoundRule } from '../language/soundChange';
import { N_CONCEPTS, N_CONTENT, CONCEPTS } from '../language/concepts';
import { NP } from '../language/phonology';
import { LanguageTracker } from '../evolution/languages';
import { computeSample, newCounters, type Counters, type MetricSample } from '../metrics/metrics';
import { romanize } from '../language/phonology';

export interface Etymon { form: string; concept: number; tick: number; lang: number; settlement: number }
export interface SimEvent { tick: number; type: string; text: string; lang?: number; other?: number; settlement?: number; parent?: number }

export type Intervention =
  | { kind: 'blockRoute'; route: number }
  | { kind: 'openRoute'; route: number }
  | { kind: 'addTrade'; a: number; b: number }
  | { kind: 'migrate'; from: number; to: number; count: number }
  | { kind: 'plague'; settlement: number; fraction: number }
  | { kind: 'isolate'; settlement: number }
  | { kind: 'reconnect'; settlement: number }
  | { kind: 'params'; params: Partial<SimConfig> & { traits?: Partial<SimConfig['traits']> } };

export class Simulation {
  cfg: SimConfig;
  rng: Rng;
  tick = 0;
  terrain!: Terrain;
  settlements: Settlement[] = [];
  routes: Route[] = [];
  travelCost!: Float64Array;
  contact!: Float64Array;
  isolated = new Set<number>();
  agents: Agent[] = [];
  agentById = new Map<number, Agent>();
  residents: Agent[][] = [];
  globalSalience!: Float64Array;
  nextAgent = 0;
  nextEtym = 0;
  nextRule = 0;
  nextEpisode = 0;
  etymons = new Map<number, Etymon>();
  rules = new Map<number, SoundRule>();
  tracker = new LanguageTracker();
  counters: Counters = newCounters();
  history: MetricSample[] = [];
  events: SimEvent[] = [];
  episodes: EpisodeRecord[] = [];
  lastEpisodes: { s: number; l: number; ok: boolean; cross: boolean }[] = [];
  interventions: { tick: number; action: Intervention }[] = [];
  follow = -1;
  prevLectEtyms = new Map<number, number[]>();
  mixingEnded = false;

  constructor(cfg: SimConfig, opts: { skipInit?: boolean } = {}) {
    this.cfg = structuredClone(cfg);
    this.rng = new Rng(cfg.seed);
    this.buildWorld();
    if (!opts.skipInit) this.initPopulation();
  }

  /* ================= world ================= */
  buildWorld() {
    // terrain uses its own RNG stream so it is identical whether or not we restore from a snapshot
    const wrng = new Rng(hash2(this.cfg.seed, 0x5eed));
    const { terrain } = generateTerrain(this.cfg, wrng);
    this.terrain = terrain;
    this.settlements = placeSettlements(this.cfg, wrng, terrain);
    const { routes, cost } = computeRoutes(this.cfg, wrng, terrain, this.settlements);
    this.routes = routes;
    this.travelCost = cost;
    this.residents = this.settlements.map(() => []);
    this.globalSalience = new Float64Array(N_CONTENT);
    for (const s of this.settlements) for (let c = 0; c < N_CONTENT; c++) this.globalSalience[c] += s.salience[c] / this.settlements.length;
    this.updateCapacity();
    this.recomputeContact();
  }

  get mixing() {
    return this.tick < this.cfg.initialMixingYears * TICKS_PER_YEAR;
  }

  recomputeContact() {
    this.contact = computeContact(this.cfg, this.settlements, this.travelCost, this.routes, this.mixing);
    const n = this.settlements.length;
    for (const s of this.isolated) for (let j = 0; j < n; j++) { this.contact[s * n + j] = 0; this.contact[j * n + s] = 0; }
  }

  updateCapacity() {
    const n = this.settlements.length;
    for (const s of this.settlements) {
      s.food = s.baseFood * s.climate * (1 + 0.15 * Math.sin((2 * Math.PI * this.tick) / TICKS_PER_YEAR + s.phase));
      s.capacity = Math.max(8, Math.round((this.cfg.maxPopulation / n) * (0.55 + 0.9 * s.baseFood) * s.climate));
    }
  }

  initPopulation() {
    const r = this.rng;
    this.settlements.forEach((s, si) => {
      const ov = this.cfg.groupOverrides.find((g) => g.settlements.includes(si));
      const means = { ...this.cfg.traits, ...(ov?.traits ?? {}) };
      const members: Agent[] = [];
      for (let k = 0; k < this.cfg.agentsPerSettlement; k++) {
        const ageY = r.range(0, 50);
        const a = createAgent(this.nextAgent++, r, si, -Math.round(ageY * TICKS_PER_YEAR), sampleTraits(r, means, this.cfg.traitVariance), 0);
        a.adultChecked = ageY >= 16;
        a.traits.prestige = Math.min(1, a.traits.prestige + ageY / 200);
        members.push(a);
        this.addAgent(a);
      }
      // families and friendships
      for (let i = 0; i < members.length; i += 5) {
        const fam = members.slice(i, i + 5);
        for (const x of fam) for (const y of fam) if (x !== y) x.relations.set(y.id, { w: 0.8, k: 0 });
      }
      for (const a of members) for (let f = 0; f < 3; f++) {
        const b = members[r.int(members.length)];
        if (b !== a && !a.relations.has(b.id)) { a.relations.set(b.id, { w: 0.3, k: 1 }); b.relations.set(a.id, { w: 0.3, k: 1 }); }
      }
    });
    this.rebuildResidents();
    this.addEvent('world', `${this.agents.length} agents begin without a shared language across ${this.settlements.length} settlements`);
  }

  addAgent(a: Agent) {
    this.agents.push(a);
    this.agentById.set(a.id, a);
  }

  rebuildResidents() {
    for (const r of this.residents) r.length = 0;
    for (const a of this.agents) if (!a.travel) this.residents[a.settlement].push(a);
  }

  /* ================= language context ================= */
  langCtx(learning: boolean, record: boolean): LangContext {
    return {
      tick: this.tick,
      cfg: this.cfg,
      rules: this.rules,
      learning,
      record,
      newEtym: (form, concept, agent) => {
        const id = this.nextEtym++;
        this.etymons.set(id, { form, concept, tick: this.tick, lang: agent.langId, settlement: agent.settlement });
        return id;
      },
      etymLang: (e) => this.etymLang(e),
      isForeign: (e, l) => this.isForeign(e, l),
      onBorrow: () => { this.counters.borrowings++; },
    };
  }

  etymLang(e: number): number {
    return this.etymons.get(e)?.lang ?? -1;
  }
  isForeign(e: number, lang: number): boolean {
    const src = this.etymLang(e);
    if (src < 0 || lang < 0) return false;
    return !this.tracker.lineage(lang).includes(src) && !this.tracker.lineage(src).includes(lang);
  }

  addEvent(type: string, text: string, extra: Partial<SimEvent> = {}) {
    this.events.push({ tick: this.tick, type, text, ...extra });
    if (this.events.length > 800) this.events.splice(0, this.events.length - 800);
  }

  /* ================= main loop ================= */
  step() {
    const wasMixing = this.mixing;
    this.environment();
    this.population();
    this.rebuildResidents();
    this.conversations();
    if (this.tick % TICKS_PER_YEAR === 0) this.yearly();
    this.tick++;
    if (wasMixing && !this.mixing) {
      this.recomputeContact();
      this.addEvent('world', 'The ancestral mixing period ends: geography now separates the communities');
    }
    if (this.tick % this.cfg.analysisInterval === 0) this.analyze();
  }

  run(ticks: number) {
    for (let i = 0; i < ticks; i++) this.step();
  }

  environment() {
    this.updateCapacity();
  }

  yearly() {
    const r = this.rng;
    // climate random walk & shocks
    for (const s of this.settlements) {
      s.climate += r.normal() * 0.03 + (1 - s.climate) * 0.08;
      if (r.chance(0.008)) {
        s.climate *= 0.7;
        if (this.residents[s.id].length) this.addEvent('environment', `Drought strikes ${s.name}: food supply falls`, { settlement: s.id });
      }
      if (r.chance(0.006)) {
        s.climate = Math.min(1.35, s.climate * 1.25);
        if (this.residents[s.id].length) this.addEvent('environment', `A run of good harvests around ${s.name}`, { settlement: s.id });
      }
      s.climate = Math.min(1.35, Math.max(0.5, s.climate));
    }
    // memory decay, forgetting and pruning
    for (const a of this.agents) {
      a.lex.decay(1 - a.traits.forgetting, a.traits.memoryCapacity, this.tick, TICKS_PER_YEAR * 2);
      for (let i = 0; i < NP; i++) a.habit[i] *= 0.85;
      for (const ar of a.accent) ar.strength *= 0.97;
      a.accent = a.accent.filter((x) => x.strength > 0.03);
      for (const [id, rel] of a.relations) {
        rel.w *= rel.k === 0 ? 0.995 : 0.94;
        if (rel.w < 0.04 && rel.k !== 0) a.relations.delete(id);
        else if (!this.agentById.has(id)) a.relations.delete(id);
      }
      for (const [s, f] of a.accentFam) a.accentFam.set(s, f * 0.95);
      const age = ageYears(a, this.tick, TICKS_PER_YEAR);
      a.traits.prestige = Math.min(1, Math.max(0, a.traits.prestige + (age < 45 ? 0.004 : -0.004) + (a.stats.okS / Math.max(1, a.stats.spoke) - 0.5) * 0.004));
      if (!a.adultChecked && age >= 16) { a.adultChecked = true; this.checkTransmission(a); }
    }
    // sound change actuation
    for (const s of this.settlements) {
      const res = this.residents[s.id];
      if (res.length < 6) continue;
      const innov = res.reduce((x, a) => x + a.traits.innovation, 0) / res.length;
      if (!r.chance(this.cfg.soundChangeRate * (0.5 + innov))) continue;
      const usage = new Float64Array(NP);
      for (const a of res) for (let i = 0; i < NP; i++) usage[i] += a.habit[i];
      const rule = actuateRule(r, this.nextRule++, usage, s.id, this.tick);
      if (!rule) continue;
      this.rules.set(rule.id, rule);
      const young = res.filter((a) => ageYears(a, this.tick, TICKS_PER_YEAR) < 30);
      const pool = young.length >= 3 ? young : res;
      const n = 2 + r.int(3);
      for (let k = 0; k < n; k++) {
        const a = pool[r.int(pool.length)];
        if (a.accent.some((x) => x.rule === rule.id)) continue;
        if (a.accent.length >= 8) a.accent.sort((x, y) => y.strength - x.strength).pop();
        a.accent.push({ rule: rule.id, strength: 0.35 + r.next() * 0.2 });
      }
      this.counters.soundChanges++;
    }
    // garbage-collect rules nobody uses
    if (this.tick % (TICKS_PER_YEAR * 10) === 0) {
      const used = new Set<number>();
      for (const a of this.agents) for (const x of a.accent) used.add(x.rule);
      for (const l of this.tracker.languages) for (const sn of l.snapshots) for (const rr of sn.rules) used.add(rr.id);
      for (const id of [...this.rules.keys()]) if (!used.has(id)) this.rules.delete(id);
    }
  }

  checkTransmission(a: Agent) {
    const parents = [this.agentById.get(a.mother), this.agentById.get(a.father)].filter(Boolean) as Agent[];
    if (!parents.length) return;
    let same = 0, n = 0;
    for (let c = 0; c < N_CONCEPTS; c++) {
      const pb = parents.map((p) => p.lex.best(c)).filter((e) => e && e.score >= 0.2) as LexEntry[];
      if (!pb.length) continue;
      n++;
      const cb = a.lex.best(c);
      if (cb && pb.some((p) => p.etym === cb.etym)) same++;
    }
    if (n >= 5) { this.counters.transmission += same / n; this.counters.transmissionN++; }
  }

  /* ================= population ================= */
  population() {
    const r = this.rng;
    const cfg = this.cfg;
    const t = this.tick;
    const B = 0.085;
    const A = (Math.LN2 * B) / (Math.exp(B * cfg.lifespan) - 1);
    const dead: Agent[] = [];
    const counts = this.settlements.map((_, i) => this.residents[i].length);
    for (const a of this.agents) {
      const age = (t - a.born) / TICKS_PER_YEAR;
      // arrivals
      if (a.travel && t >= a.travel.t1) {
        a.settlement = a.travel.to;
        a.travel = null;
        a.accentFam.set(a.settlement, Math.max(a.accentFam.get(a.settlement) ?? 0, 0.1));
      }
      const s = this.settlements[a.settlement];
      const crowd = counts[a.settlement] / Math.max(1, s.capacity);
      const hazard = (0.003 + A * Math.exp(B * age)) * (1 + Math.max(0, crowd - 1) * 1.5);
      if (r.chance(hazard / TICKS_PER_YEAR)) dead.push(a);
    }
    for (const a of dead) {
      a.alive = false; a.died = t;
      this.agentById.delete(a.id);
      this.counters.deaths++;
      if (a.id === this.follow) this.addEvent('agent', `Followed agent #${a.id} died aged ${ageYears(a, t, TICKS_PER_YEAR).toFixed(0)}`);
    }
    if (dead.length) this.agents = this.agents.filter((a) => a.alive);
    // births
    const total = this.agents.length;
    const babies: Agent[] = [];
    for (const a of this.agents) {
      if (a.travel) continue;
      const age = (t - a.born) / TICKS_PER_YEAR;
      if (age < 18 || age > 42) continue;
      const s = this.settlements[a.settlement];
      const room = Math.max(0, 1 - counts[a.settlement] / s.capacity) * Math.max(0, 1 - total / cfg.maxPopulation);
      if (!r.chance((cfg.birthRate / TICKS_PER_YEAR) * 0.5 * room * 2)) continue;
      // partner: strongest local adult tie, else random local adult
      let partner: Agent | undefined;
      let best = 0;
      for (const [id, rel] of a.relations) {
        const b = this.agentById.get(id);
        if (!b || b.settlement !== a.settlement || b.travel || rel.k === 0) continue;
        const ba = (t - b.born) / TICKS_PER_YEAR;
        if (ba < 18 || ba > 50) continue;
        if (rel.w > best) { best = rel.w; partner = b; }
      }
      if (!partner) {
        const local = this.residents[a.settlement].filter((b) => b !== a && (t - b.born) / TICKS_PER_YEAR >= 18);
        if (!local.length) continue;
        partner = local[r.int(local.length)];
      }
      const ov = cfg.groupOverrides.find((g) => g.settlements.includes(a.settlement));
      const means = { ...cfg.traits, ...(ov?.traits ?? {}) };
      const traits: Traits = sampleTraits(r, means, cfg.traitVariance, [a.traits, partner.traits]);
      const child = createAgent(this.nextAgent++, r, a.settlement, t, traits, Math.max(a.generation, partner.generation) + 1, a.id, partner.id);
      child.relations.set(a.id, { w: 1, k: 0 });
      child.relations.set(partner.id, { w: 1, k: 0 });
      a.relations.set(child.id, { w: 1, k: 0 });
      partner.relations.set(child.id, { w: 1, k: 0 });
      a.relations.set(partner.id, { w: Math.max(0.9, a.relations.get(partner.id)?.w ?? 0), k: 0 });
      partner.relations.set(a.id, { w: Math.max(0.9, partner.relations.get(a.id)?.w ?? 0), k: 0 });
      babies.push(child);
      counts[a.settlement]++;
    }
    for (const b of babies) { this.addAgent(b); this.counters.births++; }
    // migration
    const n = this.settlements.length;
    for (const a of this.agents) {
      if (a.travel) continue;
      const age = (t - a.born) / TICKS_PER_YEAR;
      if (age < 16 || age > 45) continue;
      const s = this.settlements[a.settlement];
      const pressure = 1 + 3 * Math.max(0, counts[a.settlement] / s.capacity - 0.85);
      if (!r.chance((cfg.migrationRate / TICKS_PER_YEAR) * a.traits.mobility * 2 * pressure)) continue;
      const w = new Float64Array(n);
      for (let j = 0; j < n; j++) {
        if (j === a.settlement) continue;
        const attract = this.settlements[j].capacity / (counts[j] + 4);
        w[j] = this.contact[a.settlement * n + j] * attract;
      }
      const to = r.weighted(w);
      if (to < 0) continue;
      const group = [a];
      for (const [id, rel] of a.relations) {
        const k = this.agentById.get(id);
        if (k && rel.k === 0 && !k.travel && k.settlement === a.settlement && (t - k.born) / TICKS_PER_YEAR < 14 && r.chance(0.7)) group.push(k);
      }
      this.startTravel(group, to);
    }
  }

  startTravel(group: Agent[], to: number) {
    const from = group[0].settlement;
    const n = this.settlements.length;
    const cost = this.travelCost[from * n + to];
    const dur = Math.max(1, Math.min(14, Math.round(cost / 45)));
    const route = this.routes.find((rt) => (rt.a === from && rt.b === to) || (rt.a === to && rt.b === from));
    let path: number[];
    if (route) {
      path = route.path.slice();
      // route.path runs from b back to a; orient so it starts at `from`
      const sx = this.settlements[from].x, sy = this.settlements[from].y;
      if (Math.hypot(path[0] - sx, path[1] - sy) > Math.hypot(path[path.length - 2] - sx, path[path.length - 1] - sy)) {
        const rev: number[] = [];
        for (let i = path.length - 2; i >= 0; i -= 2) rev.push(path[i], path[i + 1]);
        path = rev;
      }
    } else path = [this.settlements[from].x, this.settlements[from].y, this.settlements[to].x, this.settlements[to].y];
    for (const a of group) {
      a.travel = { from, to, t0: this.tick, t1: this.tick + dur, path };
      this.counters.migrations++;
    }
    if (group.length >= 3) this.addEvent('migration', `${group.length} people set out from ${this.settlements[from].name} towards ${this.settlements[to].name}`, { settlement: to });
  }

  /* ================= conversations ================= */
  choosePartner(sp: Agent): { li: Agent; kind: EpisodeRecord['kind'] } | null {
    const r = this.rng;
    const s = sp.settlement;
    const n = this.settlements.length;
    let ext = 0;
    for (let j = 0; j < n; j++) if (j !== s && this.residents[j].length) ext += this.contact[s * n + j];
    const pExt = Math.min(0.6, this.cfg.externalContact * ext * (0.5 + sp.traits.sociability));
    if (r.chance(pExt)) {
      const w = new Float64Array(n);
      for (let j = 0; j < n; j++) if (j !== s && this.residents[j].length) w[j] = this.contact[s * n + j] * Math.sqrt(this.residents[j].length);
      const j = r.weighted(w);
      if (j >= 0) {
        const pool = this.residents[j];
        const li = pool[r.int(pool.length)];
        if (li && (this.tick - li.born) / TICKS_PER_YEAR >= 2) return { li, kind: 'contact' };
      }
    }
    if (sp.relations.size && r.chance(0.55)) {
      let tot = 0;
      const cands: Agent[] = [], ws: number[] = [];
      for (const [id, rel] of sp.relations) {
        const b = this.agentById.get(id);
        if (!b || b.travel) continue;
        const w = b.settlement === s ? rel.w : rel.w * 0.25 * this.contact[s * n + b.settlement];
        if (w <= 0) continue;
        cands.push(b); ws.push(w); tot += w;
      }
      if (tot > 0) {
        const k = r.weighted(ws);
        return { li: cands[k], kind: cands[k].settlement === s ? (sp.relations.get(cands[k].id)!.k === 0 ? 'family' : 'peer') : 'contact' };
      }
    }
    const pool = this.residents[s];
    if (pool.length < 2) return null;
    let li = pool[r.int(pool.length)];
    if (li === sp) li = pool[r.int(pool.length)];
    if (li === sp) return null;
    return { li, kind: 'peer' };
  }

  conversations() {
    const r = this.rng;
    const t = this.tick;
    const speakers = this.agents.filter((a) => !a.travel && (t - a.born) / TICKS_PER_YEAR >= 3);
    r.shuffle(speakers);
    const recordEvery = Math.max(1, Math.round(speakers.length / 2));
    let k = 0;
    this.lastEpisodes = [];
    const cpt = this.cfg.conversationsPerTick;
    for (const sp of speakers) {
      let turns = Math.floor(cpt) + (r.chance(cpt - Math.floor(cpt)) ? 1 : 0);
      while (turns-- > 0) {
        const p = this.choosePartner(sp);
        if (!p) continue;
        const record = (k++ % recordEvery === 0) || sp.id === this.follow || p.li.id === this.follow;
        this.episode(sp, p.li, p.kind, record);
      }
    }
    // child-directed speech: parents and kin talk to young children
    for (const ch of this.agents) {
      if (ch.travel) continue;
      const age = (t - ch.born) / TICKS_PER_YEAR;
      if (age < 1 || age >= 14) continue;
      const kin: Agent[] = [];
      for (const [id, rel] of ch.relations) {
        const b = this.agentById.get(id);
        if (b && rel.k === 0 && b.settlement === ch.settlement && !b.travel && (t - b.born) / TICKS_PER_YEAR >= 14) kin.push(b);
      }
      if (!kin.length) continue;
      const sp = kin[r.int(kin.length)];
      this.episode(sp, ch, 'family', ch.id === this.follow || sp.id === this.follow);
    }
  }

  episode(sp: Agent, li: Agent, kind: EpisodeRecord['kind'], record: boolean) {
    const ctx = this.langCtx(true, record);
    const sal = this.settlements[li.settlement].salience;
    const id = this.nextEpisode++;
    const res = runEpisode(sp, li, sal, ctx, this.rng, id, kind);
    const c = this.counters;
    c.episodes++;
    if (res.success) c.success++;
    if (res.success && res.turns === 1) c.firstTry++;
    if (res.misunderstood) c.misunderstood++;
    c.turns += res.success ? res.turns : 3;
    c.fidelity += res.fidelity;
    if (res.novel) { c.novel++; if (res.success && res.turns === 1) c.novelOk++; }
    else { c.familiar++; if (res.success && res.turns === 1) c.familiarOk++; }
    c.gestures += res.gestures;
    c.words += Math.max(1, res.text.split(' ').length);
    c.inventions += res.inventions;
    const cross = sp.settlement !== li.settlement;
    if (cross) { c.crossEpisodes++; if (res.success) c.crossOk++; }
    if (this.lastEpisodes.length < 60) this.lastEpisodes.push({ s: sp.id, l: li.id, ok: res.success, cross });
    const mem = (a: Agent, role: 'S' | 'L', partner: number) => {
      a.memory.push({ tick: this.tick, ep: res.record ? id : -1, partner, role, ok: res.success, text: res.text, gloss: res.gloss });
      if (a.memory.length > 14) a.memory.shift();
    };
    mem(sp, 'S', li.id);
    mem(li, 'L', sp.id);
    if (res.record) {
      this.episodes.push(res.record);
      if (this.episodes.length > 120) this.episodes.shift();
    }
  }

  /* ================= analysis ================= */
  analyze() {
    this.tracker.analyze(this);
    const sample = computeSample(this, this.counters, this.prevLectEtyms);
    this.prevLectEtyms = new Map(this.tracker.lects.map((l) => [l.settlement, l.etyms.slice()]));
    this.history.push(sample);
    if (this.history.length > 1500) {
      // keep long runs bounded: thin out older half
      const keep = this.history.filter((_, i) => i >= 750 || i % 2 === 0);
      this.history = keep;
    }
    this.counters = newCounters();
  }

  /* ================= interventions ================= */
  intervene(action: Intervention) {
    this.interventions.push({ tick: this.tick, action });
    const S = this.settlements;
    switch (action.kind) {
      case 'blockRoute': {
        const rt = this.routes[action.route];
        if (!rt) return;
        rt.blocked = true;
        this.addEvent('intervention', `Route ${S[rt.a].name} – ${S[rt.b].name} is cut off`);
        break;
      }
      case 'openRoute': {
        const rt = this.routes[action.route];
        if (!rt) return;
        rt.blocked = false;
        this.addEvent('intervention', `Route ${S[rt.a].name} – ${S[rt.b].name} reopened`);
        break;
      }
      case 'addTrade': {
        const { a, b } = action;
        if (a === b) return;
        const existing = this.routes.find((rt) => (rt.a === Math.min(a, b) && rt.b === Math.max(a, b)));
        if (existing) { existing.trade = true; existing.blocked = false; }
        else this.routes.push({ a: Math.min(a, b), b: Math.max(a, b), cost: this.travelCost[a * S.length + b], path: [S[Math.max(a, b)].x, S[Math.max(a, b)].y, S[Math.min(a, b)].x, S[Math.min(a, b)].y], sea: 0, trade: true, blocked: false });
        this.addEvent('intervention', `A trade route now links ${S[a].name} and ${S[b].name}`);
        break;
      }
      case 'migrate': {
        const pool = this.residents[action.from].filter((x) => (this.tick - x.born) / TICKS_PER_YEAR >= 14);
        const n = Math.min(action.count, pool.length);
        const group: Agent[] = [];
        for (let i = 0; i < n; i++) group.push(pool.splice(this.rng.int(pool.length), 1)[0]);
        if (group.length) this.startTravel(group, action.to);
        this.addEvent('intervention', `${group.length} people are sent from ${S[action.from].name} to ${S[action.to].name}`);
        break;
      }
      case 'plague': {
        const pool = this.residents[action.settlement];
        let killed = 0;
        for (const a of pool) if (this.rng.chance(action.fraction)) { a.alive = false; a.died = this.tick; this.agentById.delete(a.id); killed++; }
        this.agents = this.agents.filter((a) => a.alive);
        this.addEvent('intervention', `Epidemic in ${S[action.settlement].name}: ${killed} die`, { settlement: action.settlement });
        break;
      }
      case 'isolate':
        this.isolated.add(action.settlement);
        this.addEvent('intervention', `${S[action.settlement].name} is cut off from all contact`);
        break;
      case 'reconnect':
        this.isolated.delete(action.settlement);
        this.addEvent('intervention', `${S[action.settlement].name} is reconnected`);
        break;
      case 'params': {
        const { traits, ...rest } = action.params;
        const before = this.cfg.traits;
        Object.assign(this.cfg, rest);
        if (traits) {
          const delta: Record<string, number> = {};
          for (const k of Object.keys(traits) as (keyof typeof traits)[]) delta[k] = (traits[k] as number) - before[k];
          this.cfg.traits = { ...before, ...traits };
          // shift existing agents' traits by the same delta (cultural/environmental change)
          for (const a of this.agents) for (const k of Object.keys(delta) as (keyof typeof traits)[]) {
            const v = (a.traits[k] as number) + delta[k];
            (a.traits as unknown as Record<string, number>)[k] = k === 'memoryCapacity' ? Math.max(30, Math.round(v)) : Math.min(1, Math.max(0, v));
          }
        }
        this.addEvent('intervention', `Parameters changed: ${Object.keys({ ...rest, ...(traits ?? {}) }).join(', ')}`);
        break;
      }
    }
    this.rebuildResidents();
    this.recomputeContact();
  }

  /* ================= persistence ================= */
  serialize(): SimSnapshot {
    return {
      version: 1,
      cfg: this.cfg,
      tick: this.tick,
      rng: this.rng.s,
      settlements: this.settlements.map((s) => ({ ...s, salience: Array.from(s.salience) })),
      routes: this.routes,
      isolated: [...this.isolated],
      agents: this.agents.map(serializeAgent),
      nextAgent: this.nextAgent, nextEtym: this.nextEtym, nextRule: this.nextRule, nextEpisode: this.nextEpisode,
      etymons: [...this.etymons.entries()],
      rules: [...this.rules.values()],
      tracker: this.tracker.toJSON(),
      counters: { ...this.counters },
      history: this.history,
      events: this.events,
      interventions: this.interventions,
      prevLectEtyms: [...this.prevLectEtyms.entries()],
      follow: this.follow,
    };
  }

  static deserialize(snap: SimSnapshot): Simulation {
    const sim = new Simulation(snap.cfg, { skipInit: true });
    sim.tick = snap.tick;
    sim.rng.s = snap.rng;
    sim.settlements = snap.settlements.map((s) => ({ ...s, salience: Float64Array.from(s.salience) }));
    sim.routes = structuredClone(snap.routes);
    sim.isolated = new Set(snap.isolated);
    sim.agents = [];
    sim.agentById.clear();
    for (const a of snap.agents) sim.addAgent(deserializeAgent(a));
    sim.nextAgent = snap.nextAgent; sim.nextEtym = snap.nextEtym; sim.nextRule = snap.nextRule; sim.nextEpisode = snap.nextEpisode;
    sim.etymons = new Map(snap.etymons);
    sim.rules = new Map(snap.rules.map((r) => [r.id, { ...r }]));
    sim.tracker = LanguageTracker.fromJSON(snap.tracker);
    sim.counters = { ...snap.counters };
    sim.history = structuredClone(snap.history);
    sim.events = structuredClone(snap.events);
    sim.interventions = structuredClone(snap.interventions);
    sim.prevLectEtyms = new Map(snap.prevLectEtyms.map(([k, v]) => [k, v.slice()]));
    sim.follow = snap.follow;
    sim.recomputeContact();
    sim.rebuildResidents();
    return sim;
  }

  /** Stable hash of the linguistic state (used by determinism tests). */
  stateHash(): number {
    let h = 2166136261;
    const mix = (x: number) => { h ^= x; h = Math.imul(h, 16777619) >>> 0; };
    mix(this.tick); mix(this.rng.s); mix(this.agents.length); mix(this.nextEtym);
    for (const a of this.agents) {
      mix(a.id); mix(a.settlement); mix(a.lex.size);
      for (const e of a.lex.entries()) { mix(e.etym); mix(Math.round(e.score * 1e6)); for (let i = 0; i < e.form.length; i++) mix(e.form.charCodeAt(i)); }
      for (let i = 0; i < 6; i++) mix(Math.round(a.gram.order[i] * 1e6));
    }
    return h >>> 0;
  }

  settlementName(i: number) { return this.settlements[i]?.name ?? '?'; }
}

/* ---------- agent (de)serialisation ---------- */
export interface AgentJSON {
  [k: string]: unknown;
}
function serializeAgent(a: Agent) {
  return {
    ...a,
    lex: a.lex.toJSON(),
    gram: { order: Array.from(a.gram.order), adj: Array.from(a.gram.adj), obl: Array.from(a.gram.obl), mark: Array.from(a.gram.mark), need: Array.from(a.gram.need) },
    accent: a.accent.map((x) => ({ ...x })),
    habit: Array.from(a.habit),
    accentFam: [...a.accentFam.entries()],
    relations: [...a.relations.entries()].map(([id, r]) => [id, { ...r }]),
    memory: a.memory.map((m) => ({ ...m })),
    learnLog: a.learnLog.map((m) => ({ ...m })),
    seen: [...a.seen],
    stats: { ...a.stats },
    traits: { ...a.traits },
    travel: a.travel ? { ...a.travel, path: a.travel.path.slice() } : null,
  };
}
type SerializedAgent = ReturnType<typeof serializeAgent>;
function deserializeAgent(o: SerializedAgent): Agent {
  return {
    ...o,
    lex: Lexicon.fromJSON(o.lex),
    gram: { order: Float64Array.from(o.gram.order), adj: Float64Array.from(o.gram.adj), obl: Float64Array.from(o.gram.obl), mark: Float64Array.from(o.gram.mark), need: Float64Array.from(o.gram.need) },
    accent: o.accent.map((x) => ({ ...x })),
    habit: Float64Array.from(o.habit),
    accentFam: new Map(o.accentFam),
    relations: new Map(o.relations as [number, { w: number; k: 0 | 1 | 2 }][]),
    memory: o.memory.map((m) => ({ ...m })),
    learnLog: o.learnLog.map((m) => ({ ...m })),
    seen: new Set(o.seen),
    stats: { ...o.stats },
    traits: { ...o.traits },
    travel: o.travel ? { ...o.travel, path: o.travel.path.slice() } : null,
  } as Agent;
}

export interface SimSnapshot {
  version: number;
  cfg: SimConfig;
  tick: number;
  rng: number;
  settlements: (Omit<Settlement, 'salience'> & { salience: number[] })[];
  routes: Route[];
  isolated: number[];
  agents: SerializedAgent[];
  nextAgent: number; nextEtym: number; nextRule: number; nextEpisode: number;
  etymons: [number, Etymon][];
  rules: SoundRule[];
  tracker: ReturnType<LanguageTracker['toJSON']>;
  counters: Counters;
  history: MetricSample[];
  events: SimEvent[];
  interventions: { tick: number; action: Intervention }[];
  prevLectEtyms: [number, number[]][];
  follow: number;
}

export { MAP_W, CONCEPTS, romanize };
