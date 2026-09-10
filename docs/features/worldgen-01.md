# Worldgen 01 — larger worlds and regional climate

Status: visual correction implemented, independently reviewed and locally verified; awaiting user visual review, 10 September 2026. Baseline `dc37006`; working tree was clean at the start of this correction. This checkpoint contains the correction described below. This remains the active slice.

## User review correction

The user found the overview blurry, land/water textures diminished, and continents too similar: tall landmasses with a central north–south mountain range and repeated biome palettes. Inspection confirmed a 256 × 128 sampled overview enlarged across the canvas, minimal surface texture, and a repeated ellipse/ridge generation template.

- Preserve every coastline and elevation cell in the biome overview with a compact full-resolution surface (signed 16-bit elevation and unsigned 8-bit biome, base64). Keep sampled climate overview columns and exact inspection tiles. Protocol 2 explicitly adds this surface; bound the manifest to 3 MiB and keep existing tile, bundle, concurrency and cache limits.
- Restore land and water texture with deterministic world-coordinate visual patterns and relief at overview/detail, preserving literal climate-layer colors and avoiding tile-edge seams.
- Replace the repeated landmass/ridge template with irregular continents of different proportions and latitude extents, bays, peninsulas, regional island groups and localized curved ranges of varied orientation. Keep large lowland regions, climate-derived biomes, cold poles and sparse resources. Increment generator version to 2; previous seeds intentionally produce revised geography.
- Add failing regressions for full surface fidelity/validation, visible small features and water/land texture, and multi-seed geographic diversity. Preserve existing lifecycle, retry, cache, exact selection, resource and climate scenarios. Inspect overview/detail screenshots across multiple seeds, measure transport/generation again, obtain independent review and run the complete gate before handoff.

Implementation ownership: generation agent owns morphology and its new geography tests; renderer agent owns texture rendering and new browser visual regressions; root owns the surface contract/encoding, integration, documentation and verification. A further visual probe reproduced one-row humidity stripes downstream of small coastal differences. A terrain-weighted latitude mixing step now spreads annual moisture locally; its regression failed before the fix and the existing windward/rain-shadow contrast still passes. Independent transport review found that a validly shaped detail tile could contradict the surface; tile validation now compares both terrain fields cell by cell, with a failing-then-passing client-cache regression. No gameplay or hosting scope is added.

## Observable outcome

The default browser lab shows a reproducible, fictional world with continents, islands, mountains, cold northern and southern poles, warm tropical lowlands, and regional biomes derived from temperature and moisture. Select biomes, temperature, or moisture; zoom and inspect an actual cell's climate and resource site. The existing Verdant and Aster studies remain explicit regression scenarios.

User-approved scope: a larger seeded geography preview, proposed 1,024 × 512 benchmark, climate layers and explanations, server generation, and end-to-end tests. This is annual climate, not weather, seasonal simulation, tectonics, full drainage, settlement, or extraction gameplay. No political provinces are generated. Sparse resources remain potential sites.

## Design and implementation plan

Use the existing Node/Piscina host and React/Canvas stack, Node 24.20.0, with no new infrastructure dependency. Geography and climate live in `src/world/generation/` and cannot depend on browser, HTTP, or React. New shared world contracts remain distinct from protocol-3 authored atlases; do not weaken their validation.

- [x] **1. Shared contract and deterministic generation.** Add `shared/generated-world.ts`, generation noise, geography, climate, and encoding modules. Test latitude symmetry, monotonic sea-level temperature, elevation cooling, wet/dry classification, mountain rain shadows, reproducibility, different seeds, regional coherence, both polar regions, bounded sparse resources and absence of provinces. Run the new headless tests failing before implementation, then passing. A cell ID is row × width + column. Coordinates wrap east/west. Use equal-area cylindrical latitude (`asin(1-2v)`), 510 million km² total including ocean, and report area separately from resolution. Large is 1,024 × 512; standard is 512 × 256. Geography settings and generator version are part of identity.
- [x] **2. Bounded host transport.** Extend disposable worker jobs with `{ kind: 'world', seed, size }`. Generate and validate a complete world in a worker, returning a manifest and pre-encoded 128 × 128 tile bodies. `/api/world?seed=Chronicle&size=large` returns the manifest with a full-resolution terrain surface and a 256 × 128 climate overview; `/api/world/tile?seed=Chronicle&size=large&x=0&y=0` returns a detail tile. Cache at most two complete immutable generation bundles; share in-flight requests, bound admission, and evict only completed entries. Validate query parameters, world identity, lengths, field ranges, counts and tile coordinates. Preserve deadlines, error envelopes, shutdown, watch/reload behavior, and old endpoints. Test actual workers/routes plus malformed, overload, retry, and cache behavior.
- [x] **3. Browser preview.** New generated-world API client, tiled canvas renderer, and lab component. Default `/` is the generated world; `?scenario=verdant` and `?scenario=aster` preserve studies. Keep reusable biome/resource metadata and resource glyphs. Draw an overview immediately, request visible detail at useful zoom, cap concurrency and retain a bounded tile cache. Support pan, horizontal wrapping, zoom, fit, keyboard selection, climate layers, seed/resolution controls, clear error/retry states, and exact cell inspection. Preserve the displayed world on failed replacement; prevent old requests from replacing new state. Keep generation out of the browser. Add dev/production browser scenarios for drawing, climate colors, identity, tile selection, stale requests, retries and resource inspection.
- [x] **4. Verify and review.** Measure large-world worker generation, payload sizes, memory, and browser interaction. Run focused checks during implementation and the complete `npm run check` before handoff; independent review is required. Check the exact live review URL and inspect a screenshot. Update README, architecture, workflow and spec to match actual behavior and limitations, then checkpoint the working changes.

