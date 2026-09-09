# Chronicle architecture decisions

Updated 9 September 2026. Backend 02 implements the researched local runtime foundation around the accepted terrain lab. Automated checks, browser verification, and independent review are complete; user review is pending. The [active brief](features/backend-02.md) records actual results and the review steps. [BACKEND_RESEARCH.md](BACKEND_RESEARCH.md) explains alternatives, primary sources, and future contracts.

## Confirmed hosting direction

Each person has a separate world, with all world generation and simulation running on the user's PC. Browsers display the atlas and send observer controls. Worlds do not interact. This supersedes the specification's original browser-simulation proposal while preserving the observer-only experience.

Each future world must have independent identity, state, configuration/seed, RNG state, clock, command ordering, history, and saves. Reconnecting returns to the appropriate world; another connection attaches to the same simulation. Requests and subscriptions must be checked against the person's access to that world.

**Confirmed lifecycle:** pause and save on departure, restore and resume on return, preserve manual pause, and perform no offline catch-up. These are requirements for future persistent worlds, not behavior provided by the current stateless fixture.

## Implemented runtime foundation

| Part | Choice | Responsibility |
|---|---|---|
| Browser interface | React + TypeScript + Vite | Terrain legend, reset, loading/failure/retry, and later observer controls |
| Atlas renderer | Existing Canvas 2D | Draw the accepted terrain independently of React; benchmark larger worlds before selecting another renderer |
| Host service | Node 24.20.0 + TypeScript + Fastify 5.12.3 | HTTP contracts, errors, request IDs/logging, limits, health/readiness, and lifecycle |
| Compute | Piscina 5.3.2 with persistent bounded Node workers | Construct, validate, and encode disposable terrain jobs away from HTTP handling |
| Shared transport | TypeBox 1.3.30 JSON schemas plus semantic validation | Common payload types and validation for host workers and browser |
| Built assets | @fastify/static 10.1.3 | Serve the built frontend directly through the host |
| Shared core | Browser-independent TypeScript world/fixture modules | Actual world data and rules reused by the host, renderer, and automated scenarios |
| Architecture checks | Biome 2.5.12, configured in `biome.json` | Check import boundaries, cycles, Node-only dependencies, and undeclared packages during routine verification |

The user authorized proper research and immediate implementation of this baseline. Fastify replaces the first slice's native HTTP routing; a bounded worker pool replaces synchronous fixture construction on the request thread. The current modular application provides the HTTP and compute foundation while keeping deployment and installation straightforward.

`npm start` launches Fastify and Vite in one Node process, with worker threads for CPU work. The development backend binds to an automatically assigned loopback port; Vite proxies `/api` through the browser origin at port 5173. `npm run build`, then `npm run serve`, starts the built frontend and API together on port 4173 through Fastify without a Vite runtime. `npm run preview` aliases that built-app mode. Ctrl+C closes listeners and workers. React changes use Vite hot updates; backend, worker, shared transport, and fixture changes require a restart. [README](../README.md) is the canonical setup, launch, and configuration guide.

## Growth and dependency decisions

Chronicle is intended to become a substantial simulation project. Small slices govern delivery and review; they do not limit the product's architecture or expected complexity. Plan for large world datasets, many active and archived entities, long histories, and multiple independent worlds. Evaluate memory residency, generation and stepping costs, history retention, simultaneous saves, and reconnect payloads with representative workloads as those capabilities develop. The current fixture and conservative runtime limits are evidence about the present workload only, not eventual capacity targets.

Keep one modular application now, with clear boundaries between world rules, transport, HTTP, compute ownership, rendering, and persistence. Those boundaries must allow later changes to process placement, server topology, and storage when known requirements or measurements justify them. Changes still require explicit contracts, implementation, migration planning, and verification; modularity does not make a database or distributed-runtime migration automatic. Evaluate additional runtime services by the requirements they satisfy and their operating costs, rather than assuming either that the project is too small to need them or that growth alone requires them immediately.

Use established libraries and tools for infrastructure where they provide a concrete benefit. The user authorizes necessary local package/tool installation for current work and future growth without an extra approval step. For adoption, check purpose, maintenance, license, Node/TypeScript and browser compatibility where relevant, operational requirements, and the cost of integration or replacement. Verify actual behavior with the installed version, pin direct package versions, update the lockfile, and reproduce installation with `npm ci`. Keep README accurate and preserve `npm ci`, then `npm start`, as the everyday setup and launch path.

