# Country investment 01

Status: implemented and fully verified locally; user review of pacing is pending. Baseline `a575776`. The user rejects current expansion pacing and approves extending utility AI with productive investments and a shared project budget. One active slice; no villages, research, war, trade, diplomacy or 1,000-country runtime yet. That larger competitive world is the long-term benchmark, not a claim about this iteration.

Outcome: prosperous countries invest actual food and work into better food gathering and logistics, support multiple funded projects, and expand materially faster while poor countries remain constrained. Retain one capital, real connected claims, seeded decisions, demographics, daily stepping and host persistence. Compare identical geography/history and founding endowments with released rules 4.

## Design and provisional balance

New/reset monthly games use protocol 6 / rules 5. Earlier protocols 1–5 remain readable and retain their behavior. Add a versioned `development` record to the existing country state: completed food/logistics levels, paid investment ledger, bounded ongoing projects with saved costs/durations/workers/progress/IDs, shared reservation totals and bounded outcome history. The existing AI record retains seeded strategic choice; ongoing project records own actual reservations and work independently of strategic reconsideration. Population remains real people, food remains person-days. No prosperity score grants free output or ownership.

Food investment improves the efficiency of gathering on currently owned usable land; it does not invent farms, mining or technology. Logistics investment improves effective travel reach and reduces support effort for sparse claims. Investments have rising costs and persistent effects; all completion costs are paid exactly once. Light frontier claims have lower area support than developed settlement land (which is still deferred), and paid preparation is shorter than rules 4. Actual ongoing food/labor coverage constrains expansion instead of the fixed 25%-of-workforce claim ceiling. Geography and unavailable mineral knowledge still constrain choices.

Use existing utility choice and weighted frontier search. Bounded greedy allocation considers benefits/urgency and shared affordability, keeps feasible funded work, and accounts for combined future claim upkeep and the full portfolio's remaining work deficit. Active work protects a safety reserve; new starts honor the country's reserve preference. No duplicated workers or food reservations. Cancel unsupported projects deterministically, release their unspent reservations, preserve sunk worker-days, and never retain invalid foreign/water/disconnected targets. Extend existing daily food/demographic transactions rather than writing a second simulator. Headless/worker/browser all use the same modules.

## Plan / acceptance

- [x] Observe failing tests for new paid investment, concurrent allocation and materially faster five-year expansion versus released rules 4.
- [x] Implement versioned contracts, shared daily transaction/economy reuse, utility opportunities and bounded allocator; preserve earlier rules.
- [x] Show investments, effects, active projects, progress, shared reservations and reasons in the browser. Keep terrain and existing controls.
- [x] Protect conservation, starvation/cancellation, foreign target exclusion, deterministic batch/reload/reset, malformed saves, old rules and actual worker/SQLite rollback/restart.
- [x] Compare prosperous/marginal/poor conditions and real seeded geography over years. Require several-fold larger supported territory in fertile baseline rather than merely more decision records. Record measured outcomes and limitations.
- [x] Independent review, resolve findings, complete `npm run check`, actual localhost 5173 inspection, README and checkpoint update.

## Balance implemented

All values are provisional and versioned as rules 5. Claim supplies cost 35% of the previous terrain/distance quote, with six workers and `ceil(5 + sqrt(cell area km²) / 12 + route distance / 150)` work days (candidates over 360 days are excluded). Base sparse-claim support is 18% of rules 4's terrain effort. This is explicit pacing tuning in addition to productive investment; the measured improvement must not be attributed solely to investment.

For target level L, food improvements cost `ceil(2000 × L^1.35)` food with twelve workers for sixty days. Logistics costs `ceil(1500 × L^1.4)` with ten workers for forty-five days. Food gathering gains `18% × sqrt(food level)`; travel reach becomes `1 + 0.35 × logistics level`; sparse support effort becomes `0.18 / (1 + 0.4 × logistics level)` of the old base. Concurrent capacity is `min(8, 2 + floor(logistics level / 2))`. Paid effects apply only at completion. Slots do not guarantee starts: combined affordability and useful opportunities still apply. New work honors seeded reserve preference, while existing work protects seven days of food plus remaining work costs.

## Evidence and review

The new ten-test headless suite first reproduced missing investment state and insufficient five-year growth. Later preserved regressions caught double-budgeting a completed day of work, inconsistent saved worker totals/backdated progress, idle slots held by a long consolidation review, and cancelling useful food investment before the claim that caused the budget deficit. Fixes reconcile active/completed/cancelled work and preserve useful affordable work. Full-slot days skip unnecessary opportunity searches.

