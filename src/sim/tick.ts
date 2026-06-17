// The spine: one tick() resolves exactly one year in the fixed §5.3 order.
// tickBatch() loops up to N years, stopping early on a §6 end condition.

import type { RNG } from '../world/rng';
import { type Market, type WorldState, revealPlayerVision } from '../world/state';
import { RNG_SALT } from '../config';
import {
  produce,
  accrueGoods,
  foodDeaths,
  goodsConsumptionAndDeaths,
  updateDesire,
} from './economy';
import { births, moveIntents, updatePropensity } from './agents';
import { resolveMove } from './conflict';
import { runAiPolicy } from './ai';
import { fireBurst } from './burst';
import { researchCost, maxTechLevel } from './tech';
import { CONFIG } from '../config';

export type EndState = { over: false } | { over: true; outcome: 'win' | 'loss' };

function resetAccumulators(m: Market): void {
  m.goodsProducedThisCycle = 0;
  m.goodsConsumedThisCycle = 0;
  m.rawToMarketThisCycle = 0;
  m.rawToReserveThisCycle = 0;
  m.bornThisYear = 0;
  m.diedThisYear = 0;
  m.foodThisYear = 0;
  m.rawMinedThisYear = 0;
  m.techInvestedThisYear = 0;
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
  const rngBurst = rng.fork(RNG_SALT.BURST + y);

  // Step 0: prep. Market populations are maintained EXACTLY and incrementally (births ++, deaths
  // -=, setPersonOwner ±), so we no longer recompute them with a full O(capacity) pool scan every
  // tick. createWorld/deserialize seed the caches via refreshDerived; the invariant tests guard
  // against drift.
  for (const m of state.markets) {
    resetAccumulators(m);
    runAiPolicy(state, m, rngAi);
  }

  const deficitCells = new Set<number>();

  // Steps 1-8, fixed order.
  const playerLvlBefore = state.markets[0].techLevel;
  for (const m of state.markets) techUnlock(state, m); // 1
  const playerUnlocked = state.markets[0].techLevel > playerLvlBefore;
  births(state, rngBirth); // 2 (single global pass)
  for (const m of state.markets) {
    const food = produce(state, m, deficitCells); // 3 + 4 (production + three-way raw disposition)
    accrueGoods(m); // 5
    foodDeaths(state, m, food, rngFood); // 6
    goodsConsumptionAndDeaths(state, m, rngGoods); // 7
    updateDesire(m); // 8
  }

  // Step 9: movement (+ inline conflict, step 11).
  const intents = moveIntents(state, rngMove);
  for (const intent of intents) resolveMove(state, intent, rngConflict);

  // Forced Intervention — Market Expansion: on a NEW player tech (toggle ON) queue a territory
  // burst whose cost is fixed at BURST_RAW_COST_MULT * this cycle's total raw mined. Keep at most
  // one pending burst. Fire it (deduct reserves) as soon as reserves cover the stored cost.
  const player = state.markets[0];
  if (player.isPlayer) {
    if (playerUnlocked && player.policy.forcedIntervention && !player.pendingBurst) {
      player.pendingBurst = true;
      player.pendingBurstCost = CONFIG.BURST_RAW_COST_MULT * player.rawMinedThisYear;
    }
    if (player.pendingBurst && player.rawReserves >= player.pendingBurstCost) {
      if (fireBurst(state, player, rngBurst)) {
        player.rawReserves -= player.pendingBurstCost;
        player.pendingBurst = false;
        player.pendingBurstCost = 0;
      }
      // else: no reachable territory this cycle -> stays pending, reserves untouched
    }
  }

  // Player vision: reveal neighbors of owned cells so adjacent markets become visible.
  revealPlayerVision(state);

  // Step 10: propensity.
  updatePropensity(state, deficitCells);

  // Step 12: log player aggregate.
  state.log.push({
    year: state.year,
    born: player.bornThisYear,
    died: player.diedThisYear,
    food: player.foodThisYear,
    goods: player.goodsProducedThisCycle,
    rawMined: player.rawMinedThisYear,
    techInvested: player.techInvestedThisYear,
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
  // Reset per-turn accumulators at the start of the batch. The economy increments them as each
  // year resolves, so they end up as totals across the batched years (a fresh world starts at 0,
  // which is why a manual 1-year loop reproduces a single tickBatch exactly — see tests).
  for (const m of state.markets) {
    m.diedThisTurn = 0;
    m.foodDeathsThisTurn = 0;
    m.goodsDeathsThisTurn = 0;
    m.foodNeededThisTurn = 0;
    m.foodProducedThisTurn = 0;
    m.goodsNeededThisTurn = 0;
    m.goodsAvailableThisTurn = 0;
  }
  for (let i = 0; i < years; i++) {
    tick(state, rng);
    const end = endState(state);
    if (end.over) return end;
  }
  return { over: false };
}
