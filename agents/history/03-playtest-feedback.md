# 03 — Playtest feedback (user notes)

Captured from the user while watching the game come together. The verbatim original mega-prompts
live in the chat history and can be pasted here later for an exact transcript; this is a faithful
capture of the actionable notes.

## UI / controls

- **Years per turn** should be **three discrete options** — 10, 50, or 250 years per cycle
  (segmented buttons, default 10) — not a free slider.
- **Zoom (1× / 2×)** belongs on the **map**, next to the on-screen arrow pad — they are
  map-view controls, not game metrics/controls — so move them out of the sidebar.
- **"Burst Spend" → "Forced Intervention — Market Expansion".** Move it into a **Policy** box
  alongside the labor/raw allocation controls, and make it a **checkbox** ("always perform each
  cycle") rather than a one-shot button. It must be **greyed out / disabled-looking when the
  player cannot afford it** (cost = `ceil(cells / 2)` goods), reflecting affordability live.
- **Cell text was unreadable** — values overflowed cells and showed long fractions like
  `359.23`. In-cell numbers must be compact shorthand (`359`, `1.5k`, `115m`) that always fits
  at both zoom levels (omit if it can't). Add a **hover tooltip** over the map showing the full
  precise value(s), coordinates, and owning market for the hovered cell.

## Balance — the year-4758 imbalance

Observed state at year 4758: tech **Nanotechnology**, **capitalWealth 138.6B**, goods/cycle
**115.4M**, **population 250**, **market size only 3 cells**, consumed/capita **100** (== the old
`DESIRE_CAP`), **orientation 1.00**, and **zero starvation**. The player hoarded astronomical
wealth, never starved, and never spatially expanded.

Root causes: food scaled with `ext` (so one cell could feed essentially unlimited people → no
food pressure → propensity-to-move never rose → no migration → no expansion), and `DESIRE_CAP`
capped consumption so goods always dwarfed need (no goods-starvation either).

## Goals from the feedback

- **Starvation must be theoretically possible at all eras** (not just early game).
- **Market growth must force spatial expansion** — a growing population should outstrip what its
  current cells can feed and be pushed to migrate into and claim new cells. (Core fix.)
- **No instant early death** — the player must not be wiped out "right out the gate" or hit
  population 0 trivially in the opening. Market-driven deaths are fine; eventual collapse is
  fine; an instant early loss is not.

The v3 balance retune in `02-design-v1-to-v2.md` implements these (food decoupled from tech →
land-limited carrying capacity → expansion pressure; raised desire ceiling → goods-starvation
possible; early-game safety net → survivable start).

## Later feedback (same playtest session, folded into v3)

- **Technology must be expensive / a real choice.** Tune the research cost curve up substantially
  (co-tuned with `TECH_MULTIPLIER`) so a society advances only by (a) pouring ~all raw into
  research for sustained periods, or (b) growing territory/throughput first then redirecting it.
  Casual allocation should NOT reach the final tech in a few hundred years.
  → Implemented: `RESEARCH_C0` 10→100, `RESEARCH_R` 1.18→1.30. Balance smoke shows casual ≈ tech
  15 over 1000 years (not maxed) while an all-in-research strategy reaches further.
- **Raw allocation is a three-way split** (replaces the single research-vs-market slider):
  Market (→goods), Tech (→research), and Leave-unmined (→banks in `rawStock`). Partial allocation
  is the point. Rendered as three sliders in a "Raw allocation" box that always sum to 100%
  (dragging one rescales the others proportionally). `orientation` is driven by the resulting
  `rawToMarket` vs `rawLeftUnmined`.
- **Labor split UI** must be neutral and equal-weight — food was visually privileged (green).
  Present Food vs Mining as a grouped "Labor" box in the same style as Raw allocation, neutral
  palette for both, summing to 100%. Functionally still `laborToFoodFrac` (mining = 1 − food).
- **"Deaths (this year)" → "Deaths (this turn)"**: the sidebar should show total deaths across all
  simulated years of the most recent End Turn batch (e.g. all 50), not just the final year.
  → Implemented via a `diedThisTurn` accumulator reset at the start of each `tickBatch`.
