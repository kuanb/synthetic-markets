// Derive the render-facing snapshot from WorldState (worker-side). Main thread does no economics.

import {
  type WorldState,
  type YearLog,
  isWild,
  groupIdOf,
  orientation,
} from '../world/state';
import { ext, researchCost, maxTechLevel, techName } from '../sim/tech';

export interface MarketSummary {
  id: number;
  isPlayer: boolean;
  colorHue: number;
  techLevel: number;
  techName: string;
  nextTechName: string;
  techProgress: number;
  researchCostNext: number;
  capitalWealth: number;
  population: number;
  cells: number;
  goodsProduced: number;
  goodsConsumed: number;
  desireToConsume: number;
  bornThisYear: number;
  diedThisYear: number;
  diedThisTurn: number;
  cumulativeDead: number;
  // per-turn supply/demand + deaths by cause (totals across the most recent End Turn batch)
  foodNeededThisTurn: number;
  foodProducedThisTurn: number;
  goodsNeededThisTurn: number;
  goodsAvailableThisTurn: number;
  foodDeathsThisTurn: number;
  goodsDeathsThisTurn: number;
  foodDeathsTotal: number;
  goodsDeathsTotal: number;
  orientation: number;
  rawReserves: number; // persistent raw pool that funds the Forced-Intervention burst
  pendingBurst: boolean; // a queued burst awaiting sufficient reserves
  pendingBurstCost: number; // raw cost of the queued burst
  // current policy (so the UI can reflect a loaded save)
  laborToFoodFrac: number;
  rawToMarketFrac: number;
  rawToTechFrac: number;
  rawToReserveFrac: number;
  forcedIntervention: boolean;
}

export interface Snapshot {
  year: number;
  width: number;
  height: number;
  discovered: Uint8Array;
  marketId: Int32Array;
  cellPopulation: Int32Array;
  cellHue: Int16Array; // dominant owner hue, -1 if none
  foodDisplay: Float32Array;
  rawDisplay: Float32Array;
  // Only the PLAYER market summary is shipped (markets[0]); with thousands of AI markets, shipping
  // every summary each snapshot would be wasteful and the UI only reads the player's.
  markets: MarketSummary[];
  log: YearLog[]; // full per-year player history (for the sidebar mini-charts)
}

export function wildHue(groupId: number): number {
  return (groupId * 137.508) % 360;
}

function dominantWildHue(s: WorldState, cell: number): number {
  const counts = new Map<number, number>();
  for (let p = s.cellHead[cell]; p !== -1; p = s.personNext[p]) {
    const owner = s.personOwner[p];
    if (isWild(owner)) {
      const g = groupIdOf(owner);
      counts.set(g, (counts.get(g) ?? 0) + 1);
    }
  }
  let bestG = -1;
  let bestC = 0;
  for (const [g, c] of counts) {
    if (c > bestC) {
      bestC = c;
      bestG = g;
    }
  }
  return bestG === -1 ? -1 : wildHue(bestG);
}

export function buildSnapshot(s: WorldState): Snapshot {
  const n = s.width * s.height;
  const cellHue = new Int16Array(n).fill(-1);
  const foodDisplay = new Float32Array(n);
  const rawDisplay = new Float32Array(n);
  const techExt = s.markets.map((m) => ext(m.techLevel));

  for (let cell = 0; cell < n; cell++) {
    const mid = s.marketId[cell];
    if (mid >= 0) {
      cellHue[cell] = Math.round(s.markets[mid].colorHue);
      foodDisplay[cell] = s.foodYield[cell] * techExt[mid];
    } else {
      foodDisplay[cell] = s.foodYield[cell];
      if (s.cellPopulation[cell] > 0) cellHue[cell] = Math.round(dominantWildHue(s, cell));
    }
    rawDisplay[cell] = s.rawYield[cell] + s.rawStock[cell];
  }

  const max = maxTechLevel();
  let playerDead = 0;
  for (const l of s.log) playerDead += l.died;
  // Ship only the player market summary (the UI reads markets[0] only).
  const markets: MarketSummary[] = [s.markets[0]].map((m) => ({
    id: m.id,
    isPlayer: m.isPlayer,
    colorHue: m.colorHue,
    techLevel: m.techLevel,
    techName: techName(m.techLevel),
    nextTechName: m.techLevel < max ? techName(m.techLevel + 1) : '\u2014',
    techProgress: m.techProgress,
    researchCostNext: m.techLevel < max ? researchCost(m.techLevel + 1) : 0,
    capitalWealth: m.capitalWealth,
    population: m.population,
    cells: m.cells.size,
    goodsProduced: m.goodsProducedThisCycle,
    goodsConsumed: m.goodsConsumedThisCycle,
    desireToConsume: m.desireToConsume,
    bornThisYear: m.bornThisYear,
    diedThisYear: m.diedThisYear,
    diedThisTurn: m.diedThisTurn,
    cumulativeDead: m.isPlayer ? playerDead : 0,
    foodNeededThisTurn: m.foodNeededThisTurn,
    foodProducedThisTurn: m.foodProducedThisTurn,
    goodsNeededThisTurn: m.goodsNeededThisTurn,
    goodsAvailableThisTurn: m.goodsAvailableThisTurn,
    foodDeathsThisTurn: m.foodDeathsThisTurn,
    goodsDeathsThisTurn: m.goodsDeathsThisTurn,
    foodDeathsTotal: m.foodDeathsTotal,
    goodsDeathsTotal: m.goodsDeathsTotal,
    orientation: orientation(m),
    rawReserves: m.rawReserves,
    pendingBurst: m.pendingBurst,
    pendingBurstCost: m.pendingBurstCost,
    laborToFoodFrac: m.policy.laborToFoodFrac,
    rawToMarketFrac: m.policy.rawToMarketFrac,
    rawToTechFrac: m.policy.rawToTechFrac,
    rawToReserveFrac: m.policy.rawToReserveFrac,
    forcedIntervention: m.policy.forcedIntervention,
  }));

  return {
    year: s.year,
    width: s.width,
    height: s.height,
    discovered: s.discovered.slice(),
    marketId: s.marketId.slice(),
    cellPopulation: s.cellPopulation.slice(),
    cellHue,
    foodDisplay,
    rawDisplay,
    markets,
    log: s.log,
  };
}
