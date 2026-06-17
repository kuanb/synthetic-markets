// Authoritative WorldState: Land SoA + discrete Person SoA pool + Markets, plus accessors.

import { CONFIG, RNG_SALT } from '../config';
import { generateTerrain } from './terrain';
import { makeRng, type RngState } from './rng';
import {
  encodeF32,
  encodeI32,
  encodeU8,
  decodeF32,
  decodeI32,
  decodeU8,
} from '../util/base64';

export interface Policy {
  laborToFoodFrac: number; // [0,1]; mining-labor frac = 1 - this
  // Three-way disposition of MINED raw (sums to 1):
  rawToMarketFrac: number; //  -> goods (capitalWealth), tech-scaled in step 5
  rawToTechFrac: number; //    -> techProgress (research)
  rawToReserveFrac: number; // -> accumulates into Market.rawReserves (funds the tech-burst)
  // Player-only: when ON, unlocking a NEW technology queues a territory-burst paid from
  // rawReserves (see sim/burst.ts). Unused for AI markets.
  forcedIntervention: boolean;
}

export interface Market {
  id: number;
  techLevel: number;
  techProgress: number;
  capitalWealth: number;
  rawReserves: number; // persistent pool of retained raw; funds the Forced-Intervention burst
  pendingBurst: boolean; // a queued territory-burst awaiting sufficient reserves
  pendingBurstCost: number; // raw cost stored at queue time (= BURST_RAW_COST_MULT * cycle rawMined)
  pendingBurstTech: number; // techLevel that triggered the pending burst (for the event message)
  cells: Set<number>;
  colorHue: number;
  desireToConsume: number;
  policy: Policy;
  propensityToExpand: number;
  isPlayer: boolean;
  // per-cycle accumulators
  goodsProducedThisCycle: number;
  goodsConsumedThisCycle: number;
  rawToMarketThisCycle: number;
  rawToReserveThisCycle: number; // raw allocated to reserves this cycle (orientation denominator)
  bornThisYear: number;
  diedThisYear: number; // reset every simulated year (drives the per-year log)
  diedThisTurn: number; // accumulated across all years of the most recent End Turn batch
  // per-turn diagnostics (reset at the start of each tickBatch; totals across the batched years)
  foodDeathsThisTurn: number;
  goodsDeathsThisTurn: number;
  foodNeededThisTurn: number; // Σ population each year (each person needs 1 food/cycle)
  foodProducedThisTurn: number; // Σ market food output each year
  goodsNeededThisTurn: number; // Σ population * desireToConsume each year
  goodsAvailableThisTurn: number; // Σ goods available to consume (prior capital + this cycle's goods)
  // cumulative death tallies by cause (never reset)
  foodDeathsTotal: number;
  goodsDeathsTotal: number;
  foodThisYear: number;
  rawMinedThisYear: number; // total raw units mined this year (reset each tick)
  techInvestedThisYear: number; // raw allocated to research this year (reset each tick)
  population: number;
}

export interface YearLog {
  year: number;
  born: number;
  died: number;
  food: number;
  goods: number;
  rawMined: number;
  techInvested: number;
  capitalWealth: number;
  population: number;
}

// Player-facing "major historical events" feed. Derived data only (never affects sim RNG / state
// evolution), but persisted with the world so the log survives save/load.
export type EventKind =
  | 'epoch' // world founded (year 0)
  | 'tech' // a technology was discovered
  | 'intervention' // a Forced-Intervention territory burst fired
  | 'boom' // a large single-year population gain
  | 'dieoff' // a large single-year population loss
  | 'encounter' // a rival-market encounter milestone was reached
  | 'policy'; // the player changed their allocation policy

export interface GameEvent {
  year: number;
  kind: EventKind;
  text: string;
}

export interface WorldState {
  seed: number;
  width: number;
  height: number;
  year: number;
  finalTechYear: number; // year the player unlocked the final tech, else -1
  log: YearLog[];
  events: GameEvent[]; // major historical events (player-facing)
  encounteredMarkets: Set<number>; // rival market ids whose territory the player has discovered
  // Land SoA
  foodYield: Float32Array;
  rawYield: Float32Array;
  rawStock: Float32Array;
  marketId: Int32Array; // -1 = unowned
  discovered: Uint8Array;
  // per-cell person index
  cellHead: Int32Array;
  cellPopulation: Int32Array;
  // Person SoA pool
  personCell: Int32Array; // -1 = free
  personOwner: Int32Array;
  personPropensity: Float32Array;
  personNext: Int32Array;
  personPrev: Int32Array;
  personCapacity: number;
  personFreeList: number[];
  liveCount: number;
  // markets + wild
  markets: Market[];
  nextWildGroupId: number;
  rngState: RngState;
}

