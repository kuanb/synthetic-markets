// Every [TUNABLE] constant lives here. No magic numbers elsewhere.

export const CONFIG = {
  // world gen
  WIDTH: 300,
  HEIGHT: 300,
  MAP_MIN_SIZE: 300, // hard floor enforced in createWorld if a smaller size is ever configured
  CELL_PX: 32,
  PLAYER_START_POP: 10,
  PLAYER_EDGE_MARGIN: 10,
  // Market density: ~1 market per CELLS_PER_MARKET cells. The AI market count is DERIVED from map
  // size: floor(width*height / CELLS_PER_MARKET) - 1 (the player is the one remaining market), so
  // there are many rivals out of the gate. (AI_MARKET_COUNT is a legacy fallback, unused at gen.)
  // NOTE on defaults vs. the "literal" targets (1:25 markets, 50% density): the discrete-person
  // model scans the live pool O(N) each tick and ~all agents migrate yearly, so the literal
  // targets (~3600 markets + ~90k agents on 300x300) made a single 250-year batch take MINUTES.
  // These constants ARE the tunable knobs; the defaults below are chosen to keep a 250-year turn
  // responsive (~1-2s). Push them up for denser worlds at the cost of per-turn latency.
  CELLS_PER_MARKET: 900, // -> ~100 AI markets on 300x300 (many rivals; see perf note)
  AI_MARKET_COUNT: 4,
  AI_START_POP: 5,
  // World population density: ~WILD_CELL_DENSITY of cells are seeded with a small wild group at
  // gen. Each seeded cell gets WILD_CELL_MIN..MAX persons.
  WILD_CELL_DENSITY: 0.1,
  WILD_CELL_MIN: 1,
  WILD_CELL_MAX: 3,

  // noise
  NOISE_OCTAVES: 4,
  NOISE_FREQUENCY: 0.012,
  NOISE_LACUNARITY: 2.0,
  NOISE_GAIN: 0.5,
  FOOD_YIELD_MAX: 10,
  RAW_YIELD_MAX: 10,
  // Food-yield floor: cells whose noise >= FOOD_FLOOR_FBM are lifted to at least FOOD_YIELD_FLOOR
  // so the large majority (~85%) of cells can support >=1 person — curbs pure-food collapse spikes
  // while leaving the barren ~15% (valleys) below 1 to keep food the primary spatial constraint.
  FOOD_YIELD_FLOOR: 1,
  FOOD_FLOOR_FBM: 0.3,

  // persons (homogeneous constants; each person shares these)
  LABOR_CAPACITY: 2,
  MOBILITY: 1,
  BIRTH_RATE: 0.1,
  VIEW_RANGE: 1,
  // Discrete-agent model: every tick scans the live pool O(N). Cap bounds per-turn latency.
  MAX_PERSONS: 80_000,

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
  // DESIRE_GROWTH_K is now an EASING rate (0..1): desireToConsume eases this fraction of the way
  // toward its aspiration each year. Aspiration = DESIRE_SUPPLY_FRAC * per-capita goods THROUGHPUT
  // (flow), not accumulated capital — this stops desire ratcheting off a hoarded pile and then
  // mass-starving the market (the reported early die-off).
  DESIRE_GROWTH_K: 0.1,
  // Aspiration targets only this fraction of per-capita goods produced, so the surplus still
  // accrues as capitalWealth (wealth explosion preserved) and steady production comfortably covers
  // consumption. < 1 ⇒ no goods-starvation under steady play; goods-death only on a real downturn.
  DESIRE_SUPPLY_FRAC: 0.5,
  // Goods-shortfall deaths are capped to this fraction of population per year: a gradual decline
  // (decadence), never an instant wipe. Food deaths are NOT capped (food is the hard constraint).
  GOODS_DEATH_MAX_FRAC: 0.1,
  // Soft ceiling only (rarely binds now that desire tracks throughput).
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
