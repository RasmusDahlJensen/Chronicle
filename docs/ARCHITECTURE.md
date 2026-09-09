# Chronicle architecture decisions

Updated 9 September 2026. The terrain lab uses React + TypeScript + Vite and a local Node.js + TypeScript terrain host. Separate user worlds and pause/save on disconnect remain confirmed directions for later implementation.

## Confirmed hosting direction

The user chose: each person has a separate world, with all world generation and simulation running on the user's PC. Browsers display the atlas and send observer controls. Worlds do not interact with one another.

This supersedes the specification's original proposal to run simulation in each browser. It preserves the observer-only experience and does not introduce shared-world multiplayer.

Each world must have independent state, configuration/seed, RNG state, clock, command ordering, history, and saves. Reconnecting must return to the appropriate world; opening another connection must not create a second simulation of that world. Requests and subscriptions must be checked against the person's access to the world.

## Technical choices

The user selected React + TypeScript + Vite for the browser interface. Keep world rules and atlas rendering independent of React components.

| Part | Choice and status | Responsibility |
|---|---|---|
| Browser interface | **Implemented for the terrain lab:** React + TypeScript + Vite | Current terrain legend and reset; later panels, selection, observer controls, and connection state |
| Atlas renderer | **Existing baseline:** Canvas 2D; benchmark larger maps before choosing the full-world renderer | Draw terrain and committed world views locally; remain separate from React |
| Host service | **Implemented for the terrain lab:** Node.js + TypeScript with native HTTP | Constructs and returns the stateless fixture; ownership, scheduling, and persistence follow later |
| Compute | **Recommended:** a bounded set of Node worker threads | Run generation and simulation away from request handling |
| Shared core | Browser-independent TypeScript modules, extending the existing separation | Deterministic rules and world data used by the host and test scenarios |

`npm start` launches the terrain HTTP server and Vite in one Node process. Each launch owns a backend bound to an automatically assigned loopback port; Vite proxies `/api` through the same origin as the browser app. `npm run preview` uses the same host with the built frontend. Ctrl+C closes both. Frontend edits use Vite hot updates; backend and fixture edits require a restart. Keep one repository and avoid introducing a database, additional language, or service framework until a specific slice needs it.

The first transport is an uncached `GET /api/terrain` returning `{ protocolVersion: 1, world }`. The browser validates the payload before rendering and can retry failed requests without losing the last displayed map. This temporary full-fixture transport is bounded to 100,000 cells; larger world delivery requires a measured contract. The small authored fixture is constructed synchronously on request. This does not establish scheduling or throughput for simulation workloads.

Use persistent workers with an explicit limit; decide their assignment to worlds after measurement. A browser connection is not a unit of compute allocation. Within each world, retain one ordered authority for mutations. Parallel execution of different worlds must not affect their individual results.

Browsers receive an initial world view and bounded updates with world/version identifiers. Reconnection needs a way to resynchronize after missing updates. Keep static geography separate from frequent changes and avoid sending the entire world every tick. Browser rendering still consumes client CPU/GPU resources.

The host must bound active worlds, generation jobs, resident memory, and outgoing update queues. Overload should queue or defer work with an understandable status. Exact capacities are unmeasured; no simultaneous-user or simulation-speed promise is established.

## Persistence and lifecycle

Hosted worlds need separately identified, versioned saves on the host. Define recovery from interrupted generation and server restarts in the relevant implementation slice. Saving and loading must preserve committed state and deterministic continuation.

**Confirmed:** pause and save when the person leaves; restore and resume when they return.

Proposed lifecycle details: detect the loss of the last relevant connection, allowing a short reconnect grace period whose duration is still to be chosen. Pause at a completed simulation step, save that committed state, and release its compute allocation. Reopening another tab must not duplicate the simulation. Retain whether the user had manually paused: only a previously running world resumes automatically. Do not simulate elapsed offline time. Evict idle world data only after its save succeeds; record and retain recoverable state if saving fails.

The PC must remain awake and the host process running for simulations to advance and for remote access to work. Access from other machines, host startup management, and user identification need scoped implementation work; nothing is being exposed to the network as part of this decision.

## Small next steps under discussion

1. **Done:** define the React migration brief in `docs/features/react-01.md`.
2. **Implemented, verified, and accepted:** migrate the terrain screen to React. The user confirmed it runs correctly and the island looks acceptable.
3. **Implemented and verified; user review pending:** the local Node host constructs and returns the same terrain fixture, with browser loading/failure/retry behavior. See `docs/features/backend-01.md`.
4. Use two independent test worlds to verify ownership, reset isolation, and reconnect behavior before allowing access from other PCs.
5. Add measured generation/simulation workloads and define scheduling/persistence behavior in separate slices.

The order and scope of implementation require a feature brief. Atlas 01 remains available as the working baseline; do not combine these steps into one large implementation.

## Current evidence and handoff

Original baseline: commit `066aa78` on `feat/atlas-01`; accepted React migration: `54af29f`. The app uses React components around the same Canvas 2D renderer, with the fixed fixture now constructed by the local host. The original timing measures rendering only and cannot establish backend capacity. Accounts, persistent user worlds, simulation, and hosted-world lifecycle are not implemented yet.

See `docs/features/backend-01.md` for current verification and handoff. Backend 01 passed 19 automated tests, 12 Chromium scenarios, and the production build. Next action: user review of the local backend slice. Disconnect detection, storage, worker scheduling, and hosting capacity remain to be resolved in their respective slices. README is the maintained guide for launching the current project.

Node's [worker-thread documentation](https://nodejs.org/docs/latest-v24.x/api/worker_threads.html) supports using workers for CPU-intensive JavaScript and reusing workers to avoid repeated startup overhead. It does not establish Chronicle's capacity or a speedup over browser workers.
