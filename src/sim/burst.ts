// Forced Intervention — Market Expansion: a dramatic, tech-triggered territory burst.
// Geometry is deterministic given the tick's forked RNG (RNG_SALT.BURST). fireBurst annexes an
// arm + irregular terminus blob of territory into the player market (no conflict rolls): unowned
// and wild cells are taken freely, but an ENEMY market's cell is only seized when the player
// out-techs that market (otherwise it is left untouched). Seized cells are re-owned, banked
// rawStock transfers with the cell, and all persons on them (wild and enemy) convert to the player.
// CONTIGUITY: the arm is a flood-fill from the player's boundary through passable cells, confined to
// the corridor capsule. An enemy market the player can't out-tech is impassable, so a market that
// cuts off the corridor blocks the burst — NOTHING (and no terminus blob) appears on its far side.
// Returns true iff the geometry ran (so the caller deducts reserves on a real burst).

import { CONFIG } from '../config';
import type { RNG } from '../world/rng';
import { type Market, type WorldState, setPersonOwner } from '../world/state';

function annexCell(s: WorldState, player: Market, cell: number): void {
  const prev = s.marketId[cell];
  // Tech gate: a burst can only seize an ENEMY market's cell if the player OUT-TECHS that market.
  // Unowned/wild cells (prev === -1) and the player's own cells (prev === 0) are unaffected.
  if (prev >= 1 && s.markets[prev].techLevel >= player.techLevel) return;
  if (prev !== 0) {
    if (prev >= 0) s.markets[prev].cells.delete(cell);
    s.marketId[cell] = 0;
    player.cells.add(cell); // rawStock[cell] travels with the cell automatically
  }
  // convert/absorb every person on the cell to the player (linked list; setPersonOwner won't relink)
  for (let q = s.cellHead[cell]; q !== -1; q = s.personNext[q]) {
    if (s.personOwner[q] !== 0) setPersonOwner(s, q, 0);
  }
  s.discovered[cell] = 1; // player vision
}

// The corridor can advance into a cell unless it is an enemy market the player does NOT out-tech
// (the same tech gate as annexCell). Such a cell blocks the contiguous arm.
function passable(s: WorldState, cell: number, player: Market): boolean {
  const prev = s.marketId[cell];
  return !(prev >= 1 && s.markets[prev].techLevel >= player.techLevel);
}

// Squared distance from point (px,py) to the segment (ax,ay)-(bx,by). Used to confine the arm
// flood-fill to a "capsule" (corridor of half-width armR) around the centerline.
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const abx = bx - ax;
  const aby = by - ay;
  const len2 = abx * abx + aby * aby;
  let t = len2 > 0 ? ((px - ax) * abx + (py - ay) * aby) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = px - (ax + t * abx);
  const dy = py - (ay + t * aby);
  return dx * dx + dy * dy;
}

