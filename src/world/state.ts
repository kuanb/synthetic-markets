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
  laborToFoodFrac: number; // [0,1]; raw-labor frac = 1 - this
  rawToResearchFrac: number; // [0,1]; raw-to-market frac = 1 - this
}

export interface Market {
  id: number;
  techLevel: number;
  techProgress: number;
  capitalWealth: number;
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
  rawLeftUnminedThisCycle: number;
  bornThisYear: number;
  diedThisYear: number;
  foodThisYear: number;
  population: number;
}

export interface YearLog {
  year: number;
  born: number;
  died: number;
  food: number;
  goods: number;
  capitalWealth: number;
  population: number;
}

export interface WorldState {
  seed: number;
  width: number;
  height: number;
  year: number;
  finalTechYear: number; // year the player unlocked the final tech, else -1
  log: YearLog[];
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

export function orientation(m: Market): number {
  const denom = m.rawToMarketThisCycle + m.rawLeftUnminedThisCycle;
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
    cells: new Set<number>(),
    colorHue: (210 + id * 137.508) % 360,
    desireToConsume: 0,
    policy: {
      laborToFoodFrac: CONFIG.LABOR_TO_FOOD_DEFAULT,
      rawToResearchFrac: CONFIG.RAW_TO_RESEARCH_DEFAULT,
    },
    propensityToExpand,
    isPlayer,
    goodsProducedThisCycle: 0,
    goodsConsumedThisCycle: 0,
    rawToMarketThisCycle: 0,
    rawLeftUnminedThisCycle: 0,
    bornThisYear: 0,
    diedThisYear: 0,
    foodThisYear: 0,
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

function claimCell(s: WorldState, cell: number, m: Market): void {
  s.marketId[cell] = m.id;
  m.cells.add(cell);
}

export function createWorld(seed: number, width: number, height: number): WorldState {
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
  claimCell(s, playerCell, player);
  reveal(s, playerCell);
  for (let i = 0; i < CONFIG.PLAYER_START_POP; i++) spawnPerson(s, playerCell, 0, 0);

  // AI markets.
  const used = new Set<number>([playerCell]);
  for (let a = 1; a <= CONFIG.AI_MARKET_COUNT; a++) {
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

  // Wild persons in small groups.
  let remaining = CONFIG.WILD_PERSON_COUNT;
  while (remaining > 0) {
    const size = Math.min(remaining, 1 + rng.nextInt(CONFIG.WILD_GROUP_AVG_SIZE * 2 - 1));
    const cell = rng.nextInt(n);
    if (s.marketId[cell] !== -1) {
      // don't seed wild on an owned cell; retry by skipping this iteration
      continue;
    }
    const groupId = s.nextWildGroupId++;
    const code = wildOwnerCode(groupId);
    for (let i = 0; i < size; i++) spawnPerson(s, cell, code, 0);
    remaining -= size;
  }

  s.rngState = rng.getState();
  refreshDerived(s);
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
    markets: p.markets.map((m) => ({ ...m, cells: new Set<number>(m.cells) })),
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
