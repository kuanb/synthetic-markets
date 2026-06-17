# Synthetic Markets — Authoritative Implementation Plan

> **Audience:** A fleet of Sonnet 4.6 agents executing tasks in isolation.
> **Contract:** You implement *against* the frozen contracts in §2–§5. You do **not** invent
> state, rename fields, or change the tick order. If something is underspecified, the
> `[DEFAULT]` already chosen in this document wins; do not improvise a competing rule.
> **Glossary rule:** One concept → one field name. The synonyms in the source design doc are
> mapped onto canonical fields in §2 and must never reappear in code or comments.

---

## Table of contents
1. Context & inspiration
2. **Authoritative glossary + state schema** ← read first
3. Locked tech stack
4. Architecture & module map (TS interface contracts)
5. **Simulation spec + deterministic tick order** ← read first
6. UI spec
7. Determinism, seeding, persistence
8. Task DAG
9. Testing strategy
10. Git / CI workflow

---

## 1. Context & inspiration

A browser-based, **no-backend** simulation of market expansion and the reaction of randomly
generated agents on a grid. Spiritual ancestor: **Epstein & Axtell, *Growing Artificial
Societies* (Sugarscape, 1996)** — agents on a grid, local resource fields, movement toward
resources, emergent population dynamics.

**Explicit divergences from Sugarscape** (state these so executors never fall back to
Sugarscape defaults):

| Sugarscape | Synthetic Markets |
|---|---|
| Toroidal wrap-around world | **Hard map edges.** No wrap. Player starts ≥10 cells from any edge. |
| One agent per cell | **Unlimited persons per cell** (a cell can become a "Hong Kong"). Bounded only globally by `MAX_PERSONS`. |
| No ownership concept | **Market / ownership layer**: cells and persons belong to a `marketId`. |
| Static resource regrowth | **Per-market technology track** that scales extraction over time (`ext(techLevel)`). |
| Sugar (single resource) | **Four canonical resources:** Food, Raw materials, Goods, Capital Wealth. |

This is an agent/economy hybrid: terrain + autonomous agents (Sugarscape DNA) **plus** a
market/ownership/technology economy layered on top.

---

## 2. Authoritative glossary + state schema  **[FREEZE — single source of truth]**

### 2.1 Canonical resource vocabulary (only these four exist)

- **Food** — perishable sustenance. Each living person needs **1 food/cycle** or risks death.
  Unused food is **not** banked (perishable).
- **Raw materials** ("raw") — extracted resource. Mined raw is allocated by policy
  (research vs market); **unmined raw banks** in `rawStock`. Persons never hold raw.
- **Goods** — manufactured from raw allocated "to market." Unit of consumption (satisfies
  `desireToConsume`) and the substance of wealth. Goods are **not** a player allocation; all
  produced goods enter `capitalWealth`, from which people consume automatically (§5.3 step 7).
- **Capital Wealth** — goods retained in the market pool. Used for conflict comparison,
  burst-spend funding, **and** as the pool people automatically draw from to satisfy
  `desireToConsume`.

### 2.2 Synonym → canonical field map (the *only* allowed mapping)

| Loose term in source doc | Canonical field |
|---|---|
| "product", "market total product output" | `goodsProducedThisCycle` |
| "market value", "absolute goods wealth" | `capitalWealth` |
| "raw to market" (mined raw → goods, tech excluded) | `rawToMarketThisCycle` (per-cycle accumulator) |
| "raw retained / reserves this cycle" | `rawToReserveThisCycle` (per-cycle accumulator) → `rawReserves` pool |
| "person", "agent", "people" (singular unit) | a discrete **Person** record (see §2.4) |
| "tech", "technology level" | `techLevel` |
| "wealth" (ambiguous) | **always** `capitalWealth` |

Any of these loose terms appearing as an identifier in code is a defect. Note in particular
there is **no** `goodsToPeople` / `goodsToMarket` field anymore — those died with the removed
goods slider; consumption flows directly out of `capitalWealth`.

### 2.3 Land — one logical record per cell, stored as **Struct-of-Arrays** (flat typed arrays)

`width * height` cells, indexed `idx = y * width + x`. **No per-cell objects.**

| Field | Array type | Meaning | Default at gen |
|---|---|---|---|
| `foodYield` | `Float32Array` | Base food potential per cycle (pre-tech). Perishable. | autocorrelated noise |
| `rawYield` | `Float32Array` | Base raw-material potential generated per cycle. | autocorrelated noise |
| `rawStock` | `Float32Array` | Accumulated **unmined** raw. Banks across cycles ("pay dirt"). | `0` |
| `marketId` | `Int32Array` | Owning market id, or **`-1`** (= "null"/unowned). At most one market. | `-1` |
| `discovered` | `Uint8Array` | Fog-of-war bit (player vantage): `0` hidden, `1` discovered. | `0` |

> **[DEFAULT] `null` encoding.** Typed arrays cannot hold `null`, so "no market" is the
> integer **`-1`** everywhere. Never use `0` for "none"; `0` is a valid market id — the player
> market is always id `0`.

Terrain (`foodYield`, `rawYield`) is **spatially autocorrelated value/simplex noise** derived
from the world seed (reproducible peaks and valleys). Hidden until `discovered`. **[DEFAULT]
Food floor:** cells whose noise `≥ FOOD_FLOOR_FBM` (~85% of the map) are lifted to at least
`FOOD_YIELD_FLOOR` (=1) so they can support ≥1 person — this curbs pure-food collapse spikes
while leaving the barren ~15% (valleys) below 1, keeping food the primary spatial constraint.

### 2.4 Person — **discrete individual agents** in a Struct-of-Arrays pool  **[FREEZE]**

**Decision & rationale.** "Population 10" instantiates **10 distinct Person records** on the
starting cell — *not* a counter on the market and *not* an aggregated cohort. Every downstream
mechanic operates on individual records: births create new records, movement relocates
individual records, starvation/goods-death delete individual records chosen at random,
conflict and absorption flip the `marketId`/owner of individual records. This faithfulness is
the frozen contract. (The previous cohort sketch is explicitly **rejected**.)

Persons live in a **SoA pool** with a free-list (capacity grows by doubling; freed slots
reused) and a **per-cell intrusive singly-linked list** so iterating "persons on a cell" is
O(persons-on-cell), not O(grid). Pool layout is **private to `world/state.ts`**; every other
module uses the accessors in §4.

| Person field | Array type | Meaning |
|---|---|---|
| `personCell` | `Int32Array` | Cell index this person occupies. **`-1` = free/dead slot.** |
| `personOwner` | `Int32Array` | `marketId` (`≥0`) **or** wild group encoded as `-(groupId+2)` (so `-1` stays "unowned", wild owners are `≤ -2`). |
| `personPropensity` | `Float32Array` | `propensityToMove` ∈ [0,1], individuating per-person state. |
| `personNext` | `Int32Array` | Next person index in this cell's linked list, or `-1`. |

> **[DEFAULT] Homogeneous constants are config, not per-person columns.** The source schema
> lists `laborCapacity=2`, `mobility=1`, `birthRate=0.1`, `viewRange=1` per person, but **no
> rule ever mutates them**, so they live once in `config.ts` and every person shares the value.
> Each Person record still stores the attributes that genuinely *individuate* behavior:
> position (`personCell`), allegiance (`personOwner`), and migration pressure
> (`personPropensity`). This keeps records discrete while bounding memory.
>
> **[DEFAULT] `desireToConsume` is stored once per market, not per person.** Its update is a
> market-wide formula (§5.3 step 8) identical for every member, so duplicating it across
> millions of records is pure waste. `need = population(market) * market.desireToConsume`.
> Deaths from a goods shortfall still delete **individual** Person records at random — the unit
> of life and death remains the discrete person. Wild persons have effective
> `desireToConsume = 0` (they only ever die of food).
>
> **[DEFAULT] Wild owner encoding.** A wild person (no market) carries a `groupId` for its
> rainbow color via `ownerCode = -(groupId + 2)`. Helpers: `isWild(code) = code <= -2`,
> `groupIdOf(code) = -code - 2`, `marketIdOf(code) = code` (when `code >= 0`). `code = -1` is
> reserved and never used as a person owner.

