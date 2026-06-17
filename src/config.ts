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
  LABOR_TO_FOOD_DEFAULT: 0.5, // labor: food vs mining (raw = 1 - this)
  // Three-way raw allocation defaults (MUST sum to 1). Disposition of a market's MINABLE raw:
  //   market -> goods, tech -> research, unmined -> banks in rawStock ("pay dirt" reserve).
  // Low tech share by default so advancing is a deliberate strategic investment, not automatic.
  RAW_TO_MARKET_DEFAULT: 0.6,
  RAW_TO_TECH_DEFAULT: 0.1,
  RAW_UNMINED_DEFAULT: 0.3,

  // tech
  TECH_MULTIPLIER: 1.5, // ext(level) = TECH_MULTIPLIER ^ level  (scales RAW->GOODS only)
  // [DEFAULT] Food is land-limited and decoupled from ext: foodExt(level)=FOOD_TECH_MULTIPLIER^level.
  // 1.0 = a cell's food carrying capacity never grows with tech, so a growing population MUST
  // spread across cells. Raise slightly (e.g. 1.03) to let tech ease food pressure over eras.
  FOOD_TECH_MULTIPLIER: 1.0,
  // Tech is EXPENSIVE (raw units). Reaching the final tier requires EITHER pouring ~all raw into
  // research for sustained periods, OR growing territory/throughput first and then redirecting it.
  // cost(level) = C0 * r^level. Raised from 10 / 1.18 so casual allocation advances slowly.
  RESEARCH_C0: 100,
  RESEARCH_R: 1.3,

  // desire / propensity
  DESIRE_GROWTH_K: 0.02,
  // Soft ceiling only. Desire keeps tracking per-capita wealth so a rich, stagnant market can
  // have consumption outrun goods and suffer goods-starvation (decadence collapse).
  DESIRE_CAP: 1_000_000,
  PROPENSITY_RISE: 0.15,
  PROPENSITY_DECAY: 0.1,
  BURST_DECAY: 0.7,
  BURST_BUMP: 0.5,

  // early-game player safety net (AI + wild are unaffected)
  PLAYER_SAFE_YEARS: 40, // during these opening years the player cannot be driven below the floor
  PLAYER_SAFE_FLOOR: 5, // minimum surviving player population during the safe window
  PLAYER_START_FOOD: 10, // start cell food yield is guaranteed fertile (<= FOOD_YIELD_MAX)
  PLAYER_START_NEIGHBOR_FOOD_MIN: 6, // rook neighbors of the start cell get at least this much food

  // conflict
  CONFLICT_GATE: 0.1,

  // turn
  YEARS_PER_TURN_OPTIONS: [10, 50, 250],
  DEFAULT_YEARS_PER_TURN: 10,
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