`npm run check:architecture`, included in `npm run check`, runs the targeted Biome rules over `src`, `shared`, `server`, and `scripts`. The configured boundaries keep shared contracts independent of application layers; world/fixture/simulation modules independent of rendering, React, and host infrastructure; renderer and browser code out of host computation; HTTP modules out of direct fixture/simulation execution; and worker handlers out of HTTP orchestration. Node module imports are rejected in the browser, renderer, shared contracts, and world core. Import cycles, including type-only cycles, and undeclared package dependencies are also checked. Formatting and general style rules are not enabled by this configuration. [Configured rules](../biome.json), [Biome import restrictions](https://biomejs.dev/linter/rules/no-restricted-imports/javascript/), [cycle checking](https://biomejs.dev/linter/rules/no-import-cycles/javascript/)

Runtime modules also reject development-only package imports; composition scripts retain permission to load development tools such as Vite. These are static import checks, not complete runtime isolation. Literal import paths can be checked, but computed module names, worker URLs, access to browser/Node globals, and architectural intent still need review and appropriate tests. Update the rules when adding layers or import conventions, and retain independent review plus headless, browser, and process tests. Passing this check alone does not establish deterministic simulation or valid save/lifecycle behavior.

## Transport and capacity boundaries

The uncached `GET /api/terrain` contract remains `{ protocolVersion: 1, world }`. Workers construct the existing authored fixture, validate it, and serialize its JSON. The browser checks the shared structural and semantic contract before rendering. Invalid replacement data or failed requests preserve the last valid map. This full-fixture transport is limited independently to **100,000 cells** and **8 MiB of JSON**; larger world delivery needs a measured contract.

The initial pool uses two workers, or one when only one processor is available, with four waiting jobs and an eight-second deadline that includes queue time. Total admitted terrain responses are bounded to worker count plus queue allowance, with admission retained until the response finishes or closes. This also constrains work retained for slow clients after computation completes. Configuration is validated on startup; defaults and allowed ranges are recorded in README.

Request parsing, sockets, deadlines, and compute admission have explicit limits. Overload and timeouts return retryable failures. Disconnect cancels disposable terrain work; worker failure returns an error and does not fall back to computing on the HTTP thread. Structured logs and server-generated request IDs support diagnosis. `/api/health` establishes HTTP responsiveness; `/api/ready` reports worker/admission diagnostics and returns 503 when busy or unavailable. Startup exercises the actual worker path before announcing readiness.

These are conservative engineering defaults. Worker heap limits and payload bounds are not a total process-memory guarantee. The backend benchmark measures the fixture pipeline and HTTP responsiveness, recording configuration, hardware, latency, request outcomes, event-loop delay, and memory observations. It cannot establish simultaneous-world capacity, generation performance, or simulation speed. Actual measurements and checks belong in the active brief.

## Future world execution

The current pool runs disposable jobs. Cancelling a running Piscina task can terminate its worker; that policy must not be applied automatically to the only copy of a mutable world. A resident-world scheduler needs its own scoped design and measurements.

Within each world, retain one ordered mutation authority and bounded batches of completed simulation steps. A browser connection is not a unit of compute allocation. Parallel execution of separate worlds must not affect their individual results. Separate simulation from rendering, keep rules independent of browser and host APIs, and preserve seeded RNG state, stable update order, explicit accounting, and versioned rules/configuration.

Future subscriptions need initial views and bounded updates with world/incarnation/revision identifiers, plus resynchronization after missed updates. Keep static geography separate from frequent changes and avoid sending a full world every tick. Reset must invalidate stale jobs and messages. Bound active worlds, generation work, resident memory, and outgoing queues; choose capacities from representative workloads.

## Persistence and lifecycle

**Provisional first local-store choice: SQLite. No Chronicle save database is installed or created in Backend 02.** Revisit this choice **before implementing persistent state**, using representative world/save sizes, history growth, simultaneous checkpoint writes, query needs, and recovery requirements. PostgreSQL remains an option if those requirements justify its concurrency and operating model. SQLite is selected for local ownership and installation characteristics, not an assumption that Chronicle will remain small. A later change of storage engine requires an explicit data migration and verification plan; compatibility or a transparent transition is not promised.

The stateless authored fixture has no user-specific progress to protect. Introduce storage with meaningful persistent world identity and state, and add recovery before users accumulate progress. The research report supplies the initial SQLite/PostgreSQL and driver comparison and durability, migration, and backup checks; this growth decision adds the requirement to reassess it against the actual persistence workload before implementation.

The first store can use versioned world metadata and checkpoint payloads with an atomic current-checkpoint update. Simulation state remains owned by the shared core. Save only at a completed step, including the RNG, clock, identity, in-flight work, and history required for deterministic continuation. Validate a candidate load before replacing a running world; unsupported versions and migration failures must preserve a recoverable checkpoint.

Track loss of the last relevant connection with a host-side expiry and a short reconnect grace period whose duration remains to be chosen. Pause at a completed step, save durably, then release compute. Only a previously running world resumes automatically. Preserve manual pause and never simulate elapsed offline time. If saving fails, retain recoverable state and remain paused; do not evict it or discard the last good checkpoint.

Periodic checkpoints must define recovery after abrupt host failure; a shutdown save alone cannot protect against power loss. Test interrupted writes and backup restoration. Prevent two host processes from advancing the same persistent world: SQLite transaction locks do not provide simulation ownership.

## Remote access and next action

The host currently binds to loopback only. The PC must remain awake and the process running for simulation or remote access to work. Before allowing access from other PCs, define authenticated sessions, per-world authorization, TLS, bounded subscriptions, and session revocation. Unattended startup and OS service management need their own scoped implementation; Docker is not a prerequisite.

The accepted Atlas 01 and React 01 slices remain the visible baseline. Backend 01 established the first browser/host connection; Backend 02 is the active researched runtime slice. Routine checks, Chromium scenarios, a built-app browser smoke check, and independent review are complete; the active brief records their exact scope and results. Next action: run the lab and review the terrain loading/reset behavior using that brief. User testing remains pending.

After that review, propose a narrow world-identity and recovery slice using two explicitly labelled local test owners and real shared world data. Reassess storage for representative world sizes and save concurrency before implementing persistence. Verify independent reset/replacement, second-tab attachment, and restart restoration before remote exposure. Define completed-step pause and save/load continuation as soon as real simulation stepping exists. Do not start those features automatically or add decorative simulation state to demonstrate infrastructure.
