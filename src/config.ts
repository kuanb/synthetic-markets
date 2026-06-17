// Every [TUNABLE] constant lives here. No magic numbers elsewhere.

export const CONFIG = {
  // world gen
  WIDTH: 200,
  HEIGHT: 200,
  CELL_PX: 32,
  PLAYER_START_POP: 10,
  PLAYER_EDGE_MARGIN: 10,
  AI_MARKET_COUNT: 4,
  AI_START_POP: 5,
  WILD_PERSON_COUNT: 200,
  WILD_GROUP_AVG_SIZE: 8,

  // noise
  NOISE_OCTAVES: 4,
  NOISE_FREQUENCY: 0.012,
  NOISE_LACUNARITY: 2.0,
  NOISE_GAIN: 0.5,
  FOOD_YIELD_MAX: 10,
  RAW_YIELD_MAX: 10,

  // persons (homogeneous constants; each person shares these)
  LABOR_CAPACITY: 2,
  MOBILITY: 1,
  BIRTH_RATE: 0.1,
  VIEW_RANGE: 1,
  // Discrete-agent model: every tick scans the live pool O(N). Cap keeps batched 100-year
  // turns responsive. (Raise for scale at the cost of per-turn latency.)
  MAX_PERSONS: 100_000,

  // policy defaults (player starting slider positions)
  LABOR_TO_FOOD_DEFAULT: 0.5,
  RAW_TO_RESEARCH_DEFAULT: 0.5,

  // tech
  TECH_MULTIPLIER: 1.5, // ext(level) = TECH_MULTIPLIER ^ level
  RESEARCH_C0: 10,
  RESEARCH_R: 1.18, // cost(level) = C0 * r^level

  // desire / propensity
  DESIRE_GROWTH_K: 0.02,
  DESIRE_CAP: 100,
  PROPENSITY_RISE: 0.15,
  PROPENSITY_DECAY: 0.1,
  BURST_DECAY: 0.7,
  BURST_BUMP: 0.5,

  // conflict
  CONFLICT_GATE: 0.1,

  // turn
  DEFAULT_YEARS_PER_TURN: 10,
  MAX_YEARS_PER_TURN: 100,
} as const;

// RNG stream salts (keep stable across refactors for determinism).
export const RNG_SALT = {
  TERRAIN: 1,
  WORLDGEN: 2,
  BIRTHS: 3,
  FOOD_DEATHS: 4,
  GOODS_DEATHS: 5,
  MOVEMENT: 6,
  CONFLICT: 7,
  AI: 8,
} as const;

// Index 0 = baseline "(none)" (ext = 1.0). Index 1 = Hoe. 45 real technologies.
export const TECH_TABLE: readonly string[] = [
  '(none)',
  'Hoe',
  'Irrigation',
  'Bronze Working',
  'Pottery',
  'The Wheel',
  'Writing',
  'Masonry',
  'Animal Husbandry',
  'Iron Working',
  'Currency',
  'Mathematics',
  'Sailing',
  'Roads',
  'Aqueducts',
  'Crop Rotation',
  'Windmills',
  'Banking',
  'Printing Press',
  'Gunpowder',
  'Navigation',
  'Mechanical Clock',
  'Optics',
  'Steam Power',
  'Steel',
  'Railroads',
  'Telegraph',
  'Electricity',
  'Internal Combustion',
  'Assembly Line',
  'Refrigeration',
  'Synthetic Fertilizer',
  'Plastics',
  'Antibiotics',
  'Nuclear Fission',
  'Transistor',
  'Container Shipping',
  'Computing',
  'Satellites',
  'Telecommunications',
  'Genetic Engineering',
  'The Internet',
  'Robotics',
  'Machine Learning',
  'Nanotechnology',
  'Fusion Power',
];
