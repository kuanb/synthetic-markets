// Typed message protocol between the main thread and the simulation worker.

import type { Policy, SerializedState } from '../world/state';
import type { Snapshot } from '../render/snapshot';

export type ToWorker =
  | { type: 'INIT'; seed: number; width: number; height: number }
  | { type: 'LOAD'; payload: SerializedState }
  | { type: 'SET_POLICY'; marketId: number; policy: Policy }
  | { type: 'TICK'; years: number }
  | { type: 'REQUEST_SNAPSHOT' }
  | { type: 'SAVE' };

export type FromWorker =
  | { type: 'READY' }
  | { type: 'SNAPSHOT'; snapshot: Snapshot }
  | { type: 'GAME_OVER'; outcome: 'win' | 'loss'; snapshot: Snapshot }
  | { type: 'SAVED'; payload: SerializedState }
  | { type: 'ERROR'; message: string };
