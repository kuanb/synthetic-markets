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
  // DENSITY vs. the "literal" targets (1:25 markets, ~50% density): after removing the per-tick
  // full-pool population scan (refreshDerived) and the per-market full-pool burst scan, the hot
  // path is ~linear in (markets + live persons), so density was pushed UP an order of magnitude
  // toward the design intent: 1800 markets + ~70k live agents on 300x300, with a worst-case
  // 250-year batch ~3-4s (the common 10/50-year turns are well under a second). The literal 1:25 /
  // 50% target (~3600 markets) is reachable in ~4-5s but makes the opening unplayable — dense
  // rivals reach and conquer the player's lone start cell before it can expand (the early safety
  // net covers starvation, not territory loss), so ~40% of starts lose by year 5. CELLS_PER_MARKET
  // and WILD_CELL_DENSITY are the knobs: raise toward 25 / 0.5 for max density at the cost of
  // per-turn latency and opening difficulty.
  CELLS_PER_MARKET: 50, // -> ~1800 AI markets on 300x300 (dense rivalry; see density note)
  AI_MARKET_COUNT: 4,
  AI_START_POP: 5,
  // World population density: ~WILD_CELL_DENSITY of cells are seeded with a small wild group at
  // gen. Each seeded cell gets WILD_CELL_MIN..MAX persons (so ~half the map is occupied at gen
  // once markets + wild groups are counted).
  WILD_CELL_DENSITY: 0.35,
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
  VIEW_RANGE: 1, // per-person MIGRATION-target search range (movement), not map sight
  // Fog-of-war SIGHT: reveal radius (cells) around the player's territory grows with technology —
  // at least VISION_PER_LEVEL per tech level, ramping to the full map by the Satellites tech so the
  // whole map is visible by then. (See sim/tech.ts visionRadius.)
  VISION_BASE: 1, // sight radius at tech 0 (the original 1-cell reveal)
  VISION_PER_LEVEL: 1, // minimum added sight radius per tech level
  // Discrete-agent model: several per-tick passes (births, movement, propensity) are O(live pool).
  // Cap bounds per-turn latency + memory. ~70k live at gen on 300x300; headroom for growth before
  // the cap binds (population trends DOWN over a long run as crowded markets shed/starve).
  MAX_PERSONS: 250_000,

  // policy defaults (player starting slider positions)
  LABOR_TO_FOOD_DEFAULT: 0.95, // labor: food vs mining (raw = 1 - this)
  // Three-way raw allocation defaults (MUST sum to 1). Disposition of a market's MINABLE raw:
  //   market -> goods, tech -> research, unmined -> banks in rawStock ("pay dirt" reserve).
  // Low tech share by default so advancing is a deliberate strategic investment, not automatic.
  // The reserve fraction (default 0.3) of MINED raw accumulates into Market.rawReserves — the
  // pool that funds the Forced-Intervention tech-burst — so reserves build under default play.
  RAW_TO_MARKET_DEFAULT: 0.6,
  RAW_TO_TECH_DEFAULT: 0.1,
  RAW_RESERVE_DEFAULT: 0.3,

  // Famine Tolerance (player policy knob) + food-surplus-aware migration damping. When a market's
  // food surplus ratio approaches the (tolerance-shifted) comfort anchor, propensity to MOVE is
  // scaled down toward MIN_MOVE_SCALE so people stop abandoning the cells that feed them.
  //   t=0 (Subsistence): anchor = FOOD_ANCHOR_MARGIN (anchor hard, feed the population first)
  //   t=1 (Prospecting): anchor = 0 (chase raw right into starvation)
  // Default 0.1: almost completely famine-resistant, but a little willing to risk it for raw.
  FAMINE_TOLERANCE_DEFAULT: 0.1,
  MIN_MOVE_SCALE: 0.1, // floor on the movement-propensity multiplier when food is tight
  FOOD_ANCHOR_MARGIN: 0.25, // surplus ratio at/above which movement is unrestricted (at t=0)
  FOOD_ANCHOR_BAND: 0.35, // width of the ramp from free -> fully anchored

  // Forced Intervention — Market Expansion (tech-triggered territory burst paid from rawReserves)
  BURST_RAW_COST_MULT: 5, // cost = this * the market's total raw mined in the unlock cycle
  BURST_MAX_RANGE: 250, // arm length cap (cells): L = min(R, BURST_MAX_RANGE)
  ARM_WIDTH_MIN: 5,
  ARM_WIDTH_MAX: 20,
  TERMINUS_RADIUS_MIN: 15,
  TERMINUS_RADIUS_MAX: 35,

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

  // historical events (the player-facing "major events" feed)
  EVENT_DIEOFF_FRAC: 0.1, // net player population LOSS in a single year that logs a "die-off"
  EVENT_BOOM_FRAC: 0.25, // net player population GAIN in a single year that logs a "boom"
  EVENT_MIN_POP_FOR_DELTA: 25, // ignore die-off/boom below this pop (avoids tiny early-game noise)
  EVENT_ENCOUNTER_MILESTONES: [1, 3, 5, 10, 25, 50, 100, 250, 500], // rival-encounter count milestones
  EVENT_LOG_MAX: 500, // cap retained events (oldest dropped beyond this)
  // "Other markets" panel + rival-market chronicle events
  OTHER_MARKETS_SHOWN: 5, // # of largest discovered+alive rival markets listed in the side panel
  EVENT_MARKET_SWING_FRAC: 0.5, // single-year ±pop swing of a top-5 discovered market that logs an event

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
  BURST: 9,
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
