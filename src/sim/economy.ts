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

// Collect live person indices owned by a market. A market's persons always live on its owned
// cells (movement claims the destination cell; conflict/absorption re-own cell + persons together),
// so we iterate m.cells instead of scanning the whole pool — O(market persons), not O(capacity).
// This keeps the per-tick cost flat as the number of markets grows into the thousands.
function marketPersons(s: WorldState, m: Market): number[] {
  const out: number[] = [];
  for (const cell of m.cells) {
    for (let p = s.cellHead[cell]; p !== -1; p = s.personNext[p]) {
      if (s.personOwner[p] === m.id) out.push(p);
    }
  }
  return out;
}

// Early-game safety net: during the opening window the player cannot be driven below a floor that
// RAMPS linearly from PLAYER_SAFE_FLOOR (year 0) down to 0 (year PLAYER_SAFE_YEARS) — so there is
// no mortality "cliff" when the window ends. AI markets and wild persons are never protected.
function cappedKill(s: WorldState, m: Market, desired: number): number {
  if (m.isPlayer && s.year < CONFIG.PLAYER_SAFE_YEARS) {
    const floor = CONFIG.PLAYER_SAFE_FLOOR * (1 - s.year / CONFIG.PLAYER_SAFE_YEARS);
    return Math.max(0, Math.floor(Math.min(desired, m.population - floor)));
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
// Labor split (food vs mining) sets the MINING CAPACITY per cell. Each cell mines
// min(miningLabor, rawYield+rawStock); any labour-limited remainder BANKS in rawStock. The mined
// raw is split by the three-way policy: market -> goods, tech -> research, reserve -> rawReserves.
// Research raw is excluded from orientation. Records local food deficits into `deficitCells`.
export function produce(s: WorldState, m: Market, deficitCells: Set<number>): number {
  let totalFood = 0;
  const fe = foodExt(m.techLevel); // land-limited food factor (NOT ext)
  const mFrac = m.policy.rawToMarketFrac;
  const tFrac = m.policy.rawToTechFrac;
  for (const cell of m.cells) {
    // Yield POTENTIAL is the full land capacity over ALL owned cells (even unworked ones), so the
    // captured/potential efficiency visibly craters when people abandon fertile cells for raw.
    // Computed before the labor skip and before rawStock is decremented below.
    m.foodPotentialThisCycle += s.foodYield[cell] * fe;
    m.rawPotentialThisCycle += s.rawYield[cell] + s.rawStock[cell];
    const labor = cellLabor(s, cell, m.id);
    if (labor <= 0) continue;
    const laborToFood = labor * m.policy.laborToFoodFrac;
    const laborToRaw = labor - laborToFood; // mining capacity this cycle
    const food = Math.min(laborToFood, s.foodYield[cell]) * fe;

    const minable = s.rawYield[cell] + s.rawStock[cell];
    const mined = Math.min(laborToRaw, minable); // capped by mining labor
    s.rawStock[cell] = minable - mined; // labour-limited remainder banks in the ground

    const toMarket = mined * mFrac;
    const toTech = mined * tFrac;
    const toReserve = mined - toMarket - toTech; // = mined * rawToReserveFrac (fracs sum to 1)
    m.rawToMarketThisCycle += toMarket;
    m.techProgress += toTech;
    m.rawReserves += toReserve;
    m.rawToReserveThisCycle += toReserve;
    m.rawMinedThisYear += mined;
    m.techInvestedThisYear += toTech;

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

// Step 6: starvation (food is the PRIMARY constraint). Population must end <= floor(food).
export function foodDeaths(s: WorldState, m: Market, food: number, rng: RNG): void {
  const pop = m.population;
  m.foodNeededThisTurn += pop; // each living person needs 1 food/cycle
  m.foodProducedThisTurn += food;
  const target = Math.floor(food);
  const need = cappedKill(s, m, pop - target);
  if (need <= 0) return;
  const killed = killRandom(s, marketPersons(s, m), need, rng);
  m.diedThisYear += killed;
  m.diedThisTurn += killed;
  m.foodDeathsThisTurn += killed;
  m.foodDeathsTotal += killed;
  m.population -= killed;
}

// Step 7: auto-consume goods from the capital pool; kill GENTLY on a sustained shortfall.
// Goods-death is bounded to GOODS_DEATH_MAX_FRAC of the population per year so a goods shortfall
// is a gradual decline (decadence), never an instant wipe. Food remains the primary killer.
export function goodsConsumptionAndDeaths(s: WorldState, m: Market, rng: RNG): void {
  const pop = m.population;
  if (pop <= 0) {
    m.goodsConsumedThisCycle = 0;
    return;
  }
  const available = m.capitalWealth; // prior capital + this cycle's goods (accrued in step 5)
  const need = pop * m.desireToConsume;
  m.goodsNeededThisTurn += need;
  m.goodsAvailableThisTurn += available;
  const draw = Math.min(need, available);
  m.capitalWealth -= draw;
  m.goodsConsumedThisCycle = draw;
  if (need > 0 && draw < need) {
    const shortfallFrac = (need - draw) / need;
    let killCount = Math.round(pop * shortfallFrac);
    killCount = Math.min(killCount, Math.floor(pop * CONFIG.GOODS_DEATH_MAX_FRAC)); // gentle cap
    killCount = cappedKill(s, m, killCount);
    const killed = killRandom(s, marketPersons(s, m), killCount, rng);
    m.diedThisYear += killed;
    m.diedThisTurn += killed;
    m.goodsDeathsThisTurn += killed;
    m.goodsDeathsTotal += killed;
    m.population -= killed;
  }
}

// §5.7 Burst Spend: progressive cost in goods from capitalWealth, bumps every member's
// propensity to move. Returns true if it fired. Used by the player (worker) and the AI.
// A market's persons always live on its owned cells, so we walk m.cells' intrusive lists
// (O(market persons)) instead of scanning the whole pool — essential with thousands of markets,
// each of which may burst-spend every tick. The set of bumped persons is identical to a full-pool
// scan filtered by owner, and the bump is order-independent, so results are byte-identical.
export function burstSpend(s: WorldState, m: Market): boolean {
  const cost = Math.ceil(m.cells.size / 2);
  if (m.capitalWealth < cost) return false;
  m.capitalWealth -= cost;
  for (const cell of m.cells) {
    for (let p = s.cellHead[cell]; p !== -1; p = s.personNext[p]) {
      if (s.personOwner[p] === m.id) {
        s.personPropensity[p] = Math.min(1, s.personPropensity[p] + CONFIG.BURST_BUMP);
      }
    }
  }
  return true;
}

// Step 8: desire eases toward a fraction of per-capita goods THROUGHPUT (flow), not accumulated
// capital (stock). Tying aspiration to what the economy actually produces stops desire from
// ratcheting up off a hoarded capital pile and then mass-starving the market. With
// DESIRE_SUPPLY_FRAC < 1 the surplus still accrues as capitalWealth (the late-game wealth
// explosion is preserved), while goods-starvation stays POSSIBLE if production later falls.
export function updateDesire(m: Market): void {
  const pop = Math.max(1, m.population);
  const aspiration = (m.goodsProducedThisCycle / pop) * CONFIG.DESIRE_SUPPLY_FRAC;
  m.desireToConsume = Math.max(
    0,
    Math.min(
      CONFIG.DESIRE_CAP,
      m.desireToConsume + CONFIG.DESIRE_GROWTH_K * (aspiration - m.desireToConsume),
    ),
  );
}
