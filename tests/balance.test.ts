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
  const s = createWorld(SEED, SIZE, SIZE, { wildCellDensity: 0.05, aiMarkets: 4 });
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
      rawToReserveFrac: CONFIG.RAW_RESERVE_DEFAULT,
      forcedIntervention: false,
    });
    // Aggressive research: grow via natural crowding-driven expansion (don't over-scatter with
    // forced intervention), keep enough food labor to sustain population, and pour nearly all
    // mined raw into research instead of market goods.
    const aggressive = runScenario({
      laborToFoodFrac: 0.5,
      rawToMarketFrac: 0.0,
      rawToTechFrac: 0.95,
      rawToReserveFrac: 0.05,
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

  it('default policy does NOT mass-die early; deaths split by cause are reported', () => {
    // Exactly the in-game default policy (config defaults).
    const policy: Policy = {
      laborToFoodFrac: CONFIG.LABOR_TO_FOOD_DEFAULT,
      rawToMarketFrac: CONFIG.RAW_TO_MARKET_DEFAULT,
      rawToTechFrac: CONFIG.RAW_TO_TECH_DEFAULT,
      rawToReserveFrac: CONFIG.RAW_RESERVE_DEFAULT,
      forcedIntervention: false,
    };
    const s = createWorld(424242, 60, 60, { wildCellDensity: 0.05, aiMarkets: 4 });
    const rng = makeRng(424242);
    s.markets[0].policy = { ...policy };

    let minPop = Infinity;
    let popAt60 = 0;
    let worstGoodsYear = 0;
    const sample: string[] = [];
    let prevFoodD = 0;
    let prevGoodsD = 0;

    for (let y = 0; y < 100; y++) {
      tick(s, rng);
      const p = s.markets[0];
      const foodD = p.foodDeathsTotal - prevFoodD;
      const goodsD = p.goodsDeathsTotal - prevGoodsD;
      prevFoodD = p.foodDeathsTotal;
      prevGoodsD = p.goodsDeathsTotal;
      worstGoodsYear = Math.max(worstGoodsYear, goodsD);
      minPop = Math.min(minPop, p.population);
      if (y + 1 === 60) popAt60 = p.population;
      if (y < 8 || (y + 1) % 20 === 0) {
        sample.push(
          `y${y + 1}: pop=${p.population} food ${p.foodThisYear.toFixed(0)}/${p.population} ` +
            `goods need=${(p.population * p.desireToConsume).toFixed(1)} cap=${p.capitalWealth.toFixed(
              1,
            )} dF=${foodD} dG=${goodsD}`,
        );
      }
    }
    const p = s.markets[0];

    /* eslint-disable no-console */
    console.log('--- DIE-OFF DIAGNOSIS (default policy) ---');
    console.log(
      `GOODS_DEATH_MAX_FRAC=${CONFIG.GOODS_DEATH_MAX_FRAC} DESIRE_SUPPLY_FRAC=${CONFIG.DESIRE_SUPPLY_FRAC} ` +
        `DESIRE_GROWTH_K=${CONFIG.DESIRE_GROWTH_K}`,
    );
    console.log(sample.join('\n'));
    console.log(
      `minPop(0..100)=${minPop} popAt60=${popAt60} finalPop=${p.population} ` +
        `foodDeaths=${p.foodDeathsTotal} goodsDeaths=${p.goodsDeathsTotal} worstGoodsYear=${worstGoodsYear}`,
    );
    console.log('------------------------------------------');
    /* eslint-enable no-console */

    // Regression: no unexplained near-total early wipe under default policy.
    expect(popAt60).toBeGreaterThan(CONFIG.PLAYER_START_POP);
    expect(minPop).toBeGreaterThanOrEqual(CONFIG.PLAYER_SAFE_FLOOR - 1);
    // Goods-death is the gentle/secondary cause: never the mass killer under default play.
    expect(p.goodsDeathsTotal).toBeLessThan(p.population);
  });
});
