# Country planner comparison

Run from the repository root using Node 24.20.0:

```sh
npm ci
npm run study:planner
```

Open `report.html` in a browser, or with `npm start` running visit <http://127.0.0.1:5173/docs/research/game-ai/planning/report.html>. This report is standalone and also works offline. `results.json` holds the measured data. These source report files are development evidence, not part of built production serving. The live map's policy and your saved civilization are unchanged by this experiment.

## Inputs and reproducibility

`helara.json` preserves the observed year 13/month 9 state (day 4,560), before any intervention. It uses generator 5, Chronicle / Large, history seed `5893162a-51a5-4282-852d-1209fda6d48b`, capital cell 216675, simulation protocol 6/rules 5. Regenerated environment SHA-256 is `250b874f0a814b94b8e3a3b0c3c970a02cd204e424a98e6086f8d590bae8678f`, matching the originally persisted environment. The real-world regression protects that exact identity. The script does not depend on `/tmp` diagnostics or read the active SQLite database.

All three branches begin from an identical copy within a scenario. The primary Helara case runs twenty further years; a matched more-cautious case and two contrasting founding locations run five, and an authored interruption runs three. The interruption removes food potential/sites for thirty days starting thirty days into the comparison, then restores them. Forecasts learn of changed conditions only when the study supplies them; they do not know the future recovery schedule. This is a controlled stress scenario, not a weather feature. Monthly state points and actual decision records are retained. Current-policy decisions are sampled at month end, while experimental decisions are retained throughout; decision counts and gaps cannot be compared. Full trajectories rather than just final territory should guide interpretation.

Timings and generation timestamps can vary. Logical decisions and state progression must replay with the same rules, inputs and planner settings. Automated checks compare daily/monthly/JSON continuation, complete physical forecast/execution state at operation boundaries, minimum reserves, conservation, unknown minerals and cancelled work. Renderer checks use explicit viewer-only fixture data and cannot establish AI quality.

## What is actually compared

- **current**: released rules 5 utility policy and existing concurrent project allocator, unchanged.
- **htn**: actual GamePlanHTN decomposition chooses the first feasible ordered method. It does not optimize the displayed outcome score or respond to the extra risk-aversion experiment setting.
- **lookahead**: enumerates the same bounded methods, evaluates their consequences and selects the highest-scoring evaluated outcome. It is not unrestricted GOAP/MCTS or a learned policy.

The nine-or-fewer authored alternatives combine food improvement, logistics, up to two candidate claims and thirty-day saving/waiting steps. They contain at most two operations. The package adapter independently supports a hard maximum of twelve methods and three steps. This prototype executes a committed sequential plan; current policy can allocate concurrent work, so whole-policy outcomes are compared rather than claiming an isolated algorithm-speed experiment.

Both planning arms project the actual daily economy, using internally quoted costs, worker allocation, cancellations, demography, upkeep, spoilage and canonical claims. Preferred reserves are a soft scoring consideration; the study still requires available food/work to fund projected construction. The current policy's preferred reserve and seven-day continuation guards remain unchanged. No free improvements, fabricated people, newly known minerals or writable forecast copies enter the live world.

Default lookahead uses 180 days and at most 2,400 projected simulation days per review. Shared prefixes are cached within a decision; unused forecasts are not rerun during committed execution. Only completed evaluated outcomes are eligible; exhausted search falls back to a dated wait. The objective combines changes in stored food per person, terminal daily surplus valued over another 180 days, logarithmic population/territory benefit, starvation cost, and a squared deficit below preferred reserves. This is an explicit provisional heuristic, including a terminal-value assumption beyond the simulated horizon. The exact implementation is `scripts/planning/planner.ts`; scored plans, lowest reserves and endpoint net food appear in the report. A higher score does not establish optimal historical behavior.

Risk penalty defaults to 1; the matched cautious comparison uses 10, changing only that weight for lookahead. No monthly personality rerolls occur. The experiment demonstrates consequence-sensitive selection and plan persistence; it does not implement uncertainty distributions, learning from experience, social factions, research, villages or diplomacy.

## Library assessment

Pinned `gameplan-htn` **1.0.1** (MIT) and transitive `loglevel` are recorded in the root lockfile as development dependencies. It is a JavaScript port of [Fluid HTN](https://github.com/ptrefall/fluid-hierarchical-task-network); see [GamePlanHTN](https://github.com/TotallyGatsby/GamePlanHTN) and [the planning reference](https://www.gameaipro.com/GameAIPro/GameAIPro_Chapter12_Exploring_HTN_Planners_through_Example.pdf). No C# runtime or live package adoption is introduced.

The raw package pushes planning changes but reads the oldest stack entry. An actual repeated-spending probe can accept an overdrawn plan. `scripts/planning/htn.ts` narrowly overrides that context read to use the newest planning entry and uses isolated snapshot IDs for real-core transitions. Tests preserve the raw defect, verify repeated spending and branch rollback with the adapter, and repeat decisions/replanning. Package source is untouched. Only fresh contexts, full decompositions and plan-only effects are used; partial plans and permanent effects are outside the adapter's guarantees. The planner has no TypeScript declarations; a small typed boundary contains that untyped API. These restrictions matter to any adoption decision.

## Verification and interpretation

The fifteen runs completed on 11 September. Helara starts with 313 people, 55 claims and no investments. After twenty further years:

| Policy | Population | Claims | Food / logistics levels | Stored food | Whole run |
| --- | ---: | ---: | ---: | ---: | ---: |
| Current | 369 | 63 | 0 / 0 | 11,092 | 9.59 s |
| HTN | 453 | 524 | 20 / 21 | 62,268 | 80.51 s |
| Lookahead | 459 | 55 | 3 / 3 | 107,928 | 48.80 s |

Both experimental arms escape the initial investment trap, but neither is ready for unchanged adoption. HTN repeatedly prioritizes its first feasible authored method. Lookahead recovers production and then favors waiting/food accumulation over expansion. At the productive fresh start, five-year claims are 339 / 74 / 7 respectively: there is no universal territorial winner. All fifteen branches record zero starvation deaths; this does not establish universal survival, and separate prolonged-deprivation tests exercise project failure and hardship.

The first lookahead plan changes from food→logistics to food alone when risk aversion changes from 1 to 10. The projected lowest reserve rises from 17.25 to 21.92 days. Actual trajectories also diverge. HTN does not use this extra risk parameter for selection. During the authored interruption, plans encounter real affordability/access changes and reassess their next step; the report includes those records rather than promising uninterrupted success.

Costs depend on the evolving country. Helara HTN projects 88,380 days versus lookahead’s 333,450, yet takes longer because its territory grows much larger. Across these runs the measured maximum individual decision is 324.45 ms for HTN and 238.18 ms for lookahead. Do not extrapolate these single-country observations into a 1,000-country capacity claim or an isolated library benchmark. An early slower run was stopped after identifying repeated unnecessary frontier work; the committed results come from the subsequent complete run, with default-state equivalence rechecked independently.

Recommendation: retain the shared executor, bounded projection/replay checks and browser comparison. Before live adoption, establish why acquiring a valuable reachable site is preferable after recovery, and why expensive unproductive land is rejected. Productive land capacity/resource access, diminishing improvement returns, persistent goals and the valuation horizon need a focused comparison. A different planner library cannot supply those game incentives by itself. This next experiment is proposed, not implemented.

Only explanatory prose and the final renderer were refreshed after measurement; trajectories, scores, choices and timings were retained. `docs/features/country-planner-01.md` records the final gate, review and checkpoint. User review of the comparison remains pending.