### 2.5 Market — array-of-structs (markets are few: 1 player + `AI_MARKET_COUNT`)

```ts
interface Market {
  id: number;                 // 0 = player, 1..N = AI
  techLevel: number;          // integer index into TECH_TABLE; 0 = start (ext = 1.0)
  techProgress: number;       // raw materials invested toward the NEXT tech (>= 0)
  capitalWealth: number;      // goods pool: produced goods accrue here, consumption drains here
  rawReserves: number;        // persistent RAW pool (reserve allocation accrues here); funds the burst
  pendingBurst: boolean;      // a queued Forced-Intervention burst awaiting sufficient reserves
  pendingBurstCost: number;   // raw cost fixed at queue time (= BURST_RAW_COST_MULT * cycle rawMined)
  cells: Set<number>;         // owned cell indices (mirror of Land.marketId for O(1) iteration)
  colorHue: number;           // 0..360, random per market; tint derived from this
  desireToConsume: number;    // goods/person/cycle each member needs; grows (§5.3 step 8)
  policy: Policy;             // TWO sliders (player = live; AI = fixed, §5.6)
  propensityToExpand: number; // AI ONLY, [0,1] @ gen; 0 and unused for the player market
  isPlayer: boolean;          // EXACTLY ONE market true for the whole game (see note)
  // per-cycle accumulators (reset to 0 at tick start; never stored stale):
  goodsProducedThisCycle: number;     // = rawToMarketThisCycle * ext(techLevel)
  goodsConsumedThisCycle: number;     // goods drawn from capitalWealth to feed people (step 7)
  rawToMarketThisCycle: number;       // mined raw sent to market, tech EXCLUDED (orientation num.)
  rawToReserveThisCycle: number;      // mined raw retained in reserves this cycle (orientation denom. term)
  bornThisYear: number;
  diedThisYear: number;       // reset every simulated year (drives the per-year log)
  diedThisTurn: number;       // accumulated across all years of the most recent End Turn batch
  foodThisYear: number;
  population: number;         // cached Σ live persons owned by this market (derived; refreshed each tick)
}

interface Policy {
  laborToFoodFrac: number;    // [0,1]; mining-labor frac = 1 - this
  // Three-way disposition of MINED raw. These three MUST sum to 1:
  rawToMarketFrac: number;    //  -> goods (capitalWealth), tech-scaled in step 5
  rawToTechFrac: number;      //  -> techProgress (research)
  rawToReserveFrac: number;   //  -> accumulates into Market.rawReserves (funds the tech-burst)
  forcedIntervention: boolean;// player-only: on a NEW tech, queue a territory-burst from reserves
}
```
> **[DEFAULT] Three-way raw allocation (v3).** Replaces the original two-way research-vs-market
> split. Defaults: market `0.6`, tech `0.1`, unmined `0.3` — a low tech share by default so
> advancing technology is a deliberate strategic investment, not automatic.

> **[DEFAULT] Exactly one player market for the entire game.** Precisely one market has
> `isPlayer = true` at world gen and it never changes. The human controls **only** this market
> — never individual persons, never a second market. Conquest (§5.5) converts an enemy's cells
> and persons **into** the player market; it never hands the player a separate market. If the
> player market loses its last cell or reaches population 0, the game ends (loss, §6).
> **[DEFAULT]** `population`, `extMultiplier`, `orientation` are **derived** (§2.6); the
> `population` field is a cache refreshed at tick start — never trust a stale copy.

### 2.6 Derived values (computed, never stored stale)

- `population(marketId)` = count of live persons whose owner == marketId.
- `extMultiplier(techLevel)` = `TECH_MULTIPLIER ^ techLevel` (§5.1).
- `orientation(market)` — a **raw-units** ratio over the **last completed cycle**, measuring a
  market's "growth mindset" (push mined raw to MARKET) vs. holding back (retain in RESERVES):
  ```
  orientation = rawToMarketThisCycle / (rawToMarketThisCycle + rawToReserveThisCycle)
  // ∈ [0,1]; 0 if the denominator is 0. Raw spent on RESEARCH is EXCLUDED from both terms.
  ```
  High orientation ⇒ the market pushes mined raw to market (aggressive growth). Low orientation
  ⇒ it retains raw in reserves (holding back). Goods and people do **not**
  appear in this metric. Drives movement bias (§5.4) and conflict (§5.5).
  `rawToMarketThisCycle` and `rawToReserveThisCycle` are driven by the three-way raw policy
  (§2.5): the market share of mined raw vs. the deliberately/labour-limited unmined remainder.

---

## 3. Locked tech stack  **[CONFIRMED — FROZEN]**

| Concern | Choice | Rationale |
|---|---|---|
| Language/build | **TypeScript + Vite** | Static bundle, zero-config GH Pages, fast HMR. |
| Rendering | **Canvas 2D** with **viewport culling** | 800×800 = 640k cells; DOM is dead on arrival. Render only visible cells. |
| Land storage | **Flat typed arrays**, one per field, idx `y*w+x` | Cache-friendly, cheap to clone for snapshots, serializable. |
| Agents | **Discrete Person SoA pool** (§2.4) | One record per person; faithful births/deaths/movement/conflict. |
| Simulation | **Web Worker**, seeded RNG, worker owns authoritative state | Batched 100-year turns never freeze the UI; main thread only renders snapshots. |
| Persistence | **`localStorage`**, autosave once per turn | No backend. Full-state serialization (§7). |
| Backend | **None** | Fully static. |

**Confirmation:** All defaults adopted as written; no strictly-better alternative justified.
Canvas 2D (not WebGL) suffices: per-cell rendering is text + flat rects within a culled
viewport (at most a few thousand cells on screen).

### 3.1 Worker ⇄ main thread message protocol (typed contract — FROZEN)

```ts
// main -> worker
type ToWorker =
  | { type: 'INIT'; seed: number; width: number; height: number }
  | { type: 'LOAD'; payload: SerializedState }
  | { type: 'SET_POLICY'; marketId: number; policy: Policy }   // Policy = TWO sliders (§2.5)
  | { type: 'TICK'; years: number }                             // End Turn: resolve `years` years
  | { type: 'REQUEST_SNAPSHOT' }
  | { type: 'SAVE' };

// worker -> main
type FromWorker =
  | { type: 'READY' }
  | { type: 'SNAPSHOT'; snapshot: Snapshot }                    // after INIT/LOAD/TICK or on request
  | { type: 'GAME_OVER'; outcome: 'win' | 'loss'; snapshot: Snapshot }  // §6 end conditions
  | { type: 'SAVED'; payload: SerializedState }
  | { type: 'ERROR'; message: string };
```

`Snapshot` (render-facing, derived; see §4) carries per-cell aggregate arrays + a market
summary + `year`. The worker never ships the person pool to main; it ships pre-aggregated
per-cell arrays so the main thread does zero economic computation.

---

## 4. Architecture & module map

Each file lists its **one-line responsibility** and **frozen interface signatures**. Cross-module
imports are limited to the shared types in `world/state.ts` and constants in `config.ts` unless
stated.

