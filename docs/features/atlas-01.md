# Atlas 01 — Aster Island

Status: implemented, locally verified, and accepted by the user on 9 September 2026.

This records the original terrain implementation. Its UI integration and launch instructions are superseded by `docs/features/react-01.md` and the root README; terrain contracts and acceptance scenarios remain in force.

## Outcome and scope

Open a local browser lab and see a fixed island with blue water, parchment-toned plains, a detailed coastline, and shaded hills. Reset reconstructs the original terrain. This implements the first terrain sample agreed in conversation, not the whole M1 milestone.

Relevant specification: sections 3, 11, 13–15. No prototype source is present in this repository. The existing specification and workflow are retained.

In scope: one authored terrain fixture, responsive Canvas rendering, a compact terrain legend with real area totals, reset, and automated/browser checks. Out of scope: pan/zoom, picking, seeded world generation, simulation time, population, economy, war, saving, and deployment.

## Minimum contracts and decisions

- TypeScript and Vite, plain HTML/CSS panels, no runtime dependencies. Node 24 is the supported development runtime. Playwright tests real browser behavior; Node's test runner checks shared world logic.
- `src/world/` owns browser-independent world data and terrain summaries. `src/fixtures/` constructs the fixed scenario. `src/renderer/` only reads that world. `src/main.ts` connects the view and reset.
- A cell has a stable numeric ID, terrain, elevation, and province membership. This local fixture uses a 192 × 144 grid with 1 km² cells in a flat local coordinate system. It is not a planet projection or a commitment to the eventual global mesh.
- Every land cell belongs to one connected, unowned fixture province; water cells have no province. There are no countries or military controllers. Sovereignty is not inferred from land or elevation.
- The authored island outline and hill placements are fixed. Sampling them into cells is fixture construction, not the future seeded world generator. The renderer derives coastlines and relief from those same cells.
- Canvas 2D is the initial renderer for this sample. Record an actual rendering baseline; choosing the full-world renderer requires later measurement.
- Reset builds fresh world objects, redraws the initial view, and announces completion. Browser resizing fits the same map without altering its data. No frame-by-frame simulation or worker is needed for this static slice.

## Acceptance scenarios

1. Opening the lab displays the island and distinguishes water, plains, and hills; the legend's areas reconcile with the underlying cells.
2. Rebuilding the fixture preserves IDs, terrain, elevation, and province membership without sharing mutable cell objects. Modifying an old instance cannot contaminate a reset.
3. Land is connected, lies inside the water boundary, and has exactly one valid province. Cell areas remain distinct from rendered pixels.
4. Reset restores the same map data and pixels at an unchanged viewport and reports completion.
5. A narrow viewport remains usable, resizing preserves the map aspect ratio, and the reset control works with keyboard input. No browser errors occur.

## Small implementation plan

- [x] Add the minimal Vite/TypeScript setup and meaningful fixture tests; observe failure before implementing the fixture.
- [x] Implement world contracts, the fixed island, and area summaries; run the focused tests.
- [x] Build the shared Canvas renderer and compact browser view; wire fresh reconstruction to reset.
- [x] Run type checks, tests, production build, and browser checks. Inspect desktop/mobile screenshots and record a rendering baseline.
- [x] Obtain independent review, resolve material findings, update these results and the workflow, and leave a local URL for the user.

Verification commands once setup exists: `npm run check` for type checks, world tests, and build; `npm run test:browser` for the browser scenarios; `npm run dev` to try it. Record exact versions in the lockfile and runtime file.

## Results and handoff

Starting revision: `cb04516`; the project documents were uncommitted before this task. Work is on `feat/atlas-01`, with a checkpoint titled `feat: add the first terrain browser lab`. Full M0 and M1 gates remain incomplete.

- `npm test` initially failed because the fixture module was absent. After implementation, all four tests passed: bounded water/land terrain, connected province membership, reconstruction without mutable aliases, and area accounting using a separate non-unit-area example.
- `npm run check` passed: TypeScript, four unit tests, and Vite production build. Exact tool versions are locked in `package-lock.json`.
- `npm run test:browser` passed all three Chromium tests: visible varied terrain and area reconciliation; reset repainting an intentionally corrupted canvas to identical pixels; live resize restoration; and mobile keyboard reset. Screenshots at 1440 × 1000 and 390 × 844 were inspected.
- Visual review identified artificial stripes from periodic hill detail. Fixed coherent surface variation replaced that detail, and screenshots were inspected again. Mobile map annotation sizes now adapt to the available width.
- Production preview smoke check reported no page errors. On Linux, AMD Ryzen 7 7800X3D, Node 24.20.0, Chromium 153.0.8010.12, 1440 × 1000 viewport at DPR 1, the 192 × 144 fixture's initial raster/draw took 99.4 ms. Five reset raster/draw samples were 96.2, 88.8, 83.9, 83.9, and 83.6 ms. This measures synchronous rendering, excluding fixture construction and browser presentation; it is not an input-latency, FPS, or full-world benchmark.
- Independent code review found no material issues. Minor follow-ups: move fixture-specific map labels to fixture annotations when adding a second scenario; strengthen browser assertions against swapped individual terrain labels (current assertions verify reconciliation; the unit test independently verifies category totals).

How to try it: `npm run dev`, open the printed URL (normally http://127.0.0.1:5173/), inspect the terrain and legend, press Reset terrain, and resize the window. Browser coverage is Chromium only; Firefox and Safari have not been checked. The user subsequently accepted the terrain appearance in the React lab.

Handoff: original implementation and verification complete. The subsequently authorized React migration preserves this fixture; see `docs/features/react-01.md` for current status and next action. The user confirmed the terrain's appearance is acceptable.

Follow-up ideas: camera navigation, then seeded land/water generation. Each needs its own agreed slice.