// ---- owner encoding ----
export function wildOwnerCode(groupId: number): number {
  return -(groupId + 2);
}
export function isWild(code: number): boolean {
  return code <= -2;
}
export function groupIdOf(code: number): number {
  return -code - 2;
}
export function marketIdOf(code: number): number {
  return code; // valid only when code >= 0
}

// ---- cell helpers ----
export function idx(s: WorldState, x: number, y: number): number {
  return y * s.width + x;
}
export function inBounds(s: WorldState, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < s.width && y < s.height;
}

// ---- pool growth ----
function ensureCapacity(s: WorldState): void {
  if (s.personFreeList.length > 0) return;
  const oldCap = s.personCapacity;
  const newCap = Math.max(64, oldCap * 2);
  const grow = (src: Int32Array, fill = 0) => {
    const dst = new Int32Array(newCap).fill(fill);
    dst.set(src);
    return dst;
  };
  s.personCell = grow(s.personCell, -1);
  s.personOwner = grow(s.personOwner);
  s.personNext = grow(s.personNext, -1);
  s.personPrev = grow(s.personPrev, -1);
  const prop = new Float32Array(newCap);
  prop.set(s.personPropensity);
  s.personPropensity = prop;
  s.personCapacity = newCap;
  for (let i = oldCap; i < newCap; i++) s.personFreeList.push(i);
}

// ---- person pool ----
export function spawnPerson(s: WorldState, cell: number, owner: number, propensity: number): number {
  if (s.liveCount >= CONFIG.MAX_PERSONS) return -1;
  ensureCapacity(s);
  const p = s.personFreeList.pop()!;
  s.personCell[p] = cell;
  s.personOwner[p] = owner;
  s.personPropensity[p] = propensity;
  // link at head of cell list
  const head = s.cellHead[cell];
  s.personNext[p] = head;
  s.personPrev[p] = -1;
  if (head !== -1) s.personPrev[head] = p;
  s.cellHead[cell] = p;
  s.cellPopulation[cell]++;
  s.liveCount++;
  return p;
}

function unlink(s: WorldState, p: number): void {
  const cell = s.personCell[p];
  const prev = s.personPrev[p];
  const next = s.personNext[p];
  if (prev === -1) s.cellHead[cell] = next;
  else s.personNext[prev] = next;
  if (next !== -1) s.personPrev[next] = prev;
  s.cellPopulation[cell]--;
}

export function killPerson(s: WorldState, p: number): void {
  if (s.personCell[p] === -1) return;
  unlink(s, p);
  s.personCell[p] = -1;
  s.personNext[p] = -1;
  s.personPrev[p] = -1;
  s.personFreeList.push(p);
  s.liveCount--;
}

export function movePerson(s: WorldState, p: number, toCell: number): void {
  unlink(s, p);
  const head = s.cellHead[toCell];
  s.personCell[p] = toCell;
  s.personNext[p] = head;
  s.personPrev[p] = -1;
  if (head !== -1) s.personPrev[head] = p;
  s.cellHead[toCell] = p;
  s.cellPopulation[toCell]++;
}

export function setPersonOwner(s: WorldState, p: number, owner: number): void {
  const prev = s.personOwner[p];
  if (prev === owner) return;
  // Keep the per-market population caches exact through conflict/absorption (owner changes),
  // so the cache never drifts from the true count between refreshes (matters for serialize).
  if (prev >= 0 && s.markets[prev]) s.markets[prev].population--;
  if (owner >= 0 && s.markets[owner]) s.markets[owner].population++;
  s.personOwner[p] = owner;
}

export function personsOnCell(s: WorldState, cell: number): number[] {
  const out: number[] = [];
  for (let p = s.cellHead[cell]; p !== -1; p = s.personNext[p]) out.push(p);
  return out;
}

export function cellPopulation(s: WorldState, cell: number): number {
  return s.cellPopulation[cell];
}

export function cellLabor(s: WorldState, cell: number, marketId: number): number {
  let n = 0;
  for (let p = s.cellHead[cell]; p !== -1; p = s.personNext[p]) {
    if (s.personOwner[p] === marketId) n++;
  }
  return n * CONFIG.LABOR_CAPACITY;
}

