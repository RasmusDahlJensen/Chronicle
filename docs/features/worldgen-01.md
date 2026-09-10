# Worldgen 01 — larger worlds and regional climate

Status: implemented and locally verified, awaiting user review, 10 September 2026. Baseline `84b0b2e`, initially clean. This replaces the proposed founding-capital slice as the active work.

## Observable outcome

The default browser lab shows a reproducible, fictional world with continents, islands, mountains, cold northern and southern poles, warm tropical lowlands, and regional biomes derived from temperature and moisture. Select biomes, temperature, or moisture; zoom and inspect an actual cell's climate and resource site. The existing Verdant and Aster studies remain explicit regression scenarios.

User-approved scope: a larger seeded geography preview, proposed 1,024 × 512 benchmark, climate layers and explanations, server generation, and end-to-end tests. This is annual climate, not weather, seasonal simulation, tectonics, full drainage, settlement, or extraction gameplay. No political provinces are generated. Sparse resources remain potential sites.

## Design and implementation plan

Use the existing Node/Piscina host and React/Canvas stack, Node 24.20.0, with no new infrastructure dependency. Geography and climate live in `src/world/generation/` and cannot depend on browser, HTTP, or React. New shared world contracts remain distinct from protocol-3 authored atlases; do not weaken their validation.

- [x] **1. Shared contract and deterministic generation.** Add `shared/generated-world.ts`, generation noise, geography, climate, and encoding modules. Test latitude symmetry, monotonic sea-level temperature, elevation cooling, wet/dry classification, mountain rain shadows, reproducibility, different seeds, regional coherence, both polar regions, bounded sparse resources and absence of provinces. Run the new headless tests failing before implementation, then passing. A cell ID is row × width + column. Coordinates wrap east/west. Use equal-area cylindrical latitude (`asin(1-2v)`), 510 million km² total including ocean, and report area separately from resolution. Large is 1,024 × 512; standard is 512 × 256. Geography settings and generator version are part of identity.
- [x] **2. Bounded host transport.** Extend disposable worker jobs with `{ kind: 'world', seed, size }`. Generate and validate a complete world in a worker, returning a manifest and pre-encoded 128 × 128 tile bodies. `/api/world?seed=Chronicle&size=large` returns the manifest with a 256 × 128 overview; `/api/world/tile?seed=Chronicle&size=large&x=0&y=0` returns a detail tile. Cache at most two complete immutable generation bundles; share in-flight requests, bound admission, and evict only completed entries. Validate query parameters, world identity, lengths, field ranges, counts and tile coordinates. Preserve deadlines, error envelopes, shutdown, watch/reload behavior, and old endpoints. Test actual workers/routes plus malformed, overload, retry, and cache behavior.
- [x] **3. Browser preview.** New generated-world API client, tiled canvas renderer, and lab component. Default `/` is the generated world; `?scenario=verdant` and `?scenario=aster` preserve studies. Keep reusable biome/resource metadata and resource glyphs. Draw an overview immediately, request visible detail at useful zoom, cap concurrency and retain a bounded tile cache. Support pan, horizontal wrapping, zoom, fit, keyboard selection, climate layers, seed/resolution controls, clear error/retry states, and exact cell inspection. Preserve the displayed world on failed replacement; prevent old requests from replacing new state. Keep generation out of the browser. Add dev/production browser scenarios for drawing, climate colors, identity, tile selection, stale requests, retries and resource inspection.
- [x] **4. Verify and review.** Measure large-world worker generation, payload sizes, memory, and browser interaction. Run focused checks during implementation and the complete `npm run check` before handoff; independent review is required. Check the exact live review URL and inspect a screenshot. Update README, architecture, workflow and spec to match actual behavior and limitations, then checkpoint the working changes.

Climate uses a symmetric latitude temperature baseline, elevation cooling, smooth regional variation, broad circulation moisture bands, and ocean-to-land wind transport with orographic precipitation/rain shadows. Derive biomes from these fields without per-island biome quotas. Moisture is a normalized annual availability index, not a claimed rainfall measurement. Rivers, seasonality, ocean currents and detailed geology are follow-up work. Resource rules use climate/terrain suitability and sparse spacing; they are not a full geological model.