### `config.ts` — every `[TUNABLE]` constant (no magic numbers anywhere else)
```ts
export const CONFIG = {
  // world gen — map default 300x300 (MAP_MIN_SIZE floor enforced at boot)
  WIDTH: 300, HEIGHT: 300, MAP_MIN_SIZE: 300, CELL_PX: 32,
  PLAYER_START_POP: 10, PLAYER_EDGE_MARGIN: 10,
  // Market density: AI count is DERIVED -> floor(W*H / CELLS_PER_MARKET) - 1 (player). The
  // "literal" target was 1:25 (~3600 markets on 300x300) but the discrete-agent sim made a
  // 250-year batch take MINUTES; CELLS_PER_MARKET=900 (~100 markets) keeps it ~4.5s. (Tunable.)
  CELLS_PER_MARKET: 900, AI_MARKET_COUNT: 4 /* legacy fallback */, AI_START_POP: 5,
  // World density: ~WILD_CELL_DENSITY of cells seeded with WILD_CELL_MIN..MAX persons. Literal
  // target ~0.5; default 0.1 for responsiveness (perf-bound by population, not cells). (Tunable.)
  WILD_CELL_DENSITY: 0.1, WILD_CELL_MIN: 1, WILD_CELL_MAX: 3,
  // noise
  NOISE_OCTAVES: 4, NOISE_FREQUENCY: 0.012, NOISE_LACUNARITY: 2.0, NOISE_GAIN: 0.5,
  FOOD_YIELD_MAX: 10, RAW_YIELD_MAX: 10,
  // food floor: cells with noise >= FOOD_FLOOR_FBM (~85%) lifted to >=FOOD_YIELD_FLOOR (support 1)
  FOOD_YIELD_FLOOR: 1, FOOD_FLOOR_FBM: 0.30,
  // persons (homogeneous constants; each person shares these)
  LABOR_CAPACITY: 2, MOBILITY: 1, BIRTH_RATE: 0.1, VIEW_RANGE: 1,
  MAX_PERSONS: 80_000,               // global cap (discrete agents; every tick scans the pool O(N))
  // policy defaults — three-way raw allocation (sum to 1); low tech share so tech is deliberate
  LABOR_TO_FOOD_DEFAULT: 0.5,
  RAW_TO_MARKET_DEFAULT: 0.6, RAW_TO_TECH_DEFAULT: 0.1, RAW_RESERVE_DEFAULT: 0.3,
  // Forced Intervention — Market Expansion (tech-triggered territory burst from rawReserves)
  BURST_RAW_COST_MULT: 5, BURST_MAX_RANGE: 250,
  ARM_WIDTH_MIN: 5, ARM_WIDTH_MAX: 20, TERMINUS_RADIUS_MIN: 15, TERMINUS_RADIUS_MAX: 35,
  // tech (v3: EXPENSIVE so advancing is a real choice; co-tuned with TECH_MULTIPLIER)
  TECH_MULTIPLIER: 1.5,              // ext(level) = TECH_MULTIPLIER ^ level   (RAW->GOODS only)
  FOOD_TECH_MULTIPLIER: 1.0,         // foodExt(level) = ^level; 1.0 = food land-limited (NOT ext)
  RESEARCH_C0: 100, RESEARCH_R: 1.30,// cost(level) = C0 * r^level   (raised from 10 / 1.18)
  // desire / propensity
  DESIRE_GROWTH_K: 0.1,              // step 8: EASING rate toward aspiration (per-capita goods flow)
  DESIRE_SUPPLY_FRAC: 0.5,           // aspiration targets this fraction of per-capita goods produced
  GOODS_DEATH_MAX_FRAC: 0.1,         // max fraction of pop a goods shortfall may kill per year
  DESIRE_CAP: 1_000_000,             // soft ceiling (rarely binds now)
  PROPENSITY_RISE: 0.15,             // step 10 on local food deficit
  PROPENSITY_DECAY: 0.10,            // step 10 otherwise
  BURST_DECAY: 0.7, BURST_BUMP: 0.5,
  // early-game player safety net (AI + wild unaffected); floor RAMPS from PLAYER_SAFE_FLOOR at
  // year 0 down to 0 at PLAYER_SAFE_YEARS (no mortality cliff when the window ends)
  PLAYER_SAFE_YEARS: 40, PLAYER_SAFE_FLOOR: 5,
  PLAYER_START_FOOD: 10, PLAYER_START_NEIGHBOR_FOOD_MIN: 6,
  // conflict
  CONFLICT_GATE: 0.10,               // |Δorientation| must exceed this
  // turn
  YEARS_PER_TURN_OPTIONS: [10, 50, 250], DEFAULT_YEARS_PER_TURN: 10,
} as const;

export const TECH_TABLE: readonly string[] = [/* 46 entries: index 0 = "(none)" baseline; index 1 = "Hoe" ... index 45 */];
```
> **Co-tuning note (honor this):** `TECH_MULTIPLIER` (ext growth, raw→goods) and `RESEARCH_R`
> (cost growth) jointly set pacing. `ext(45) ≈ 8.7e7` (float-safe); `TECH_MULTIPLIER=2.0`
> reproduces the `2^45` runaway — **forbidden**. v3 raised research cost (`C0` 10→100, `r`
> 1.18→1.30) so casual allocation climbs slowly (~tech 15 over 1000 years in the balance smoke,
> never maxing) while an all-in-research strategy advances further. **Food is decoupled from
> tech**: `foodExt` (`FOOD_TECH_MULTIPLIER`, default 1.0) keeps a cell's food carrying capacity
> land-limited so population growth must spread across cells (the core expansion driver).

### `world/terrain.ts` — seeded noise → yield arrays
```ts
export interface TerrainArrays { foodYield: Float32Array; rawYield: Float32Array; }
export function generateTerrain(seed: number, width: number, height: number): TerrainArrays;
```

### `world/rng.ts` — deterministic, serializable PRNG (worker-owned)
```ts
export type RngState = number; // or [number,number] for 64-bit; serializable
export interface RNG {
  next(): number;                 // float in [0,1)
  nextInt(maxExclusive: number): number;
  getState(): RngState;
  setState(s: RngState): void;
  fork(salt: number): RNG;        // independent stream from a salt (e.g. per-subsystem)
}
export function makeRng(seed: number): RNG;
```

### `world/state.ts` — authoritative `WorldState` + all accessors (owns SoA layout)
```ts
export function createWorld(seed: number, width: number, height: number): WorldState;

// cell helpers
export function idx(s: WorldState, x: number, y: number): number;
export function inBounds(s: WorldState, x: number, y: number): boolean;

// person pool management (free-list + per-cell linked list internal)
export function spawnPerson(s: WorldState, cell: number, owner: number, propensity: number): number;
export function killPerson(s: WorldState, p: number): void;          // unlink, free slot, dec counts
export function movePerson(s: WorldState, p: number, toCell: number): void; // relink between cells
export function setPersonOwner(s: WorldState, p: number, owner: number): void; // conflict/absorption
export function personsOnCell(s: WorldState, cell: number): number[]; // live person indices on a cell
export function cellPopulation(s: WorldState, cell: number): number;  // count on cell
export function cellLabor(s: WorldState, cell: number, marketId: number): number; // matching persons * LABOR_CAPACITY

// market helpers
export function marketPopulation(s: WorldState, marketId: number): number;
export function orientation(m: Market): number;
export function refreshDerived(s: WorldState): void; // recompute market.population caches

// (de)serialization
export function serialize(s: WorldState): SerializedState;
export function deserialize(p: SerializedState): WorldState;
```

```ts
interface WorldState {
  seed: number; width: number; height: number; year: number;
  // Land SoA (length width*height):
  foodYield: Float32Array; rawYield: Float32Array; rawStock: Float32Array;
  marketId: Int32Array;      // -1 = unowned
  discovered: Uint8Array;
  // per-cell person index (length width*height):
  cellHead: Int32Array;      // head person index of cell's linked list, or -1
  cellPopulation: Int32Array;
  // Person SoA pool (length = capacity):
  personCell: Int32Array; personOwner: Int32Array;
  personPropensity: Float32Array; personNext: Int32Array;
  personCapacity: number; personFreeList: number[]; liveCount: number;
  // markets + wild groups:
  markets: Market[];         // markets[0] is the player (isPlayer === true)
  nextWildGroupId: number;   // monotonically increasing; "no reuse" of group colors
  rngState: RngState;        // serializable PRNG state (worker-owned)
}
```

### `sim/tech.ts` — tech table, ext multiplier, research cost
```ts
export function ext(techLevel: number): number;            // TECH_MULTIPLIER ^ techLevel
export function researchCost(targetLevel: number): number; // C0 * r^targetLevel
export function maxTechLevel(): number;                     // TECH_TABLE.length - 1
```

