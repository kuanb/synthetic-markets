// Social Stability + Labor Efficiency — a scaffold for Polanyi's "double movement".
//
// Social Stability (0..100) models a society's capacity to keep participating in and supporting the
// market system as rapid expansion, technological disruption, wealth concentration and food
// insecurity accumulate. It is NOT morality, happiness, or political ideology.
//
// Each cycle every market's stability is recomputed from three penalties and CARRIED to the next
// cycle, where it scales effective labor (food/raw/research) and market coverage (goods capture):
//   stability = 100 - wealthPenalty - foodStressPenalty - disruptionPenalty   (clamped 0..100)
//
// Pure, deterministic functions (no RNG) so determinism/batch-equivalence are unaffected. Future
// social-event hooks (food riots, labor protests, intervention pressure) can read m.socialStability
// here without touching the economy.

import { CONFIG } from '../config';
import { type Market, type WorldState, wealthConcentration } from '../world/state';
import { maxTechLevel } from './tech';

type Anchors = readonly (readonly [number, number])[];

// Piecewise-linear interpolation over [x, y] anchors (ascending x). Below the first anchor returns
// its y; above the last anchor extrapolates along the final segment's slope.
function interp(anchors: Anchors, x: number): number {
  if (x <= anchors[0][0]) return anchors[0][1];
  for (let i = 1; i < anchors.length; i++) {
    const [x0, y0] = anchors[i - 1];
    const [x1, y1] = anchors[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  const [x0, y0] = anchors[anchors.length - 2];
  const [x1, y1] = anchors[anchors.length - 1];
  return y1 + ((y1 - y0) / (x1 - x0)) * (x - x1);
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Penalty from the existing Top-10% wealth-share metric (nonlinear, harsher at the extremes).
export function wealthPenalty(concentration: number): number {
  return Math.max(0, interp(CONFIG.STABILITY_WEALTH_ANCHORS, concentration));
}

// Penalty from food insecurity: the per-capita surplus ratio (food/pop - 1). Healthy surplus -> 0;
// scarcity -> up to STABILITY_FOOD_MAX_PENALTY. Insecurity, not literal starvation, is the driver.
export function foodStressPenalty(food: number, population: number): number {
  if (population <= 0) return 0;
  const surplus = food / population - 1;
  const safe = CONFIG.STABILITY_FOOD_SAFE_SURPLUS;
  const crisis = CONFIG.STABILITY_FOOD_CRISIS_SURPLUS;
  if (surplus >= safe) return 0;
  if (surplus <= crisis) return CONFIG.STABILITY_FOOD_MAX_PENALTY;
  const stress = (safe - surplus) / (safe - crisis); // 0..1
  return CONFIG.STABILITY_FOOD_MAX_PENALTY * stress;
}

// Penalty from accumulated, decaying technology-disruption (capped so a tech sprint can't zero out).
export function disruptionPenalty(techDisruption: number): number {
  return Math.min(techDisruption, CONFIG.STABILITY_TECH_MAX_PENALTY);
}

// Disruption shock injected when a market REACHES `level`. Scales with the era so a late,
// civilization-altering technology is a social earthquake, not the same ripple as a stone tool.
export function techShock(level: number): number {
  return CONFIG.STABILITY_TECH_SHOCK_BASE + CONFIG.STABILITY_TECH_SHOCK_PER_LEVEL * level;
}

export function computeStability(
  concentration: number,
  food: number,
  population: number,
  techDisruption: number,
): number {
  const s =
    CONFIG.STABILITY_MAX -
    wealthPenalty(concentration) -
    foodStressPenalty(food, population) -
    disruptionPenalty(techDisruption);
  return clamp(s, 0, 100);
}

// Fraction of allocated labor that can actually be mobilised this cycle (strikes, unrest, distrust).
export function laborEfficiencyOf(stability: number): number {
  return clamp(interp(CONFIG.STABILITY_LABOR_ANCHORS, stability), 0.25, 1);
}

// How embedded the formal market is — scales goods capture WITHOUT removing territory.
export function marketCoverageOf(stability: number): number {
  return clamp(interp(CONFIG.STABILITY_COVERAGE_ANCHORS, stability), 0.5, 1);
}

// Per-year fraction of the remaining gap that labor efficiency RECOVERS each year, toward full.
// Scales (convex) with tech level: a more advanced, more productive workforce re-mobilises faster,
// so it can absorb its (much larger) late-game shock SOONER than an early society absorbs a small
// one. Convex (f^2) so the speed-up is concentrated in the high-tech end. ~100 yr to full at tech 0,
// ~50 yr at max tech (despite the deeper late dip). Recovery runs on its OWN clock, independent of
// how fast the disruption score itself decays — that is the "society slowly adapts" slowdown.
export function laborRecoverRate(techLevel: number): number {
  const max = maxTechLevel();
  const f = max > 0 ? clamp(techLevel / max, 0, 1) : 0;
  return (
    CONFIG.STABILITY_LABOR_RECOVER_LOWTECH +
    (CONFIG.STABILITY_LABOR_RECOVER_HIGHTECH - CONFIG.STABILITY_LABOR_RECOVER_LOWTECH) * f * f * f
  );
}

// Recompute a market's stability at the END of a cycle and derive labor efficiency + market coverage
// for the NEXT cycle to consume. Tech-disruption decays first, then this cycle's shock (if a level was
// gained) is injected, so the year a technology lands shows the full shock before it fades.
export function updateSocialStability(s: WorldState, m: Market): void {
  m.techDisruption *= CONFIG.STABILITY_TECH_DECAY;
  if (m.techDisruption < 0.01) m.techDisruption = 0;
  if (m.techGainedThisCycle > 0) {
    // Shock scales with the level just reached (era-defining late techs hit hardest). techLevel is
    // the post-unlock level; multiply by levels gained for the rare multi-unlock cycle.
    m.techDisruption += techShock(m.techLevel) * m.techGainedThisCycle;
  }
  const concentration = wealthConcentration(s, m);
  // Food stress uses the PRE-death cohort (m.foodPop): at carrying capacity, deaths cull population
  // down to ~floor(food), so post-death surplus is always ~0 and would mask the real food pressure.
  m.socialStability = computeStability(concentration, m.foodThisYear, m.foodPop, m.techDisruption);

  // Labor efficiency has two factors that combine multiplicatively:
  //   1. INSTANT (food + wealth): tracks current conditions every cycle, recovering as fast as it
  //      falls — so an ordinary food dip is self-correcting and never a death spiral.
  //   2. SLOW tech ADAPTATION: a technology shock slides this DOWN fast (a real, deep dip → the big
  //      pop drops), then it climbs back toward full on its own tech-scaled clock (an advanced
  //      workforce re-mobilises faster). Decoupling the tech term from current conditions is what
  //      stretches a shock into a decades-long slowdown — the window Forced Intervention is for.
  const instant = laborEfficiencyOf(computeStability(concentration, m.foodThisYear, m.foodPop, 0));
  const adaptTarget = laborEfficiencyOf(CONFIG.STABILITY_MAX - disruptionPenalty(m.techDisruption));
  if (adaptTarget < m.laborAdaptation) {
    m.laborAdaptation += CONFIG.STABILITY_LABOR_EASE_DOWN * (adaptTarget - m.laborAdaptation);
  } else {
    m.laborAdaptation += laborRecoverRate(m.techLevel) * (1 - m.laborAdaptation);
  }
  m.laborAdaptation = clamp(m.laborAdaptation, 0.25, 1);
  m.laborEfficiency = clamp(instant * m.laborAdaptation, 0.25, 1);
  m.marketCoverage = marketCoverageOf(m.socialStability);
}
