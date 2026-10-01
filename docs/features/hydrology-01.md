# Hydrology 01 — rivers, lakes and freshwater

> Note, 1 October 2026: the authored Verdant Reach regional atlas and Aster Island terrain studies (hand-made maps, unrelated to [VISION.md](../VISION.md)'s generated study seeds `Verdant` and `Aster`), the atlas protocol and their scenarios were removed at the user's request. References below to authored studies are historical, and next-step statements below are superseded by VISION.md.

Status: visually accepted and considered done by the user, 10 September 2026. Runtime checkpoint remains `ffce09d` (135 headless/process tests and 95 browser scenarios passed). The user said “That looks great” and considers this area done; the next geography slice was then to be chosen without reopening river/drainage changes. Exception: VISION.md slice G1 approves fixing the generation bug behind "Hydrology did not converge within 12 drainage passes", changing output only for seeds that currently fail; it does not reopen the drainage morphology proposal. No drainage morphology prototype was implemented.

## Outcome and boundaries

The accepted terrain gains connected rivers, tributaries and inland lakes. Rivers follow a deterministic drainage graph and become larger as catchments combine. Lakes have a level, member cells and either one mapped outlet or a closed basin. Cell inspection distinguishes freshwater river access, freshwater lake access and enclosed inland water whose salinity is not modeled. The same world remains visible at fit and close zoom, including across the longitude seam and detail-tile arrivals.

Preserve the Platec artifact, terrain elevation arrays, continent outlines, textures, sparse resources and existing climate layers. New surface water may cover limited low depressions; lake beds retain their geographic elevation. Generate on the host using the existing worker. This is static annual geography, not seasonal flooding, calibrated rainfall/discharge, groundwater, erosion, navigation, fertility or settlement gameplay. Subsequent geography slices remain separate.

## Approach and research

Use [Barnes et al.'s Priority-Flood](https://arxiv.org/abs/1511.04463) for deterministic spill surfaces and drainage, with explicit longitude wrapping and bounded latitude. [Red Blob's mapgen4](https://www.redblobgames.com/maps/mapgen4/) demonstrates moisture-based accumulated flow and visual river widths. A small typed-array implementation fits the existing grid/worker better than introducing a GDAL/Python service or another compiled toolchain; no runtime dependency is needed for this algorithm.

Read-only probes found that naïvely filling every depression would flood 14–24% of existing land. Treating all existing negative-elevation water as level-zero sinks reduced this, but remaining depressions were still too extensive. The selected hybrid preserves those bodies, fills only shallow supported basins, and turns deep/large/undersupplied basins into bounded terminal basins. This is a game-scale static water-retention model. Moisture is an availability index; accumulated runoff is an index weighted by cell area, never claimed m³/s.

Identify ocean using connected negative-elevation water at the polar edges; enclosed water becomes inland lakes. Drainage can use adjacent cells with deterministic tie-breaking. Use a separate water/spill surface; never rewrite the accepted bedrock. Limit newly filled depths to 20 m and conservatively retain water near deep basin minima. Catchment supply, not just moisture at the basin floor, governs retention; a dry valley can receive a river from wetter headwaters. All visible channels must descend or remain level on actual exposed water surfaces and avoid cycles. Ordinary rivers (runoff ≥5,000) end at mapped water. Smaller lake outflows retain their full downstream route and may terminate at an explicit dry basin with incoming runoff below 5,000; dry terminals do not imply freshwater access. A lake has one canonical outlet or is closed; recompute conserved accumulation after lake routing. Bound all iterations and memory, and fail explicitly if convergence cannot be established.

Existing enclosed inland water is not automatically freshwater. Outflowing lakes and rivers supply mapped freshwater; closed-basin salinity remains unmodeled. This avoids treating every blue cell as a future drinking-water source.

## Contracts and rendering

Generator version 4 and generated-world protocol 3 invalidate incompatible cached previews. Authored atlas protocol 3 then remained a separate unchanged contract (the authored atlas was removed on 1 October 2026). Append `lake` and `lakeIce` biome codes; terrain elevation is lake-bed elevation, and lake surface level is separate. Water counts must use surface-water classification, not merely negative elevation.

Keep existing compact elevation/biome surface bytes and exact climate/resource tiles. Add a sparse authoritative hydrology graph to the manifest: river source/destination cell IDs and moisture-weighted runoff, registered dry terminal IDs, plus lake IDs, member cells, levels and optional outlet edges. The same validated graph drives rendering and inspection, so no second approximate river system or extra endpoint is needed. Set the manifest bound to 4 MiB to allow the added sparse network and larger lake metadata; retain the 512 KiB tile and 20 MiB bundle bounds and existing concurrency/cache limits. Validate actual dimensions, unique ownership, adjacent edges, cycles, downstream continuation, lake/biome agreement, levels and outlet consistency before publication or browser use.

Draw lake surfaces with distinct water colors/textures and river edges over the full-detail terrain. Clip/cull by viewport, wrap longitude, and keep streams continuous through tile boundaries. Provide a Rivers visibility checkbox, retain literal climate colors, and keep resource/cell picking tied to the existing cells. Inspection shows water type, river size, lake level/depth/area and mapped freshwater access as applicable. Resource rules permit fish on suitable unfrozen lake water rather than leaving submerged land deposits active.

## Implementation plan

> For agentic workers: execute this approved slice with bounded independent ownership and review checkpoints. Use the existing workflow, test-driven development and complete regression gate. Do not begin another geography slice automatically.

**Goal:** Add visible, inspectable, deterministic rivers and lakes to the accepted world.

**Architecture:** A pure drainage module runs after terrain/climate fields exist and before final biome/resource assignment. Sparse hydrology is validated in the shared contract, sent through the existing worker/manifest, and consumed by the existing renderer and inspector.

**Tech stack:** Node 24.20.0, TypeScript, existing React/Canvas/Fastify/Piscina stack; bundled Platec unchanged.

**Spec:** This brief and CHRONICLE_SPEC.md §4.

**Global constraints:** Keep `npm ci` / `npm start`; host computation only; reproducible seed/version identity; no bedrock mutation; bounded payloads/cache/jobs; preserve authored studies and existing acceptance checks; complete `npm run check` before handoff.

### 1. Drainage core — generation agent

Files: create `src/world/generation/hydrology.ts`, `tests/hydrology.test.ts`.

```ts
interface HydrologyInput {
  width: number; height: number; areaKm2: number;
  elevation: Int16Array; moisture: Uint16Array;
}
interface Hydrology {
  ocean: Uint8Array; lake: Uint32Array; waterLevel: Int16Array;
  downstream: Int32Array; runoff: Uint32Array; river: Uint8Array;
  lakes: { id: number; cells: number[]; level: number; outlet: number | null }[];
}
// lake IDs are 1..N (0 means none); downstream -1 means terminal.
// outlet is a lake member cell whose downstream exits, or null for a closed lake.
function generateHydrology(input: HydrologyInput): Hydrology;
```

- [x] First run failing tests for downhill tributary conservation, a filled bowl with one outlet, an enclosed below-sea-level lake, a deep terminal basin, wet headwaters feeding a dry basin, dry sinks, longitude seams, bounded poles, cycle rejection and unchanged inputs.
- [x] Implement bounded flood/retention/routing and recompute topological accumulation. Reject invalid dimensions/lengths/nonfinite values and explicit nonconvergence.
- [x] Run synthetic regressions and probe Chronicle/Elsewhere/Harbors/Sundown at both sizes for water extent, connected channels, bedrock identity, time and memory.

### 2. Shared contract and host integration — root

Files: create `shared/world-hydrology.ts`; modify `shared/generated-world.ts`, `src/world/generation/generate.ts`, `encode.ts` and relevant contract/server/client tests.

```ts
interface WorldHydrology {
  drySinks: number[];
  rivers: { cells: number[]; next: number[]; runoff: number[] };
  lakes: { id: number; cells: number[]; level: number;
    outlet: { cell: number; next: number; runoff: number } | null }[];
}
```

- [x] Add failing round-trip and malformed-network tests: mismatched arrays, repeated river sources, duplicate lake membership, missing lake metadata, invalid lake depth, disconnected members, nonadjacent edges, broken continuation, uphill flow and river/lake cycles.
- [x] Implement authoritative shared decoding/indexes, sparse encoding and water-aware field/surface validation; add exact inspected water facts. Preserve existing climate/resource transport equality checks.
- [x] Integrate drainage with lake/frozen-lake biomes and sparse aquatic sites. Assert unchanged elevation and seed repeatability through actual workers, reload and HTTP.

### 3. Browser display and inspection — UI agent

Files: modify `src/renderer/generated-world.ts`, `world-terrain-texture.ts`, `src/components/GeneratedWorldLab.tsx` and styles; add `tests/browser/hydrology.spec.ts`.

- [x] Add failing browser cases for actual river/lake visibility, exact freshwater/lake inspection, Rivers toggle, seam continuity and stable water pixels across tile arrivals.
- [x] Render the shared graph and lake biomes, with clear scale-dependent river widths and no alternate visual-only geography.
- [x] Preserve the existing climate, texture, resource, selection, retry, viewport-cache and authored-study scenarios.

### 4. Review, full verification and handoff — root

- [x] Independently review the core, transport and rendering; fix material findings with regressions.
- [x] Run `npm run check`, `npm run bench:world` and multi-seed visual review at the exact running lab URL.
- [x] Update README, architecture, workflow and this brief with verified results, measurements, revision and exact next action. Preserve a local checkpoint; user visual review remains the completion of this slice's experience assessment.

## Initial hydrology implementation evidence

The final complete `npm run check` passed on the finished source: architecture (48 files), pinned Platec source/artifact integrity, TypeScript, **131 headless/process tests**, production build and **91 development/production Chromium scenarios**. Log: `/tmp/chronicle-hydrology-complete-check.log`. This is local verification; CI was not run here.

Red runs reproduced missing generation integration, the actual Chronicle weak-outlet dry-terminal failure, impossible lake levels, undeclared open-lake low banks and invalid submerged resources before their fixes. Existing island climate assertions now apply to exposed land; lake classification has separate exact metadata/resource tests. No latitude, island variety or climate quota assertions were reduced.

Independent core review included 2,000 additional small rough-terrain probes. Contract review prompted fixes for lake containment, submerged resources and total terminal flow bounds. All lakes now validate shoreline containment except their declared outlet destination. Final independent review confirms no remaining material finding across core, contract, integration and UI.

Browser regressions cover actual river/northern-lake inspection, outlet/seam pixels, literal climate colors, tile-arrival stability and exact freshwater/lake values. Two test-harness failures were reproduced and fixed: anchored wheel zoom near a clamped pole needed navigation that brings the selected location into view; Chromium's captured response body became unavailable despite a rendered map. The actual-world test now reads expected values from the real host API after rendering and checks its identity against the canvas. Trace evidence did not establish the underlying browser cancellation cause; production also exhibited it. All original integration/visibility assertions remain.

Baseline is `7ad1bde`; the Hydrology 01 checkpoint is the commit containing this completed brief. The final lab/API check at `http://127.0.0.1:5173/` returned HTTP200, displayed `climate-4:large:Chronicle`, 3,572 river edges and 963 lakes, with no page errors. Exact next action: user visually reviews river/lake distribution and inspection using the steps below; choose the next geography slice from that feedback. No unresolved implementation issue remains in this slice; the static-model limits below still apply.


## Measurements and visual evidence

`npm run bench:world` on Node 24.20.0/Linux, Ryzen 7 7800X3D (16 logical CPUs, 30.5 GiB RAM), generator 4 `Chronicle` large: generation/validated delivery 6,949.9 ms; cached manifest 7.4 ms; manifest 2,860,404 B; all detail tiles 9,207,218 B; largest tile 295,086 B; slowest cached tile 1.4 ms. Observed process RSS 566.0 MiB (increase 343.3 MiB, includes workers and diagnostic reads); event-loop max 10.5 ms. This is one immutable geography preview, not simultaneous simulation capacity. Log: `/tmp/chronicle-hydrology-benchmark.log`.

All eight seed/size combinations passed actual generation, encoding and fresh manifest/every-tile parsing. Across them the maximum manifest was 2,956,173 B, tile 295,086 B, complete bundle 12,149,522 B, within 4 MiB/512 KiB/20 MiB. Newly flooded land and lake counts are:

| Seed | Standard new-water cells (% existing land) | Large new-water cells (% existing land) | Large lake bodies |
| --- | ---: | ---: | ---: |
| Chronicle | 784 (2.52%) | 2,485 (2.00%) | 963 |
| Elsewhere | 609 (1.81%) | 1,832 (1.37%) | 958 |
| Harbors | 858 (2.63%) | 3,218 (2.46%) | 1,212 |
| Sundown | 475 (1.41%) | 1,636 (1.22%) | 898 |

New depth never exceeded 20 m. Cached accepted Chronicle/Elsewhere/Harbors large elevation arrays matched byte-for-byte; core immutability tests protect elevation inputs. End-to-end timings recorded under concurrent verification load are diagnostic, not unloaded benchmarks. Exact results/hashes: `/tmp/chronicle-hydrology-e2e-metrics.json`. The standalone drainage core adds roughly 100–141 ms at standard and 336–440 ms at large in the earlier isolated probes; returned typed arrays occupy 8 MiB at large resolution.

Actual browser review at `http://127.0.0.1:5173/` inspected Chronicle, Elsewhere, Harbors and Sundown at fit/detail. Terrain relief, coastlines and water/vegetation textures remain visible; river strokes follow the graph and widths increase with accumulated runoff. The exact northern frozen-lake inspection was also checked. Screenshots are under `/tmp/chronicle-hydrology-{seed}-{fit,detail}.png` and `/tmp/chronicle-hydrology-live-results/`. These temporary artifacts support this local review; automated scenarios and durable measurements remain in the repository.

## User review steps

1. Keep `npm start` running and open/refresh `http://127.0.0.1:5173/`.
2. Use the default Chronicle large world. Rivers are enabled on Biomes; toggle them to compare, then zoom in to follow tributaries and lake outlets.
3. Click a river or lake cell. Check mapped freshwater, lake surface/bed/depth and closed versus open drainage.
4. Try Elsewhere, Harbors and Sundown, and compare fit/detail views. Temperature and moisture retain literal climate colors.

The user has now accepted the rivers/lakes and considers this area done. Geography was then to continue after that review; seasonal water, further climate detail or terrain refinements could be separate slices. Fertility, settlements and political provinces were not started here. VISION.md now keeps geography annual and read-only except its slice G1.


## River rendering correction — current iteration

User feedback: rivers look like visual noise at overview and right-angle wiring at detail. Keep the accepted generation/drainage and exact inspection. This bounded correction changes renderer geometry and cartographic emphasis only; generator4/protocol3 and payloads remain unchanged.

Build connected reaches once from the authoritative graph, splitting at forks and lake boundaries. Preserve shared junction/terminal centers; round ordinary bends between edge midpoints within the routed cell. Unwrap longitude before smoothing and draw each periodic copy after terrain. Use one quieter water-colored stroke with stronger/wider main rivers. Low-flow reaches are hidden at overview and revealed progressively through detail zoom; visibility remains monotone downstream. The original cells continue to drive selection and water facts.

Acceptance: smooth connected bends, legible larger rivers, substantially fewer minor marks at overview, detail access to small streams, exact seam/lake/fork connections, unchanged climate colors/terrain/resource picking and tile-arrival pixels. Add focused geometry and browser regressions, inspect the actual four seeds, obtain independent review and rerun the full gate. Initial new overview suppression regression failed against the old renderer, then passed after implementation. Final `npm run check` passed: architecture (49 files), Platec integrity, types, **135 headless/process tests**, build and **95 development/production browser scenarios**. Log: `/tmp/chronicle-river-style-check.log`. New geometry tests cover edge preservation, shared forks, bounded bends, seams, lake outlet separation and width/visibility hierarchy. Browser tests verify weak streams disappear only at overview, remain inspectable, and reappear at detail while a strong river stays visible. Existing tests pass without skipped or weakened assertions. Independent review found no material issue.

Visual checks at the exact running lab covered Chronicle, Elsewhere, Harbors and Sundown at fit plus Chronicle detail. The final pass also strengthened major overview strokes after visual inspection; final screenshots are `/tmp/chronicle-river-style-final-{fit,detail}.png`. The Chronicle graph still has 4,202 channel/outlet edges; 341 are eligible for overview drawing under the display threshold, and all become eligible at detail. This reduces tiny marks without changing the generated graph or water facts. The lab returned `climate-4:large:Chronicle` with no page errors. Diagnostic last-frame timings were 1.30 ms at fit and 7.40 ms at detail under concurrent verification load; these are not a benchmark of sustained frame rate.

Baseline is `0e9444b`; the river-style checkpoint is the commit containing this correction record. No generator, shared contract, or resource-generation file changed. README and the river-control note explain the zoom hierarchy; launch remains `npm start`. User visual acceptance is now recorded; the next geography slice chosen afterward was Fertility 01.


### Earlier visual rejection and diagnosis (superseded by user acceptance)

The user still sees visual noise after the renderer correction. Their screenshots show the earlier bright outlined strokes. The user confirmed `http://127.0.0.1:5173/`; a fresh fetch from that address serves `riverPathCommands` and no old `#8ac5cf` stroke. Fresh browser captures show the muted renderer. A hard refresh was requested to distinguish a stale open tab from the current display; its result is pending. Do not assume the user has seen the updated renderer or treat refreshing as a solution to the broader design issue.

Independent read-only analysis of the current cached Chronicle large manifest found 963 lakes, of which 589 are one cell and 843 occupy at most four cells. These remain visible when Rivers is disabled. The 956 river reaches have a median length of three edges. At fit, 79 reaches are visible, including 49 of only one to three edges; all reaches reappear by 4× zoom. Collapsing lakes to network nodes yields 386 separate drainage systems, 227 with at most five edges. Larger systems commonly terminate in closed lakes. These observations distinguish fragmented geographic structure from stroke appearance.

Exact next action: resolve the refresh comparison, then discuss a bounded drainage morphology prototype if the user wants longer coherent main rivers and fewer tiny permanent basins. That would change generation and requires an explicit scope decision, generator-version bump, conservation/terrain/transport regressions and the full gate. Do not silently rewrite the simulation the user likes, manufacture decorative connections, or make another color-only pass. Existing tests establish consistency, not visual or geographic realism. No new tests were needed for this diagnosis; last runtime gate remains 135 headless and 95 browser scenarios at `ffce09d`. Fresh river-on/off captures are `/tmp/chronicle-river-diagnose-{fit,mid}-{on,off}.png`.


### User acceptance and next direction

The latest explicit user response is: “That looks great. And I'd consider that area done.” This closes Hydrology 01’s visual review. The hard-refresh outcome was not separately reported; do not claim that stale code was proven to be the cause. The structural observations above remain historical diagnostics, not an active request to redesign drainage. No runtime changes followed `ffce09d`.

As of 10 September 2026 (since superseded: Fertility 01 followed, and VISION.md now defines the next work): the user asks for entirely geographical next-step ideas. Discuss soils/fertility, landforms, coastal geography or geological resource coherence as separate small slices. No next feature is selected or authorized for implementation yet. Keep countries, settlements and simulation gameplay deferred. This acceptance update changes documentation only; no runtime checks were rerun.