### `sim/economy.ts` — production, allocation, consumption, deaths (operate on discrete persons)
```ts
// returns market-summed values + tracks orientation accumulators on the market
export function produce(s: WorldState, m: Market): { food: number; rawMined: number };
export function allocateRaw(m: Market, rawMined: number): void;        // step 4 (research vs market)
export function accrueGoods(m: Market): void;                          // step 5 (rawToMarket*ext -> capitalWealth)
export function foodDeaths(s: WorldState, m: Market, food: number, rng: RNG): void; // step 6 (kill discrete persons)
export function goodsConsumptionAndDeaths(s: WorldState, m: Market, rng: RNG): void; // step 7 (draw from pool; kill discrete persons)
export function updateDesire(m: Market): void;                          // step 8
```

### `sim/agents.ts` — births, movement target selection, propensity (per individual person)
```ts
export function births(s: WorldState, m: Market, rng: RNG): void;       // step 2 (each person rolls BIRTH_RATE)
export function moveIntents(s: WorldState, rng: RNG): MoveIntent[];      // step 9 (each person rolls propensity)
export function updatePropensity(s: WorldState, foodDeficitCells: Set<number>): void; // step 10
export interface MoveIntent { person: number; from: number; to: number; }
```

### `sim/conflict.ts` — orientation gate + resolution, applied per move intent
```ts
export function resolveMove(s: WorldState, intent: MoveIntent, rng: RNG): void; // §5.4/§5.5
```

### `sim/ai.ts` — fixed-policy controller for non-player markets (§5.6)
```ts
export function runAiPolicy(s: WorldState, m: Market, rng: RNG): void; // sets 2-slider policy + maybe burst
```

### `sim/tick.ts` — **the spine**. One call = one year, mutating in place
```ts
export function tick(state: WorldState, rng: RNG): void;                       // resolves EXACTLY one year, §5.3
export function tickBatch(state: WorldState, rng: RNG, years: number): EndState; // loop tick() up to `years`, may stop early on game over
export type EndState = { over: false } | { over: true; outcome: 'win' | 'loss' };
```

### `render/snapshot.ts` — derive render-facing snapshot from WorldState (worker-side)
```ts
export interface Snapshot {
  year: number; width: number; height: number;
  discovered: Uint8Array;
  marketId: Int32Array;
  cellPopulation: Int32Array;
  cellHue: Int16Array;          // dominant owner hue per cell, -1 if none
  foodDisplay: Float32Array;    // foodYield * ext(owner techLevel) (discovered only)
  rawDisplay: Float32Array;     // rawYield + rawStock (discovered only)
  marketHue: Int16Array;        // owning market hue per cell, -1 if unowned/undiscovered
  markets: MarketSummary[];     // id, techLevel, techProgress, capitalWealth, population, orientation, etc.
}
export function buildSnapshot(s: WorldState): Snapshot;
```

### `render/viewport.ts` — pan/zoom state + culling
```ts
export interface Viewport { camX: number; camY: number; zoom: 1 | 2; }
export function visibleCellRange(vp: Viewport, canvasW: number, canvasH: number, world: {width:number;height:number}): { x0:number;y0:number;x1:number;y1:number };
export function pan(vp: Viewport, dx: number, dy: number, world: {width:number;height:number}): Viewport;
export function setZoom(vp: Viewport, zoom: 1 | 2): Viewport;
```

### `render/canvas.ts` — draw a snapshot
```ts
export type ViewMode = 'peoples' | 'food' | 'raw';
export function draw(ctx: CanvasRenderingContext2D, snap: Snapshot, vp: Viewport, mode: ViewMode): void;
export function formatNumber(n: number): string; // K/M/B/T suffixes (anti-unreadable-integers)
```

### `ui/sidebar.ts` — stats, view-mode toggle, **two** policy sliders, burst, End Turn, years slider
```ts
export interface SidebarCallbacks {
  onPolicyChange(p: Policy): void;   // Policy = labor split + 3-way raw split + forcedIntervention
  onViewMode(m: ViewMode): void;
  onBurstSpend(): void;
  onEndTurn(years: number): void;
  onZoom(z: 1 | 2): void;
}
export function mountSidebar(root: HTMLElement, cb: SidebarCallbacks): { update(snap: Snapshot): void };
```

### `ui/stats.ts` — end-game summary screen (win/loss)
```ts
export function showSummary(root: HTMLElement, outcome: 'win' | 'loss', log: YearLog[]): void;
```

### `worker/simWorker.ts` — message protocol (§3.1), owns WorldState + RNG
```ts
// implements: onmessage(ToWorker) -> postMessage(FromWorker); emits GAME_OVER on §6 conditions
```

### `persistence.ts` — localStorage save/load
```ts
export function save(state: SerializedState): void;       // key SYNTH_MARKETS_SAVE
export function load(): SerializedState | null;
export function clear(): void;
export type SerializedState = /* JSON-able mirror of WorldState; typed arrays -> base64 */;
```

### `main.ts` — bootstrap: spawn worker, wire sidebar/canvas/input, load autosave, handle GAME_OVER
(No exported contract; integration glue owned by the Wave 4 bootstrap task.)

---

## 5. Simulation spec — the single source of truth

### 5.1 Tech: extraction multiplier and research cost  **[DEFAULT]**

```
ext(level)        = TECH_MULTIPLIER ^ level          // level 0 => 1.0; mult 1.5  (RAW->GOODS only)
foodExt(level)    = FOOD_TECH_MULTIPLIER ^ level      // default 1.0 -> food is land-limited
researchCost(L)   = RESEARCH_C0 * RESEARCH_R ^ L      // cost of reaching level L; C0=100, r=1.30
```
- `ext` multiplies **goods output** from market-allocated raw (step 5). **[DEFAULT v3] Food is
  DECOUPLED from `ext`** and uses the separate, much weaker `foodExt` (default `1.0`): a cell's
  food carrying capacity does **not** balloon with tech, so a growing population must spread
  across cells. This is the core driver of spatial expansion (see §5.2).
- Constant per-tech factor ⇒ exponentially growing absolute jumps ⇒ late techs blow open market
  scale. `ext(45) ≈ 8.7e7` at default — float-safe.
- **[DEFAULT v3] Tech is expensive.** `RESEARCH_C0` 10→100, `RESEARCH_R` 1.18→1.30 so casual
  allocation advances slowly (≈ tech 15 over 1000 years in the balance smoke, never maxing),
  while pouring nearly all raw into research (or growing territory/throughput first) advances
  much further. Tech is gated by **raw throughput** (labour + territory), independent of `ext`.
- The 46-entry `TECH_TABLE` (index 0 = baseline "(none)", index 1 = **Hoe**) lives in
  `config.ts`. Names are cosmetic; only count (`maxTechLevel`) and order matter.

### 5.2 Production function  **[DEFAULT]**

Per owned cell that has ≥1 person of the owning market. The **labor split** sets the mining
*capacity*; the **three-way raw policy** sets the *target disposition* of minable raw. Steps 3+4
are merged in `produce()` because they are tightly coupled per cell:
```
totalLabor   = cellPopulation(cell, market) * LABOR_CAPACITY
laborToFood  = totalLabor * policy.laborToFoodFrac
laborToRaw   = totalLabor - laborToFood                       // mining capacity this cycle

food         = min(laborToFood, foodYield[cell]) * foodExt(techLevel)   // land-limited (NOT ext)

minable      = rawYield[cell] + rawStock[cell]
mined        = min(laborToRaw, minable)                              // capped by mining labor
rawStock[cell] = minable - mined                                     // labour-limited remainder banks

toMarket     = mined * rawToMarketFrac     // -> rawToMarketThisCycle (goods)
toTech       = mined * rawToTechFrac       // -> techProgress (research)
toReserve    = mined * rawToReserveFrac    // -> rawReserves pool (+= rawToReserveThisCycle)
```
Per-cycle accumulators: `rawToMarketThisCycle += toMarket`, `techProgress += toTech`,
`rawReserves += toReserve`, `rawToReserveThisCycle += toReserve`, `rawMinedThisYear += mined`,
`foodThisYear += food`. The three fractions sum to 1, so they partition **mined** raw. Food not
produced is lost (perishable). A **labour-limited** remainder (when mining capacity < minable)
banks in `rawStock` (invader "pay dirt").

