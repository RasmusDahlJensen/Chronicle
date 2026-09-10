# Chronicle development workflow

## Current stage and agreed direction

As of 10 September 2026, **Worldgen 01’s plate-generated landmass replacement is implemented and awaiting user visual review**, recorded in `docs/features/worldgen-01.md`. The user explicitly chose a complete replacement with all checks passing after reviewing the external-library tradeoff. A pinned Platec WebAssembly core now runs inside the existing workers, with deterministic refinement, preserved textures, and additional lifecycle/reload/projection regressions. Independent review found no remaining material issues. The complete local gate passed: artifact integrity, architecture, types, 115 headless tests, build and 83 development/production browser scenarios. The brief records the final measurements and exact running review URL. The generated world remains the default browser view; Verdant and Aster remain regression studies. Hosted persistent worlds, gameplay simulation and remote access remain later slices.

The province design remains agreed and unimplemented: countries create provinces around settlements; a founding capital also centers the first province; other provincial capitals and ordinary towns develop later. Successful provincial-capital capture immediately transfers province ownership, while surviving defenders can retain military control of cells. The user chose world generation before the proposed founding-country slice. Generated unclaimed geography has no political province membership; the retained Verdant fixture still exercises its province → cell → province click cycle and resource summaries.

The user has chosen small, gradual feature delivery and a **browser lab with repeatable scenarios, visual inspection, and automated checks**. Chronicle is expected to become a substantial project: small slices describe delivery size, not a small-system assumption. The user authorizes necessary local packages and tools for maintainability and future growth. The lab grows alongside Chronicle; the active brief defines current implementation and verification, including refinements to its architecture checks.

`CHRONICLE_SPEC.md` defines product behavior. This document defines how we work. Recent explicit user instructions take precedence; proposed defaults in the spec remain proposals.

## One active slice

A milestone is a destination, not a single coding task. Each slice delivers an observable outcome that can be tried and assessed on its own, with foundations designed for the larger product. Consider large world datasets, high entity counts, long histories, and multiple independent worlds when choosing contracts and representative verification workloads; do not invent capacity promises from the current fixture.

- Keep one active feature brief. Park unrelated ideas in its follow-up list.
- Name the smallest useful outcome, acceptance checks, and exclusions before coding.
- Split work that adds several independently testable behaviors or needs multiple new systems at once. Identify required foundations explicitly.
- Complete the authorized slice, its checks, and its review before starting another. Do not automatically implement the next roadmap item.
- Within that scope, make routine reversible implementation choices without repeated permission requests. Discuss consequential behavior or data-contract changes before doing dependent work.
- Adopt established libraries and tools for a concrete purpose rather than rebuilding infrastructure solely to avoid dependencies. Necessary local package/tool installation is authorized without additional approval. Check maintenance, license, runtime compatibility, operating and migration costs, and actual behavior; pin versions, update the lockfile, and preserve the documented setup commands.
- Keep world rules, transport, rendering, compute ownership, and persistence separate so growth can change their implementation without mixing responsibilities. Introduce extra services when requirements justify them; plan and verify any process or storage migration explicitly.

## Feature cycle

1. **Discover:** clarify the remaining user need, constraints, and smallest valuable outcome. Reuse established product decisions instead of repeating discovery.
2. **Write the brief:** record intended behavior, non-goals, assumptions, and unresolved decisions. Use the short template below.
3. **Define scenarios:** describe what we should see in a normal case, a relevant boundary case, and a failure case where applicable. Separate correctness from desired balance.
4. **Plan and agree:** list small tasks, affected areas, and verification steps in the same brief. Present concrete scope for implementation; a request to plan does not authorize building.
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

## First lab slice

The original brief, `docs/features/atlas-01.md`, records the minimum world-data and rendering contracts for displaying and resetting one small authored terrain fixture. The React migration preserves those behaviors and shared modules. Full M0 and M1 gates remain incomplete.

Acceptance checks:

- The labeled fixture renders its expected cells and terrain without errors.
- Reset reconstructs the same initial world data and restores the initial view.
- An automated fixture/reset check passes, and browser inspection confirms the rendered result.

This validates the basic development loop. It does not validate seeded generation or simulation determinism. Atlas 02 adds connected province grouping; Resources 01 adds sparse sites and province → cell inspection for the authored study. Procedural geography, country-level selection, population, economy, warfare, and time progression require later scoped work. All M1 milestone gates still apply before declaring M1 complete.

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

Use extra architecture notes only for durable decisions shared across features. Keep the current status here until a roadmap file adds value.

## Verification proportional to the change

Use focused invariant/scenario tests for simulation behavior, browser interaction checks for UI behavior, and benchmarks for performance claims. Do not add tests that merely restate implementation or run expensive seed suites for documentation or cosmetic changes. Broaden checks when core interactions, balance, failures, or milestone gates justify it.

Report correctness, visual/user experience, balance, and performance separately. Record actual commands and results; mark untested behavior honestly. Run `npm ci` to install locked dependencies, `npm start` to view the lab, and `npm run check` for the complete iteration gate. `npm run test:browser` independently builds and runs the Chromium scenarios. The root README records runtime and browser setup; the active brief records actual results.
