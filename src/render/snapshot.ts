// Derive the render-facing snapshot from WorldState (worker-side). Main thread does no economics.

import {
  type WorldState,
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
  cumulativeDead: number;
  orientation: number;
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
  markets: MarketSummary[];
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
  const markets: MarketSummary[] = s.markets.map((m) => ({
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
    cumulativeDead: m.isPlayer ? playerDead : 0,
    orientation: orientation(m),
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
  };
}
