// Births, autonomous per-person movement target selection, and propensity updates.
// [DEFAULT] Only market-owned persons reproduce; wild persons only wander until absorbed
// (prevents unbounded wild-population explosion with no death pressure on them).

import type { RNG } from '../world/rng';
import {
  type Market,
  type WorldState,
  isWild,
  marketIdOf,
  orientation,
  spawnPerson,
} from '../world/state';
import { CONFIG } from '../config';

export interface MoveIntent {
  person: number;
  from: number;
  to: number;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

// Step 2: each of the market's live persons rolls BIRTH_RATE independently.
export function births(s: WorldState, m: Market, rng: RNG): void {
  const parents: number[] = [];
  for (let p = 0; p < s.personCapacity; p++) {
    if (s.personCell[p] !== -1 && s.personOwner[p] === m.id) parents.push(p);
  }
  for (const parent of parents) {
    if (s.liveCount >= CONFIG.MAX_PERSONS) break;
    if (rng.next() < CONFIG.BIRTH_RATE) {
      const child = spawnPerson(s, s.personCell[parent], m.id, 0);
      if (child !== -1) {
        m.bornThisYear++;
        m.population++;
      }
    }
  }
}

function saturatedRaw(s: WorldState, cell: number): boolean {
  const avail = s.rawYield[cell] + s.rawStock[cell];
  if (avail <= 0) return true;
  return s.cellPopulation[cell] * CONFIG.LABOR_CAPACITY >= avail;
}

function metric(s: WorldState, cell: number, marketOriented: boolean): number {
  if (marketOriented) {
    if (saturatedRaw(s, cell)) return -Infinity;
    return s.rawYield[cell] + s.rawStock[cell];
  }
  // People-oriented: seek food HEADROOM (carrying capacity minus current mouths), not raw yield.
  // This is what makes a crowded cell shed population into emptier land -> spatial expansion.
  return s.foodYield[cell] - s.cellPopulation[cell];
}

// Step 9 (intent phase): produce a move intent per moving person.
export function moveIntents(s: WorldState, rng: RNG): MoveIntent[] {
  const intents: MoveIntent[] = [];
  for (let p = 0; p < s.personCapacity; p++) {
    const from = s.personCell[p];
    if (from === -1) continue;
    if (rng.next() >= s.personPropensity[p]) continue;

    const owner = s.personOwner[p];
    let marketOriented = false;
    if (!isWild(owner)) {
      marketOriented = orientation(s.markets[marketIdOf(owner)]) >= 0.5;
    }

    const cx = from % s.width;
    const cy = Math.floor(from / s.width);
    const curVal = metric(s, from, marketOriented);
    let bestVal = curVal;
    let bestDir: readonly [number, number] | null = null;
    let bestDist = 0;

    for (const dir of DIRS) {
      for (let d = 1; d <= CONFIG.VIEW_RANGE; d++) {
        const nx = cx + dir[0] * d;
        const ny = cy + dir[1] * d;
        if (nx < 0 || ny < 0 || nx >= s.width || ny >= s.height) break;
        const cell = ny * s.width + nx;
        const val = metric(s, cell, marketOriented);
        if (val > bestVal) {
          bestVal = val;
          bestDir = dir;
          bestDist = d;
        }
      }
    }

    if (!bestDir) continue; // no strictly-better cell -> stay
    const step = Math.min(CONFIG.MOBILITY, bestDist);
    const to = (cy + bestDir[1] * step) * s.width + (cx + bestDir[0] * step);
    intents.push({ person: p, from, to });
  }
  return intents;
}

// Step 10: propensity rises on local food deficit, otherwise relaxes (and bursts decay).
export function updatePropensity(s: WorldState, deficitCells: Set<number>): void {
  for (let p = 0; p < s.personCapacity; p++) {
    const cell = s.personCell[p];
    if (cell === -1) continue;
    const owner = s.personOwner[p];
    const deficit = isWild(owner) || deficitCells.has(cell);
    let next: number;
    if (deficit) {
      next = s.personPropensity[p] + CONFIG.PROPENSITY_RISE;
    } else {
      next = s.personPropensity[p] * CONFIG.BURST_DECAY - CONFIG.PROPENSITY_DECAY;
    }
    s.personPropensity[p] = Math.max(0, Math.min(1, next));
  }
}
