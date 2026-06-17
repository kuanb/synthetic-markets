# 02 — Design evolution (v1 → v2, and the v3 balance retune)

## v1 → v2 (revisions folded into `PLAN.md`)

The second design pass changed several core contracts. All are reflected in `PLAN.md`:

1. **`orientation` redefined to a raw-units ratio.** It is now
   `rawToMarket / (rawToMarket + rawLeftUnmined)` over the last cycle (research raw excluded;
   `0/0 → 0`) — a measure of "extract-and-accumulate vs. leave fallow," not the old
   goods-to-market vs. goods-to-people ratio.
2. **Goods are auto-consumed from capital; no goods-to-people slider.** All produced goods enter
   `capitalWealth`; people draw what they need (`desireToConsume`) from that pool automatically
   each cycle (tick step 7). The player policy lost its goods split.
3. **Exactly one player market for the whole game.** Precisely one market has `isPlayer = true`;
   the human controls only it. Conquest converts enemy cells/persons *into* the player market;
   it never grants a second market.
4. **Discrete Person agents instead of cohorts.** "Population 10" instantiates 10 individual
   `Person` records in a Struct-of-Arrays pool (not an aggregate counter/cohort). Births,
   movement, starvation, conflict, and absorption all operate on individual records.
5. **Win/loss end conditions.** Win = player researches the final technology then runs one more
   cycle. Loss = player population reaches 0 or the player owns 0 cells. AI extinction does not
   end the game.

## v3 — balance retune (post-playtest; see `03-playtest-feedback.md`)

Triggered by a year-4758 playtest where the player hoarded ~138.6B capital, never starved, and
never expanded past 3 cells. Implemented changes (constants in `src/config.ts`):

- **Food decoupled from tech.** `ext` (the `TECH_MULTIPLIER` extraction multiplier) now scales
  **raw→goods only**. Food uses a separate, much weaker `foodExt` (`FOOD_TECH_MULTIPLIER`,
  default `1.0`). With food land-limited, a single cell has a finite carrying capacity, so a
  growing population must spread across cells → **growth forces spatial expansion**. Documented
  as a `[DEFAULT]` divergence in `PLAN.md` §5.1/§5.2.
- **Three-way raw allocation.** The raw policy became `rawToMarketFrac` / `rawToTechFrac` /
  `rawUnminedFrac` (summing to 1). Leaving raw unmined banks it in `rawStock` and lowers
  `orientation`. Research is now an explicit, deliberate investment.
- **Research made expensive** (`RESEARCH_C0`, `RESEARCH_R` raised) so reaching late tech is a
  sustained strategic commitment rather than automatic.
- **Desire cap raised to a soft ceiling** (`DESIRE_CAP`) so consumption can outrun goods in a
  rich-but-stagnant market and cause goods-starvation (decadence collapse).
- **Early-game safety net.** The player's start cell (and rook neighbours) are guaranteed
  fertile, and the player cannot be driven below `PLAYER_SAFE_FLOOR` during the first
  `PLAYER_SAFE_YEARS`. AI and wild persons are unaffected; eventual collapse stays possible.

Validation lives in `tests/balance.test.ts` (asserts: survives opening, expands spatially,
population grows; reports: tech reached, peak/final population, capital, starvation years).
