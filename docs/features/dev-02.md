# Dev 02 — Checkpoints, Load year, fork-and-compare, and scenario triggers

**Feature / status:** development tooling, requested by the user on 7 October 2026 before M5 ("as soon as possible for us to speed up the speed and quality of development"). Status: verified; committed with this brief.

**Why:** each M4 slice spent most of its hours waiting.
- **Studies:** five-seed, 3,000-year studies (about 8 minutes each) were rerun for every calibration attempt.
- **Lab:** checking a late feature in the lab meant simulating centuries first.

The user chose a development tool (not VISION.md's slice P save/load), with two parts: a headless fork-and-compare tool and scenario triggers in the lab.

Later the same day, the user looked for the tool in the lab and could not see it: the controls were a closed box, and at year 0 nothing in them applies. Asked, they chose to add **Load year** to the lab now ("Yes, add it now").

**Observable outcome:**
- **Checkpoints.** A history's state at a year can be saved and restored. The world and what tunables derive from it once (food model, field ranking, habitable land, affinities, land value, harshness) are rebuilt from the seed, so a checkpoint is small. A restored history continues exactly as the original.
- **Load year in the lab:** the Testing tools box under the time controls, open by default.
  - It restores the nearest saved checkpoint at or before a year and runs on to it, replacing the history shown. The **Saved** years are buttons.
  - The lab keeps a checkpoint every 250 years of a history left to its rules, and at each year loaded. The first load of a late year simulates there once; later loads take seconds, also after a restart.
- **Fork and compare** (`npm run fork`):
  - load each seed's checkpoint at a year (made once, by simulating to it, and kept under `.chronicle/checkpoints/`, shared with the lab);
  - run the baseline and any number of variants with tunable overrides side by side in worker threads, for some years;
  - print and write a comparison: chosen statistics at the end, their difference from the baseline, variants that made the very same history, and the events of each kind.
- **Scenario triggers in the lab:** in the same box, acting on the region selected on the map, through the real rules, from the first month on:
  - a drought on the region and its neighbours (famine may follow);
  - the region's people finish their current research;
  - the region's civilization founds a religion;
  - the region's people and their neighbours of the same culture in the realm split off as a daughter culture.

  Each is a chronicle event saying a development control was used. The panel notes that the history was altered until a reset or a load.

**Not in this slice:** faster checks from stored worlds (the user did not choose this), and save/load for the game (slice P).

## Acceptance

- **Tests:**
  - **Checkpoints:**
    - a checkpoint taken mid-history, written to disk, restored onto a freshly built world and continued matches the original's state hash and chronicle hash, and the rebuilt world parts equal the original's;
    - a checkpoint from other code, another world or another region partition is refused;
    - the code hash covers the simulation's whole import closure, but not the tunables.
  - **Fork:**
    - the fork core's baseline from a restored checkpoint equals a direct continuation, and a variant restored under its overrides departs from it (derived parts included);
    - the fork command runs end to end;
    - bad overrides are refused.
  - **Scenarios:**
    - each changes what it says through the real rules, emits its event with exactly its text, and leaves the invariants holding;
    - refusals change nothing, and before the first month every scenario is refused;
    - no event template nests conditionals.
  - **Load year through the host:** a checkpoint is kept at 250; an altered history is replaced by the restored one and runs on to the year, which is then kept; an earlier year starts from year 0; without checkpoints, Load year says why.
  - **Contract and configuration:** the contract accepts both new controls and refuses malformed ones; `CHRONICLE_CHECKPOINTS` defaults, takes a folder, or is `off`.
- **Browser:** the controls are visible; a trigger adds its events and the altered note; a refusal says why; Load year replaces the altered history with one run to that year.
- **The complete `npm run check` passes.** README documents the tools.

## Decisions and defaults

- **What a checkpoint leaves out.**
  - **Rebuilt on restore** (`src/simulation/snapshot.ts`): the geography and region partition come from the seed; the food model, field ranking, habitable land, affinities, land value and harshness are derived from them by tunables. Everything else in the state is saved as it is (the save-ready rule).
  - **Exactness:** the rebuilt parts equal the originals with the same tunables (tested).
  - **Size:** a large world's checkpoint at year 1,800 is about 2 MB gzipped.
- **A checkpoint is tied to its code and its regions.**
  - **Code hash:** taken over `src/simulation`, its tunables included, and everything it imports (`shared/simulation.ts`, `shared/generated-world.ts`, `shared/atlas.ts`, `shared/fertility.ts`, `shared/world-hydrology.ts`, `src/world/resources.ts`). Any change makes new checkpoints, and opening a world's store removes its checkpoints from other code, so a restored history is always one the current rules make.
  - **Tunables are in the hash on purpose.** At first they were left out, to keep checkpoints across tunable edits. The re-review showed that a loaded history then mixes old and new tunables, crashing or silently showing the old ones. Calibration does not need it either: fork variants are in-memory overrides on top of the committed tunables.
  - **Partition:** the checkpoint records the region partition (version, region count, a cell hash) and refuses another.
  - **Location:** checkpoints live under `.chronicle/checkpoints/<seed>-<size>/r<rules>-<code>/` (ignored by Git; `CHRONICLE_CHECKPOINTS` moves or disables the lab's, and test servers use their own folder), written atomically; temporary files an interrupted write left are removed after an hour.
- **Load year.**
  - **What it restores:** the latest checkpoint at or before the year, unless the current history is unaltered and already between that checkpoint and the year. In that case it simply runs on: histories are deterministic, so this is the same history.
  - **Keeping checkpoints:** the worker keeps one every 250 years and at the year loaded, only of unaltered histories, serialized at once and written in the background.
  - **The view:** a load starts a new epoch, so the panel reloads its chronicle.
  - **Never fatal:** a checkpoint that cannot be read or restored, or whose history fails the invariants, is set aside, and the history runs from year 0 with a short note. A checkpoint folder that cannot be used turns Load year off instead of stopping the simulation.
- **Forks run the real simulation.**
  - **Same code:** `scripts/fork.ts` calls `stepSimulation` directly in worker threads, with the invariants checked every month and once right after the restore, so the baseline is the history's own continuation (tested).
  - **Defaults:** they match the study: the large size, `--seed` or `--all`, and the per-century statistics by name (unknown names are listed and left out).
  - **Failures:** a failed run is reported with its reason, and the others still count.
- **Overrides** (on top of a checkpoint made with the committed tunables).
  - **Checks:** unknown fields (own properties only), changed types and values `validateTunables` rejects are refused. So are the food unit (stores are counted in it) and `REGION_TUNING` (the partition is built before overrides).
  - **What follows them:** overrides apply before the restore, so the derived parts follow them. Values a history stores from tunables (cultivated fields against farmland, housing, road upkeep, tax rates) keep their old values; a variant whose restored history breaks the invariants fails with that reason.
  - **Read at use:** tunables are read where they are used. The invariants' lowest harvest became a function, and an AST scan in the review found no other module-level reads.
- **Scenario triggers use the systems' own functions.**
  - **The functions:** `strikeDrought` (environment), `discover` (research), `foundReligion` and `splitCulture` (culture), extracted or exported without changing behaviour. A year-1,200 run's state and event-log hashes are identical to `89f7bbc`'s.
  - **Timing:** triggers act between months, from the first month on; before it there is no month's accounting to check. Their events are dated to the month just simulated and committed at once, and the invariants are checked after.
  - **Randomness:** each use draws from its own stream key (1,000 plus the use's number), so it never shifts the systems' streams.
  - **Split:** the parent culture is re-summarized from the people who stayed, as after a split by itself.
  - **Research:** the discovery names a sharing partner as a natural one does.
- **An altered history says so.**
  - **In the history:** each use emits a `devScenario` event before the events it causes and counts in `state.devActions`, which the state hash includes when non-zero (unaltered histories hash as before).
  - **In the frame:** `dev` gives the count, the last refusal, the saved years and the year the history was loaded from.
  - **In the panel:** a refusal shows only for the region it was refused in.
- **The four triggers:**
  - **Drought:** the longest there is (`droughtYears`), on the region and every habitable neighbour.
  - **Research:** completes the current target.
  - **Religion:** may be founded before the civilization knows Organized religion (the event says so), but only by a civilization.
  - **Split:** takes the region's people and their same-culture neighbours in the same realm. It is refused when no one of that culture would stay behind. When it takes the heartland, the realm's ruling culture follows it (the existing rule).
- **Contract:** the `scenario` and `load` controls, the `devScenario` event type (appended), the frame's `dev` record, and protocol 25. The rules version stays at 23: no released rule or tuning changed.

## Review

An independent agent reviewed the slice before Load year was added. Its findings and their resolution:

1. **High.** The Drought control at year 0 broke the invariants (no month's accounting yet) and retired the lab worker. Fixed: refused before the first month, buttons disabled at year 0, and a test.
2. **High.** Fork overrides that change what the world derives were silently ignored, and overrides whose values a history stores crashed the variant with no context. Fixed:
   - the derived parts are rebuilt on restore;
   - `REGION_TUNING` is refused;
   - invariants are checked right after the restore, with a clear reason;
   - a failed run no longer loses the comparison.
3. **Medium.** The `devScenario` text was garbled by a nested conditional. Fixed: flattened, with exact text assertions and a test that no template nests conditionals.
4. **Medium.** The code hash missed files the simulation imports, and a changed partition went unnoticed. Fixed: the import closure is hashed and the partition is recorded and checked.
5. **Medium.** One failed run lost the whole fork. Fixed: `allSettled`, failed runs in the tables, and a non-zero exit code.
6. **Low.**
   - **Split:** the parent culture went stale after a triggered split. Fixed.
   - **State hash:** every unaltered hash changed. Fixed: the counter is hashed only when non-zero.
   - **Fork options:** `--concurrency` and `--stats` were not validated, the output order was by completion, and the limiter's wait had no re-check. Fixed.
   - **UI:** a stale refusal stayed after another region was selected, and the hint was wrong. Fixed.
   - **Tests:** gaps closed: restore with overrides, a fork command run, an unconditional tribe refusal, exact texts, and year 0.

**Re-review** (after the fixes and Load year): findings 1–10 were confirmed resolved, and the Load-year write/load race, the reuse of the worker's derived parts and the epoch handling were found sound. `habitableRegions` matches `createSimulation` on every region of two worlds. New findings and their resolution:
- **A. High.** With tunables outside the hash, Load year after a tunable edit could crash the worker (stored values, or a changed partition refused outside the try) or show a history made with the old tunables. Fixed: tunables are in the hash, and a load falls back to year 0 on any checkpoint it cannot use. Tested with a damaged checkpoint.
- **B. Low–medium.** Paths built with `URL.pathname` broke in a checkout path with spaces, and a bad checkpoint folder stopped worker startup. Fixed: `fileURLToPath`, and an unusable folder turns Load year off.
- **C. Low.** A long read-failure message could exceed the frame's limit. Fixed: notes are capped at 200 characters and worded as what happened.
- **D. Low.** Tests wrote to the developer's checkpoint folder. Fixed: test servers use `test-results/checkpoints`, and in-process apps turn checkpoints off.
- **E. Low.**
  - Load year with checkpoints off paused the history first. Fixed.
  - Leftover temporary files were never removed. Fixed.
  - Errors during a fork run now carry the same hint as those found right after the restore.

## Results

- **Fork tool, measured** on the five study seeds (large, 16 threads), before the review's fixes:
  - **First run:** forking from year 1,800 for 400 years with one variant took 288 s. Making the checkpoints took 101–181 s per seed, in parallel, once per code version.
  - **Later runs:** about 100 s; the 400-year runs ran at 161–244 ms a year with up to eight at once.
  - **Compared with before:** a full five-seed 3,000-year study takes about 8 minutes per attempt and gives one setting at a time.
- **What the first measurement found:** raising `FAITH_TUNING.schismRate` from 0.02 to 0.06 left every seed's history identical to the baseline (the same hashes). From 1,800 to 2,200 no body of a religion's followers was cut off long enough to draw on the rate at all. So the rare schisms recorded in M4.4 come from bodies rarely separating, not from the rate: a finding for M5's contact rules. The comparison now says this outright ("the very same history").
- **Refactors are behaviour-preserving:** Chronicle (standard) at year 1,200 has the same state hash, event-log hash, event count and culture count as `89f7bbc`.
- **Tests:**
  - `tests/dev-tools.test.ts` has eleven tests.
  - The worker test covers a scenario through the host, a refusal, a reset, and Load year without checkpoints, with them, and with a damaged one.
  - The route test checks that malformed controls get 400.
  - The config test covers `CHRONICLE_CHECKPOINTS`.
  - The browser scenario covers the triggers, a refusal and Load year, in both projects.

## Handoff

- Revision: based on `89f7bbc` (`civ-m4`); committed on `main` with this brief.
- Last verified (7 October 2026, local): the complete `npm run check` passed: architecture, vendored artifact, types, 259/259 headless and process tests, the production build and 57/57 development and production Chromium scenarios, in 7 min 48 s. Nothing is pushed, so CI has not run.
- Open issues: none for the tooling. The schism finding goes to M5.
- Next action: M5 (decision model, diplomacy and trade), calibrating with `npm run fork` and trying features with Load year and the triggers.
