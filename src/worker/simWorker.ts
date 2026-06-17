// Simulation worker: owns the authoritative WorldState + master RNG. No DOM, no Math.random.

import {
  createWorld,
  deserialize,
  serialize,
  type WorldState,
} from '../world/state';
import { makeRng, type RNG } from '../world/rng';
import { tickBatch } from '../sim/tick';
import { buildSnapshot } from '../render/snapshot';
import type { FromWorker, ToWorker } from './protocol';

let world: WorldState | null = null;
let rng: RNG | null = null;
let over = false;

function post(msg: FromWorker): void {
  (self as unknown as Worker).postMessage(msg);
}

function snapshot(): void {
  if (world) post({ type: 'SNAPSHOT', snapshot: buildSnapshot(world) });
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'INIT': {
        world = createWorld(msg.seed, msg.width, msg.height);
        rng = makeRng(msg.seed);
        over = false;
        post({ type: 'READY' });
        snapshot();
        break;
      }
      case 'LOAD': {
        world = deserialize(msg.payload);
        rng = makeRng(world.seed);
        over = false;
        post({ type: 'READY' });
        snapshot();
        break;
      }
      case 'SET_POLICY': {
        if (!world) break;
        const m = world.markets[msg.marketId];
        if (m) {
          m.policy.laborToFoodFrac = clamp01(msg.policy.laborToFoodFrac);
          // normalize the three-way raw split defensively (UI already keeps it summed to 1)
          const mk = Math.max(0, msg.policy.rawToMarketFrac);
          const tc = Math.max(0, msg.policy.rawToTechFrac);
          const rv = Math.max(0, msg.policy.rawToReserveFrac);
          const sum = mk + tc + rv;
          if (sum > 0) {
            m.policy.rawToMarketFrac = mk / sum;
            m.policy.rawToTechFrac = tc / sum;
            m.policy.rawToReserveFrac = rv / sum;
          }
          m.policy.forcedIntervention = !!msg.policy.forcedIntervention;
        }
        break;
      }
      case 'TICK': {
        if (!world || !rng || over) break;
        const end = tickBatch(world, rng, msg.years);
        post({ type: 'SAVED', payload: serialize(world) });
        if (end.over) {
          over = true;
          post({ type: 'GAME_OVER', outcome: end.outcome, snapshot: buildSnapshot(world) });
        } else {
          snapshot();
        }
        break;
      }
      case 'REQUEST_SNAPSHOT': {
        snapshot();
        break;
      }
      case 'SAVE': {
        if (world) post({ type: 'SAVED', payload: serialize(world) });
        break;
      }
    }
  } catch (err) {
    post({ type: 'ERROR', message: err instanceof Error ? err.message : String(err) });
  }
};