// ---- market helpers ----
export function marketPopulation(s: WorldState, marketId: number): number {
  let n = 0;
  for (let p = 0; p < s.personCapacity; p++) {
    if (s.personCell[p] !== -1 && s.personOwner[p] === marketId) n++;
  }
  return n;
}

// Growth-vs-holding-back: mined raw pushed to MARKET vs retained in RESERVES (research excluded).
// In [0,1]; 0 if neither (the 0/0 guard).
export function orientation(m: Market): number {
  const denom = m.rawToMarketThisCycle + m.rawToReserveThisCycle;
  if (denom <= 0) return 0;
  return m.rawToMarketThisCycle / denom;
}

export function refreshDerived(s: WorldState): void {
  for (const m of s.markets) m.population = 0;
  for (let p = 0; p < s.personCapacity; p++) {
    if (s.personCell[p] === -1) continue;
    const owner = s.personOwner[p];
    if (owner >= 0) s.markets[owner].population++;
  }
}

// ---- world gen ----
function makeMarket(id: number, isPlayer: boolean, propensityToExpand: number): Market {
  return {
    id,
    techLevel: 0,
    techProgress: 0,
    capitalWealth: 0,
    rawReserves: 0,
    pendingBurst: false,
    pendingBurstCost: 0,
    pendingBurstTech: 0,
    cells: new Set<number>(),
    colorHue: (210 + id * 137.508) % 360,
    desireToConsume: 0,
    policy: {
      laborToFoodFrac: CONFIG.LABOR_TO_FOOD_DEFAULT,
      rawToMarketFrac: CONFIG.RAW_TO_MARKET_DEFAULT,
      rawToTechFrac: CONFIG.RAW_TO_TECH_DEFAULT,
      rawToReserveFrac: CONFIG.RAW_RESERVE_DEFAULT,
      forcedIntervention: false,
    },
    propensityToExpand,
    isPlayer,
    goodsProducedThisCycle: 0,
    goodsConsumedThisCycle: 0,
    rawToMarketThisCycle: 0,
    rawToReserveThisCycle: 0,
    bornThisYear: 0,
    diedThisYear: 0,
    diedThisTurn: 0,
    foodDeathsThisTurn: 0,
    goodsDeathsThisTurn: 0,
    foodNeededThisTurn: 0,
    foodProducedThisTurn: 0,
    goodsNeededThisTurn: 0,
    goodsAvailableThisTurn: 0,
    foodDeathsTotal: 0,
    goodsDeathsTotal: 0,
    foodThisYear: 0,
    rawMinedThisYear: 0,
    techInvestedThisYear: 0,
    population: 0,
  };
}

function reveal(s: WorldState, cell: number): void {
  const x = cell % s.width;
  const y = Math.floor(cell / s.width);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (inBounds(s, x + dx, y + dy)) s.discovered[idx(s, x + dx, y + dy)] = 1;
    }
  }
}

// Reveal fog around all player-owned cells (8-neighborhood), so any market the player is
// adjacent to becomes visible on the map with its live person count + color. Records any rival
// market whose territory is newly revealed into s.encounteredMarkets (drives encounter events).
export function revealPlayerVision(s: WorldState): void {
  const player = s.markets[0];
  if (!player) return;
  const W = s.width;
  const H = s.height;
  for (const cell of player.cells) {
    const x = cell % W;
    const y = (cell / W) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= H) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= W) continue;
        const nc = ny * W + nx;
        if (s.discovered[nc] === 1) continue; // already seen
        s.discovered[nc] = 1;
        const owner = s.marketId[nc];
        if (owner >= 1) s.encounteredMarkets.add(owner); // owner 0 is the player; -1 is unowned
      }
    }
  }
}

// Append a major historical event (player-facing). Bounded so a very long game can't grow it
// without limit; the oldest events drop first.
export function logEvent(s: WorldState, kind: EventKind, text: string): void {
  s.events.push({ year: s.year, kind, text });
  if (s.events.length > CONFIG.EVENT_LOG_MAX) s.events.shift();
}

function claimCell(s: WorldState, cell: number, m: Market): void {
  s.marketId[cell] = m.id;
  m.cells.add(cell);
}

// AI market count derived from map size: ~1 market per CELLS_PER_MARKET cells, minus the player.
export function aiMarketCount(width: number, height: number): number {
  return Math.max(0, Math.floor((width * height) / CONFIG.CELLS_PER_MARKET) - 1);
}

