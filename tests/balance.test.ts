// Balance SMOKE TEST: validates (light asserts + printed report) the retuned economy:
//  - the player survives the opening,
//  - market growth FORCES SPATIAL EXPANSION (cells increase over time),
//  - starvation is possible when stagnating,
//  - tech is EXPENSIVE: casual allocation advances slowly (does NOT reach the final tech), while
//    an aggressive all-in-research strategy progresses much further.
// Most numbers are reported for human tuning; a few core requirements are asserted.

import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config';
import { makeRng } from '../src/world/rng';
import { createWorld, orientation, type Policy } from '../src/world/state';
import { tick } from '../src/sim/tick';
import { maxTechLevel } from '../src/sim/tech';

const SEED = 13579;
const SIZE = 60;
const YEARS = 1000;

function runScenario(policy: Policy): {
  techLevel: number;
  techCurve: number[];
  startCells: number;
  maxCells: number;
  finalCells: number;
  peakPop: number;
  finalPop: number;
  starvationYears: number;
  survivedOpening: boolean;
  capitalWealth: number;
  orientationVal: number;
} {
  const s = createWorld(SEED, SIZE, SIZE);
  const rng = makeRng(SEED);
  s.markets[0].policy = { ...policy };

  const startCells = s.markets[0].cells.size;
  let peakPop = 0;
  let maxCells = startCells;
  let starvationYears = 0;
  let survivedOpening = true;
  const techCurve: number[] = [];

  for (let y = 0; y < YEARS; y++) {
    const popBefore = s.markets[0].population;
    tick(s, rng);
    const p = s.markets[0];
    peakPop = Math.max(peakPop, p.population);
    maxCells = Math.max(maxCells, p.cells.size);
    if (p.diedThisYear > 0 && p.foodThisYear < popBefore) starvationYears++;
    if (y < CONFIG.PLAYER_SAFE_YEARS && p.population <= 0) survivedOpening = false;
    if ((y + 1) % 200 === 0) techCurve.push(p.techLevel);
  }
  const p = s.markets[0];
  return {
    techLevel: p.techLevel,
    techCurve,
    startCells,
    maxCells,
    finalCells: p.cells.size,
    peakPop,
    finalPop: p.population,
    starvationYears,
    survivedOpening,
    capitalWealth: p.capitalWealth,
    orientationVal: orientation(p),
  };
}

describe('balance smoke', () => {
  it('expansion, survival, starvation, and tech-as-a-choice', () => {
    // Casual: default-ish allocation (low tech share).
    const casual = runScenario({
      laborToFoodFrac: 0.6,
      rawToMarketFrac: CONFIG.RAW_TO_MARKET_DEFAULT,
      rawToTechFrac: CONFIG.RAW_TO_TECH_DEFAULT,
      rawUnminedFrac: CONFIG.RAW_UNMINED_DEFAULT,
      forcedIntervention: false,
    });
    // Aggressive research: grow via natural crowding-driven expansion (don't over-scatter with
    // forced intervention), keep enough food labor to sustain population, and pour nearly all
    // mined raw into research instead of market goods.
    const aggressive = runScenario({
      laborToFoodFrac: 0.5,
      rawToMarketFrac: 0.0,
      rawToTechFrac: 0.95,
      rawUnminedFrac: 0.05,
      forcedIntervention: false,
    });

    /* eslint-disable no-console */
    console.log('--- BALANCE SMOKE REPORT (retuned) ---');
    console.log(
      `RESEARCH_C0=${CONFIG.RESEARCH_C0} RESEARCH_R=${CONFIG.RESEARCH_R} ` +
        `TECH_MULTIPLIER=${CONFIG.TECH_MULTIPLIER} FOOD_TECH_MULTIPLIER=${CONFIG.FOOD_TECH_MULTIPLIER} ` +
        `maxTech=${maxTechLevel()}`,
    );
    console.log(
      `CASUAL    : tech=${casual.techLevel} curve@200yr=[${casual.techCurve.join(',')}] ` +
        `cells ${casual.startCells}->${casual.maxCells} peakPop=${casual.peakPop} ` +
        `starveYrs=${casual.starvationYears} capital=${casual.capitalWealth.toFixed(0)} ` +
        `orient=${casual.orientationVal.toFixed(2)}`,
    );
    console.log(
      `AGGRESSIVE: tech=${aggressive.techLevel} curve@200yr=[${aggressive.techCurve.join(',')}] ` +
        `cells ${aggressive.startCells}->${aggressive.maxCells} peakPop=${aggressive.peakPop} ` +
        `starveYrs=${aggressive.starvationYears} capital=${aggressive.capitalWealth.toFixed(0)}`,
    );
    console.log('--------------------------------------');
    /* eslint-enable no-console */

    // Core requirements (asserted):
    expect(casual.survivedOpening).toBe(true); // not wiped out in the opening
    expect(casual.maxCells).toBeGreaterThan(casual.startCells); // growth forced spatial expansion
    expect(casual.peakPop).toBeGreaterThan(CONFIG.PLAYER_START_POP); // population grew
    expect(casual.techLevel).toBeLessThan(maxTechLevel()); // tech is NOT automatic
    expect(aggressive.techLevel).toBeGreaterThan(casual.techLevel); // research is a real lever
  });
});
