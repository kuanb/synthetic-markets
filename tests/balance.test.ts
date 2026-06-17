// Balance SMOKE TEST: reports (does not assert) collapse/runaway tendencies for the default
// tunables, per PLAN.md §9. Surfaces signals for human tuning of TECH_MULTIPLIER,
// DESIRE_GROWTH_K, and RESEARCH_R. Always passes.

import { describe, it } from 'vitest';
import { CONFIG } from '../src/config';
import { makeRng } from '../src/world/rng';
import { createWorld } from '../src/world/state';
import { tick } from '../src/sim/tick';
import { orientation } from '../src/world/state';

describe('balance smoke (flagged, not asserted)', () => {
  it('reports player trajectory over a long run', () => {
    const s = createWorld(13579, 50, 50);
    const rng = makeRng(13579);
    // a "growth" posture: feed first, push raw to market
    s.markets[0].policy.laborToFoodFrac = 0.5;
    s.markets[0].policy.rawToResearchFrac = 0.5;

    let peak = 0;
    let goodsDeathYears = 0;
    const YEARS = 150;
    for (let y = 0; y < YEARS; y++) {
      const popBefore = s.markets[0].population;
      tick(s, rng);
      const p = s.markets[0];
      peak = Math.max(peak, p.population);
      // crude goods-death signal: died while food was sufficient
      if (p.diedThisYear > 0 && p.foodThisYear >= popBefore) goodsDeathYears++;
    }
    const p = s.markets[0];
    const collapsed = p.population === 0;
    const runaway = peak > 0 && p.population < peak * 0.1 && !collapsed;

    /* eslint-disable no-console */
    console.log('--- BALANCE SMOKE REPORT (defaults) ---');
    console.log(`TECH_MULTIPLIER=${CONFIG.TECH_MULTIPLIER} RESEARCH_R=${CONFIG.RESEARCH_R} k=${CONFIG.DESIRE_GROWTH_K}`);
    console.log(`years=${YEARS} finalYear=${s.year} techLevel=${p.techLevel}`);
    console.log(`peakPop=${peak} finalPop=${p.population} cells=${p.cells.size}`);
    console.log(`capitalWealth=${p.capitalWealth.toFixed(1)} orientation=${orientation(p).toFixed(2)}`);
    console.log(`goodsDeathYears=${goodsDeathYears} (years with deaths despite adequate food)`);
    console.log(`FLAGS: collapsed=${collapsed} post-peak-crash=${runaway}`);
    console.log('---------------------------------------');
    /* eslint-enable no-console */
  });
});
