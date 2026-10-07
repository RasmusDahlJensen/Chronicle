# Chronicle development workflow

## Current stage and agreed direction

**Active run: the civilization vision.** On 1 October 2026 the user asked to remove everything to do with civilizations. The civilization runtime (tribes, settlements, countries, decision AI and planner research, the simulation server, saves/SQLite and civilization identity), the authored regional atlas study and the original terrain lab were removed. The civilization briefs and research notes were removed with them; the briefs of the authored studies remain as historical records. The local branch `archive/civilization-v1` keeps the removed work as reference only; it does not bind future design.

The product is the accepted geography baseline: the seeded generated-world page with plate-generated landmasses ([Worldgen 01](features/worldgen-01.md)), rivers and lakes ([Hydrology 01](features/hydrology-01.md)) and natural fertility ([Fertility 01](features/fertility-01.md)), together with annual climate, biomes and sparse resource sites. The same day the user and Claude agreed [VISION.md](VISION.md), which defines the game and its civilizations and authorizes one run: G1 (failing seeds, tin and oil), M0, M1, M2, a stop for user review, then M3, M3b, P and M4–M9. For that run, its agent rules 1–2 replace the per-slice user review (feature cycle step 6) and the joint choice of the next slice (step 7): each verified slice is recorded in its brief as verified and awaiting user review, and the run continues, stopping only after M2 and at the stop conditions VISION.md lists. Work is committed directly on `main` with milestone tags and is not pushed.

Run progress (2 October 2026; verified slices await user review with the rest of the run): [G1](features/g1.md) (`civ-g1`), [M0](features/m0.md) (`civ-m0`), [M1](features/m1.md) (`civ-m1`) and [M2](features/m2.md) (`civ-m2`) are verified. The user reviewed M2 with two requested changes (peoples' territories on the map; tribes whose splits mostly stay together and settle as one civilization, recorded in the M2 brief) and approved it on 2 October 2026. M3 is active, delivered as slices [M3.1](features/m3-1.md) (knowledge of the world), [M3.2](features/m3-2.md) (decisions, expansion and migration), [M3.3](features/m3-3.md) (joining and stability) and [M3.4](features/m3-4.md) (peaceful unification, added at the user's request after the M3.3 stop) are verified. With unification every seed has 38–45 civilizations at year 1,000. The user decided the open questions on 2 October 2026 (borders: the 1.5× target moved to M6; settling by scale kept; discoveries where the people drawn to them live), all recorded in VISION.md. M3 is complete and tagged `civ-m3`. After reviewing M3 the user asked that research follow different paths per people, with no automatic learning from neighbours, a small catch-up bonus and chosen knowledge sharing: slice [M3.5](features/m3-5.md) is verified and committed. On 6 October 2026 the user approved M3.5 and asked to finish M3 entirely, that is M3b (settlements and infrastructure, delivered as slices M3b.1–M3b.7 with their own briefs), and to stop for their approval before moving on. The run stops after M3b is tagged `civ-m3b`; VISION.md's order puts P (persistence) before M4, which is put to the user at that stop. [M3b.1](features/m3b-1.md) (settlements, tiers, townspeople and housing) is verified and committed; [M3b.2](features/m3b-2.md) (wealth and buildings) is verified and committed; [M3b.3](features/m3b-3.md) (mines, quarries and harbors) is verified and committed; [M3b.4](features/m3b-4.md) (wonders) is verified and committed; [M3b.5](features/m3b-5.md) (roads and bridges) is verified and committed; [M3b.6](features/m3b-6.md) (harvests, droughts, famine and irrigation) is verified and committed; [M3b.7](features/m3b-7.md) (cultivated land) is verified and committed, and the M3b close-out (a performance pass, the review package, the independent milestone review; recorded in the M3b.7 brief) is done: M3b is complete and tagged `civ-m3b`. The user reviewed M3b on 6 October 2026. Their answers, recorded in VISION.md, defer P (persistence) until they ask for it, keep the state save-ready and relax the speed budget, and add milestone M3c (economy, famine relief and empire strain), after which the run stops for their review before M4. [M3c.1](features/m3c-1.md) (steady tiers, wonders known by word, save-ready state) was committed as a checkpoint with one gate open (Chronicle's border ratio at 1,000); [M3c.2](features/m3c-2.md) (the wealth system) is verified and committed and closes that gate; [M3c.3](features/m3c-3.md) (famine relief and better storage) is verified and committed; [M3c.4](features/m3c-4.md) (empire strain) is verified and committed, and the M3c close-out (the review package, the independent milestone review; recorded in the M3c.4 brief) is done: M3c is complete and tagged `civ-m3c`. The user reviewed M3c on 7 October 2026 (recorded in VISION.md): neglect must be visible (slice [M3c.5](features/m3c-5.md), verified and committed). [EMPIRES_RESEARCH.md](EMPIRES_RESEARCH.md) records how historical empires rose and fell; the user kept the planned order and the findings are recorded as requirements of M6 and M7, including rulers who differ and are replaced as in reality. M4 (culture and religion) is active, delivered as slices: [M4.1](features/m4-1.md) (living cultures) is verified and committed; [M4.2](features/m4-2.md) (assimilation, hybrids and traits) is verified and committed; [M4.3](features/m4-3.md) (faiths) is verified and committed; [M4.4](features/m4-4.md) (schisms and the secular age) is verified and committed, and the M4 close-out (the review package and the independent milestone review, recorded in the M4.4 brief) is done: M4 is complete and tagged `civ-m4`. The run continues with M5 (decision model, diplomacy and trade). Each brief records its revision, last verified result, open issue and exact next action; this paragraph names only the active slice. Nothing is pushed, so CI has not run.

