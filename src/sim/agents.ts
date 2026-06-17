// Births, autonomous per-person movement target selection, and propensity updates.
// [DEFAULT] Only market-owned persons reproduce; wild persons only wander until absorbed
// (prevents unbounded wild-population explosion with no death pressure on them).

import type { RNG } from '../world/rng';
import {
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

// Step 2: SINGLE global pass — each market-owned live person rolls BIRTH_RATE independently.
// (Wild persons don't reproduce — they only wander until absorbed.) One O(liveCount) scan total
// instead of O(capacity) per market, which is essential with thousands of markets.
export function births(s: WorldState, rng: RNG): void {
  // Snapshot current parents so newborns don't reproduce in the same year.
  const parents: number[] = [];
  for (let p = 0; p < s.personCapacity; p++) {
    if (s.personCell[p] !== -1 && !isWild(s.personOwner[p])) parents.push(p);
  }
  for (const parent of parents) {
    if (s.liveCount >= CONFIG.MAX_PERSONS) break;
    if (rng.next() < CONFIG.BIRTH_RATE) {
      const owner = s.personOwner[parent];
      const child = spawnPerson(s, s.personCell[parent], owner, 0);
      if (child !== -1) {
        const m = s.markets[marketIdOf(owner)];
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

// Food-surplus-aware migration damping (Part B). Per market this cycle, compute a movement-
// propensity multiplier in [MIN_MOVE_SCALE, 1] from its food surplus ratio and Famine Tolerance:
// as the surplus approaches the (tolerance-shifted) comfort anchor, scale movement down so people
// stop abandoning the cells that feed them. Precomputed ONCE per tick (thousands of markets),
// indexed by market id; wild persons are unaffected (scale 1).
function computeMoveScales(s: WorldState): Float32Array {
  const scales = new Float32Array(s.markets.length);
  for (const m of s.markets) {
    const surplus = (m.foodThisYear - m.population) / Math.max(1, m.population);
    const anchor = CONFIG.FOOD_ANCHOR_MARGIN * (1 - m.policy.famineTolerance);
    const low = anchor - CONFIG.FOOD_ANCHOR_BAND;
    let scale: number;
    if (surplus >= anchor) scale = 1;
    else if (surplus <= low) scale = CONFIG.MIN_MOVE_SCALE;
    else {
      const frac = (surplus - low) / CONFIG.FOOD_ANCHOR_BAND; // (0,1)
      scale = CONFIG.MIN_MOVE_SCALE + frac * (1 - CONFIG.MIN_MOVE_SCALE);
    }
    scales[m.id] = scale;
  }
  return scales;
}

// Step 9 (intent phase): produce a move intent per moving person.
export function moveIntents(s: WorldState, rng: RNG): MoveIntent[] {
  const intents: MoveIntent[] = [];
  const moveScale = computeMoveScales(s);
  for (let p = 0; p < s.personCapacity; p++) {
    const from = s.personCell[p];
    if (from === -1) continue;

    const owner = s.personOwner[p];
    // Damp the move-propensity threshold by the owning market's food-surplus scale (wild = 1).
    // Exactly ONE rng.next() per person is kept (determinism); only the threshold is scaled.
    const ms = isWild(owner) ? 1 : moveScale[marketIdOf(owner)];
    if (rng.next() >= s.personPropensity[p] * ms) continue;

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
