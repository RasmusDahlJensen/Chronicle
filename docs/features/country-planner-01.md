# Country planner 01 — implementation and comparison

Status: implemented and fully verified locally on 11 September; comparison awaits user review. Baseline runtime `7d3b1e9` / documentation `c7d3edf`; existing uncommitted Helara diagnosis is retained. This is a bounded algorithm/library comparison, not automatic adoption in live saves or a language migration.

Goal: compare released utility policy, hierarchical first-feasible planning and outcome-scored bounded planning on the same country mechanics. Demonstrate prospective decisions, recovery, distinct risk preferences, commitment, replanning, accounting/replay and computation costs before choosing a runtime policy. One active slice; geography, multiple countries, towns, research and diplomacy remain outside it.

Architecture: expose a narrow validated order interface to the existing daily country executor, keeping its default policy byte-for-byte behaviorally compatible. Experimental policies and their versioned sidecar checkpoint live under `scripts/planning/`; they project copies through the same daily food/work/claims/population transactions. No duplicated economic model or live-save rewrites. A pinned development-only GamePlanHTN candidate is exercised through its real decomposition API and audited for conditions, effects and rollback. Library faults must be reported and either explicitly adapted with regressions or rejected. A standalone HTML report reads the exact measured comparison output; it is not a second simulator.

Tech stack: existing TypeScript/Node 24.20.0, current simulation contracts, development-only gameplan-htn 1.0.1 (MIT). No new production runtime dependency. One reviewable feature branch in the existing shared checkout; preserve prior diagnosis files and local saves.

## Tasks and acceptance

- [x] Shared execution seam. Add `DevelopmentOrder` and optional explicit control to `src/simulation/country-development.ts`, retaining default behavior. Generate quotes internally; no caller can supply costs or free improvements. Write tests showing a legal order spends real food/work, an unfunded/foreign order fails to start, and default calls replay identically. Experimental admission allows forecast-funded spending from preferred reserves; hard accounting/ownership/workforce checks remain. Current rules 5 retain their seven-day policy when no control is supplied.
- [x] Actual planner adapter and bounded forecasts. Audit the pinned candidate on multi-step planning/backtracking. Implement `scripts/planning/` method definitions, projection, decision ranking and versioned session state. Candidate methods use existing food/logistics/claim operations and explicit waiting; no Helara-specific branch. Bound candidate count, horizon and replanning frequency by simulated work rather than wall time. Preferences smoothly price risk and delay. Preserve committed steps and reevaluate invalidated plans. Save/replay includes the sidecar plan and any policy randomness.
- [x] Reproducible scenarios and tests. Preserve Helara's observed state, rebuild its exact versioned geography, and compare identical starts. Add fertile/marginal scenarios, matched risk profiles, genuine hardship, changed conditions during a project, exact JSON save/replay and input immutability. Separate mandatory conservation tests from measured behavioral results; a library failing a capability is recorded, not hidden. The root complete gate remains mandatory.
- [x] Runnable study and browser report. Add `npm run study:planner`, committed scenario definitions and measured JSON/HTML evidence. Report trajectories, plans and alternatives, outcomes, policy evaluation counts and timings; state clearly that the live map still uses released rules. Validate report at desktop/mobile sizes and expose a direct review link without modifying the user's civilization.
- [x] Independent review, fixes, complete `npm run check`, documented reproduction commands and checkpoint. Record actual comparison findings and an adoption recommendation with limitations. Next runtime adoption requires a scoped decision based on the comparison.

Complete `npm run check` passed with exit 0 on 11 September: architecture boundaries, vendored source/artifact integrity, TypeScript, **251 headless/process tests**, production build and **165 development/production Chromium scenarios** (browser phase 6.0 minutes). No failures or skipped headless tests; this is local evidence, not a claim that CI ran. `npm ci`, `npm start` and the complete `npm run study:planner` were exercised. The only source change during the gate was explanatory report prose; syntax and exact artifact/render agreement were checked afterward. No runtime or decision semantics changed after measurement. This brief follows the workflow's single-record plan convention.


