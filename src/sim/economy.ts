// Production, raw allocation, goods accrual, automatic consumption, deaths.
// All deaths delete discrete Person records chosen uniformly at random.

import type { RNG } from '../world/rng';
import {
  type Market,
  type WorldState,
  cellLabor,
  killPerson,
} from '../world/state';
import { CONFIG } from '../config';
import { ext, foodExt } from './tech';

// Collect live person indices owned by a market (by id).
function marketPersons(s: WorldState, marketId: number): number[] {
  const out: number[] = [];
  for (let p = 0; p < s.personCapacity; p++) {
    if (s.personCell[p] !== -1 && s.personOwner[p] === marketId) out.push(p);
  }
  return out;
}

// Early-game safety net: during the opening window the player cannot be driven below the floor.
// AI markets and wild persons are never protected. Eventual collapse remains possible afterwards.
function cappedKill(s: WorldState, m: Market, desired: number): number {
  if (m.isPlayer && s.year < CONFIG.PLAYER_SAFE_YEARS) {
    return Math.max(0, Math.min(desired, m.population - CONFIG.PLAYER_SAFE_FLOOR));
  }
  return desired;
}

// Kill `count` distinct random persons from `pool` (partial Fisher-Yates). Returns killed.
function killRandom(s: WorldState, pool: number[], count: number, rng: RNG): number {
  const k = Math.max(0, Math.min(count, pool.length));
  for (let i = 0; i < k; i++) {
    const j = i + rng.nextInt(pool.length - i);
    const tmp = pool[i];
    pool[i] = pool[j];
    pool[j] = tmp;
    killPerson(s, pool[i]);
  }
  return k;
}

// Steps 3+4: production + raw disposition across all owned cells of a market.
// Labor split (food vs mining) sets the MINING CAPACITY per cell; the three-way raw policy sets
// the TARGET disposition of each cell's minable raw (market / tech / leave-unmined). The amount
// actually mined is min(capacity, market+tech target); any shortfall (and the deliberate unmined
// share) banks in rawStock. Mined raw is split market:tech by their ratio. Research raw is
// excluded from orientation. Records local food deficits into `deficitCells` (for step 10).
export function produce(s: WorldState, m: Market, deficitCells: Set<number>): number {
  let totalFood = 0;
  const fe = foodExt(m.techLevel); // land-limited food factor (NOT ext)
  const mineTargetFrac = m.policy.rawToMarketFrac + m.policy.rawToTechFrac; // = 1 - unminedFrac
  const denom = mineTargetFrac;
  const marketShare = denom > 0 ? m.policy.rawToMarketFrac / denom : 0;
  for (const cell of m.cells) {
    const labor = cellLabor(s, cell, m.id);
    if (labor <= 0) continue;
    const laborToFood = labor * m.policy.laborToFoodFrac;
    const laborToRaw = labor - laborToFood; // mining capacity this cycle
    const food = Math.min(laborToFood, s.foodYield[cell]) * fe;

    const minable = s.rawYield[cell] + s.rawStock[cell];
    const desiredMined = minable * mineTargetFrac; // raw we WANT to extract (rest left in ground)
    const mined = Math.min(laborToRaw, desiredMined); // capped by mining labor
    const unmined = minable - mined;
    s.rawStock[cell] = unmined;

    const toMarket = mined * marketShare;
    const toTech = mined - toMarket;
    m.rawToMarketThisCycle += toMarket;
    m.techProgress += toTech;
    m.rawLeftUnminedThisCycle += unmined;

    totalFood += food;
    if (food < s.cellPopulation[cell]) deficitCells.add(cell);
  }
  m.foodThisYear = totalFood;
  return totalFood;
}

// Step 5: all market-allocated raw becomes goods (tech-scaled) and enters the capital pool.
export function accrueGoods(m: Market): void {
  m.goodsProducedThisCycle = m.rawToMarketThisCycle * ext(m.techLevel);
  m.capitalWealth += m.goodsProducedThisCycle;
}

// Step 6: starvation. population must end <= floor(food available).
export function foodDeaths(s: WorldState, m: Market, food: number, rng: RNG): void {
  const pop = m.population;
  const target = Math.floor(food);
  const need = cappedKill(s, m, pop - target);
  if (need <= 0) return;
  const killed = killRandom(s, marketPersons(s, m.id), need, rng);
  m.diedThisYear += killed;
  m.population -= killed;
}

// Step 7: auto-consume goods from the capital pool; kill on shortfall.
export function goodsConsumptionAndDeaths(s: WorldState, m: Market, rng: RNG): void {
  const pop = m.population;
  if (pop <= 0) {
    m.goodsConsumedThisCycle = 0;
    return;
  }
  const need = pop * m.desireToConsume;
  const draw = Math.min(need, m.capitalWealth);
  m.capitalWealth -= draw;
  m.goodsConsumedThisCycle = draw;
  if (need > 0 && draw < need) {
    const shortfallFrac = (need - draw) / need;
    const killCount = cappedKill(s, m, Math.round(pop * shortfallFrac));
    const killed = killRandom(s, marketPersons(s, m.id), killCount, rng);
    m.diedThisYear += killed;
    m.population -= killed;
  }
}

// §5.7 Burst Spend: progressive cost in goods from capitalWealth, bumps every member's
// propensity to move. Returns true if it fired. Used by the player (worker) and the AI.
export function burstSpend(s: WorldState, m: Market): boolean {
  const cost = Math.ceil(m.cells.size / 2);
  if (m.capitalWealth < cost) return false;
  m.capitalWealth -= cost;
  for (let p = 0; p < s.personCapacity; p++) {
    if (s.personCell[p] !== -1 && s.personOwner[p] === m.id) {
      s.personPropensity[p] = Math.min(1, s.personPropensity[p] + CONFIG.BURST_BUMP);
    }
  }
  return true;
}

// Step 8: desire grows with per-capita wealth, capped.
export function updateDesire(m: Market): void {
  const pop = Math.max(1, m.population);
  m.desireToConsume = Math.min(
    CONFIG.DESIRE_CAP,
    m.desireToConsume + CONFIG.DESIRE_GROWTH_K * (m.capitalWealth / pop),
  );
}
