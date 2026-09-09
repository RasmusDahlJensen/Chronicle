# Chronicle architecture decisions

Updated 9 September 2026. Dev 01 adds synchronized development restarts and connected regression checks around the Atlas 02/Backend 02 foundation. Current verification belongs in the [development reliability brief](features/dev-01.md); the [atlas brief](features/atlas-02.md) retains visual review status. The original Aster Island study and protocol remain available. [Backend 02](features/backend-02.md) retains the foundation's evidence; [BACKEND_RESEARCH.md](BACKEND_RESEARCH.md) explains alternatives, primary sources, and future contracts.

## Confirmed hosting direction

Each person has a separate world, with all world generation and simulation running on the user's PC. Browsers display the atlas and send observer controls. Worlds do not interact. This supersedes the specification's original browser-simulation proposal while preserving the observer-only experience.

Each future world must have independent identity, state, configuration/seed, RNG state, clock, command ordering, history, and saves. Reconnecting returns to the appropriate world; another connection attaches to the same simulation. Requests and subscriptions must be checked against the person's access to that world.

**Confirmed lifecycle:** pause and save on departure, restore and resume on return, preserve manual pause, and perform no offline catch-up. These are requirements for future persistent worlds, not behavior provided by the current stateless fixture.

## Implemented runtime foundation

| Part | Choice | Responsibility |
|---|---|---|
| Browser interface | React + TypeScript + Vite | Biome/resource legends, layer controls, cell inspection, reset, and loading/failure/retry |
| Atlas renderer | Canvas 2D | Textured geography, resource/province/grid overlays, bounded pan/zoom, and cell selection independently of React |
| Host service | Node 24.20.0 + TypeScript + Fastify 5.12.3 | HTTP contracts, errors, request IDs/logging, limits, health/readiness, and lifecycle |
| Compute | Piscina 5.3.2 with persistent bounded Node workers | Construct, validate, and encode disposable terrain jobs away from HTTP handling |
| Shared transport | TypeBox 1.3.30 JSON schemas plus semantic validation | Common payload types and validation for host workers and browser |
| Built assets | @fastify/static 10.1.3 | Serve the built frontend directly through the host |
| Shared core | Browser-independent TypeScript world/fixture modules | Actual world data and rules reused by the host, renderer, and automated scenarios |
| Architecture checks | Biome 2.5.12, configured in `biome.json` | Check import boundaries, cycles, Node-only dependencies, and undeclared packages during routine verification |
| Development supervision | Nodemon 3.1.14, configured in `nodemon.json` | Restart the combined application after host/core/fixture edits, including changes used only by worker imports |

The user authorized proper research and immediate implementation of this baseline. Fastify replaces the first slice's native HTTP routing; a bounded worker pool replaces synchronous fixture construction on the request thread. The current modular application provides the HTTP and compute foundation while keeping deployment and installation straightforward.

`npm start` runs the nodemon supervisor around `scripts/start.ts`, which launches Fastify and Vite in one Node application process with worker threads for CPU work. The development backend binds to an automatically assigned loopback port; Vite proxies `/api` through the browser origin at port 5173. `npm run build`, then `npm run serve`, starts the built frontend and API together on port 4173 through Fastify without Vite or nodemon. `npm run preview` aliases that built-app mode. Ctrl+C closes listeners and workers. [README](../README.md) is the canonical setup, launch, and configuration guide.

## Development reload and verification boundaries

Vite hot updates alone cannot refresh Node's backend or worker module caches. The missing-map incident demonstrated this: an existing process served the new React interface but still returned 404 for its new atlas endpoint. The development supervisor now watches `server`, `shared`, `scripts`, `src/world`, `src/fixtures`, `src/simulation`, and relevant root configuration files. A 200 ms debounce coalesces saves; SIGTERM invokes the existing bounded shutdown before a replacement process recreates the HTTP host and worker pool. Vite reconnects and reloads the open tab at the same public origin. Browser component/style changes retain Vite hot updates. Invalid host code leaves the application unavailable until corrected; the watcher stays alive to recover on the next edit.

