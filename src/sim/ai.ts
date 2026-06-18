// Fixed-policy controller for non-player markets. Sets the two policy sliders + maybe bursts.

import type { RNG } from '../world/rng';
import { type Market, type WorldState } from '../world/state';
import { foodExt } from './tech';
import { burstSpend } from './economy';
import { CONFIG } from '../config';

export function runAiPolicy(s: WorldState, m: Market, rng: RNG): void {
  if (m.isPlayer) return;

  // Fraction of labor needed to roughly feed the population (food >= population).
  // Food is land-limited (foodExt), so this estimate uses foodExt, not ext.
  const pop = m.population;
  const totalLabor = pop * CONFIG.LABOR_CAPACITY;
  const fe = foodExt(m.techLevel);
  const laborForFood = fe > 0 ? pop / fe : totalLabor;
  const foodFrac = totalLabor > 0 ? Math.max(0, Math.min(1, laborForFood / totalLabor)) : 1;

  const expansionary = rng.next() < m.propensityToExpand;
  m.policy.laborToFoodFrac = foodFrac; // food-first; remainder available for mining
  m.policy.marketStimulus = true; // AIs always cushion a tech slowdown with banked goods (cheap; only spends while recovering)

  // Three-way raw disposition. Expansionary AIs mine almost everything and push it to market
  // (wealth + conflict strength); steady AIs mine moderately, invest a little in tech, and bank
  // some raw. (Sum to 1.)
  if (expansionary) {
    m.policy.rawToMarketFrac = 0.85;
    m.policy.rawToTechFrac = 0.1;
    m.policy.rawToReserveFrac = 0.05;
  } else {
    m.policy.rawToMarketFrac = 0.5;
    m.policy.rawToTechFrac = 0.2;
    m.policy.rawToReserveFrac = 0.3;
  }

  if (expansionary) burstSpend(s, m);
}
