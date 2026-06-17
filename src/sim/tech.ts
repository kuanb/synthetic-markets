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

export function techName(level: number): string {
  return TECH_TABLE[Math.max(0, Math.min(level, TECH_TABLE.length - 1))];
}
