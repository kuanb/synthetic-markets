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
import { createWorld, orientation, aiMarketCount, type Policy } from '../src/world/state';
import { tick, tickBatch } from '../src/sim/tick';
import { buildSnapshot } from '../src/render/snapshot';
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
      famineTolerance: CONFIG.FAMINE_TOLERANCE_DEFAULT,
      marketStimulus: false,
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
      famineTolerance: CONFIG.FAMINE_TOLERANCE_DEFAULT,
      marketStimulus: false,
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

  it('default policy does NOT mass-die early across a seed panel; deaths split by cause are reported', () => {
    // Exactly the in-game default policy (config defaults).
    const policy: Policy = {
      laborToFoodFrac: CONFIG.LABOR_TO_FOOD_DEFAULT,
      rawToMarketFrac: CONFIG.RAW_TO_MARKET_DEFAULT,
      rawToTechFrac: CONFIG.RAW_TO_TECH_DEFAULT,
      rawToReserveFrac: CONFIG.RAW_RESERVE_DEFAULT,
      forcedIntervention: false,
      famineTolerance: CONFIG.FAMINE_TOLERANCE_DEFAULT,
      marketStimulus: false,
    };

    // The yearly economy is deterministic but CHAOTIC: at a single seed a tiny change in the
    // default allocation can drop the player into a death basin (e.g. neighbouring food fractions
    // alternate between explosive growth and total collapse on the same map). A one-seed assert is
    // therefore brittle and overfits to whichever basin that seed happens to land in. Instead,
    // evaluate the in-game default policy across a fixed PANEL of seeds and require that the
    // population survives the opening in the MAJORITY of them. This still catches a real "the
    // default mass-dies everywhere" regression without depending on one lucky seed.
    const SEEDS = [424242, 13579, 1, 2, 7, 99, 12345, 555, 31337, 8675309];

    let survivors = 0;
    let foodDeathsAll = 0;
    let goodsDeathsAll = 0;
    const rows: string[] = [];

    for (const seed of SEEDS) {
      const s = createWorld(seed, 60, 60, { wildCellDensity: 0.05, aiMarkets: 4 });
      const rng = makeRng(seed);
      s.markets[0].policy = { ...policy };

      let minPop = Infinity;
      let popAt60 = 0;
      for (let y = 0; y < 100; y++) {
        tick(s, rng);
        const p = s.markets[0];
        minPop = Math.min(minPop, p.population);
        if (y + 1 === 60) popAt60 = p.population;
      }
      const p = s.markets[0];
      // "Survived the opening" = at least held the starting population at year 60 (didn't mass-die).
      if (popAt60 >= CONFIG.PLAYER_START_POP) survivors++;
      foodDeathsAll += p.foodDeathsTotal;
      goodsDeathsAll += p.goodsDeathsTotal;
      rows.push(
        `seed=${seed} popAt60=${popAt60} minPop=${minPop} finalPop=${p.population} ` +
          `foodDeaths=${p.foodDeathsTotal} goodsDeaths=${p.goodsDeathsTotal}`,
      );
    }

    /* eslint-disable no-console */
    console.log('--- DIE-OFF DIAGNOSIS (default policy, seed panel) ---');
    console.log(
      `LABOR_TO_FOOD_DEFAULT=${CONFIG.LABOR_TO_FOOD_DEFAULT} ` +
        `GOODS_DEATH_MAX_FRAC=${CONFIG.GOODS_DEATH_MAX_FRAC} DESIRE_SUPPLY_FRAC=${CONFIG.DESIRE_SUPPLY_FRAC} ` +
        `DESIRE_GROWTH_K=${CONFIG.DESIRE_GROWTH_K}`,
    );
    console.log(rows.join('\n'));
    console.log(
      `survivors=${survivors}/${SEEDS.length} foodDeathsAll=${foodDeathsAll} goodsDeathsAll=${goodsDeathsAll}`,
    );
    console.log('------------------------------------------------------');
    /* eslint-enable no-console */

    // Regression: the default policy is not a death sentence — the player survives the opening in
    // the MAJORITY of seeds (a real "mass-dies everywhere" regression would fail this).
    expect(survivors * 2).toBeGreaterThan(SEEDS.length);
    // Goods-death is the gentle/secondary cause: never the dominant killer under default play.
    expect(goodsDeathsAll).toBeLessThan(foodDeathsAll);
  });
});

