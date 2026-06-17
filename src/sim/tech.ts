// Tech table accessors: extraction multiplier and research cost curve.

import { CONFIG, TECH_TABLE } from '../config';

// ext(level) = TECH_MULTIPLIER ^ level. level 0 => 1.0. Scales RAW -> GOODS (wealth).
export function ext(techLevel: number): number {
  return Math.pow(CONFIG.TECH_MULTIPLIER, techLevel);
}

// foodExt(level) = FOOD_TECH_MULTIPLIER ^ level. Separate, much weaker (default unity) factor so
// food stays land-limited and population must spread across cells. See PLAN.md §5.1/§5.2.
export function foodExt(techLevel: number): number {
  return Math.pow(CONFIG.FOOD_TECH_MULTIPLIER, techLevel);
}

// cost (in raw units) to reach `targetLevel` from targetLevel-1.
export function researchCost(targetLevel: number): number {
  return CONFIG.RESEARCH_C0 * Math.pow(CONFIG.RESEARCH_R, targetLevel);
}

export function maxTechLevel(): number {
  return TECH_TABLE.length - 1;
}

// Tech level at which fog-of-war sight should cover the whole map (the "Satellites" tech). Names
// are cosmetic, so fall back to the final tech if it has been renamed away.
const SATELLITES_LEVEL = (() => {
  const i = TECH_TABLE.indexOf('Satellites');
  return i > 0 ? i : TECH_TABLE.length - 1;
})();

// Fog-of-war SIGHT radius (in cells) around a market's territory at a given tech level. Grows by
// at least VISION_PER_LEVEL each tech level, and ramps to the full map dimension by the Satellites
// tech so the whole map becomes visible by then. `maxDim` = max(width, height): a square reveal of
// that radius from any cell covers the entire map.
export function visionRadius(techLevel: number, maxDim: number): number {
  const floor = CONFIG.VISION_BASE + techLevel * CONFIG.VISION_PER_LEVEL; // >= +1 sight / level
  const toFull = SATELLITES_LEVEL > 0 ? Math.round((maxDim * techLevel) / SATELLITES_LEVEL) : maxDim;
  return Math.min(maxDim, Math.max(floor, toFull));
}

export function techName(level: number): string {
  return TECH_TABLE[Math.max(0, Math.min(level, TECH_TABLE.length - 1))];
}