The user has chosen small, gradual feature delivery and a **browser lab with repeatable scenarios, visual inspection, and automated checks**. Chronicle is expected to become a substantial project: small slices describe delivery size, not a small-system assumption. The user authorizes necessary local packages and tools for maintainability and future growth. The lab grows alongside Chronicle; the active brief defines current implementation and verification, including refinements to its architecture checks.

`CHRONICLE_SPEC.md` records the accepted geography requirements; `VISION.md` is the source of truth for the game and its civilizations, and older briefs, research notes and the archive branch never override it. This document defines how we work. Recent explicit user instructions take precedence; proposed defaults in the spec remain proposals.

## One active slice

A milestone is a destination, not a single coding task. Each slice delivers an observable outcome that can be tried and assessed on its own, with foundations designed for the larger product. Consider large world datasets, high entity counts, long histories, and multiple independent worlds when choosing contracts and representative verification workloads; do not invent capacity promises from the current workload.

- Keep one active feature brief. Park unrelated ideas in its follow-up list.
- Name the smallest useful outcome, acceptance checks, and exclusions before coding.
- Split work that adds several independently testable behaviors or needs multiple new systems at once. Identify required foundations explicitly.
- Complete the authorized slice, its checks, and its review before starting another. Do not automatically implement the next roadmap item, except within the run VISION.md authorizes, which continues to the next slice and stops only where its rule 2 says.
- Within that scope, make routine reversible implementation choices without repeated permission requests. Discuss consequential behavior or data-contract changes before doing dependent work.
- Adopt established libraries and tools for a concrete purpose rather than rebuilding infrastructure solely to avoid dependencies. Necessary local package/tool installation is authorized without additional approval. Check maintenance, license, runtime compatibility, operating and migration costs, and actual behavior; pin versions, update the lockfile, and preserve the documented setup commands.
- Keep world rules, transport, rendering, compute ownership, and persistence separate so growth can change their implementation without mixing responsibilities. Introduce extra services when requirements justify them; plan and verify any process or storage migration explicitly.

## Feature cycle

1. **Discover:** clarify the remaining user need, constraints, and smallest valuable outcome. Reuse established product decisions instead of repeating discovery.
2. **Write the brief:** record intended behavior, non-goals, assumptions, and unresolved decisions. Use the short template below.
3. **Define scenarios:** describe what we should see in a normal case, a relevant boundary case, and a failure case where applicable. Separate correctness from desired balance.
4. **Plan and agree:** list small tasks, affected areas, and verification steps in the same brief. Present concrete scope for implementation; a request to plan does not authorize building. Within the VISION.md run, its authorization is the agreement: record the plan in the brief and build without waiting (its rules 2 and 6).
5. **Build and check:** implement that slice using shared application code. Run focused automated checks and exercise affected browser behavior. Reproduce failures before changing rules or tuning.
6. **Try and review:** provide a consistent review package: what changed, the exact launch command, scenario, steps, expected behavior, checks performed with actual results, and remaining limitations. The user tries the interaction; until then, record it as awaiting user review. Passing automated checks does not establish that the experience feels right.
7. **Maintain the record:** update status and durable decisions, remove stale tasks, and preserve a working Git checkpoint for accepted work. Improve workflow rules when repeated friction demonstrates a need; keep them short and practical. Choose the next slice together.

Task authorization covers its necessary verification and routine fixes. A new approval is for changed scope or the next slice, not every implementation step.

## Reliability when working with AI

