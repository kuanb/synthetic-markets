// Movement resolution + market-vs-market conflict. Fog reveal, wild absorption, conquest.

import type { RNG } from '../world/rng';
import {
  type WorldState,
  isWild,
  marketIdOf,
  movePerson,
  orientation,
  personsOnCell,
  setPersonOwner,
} from '../world/state';
import { CONFIG } from '../config';
import type { MoveIntent } from './agents';

function revealForPlayer(s: WorldState, owner: number, cell: number): void {
  if (owner === 0) s.discovered[cell] = 1; // only the player's vantage lifts fog
}

function claim(s: WorldState, cell: number, marketId: number): void {
  const prev = s.marketId[cell];
  if (prev === marketId) return;
  if (prev >= 0) s.markets[prev].cells.delete(cell);
  s.marketId[cell] = marketId;
  s.markets[marketId].cells.add(cell);
}

function absorbWild(s: WorldState, cell: number, marketId: number): void {
  for (const q of personsOnCell(s, cell)) {
    if (isWild(s.personOwner[q])) setPersonOwner(s, q, marketId);
  }
}

export function resolveMove(s: WorldState, intent: MoveIntent, rng: RNG): void {
  const { person: p, to } = intent;
  if (s.personCell[p] === -1) return; // died earlier this year
  const owner = s.personOwner[p];

  // Wild mover: wander; absorbed if stepping onto owned territory.
  if (isWild(owner)) {
    movePerson(s, p, to);
    const dm = s.marketId[to];
    if (dm >= 0) setPersonOwner(s, p, dm);
    return;
  }

  const mid = marketIdOf(owner);
  const destMarket = s.marketId[to];

  // Own territory or unowned: enter freely, claim, absorb any wild.
  if (destMarket === -1 || destMarket === mid) {
    if (destMarket === -1) {
      claim(s, to, mid);
      absorbWild(s, to, mid);
    }
    movePerson(s, p, to);
    revealForPlayer(s, owner, to);
    return;
  }

  // Enemy-owned & occupied -> conflict gate.
  const a = orientation(s.markets[mid]);
  const b = orientation(s.markets[destMarket]);
  const gap = Math.abs(a - b);
  if (gap <= CONFIG.CONFLICT_GATE) return; // no conflict, mover stays, year consumed

  const pConflict = Math.max(0, Math.min(1, gap));
  if (rng.next() >= pConflict) return; // roll fails, mover stays

  // Conflict occurs. Winner = greater capitalWealth (ties -> defender keeps).
  const attacker = s.markets[mid];
  const defender = s.markets[destMarket];
  const winner = attacker.capitalWealth > defender.capitalWealth ? attacker : defender;

  // All persons on the contested cell convert to the winner.
  for (const q of personsOnCell(s, to)) setPersonOwner(s, q, winner.id);
  claim(s, to, winner.id); // banked rawStock transfers implicitly with the cell

  if (winner.id === mid) {
    movePerson(s, p, to);
    setPersonOwner(s, p, mid);
    revealForPlayer(s, owner, to);
  }
  // else: repelled, mover stays put (year consumed)
}