> **[DEFAULT] Where `ext`/`foodExt` apply:** `ext` scales **goods** from market-allocated raw
> (step 5). **Food uses `foodExt`** (default unity) so it stays land-limited. Mined raw is
> tracked in **raw units**; `orientation = toMarket / (toMarket + toReserve)` stays a pure
> raw-units ratio independent of tech level (research raw excluded).

### 5.3 The deterministic per-cycle (one year) resolution order  **[FROZEN]**

`tickBatch(state, rng, N)` calls `tick(state, rng)` up to **N times** (100-years-per-update
resolves 100 real years). It stops early and returns `{over:true,...}` the moment a §6 end
condition fires (so a win/loss mid-batch ends the run). Inside one `tick`, order is fixed and
applies **per market** where noted. At tick start (step 0): `refreshDerived`, reset every
per-cycle accumulator to 0, and (for AI markets) run `runAiPolicy` (§5.6).

```
For each year (repeat up to N times):
  0. PREP        refreshDerived; reset per-cycle accumulators
                 (goodsProducedThisCycle, goodsConsumedThisCycle, rawToMarketThisCycle,
                  rawToReserveThisCycle, bornThisYear, diedThisYear, foodThisYear) to 0;
                 run AI policy (sim/ai.ts) for non-player markets.
  1. TECH UNLOCK if techProgress >= researchCost(techLevel+1) and techLevel < max:
                    techProgress -= researchCost(techLevel+1); techLevel++.  (<=1 unlock/yr)
  2. BIRTHS      each LIVE person rolls individually: if rng.next() < BIRTH_RATE -> spawn ONE
                    new person on the SAME cell with the SAME owner and propensity 0,
                    subject to MAX_PERSONS (skip births once the global cap is hit).
                    market.bornThisYear += 1 per birth.
  3+4. PRODUCTION + RAW DISPOSITION  apply §5.2 across all owned cells (merged in produce()):
                    food uses foodExt (land-limited); each cell mines min(miningLabor, minable);
                    the THREE-WAY policy splits MINED raw into market (-> rawToMarketThisCycle),
                    tech (-> techProgress), and reserves (-> rawReserves, += rawToReserveThisCycle).
                    A labour-limited remainder banks in rawStock.
                    market.foodThisYear = Σ food.
                 (Raw's exactly three fates: market, tech, or unmined->rawStock.
                  TECH raw is EXCLUDED from orientation; persons NEVER hold raw.)
  5. GOODS       goodsProducedThisCycle = rawToMarketThisCycle * ext(techLevel)
                    capitalWealth += goodsProducedThisCycle
                 (There is NO player goods->people split. ALL produced goods enter the pool;
                  people draw from it automatically in step 7.)
  6. FOOD DEATHS if food < population: kill (population - food) DISTINCT persons of this market,
                    chosen uniformly at random across its live persons (killPerson on each).
                    market.diedThisYear += killed. (Leftover food discarded — perishable.)
  7. GOODS CONSUMPTION + DEATHS  (GENTLE; food is the primary constraint)
                    available = capitalWealth (prior savings + this cycle's goods)
                    need = population * desireToConsume
                    draw = min(need, available);  capitalWealth -= draw; goodsConsumedThisCycle = draw
                    if draw < need and need > 0:
                       shortfallFrac = (need - draw) / need
                       kill = round(population * shortfallFrac), CAPPED at GOODS_DEATH_MAX_FRAC of
                              population per year (gradual decadence, never an instant wipe).
                       record foodDeaths/goodsDeaths split + per-turn supply/demand (for the UI).
  8. DESIRE UPDATE [DEFAULT v3 — fixes the early goods die-off] desire EASES toward a fraction of
                    per-capita goods THROUGHPUT (flow), not accumulated capital (stock):
                      aspiration = DESIRE_SUPPLY_FRAC * (goodsProducedThisCycle / max(1,population))
                      desireToConsume += DESIRE_GROWTH_K * (aspiration - desireToConsume)   (>=0, <=DESIRE_CAP)
                    With DESIRE_SUPPLY_FRAC < 1 the surplus accrues as capital (wealth explosion
                    preserved) and steady production covers consumption, so desire can no longer
                    ratchet off a hoarded pile and mass-starve the market.
  9. MOVEMENT    sim/agents.moveIntents -> per-person intents; resolve each via
                    sim/conflict.resolveMove (fog reveal + absorption + conflict, §5.4/§5.5).
  9b. FORCED INTERVENTION (player only, §5.7): if the player unlocked a NEW tech this cycle and
                    forcedIntervention is ON and no burst is pending, QUEUE one with cost =
                    BURST_RAW_COST_MULT * rawMinedThisYear. If a burst is pending and
                    rawReserves >= its stored cost, FIRE it (sim/burst.fireBurst): deduct reserves
                    and annex an arm + terminus blob into the player. Else it stays banked.
 10. PROPENSITY  per person: if its current cell had a food deficit this year
                    (cell food < cell population for that market) -> propensity += PROPENSITY_RISE
                    else propensity -= PROPENSITY_DECAY; then relax any burst component by
                    *BURST_DECAY; clamp to [0,1].
 11. CONFLICT    (already resolved inline in step 9; label kept for traceability.)
 12. LOG         append per-year record {year, born, died, foodGenerated, goodsGenerated,
                    capitalWealth} per market (ring buffer for the stats screen).
  year += 1
  // §6 END CHECK after the year: if player researched the FINAL tech this run, finish this
  // cycle then signal WIN; if player population == 0 or player owns 0 cells, signal LOSS.
```

> **[DEFAULT] Propensity (reconciling the two clauses into one rule):**
> `propensity_next = clamp(propensity + (deficit ? +PROPENSITY_RISE : -PROPENSITY_DECAY), 0, 1)`,
> with any burst contribution decaying by `BURST_DECAY` per year, so a burst is a migration
> pulse, not a permanent state.
> **[DEFAULT] Conflict timing:** resolved inline in step 9; step 11 is a no-op label.

### 5.4 Movement (autonomous, per individual person)  **[DEFAULT]**

For each live person, if `rng.next() < personPropensity` the person attempts to move, up to
`MOBILITY` cells, **Rook adjacency only (N/S/E/W, no diagonals)**. Target within `VIEW_RANGE`:

- Owning market **people-oriented** (`orientation < 0.5`): move toward the in-range cell with
  the highest `foodYield`.
- Owning market **market-oriented** (`orientation ≥ 0.5`): move toward the in-range cell with
  highest **available** `rawYield` (skip cells already saturated by that market's local labor,
  i.e. local `laborToRaw ≥ rawYield + rawStock`).
- Wild persons (no market): people-oriented rule (toward highest `foodYield`).
- If no strictly-better cell exists, **stay** (no intent emitted).

