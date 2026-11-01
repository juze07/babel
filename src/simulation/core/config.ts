/** Simulation configuration. Every field is exported with snapshots so runs are reproducible. */
export type WorldType = 'archipelago' | 'continent' | 'valley' | 'trading' | 'custom';

export interface TraitMeans {
  memoryCapacity: number; // max lexical entries
  learningRate: number; // 0..1
  imitation: number; // 0..1
  innovation: number; // 0..1
  confidence: number; // 0..1
  attention: number; // 0..1
  forgetting: number; // per-year decay of unused associations, 0..1
}

export interface GroupOverride {
  /** settlement indices (in creation order) this override applies to */
  settlements: number[];
  traits: Partial<TraitMeans>;
}

export interface SimConfig {
  seed: number;
  worldType: WorldType;
  settlements: number;
  agentsPerSettlement: number;
  maxPopulation: number;
  /** world-specific geography knobs used by `custom` (also lightly used by others) */
  landRatio: number;
  regions: number;
  separation: number; // 0..1 how far apart regions are
  /** contact model */
  contactRange: number; // travel-cost scale over which contact decays
  externalContact: number; // base probability scale that a conversation is with another settlement
  tradeRoutes: number;
  tradeStrength: number;
  initialMixingYears: number;
  migrationRate: number; // per-agent per-year baseline propensity
  /** population dynamics */
  birthRate: number;
  lifespan: number; // mean years
  /** linguistic dynamics */
  conversationsPerTick: number;
  contextSize: number;
  perceptionNoise: number;
  soundChangeRate: number; // probability per settlement per year
  prestigeWeight: number;
  gestureClarity: number;
  traits: TraitMeans;
  traitVariance: number;
  groupOverrides: GroupOverride[];
  /** analysis */
  analysisInterval: number; // ticks between language-identification passes
  languageThreshold: number; // relative intelligibility below which lects count as separate languages
  dialectThreshold: number; // lexical distance above which lects of one language count as distinct dialects
}

export const TICKS_PER_YEAR = 4;

export const DEFAULT_TRAITS: TraitMeans = {
  memoryCapacity: 130,
  learningRate: 0.55,
  imitation: 0.6,
  innovation: 0.35,
  confidence: 0.55,
  attention: 0.8,
  forgetting: 0.08,
};

export function defaultConfig(worldType: WorldType = 'archipelago', seed = 1234): SimConfig {
  const base: SimConfig = {
    seed,
    worldType,
    settlements: 8,
    agentsPerSettlement: 32,
    maxPopulation: 520,
    landRatio: 0.4,
    regions: 4,
    separation: 0.6,
    contactRange: 60,
    externalContact: 0.18,
    tradeRoutes: 1,
    tradeStrength: 0.5,
    initialMixingYears: 0,
    migrationRate: 0.004,
    birthRate: 0.13,
    lifespan: 58,
    conversationsPerTick: 1.2,
    contextSize: 4,
    perceptionNoise: 0.04,
    soundChangeRate: 0.025,
    prestigeWeight: 0.6,
    gestureClarity: 0.65,
    traits: { ...DEFAULT_TRAITS },
    traitVariance: 0.15,
    groupOverrides: [],
    analysisInterval: 20,
    languageThreshold: 0.62,
    dialectThreshold: 0.18,
  };
  switch (worldType) {
    case 'archipelago':
      return { ...base, settlements: 8, regions: 4, separation: 0.75, contactRange: 45, tradeRoutes: 0 };
    case 'continent':
      return { ...base, settlements: 10, agentsPerSettlement: 28, regions: 1, contactRange: 80, externalContact: 0.22, tradeRoutes: 1 };
    case 'valley':
      return { ...base, settlements: 6, agentsPerSettlement: 30, regions: 1, contactRange: 55, tradeRoutes: 0 };
    case 'trading':
      return { ...base, settlements: 9, agentsPerSettlement: 28, regions: 5, separation: 0.5, contactRange: 50, tradeRoutes: 6, tradeStrength: 0.9 };
    default:
      return base;
  }
}

export const WORLD_DESCRIPTIONS: Record<WorldType, { title: string; blurb: string }> = {
  archipelago: { title: 'Archipelago', blurb: 'Island populations separated by open water. Sea crossings are rare and costly.' },
  continent: { title: 'Continent', blurb: 'One broad landmass with mountains and rivers. Neighbours meet often.' },
  valley: { title: 'Isolated Valley', blurb: 'A small community ringed by mountains, with distant outsiders beyond the passes.' },
  trading: { title: 'Trading Network', blurb: 'Coastal settlements around an inland sea, linked by regular trade routes.' },
  custom: { title: 'Custom World', blurb: 'Configure geography, contact and population yourself.' },
};
