# AGENTS.md — operational guide for future agents

This is the working guide for AI agents (and humans) extending **Synthetic Markets**. Read it
before editing. The authoritative *design* spec is [`PLAN.md`](./PLAN.md); this file is the
*operational* companion (how the code is laid out, how to run it, and how to extend it safely).

## Project overview

A browser-based, no-backend grid simulation of market expansion and autonomous agents
(Sugarscape lineage + a market/ownership/technology economy). TypeScript + Vite, rendered on
Canvas 2D, with the authoritative simulation running in a Web Worker behind a seeded RNG.

## Tech stack

- **TypeScript + Vite** (static build, GitHub Pages friendly).
- **Canvas 2D** rendering with viewport culling (no DOM grid).
- **Web Worker** owns the authoritative `WorldState` + the master RNG; the main thread only
  renders snapshots and sends control messages.
- **Land** is Struct-of-Arrays flat typed arrays; **Persons** are discrete records in a SoA
  pool with per-cell linked lists; **Markets** are an array of structs.
- **Persistence**: `localStorage`, full-state base64 serialization, autosaved once per turn.

## Canonical glossary & rules (do not invent synonyms)

- Glossary + state schema: **`PLAN.md` §2**. One concept → one field. Notably there is **no**
  `goodsToPeople`/`goodsToMarket` field; goods auto-consume from `capitalWealth`.
- Deterministic per-year tick order: **`PLAN.md` §5.3**. Do not reorder steps.
- `orientation` is a **raw-units** ratio `rawToMarket / (rawToMarket + rawLeftUnmined)`
  (research raw excluded; `0/0 → 0`).

## Build / test / dev commands

```bash
npm install
npm run dev         # http://localhost:5173
npm run typecheck   # tsc --noEmit  (must pass)
npm test            # vitest: invariants + balance smoke (must pass)
npm run build       # tsc -b && vite build  (must pass)
```

Keep `typecheck`, `test`, and `build` green at all times.

## Repo conventions (important)

- **No-attribution commits.** Author commits as
  `git -c user.name=kuanb -c user.email=kuanbutts@gmail.com`. NO co-author / tool / "generated
  by" trailers. Never modify the global git config.
- **`src/config.ts` is the single source of all tunables.** No magic numbers elsewhere; add a
  named constant here and reference it.
- **Discrete-person model.** Population is a count of individual `Person` records; births,
  movement, starvation, conflict, and absorption all operate on individual records. `MAX_PERSONS`
  (currently `250_000`) bounds the pool. The per-tick cost is ~linear in (markets + live persons):
  several passes (births, movement, propensity) scan the live pool, but the old per-tick full-pool
  `refreshDerived` and the per-market full-pool burst scan were removed (see the perf divergence
  note below), so `population` is now maintained incrementally, not recomputed each tick.
- **The worker owns authoritative state.** No `Math.random()` anywhere that affects simulation
  state — all randomness flows through the seeded `RNG` (`src/world/rng.ts`), forked per
  subsystem per year for determinism. Same seed + same inputs ⇒ byte-identical run.
- **Large numbers**: render in-cell via `formatCell` (≤4 glyphs) and in the sidebar/tooltip via
  `formatNumber` (K/M/B/T).

## File / module map