// Optional world-gen overrides (used by tests to get sparse, isolated economies). Game uses defaults.
export interface WorldGenOpts {
  wildCellDensity?: number;
  aiMarkets?: number;
}

export function createWorld(
  seed: number,
  width: number,
  height: number,
  opts: WorldGenOpts = {},
): WorldState {
  const terrain = generateTerrain(seed, width, height);
  const n = width * height;
  const cellHead = new Int32Array(n).fill(-1);
  const s: WorldState = {
    seed,
    width,
    height,
    year: 0,
    finalTechYear: -1,
    log: [],
    events: [],
    encounteredMarkets: new Set<number>(),
    foodYield: terrain.foodYield,
    rawYield: terrain.rawYield,
    rawStock: new Float32Array(n),
    marketId: new Int32Array(n).fill(-1),
    discovered: new Uint8Array(n),
    cellHead,
    cellPopulation: new Int32Array(n),
    personCell: new Int32Array(0),
    personOwner: new Int32Array(0),
    personPropensity: new Float32Array(0),
    personNext: new Int32Array(0),
    personPrev: new Int32Array(0),
    personCapacity: 0,
    personFreeList: [],
    liveCount: 0,
    markets: [],
    nextWildGroupId: 0,
    rngState: 0,
  };

  const rng = makeRng(seed).fork(RNG_SALT.WORLDGEN);

  // Player market (id 0), >= margin cells from every edge.
  const margin = CONFIG.PLAYER_EDGE_MARGIN;
  const px = margin + rng.nextInt(Math.max(1, width - 2 * margin));
  const py = margin + rng.nextInt(Math.max(1, height - 2 * margin));
  const player = makeMarket(0, true, 0);
  s.markets.push(player);
  const playerCell = idx(s, px, py);
  // Guarantee a survivable, fertile start: the start cell is fully fertile and its rook
  // neighbours have a minimum food yield so early growth has somewhere to expand into.
  s.foodYield[playerCell] = Math.max(s.foodYield[playerCell], CONFIG.PLAYER_START_FOOD);
  for (const [dx, dy] of [
    [0, -1],
    [0, 1],
    [-1, 0],
    [1, 0],
  ]) {
    if (inBounds(s, px + dx, py + dy)) {
      const nc = idx(s, px + dx, py + dy);
      s.foodYield[nc] = Math.max(s.foodYield[nc], CONFIG.PLAYER_START_NEIGHBOR_FOOD_MIN);
    }
  }
  claimCell(s, playerCell, player);
  reveal(s, playerCell);
  for (let i = 0; i < CONFIG.PLAYER_START_POP; i++) spawnPerson(s, playerCell, 0, 0);

  // AI markets — count derived from map size (~1 per CELLS_PER_MARKET cells), unless overridden.
  const aiCount = opts.aiMarkets ?? aiMarketCount(width, height);
  const used = new Set<number>([playerCell]);
  for (let a = 1; a <= aiCount; a++) {
    let cell: number;
    let guard = 0;
    do {
      cell = rng.nextInt(n);
      guard++;
    } while (used.has(cell) && guard < 1000);
    used.add(cell);
    const m = makeMarket(a, false, rng.next());
    s.markets.push(m);
    claimCell(s, cell, m);
    for (let i = 0; i < CONFIG.AI_START_POP; i++) spawnPerson(s, cell, a, 0);
  }

  // Wild population by density: seed ~wildCellDensity of the unowned cells with a small group,
  // so roughly half the map is occupied at gen. Single pass over cells (deterministic).
  const wildDensity = opts.wildCellDensity ?? CONFIG.WILD_CELL_DENSITY;
  const span = Math.max(1, CONFIG.WILD_CELL_MAX - CONFIG.WILD_CELL_MIN + 1);
  for (let cell = 0; cell < n; cell++) {
    if (s.marketId[cell] !== -1) continue;
    if (rng.next() >= wildDensity) continue;
    const size = CONFIG.WILD_CELL_MIN + rng.nextInt(span);
    const groupId = s.nextWildGroupId++;
    const code = wildOwnerCode(groupId);
    for (let i = 0; i < size; i++) spawnPerson(s, cell, code, 0);
  }

  s.rngState = rng.getState();
  refreshDerived(s);
  logEvent(s, 'epoch', 'Epoch \u2014 your market is founded');
  return s;
}

