# Dev 03 — Where development time goes, and a performance pass

**Feature / status:** development tooling. On 8 October 2026 the user asked why each run still took hours despite Dev 02's tools, and chose a performance pass with identical results. Status: verified; committed with this brief.

## What the time is (measured from the session log and commits)

- **One slice is about an hour.** A prompt covers several, because VISION.md's run rule continues from slice to slice. The last prompt covered finishing Dev 02, M5.1 and part of M5.2: 2 hours 20 minutes.
- **About three-quarters of a slice is waiting on verification.** M5.1 took 68 minutes: 15 writing and thinking, 31 running tools, 22 waiting for background runs to report. Three slices of M4 took 202 minutes, 164 of them tool runs.
- **The fork tool helped less than hoped:**
  - **It only skips simulation for tunable changes.** Every code change invalidates checkpoints, so each fork starts by simulating to its year; M5.1's fork took 15 minutes.
  - **The full study ran more often than needed.** M5.1 ran a 2,000-year study and two full studies. The first full study caught a real calibration problem, so it could have been a much cheaper run.
  - **Contention:** five seeds side by side run at about 130 ms a simulated year each, against 97 alone (8 cores sharing one cache). A game running at the same time slowed M5.1's study by about 30% more.

## Performance pass

- **Profile** (a large world, years 1,500–1,700, invariants on, 96 ms a year), by share of the time:
  - production: 25%;
  - invariant checks (every month, as VISION.md asks): 17–21%;
  - decisions: 16% (6% of it the travel search from the capital);
  - culture: 11%;
  - population, research, construction costs and stability: about 5–6% each.
- **The work is mostly necessary**, month by month, per group and per settlement. Without changing a rule, the gains are many small ones.
- **Done**, with identical results:
  - **The invariant checks** keep every check but reuse their per-region scratch arrays instead of allocating nine a month. They check the region index in one pass instead of a list search per settlement, test a group's values without a dynamic key loop, and allocate no Set per culture. 96 → 92 ms a year.
  - **The shortest-path heap** (capital travel, relief, road routes) takes entries without allocating a tuple per pop or an array per swap. The comparisons and swaps are the same, so ties leave in the same order. 92 → 90 ms a year.
  - **Together:** about 7%.
- **Not done**, the user's choice:
  - relaxing VISION.md's per-tick invariants (full checks yearly, a core set monthly: about 15% more);
  - a data-oriented rewrite (flat arrays for groups and settlements: possibly 1.5–2×, a multi-slice refactor).

## Cheaper verification routine (from M5.2 on)

Acceptance stays exactly as strict; it stops paying for the expensive runs twice.
- **While iterating:** two seeds for 1,500 years (`npm run study:history -- --seed Chronicle --seed Atlas --years 1500`), and forks for tunable variants.
- **Then:** the independent review, before the full study rather than alongside it, so its findings do not invalidate a finished study.
- **Then:** one full five-seed, 3,000-year study and one complete `npm run check` per slice.

## Acceptance

- **Identical histories:** the five study seeds over 3,000 years reproduce M5.1's event-log hashes exactly (`.chronicle/studies/m5-1`).
- **A heap test:** cheapest first, ties in a fixed order, and `pop` unchanged.
- **The complete `npm run check` passes.**

## Results

- **Identical histories:** the five seeds reproduce M5.1's hashes at year 3,000 exactly. Atlas `776eced9`, Chronicle `359381bc`, Elsewhere `c5844137`, Verdant `211c67a3` and Aster `5b7f29fb` (`.chronicle/studies/dev-03`).
- **The full study on an idle machine:** 6.6 minutes, its slowest seed 397 s (94–132 ms a simulated year). M5.1's study took 10.8 minutes beside a game. The difference is mostly the machine, and about 7% the code.

## Handoff

- Revision: based on `d646995` (M5.1); committed with this brief.
- Last verified (8 October 2026, local): the complete `npm run check` passed: 263/263 headless and process tests, the build and 57/57 Chromium scenarios, in 7 min 29 s.
- Review: an independent agent reviews the committed diff (are the invariant checks exactly as strict as before?), and any finding gets a follow-up commit.
- Next action: reapply M5.2 from `.chronicle/wip/m5-2/` and finish it with the routine above.
