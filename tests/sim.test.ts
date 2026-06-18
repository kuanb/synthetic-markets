import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config';
import { makeRng } from '../src/world/rng';
import {
  createWorld,
  serialize,
  deserialize,
  marketPopulation,
  aiMarketCount,
  type WorldState,
} from '../src/world/state';
import { tick, tickBatch } from '../src/sim/tick';
import { ext, researchCost, maxTechLevel } from '../src/sim/tech';
import { formatNumber, formatCell } from '../src/render/format';

const W = 60;
const H = 60;
// Sparse world-gen for economy/determinism tests: few rivals + low wild density so the player
// economy is isolated (and tests stay fast). The dense defaults are exercised separately.
const OPTS = { wildCellDensity: 0.05, aiMarkets: 4 } as const;

function hash(s: WorldState): string {
  return JSON.stringify(serialize(s));
}

function liveByCellSum(s: WorldState): number {
  let n = 0;
  for (let i = 0; i < s.cellPopulation.length; i++) n += s.cellPopulation[i];
  return n;
}

describe('rng determinism', () => {
  it('same seed -> identical sequence', () => {
    const a = makeRng(42);
    const b = makeRng(42);
    for (let i = 0; i < 1000; i++) expect(a.next()).toBe(b.next());
  });
  it('state round-trips', () => {
    const a = makeRng(7);
    for (let i = 0; i < 10; i++) a.next();
    const st = a.getState();
    const x = a.next();
    a.setState(st);
    expect(a.next()).toBe(x);
  });
});

describe('tech bounds', () => {
  it('ext(0)=1, ext(1)=1.5, ext(max) float-safe', () => {
    expect(ext(0)).toBe(1);
    expect(ext(1)).toBeCloseTo(1.5);
    expect(Number.isFinite(ext(maxTechLevel()))).toBe(true);
    expect(ext(maxTechLevel())).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });
  it('research cost strictly increasing', () => {
    for (let l = 1; l < maxTechLevel(); l++) {
      expect(researchCost(l + 1)).toBeGreaterThan(researchCost(l));
    }
  });
});

describe('number formatter', () => {
  it('K/M/B/T suffixes', () => {
    expect(formatNumber(82_000_000)).toBe('82.0M');
    expect(formatNumber(1500)).toBe('1.5K');
    expect(formatNumber(2_300_000_000)).toBe('2.3B');
    expect(formatNumber(999)).toBe('999');
    expect(formatNumber(ext(maxTechLevel()))).toMatch(/[KMBT]|e\+/);
  });
});

describe('compact cell formatter', () => {
  it('is short, lowercase, minimal fractions', () => {
    expect(formatCell(359.23)).toBe('359');
    expect(formatCell(1500)).toBe('1.5k');
    expect(formatCell(12300)).toBe('12k');
    expect(formatCell(359000)).toBe('359k');
    expect(formatCell(115_400_000)).toBe('115m');
    expect(formatCell(0.4)).toBe('.4');
    expect(formatCell(0)).toBe('0');
    expect(formatCell(7)).toBe('7');
  });
  it('never exceeds 4 glyphs for realistic in-cell magnitudes', () => {
    for (const v of [0, 0.4, 7, 42, 359.23, 999, 1500, 12300, 359000, 1.154e8, 8.7e8, 5e11]) {
      expect(formatCell(v).length).toBeLessThanOrEqual(4);
    }
  });
});

describe('world gen', () => {
  it('instantiates 10 discrete persons for the player; AI count derived from map size', () => {
    const s = createWorld(123, W, H); // defaults -> derived market count + dense wild
    expect(marketPopulation(s, 0)).toBe(CONFIG.PLAYER_START_POP);
    expect(s.markets.length).toBe(1 + aiMarketCount(W, H));
    expect(s.markets[0].isPlayer).toBe(true);
  });
  it('player starts >= margin from every edge', () => {
    const s = createWorld(123, W, H, OPTS);
    const cell = [...s.markets[0].cells][0];
    const x = cell % W;
    const y = Math.floor(cell / W);
    expect(x).toBeGreaterThanOrEqual(CONFIG.PLAYER_EDGE_MARGIN);
    expect(y).toBeGreaterThanOrEqual(CONFIG.PLAYER_EDGE_MARGIN);
    expect(x).toBeLessThan(W - CONFIG.PLAYER_EDGE_MARGIN);
    expect(y).toBeLessThan(H - CONFIG.PLAYER_EDGE_MARGIN);
  });
});

