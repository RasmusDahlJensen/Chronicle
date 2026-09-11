# Game AI package experiments

Supporting evidence for [Game AI for Chronicle](../../GAME_AI_RESEARCH.md), observed on 11 September 2026 using Node 24.20.0. These are isolated research fixtures, not Chronicle simulation tests or adopted application dependencies. The executor diagnostic intentionally demonstrates limitations as well as successful APIs; exit zero does not mean every library meets the proposed save contract.

`executor/` contains exact package versions, a transitive lockfile, the diagnostic and its observed JSON output. The script compares XState event-driven continuation, probes delayed transitions and Mistreevous inspection, demonstrates custom Yuka serialization requirements, imports GamePlanHTN, and exercises tiny JS-son/Mahler examples. `worker.mjs` runs that same diagnostic in a Node worker thread. UUIDs and Mahler timing metrics can differ across runs and are not replay assertions.

`support/` contains the queue/RNG/property-testing fixture, lockfile and observed output. It asserts queue order, 1,000-value RNG continuation, 1,000 generated queue cases, and replay of an intentionally failing property. This last failure is expected and checked; it is not a failing test being skipped.

To reproduce from the Chronicle repository root, use a temporary directory so these candidate dependencies stay outside the application:

```bash
research_dir=$(mktemp -d /tmp/chronicle-ai-research.XXXXXX)
cp -R docs/research/game-ai/executor docs/research/game-ai/support "$research_dir/"
npm ci --prefix "$research_dir/executor" --ignore-scripts --no-audit --no-fund
npm ci --prefix "$research_dir/support" --ignore-scripts --no-audit --no-fund
node "$research_dir/executor/audit.mjs"
node "$research_dir/executor/worker.mjs"
node "$research_dir/support/smoke.mjs"
```

Mahler's deprecation warning is expected: it was tested to assess the candidate and is rejected for adoption. These commands were rerun from the retained manifests/lockfiles. Both executor runs exited zero, and the support assertions passed. No strict TypeScript compilation, Chronicle worker/API/storage integration, throughput benchmark or full application regression gate is claimed by this evidence. Everyday Chronicle commands remain `npm ci` and `npm start` at the repository root.