An independent agent that did not author the simulation reviewed core contracts, accounting, cancellation, compatibility and worker integration. Its material findings about remaining work and save validation were fixed with failing-then-passing regressions; final review reported no unresolved material findings. The architecture gate also caught a type-only contract cycle; moving cross-state validation into the existing simulation contract resolved it without weakening the rule.

Earlier behavioral assertions are retained in explicit protocol 5/rules 4 and protocol 4/rules 3 fixtures. Current-flow tests now assert protocol 6/rules 5 and subtract real investment spending in the food ledger. Browser coverage includes a persisted growth save continuing identically before explicit reset upgrades it. Actual worker tests exercise paid levels and active projects through restart and failed SQLite commit/retry. The real-world growth regression compares identical founding conditions under the released and new rules. No assertion was removed merely to make new pacing pass.

`npm run study:country` completed eight ten-year runs, using identical geography/history/origin/endowment for each old/new pair. Claims after five years:

| World | Resolution | History seed | Rules 4 | Rules 5 |
| --- | --- | --- | ---: | ---: |
| Chronicle | Standard | Growth review 1 | 7 | 84 |
| Chronicle | Standard | Growth review 2 | 7 | 85 |
| Chronicle | Large | Growth review 1 | 27 | 339 |
| Chronicle | Large | Growth review 2 | 12 | 58 |
| Elsewhere | Standard | Growth review 1 | 7 | 70 |
| Elsewhere | Standard | Growth review 2 | 4 | 23 |
| Elsewhere | Large | Growth review 1 | 19 | 90 |
| Elsewhere | Large | Growth review 2 | 28 | 352 |

The first large Chronicle scenario reaches 431 cells and 305 people after ten years, with food level 2, logistics level 4 and 29,989 food spent on improvements. Some less productive starts buy no improvements and settle into smaller supported footprints. Matched synthetic fertile/marginal comparisons, zero-food collapse and unknown-mineral invariance are automated separately. Real-world study timing ranged from about 2.3–29.8 seconds per ten years on this machine, before the final full-slot opportunity-search optimization. These observations are neither calibrated historical rates nor a 1,000-country capacity test. Later growth still slows as available support and population constrain expansion; this slice does not guarantee that a handful of winners will conquer the planet.

Actual `http://127.0.0.1:5173/` inspection used an isolated browser context, Chronicle/Large, history `Growth review 1`, random placement and sixty real monthly button clicks. It confirmed rules 5, 339 claimed cells, food/logistics levels 2/4, a connected visible border and one capital. Desktop/mobile investment panels showed actual spending, work and progress; mobile had no horizontal overflow and the browser reported no uncaught errors. Screenshots were visually inspected under `test-results/manual-country-investment/` (ignored local artifacts). Existing user-selected saves were not replaced.

## Review steps and checkpoint

1. Run `npm start`, then open `http://127.0.0.1:5173/`. Use **New game** to try the current rules with a fresh country. Reloading an old save preserves its old rules; **Reset simulation → Confirm reset simulation** explicitly upgrades it at its original founding location/history.
2. For the reproducible comparison, start with an empty browser session on Chronicle / Large. Choose **Spawn civilization**, enter history **Growth review 1**, then **Random location**.
3. Choose **Locate civilization**, then **Play** or **Advance 1 month**. Inspect **Country investment**, **Country growth**, and **Country decisions**. Look for expanding connected borders, paid improvements, simultaneous funded work, and pauses that have an economic explanation. There should still be one capital.
4. Pause and refresh to verify the same progress returns. Reset replays this founding setup. Other histories/geographies should give different opportunities and supported footprints.

Revision: investment core/contracts, UI, comparative study, compatibility/regression tests and documentation are prepared for the implementation checkpoint, based on `a575776`. Complete `npm run check` passed with exit 0 on 11 September: architecture, vendored source/artifact integrity, TypeScript, **232 headless/process tests**, production build and **163 development/production Chromium scenarios** (browser phase 5.9 minutes). No failures or skipped headless tests; local evidence does not imply CI ran. Independent review is resolved. No known unresolved correctness issue; pacing awaits user acceptance and many-country throughput remains unmeasured. Next action: user review using the steps above. Do not start villages, multi-country simulation or diplomacy automatically.
