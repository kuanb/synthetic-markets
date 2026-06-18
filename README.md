# Synthetic Markets

A browser-based, no-backend simulation of market expansion and autonomous agents on a grid.
Spiritual descendant of Epstein & Axtell's *Sugarscape* (1996), with an added market /
ownership layer and a per-market technology track. Built with TypeScript + Vite; the
simulation runs in a Web Worker behind a seeded RNG; rendering is Canvas 2D with viewport
culling. See [`PLAN.md`](./PLAN.md) for the full design and frozen contracts.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
```

Other scripts:

```bash
npm run build    # type-check + static production bundle (dist/)
npm test         # vitest invariant + balance suite
npm run preview  # serve the production build
```

## How to play

You control **exactly one market** (the player market). Each turn you set policy, choose how many
years to batch (10 / 50 / 250), then hit **End Turn**. The world resolves every batched year in a
fixed deterministic order.

- **Labor split** — food vs. raw mining. Mining less raw leaves it fallow (banked in the ground as
  `rawStock` — an invasion target).
- **Raw allocation** — a three-way split of mined raw: Market (→ goods/wealth), Tech (→ research),
  Retain in reserves (→ the pool that funds Forced Intervention).
- **Famine Tolerance** — how far people will chase raw before food anchors them in place.
- **Forced Intervention — Market Expansion** (checkbox) — on a new tech, spend reserves to burst a
  new arm + blob of territory into your market (it can only seize a rival's cells where you out-tech
  them; unowned/wild land is taken freely).
- People consume goods **automatically** from the capital pool; there is no goods-to-people slider.
  Your "growth vs. restraint" posture is emergent, captured by `orientation`, which drives conflict.

**View modes** (top-center map overlay): Population/Markets, Food yield, Raw materials. Pan with
arrow keys (or the on-screen pad); four zoom levels. Map overlays also show live **History**
mini-charts and a **5 largest markets** panel (you + discovered rivals, top-left) and a **Chronicle** of major events
(top-right). A **Settings** gear in the sidebar lets you start a new game with a different board
size / market & population density, and download a debug log. Fog-of-war **sight grows with your
technology** (whole map by the Satellites tech).

**Ends when** the player researches the final technology (win, after one more cycle) or the
player market reaches zero population / zero cells (loss). The end-game card reports totals,
per-year charts, and average **Wealth Concentration**. Progress autosaves to `localStorage`
once per turn.

## Resource vocabulary (canonical — see `PLAN.md` §2)

- **Food** — perishable; each person needs 1/cycle or risks death.
- **Raw materials** — mined per policy; unmined raw banks in `rawStock`.
- **Goods** — manufactured from market-allocated raw, scaled by technology.
- **Capital Wealth** — the goods pool; funds consumption, conflict strength, and burst spend.

## Architecture

```
src/
  config.ts            all tunable constants + the 46-entry tech table
  world/   rng, terrain (seeded noise), state (Land SoA + Person pool + worldgen + events)
  sim/     tech, economy, agents, conflict, ai, burst (territory burst), tick (the spine)
  render/  format, snapshot, viewport, canvas
  ui/      sidebar, charts (History mini-charts), stats (end-game summary)
  worker/  protocol, simWorker (owns authoritative state + RNG)
  persistence.ts       localStorage save/load
```

Persons are **discrete individual agents** in a Struct-of-Arrays pool (one record per person);
births, movement, starvation, conflict, and absorption all operate on individual records.

## Notes on defaults

A few ambiguities were resolved with documented defaults (also noted inline in code):

- Only **market-owned** persons reproduce; wild persons only wander until absorbed (prevents
  unbounded wild-population growth with no death pressure).
- Fog reveals only on the **player** market's vision (around its territory); AI/wild movement does
  not lift fog. The sight radius **grows with technology** (full map by the Satellites tech).
- Map defaults to **300×300** (tunable in `config.ts` / the Settings modal).
- `TECH_MULTIPLIER=1.5` keeps `ext(45) ≈ 8.7e7` float-safe (2.0 would reproduce the `2^45`
  runaway and is intentionally avoided).

Run `npm test` to see the **balance smoke report** (flagged, not asserted) for collapse /
post-peak-crash tendencies under the current tunables.