- **Resume from evidence:** at task startup, inspect the working-tree changes and relevant files, then reconcile them with the active brief. Distinguish intended behavior from implemented behavior and pre-existing failures. Before stopping or handing off, update the brief with the current revision and uncommitted work, last verified result, unresolved issue, and exact next action. Keep this in the brief rather than a separate session log.
- **Make verification reproducible:** keep the supported runtime and dependency lockfile pinned. `npm run check` runs the complete iteration gate, including architecture/types, headless tests, build, and development/production browser checks. GitHub CI runs that same command. Record the tested revision, any uncommitted changes, scenario/configuration, and actual results; distinguish local execution from CI execution.
- **Expand checks each iteration:** add or update tests for every changed behavior and the module/process connections it affects. Capture each reproduced bug in a regression that fails before the fix. During implementation, use focused tests for quick feedback; before each implementation handoff, run the complete `npm run check` and resolve all failures. Preserve existing acceptance checks, with no skipping or weakened assertions to obtain a pass.
- **Exercise changes during a running session:** a fresh launch alone cannot verify development reloads. Run source-edit regressions against isolated copies of real modules, including worker imports, transport, and the open browser tab. Keep live source and user data untouched by tests, and check that test artifacts do not disturb the open lab; verify process cleanup and recovery after invalid edits.
- **Check architecture as it grows:** `npm run check:architecture` runs the targeted Biome import/dependency rules and is part of `npm run check`. Update its layer boundaries alongside new modules. Static import checks do not detect every computed module path, global API dependency, or runtime ownership problem; retain independent review and appropriate behavioral tests.
- **Keep launch instructions current:** README is the canonical PC setup and run guide. Update it in the same change as prerequisites, commands, ports, configuration, or verification steps, and run the affected instructions before handing off. Keep first setup and everyday launch simple: `npm ci`, then `npm start`.
- **Verify the running review:** check the map and API at the exact URL offered to the user. When backend changes leave an existing stateless lab running an older version, restart it within the authorized task and verify that address before handoff; preserve meaningful user state when later persistence exists.
- **Protect acceptance criteria:** derive checks from agreed behavior and invariants. Never skip failing scenarios, weaken assertions or tolerances, or replace expected results merely to obtain a pass. If an expectation is wrong or the intended behavior changes, explain the evidence and resolve the change explicitly. A population-accounting failure cannot be fixed by increasing the permitted error.
- **Review consequential changes independently:** use a second agent to examine the brief, code changes, and tests for missing cases, incorrect assumptions, and regressions. Give it the evidence to assess the work directly. Resolve material findings before presenting the slice as ready; if independent review is unavailable, record that gap. The user still judges the behavior in the lab. Routine documentation and cosmetic changes need only a proportionate review.
- **Recover from unsuccessful fixes:** when repeated fixes produce no new evidence, return to diagnosis. Preserve the failing scenario, isolate the cause, record what was tried, and reconsider the assumption before making another change. Avoid accumulating speculative patches. Keep a known working Git checkpoint and preserve unrelated user work when backing out a failed attempt. Continue diagnosis within the authorized slice; discuss any necessary scope change before proceeding with it.

## Browser lab

The lab is a local development view in the same repository. Scenario setup supplies fixtures, seeds, and configuration to the same world/simulation modules used by Chronicle. Visual scenarios use the shared atlas renderer; automated scenarios run shared logic without requiring the UI. Do not duplicate mechanics inside the lab.

Start with one named scenario. Add controls and diagnostics when a feature needs them:

- Reset to a known starting state; show the scenario and relevant configuration.
- Inspect the map and the few values needed to understand the active feature.
- When simulation stepping exists, add pause and single-step controls tied to committed steps.
- Show explicit check results and observed outcomes. Unsupported checks must say so.
- Preserve enough context to reproduce failures: scenario/fixture or seed, rules/configuration version, and step/date when applicable. Add saves and event traces when those capabilities exist.

Development setup controls do not add player management or god tools to the observer product. A handcrafted fixture must be labeled as such; it cannot demonstrate that procedural generation works.

Keep the lab small. A scenario builder, plugin system, general debug dashboard, automated parameter search, and replay editor are outside the initial design. Prefer a few explicit scenarios over a framework built in anticipation.

## Earlier lab slices

The first slices validated the basic development loop on authored fixtures ([Atlas 01](features/atlas-01.md), [Atlas 02](features/atlas-02.md), [Resources 01](features/resources-01.md)); those authored studies were removed on 1 October 2026, so their briefs are historical. Seeded geography, starting with [Worldgen 01](features/worldgen-01.md), is the current baseline.

## Minimal feature brief

Keep this in one file when the first slice is defined; do not create empty documents for every future milestone.

```text
Feature / milestone / status:
Observable outcome:
Relevant spec sections and agreed decisions:
Scenario, inputs, and expected result:
Boundary/failure cases and invariants:
In scope / out of scope:
Small tasks, affected areas, and dependencies:
Verification and how the user will try it:
Results, known gaps, and user review:
Handoff: revision/uncommitted work, last verified result, unresolved issue, next action:
Follow-up ideas:
```

Record durable decisions shared across features in `docs/ARCHITECTURE.md`; keep the current status here and in the active brief. Do not add separate roadmap, progress or decision files (VISION.md rule 1).

## Verification proportional to the change

Use focused invariant/scenario tests for simulation behavior, browser interaction checks for UI behavior, and benchmarks for performance claims. Do not add tests that merely restate implementation or run expensive seed suites for documentation or cosmetic changes. Broaden checks when core interactions, balance, failures, or milestone gates justify it.

Report correctness, visual/user experience, balance, and performance separately. Record actual commands and results; mark untested behavior honestly. Run `npm ci` to install locked dependencies, `npm start` to view the lab, and `npm run check` for the complete iteration gate. `npm run test:browser` independently builds and runs the Chromium scenarios. The root README records runtime and browser setup; the active brief records actual results.