describe('invariants over a run', () => {
  it('no negative state; person integrity holds', () => {
    const s = createWorld(99, W, H, OPTS);
    const rng = makeRng(99);
    for (let i = 0; i < 60; i++) {
      tick(s, rng);
      expect(liveByCellSum(s)).toBe(s.liveCount);
      for (const m of s.markets) {
        expect(m.capitalWealth).toBeGreaterThanOrEqual(0);
        expect(m.techProgress).toBeGreaterThanOrEqual(0);
        expect(m.population).toBeGreaterThanOrEqual(0);
      }
      for (let c = 0; c < s.rawStock.length; c++) {
        expect(s.rawStock[c]).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('yield efficiency: 0 <= captured <= potential, for food and raw, every market every tick', () => {
    const s = createWorld(99, W, H, OPTS);
    const rng = makeRng(99);
    for (let i = 0; i < 60; i++) {
      tick(s, rng);
      for (const m of s.markets) {
        // captured is harvested only on worked cells; potential sums full capacity over ALL owned
        // cells, so captured can never exceed potential (tiny epsilon for float accumulation).
        expect(m.foodThisYear).toBeGreaterThanOrEqual(0);
        expect(m.foodPotentialThisCycle).toBeGreaterThanOrEqual(0);
        expect(m.foodThisYear).toBeLessThanOrEqual(m.foodPotentialThisCycle + 1e-6);
        expect(m.rawMinedThisYear).toBeGreaterThanOrEqual(0);
        expect(m.rawPotentialThisCycle).toBeGreaterThanOrEqual(0);
        expect(m.rawMinedThisYear).toBeLessThanOrEqual(m.rawPotentialThisCycle + 1e-6);
      }
    }
  });

  it('starvation index is a bounded percentage (0..100) every logged year', () => {
    const s = createWorld(99, W, H, OPTS);
    const rng = makeRng(99);
    for (let i = 0; i < 60; i++) tick(s, rng);
    for (const yl of s.log) {
      expect(yl.starvationIndex).toBeGreaterThanOrEqual(0);
      expect(yl.starvationIndex).toBeLessThanOrEqual(100 + 1e-6);
    }
  });

  it('death floor: population <= floor(food) after a starving cycle (past safe window)', () => {
    const s = createWorld(5, W, H, OPTS);
    // advance past the early-game player safety window so full mortality applies
    s.year = CONFIG.PLAYER_SAFE_YEARS + 5;
    // force everyone to mine (no food) to trigger starvation
    s.markets[0].policy.laborToFoodFrac = 0;
    const rng = makeRng(5);
    tick(s, rng);
    // player food this year was ~0 -> population should have collapsed toward 0
    expect(s.markets[0].population).toBeLessThanOrEqual(Math.floor(s.markets[0].foodThisYear) + 1);
  });

  it('early-game safety net keeps the player alive through the opening (ramped floor)', () => {
    const s = createWorld(5, W, H, OPTS);
    s.markets[0].policy.laborToFoodFrac = 0; // starve on purpose
    const rng = makeRng(5);
    // The floor ramps from PLAYER_SAFE_FLOOR down to 0 across the window, so the player must not
    // be wiped out during the critical opening even under total starvation.
    const half = Math.floor(CONFIG.PLAYER_SAFE_YEARS / 2);
    for (let i = 0; i < half; i++) tick(s, rng);
    expect(s.markets[0].population).toBeGreaterThan(0);
  });
});

describe('determinism + batch equivalence', () => {
  it('same seed + inputs -> identical state hash', () => {
    const a = createWorld(2024, W, H, OPTS);
    const b = createWorld(2024, W, H, OPTS);
    tickBatch(a, makeRng(2024), 40);
    tickBatch(b, makeRng(2024), 40);
    expect(hash(a)).toBe(hash(b));
  });

  it('80x tick(1) == one tickBatch(80) (up to a game-over)', () => {
    // Mirror tickBatch's early-stop so the equivalence holds even if the game ends mid-run.
    const ended = (st: WorldState): boolean => {
      const p = st.markets[0];
      return (
        p.population <= 0 ||
        p.cells.size === 0 ||
        (st.finalTechYear >= 0 && st.year >= st.finalTechYear + 2)
      );
    };
    const a = createWorld(777, W, H, OPTS);
    const b = createWorld(777, W, H, OPTS);
    const ra = makeRng(777);
    // Per-turn accumulators are incremented by the economy during tick() and merely reset (to 0,
    // a no-op on a fresh world) at the start of tickBatch — so a manual 1-year loop reproduces a
    // single tickBatch exactly, no mirroring needed.
    for (let i = 0; i < 80; i++) {
      tick(a, ra);
      if (ended(a)) break;
    }
    tickBatch(b, makeRng(777), 80);
    expect(hash(a)).toBe(hash(b));
  });

  it('serialize -> deserialize -> serialize is stable', () => {
    const s = createWorld(321, W, H, OPTS);
    tickBatch(s, makeRng(321), 25);
    const once = serialize(s);
    const round = serialize(deserialize(once));
    expect(JSON.stringify(round)).toBe(JSON.stringify(once));
  });

  it('determinism holds with a fixed policy including famineTolerance', () => {
    const policy = {
      laborToFoodFrac: 0.5,
      rawToMarketFrac: 0.7,
      rawToTechFrac: 0.1,
      rawToReserveFrac: 0.2,
      forcedIntervention: true,
      famineTolerance: 0.3,
    };
    const a = createWorld(4242, W, H, OPTS);
    const b = createWorld(4242, W, H, OPTS);
    a.markets[0].policy = { ...policy };
    b.markets[0].policy = { ...policy };
    tickBatch(a, makeRng(4242), 40);
    tickBatch(b, makeRng(4242), 40);
    expect(hash(a)).toBe(hash(b));
  });
});