```
src/
  config.ts            ALL tunable constants + the 46-entry tech table
  world/
    rng.ts             seeded, serializable PRNG (Mulberry32) + fork()
    terrain.ts         seeded autocorrelated value-noise -> foodYield / rawYield
    state.ts           WorldState, Market, Policy, Person SoA pool, accessors, (de)serialize, world gen
  sim/
    tech.ts            ext() [raw->goods], foodExt() [land-limited food], researchCost(), maxTechLevel(), visionRadius()
    economy.ts         production (+ yield potentials), 3-way raw disposition, goods accrual, auto-consumption, deaths, burstSpend
    agents.ts          births, per-person movement target selection (+ food-surplus move damping), propensity updates
    conflict.ts        movement resolution: fog reveal, wild absorption, market-vs-market conflict
    ai.ts              fixed-policy controller for non-player markets
    burst.ts           Forced-Intervention territory burst geometry (arm + terminus blob); tech-gated annexation
    tick.ts            THE SPINE: tick() resolves one year in §5.3 order; tickBatch(); captureTurnStart()/logTurnEvents() (per-turn events) + win/loss
  render/
    format.ts          formatCell (compact in-cell) + formatNumber (K/M/B/T)
    snapshot.ts        buildSnapshot(): per-cell arrays + player summary + log + events + top rival markets
    viewport.ts        pan/zoom state + culling (4 zoom levels)
    canvas.ts          draw(): black bg, wireframe, text-only cells, overflow-proof labels, view modes
  ui/
    sidebar.ts         Policy (labor + 3-way raw + Famine Tolerance + forced-intervention), years (3 options), Settings gear, live stats
    charts.ts          top-left "History · per year" live mini-charts (hover tooltip; collapsible)
    stats.ts           end-game win/loss summary overlay + per-year charts (incl. wealth concentration)
  worker/
    protocol.ts        typed ToWorker / FromWorker message contract
    simWorker.ts       owns WorldState + master RNG; INIT/LOAD/SET_POLICY/TICK/SAVE; emits SNAPSHOT/GAME_OVER
  persistence.ts       localStorage save/load (base64)
  main.ts              bootstrap: worker + canvas + sidebar + input + zoom; map overlays (view modes,
                       History charts, Chronicle events, Other markets), Settings modal, desktop hint
tests/
  sim.test.ts          economic invariants, determinism, batch-equivalence, safety net
  balance.test.ts      balance smoke (survival / spatial expansion / starvation), reported + asserted
```

## How the live code intentionally diverges from / extends PLAN.md

The shipped sim has evolved well past the original spec. The list below is the **authoritative
reconciliation** — where `PLAN.md` and the code disagree, the code wins and this list explains why.
(`PLAN.md §11` carries the same delta list.)

Economy / policy:

- **Raw policy is three-way** (`rawToMarketFrac` / `rawToTechFrac` / `rawToReserveFrac`, summing
  to 1) rather than the two-way research-vs-market split in the original `PLAN.md` §6. Reserve raw
  banks in `Market.rawReserves` (funds the burst) and lowers `orientation`.
- **Food is decoupled from tech.** `ext` (raw→goods) grows at `TECH_MULTIPLIER`; food uses a
  separate, much weaker `foodExt` (`FOOD_TECH_MULTIPLIER`, default 1.0) so a cell's food
  carrying capacity stays land-limited and population growth must spread across cells.
- **Famine Tolerance** (`Policy.famineTolerance`, default `0.1`) + **food-surplus migration
  damping**: when a market's food surplus tightens, propensity to MOVE is scaled toward
  `MIN_MOVE_SCALE` (anchored by `FOOD_ANCHOR_MARGIN`/`FOOD_ANCHOR_BAND`, shifted by tolerance) so
  people stop abandoning the cells that feed them. (Movement keeps exactly one `rng.next()` per
  person — the threshold is only scaled — so determinism/batch-equivalence hold.)
- **Default labor split** is `LABOR_TO_FOOD_DEFAULT = 0.95` (food-heavy), not the spec's `0.5`.

Forced Intervention / burst (`PLAN.md §5.7`):

- It is a **player policy checkbox** (renamed from "Burst Spend"), auto-applied each cycle while
  affordable, not a one-shot button. Cost = `BURST_RAW_COST_MULT × cycle raw mined`, paid from
  `rawReserves`; banks until reserves suffice.
- **Annexation is tech-gated, not unconditional**: unowned/wild cells are taken freely, but an
  enemy market's cell is only seized when the player out-techs that market.

Vision / fog:

- **Sight grows with technology.** `revealPlayerVision` reveals the player territory's bounding box
  expanded by `visionRadius(techLevel)` (`VISION_BASE` + ramp to full-map by the Satellites tech),
  not a fixed 1-cell ring. `VIEW_RANGE` (=1) is the *movement* search range, a separate concept.

Reporting / state (all derived; persisted with the world):

- **Historical events feed** (`WorldState.events: GameEvent[]`, `encounteredMarkets: Set`): epoch,
  tech discovered, forced intervention, population boom/crash, rival-market collapse/swing, rival
  encounters, allocation changes. Magnitude-over-time events (player crash/boom, rival
  collapse/±50% swing) are computed **per turn** by the worker (`captureTurnStart`/`logTurnEvents`
  around `tickBatch`), tagged with a year span — *not* inside `tick()`, so per-year
  batch-equivalence is preserved.
