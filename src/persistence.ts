// localStorage save/load. SerializedState is a JSON-able mirror (typed arrays -> base64).

import type { SerializedState } from './world/state';

const KEY = 'SYNTH_MARKETS_SAVE';

export type { SerializedState };

export function save(state: SerializedState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    // quota or unavailable; ignore (autosave is best-effort)
  }
}

export function load(): SerializedState | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return JSON.parse(raw) as SerializedState;
  } catch {
    return null;
  }
}

export function clear(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
