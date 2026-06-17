# 01 — The captured design spec (PLAN.md)

[`PLAN.md`](../../PLAN.md) at the repo root is the **authoritative captured specification** of
the original design prompt for Synthetic Markets. It was produced (by Opus) as a complete,
self-contained implementation plan intended to be executed by a fleet of cheaper models, and it
remains the source of truth for:

- §1 Context & inspiration (Sugarscape lineage + explicit divergences)
- §2 Authoritative glossary + state schema (one concept → one field)
- §3 Locked tech stack
- §4 Architecture & module map (TS interface contracts)
- §5 Simulation spec + the single deterministic tick-resolution order
- §6 UI spec
- §7 Determinism, seeding, persistence
- §8 Task DAG (waves, dependencies, acceptance criteria)
- §9 Testing strategy (economic invariants as property tests)
- §10 Git / CI workflow (no-attribution commits, GH Pages deploy)

The verbatim original "mega-prompts" that generated `PLAN.md` (and its v1→v2 revision) live in
the chat history and can be pasted in here later if an exact transcript is wanted. `PLAN.md`
itself is the faithful, structured capture of their intent.

The shipped code has since evolved past a few `PLAN.md` defaults; those evolutions are recorded
in `02-design-v1-to-v2.md` and `03-playtest-feedback.md`, and summarized in `AGENTS.md`.