- **Wealth Concentration** (`wealthConcentration`): a top-decile (Gini-style) wealth SHARE in
  [0,100] — the share of the market's wealth (per-cell `rawYield+rawStock`) held by its wealthiest
  `WEALTH_TOP_FRACTION` (10%) of the population. ~10% when even, →100% when concentrated. Tracked in
  `YearLog`, charted, reported (as a run average) on the end-game card.
- **Insurrection** (player-only, `RNG_SALT.INSURRECTION`): high Wealth Concentration risks collapse.
  Per year ≥ `INSURRECTION_THRESHOLD` (75%) a roll (1%@75% → 95%@100%, linear) may contract the
  market by `INSURRECTION_CONTRACT_MIN..MAX` (50–85%) of cells, keeping the top population centers
  and shedding the periphery (its people lost; survivors risk a food-driven follow-on collapse).
  Warning cards on each `INSURRECTION_WARN_STEP` crossing from `INSURRECTION_WARN_FROM` (55%). Events:
  `warning`, `insurrection` (both also pop a transient alert card).
- **Yield efficiency**: per-cycle `foodPotentialThisCycle` / `rawPotentialThisCycle` accumulators
  expose captured-vs-potential food/raw in the sidebar.
- **Snapshot ships more than markets[0]**: also `log` (full `YearLog[]` incl. `rawMined`,
  `techInvested`, `population`, `wealthConcentration`), `events`, and `topMarkets` (the "5 largest
  markets" panel — the player + discovered+alive rivals). There is **no** `marketHue` array (only `cellHue`).

Performance / scale:

- **Density pushed up an order of magnitude** after the hot path was made ~linear in
  (markets + live persons): `CELLS_PER_MARKET = 50` (~1800 markets on 300×300, was 900/~100),
  `WILD_CELL_DENSITY = 0.35` (was 0.10), `MAX_PERSONS = 250_000` (was 80k). The two big wins:
  removing the per-tick full-pool `refreshDerived` (population is maintained incrementally) and
  making `burstSpend` walk only the market's cells.

UI / turns:

- **Years-per-turn** is three discrete options (10 / 50 / 250); **four** zoom levels.
- Map overlays: top-center **view-mode** selector, top-left **History** mini-charts (collapsible) +
  **5 largest markets** panel (player + discovered rivals), top-right **Chronicle** events feed. A **Settings** gear in the sidebar
  opens a modal (board size / market & population density → New Game, About, **debug-log download**).
  A one-time **"best on desktop"** modal shows on viewports < 1500px wide.
- `INIT` accepts optional `wildCellDensity` / `aiMarkets` overrides (Settings → New Game).

## How to safely extend the simulation

1. Add any new tunable to `src/config.ts`; never hardcode.
2. New economic rules belong behind `sim/tick.ts`'s fixed step order; do not reorder steps.
   If a step needs new per-cycle data, add a reset-to-0 accumulator on `Market` in
   `resetAccumulators` and populate it in the right step.
3. All randomness: fork the passed `RNG` with a stable salt (see `RNG_SALT`). Never
   `Math.random()`.
4. If you change `WorldState`/`Market`/`Policy` shape, update `serialize`/`deserialize` and the
   worker `SET_POLICY` handler, and bump expectations in `tests/`.
5. If you add a render-facing field, expose it via `buildSnapshot` (the worker never ships the
   person pool to the main thread).
6. Run `npm run typecheck && npm test && npm run build` before committing. Add/adjust invariant
   tests for new rules; keep the balance smoke test meaningful.
7. **Keep the in-game "How to Play" modal accurate.** If you meaningfully change player-facing
   mechanics — the policy levers (labor / 3-way raw / famine tolerance), tech→yield behavior,
   market interaction & conflict, Forced Intervention, or the win/loss/insurrection rules — update
   `HELP_SECTIONS` in `src/main.ts` (the help "?" modal, opened from the sidebar header) so the
   guide stays in sync. The player has no other tutorial.
8. Commit with the no-attribution author; deploy (GH Pages) is the terminal CI step off `main`.
