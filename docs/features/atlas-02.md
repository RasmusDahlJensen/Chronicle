# Atlas 02 — biomes and resource atlas

Status: implemented and verified; awaiting user review of the visual direction. The user's visual feedback supersedes the proposed seed-generator-first sequence.

Later review correction: [Resources 01](resources-01.md) replaces the every-cell resource model recorded below with scattered sites, optional cell resources, and extraction technology requirements. This brief retains Atlas 02's original implementation and measurement evidence.

## Outcome

Replace the default single-island presentation with a larger, richly textured regional map containing several landmasses, an archipelago, distinct biomes, and visible cell resources. The map must be useful for evaluating the eventual atlas: pan/zoom, select a cell, inspect its biome/elevation/resource and province/country relationship, and toggle resource/province/cell layers.

This is a deterministic authored regional study, not a user-seeded planet generator or a working economy. Resource symbols represent each cell's primary natural resource/potential; they do not represent fabricated production, stockpiles, buildings, or extraction. Include uranium as a geological resource requested by the user without adding modern-era mechanics. Countries remain absent; every land cell belongs to one real connected, unclaimed province. Water has no province. Province membership and country ownership remain separate.

## Plan and contracts

- Add a versioned atlas schema, biome/resource catalogs, and shared summaries. Use stable row-major cell IDs, explicit square-cell area, a bounded regional topology, and validated foreign keys and province connectivity.
- Construct a 320 × 200 authored regional fixture with coherent elevation/biome regions and one primary resource per cell. Reuse bounded host workers; retain current response/admission/deadline limits.
- Add `/api/atlas` with protocol version 2. Preserve `/api/terrain` and the original Aster fixture as a regression study at `/?scenario=aster`; the new atlas becomes the default browser view. Both routes share the same worker capacity.
- Draw biome-specific texture, stronger relief and color contrast, and actual cell resource markers with detail appropriate to zoom. Cache the base map; keep layers/camera/selection separate from world state. Make sampled overview markers explicit and allow inspection of every cell.
- Add responsive accessible controls and a cell inspector. Preserve loading, retry, reset, stale-response handling, and last-valid-map behavior. UI interaction cannot modify geography, resources, or ownership.
- Verify world invariants, transport, host load behavior, and real browser rendering, layers, selection, camera, reset, mobile layout, and failure handling. Inspect screenshots and obtain independent review before handoff.

The old Aster screenshot/area checks will target its explicit regression URL because the user requested a new default map. Preserve their assertions and old data. New visual acceptance must be assessed on the new atlas itself. This scope does not implement accounts, persistent world instances, save/load, simulation, economies, sovereignty transfers, or a full climate/drainage model.

## Results and verification

- The default Verdant Reach study contains 64,000 cells over 256,000 km²: 134,108 km² land and 121,892 km² water. Eight separate landmasses include three substantial regions and five smaller islands. All eleven biome and resource types occur; all 77 provinces are connected and unclaimed.
- Canvas terrain is cached separately from resource markers, borders, grid, selection, and camera state. Forest canopies, grass, dunes, reeds, rocks, snowy ridges, sea depth, and shallow water have distinct colors/textures. The legend and map share resource pictograms. Overview markers are sampled; high zoom can show each visible cell's resource.
- `npm run check`: architecture checks, TypeScript, **50 headless tests**, and production build passed on Node 24.20.0/Linux. This includes world repeatability, separation of landmasses, biome/resource coherence, province connectivity, positive country references, protocol validation, actual worker output, and shared admission across the two endpoints.
- `npm run test:browser`: **22 Chromium scenarios passed**, including nine new atlas cases and thirteen retained Aster cases. New checks cover actual biome colors, API-derived inspection, resource/province/grid layers, pan/zoom, reset/focus, one renderer lifecycle, failure/retry, mobile layout, cancelled gestures, and CSS-pixel tap tolerance at device-pixel ratio 2.
- Inspected desktop overview, zoomed detail, cell inspection, and 390px mobile screenshots. Fixed a color conversion bug found visually, reduced overview marker density, shared legend pictograms, and removed excess mobile letterboxing. Screenshots are generated under ignored `test-results/` by the browser suite.
- Ran `npm start -- --port 4175` and `npm run serve -- --port 4176`. A real Chromium smoke check against the built app confirmed atlas loading, zoom, cell inspection, reset, Aster access, and no page errors. Temporary verification servers are stopped after review.

## Measurements

`npm run bench:backend -- --atlas` passed with the default two workers/four queued jobs. The [recorded HTTP measurement](../benchmarks/atlas-02.json) includes Node/runtime, hardware, limits, and memory scope. All twelve normal requests succeeded; a twelve-request burst completed six and rejected six with expected overload responses. Payload size was 5,372,935 bytes. Normal request p95 was 562.4 ms; health p95 was 1.74 ms with no probe failures. These describe fixture construction/validation/encoding and delivery on this PC, not future world or simulation capacity.

A [browser observation](../benchmarks/atlas-02-browser.json) records a 1440 × 1000 Chromium development session: navigation to a drawn atlas took 1,553 ms, and thirty sampled cached pan redraws at 225% zoom had p95 1.8 ms. Redraw timing excludes input delivery and compositing; it is not an FPS guarantee. No broad device-performance claim is established.

## User review

1. Run `npm start` if the lab is not already running. A terminal started before [Dev 01](dev-01.md) needs one Ctrl+C and relaunch; subsequent backend and fixture edits restart automatically.
2. Open `http://127.0.0.1:5173/`. Compare the two large landmasses, northern cold region, and southern archipelago; inspect the biome textures at closer zoom.
3. Drag to explore, scroll or use +/− to zoom, and select land and water cells. Their resource and province/country information must match the map. Filter Iron or Uranium; turn on province borders and the cell grid.
4. Choose Fit map, then Reset atlas. Reset reproduces the same study and clears selection/restores the camera. The Aster Island header link retains the original study for comparison.

The map is a bounded authored region. It has no user-seeded geography, complete climate/drainage system, hierarchy drill-down, country simulation, extraction, saves, or independently persistent user worlds. A cell's resource is primary natural potential, not a stockpile; additional deposits and production rules remain future contracts. The next action is user assessment of terrain variety, texture, and resource readability, then selecting one next slice.

## Handoff

Starting checkpoint: `ebe6b58`, clean working tree. The verified Atlas 02 implementation is preserved in `80c4faf`. No unrelated changes were present. User review is pending; do not start the next feature automatically. Independent code-review findings and their resolution are recorded below.

- Independent data/transport review found no material defects. It prompted durable positive-country and concurrent mixed-endpoint admission tests, which pass.
- Independent UI/renderer review identified device-pixel-dependent tap tolerance. The renderer now measures tap movement in CSS pixels; a high-density tap/drag browser regression passes. The reviewer rechecked the fix and reported no remaining material findings. Actual-data selection/resource placement and renderer cleanup were also reviewed.
- Temporary verification servers exited successfully. The user subsequently reported an unavailable map: the pre-existing process on port 5173 served the new frontend through Vite but still ran the older backend, returning 404 for `/api/atlas`. Restarted that exact Chronicle process using `npm start`, then verified the same `http://127.0.0.1:5173/` address in Chromium at 2542 × 1312: API 200/protocol 2/64,000 cells, visible rendered map, successful reset, and no page errors. Inspected the resulting screenshot. The updated development server is left running for user review; refresh the browser tab. No application-code change was needed.