Nodemon is pinned as a development dependency (MIT, compatible with Node 24), uses explicit `node` execution for native TypeScript, and supplies process supervision instead of adding a custom restart manager. Its default TypeScript executable and restart signal are overridden to match Chronicle. Native Node watch-path behavior on this Linux installation differs from its versioned platform documentation, so it was not selected as the portable baseline. [Nodemon configuration](https://github.com/remy/nodemon/tree/v3.1.14), [package compatibility](https://github.com/remy/nodemon/blob/v3.1.14/package.json), [Node 24 watch-path documentation](https://github.com/nodejs/node/blob/v24.20.0/doc/api/cli.md#--watch-path).

New server/core module directories must be included in the watch scopes and exercised by a source-edit regression. Dependency/runtime upgrades and watch-configuration changes require restarting the supervisor itself. Production processes are not watched. Current restarts reconstruct the stateless authored study; a future mutable world requires save/recovery contracts before development restarts can safely discard its process state.

The core watch glob uses the existing `src` parent so a newly created nested `src/simulation` directory remains watched after its first import. Browser regression coverage also checks that writing generated test reports preserves a running review session and its selection.

`npm run check` is the complete implementation-iteration gate: architecture, types, headless tests, build, and Chromium tests against both development and built serving. The GitHub workflow runs the same command with the pinned Node and lockfile and retains failure artifacts. Tests for live updates copy actual application source into temporary projects and share only installed dependencies; their file edits never reach the running user lab. They verify behavior through the real worker, HTTP, proxy, and browser paths, including recovery and cleanup. Keep tests aligned with new behavior and connections as the project grows. A passing fresh-server suite alone does not establish that an existing review session has updated.

## Current regional atlas and module ownership

Verdant Reach is a deterministic **authored regional study** with a bounded 320 × 200 topology. Its 64,000 square cells each cover 4 km², giving 256,000 km² in total. The study contains several substantial landmasses and a southern archipelago, eleven biome types, eleven resource types, and 77 connected unclaimed provinces. Its fixed elevation and climate fields produce coherent regions for atlas evaluation; they do not establish a user-seeded planet generator or a complete drainage/climate model.

Every cell has a stable row-major ID, integral elevation in metres, a biome, one primary natural resource/potential, and a nullable province ID. Ocean and shallow-coast cells have negative elevation and no province. Every land cell belongs to one connected province. A province's nullable `countryId` is a separate hierarchy link; the initial country list is empty. Resource potential is neither an inventory nor an extraction/production rate. Camera movement, layers, and selection do not modify world data or ownership.

| Module | Responsibility |
|---|---|
| `shared/atlas.ts` | Protocol-2 world, cell, biome, resource, province, country, and annotation schemas/types; dimension, identity, reference, water/land, and province-connectivity validation |
| `shared/terrain.ts` | Retained protocol-1 Aster terrain contract |
| `shared/studies.ts` | Fixed authored-study identifiers for disposable compute jobs |
| `src/fixtures/verdant-reach.ts` | The actual shared regional fixture, deterministic resource assignment, and connected province construction |
| `src/world/atlas.ts` | Biome/resource display catalogs and summaries derived from cell data |
| `server/workers/terrain-worker.ts` | Construct the selected shared fixture, validate its matching contract, and encode bounded JSON |
| `src/api/atlas.ts` | Request the atlas and validate the response before rendering |
| `src/components/RegionalAtlas.tsx`, `src/components/AtlasCanvas.tsx` | React loading/reset state, legends, layers, cell inspector, and renderer lifecycle |
| `src/renderer/biome-atlas.ts` | Canvas geography/texture, overlays, bounded camera, and picking; independent of React |
| `src/App.tsx`, `src/components/LegacyTerrainLab.tsx` | Select the new default view or the retained Aster study at `?scenario=aster` |

Annotations belong to fixture data. Overview resource markers are sampled for readability; closer views expose more markers, and selecting a cell reveals its exact stored resource. The `cell → province → country` inspector displays real references, including unclaimed land and water without a province. Future sovereignty, occupation, habitation, and lifecycle operations still need their own mechanics and contracts.

## Growth and dependency decisions

Chronicle is intended to become a substantial simulation project. Small slices govern delivery and review; they do not limit the product's architecture or expected complexity. Plan for large world datasets, many active and archived entities, long histories, and multiple independent worlds. Evaluate memory residency, generation and stepping costs, history retention, simultaneous saves, and reconnect payloads with representative workloads as those capabilities develop. The current fixture and conservative runtime limits are evidence about the present workload only, not eventual capacity targets.

Keep one modular application now, with clear boundaries between world rules, transport, HTTP, compute ownership, rendering, and persistence. Those boundaries must allow later changes to process placement, server topology, and storage when known requirements or measurements justify them. Changes still require explicit contracts, implementation, migration planning, and verification; modularity does not make a database or distributed-runtime migration automatic. Evaluate additional runtime services by the requirements they satisfy and their operating costs, rather than assuming either that the project is too small to need them or that growth alone requires them immediately.

Use established libraries and tools for infrastructure where they provide a concrete benefit. The user authorizes necessary local package/tool installation for current work and future growth without an extra approval step. For adoption, check purpose, maintenance, license, Node/TypeScript and browser compatibility where relevant, operational requirements, and the cost of integration or replacement. Verify actual behavior with the installed version, pin direct package versions, update the lockfile, and reproduce installation with `npm ci`. Keep README accurate and preserve `npm ci`, then `npm start`, as the everyday setup and launch path.

`npm run check:architecture`, included in `npm run check`, runs the targeted Biome rules over `src`, `shared`, `server`, and `scripts`. The configured boundaries keep shared contracts independent of application layers; world/fixture/simulation modules independent of rendering, React, and host infrastructure; renderer and browser code out of host computation; HTTP modules out of direct fixture/simulation execution; and worker handlers out of HTTP orchestration. Node module imports are rejected in the browser, renderer, shared contracts, and world core. Import cycles, including type-only cycles, and undeclared package dependencies are also checked. Formatting and general style rules are not enabled by this configuration. [Configured rules](../biome.json), [Biome import restrictions](https://biomejs.dev/linter/rules/no-restricted-imports/javascript/), [cycle checking](https://biomejs.dev/linter/rules/no-import-cycles/javascript/)

Runtime modules also reject development-only package imports; composition scripts retain permission to load development tools such as Vite. These are static import checks, not complete runtime isolation. Literal import paths can be checked, but computed module names, worker URLs, access to browser/Node globals, and architectural intent still need review and appropriate tests. Update the rules when adding layers or import conventions, and retain independent review plus headless, browser, and process tests. Passing this check alone does not establish deterministic simulation or valid save/lifecycle behavior.

## Transport and capacity boundaries

The uncached map endpoints have separate versioned contracts:

| Endpoint | Payload | Browser study |
|---|---|---|
| `GET /api/atlas` | `{ protocolVersion: 2, world: AtlasWorld }` | Verdant Reach, the default view |
| `GET /api/terrain` | `{ protocolVersion: 1, world: TerrainWorld }` | Aster Island at `?scenario=aster` |

Workers construct the selected authored fixture, validate the matching contract, and serialize its JSON. The browser checks the shared structural and semantic contract before rendering. Invalid replacement data or failed requests preserve the last valid map. Each full-fixture payload is limited independently to **100,000 cells** and **8 MiB of JSON**; larger world delivery needs a measured contract.

Both endpoints share one pool: two workers, or one when only one processor is available, with four waiting jobs and an eight-second deadline that includes queue time. Total admitted map responses across both routes are bounded to worker count plus queue allowance, with admission retained until the response finishes or closes. This also constrains work retained for slow clients after computation completes. Configuration is validated on startup; defaults and allowed ranges are recorded in README.

Request parsing, sockets, deadlines, and compute admission have explicit limits. Overload and timeouts return retryable failures. Disconnect cancels disposable terrain work; worker failure returns an error and does not fall back to computing on the HTTP thread. Structured logs and server-generated request IDs support diagnosis. `/api/health` establishes HTTP responsiveness; `/api/ready` reports worker/admission diagnostics and returns 503 when busy or unavailable. Startup exercises the actual worker path before announcing readiness.

These are conservative engineering defaults. Worker heap limits and payload bounds are not a total process-memory guarantee. `npm run bench:backend -- --atlas` measures the Verdant Reach pipeline; `npm run bench:backend` retains the Aster baseline. Each records configuration, hardware, latency, request outcomes, event-loop delay, and memory observations. Fixture measurements do not establish simultaneous-world capacity, procedural-generation performance, or simulation speed. Actual measurements and checks belong in the relevant feature brief.

## Future world execution

The current pool runs disposable jobs. Cancelling a running Piscina task can terminate its worker; that policy must not be applied automatically to the only copy of a mutable world. A resident-world scheduler needs its own scoped design and measurements.

Within each world, retain one ordered mutation authority and bounded batches of completed simulation steps. A browser connection is not a unit of compute allocation. Parallel execution of separate worlds must not affect their individual results. Separate simulation from rendering, keep rules independent of browser and host APIs, and preserve seeded RNG state, stable update order, explicit accounting, and versioned rules/configuration.

Future subscriptions need initial views and bounded updates with world/incarnation/revision identifiers, plus resynchronization after missed updates. Keep static geography separate from frequent changes and avoid sending a full world every tick. Reset must invalidate stale jobs and messages. Bound active worlds, generation work, resident memory, and outgoing queues; choose capacities from representative workloads.

## Persistence and lifecycle

**Provisional first local-store choice: SQLite. No Chronicle save database is installed or created in Backend 02.** Revisit this choice **before implementing persistent state**, using representative world/save sizes, history growth, simultaneous checkpoint writes, query needs, and recovery requirements. PostgreSQL remains an option if those requirements justify its concurrency and operating model. SQLite is selected for local ownership and installation characteristics, not an assumption that Chronicle will remain small. A later change of storage engine requires an explicit data migration and verification plan; compatibility or a transparent transition is not promised.

The stateless authored studies have no user-specific progress to protect. Introduce storage with meaningful persistent world identity and state, and add recovery before users accumulate progress. The research report supplies the initial SQLite/PostgreSQL and driver comparison and durability, migration, and backup checks; this growth decision adds the requirement to reassess it against the actual persistence workload before implementation.

The first store can use versioned world metadata and checkpoint payloads with an atomic current-checkpoint update. Simulation state remains owned by the shared core. Save only at a completed step, including the RNG, clock, identity, in-flight work, and history required for deterministic continuation. Validate a candidate load before replacing a running world; unsupported versions and migration failures must preserve a recoverable checkpoint.

Track loss of the last relevant connection with a host-side expiry and a short reconnect grace period whose duration remains to be chosen. Pause at a completed step, save durably, then release compute. Only a previously running world resumes automatically. Preserve manual pause and never simulate elapsed offline time. If saving fails, retain recoverable state and remain paused; do not evict it or discard the last good checkpoint.

Periodic checkpoints must define recovery after abrupt host failure; a shutdown save alone cannot protect against power loss. Test interrupted writes and backup restoration. Prevent two host processes from advancing the same persistent world: SQLite transaction locks do not provide simulation ownership.

## Remote access and next action

The host currently binds to loopback only. The PC must remain awake and the process running for simulation or remote access to work. Before allowing access from other PCs, define authenticated sessions, per-world authorization, TLS, bounded subscriptions, and session revocation. Unattended startup and OS service management need their own scoped implementation; Docker is not a prerequisite.

The user's visual feedback selected Atlas 02 before the previously proposed seed-generator-first sequence. Verdant Reach is now the default atlas; the accepted Atlas 01/React 01 study remains accessible at `?scenario=aster`. Backend 01 established the browser/host connection, and Backend 02 supplies the runtime and growth safeguards. The active atlas brief owns verification evidence and the exact user-review steps. Review of this visual direction is still required before choosing the next slice.

Future scoped work includes user-seeded geography, a full drainage/climate/resource pipeline, independent world instances, restart recovery, founding settlements, and committed simulation steps with meaningful population/resource accounting. The authored regions and province groups in Atlas 02 provide data to inspect; they do not complete those future generation or simulation systems. Authentication, remote access, and unattended hosting remain separate work before opening access to other PCs.

A future generator must distinguish seed/settings/generator identity from both authored-fixture identity and persistent world-instance identity. Define stage outputs, topology, units, and input limits before connecting incomplete generation stages to province-complete world contracts. Preserve the original studies and their invariants, verify repeatability across workers and host restarts, and measure generation, transfer, and rendering costs with the actual workload. Select the next observable outcome and its brief after Atlas 02 review.
