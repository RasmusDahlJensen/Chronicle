# Backend 02 — researched runtime baseline

Status: implemented and verified, 9 September 2026. Awaiting user review.

## Outcome and scope

Establish a researched, executable backend foundation for Chronicle's PC-hosted independent worlds. The existing terrain screen remains the review scenario. The current instruction authorizes researching and implementing this baseline immediately; it supersedes earlier deferral of foundational worker execution and server infrastructure.

The baseline adds Fastify, a bounded Piscina compute pool, shared validated transport, configuration/error/logging conventions, a standalone built-app server, lifecycle checks, and a reproducible load benchmark. Keep Node 24, React/Vite, one repository, and `npm ci` / `npm start`. Preserve deterministic fixture output and every applicable browser acceptance check.

Research record: `docs/BACKEND_RESEARCH.md`. Architecture decisions: `docs/ARCHITECTURE.md`. Storage is selected as local SQLite for the first persistent-world slice; no empty database or fabricated simulation/save behavior is introduced here. Accounts, persistent world identity, simulation steps, deployment, remote access, and a full scheduler remain separate features.

## Contracts and plan

- [x] Review primary sources for HTTP/framework choices, CPU execution, production serving, persistence, and lifecycle. Record assumptions, alternatives, limitations, and implementation decisions.
- [x] Establish shared terrain response types/schema/validation used by host workers and browser. Keep protocolVersion 1 and the accepted fixture intact; bound cells and serialized response size.
- [x] Replace ad hoc HTTP handling with a testable Fastify app, shared error envelopes and request IDs, structured logs, configured request limits, and health/readiness routes.
- [x] Run fixture construction, validation, and JSON serialization in persistent Piscina workers. Bound worker count, waiting jobs, total admitted HTTP terrain responses, and job duration. Cancel disposable work on disconnect; map overload and timeout to explicit retryable responses. Verify cancellation, worker failure/recovery, and shutdown.
- [x] Preserve one-command development launch. Serve the built app through the backend itself in preview/serve mode, with no Vite runtime dependency on that path. Keep fixed browser ports and loopback-only access. Verify partial startup cleanup and signal handling.
- [x] Add meaningful CPU isolation/load evidence, run the full routine/browser suites and built-app smoke checks, obtain independent review, update README/workflow, and save a local checkpoint.

Initial conservative limits are engineering defaults, not user-capacity promises. Measure and document them before changing them. No request should silently invoke computation on the HTTP event loop when a worker fails.

## Verification and handoff

Starting checkpoint: `ae96071` on `feat/atlas-01`, clean working tree. Before this change, all 19 routine tests and 12 Chromium scenarios passed. New regression cases must cover shared schema rejection, health response before controlled CPU work finishes, finite admission/queue limits, cancellation/deadlines, recovery, shutdown, production static/API routing, and the existing UI.

## Verified result

Verified on Linux x64, Node 24.20.0, with the Backend 02 working tree based on `ae96071`. This brief and the verified implementation are saved together in the local checkpoint titled `feat: establish researched backend baseline` on `feat/atlas-01`.

- `npm ci`: locked installation passed; npm reported no known dependency vulnerabilities at installation time.
- `npm run check`: TypeScript checks, **39 automated tests**, and the production build passed. Tests cover real worker CPU isolation, bounded admission and queues, queued/running cancellation, deadlines, worker exception/exit recovery, startup failures, graceful/forced shutdown, shared data rejection, HTTP contracts, and launcher isolation/cleanup.
- `npm run test:browser`: **13 Chromium scenarios passed**, including the existing visual/reset/resize/keyboard checks, dropped/stalled requests, malformed responses, authoritative host data, and busy-host retry without losing the map. The generated desktop screenshot was inspected.
- `npm run serve`: the actual production build loaded in Chromium on port 4173, displayed 9,898 km² of land, reset successfully, returned JSON 404 for an unknown API route, and raised no page errors. Ctrl+C exited successfully. Launcher tests also cover `--preview` and `--serve` while actively rejecting any Vite runtime import.
- `npm run bench:backend`: passed with the actual fixture. The recorded report below was captured using the same script after other verification processes stopped.
- Independent review found no material runtime issues. Its slow-reader coverage suggestion was addressed: after computation completes, a paused TCP reader retains admission, excess work receives 503, and disconnect frees capacity. The reviewer checked this added regression test.
- `git diff --check`: passed. No application behavior or test failures remain unresolved. Windows/macOS execution has not been verified in this environment.

### Recorded fixture benchmark

Raw report: [`../benchmarks/backend-02.json`](../benchmarks/backend-02.json), captured 9 September 2026 at 09:22:15 UTC. Ryzen 7 7800X3D, 16 available logical processors, Node 24.20.0, Linux x64; two workers, four waiting jobs, six admitted terrain responses, eight-second deadline. Fastify loopback API without Vite or browser; 27,648 cells and 1,915,493 response bytes. Each response is fully read.

| Phase | Requests / concurrency | Outcomes | Terrain p95 | Health p95 |
|---|---|---|---|---|
| Normal | 12 / 2 | 12 successful | 216.03 ms | 1.84 ms |
| Burst | 12 / 12 | 6 successful, 6 expected overload responses | 528.81 ms for successes | 3.95 ms |

No unexpected HTTP statuses, transport failures, or health failures occurred. Peak sampled RSS was 429,948,928 bytes (about 410 MiB), including the host, worker threads, and benchmark HTTP clients/probes. Event-loop delay p95 was 10.77 ms / 10.67 ms with a 10 ms sampling resolution. These observations describe this short fixture workload on a development PC; they do not establish resident-world capacity, long-run memory stability, or simulation speed.

## Review and next action

If an older lab terminal is running, stop it with Ctrl+C. From the repository, run `npm ci` after pulling dependency changes, then `npm start`. Open `http://127.0.0.1:5173/`, inspect the existing Aster Island, and press **Reset terrain**. The same map and terrain areas should return. Open `/api/ready` to see the worker limits and completed jobs; run `npm run bench:backend` for a repeatable backend exercise. README remains the canonical run guide.

The previous app process on port 5173 was left running for the user; it needs a restart to load the new backend. All temporary verification servers were stopped. This checkpoint is local; nothing has been deployed, pushed, or exposed to other PCs.

User review remains pending. The next proposed slice is independent world identity and recovery, adding local SQLite alongside meaningful persistent state. Accounts, remote access, resident-world scheduling, simulation, and disconnect save/resume are not implemented here. Do not start the next slice automatically.
