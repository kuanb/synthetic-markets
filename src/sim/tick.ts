// The spine: one tick() resolves exactly one year in the fixed §5.3 order.
// tickBatch() loops up to N years, stopping early on a §6 end condition.

import type { RNG } from '../world/rng';
import {
  type Market,
  type WorldState,
  logEvent,
  revealPlayerVision,
  wealthConcentration,
} from '../world/state';
import { RNG_SALT } from '../config';
import { formatNumber } from '../render/format';
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
import { researchCost, maxTechLevel, techName } from './tech';
import { CONFIG } from '../config';

export type EndState = { over: false } | { over: true; outcome: 'win' | 'loss' };

function resetAccumulators(m: Market): void {
  m.goodsProducedThisCycle = 0;
  m.goodsConsumedThisCycle = 0;
  m.rawToMarketThisCycle = 0;
  m.rawToReserveThisCycle = 0;
  m.foodPotentialThisCycle = 0;
  m.rawPotentialThisCycle = 0;
  m.bornThisYear = 0;
  m.diedThisYear = 0;
  m.foodThisYear = 0;
  m.rawMinedThisYear = 0;
  m.techInvestedThisYear = 0;
}

// The top-k largest DISCOVERED + ALIVE rival markets (id + current population), for the rival-
// market chronicle events. Deterministic (population + id tiebreak; no RNG).
function topDiscoveredRivals(s: WorldState, k: number): Array<{ id: number; pop: number }> {
  const out: Array<{ id: number; pop: number }> = [];
  for (const m of s.markets) {
    if (m.id >= 1 && m.population > 0 && s.encounteredMarkets.has(m.id)) {
      out.push({ id: m.id, pop: m.population });
    }
  }
  out.sort((a, b) => b.pop - a.pop || a.id - b.id);
  return out.slice(0, k);
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
  if (playerUnlocked) {
    logEvent(state, 'tech', `Discovered ${techName(state.markets[0].techLevel)}`);
  }
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
      player.pendingBurstTech = player.techLevel; // remember what triggered it (for the event)
    }
    if (player.pendingBurst && player.rawReserves >= player.pendingBurstCost) {
      if (fireBurst(state, player, rngBurst)) {
        player.rawReserves -= player.pendingBurstCost;
        player.pendingBurst = false;
        player.pendingBurstCost = 0;
        logEvent(
          state,
          'intervention',
          `Forced Intervention \u2014 territory burst to support ${techName(player.pendingBurstTech)}`,
        );
      }
      // else: no reachable territory this cycle -> stays pending, reserves untouched
    }
  }

  // Player vision: reveal neighbors of owned cells so adjacent markets become visible. Detect
  // rival-encounter milestones crossed this year.
  const encBefore = state.encounteredMarkets.size;
  revealPlayerVision(state);
  const encAfter = state.encounteredMarkets.size;
  if (encAfter > encBefore) {
    let milestone = 0;
    for (const m of CONFIG.EVENT_ENCOUNTER_MILESTONES) {
      if (m > encBefore && m <= encAfter) milestone = m; // highest milestone crossed this year
    }
    if (milestone > 0) {
      const pol = player.policy;
      const pattern =
        `${Math.round(pol.rawToMarketFrac * 100)}/${Math.round(pol.rawToTechFrac * 100)}/` +
        `${Math.round(pol.rawToReserveFrac * 100)} mkt/tech/res`;
      logEvent(
        state,
        'encounter',
        milestone === 1
          ? `First contact \u2014 encountered a rival market (allocation ${pattern})`
          : `Encountered ${milestone} rival markets (allocation ${pattern})`,
      );
    }
  }

  // Step 10: propensity.
  updatePropensity(state, deficitCells);

  // NOTE: magnitude-over-time events (player population crash/boom, rival-market collapse/swing) are
  // detected PER TURN (the batch of years), not per year — see captureTurnStart/logTurnEvents below,
  // invoked by the worker around tickBatch. A 99% collapse spread over a 250-year turn would only
  // ever surface as many tiny per-year drops if computed here.

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
    wealthConcentration: wealthConcentration(player),
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

// ---- Per-TURN magnitude events (player crash/boom, rival collapse/swing) ----
// These compare state across an entire End-Turn batch (10/50/250 years), not per year, so a large
// collapse spread over many years surfaces as ONE event with the year span. Invoked by the worker
// around tickBatch (NOT inside tick/tickBatch), so the per-year batch-equivalence invariant — which
// compares a manual tick() loop to tickBatch() — is unaffected.
export interface TurnStartState {
  year: number;
  playerPop: number;
  rivals: Array<{ id: number; pop: number }>;
}

export function captureTurnStart(s: WorldState): TurnStartState {
  return {
    year: s.year,
    playerPop: s.markets[0].population,
    rivals: topDiscoveredRivals(s, CONFIG.OTHER_MARKETS_SHOWN),
  };
}

export function logTurnEvents(s: WorldState, start: TurnStartState): void {
  const endYear = s.year - 1; // last year resolved this turn
  if (endYear < start.year) return; // no years actually resolved
  const span = `y${start.year}\u2013y${endYear}`;

  // Player population swing across the whole turn.
  const before = start.playerPop;
  const after = s.markets[0].population;
  if (before >= CONFIG.EVENT_MIN_POP_FOR_DELTA) {
    if (after <= before * (1 - CONFIG.EVENT_DIEOFF_FRAC)) {
      const lost = before - after;
      const pct = Math.round((lost / before) * 100);
      logEvent(s, 'dieoff', `Population crash (${span}) \u2014 lost ${formatNumber(lost)} (\u2212${pct}%)`, endYear);
    } else if (after >= before * (1 + CONFIG.EVENT_BOOM_FRAC)) {
      const gained = after - before;
      const pct = Math.round((gained / before) * 100);
      logEvent(s, 'boom', `Population boom (${span}) \u2014 gained ${formatNumber(gained)} (+${pct}%)`, endYear);
    }
  }

  // The largest discovered rival markets: collapse, or a >= EVENT_MARKET_SWING_FRAC swing over the turn.
  for (const w of start.rivals) {
    const m = s.markets[w.id];
    const endPop = m ? m.population : 0;
    if (endPop <= 0) {
      logEvent(s, 'market', `Rival Market #${w.id} collapsed (${span}, was ${formatNumber(w.pop)})`, endYear);
    } else if (
      w.pop >= CONFIG.EVENT_MIN_POP_FOR_DELTA &&
      Math.abs(endPop - w.pop) / w.pop >= CONFIG.EVENT_MARKET_SWING_FRAC
    ) {
      const grew = endPop > w.pop;
      const pct = Math.round((Math.abs(endPop - w.pop) / w.pop) * 100);
      logEvent(
        s,
        'market',
        `Rival Market #${w.id} ${grew ? 'surged' : 'contracted'} ${grew ? '+' : '\u2212'}${pct}% (${span}, to ${formatNumber(endPop)})`,
        endYear,
      );
    }
  }
}
