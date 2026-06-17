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
  bounds the pool (every tick scans it O(N)); raise it only with an eye on per-turn latency.
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
    tech.ts            ext() [raw->goods], foodExt() [land-limited food], researchCost(), maxTechLevel()
    economy.ts         production, 3-way raw disposition, goods accrual, auto-consumption, deaths, burstSpend
    agents.ts          births, per-person movement target selection, propensity updates
    conflict.ts        movement resolution: fog reveal, wild absorption, market-vs-market conflict
    ai.ts              fixed-policy controller for non-player markets
    tick.ts            THE SPINE: tick() resolves one year in §5.3 order; tickBatch() + win/loss
  render/
    format.ts          formatCell (compact in-cell) + formatNumber (K/M/B/T)
    snapshot.ts        buildSnapshot(): derive render-facing per-cell arrays + market summaries
    viewport.ts        pan/zoom state + culling
    canvas.ts          draw(): black bg, wireframe, text-only cells, overflow-proof labels, view modes
  ui/
    sidebar.ts         view toggle, Policy (labor + 3-way raw + forced-intervention), years (3 options), stats
    stats.ts           end-game win/loss summary overlay + per-year charts
  worker/
    protocol.ts        typed ToWorker / FromWorker message contract
    simWorker.ts       owns WorldState + master RNG; INIT/LOAD/SET_POLICY/TICK/SAVE; emits SNAPSHOT/GAME_OVER
  persistence.ts       localStorage save/load (base64)
  main.ts              bootstrap: spawn worker, wire canvas + sidebar + input + zoom + hover tooltip
tests/
  sim.test.ts          economic invariants, determinism, batch-equivalence, safety net
  balance.test.ts      balance smoke (survival / spatial expansion / starvation), reported + asserted
```

## How the live code intentionally diverges from / extends PLAN.md

The shipped sim has evolved past the original spec in a few **documented** ways (see
`agents/history/`):

- **Raw policy is three-way** (`rawToMarketFrac` / `rawToTechFrac` / `rawUnminedFrac`, summing
  to 1) rather than the two-way research-vs-market split in `PLAN.md` §6. Leaving raw unmined
  banks it in `rawStock` and lowers `orientation`.
- **Food is decoupled from tech.** `ext` (raw→goods) grows at `TECH_MULTIPLIER`; food uses a
  separate, much weaker `foodExt` (`FOOD_TECH_MULTIPLIER`, default 1.0) so a cell's food
  carrying capacity stays land-limited and population growth must spread across cells.
- **Early-game safety net**: the player cannot be driven below `PLAYER_SAFE_FLOOR` during the
  first `PLAYER_SAFE_YEARS`; AI and wild persons are never protected. Eventual collapse remains
  possible afterward.
- **Forced Intervention** (the renamed Burst Spend) is a **player policy checkbox** auto-applied
  each cycle while affordable, not a one-shot button.
- **Years-per-turn** is three discrete options (10 / 50 / 250).

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
7. Commit with the no-attribution author; deploy (GH Pages) is the terminal CI step off `main`.