export function fireBurst(s: WorldState, player: Market, rng: RNG): boolean {
  const W = s.width;
  const H = s.height;
  const cells = player.cells;
  const nCells = cells.size;
  if (nCells === 0) return false;

  // Player centroid + approx radius R; arm length L ≈ R, capped.
  let sumX = 0;
  let sumY = 0;
  for (const c of cells) {
    sumX += c % W;
    sumY += (c / W) | 0;
  }
  const cx = sumX / nCells;
  const cy = sumY / nCells;
  const R = Math.sqrt(nCells / Math.PI);
  const L = Math.min(R, CONFIG.BURST_MAX_RANGE); // 0.5 * D = R
  const maxReach = R + L;
  const maxReach2 = maxReach * maxReach;

  // Terminus center: among NON-player cells within reach of the territory, the top-10 by raw
  // materials; pick one at random (seeded). If none exist, the burst cannot fire.
  const TOPN = 10;
  const topCells: number[] = [];
  const topRaw: number[] = [];
  for (let cell = 0; cell < W * H; cell++) {
    if (s.marketId[cell] === 0) continue; // skip player-owned
    const x = cell % W;
    const y = (cell / W) | 0;
    const dx = x - cx;
    const dy = y - cy;
    if (dx * dx + dy * dy > maxReach2) continue;
    const raw = s.rawYield[cell] + s.rawStock[cell];
    // insert into the descending top-10
    if (topCells.length < TOPN) {
      topCells.push(cell);
      topRaw.push(raw);
    } else {
      let minI = 0;
      for (let i = 1; i < TOPN; i++) if (topRaw[i] < topRaw[minI]) minI = i;
      if (raw > topRaw[minI]) {
        topRaw[minI] = raw;
        topCells[minI] = cell;
      }
    }
  }
  if (topCells.length === 0) return false; // no reachable territory -> keep pending

  const term = topCells[rng.nextInt(topCells.length)];
  const tx = term % W;
  const ty = (term / W) | 0;

  // Direction: from a random player BOUNDARY cell (adjacent to non-player) toward the terminus.
  const boundary: number[] = [];
  for (const c of cells) {
    const x = c % W;
    const y = (c / W) | 0;
    if (
      (x > 0 && s.marketId[c - 1] !== 0) ||
      (x < W - 1 && s.marketId[c + 1] !== 0) ||
      (y > 0 && s.marketId[c - W] !== 0) ||
      (y < H - 1 && s.marketId[c + W] !== 0)
    ) {
      boundary.push(c);
    }
  }
  const start = boundary.length ? boundary[rng.nextInt(boundary.length)] : term;
  const bx = start % W;
  const by = (start / W) | 0;

  // Arm: thin corridor from the boundary cell to the terminus, random width in [MIN,MAX].
  const armWidth =
    CONFIG.ARM_WIDTH_MIN + rng.nextInt(CONFIG.ARM_WIDTH_MAX - CONFIG.ARM_WIDTH_MIN + 1);
  const armR = armWidth / 2;
  // CONTIGUITY: the arm is a FLOOD-FILL from the player's boundary cell, confined to the corridor
  // "capsule" (within armR of the start->terminus centerline) and only through PASSABLE cells (own,
  // unowned, wild, or lower-tech enemy). An enemy market the player can't out-tech is impassable, so
  // a market that cuts off the corridor blocks the burst entirely — no cells (and no terminus blob)
  // ever appear on its far side. `reachedTerminus` gates the blob below.
  let reachedTerminus = false;
  {
    const armR2 = armR * armR;
    const visited = new Uint8Array(W * H);
    const queue = [start];
    visited[start] = 1;
    for (let qh = 0; qh < queue.length; qh++) {
      const cell = queue[qh];
      annexCell(s, player, cell);
      if (cell === term) reachedTerminus = true;
      const cx = cell % W;
      const cy = (cell / W) | 0;
      const neighbors = [
        [cx + 1, cy],
        [cx - 1, cy],
        [cx, cy + 1],
        [cx, cy - 1],
      ];
      for (const [nx, ny] of neighbors) {
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const nc = ny * W + nx;
        if (visited[nc]) continue;
        visited[nc] = 1; // mark regardless so impassable/out-of-capsule cells aren't re-checked
        if (segDist2(nx, ny, bx, by, tx, ty) > armR2) continue; // outside the corridor capsule
        if (!passable(s, nc, player)) continue; // blocked by a superior enemy market
        queue.push(nc);
      }
    }
  }

  // Terminus blob: irregular (NOT a perfect circle) radius in [MIN,MAX], wobbling by angle.
  // (RNG draws below run unconditionally to keep the stream deterministic; only the painting of the
  // blob is gated on the corridor actually having reached the terminus contiguously.)
  const baseR =
    CONFIG.TERMINUS_RADIUS_MIN +
    rng.nextInt(CONFIG.TERMINUS_RADIUS_MAX - CONFIG.TERMINUS_RADIUS_MIN + 1);
  const phase = rng.next() * Math.PI * 2;
  const harmonic = 2 + rng.nextInt(3); // 2..4 lobes
  const wobble = 0.2 + rng.next() * 0.3; // 0.2..0.5
  const outer = Math.ceil(baseR * (1 + wobble)) + 1;
  if (reachedTerminus) {
    const x0 = Math.max(0, tx - outer);
    const x1 = Math.min(W - 1, tx + outer);
    const y0 = Math.max(0, ty - outer);
    const y1 = Math.min(H - 1, ty + outer);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - tx;
        const dy = y - ty;
        const d = Math.sqrt(dx * dx + dy * dy);
        const ang = Math.atan2(dy, dx);
        const rThresh = baseR * (1 + wobble * Math.sin(harmonic * ang + phase));
        if (d <= rThresh) annexCell(s, player, y * W + x);
      }
    }
  }

  return true;
}