describe('density + performance smoke', () => {
  // Reports world-gen / per-turn / snapshot latency and the startup market count at the SHIPPING
  // defaults on a full 300x300 map (CONFIG.WIDTH/HEIGHT). After dropping the per-tick full-pool
  // population scan and the per-market full-pool burst scan, the hot path is ~linear in
  // (markets + live persons), which is what makes this density viable. Timings are machine- and
  // load-dependent, so they are REPORTED, not asserted; correctness (market count, person
  // integrity) IS asserted, and a deliberately generous wall-clock tripwire guards against a
  // catastrophic O(markets*pool) regression creeping back in.
  it('300x300 default world: gen/turn/snapshot latency + startup market count (reported)', () => {
    const W = CONFIG.WIDTH;
    const H = CONFIG.HEIGHT;
    const SEED = 12345;

    const tGen = performance.now();
    const s = createWorld(SEED, W, H); // DEFAULT gen: derived market count + config wild density
    const genMs = performance.now() - tGen;

    const startMarkets = s.markets.length;
    const startLive = s.liveCount;
    const expectedMarkets = 1 + aiMarketCount(W, H);

    // Snapshot (built once per turn by the worker; never per simulated year).
    const tSnap = performance.now();
    buildSnapshot(s);
    const snapMs = performance.now() - tSnap;

    // Worst-case per-turn cost: a raw 250-year run that does NOT early-stop on a player loss, so
    // the timing reflects a fully-populated batch rather than a short game. Use a throwaway world
    // so the reported batched-turn latencies below start from gen.
    const sw = createWorld(SEED, W, H);
    const rw = makeRng(SEED);
    const tRaw = performance.now();
    for (let y = 0; y < 250; y++) tick(sw, rw);
    const raw250Ms = performance.now() - tRaw;

    // Realistic batched turns (with tickBatch's early game-over stop) on the primary world.
    const rng = makeRng(SEED);
    const turn = (years: number): number => {
      const t = performance.now();
      tickBatch(s, rng, years);
      return performance.now() - t;
    };
    const t10 = turn(10);
    const t50 = turn(50);
    const t250 = turn(250);

    // Person integrity after the run: per-cell counts still sum to the live pool count.
    let liveByCell = 0;
    for (let i = 0; i < s.cellPopulation.length; i++) liveByCell += s.cellPopulation[i];

    /* eslint-disable no-console */
    console.log('--- DENSITY + PERFORMANCE SMOKE (300x300 default) ---');
    console.log(
      `CELLS_PER_MARKET=${CONFIG.CELLS_PER_MARKET} WILD_CELL_DENSITY=${CONFIG.WILD_CELL_DENSITY} ` +
        `MAX_PERSONS=${CONFIG.MAX_PERSONS}`,
    );
    console.log(
      `startMarkets=${startMarkets} (expected ${expectedMarkets}) startLive=${startLive} ` +
        `gen=${genMs.toFixed(0)}ms snapshot=${snapMs.toFixed(1)}ms`,
    );
    console.log(
      `WORST raw 250y=${raw250Ms.toFixed(0)}ms (per-year ${(raw250Ms / 250).toFixed(2)}ms)`,
    );
    console.log(
      `batched turns (early-stop): 10y=${t10.toFixed(0)}ms 50y=${t50.toFixed(0)}ms 250y=${t250.toFixed(0)}ms`,
    );
    console.log('-----------------------------------------------------');
    /* eslint-enable no-console */

    let liveByCellW = 0;
    for (let i = 0; i < sw.cellPopulation.length; i++) liveByCellW += sw.cellPopulation[i];

    // Correctness asserts (machine-independent):
    expect(startMarkets).toBe(expectedMarkets); // density knob wired through to gen
    expect(liveByCell).toBe(s.liveCount); // person-pool integrity on the batched-turn world
    expect(liveByCellW).toBe(sw.liveCount); // ...and on the raw worst-case world
    // Generous regression tripwire (NOT a tight perf assert): a reintroduced O(markets*pool) scan
    // would blow this out by 10-100x. 30s leaves huge headroom for slow/loaded CI machines.
    expect(raw250Ms).toBeLessThan(30_000);
  }, 60_000);
});

describe('famine tolerance', () => {
  // A market-oriented player (orientation 0.94) sends its people chasing raw, abandoning fertile
  // cells; the pooled larder collapses and the market starves. Subsistence (famineTolerance=0)
  // anchors people to the cells that feed them, so it should starve LESS than Prospecting
  // (famineTolerance=1). The single-cycle economy is chaotic, so a single seed can flip; assert on
  // the SUM across a seed panel (the robust, intent-preserving comparison).
  it('Subsistence (t=0) causes fewer food deaths than Prospecting (t=1) when market-oriented', () => {
    const SEEDS = [12345, 99, 8675309, 31337, 7, 2024, 777];
    const YRS = 150;
    const policyAt = (t: number): Policy => ({
      laborToFoodFrac: 0.5,
      rawToMarketFrac: 0.85, // orientation 0.85/0.9 = 0.94 -> people chase raw, not food
      rawToTechFrac: 0.1,
      rawToReserveFrac: 0.05,
      forcedIntervention: false,
      famineTolerance: t,
      marketStimulus: false,
    });
    const foodDeaths = (seed: number, t: number): number => {
      const s = createWorld(seed, 60, 60, { wildCellDensity: 0.05, aiMarkets: 4 });
      s.markets[0].policy = policyAt(t);
      const rng = makeRng(seed);
      for (let y = 0; y < YRS; y++) {
        tick(s, rng);
        const p = s.markets[0];
        // Isolate the famine MOVEMENT-damping mechanic from the (separately tested) Social Stability
        // labor coupling: pin the player at full labor/coverage so the only difference between t=0 and
        // t=1 is anchoring, not stability-driven food output. (Stability has its own unit tests.)
        p.laborEfficiency = 1;
        p.marketCoverage = 1;
        if (p.population <= 0 || p.cells.size === 0) break;
      }
      return s.markets[0].foodDeathsTotal;
    };

    let sum0 = 0;
    let sum1 = 0;
    const rows: string[] = [];
    for (const seed of SEEDS) {
      const d0 = foodDeaths(seed, 0);
      const d1 = foodDeaths(seed, 1);
      sum0 += d0;
      sum1 += d1;
      rows.push(`seed=${seed} subsistence=${d0} prospecting=${d1}`);
    }

    /* eslint-disable no-console */
    console.log('--- FAMINE TOLERANCE SMOKE (market-oriented player, 60x60, 150y) ---');
    console.log(rows.join('\n'));
    console.log(`SUM food deaths: subsistence(t=0)=${sum0}  prospecting(t=1)=${sum1}`);
    console.log('-------------------------------------------------------------------');
    /* eslint-enable no-console */

    expect(sum0).toBeLessThan(sum1);
  });
});
