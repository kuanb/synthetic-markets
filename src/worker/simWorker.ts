// Simulation worker: owns the authoritative WorldState + master RNG. No DOM, no Math.random.

import {
  createWorld,
  deserialize,
  serialize,
  logEvent,
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

interface PolicyShape {
  laborToFoodFrac: number;
  rawToMarketFrac: number;
  rawToTechFrac: number;
  rawToReserveFrac: number;
  forcedIntervention: boolean;
}

// Log a player allocation change as a historical event. Sliders fire on every drag step, so a
// run of changes within the SAME year is COALESCED into a single event (the last policy event of
// the current year is rewritten rather than appended).
function logPolicyChange(s: WorldState, isPlayer: boolean, before: PolicyShape, after: PolicyShape): void {
  if (!isPlayer) return;
  const eps = 0.005;
  const changed =
    Math.abs(before.laborToFoodFrac - after.laborToFoodFrac) > eps ||
    Math.abs(before.rawToMarketFrac - after.rawToMarketFrac) > eps ||
    Math.abs(before.rawToTechFrac - after.rawToTechFrac) > eps ||
    Math.abs(before.rawToReserveFrac - after.rawToReserveFrac) > eps ||
    before.forcedIntervention !== after.forcedIntervention;
  if (!changed) return;
  const pct = (x: number) => Math.round(x * 100);
  const text =
    `Allocations set \u2014 labor ${pct(after.laborToFoodFrac)}% food \u00b7 ` +
    `raw ${pct(after.rawToMarketFrac)}/${pct(after.rawToTechFrac)}/${pct(after.rawToReserveFrac)} ` +
    `mkt/tech/res \u00b7 intervention ${after.forcedIntervention ? 'on' : 'off'}`;
  const last = s.events[s.events.length - 1];
  if (last && last.kind === 'policy' && last.year === s.year) {
    last.text = text; // coalesce a drag into one event for the year
  } else {
    logEvent(s, 'policy', text);
  }
}

self.onmessage = (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  try {
    switch (msg.type) {
      case 'INIT': {
        world = createWorld(msg.seed, msg.width, msg.height, {
          wildCellDensity: msg.wildCellDensity,
          aiMarkets: msg.aiMarkets,
        });
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
          const before = { ...m.policy };
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
          logPolicyChange(world, m.isPlayer, before, m.policy);
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
