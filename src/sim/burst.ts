// Forced Intervention — Market Expansion: a dramatic, tech-triggered territory burst.
// Geometry is deterministic given the tick's forked RNG (RNG_SALT.BURST). fireBurst annexes an
// arm + irregular terminus blob of fresh territory into the player market UNCONDITIONALLY (no
// conflict rolls): cells re-owned, banked rawStock transfers with the cell, and ALL persons on
// annexed cells (wild and enemy) convert to the player. Returns true iff anything was annexed
// (so the caller only deducts reserves on a real burst; otherwise the burst stays pending).

import { CONFIG } from '../config';
import type { RNG } from '../world/rng';
import { type Market, type WorldState, setPersonOwner } from '../world/state';

function annexCell(s: WorldState, player: Market, cell: number): void {
  const prev = s.marketId[cell];
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

// Annex a filled disk of radius `r` (clamped to bounds) centered at (cx,cy).
function annexDisk(s: WorldState, player: Market, cx: number, cy: number, r: number): void {
  const W = s.width;
  const H = s.height;
  const r2 = r * r;
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(W - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(H - 1, Math.ceil(cy + r));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) annexCell(s, player, y * W + x);
    }
  }
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
  {
    // Bresenham from (bx,by) to (tx,ty), painting a disk of radius armR at each step.
    let x = bx;
    let y = by;
    const dx = Math.abs(tx - bx);
    const dy = Math.abs(ty - by);
    const sx = bx < tx ? 1 : -1;
    const sy = by < ty ? 1 : -1;
    let err = dx - dy;
    for (;;) {
      annexDisk(s, player, x, y, armR);
      if (x === tx && y === ty) break;
      const e2 = 2 * err;
      if (e2 > -dy) {
        err -= dy;
        x += sx;
      }
      if (e2 < dx) {
        err += dx;
        y += sy;
      }
    }
  }

  // Terminus blob: irregular (NOT a perfect circle) radius in [MIN,MAX], wobbling by angle.
  const baseR =
    CONFIG.TERMINUS_RADIUS_MIN +
    rng.nextInt(CONFIG.TERMINUS_RADIUS_MAX - CONFIG.TERMINUS_RADIUS_MIN + 1);
  const phase = rng.next() * Math.PI * 2;
  const harmonic = 2 + rng.nextInt(3); // 2..4 lobes
  const wobble = 0.2 + rng.next() * 0.3; // 0.2..0.5
  const outer = Math.ceil(baseR * (1 + wobble)) + 1;
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

  return true;
}
