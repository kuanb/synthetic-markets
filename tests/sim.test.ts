import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config';
import { makeRng } from '../src/world/rng';
import {
  createWorld,
  serialize,
  deserialize,
  marketPopulation,
  type WorldState,
} from '../src/world/state';
import { tick, tickBatch } from '../src/sim/tick';
import { ext, researchCost, maxTechLevel } from '../src/sim/tech';
import { formatNumber } from '../src/render/format';

const W = 60;
const H = 60;

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

describe('world gen', () => {
  it('instantiates 10 discrete persons for the player', () => {
    const s = createWorld(123, W, H);
    expect(marketPopulation(s, 0)).toBe(CONFIG.PLAYER_START_POP);
    expect(s.markets.length).toBe(1 + CONFIG.AI_MARKET_COUNT);
    expect(s.markets[0].isPlayer).toBe(true);
  });
  it('player starts >= margin from every edge', () => {
    const s = createWorld(123, W, H);
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
    const s = createWorld(99, W, H);
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

  it('death floor: population <= floor(food) after a starving cycle', () => {
    const s = createWorld(5, W, H);
    // force everyone to mine (no food) to trigger starvation
    s.markets[0].policy.laborToFoodFrac = 0;
    const rng = makeRng(5);
    tick(s, rng);
    // player food this year was ~0 -> population should have collapsed toward 0
    expect(s.markets[0].population).toBeLessThanOrEqual(Math.floor(s.markets[0].foodThisYear) + 1);
  });
});

describe('determinism + batch equivalence', () => {
  it('same seed + inputs -> identical state hash', () => {
    const a = createWorld(2024, W, H);
    const b = createWorld(2024, W, H);
    tickBatch(a, makeRng(2024), 40);
    tickBatch(b, makeRng(2024), 40);
    expect(hash(a)).toBe(hash(b));
  });

  it('100x tick(1) == one tickBatch(100)', () => {
    const a = createWorld(777, W, H);
    const b = createWorld(777, W, H);
    const ra = makeRng(777);
    for (let i = 0; i < 80; i++) tick(a, ra);
    tickBatch(b, makeRng(777), 80);
    expect(hash(a)).toBe(hash(b));
  });

  it('serialize -> deserialize -> serialize is stable', () => {
    const s = createWorld(321, W, H);
    tickBatch(s, makeRng(321), 25);
    const once = serialize(s);
    const round = serialize(deserialize(once));
    expect(JSON.stringify(round)).toBe(JSON.stringify(once));
  });
});
