# Working on Chronicle

Read `docs/WORKFLOW.Md`, `docs/ARCHITECTURE.md`, the relevant sections of `docs/CHRONICLE_SPEC.md`, and the selected feature brief, currently `docs/features/dev-01.md`. Atlas 02 and earlier backend, React, and terrain slices remain recorded in `docs/features/`. Use the actual filenames; `docs/GAME_DESIGN.md` does not currently exist.

## Scope and collaboration

- At task startup, inspect working-tree changes and relevant files; reconcile them with the active brief instead of assuming its status is current.
- Follow the current stage and authorized scope in the workflow; update the recorded stage when that changes. Dev 01 is implemented and verified: automatic development restarts and connected regression checks are part of the complete iteration gate. Atlas 02 remains implemented and awaits visual user review. Hosted simulation, independent user worlds, and saves remain later slices.
- Keep one active slice with an observable outcome and concrete acceptance checks. Do not treat a whole milestone or the full specification as one task.
- Design for Chronicle as a substantial, growing game. Small slices govern delivery size; they do not justify throwaway architecture, fixture-sized data assumptions, or rebuilding established infrastructure by hand.
- The user authorizes installing and configuring packages and local development tools needed for the approved work and its long-term foundation. Evaluate purpose, maintenance, licensing, runtime compatibility, operational cost, and migration impact; verify that the tool actually works here and commit the lockfile.
- Complete authorized work and its verification autonomously. Ask about consequential scope or contract changes, not routine reversible choices.
- Prepare a runnable review with exact steps. Do not start the next feature automatically; record when user testing is still pending.
- Keep documentation proportional. Update existing records and improve rules in response to repeated friction; avoid duplicate plans, speculative frameworks, and unrelated refactoring.
- Use parallel agents only for independent, bounded work with clear ownership. Keep coupled simulation contracts coordinated.

## Implementation rules, once authorized

- Share world and simulation modules between the browser lab, the observer application, and automated scenarios. Never build a second simulation for tests.
- Keep browser, renderer, shared core/contracts, HTTP, and compute dependencies separated. `npm run check:architecture` enforces current import rules through Biome; extend those rules and their negative scenarios when adding new module boundaries. Keep runtime verification for globals, worker entrypoints, and behavior beyond static imports.
- Keep simulation state independent of rendering and browser APIs. Preserve seeded, reproducible stepping and explicit population/resource accounting.
- Keep cells, provinces, sovereignty, occupation, and habitation distinct. Use canonical transfer and lifecycle operations; preserve stable IDs and historical identity.
- Do not substitute decorative statistics, cosmetic ownership changes, or silent accounting exceptions for missing mechanics.
- Label test fixtures and development controls clearly. They do not change Chronicle's observer-only product scope.

## Verification and handoff

- Add or update regression tests for each changed behavior and its module/process connections. During implementation use focused checks; before every implementation handoff, run the complete `npm run check` and resolve failures. Record actual results; browser/build/headless results establish different things, and local checks do not imply CI ran.
- Protect agreed acceptance criteria: do not skip failures, weaken assertions, or replace expected results merely to get a pass. Explain and resolve any necessary expectation change explicitly.
- For failures, preserve the scenario and reproducible inputs before fixing behavior or balance. If repeated fixes yield no new evidence, return to diagnosis rather than stacking speculative patches. Broaden testing when evidence or milestone gates require it.
- Obtain independent agent review for consequential code changes and resolve material findings; record a gap if that review is unavailable. Follow the workflow's review package when handing the slice to the user.
- Before stopping or handing off, update the active brief with revision/uncommitted work, last verified result, unresolved issue, and exact next action. Preserve working checkpoints and unrelated user changes.
- Keep README accurate in the same change whenever prerequisites, installation, launch commands, ports, configuration, or verification steps change. Run affected documented commands before handing off. Keep everyday setup and launch simple: `npm ci`, then `npm start`.
- Use Node 24.20.0 and `npm ci` with the committed lockfile. `npm start` starts the watched local lab; `npm run check` includes architecture, types, headless/process tests, production build, and development/production Chromium scenarios. Install Chromium with `npx playwright install chromium`. GitHub CI uses the same complete gate; see README for setup and diagnostics.