// ---- serialization ----
export interface SerializedMarket extends Omit<Market, 'cells'> {
  cells: number[];
}
export interface SerializedState {
  seed: number;
  width: number;
  height: number;
  year: number;
  finalTechYear: number;
  log: YearLog[];
  events: GameEvent[];
  encounteredMarkets: number[];
  foodYield: string;
  rawYield: string;
  rawStock: string;
  marketId: string;
  discovered: string;
  personCell: string;
  personOwner: string;
  personPropensity: string;
  personCapacity: number;
  markets: SerializedMarket[];
  nextWildGroupId: number;
  rngState: RngState;
}

export function serialize(s: WorldState): SerializedState {
  return {
    seed: s.seed,
    width: s.width,
    height: s.height,
    year: s.year,
    finalTechYear: s.finalTechYear,
    log: s.log,
    events: s.events,
    // sorted for a stable serialization regardless of insertion order (round-trip determinism)
    encounteredMarkets: [...s.encounteredMarkets].sort((a, b) => a - b),
    foodYield: encodeF32(s.foodYield),
    rawYield: encodeF32(s.rawYield),
    rawStock: encodeF32(s.rawStock),
    marketId: encodeI32(s.marketId),
    discovered: encodeU8(s.discovered),
    personCell: encodeI32(s.personCell),
    personOwner: encodeI32(s.personOwner),
    personPropensity: encodeF32(s.personPropensity),
    personCapacity: s.personCapacity,
    markets: s.markets.map((m) => ({ ...m, cells: [...m.cells] })),
    nextWildGroupId: s.nextWildGroupId,
    rngState: s.rngState,
  };
}

export function deserialize(p: SerializedState): WorldState {
  const n = p.width * p.height;
  const personCell = decodeI32(p.personCell);
  const cap = p.personCapacity;
  const s: WorldState = {
    seed: p.seed,
    width: p.width,
    height: p.height,
    year: p.year,
    finalTechYear: p.finalTechYear,
    log: p.log ?? [],
    events: p.events ?? [],
    encounteredMarkets: new Set<number>(p.encounteredMarkets ?? []),
    foodYield: decodeF32(p.foodYield),
    rawYield: decodeF32(p.rawYield),
    rawStock: decodeF32(p.rawStock),
    marketId: decodeI32(p.marketId),
    discovered: decodeU8(p.discovered),
    cellHead: new Int32Array(n).fill(-1),
    cellPopulation: new Int32Array(n),
    personCell,
    personOwner: decodeI32(p.personOwner),
    personPropensity: decodeF32(p.personPropensity),
    personNext: new Int32Array(cap).fill(-1),
    personPrev: new Int32Array(cap).fill(-1),
    personCapacity: cap,
    personFreeList: [],
    liveCount: 0,
    markets: p.markets.map((m) => ({
      ...m,
      diedThisTurn: m.diedThisTurn ?? 0,
      foodDeathsThisTurn: m.foodDeathsThisTurn ?? 0,
      goodsDeathsThisTurn: m.goodsDeathsThisTurn ?? 0,
      foodNeededThisTurn: m.foodNeededThisTurn ?? 0,
      foodProducedThisTurn: m.foodProducedThisTurn ?? 0,
      goodsNeededThisTurn: m.goodsNeededThisTurn ?? 0,
      goodsAvailableThisTurn: m.goodsAvailableThisTurn ?? 0,
      foodDeathsTotal: m.foodDeathsTotal ?? 0,
      goodsDeathsTotal: m.goodsDeathsTotal ?? 0,
      rawMinedThisYear: m.rawMinedThisYear ?? 0,
      techInvestedThisYear: m.techInvestedThisYear ?? 0,
      rawReserves: m.rawReserves ?? 0,
      pendingBurst: m.pendingBurst ?? false,
      pendingBurstCost: m.pendingBurstCost ?? 0,
      pendingBurstTech: m.pendingBurstTech ?? 0,
      rawToReserveThisCycle: m.rawToReserveThisCycle ?? 0,
      cells: new Set<number>(m.cells),
    })),
    nextWildGroupId: p.nextWildGroupId,
    rngState: p.rngState,
  };
  // rebuild linked lists + free list + counts from personCell truth
  for (let i = cap - 1; i >= 0; i--) {
    if (personCell[i] === -1) {
      s.personFreeList.push(i);
      continue;
    }
    const cell = personCell[i];
    const head = s.cellHead[cell];
    s.personNext[i] = head;
    s.personPrev[i] = -1;
    if (head !== -1) s.personPrev[head] = i;
    s.cellHead[cell] = i;
    s.cellPopulation[cell]++;
    s.liveCount++;
  }
  refreshDerived(s);
  return s;
}