## Measured result and recommendation

`npm run study:planner` completed all fifteen branches. The [offline report](../research/game-ai/planning/report.html) and [methodology/results](../research/game-ai/planning/README.md) preserve the exact Helara input, regenerated environment digest, monthly trajectories, plans/alternatives and measured costs.

Helara after twenty further years: current policy reaches 63 claims with no investments; HTN reaches 524 claims with food/logistics 20/21; lookahead reaches food/logistics 3/3 but remains at 55 claims and accumulates 107,928 food. The productive fresh start instead gives current/HTN/lookahead 339/74/7 claims after five years. The cautious lookahead changes its first commitment from food→logistics to food alone. Both planners demonstrate productive recovery; neither establishes the long-term behavior the user wants.

Recommendation: do not adopt either unchanged. Keep the real-core execution/forecast seam and the comparison lab. The next proposed slice should establish the value of useful land and resource access versus improvement of current land, using recovery→valuable acquisition and costly-unproductive-land rejection scenarios before revising goal/scoring rules. Existing improvement effects already diminish; this recommendation means assessing their interaction with land capacity, not claiming diminishing returns are absent. No new runtime policy, learned memory, villages, research or diplomacy was introduced. Per-decision maxima reached 324.45 ms (HTN) and 238.18 ms (lookahead) in this run; no many-country capacity conclusion follows.

## Independent review and corrections

Independent core/planner review reproduced and resolved two defects with failing-then-passing regressions: explicit claim orders could be omitted by the legacy nine-item inspector cap, and malformed experimental sidecar state could silently alter/reset saved planning behavior. Explicit requested orders now bypass the display cap while retaining internally quoted work/accounting and access checks; the entire versioned sidecar and plan/project linkage are validated.

The reviewer also compared current default execution with the actual released HEAD source daily for 360 days at fertility 50 and 80, before and after the no-op frontier optimizations: complete state remained identical. Projection tests independently compare actual paid execution at each food/logistics and wait/food boundary, minimum reserve observations and mineral non-interference. Review of the measured output found no remaining material correctness issue and agreed with no unchanged adoption. The reviewer authored the isolated HTN adapter tests/projection comparison tests, not the shared executor or outcome planner under review.

GamePlanHTN's raw planning-stack read defect remains explicitly preserved in tests. The adapter is limited to fresh contexts/full plans/plan-only effects, and the library remains a pinned development candidate. HTN selection is method priority, not its displayed risk score; baseline decision traces are monthly samples, while experimental records are retained throughout. Both caveats are shown in the report.

## Review steps

1. `npm ci`, then `npm start` for the normal lab. The existing game continues to use released rules 5.
2. Open <http://127.0.0.1:5173/docs/research/game-ai/planning/report.html> (or open the HTML file directly). The report already includes the measured results.
3. Select **Helara — observed plateau**, compare **Claimed cells**, **Stored food** and **Food gathering level**, and switch **Inspect policy** to inspect actual recorded plans and forecast alternatives.
4. Select **Helara — cautious comparison** and compare its first lookahead decision with the observed-plateau case. Then inspect the fresh starts and interrupted recovery.
5. To reproduce the measurements, run `npm run study:planner`; allow several minutes. This reconstructs the fixture world and never accesses the user's active save database.

Actual desktop/mobile browser inspection passed for both offline HTML and source-served 5173. No page errors or mobile document overflow occurred. The root lab launch command was exercised; user saves were preserved. User review of the experiment remains pending.


Handoff: implementation and measured artifacts are currently uncommitted on `feat/atlas-01`, based on `c7d3edf`; preserve the earlier investment diagnosis included here. Last verified gate: 251 headless/process + 165 browser, exit 0. No known unresolved correctness finding. The behavior/performance limitations above are deliberate experiment findings; the user has not accepted either policy for runtime adoption. Next action: user review of the report and agreement on the smallest territory-value experiment, not automatic live AI replacement.
