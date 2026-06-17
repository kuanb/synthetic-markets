// The spine: one tick() resolves exactly one year in the fixed §5.3 order.
// tickBatch() loops up to N years, stopping early on a §6 end condition.

import type { RNG } from '../world/rng';
import { type Market, type WorldState, refreshDerived } from '../world/state';
import { RNG_SALT } from '../config';
import {
  produce,
  allocateRaw,
  accrueGoods,
  foodDeaths,
  goodsConsumptionAndDeaths,
  updateDesire,
} from './economy';
import { births, moveIntents, updatePropensity } from './agents';
import { resolveMove } from './conflict';
import { runAiPolicy } from './ai';
import { researchCost, maxTechLevel } from './tech';

export type EndState = { over: false } | { over: true; outcome: 'win' | 'loss' };

function resetAccumulators(m: Market): void {
  m.goodsProducedThisCycle = 0;
  m.goodsConsumedThisCycle = 0;
  m.rawToMarketThisCycle = 0;
  m.rawLeftUnminedThisCycle = 0;
  m.bornThisYear = 0;
  m.diedThisYear = 0;
  m.foodThisYear = 0;
}

function techUnlock(s: WorldState, m: Market): void {
  const max = maxTechLevel();
  if (m.techLevel >= max) return;
  if (m.techProgress >= researchCost(m.techLevel + 1)) {
    m.techProgress -= researchCost(m.techLevel + 1);
    m.techLevel++;
    if (m.isPlayer && m.techLevel >= max && s.finalTechYear < 0) {
      s.finalTechYear = s.year;
    }
  }
}

export function tick(state: WorldState, rng: RNG): void {
  const y = state.year * 1_000_003;
  const rngAi = rng.fork(RNG_SALT.AI + y);
  const rngBirth = rng.fork(RNG_SALT.BIRTHS + y);
  const rngFood = rng.fork(RNG_SALT.FOOD_DEATHS + y);
  const rngGoods = rng.fork(RNG_SALT.GOODS_DEATHS + y);
  const rngMove = rng.fork(RNG_SALT.MOVEMENT + y);
  const rngConflict = rng.fork(RNG_SALT.CONFLICT + y);

  // Step 0: prep
  refreshDerived(state);
  for (const m of state.markets) {
    resetAccumulators(m);
    runAiPolicy(state, m, rngAi);
  }

  const deficitCells = new Set<number>();

  // Steps 1-8 per market, fixed order.
  for (const m of state.markets) techUnlock(state, m); // 1
  for (const m of state.markets) births(state, m, rngBirth); // 2
  for (const m of state.markets) {
    const { food, rawMined } = produce(state, m, deficitCells); // 3
    allocateRaw(m, rawMined); // 4
    accrueGoods(m); // 5
    foodDeaths(state, m, food, rngFood); // 6
    goodsConsumptionAndDeaths(state, m, rngGoods); // 7
    updateDesire(m); // 8
  }

  // Step 9: movement (+ inline conflict, step 11).
  const intents = moveIntents(state, rngMove);
  for (const intent of intents) resolveMove(state, intent, rngConflict);

  // Step 10: propensity.
  updatePropensity(state, deficitCells);

  // Step 12: log player aggregate.
  const player = state.markets[0];
  state.log.push({
    year: state.year,
    born: player.bornThisYear,
    died: player.diedThisYear,
    food: player.foodThisYear,
    goods: player.goodsProducedThisCycle,
    capitalWealth: player.capitalWealth,
    population: player.population,
  });

  state.year++;
  state.rngState = rng.getState();
}

function endState(state: WorldState): EndState {
  const player = state.markets[0];
  if (player.population <= 0 || player.cells.size === 0) {
    return { over: true, outcome: 'loss' };
  }
  // win: final tech unlocked + at least one full additional cycle resolved
  if (state.finalTechYear >= 0 && state.year >= state.finalTechYear + 2) {
    return { over: true, outcome: 'win' };
  }
  return { over: false };
}

export function tickBatch(state: WorldState, rng: RNG, years: number): EndState {
  for (let i = 0; i < years; i++) {
    tick(state, rng);
    const end = endState(state);
    if (end.over) return end;
  }
  return { over: false };
}