Climate uses a symmetric latitude temperature baseline, elevation cooling, smooth regional variation, broad circulation moisture bands, and ocean-to-land wind transport with orographic precipitation/rain shadows. Derive biomes from these fields without per-island biome quotas. Moisture is a normalized annual availability index, not a claimed rainfall measurement. Rivers, seasonality, ocean currents and detailed geology are follow-up work. Resource rules use climate/terrain suitability and sparse spacing; they are not a full geological model.

The transport has its own version, immutable world key, units, limits, and compact parallel numeric columns (elevation metres, temperature tenths °C, moisture thousandths, biome/resource codes). Zero resource code means no special site. The browser validates before use; an invalid tile never silently becomes geography. The biome surface preserves every terrain cell; climate overview values are samples, so cell inspection always obtains the full-resolution tile.

## Verification and handoff

Final `npm run check` passed on Node 24.20.0/Linux: architecture checks across **41 runtime files**, TypeScript, **99 headless tests** (zero failures/skips), production build, and **83 Chromium scenarios** (43 development, 40 production; 1.1 minutes). All final code and test changes preceded this run. Verification exercised the working tree based on `dc37006` plus this correction. `git diff --check` passed. These are local results; no remote CI run is claimed. Everyday commands remain `npm ci`, then `npm start`.

Independent transport, renderer and final geography/climate reviews are complete. The surface/detail contradiction finding was fixed and re-reviewed; a new client test first failed with an accepted contradictory tile, then passed with rejection and explicit retry. The tile-arrival browser test now proves that all four tiles reached the renderer before comparing identical terrain pixels. No material review findings remain. An additional independent probe verified windward/leeward moisture differences of 327.5 at standard resolution and 202.5 at large resolution, both above the existing 150 threshold.

The earlier viewport-cache regression remains protected. Because the biome surface now retains exact terrain independently of tiles, the late-offscreen eviction scenario runs on Temperature, where tiles still supply exact detail. It continues to require that the stationary viewport preserves its detailed pixels after more than sixteen delayed tile responses. Existing authored studies, resource hit testing, failed replacement/retry, cancellation, selection races, watch/reload and cache limits all remain in the complete gate.

New regression scenarios were observed failing before their fixes: unsampled islands missing from the overview; flat constant-biome water/land patches; terrain changing when tiles arrived; repeated continent/range proportions; isolated one-row humidity stripes; and accepted detail data contradicting the full terrain surface. Tests now cover each behavior and its relevant connection.

The exact review URL **http://127.0.0.1:5173/** was verified after the final code changes. Screenshots for **Chronicle**, **Elsewhere**, and **Harbors** were inspected at overview, along with desktop, detail and mobile views. The live default reports generator 2, 160,200 land cells and 1,959 sites. Temperature view, exact cell inspection, and iron cell 146,941 with its Mining requirement were checked without browser errors. Full-resolution drawing measured approximately 1.0–1.3 ms at overview and 13.6 ms at detail scale 6.83 with four loaded tiles in this session; these are observations, not an FPS guarantee.

To review: keep `npm start` running and refresh the URL. Compare the whole map and close zoom, then try the three seeds above with Regenerate world. Generator 2 intentionally revises the old seed layouts; repeated generation with the same seed, resolution and version remains reproducible. Switch climate layers and inspect resource sites as before. Next action: user visual review, then choose the next small slice together. No known functional issue remains; full drainage, geological simulation and gameplay are still outside this slice.

### Measurements and design limits

`npm run bench:world` on Node 24.20.0/Linux, AMD Ryzen 7 7800X3D (16 logical processors), 30.5 GiB host memory: default `Chronicle` large world, 524,288 cells, 160,200 land cells and 1,959 resource sites.

| Measurement | Observed result |
|---|---:|
| First generation and manifest delivery | 2,227.7 ms |
| Cached manifest delivery | 6.2 ms |
| Full terrain and climate overview response | 2,662,361 bytes |
| All 32 detail tiles combined | 9,040,359 bytes |
| Largest detail tile | 293,322 bytes |
| Slowest cached tile response | 1.3 ms |
| Process RSS including workers and diagnostic reads | 452.8 MiB |
| RSS increase during measurement | 231.9 MiB |
| Sampled event-loop maximum delay | 10.2 ms |

This is one local immutable-world measurement, not a simultaneous-world or simulation-capacity promise. The complete generation bundle is never transferred to a viewer. The full terrain surface increases the initial response from roughly 0.57 MB in generator 1 to 2.66 MB while retaining the 3 MiB response bound, 512 KiB tile bound and 20 MiB host-bundle bound.

The morphology uses seeded regional shapes and finite mountain belts, with coastal elevation grading; it does not simulate tectonic plates or erosion. The sample seeds now vary connected-continent counts and relative sizes, with unequal coasts, broad plains and mixed islands. Biome distribution still follows annual climate rather than per-island quotas. The default retains all eleven resource classes with sparse spacing; gold and uranium remain rarer than iron. Initial testing's independent hash-stream regression remains in place.

Climate references: [NOAA's regional climate ingredients](https://sos.noaa.gov/catalog/live-programs/wind-water-mountains-ingredients-of-regional-climate/) and [subtropical dry regions](https://oceanservice.noaa.gov/facts/horse-latitudes.html). The numeric generator parameters are game-model approximations, not calibrated Earth-system predictions.
