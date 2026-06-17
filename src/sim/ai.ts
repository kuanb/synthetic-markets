// Fixed-policy controller for non-player markets. Sets the two policy sliders + maybe bursts.

import type { RNG } from '../world/rng';
import { type Market, type WorldState } from '../world/state';
import { ext } from './tech';
import { burstSpend } from './economy';
import { CONFIG } from '../config';

export function runAiPolicy(s: WorldState, m: Market, rng: RNG): void {
  if (m.isPlayer) return;

  // Fraction of labor needed to roughly feed the population (food >= population).
  const pop = m.population;
  const totalLabor = pop * CONFIG.LABOR_CAPACITY;
  const e = ext(m.techLevel);
  const laborForFood = e > 0 ? pop / e : totalLabor;
  const foodFrac = totalLabor > 0 ? Math.max(0, Math.min(1, laborForFood / totalLabor)) : 1;

  const expansionary = rng.next() < m.propensityToExpand;
  m.policy.laborToFoodFrac = foodFrac; // food-first; remainder to raw
  m.policy.rawToResearchFrac = expansionary ? 0.3 : 0.5;

  if (expansionary) burstSpend(s, m);
}