The transport has its own version, immutable world key, units, limits, and compact parallel numeric columns (elevation metres, temperature tenths °C, moisture thousandths, biome/resource codes). Zero resource code means no special site. The browser validates before use; an invalid tile never silently becomes geography. Overview values are samples, so cell inspection always obtains the full-resolution tile.

## Verification and handoff

Final `npm run check` passed on Node 24.20.0/Linux: architecture checks across 39 runtime files, TypeScript, **92 headless tests** (zero failures/skips), production build, and **77 Chromium scenarios** (40 development, 37 production; 1.1 minutes). Verification exercised the working tree based on `84b0b2e` plus all Worldgen 01 changes in this checkpoint. `git diff --check` passed. These are local results; no remote CI run is claimed. Everyday commands remain `npm ci`, then `npm start`.

Independent core/host review and final browser/integration review are complete. Review reproduced one material navigation issue: delayed offscreen requests could evict detail for the stationary current viewport. The new browser regression failed before the fix. The cache now protects visible tiles while remaining bounded to sixteen, and clears protection when the view moves or returns to overview. Independent re-review ran all seven client tests and the original live reproduction with 24 delayed tiles; the visible four tiles and detailed image were preserved without refetching. No material findings remain. The complete gate above was rerun after this fix.

The exact review URL **http://127.0.0.1:5173/** was verified after the final code changes: default world, climate layer and exact iron cell inspection with Mining requirement, without browser errors. Desktop, detail and mobile screenshots were inspected. Verdant and Aster remain fully tested regression scenarios.

To review: run `npm start` if needed, open the URL, switch between Biomes/Temperature/Moisture, zoom to resource markers, and click a cell for its climate and extraction requirements. Try another World seed, then restore Chronicle with Regenerate world. The seed and generator version explain reproducibility; planet area and resolution are distinct. Next action: user visual review, then choose the next small slice together. No founding-country, persistence, or simulation work has started.

### Measurements and design limits

`npm run bench:world` on Node 24.20.0/Linux, AMD Ryzen 7 7800X3D (16 logical processors), 30.5 GiB host memory: default `Chronicle` large world, 524,288 cells, 153,814 land cells and 1,938 resource sites.

| Measurement | Observed result |
|---|---:|
| First generation and manifest delivery | 1,944.7 ms |
| Cached manifest delivery | 2.5 ms |
| Overview response | 566,270 bytes |
| All 32 detail tiles combined | 9,057,466 bytes |
| Largest detail tile | 294,162 bytes |
| Slowest cached tile response | 1.6 ms |
| Process RSS including workers and diagnostic reads | 421 MiB |
| RSS increase during measurement | 199.7 MiB |
| Sampled event-loop maximum delay | 10.6 ms |

This is one local immutable-world measurement, not a simultaneous-world or simulation-capacity promise. The complete generation bundle is never transferred to a viewer.

The default world has four major continents, a polar landmass, and smaller islands. An independent component probe found small islands mostly contain one to three related biomes. Tests protect spatial coherence and a limited island palette without imposing biome quotas in generation.

Testing found correlated resource selection when adjacent hash seeds used an insufficient avalanche mix; a conditional-choice regression failed with unreachable resource classes. Two avalanche rounds and an independent rarity draw fixed this; all default resource types remain reachable and rare minerals remain rarer than iron. The rain-shadow synthetic case was adjusted to standard-width geography so its mountains sit within ocean-moisture reach, preserving the original 150-point wet/lee difference assertion.

Visual review checked the actual running `http://127.0.0.1:5173/` overview, temperature layer and exact cell inspector with no page errors. Full-resolution sample redraw with four cached tiles measured 2.9 ms in that browser session; this is an observation, not an FPS guarantee.

Climate references: [NOAA's regional climate ingredients](https://sos.noaa.gov/catalog/live-programs/wind-water-mountains-ingredients-of-regional-climate/) and [subtropical dry regions](https://oceanservice.noaa.gov/facts/horse-latitudes.html). The numeric generator parameters are game-model approximations, not calibrated Earth-system predictions.
