// Forced Intervention — Market Expansion (tech-triggered territory burst from raw reserves).

import { describe, it, expect } from 'vitest';
import { makeRng } from '../src/world/rng';
import { createWorld, serialize, deserialize } from '../src/world/state';
import { tick, tickBatch } from '../src/sim/tick';
import { researchCost } from '../src/sim/tech';

const OPTS = { wildCellDensity: 0.05, aiMarkets: 4 } as const;

// Force a level-1 unlock this tick; suppress further reserve/tech growth so the test is controlled.
function armUnlock(p: ReturnType<typeof createWorld>['markets'][number]): void {
  p.policy.forcedIntervention = true;
  p.policy.rawToMarketFrac = 1;
  p.policy.rawToTechFrac = 0;
  p.policy.rawToReserveFrac = 0;
  p.techProgress = researchCost(1) + 1;
}

describe('forced-intervention burst', () => {
  it('fires on tech unlock when reserves suffice and annexes fresh territory', () => {
    const s = createWorld(11, 80, 80, OPTS);
    const p = s.markets[0];
    armUnlock(p);
    p.rawReserves = 1e9; // plenty
    const before = p.cells.size;
    tick(s, makeRng(11));
    expect(p.techLevel).toBe(1); // unlocked this cycle
    expect(p.pendingBurst).toBe(false); // fired immediately
    expect(p.cells.size).toBeGreaterThan(before); // annexed a new region
    expect(p.rawReserves).toBeLessThan(1e9); // reserves were spent
  });

  it('banks when reserves are insufficient, then fires once funded', () => {
    const s = createWorld(11, 80, 80, OPTS);
    const p = s.markets[0];
    armUnlock(p);
    p.rawReserves = 0; // cannot afford
    tick(s, makeRng(11));
    expect(p.techLevel).toBe(1);
    expect(p.pendingBurst).toBe(true); // banked
    const cost = p.pendingBurstCost;
    expect(cost).toBeGreaterThan(0);
    const cellsBanked = p.cells.size;

    // Fund it; a later cycle (no new unlock) fires the pending burst.
    p.rawReserves = cost + 100;
    tick(s, makeRng(11));
    expect(p.pendingBurst).toBe(false); // fired
    expect(p.cells.size).toBeGreaterThan(cellsBanked); // annexed
    expect(p.rawReserves).toBeLessThan(cost + 100); // spent the stored cost
  });

  it('serialize round-trip preserves rawReserves + pending burst', () => {
    const s = createWorld(11, 80, 80, OPTS);
    const p = s.markets[0];
    p.rawReserves = 12345;
    p.pendingBurst = true;
    p.pendingBurstCost = 678;
    const round = deserialize(serialize(s));
    expect(round.markets[0].rawReserves).toBe(12345);
    expect(round.markets[0].pendingBurst).toBe(true);
    expect(round.markets[0].pendingBurstCost).toBe(678);
  });

  it('is deterministic (same seed + burst -> identical state)', () => {
    const run = (): string => {
      const s = createWorld(11, 80, 80, OPTS);
      const p = s.markets[0];
      p.policy.forcedIntervention = true;
      p.rawReserves = 1e9;
      p.techProgress = researchCost(1) + 1;
      tickBatch(s, makeRng(11), 6);
      return JSON.stringify(serialize(s));
    };
    expect(run()).toBe(run());
  });

  it('no-negative reserves across a long forced-intervention run', () => {
    const s = createWorld(7, 80, 80, OPTS);
    s.markets[0].policy.forcedIntervention = true;
    const rng = makeRng(7);
    for (let i = 0; i < 120; i++) {
      tick(s, rng);
      for (const m of s.markets) {
        expect(m.rawReserves).toBeGreaterThanOrEqual(0);
        expect(m.pendingBurstCost).toBeGreaterThanOrEqual(0);
      }
    }
  });
});