Entering a cell sets `discovered = 1` and resolves by occupant (in `resolveMove`):
- **Unowned & empty** → cell `marketId` = mover's market; the person relocates there.
- **Occupied only by wild persons** → cell joins the mover's market; the wild persons on it are
  **absorbed** (`setPersonOwner` to the mover's market). No conflict.
- **Owned by another market & occupied by that market's persons** → conflict (§5.5). If conflict
  does **not** occur, the person does **not** enter; **the year is consumed** (stays at `from`).

### 5.5 Conflict (strictly market-vs-market)  **[DEFAULT]**

```
let a = orientation(mover.market), b = orientation(target.market)
gate:        |a - b| > CONFLICT_GATE            // 0.10
if !gate: no conflict -> mover stays, year consumed.
aggressor:   the market with the higher orientation (informational)
p_conflict:  clamp(|a - b|, 0, 1)               // e.g. 0.30 gap => 30% chance
roll = rng.next()
if roll < p_conflict:
    winner = market with greater capitalWealth (ties -> defender keeps it)
    ALL persons on the contested cell convert to winner's market (setPersonOwner each)
    contested cell marketId -> winner; banked rawStock TRANSFERS with the cell (pay-dirt loot)
    if winner == mover: mover completes entry; else mover stays (repelled), year consumed
else:
    no conflict -> mover stays, year consumed.
```

### 5.6 Non-player markets (AI)  **[DEFAULT — resolved]**

At world gen seed a **derived** count of AI markets — `floor(width*height / CELLS_PER_MARKET) - 1`
(the player is the remaining market) — each 1 cell + `AI_START_POP` discrete persons with random
`propensityToExpand ∈ [0,1]`. Also seed wild people by density: ~`WILD_CELL_DENSITY` of unowned
cells get a small group (`WILD_CELL_MIN..MAX`, each its own `groupId`/hue). `runAiPolicy` each
year sets the AI's labor split + three-way raw split:

- Labor: food-first using `foodExt` (not `ext`) — `laborToFoodFrac` ≈ fraction yielding
  `food ≈ population`, clamped [0,1]; remainder is mining capacity.
- Roll `rng.next() < propensityToExpand`. If true (**expansionary**): burst-spend (§5.7, if
  affordable) and mine hard for market — raw split `{market 0.85, tech 0.10, unmined 0.05}`
  (high orientation + wealth ⇒ conflict strength). If false (**steady**): raw split
  `{market 0.5, tech 0.2, unmined 0.3}`.
- People then consume from the capital pool automatically in §5.3 step 7.

Wild persons never form a market; they wander (§5.4 people-oriented) and are absorbed when a
market expands onto them.

### 5.7 Forced Intervention — Market Expansion (tech-triggered territory burst)  **[DEFAULT]**

The player's `forcedIntervention` toggle no longer does the legacy goods/propensity burst. Instead
it arms a dramatic, **tech-triggered** territory burst paid from the raw `rawReserves` pool
(`sim/burst.ts`, deterministic via `RNG_SALT.BURST`):

- **Trigger / queue.** Only when the toggle is ON **and** the player unlocks a NEW technology that
  cycle: queue a burst with `cost = BURST_RAW_COST_MULT (5) * rawMinedThisYear` (the cycle's TOTAL
  raw mined), **stored fixed** at queue time. Keep **at most one** pending burst.
- **Pay / bank.** Each cycle, if a burst is pending and `rawReserves >= cost`: deduct and **fire**.
  Otherwise it stays **banked** (pending) until reserves catch up. (If geometry finds no reachable
  territory it stays pending; reserves are not spent.)
- **Geometry (fired).** Player centroid; `R = sqrt(cells/π)`, `L = min(R, BURST_MAX_RANGE=250)`.
  Terminus center = a random pick among the top-10 **highest-raw** non-player cells within `R+L` of
  the centroid. An **arm** (Bresenham corridor, random width `[ARM_WIDTH_MIN..MAX]=[5,20]`) runs
  from a random player **boundary** cell to the terminus, ending in an **irregular blob**
  (angle-wobbled radius `[TERMINUS_RADIUS_MIN..MAX]=[15,35]`).
- **Annex (unconditional, no conflict rolls).** All arm+terminus cells become the player's:
  `marketId=0`, added to the player's `cells` (removed from any prior owner), banked `rawStock`
  travels with the cell, ALL persons on them (wild + enemy) convert to the player, fog revealed.
  Everything clamped to map bounds.

(AI markets still use the legacy `burstSpend` propensity pulse for their own expansion, §5.6.)

---

## 6. UI spec

**Layout.** Black background, white wireframe. Square cells. Right sidebar ≈25% width on
desktop; relocates to the **bottom** on mobile/portrait (CSS media query).

**World view.**
- **FOUR zoom levels, INVERTED** (highest = most zoomed IN): `cellSize = CELL_PX / 2^(4-zoom)` →
  4× = 32px (start), 3× = 16px, 2× = 8px, 1× = 4px. Buttons live on the **map overlay**.
- **Camera never shows out-of-bounds**: clamp so the visible window stays within the map; when the
  whole map is smaller than the canvas in a dimension, **center** it and render the surplus as
  solid black. Grid lines are drawn **only within the map extent** (both axes), never across black.
- Fog: undiscovered = blank. Owned = **live**; adjacent markets become visible via player vision.
- Pan: **arrow keys** + **on-screen arrow pad** (with a center-on-largest-blob button).
- Cell contents are **text only**, colored by owning market hue (or most-populous wild group).

**View modes** — a **top-center overlay on the map** (not the sidebar):
- **Population / Markets** — population count + color per cell.
- **Food** — `foodYield × foodExt(techLevel)` (discovered cells only).
- **Raw Materials** — `rawYield + rawStock` (discovered cells only).

In-cell numbers use the **compact** `formatCell` formatter (≤4 glyphs, e.g. `359`, `1.5k`,
`115m`), auto-shrunk to fit and omitted at 16px if they can't; a **hover tooltip** over the map
shows the full precise value(s), cell coordinates, and owning market.

**Decision loop (this is the game).** The player controls **exactly one market** (the
`isPlayer` market) and nothing else. All controls live in a grouped **Policy** section, applied
to every batched year of the turn:
1. **Labor** box — Food vs Mining, **neutral/equal-weight** two-slider group summing to 100%
   (`laborToFoodFrac`; mining = 1 − food). Neither side is visually privileged.
2. **Raw allocation** box — **three** sliders summing to 100%: Market (→goods), Tech (→research),
   **Retain in reserves** (→`rawReserves`). Dragging one rescales the others proportionally so the
   total stays 100%. Defaults `60 / 10 / 30`.
3. **Forced Intervention — Market Expansion** checkbox — when ON, unlocking a NEW tech spends
   `5×` the cycle's raw from reserves to burst-expand into fresh territory (§5.7); banks if reserves
   are short. The sub-text shows pending-burst status with its raw cost vs current reserves.

People consume goods automatically from `capitalWealth` (§5.3 step 7); there is no
goods-to-people control. The player's "growth vs restraint" posture (which drives conflict) is
emergent from how hard they mine and where mined raw goes, captured by `orientation`.

Plus **Years per turn** — exactly **three** options: **10 / 50 / 250** (default 10). **Zoom**
(1×–4×) lives on the **map overlay** next to the arrow pad, not in the sidebar. **End Turn**
posts `{type:'TICK', years}` and redraws on `SNAPSHOT`. An **auto-play** toggle repeats turns.

**Sidebar live stats:** Year, current tech name + research progress
(`techProgress / researchCost(next)`), population, market size (cells), Capital Wealth,
**Reserves** (`rawReserves` — the burst pool, renamed/repurposed from the old unmined metric),
goods produced/cycle, goods consumed/capita, current `orientation`, plus a **supply/demand + deaths
panel** (all per-turn totals across the most recent End Turn batch, so a 50-year turn sums 50
years — chosen as the most legible aggregate):
- **Food req / produced** — `foodNeededThisTurn` (= Σ population, 1 food/person/cycle) vs
  `foodProducedThisTurn`.
- **Goods req / available** — `goodsNeededThisTurn` (= Σ population×desireToConsume) vs
  `goodsAvailableThisTurn` (= Σ prior capital + that cycle's goods).
- **Deaths — food (turn)** and **Deaths — goods (turn)** — split by cause, with cumulative
  totals in parentheses; plus **Deaths — total (turn)** and **Deaths (cumulative)**.
This makes the cause of any die-off (food vs goods/desire starvation) immediately visible.
Large numbers via `formatNumber`.

**Live mini-charts.** A `History · per year` panel renders five small line charts from the
player's full per-year log (shipped in the `Snapshot`): Population, Raw mined/yr, Food
produced/yr, Market goods/yr, Tech invested/yr. The x-axis shows a window of **≥100 years**
(empty right early on) that grows to **1000**; beyond 1000 years each chart becomes a
horizontally **scrollable** 1000-year window, auto-scrolled fully right on each new turn. (This
requires `YearLog` to carry `rawMined` + `techInvested`, recorded each tick.)

**Start condition.** Player market id 0 = 1 cell, 10 discrete persons, placed ≥10 cells from
every edge, on a guaranteed-fertile start cell. First researchable tech = the Hoe (level 1).

**End conditions.**
- **Win / completion:** the player market researches the **final** technology (level 45), runs
  one more full cycle, then the game ends and shows the summary stats (persons born and killed
  by year-since-epoch, food and goods/wealth generated by year and in total). Worker emits
  `GAME_OVER {outcome:'win'}`.
- **Loss:** the player market's population reaches 0 **or** it loses its last cell. Game ends
  with the same summary screen marked as a loss (`GAME_OVER {outcome:'loss'}`). AI markets being
  wiped out does **not** end the game.

---

## 7. Determinism, seeding, persistence

- **One world seed** drives terrain noise **and** all RNG (births, deaths, movement, conflict).
  Same seed + same policy inputs → identical run. The **Web Worker owns the RNG**; the main
  thread never calls `Math.random` for anything that affects state.
- Use `rng.fork(salt)` per subsystem to keep streams stable across refactors; document salt
  constants in `config.ts`.
- **Autosave to `localStorage` once per turn** (after each `TICK`). Serialize the full
  `WorldState` (seed + all typed arrays incl. the person pool + markets + `rngState`). Typed
  arrays → base64. On load, `deserialize` restores exactly (including `rngState`), so continuing
  a save is bit-identical to never having stopped.
- **World gen:** 1 player market (1 cell, 10 discrete persons, ≥10 cells from any edge, on a
  fertile start cell), a **derived** `floor(W*H/CELLS_PER_MARKET)-1` AI markets, and wild people
  seeded at `WILD_CELL_DENSITY`. Map default **300×300** (floored at `MAP_MIN_SIZE`), cell 32px.
  `createWorld(seed, w, h, opts?)` accepts optional `{wildCellDensity, aiMarkets}` overrides
  (used by tests for sparse, isolated economies). All knobs in `config.ts`.

---

## 8. Task DAG

Format per node: `id` · title · `dependsOn` · `owningModule` · `parallelSafe` ·
`acceptanceCriteria` (machine-checkable) · `commitMessage`.

**Commit/merge strategy — chosen: (A) Serialized DAG.** Cheap-model fan-out + a single `main`
make serialized commits safest: each task depends on the prior commit; **one push at a time**,
in wave order. Within a wave, tasks are *developed* in parallel but **committed serially** in
the listed order (no concurrent pushes to `main`). GH Pages deploy is the **terminal node of
each wave**, never mid-wave.

### Wave 0 — scaffold & frozen contracts (serial)
- **T0.1** Repo scaffold: Vite + TS + vitest. deps: — · `package.json`,`vite.config.ts`,`tsconfig.json` · serial ·
  AC: `npm ci && npm run build` exits 0; `npm test` runs (0 tests OK). · `chore: scaffold vite + ts + vitest`
- **T0.2** `config.ts` with all `[TUNABLE]` constants + 46-entry `TECH_TABLE` (index1=Hoe). deps:T0.1 · `config.ts` · serial ·
  AC: `TECH_TABLE.length === 46`; `CONFIG.TECH_MULTIPLIER===1.5`; no `goodsToPeople*` constant exists; type-checks. · `feat: add config constants and tech table`
- **T0.3** Empty typed contracts: `world/state.ts` (incl. `Policy` = 2 sliders, person-pool fields), `sim/tick.ts` (`EndState`), `worker/simWorker.ts` protocol (incl. `GAME_OVER`), `persistence.ts` types — signatures + `throw new Error('not implemented')`. deps:T0.2 · those files · serial ·
  AC: `tsc --noEmit` passes; every §3.1/§4 signature exists & exported; `Policy` carries `laborToFoodFrac` + the 3-way raw split + `forcedIntervention`. · `feat: freeze state, tick, worker, persistence contracts`
- **T0.4** CI workflow (build+test) + GH Pages deploy (`actions/deploy-pages`), deploy gated on build. deps:T0.1 · `.github/workflows/*` · serial ·
  AC: workflow YAML lints; `vite.config.ts` `base` = `/synthetic-markets/`. · `ci: add build/test and gh-pages deploy workflows`

### Wave 1 — independent leaves (parallel-safe, commit in order)
- **T1.1** `world/rng.ts`: deterministic PRNG + fork/serialize. deps:T0.3 · `world/rng.ts` · parallel ·
  AC: same seed → identical sequence; `getState/setState` round-trips; `nextInt(n)` uniform within tolerance over 10k samples. · `feat: seeded deterministic rng`
- **T1.2** `world/terrain.ts`: seeded fBm noise → yields. deps:T0.3 · `world/terrain.ts` · parallel ·
  AC: deterministic for a seed; arrays length `w*h`; values in `[0,FOOD_YIELD_MAX]`/`[0,RAW_YIELD_MAX]`; neighbor-variance test shows autocorrelation > random. · `feat: seeded autocorrelated terrain`
- **T1.3** `sim/tech.ts`: `ext`, `researchCost`, `maxTechLevel`. deps:T0.2 · `sim/tech.ts` · parallel ·
  AC: `ext(0)===1`; `ext(1)===1.5`; `ext(45)` finite & `< Number.MAX_SAFE_INTEGER`; `researchCost` strictly increasing. · `feat: tech ext multiplier and research cost`
- **T1.4** `persistence.ts`: save/load/clear + typed-array base64 (de)serialize. deps:T0.3 · `persistence.ts` · parallel ·
  AC: round-trip of a sample `SerializedState` deep-equal; corrupt/missing key → `load()===null`. · `feat: localStorage persistence with base64 arrays`
- **T1.5** `render/format.ts#formatNumber`. deps:T0.1 · `render/format.ts` · parallel ·
  AC: `formatNumber(82_000_000)==='82.0M'`; handles K/M/B/T, negatives, <1000 verbatim. · `feat: K/M/B/T number formatter`
- **T1.D** Deploy verification (terminal). deps:T1.1..T1.5 · serial · AC: `main` builds & deploys green. · `ci: verify wave-1 deploy`

### Wave 2 — economy/agents/conflict/ai against frozen state+tick (commit in order)
- **T2.0** Implement `world/state.ts`: person SoA pool (spawn/kill/move/setOwner), per-cell linked list + counts, accessors, (de)serialize, `createWorld` + world gen seeding (player + AI + wild per §7). deps:T1.1,T1.2,T1.4 · `world/state.ts` · serial ·
  AC: `createWorld` places player ≥10 from edges with **10 discrete persons** (liveCount reflects them); `AI_MARKET_COUNT` AI markets exist; Σ wild ≈ `WILD_PERSON_COUNT`; `personsOnCell`/`cellPopulation` consistent after spawn/kill/move; serialize→deserialize byte-identical state hash. · `feat: implement world state, person pool, world gen`
- **T2.1** `sim/economy.ts` (§5.2 + steps 4–8). deps:T2.0,T1.3 · `sim/economy.ts` · parallel ·
  AC: `produce` matches §5.2 on a fixture; raw conservation `research + market + unmined == rawYield+rawStock_before` (raw units); `goodsProducedThisCycle == rawToMarketThisCycle*ext`; capital conserved `prior+produced-consumed`; deaths delete discrete persons, never population<0. · `feat: economy production, allocation, auto-consumption, deaths`
- **T2.2** `sim/agents.ts` (births, movement targeting, propensity). deps:T2.0 · `sim/agents.ts` · parallel ·
  AC: each person rolls `BIRTH_RATE` independently (mean check) & respects `MAX_PERSONS`; move targets obey orientation rule + rook adjacency + `VIEW_RANGE`; propensity clamps [0,1]. · `feat: per-person births, movement, propensity`
- **T2.3** `sim/conflict.ts` (§5.5 + move resolution §5.4). deps:T2.0 · `sim/conflict.ts` · parallel ·
  AC: gate honored (`|Δ|>0.10`); winner = greater `capitalWealth`; rawStock transfers with cell; wild absorbed without conflict; no-conflict consumes the year; person owner flips via `setPersonOwner`. · `feat: conflict gate, resolution, move application`
- **T2.4** `sim/ai.ts` (§5.6). deps:T2.0,T1.3 · `sim/ai.ts` · parallel ·
  AC: expansionary roll uses `propensityToExpand`; fixed policy feeds population first; sets only the two sliders; burst only when affordable; player market untouched. · `feat: ai fixed-policy controller`
- **T2.D** Deploy verification (terminal). deps:T2.0..T2.4 · serial · AC: green. · `ci: verify wave-2 deploy`

### Wave 3 — wire the spine (serial)
- **T3.1** `sim/tick.ts`: `tick` runs §5.3 steps 0–12 in order; `tickBatch` loops up to N, stops early on §6 end conditions, returns `EndState`. deps:T2.1,T2.2,T2.3,T2.4 · `sim/tick.ts` · serial ·
  AC: 100-year integration run without error; **batch-equivalence** (100× `tick` ≡ `tickBatch(...,100)` by state hash when no game-over); determinism (same seed+policy → identical hash); win fires at final tech +1 cycle; loss fires at player pop 0 / 0 cells. · `feat: wire deterministic yearly tick, batch, end conditions`
- **T3.2** `worker/simWorker.ts` + `render/snapshot.ts`: implement protocol (§3.1), own state+rng, autosave per turn, emit `SNAPSHOT`/`GAME_OVER`. deps:T3.1,T1.4 · `worker/simWorker.ts`,`render/snapshot.ts` · serial ·
  AC: INIT→READY+SNAPSHOT; TICK→SNAPSHOT (advanced year) or GAME_OVER; SAVE round-trips; snapshot carries per-market `orientation`; no `Math.random` in worker. · `feat: simulation worker + snapshot builder`
- **T3.D** Deploy verification (terminal). deps:T3.2 · serial · AC: green. · `ci: verify wave-3 deploy`

### Wave 4 — render & UI against snapshot contract (commit in order)
- **T4.1** `render/viewport.ts` pan/zoom/culling. deps:T3.2 · parallel · AC: `visibleCellRange` culls; pan clamps to bounds; two zoom levels only. · `feat: viewport pan/zoom/culling`
- **T4.2** `render/canvas.ts` `draw` for all three view modes + fog + tint/backing + text. deps:T3.2,T1.5,T4.1 · parallel · AC: renders a fixture snapshot without throwing; undiscovered blank; numbers via `formatNumber`. · `feat: canvas renderer with view modes and fog`
- **T4.3** `ui/sidebar.ts` **two** sliders/toggle/burst/end-turn/years + live stats. deps:T3.2 · parallel · AC: emits correct callbacks; `Policy` has exactly 2 fields; `update(snap)` reflects all §6 stats incl. `orientation`; responsive (sidebar→bottom on portrait). · `feat: sidebar controls and live stats`
- **T4.4** `main.ts` bootstrap: spawn worker, wire input (arrows + buttons), connect sidebar+canvas, load autosave, route `GAME_OVER` to the summary screen. deps:T4.1,T4.2,T4.3,T5.1 · serial · AC: `npm run build` → playable static bundle; End Turn advances the visible year; game-over shows summary. · `feat: app bootstrap, input wiring, game-over routing`
- **T4.D** Deploy verification (terminal). deps:T4.4 · serial · AC: deployed page interactive. · `ci: verify wave-4 deploy`

### Wave 5 — endgame & final deploy (serial)
- **T5.1** `ui/stats.ts` end-game summary (win/loss): per-year log charts (born/died/food/goods/wealth) + totals + tech timeline. deps:T3.2 · `ui/stats.ts` · serial · AC: `showSummary` renders from the §5.3 step-12 log; distinguishes win vs loss; no NaNs. · `feat: end-game summary and stats screen`
  *(Note: T4.4 depends on T5.1 so the bootstrap can route GAME_OVER; T5.1 only needs the snapshot/log contract from T3.2, so it is built early in this wave.)*
- **T5.2** Balance smoke-test report (flagged, not asserted) per §9 + README. deps:T5.1 · `tests/balance.test.ts`,`README.md` · serial · AC: report prints collapse/runaway flags for default tunables. · `feat: balance smoke-test report and readme`
- **T5.D** Final GH Pages deploy verification. deps:T5.2 · serial · AC: production URL live, autosave persists across reload, win & loss both reachable. · `ci: final gh-pages deploy verification`

---

## 9. Testing strategy — invariants as guardrails (vitest property tests)

Asserted invariants (must pass in CI):
- **Conservation (raw, raw units):** per cell per cycle, `mined + unmined == rawYield + rawStock_before`; per market, mined raw splits exactly into `toResearch + rawToMarketThisCycle`.
- **Conservation (goods → capital):** `goodsProducedThisCycle == rawToMarketThisCycle * ext(techLevel)`; capital conserved across a cycle: `capital_after == capital_before + goodsProducedThisCycle - goodsConsumedThisCycle`.
- **Orientation domain:** `orientation ∈ [0,1]` for every market every cycle (raw-units market-vs-fallow ratio, research excluded), with `0/0 → 0` guard.
- **No negative state:** population, food, goods, `capitalWealth`, `rawStock`, `techProgress` never below 0.
- **Death floor:** after step 6, `population ≤ floor(foodAvailableThisCycle)` for that market.
- **Discrete-person integrity:** `liveCount == Σ cellPopulation == Σ marketPopulation`; every live person has a valid `personCell` and appears in exactly one cell linked list; freed slots have `personCell == -1`.
- **Batch equivalence:** 100 single-year `tick`s ≡ one `tickBatch(...,100)` (identical state hash, same seed) when no game-over fires — protects "speed-up still resolves every year."
- **Determinism:** same seed + same policy stream → byte-identical serialized state hash.
- **End conditions:** win fires only at final tech + one extra cycle; loss fires exactly when player population hits 0 or player owns 0 cells; AI extinction never ends the game.
- **Tech bound:** `ext(maxTechLevel())` finite and `< Number.MAX_SAFE_INTEGER` at default `TECH_MULTIPLIER`; `formatNumber(ext(45))` renders with a suffix (anti-`2^45` + display test).

Flagged smoke tests (report, do **not** fail CI):
- Whether the step-7 goods-death rule causes runaway collapse of large markets; surface for
  human tuning of `TECH_MULTIPLIER`, `DESIRE_GROWTH_K`, and research growth `RESEARCH_R`.

---

## 10. Git / CI workflow

- Local dir: `/Users/kuanbutts/Documents/synthetic_markets`. Remote:
  `git@github.com:kuanb/synthetic-markets.git`.
- Commit to `main` per the **(A) Serialized DAG** order in §8: one push at a time, wave by wave.
- **No attribution** in commits: author = the GH user only. **No** `Co-authored-by`, **no** tool
  trailers, **no** "Generated by" lines.
- **GH Pages** via official **`actions/deploy-pages`**, building the Vite static bundle on push
  to `main`. `vite.config.ts` `base` = `/synthetic-markets/`. Fully static, no backend.
- The deploy job is the **terminal node** of the DAG and of each wave — **never concurrent**
  with implementation pushes.

---

## Appendix A — frozen invariants the Sonnet fleet must not violate
1. Field names come **only** from §2. No synonyms. There is **no** `goodsToPeople`/`goodsToMarket`.
2. `marketId = -1` is the unowned sentinel; player market id = `0`; **exactly one** `isPlayer`.
3. "Population" is a count of **discrete Person records**; births/deaths/movement/conflict/absorption all operate on individual records.
4. The tick order in §5.3 is fixed; do not reorder steps.
5. Persons never hold raw; raw's only fates are research, market, or banked `rawStock`.
6. Food is perishable (never banked); raw banks in `rawStock`.
7. Goods are never a player allocation; all produced goods enter `capitalWealth`; people consume automatically (step 7).
8. `orientation` is the raw-units `rawToMarket / (rawToMarket + rawToReserve)` ratio, research excluded, `0/0→0`.
9. The player controls exactly one market; conquest converts enemy cells/persons into it, never grants a second.
10. Conflict is strictly market-vs-market; wild persons are absorbed, never fought.
11. All RNG flows through the worker-owned seeded `RNG`; no `Math.random` affecting state.
12. All `[TUNABLE]` values live in `config.ts`; large numbers render via `formatNumber` (K/M/B/T).
13. Game ends: **win** at final tech +1 cycle; **loss** at player pop 0 / 0 cells; AI extinction does not end the game.
14. Within a wave, develop in parallel but **commit serially** in listed order; deploy last.
