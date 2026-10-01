# Worldgen 01 — larger worlds and regional climate

> Note, 1 October 2026: the authored Verdant/Aster studies, the civilization slices that followed this brief and `npm run bench:backend` were removed at the user's request; the local branch `archive/civilization-v1` keeps them as reference. Statements below about them are historical, and next-step statements below are superseded by [VISION.md](../VISION.md), which keeps geography annual and read-only except its slice G1. The authored Verdant/Aster studies are unrelated to VISION.md's generated study seeds of the same names.

Status: implemented, verified locally and visually accepted by the user, 10 September 2026. Baseline `1879fd1`; working tree was clean at startup. The user found the landmass shapes artificial, authorized external generation tools, and explicitly chose a full generator replacement with all checks passing. The replacement, independent code review and complete iteration gate are finished. The user explicitly approved the resulting terrain and asked to discuss the next steps.

## Observable outcome and scope

The default browser lab displays reproducible, fictional continents and islands with varied coastlines, inland seas, mountain ranges, broad plains, cold northern and southern regions, and warmer tropical lowlands. Biomes follow annual temperature, moisture and elevation. The full-resolution terrain surface retains land/water texture at overview and detail zoom. Inspect climate layers, exact cells and sparse resource sites; change the seed or resolution and regenerate.

Both presets cover 510 million km² including oceans. Standard is 512 × 256 cells; large is 1,024 × 512 (524,288 cells). Both refine the same tectonic base. Coordinates wrap east/west, end at separate polar oceans, and use equal-area cylindrical latitude (`asin(1 − 2v)`). Cell IDs are row × width + column within a versioned world identity. Map lengths are distorted near the poles; travel distances will need a separate geographic model.

This slice covers unclaimed geography, annual climate, transport, rendering and inspection. It adds no countries, provinces, settlements, conquest, extraction, saves or time simulation. Verdant and Aster were then authored regression studies. Country-created provinces were then the agreed future design; the fixed Verdant province groups were not generated political borders. VISION.md now defines civilization territory as regions derived in the simulation layer.

## Implementation

The selected [Mindwerks Platec](https://github.com/Mindwerks/plate-tectonics) core models plate movement, collision, folding and erosion. Its C++ source is pinned at `2a27c4fb137c657517bca62122b9de80e6b8c255` and compiled with Emscripten 6.0.5 into the committed `vendor/platec/platec.mjs`. Complete source, local patches, compiler options, checksums, LGPL notices and runtime licenses accompany the artifact. Ordinary setup remains `npm ci`, then `npm start`; no Python service, compiler or runtime asset download is required.

The evaluation ran actual native/WASM Platec prototypes and noise-library prototypes. The noise-only candidates still produced blob-like or tangled landmasses. Platec gave more useful continental interiors, coastal embayments and collision-related relief. Reproduced upstream issues were fixed before adoption: owned simulation destruction, zero-divisor/signed-overflow seed arithmetic, low-eight-bit starting-field repetition and duplicated vertical noise. A larger initial noise domain supports several crust cores before plate movement; it does not stamp final continents or biome palettes.

Generation is asynchronous inside the existing disposable Piscina workers. Each job creates a fresh WASM module, checks uint32 seed input, bounds work to 2,500 steps, caps its WASM heap at 128 MiB, validates and copies the final height field, and destroys the owned simulation even after failure. Buffer reads use the current heap after possible memory growth. The WASM bound is separate from V8 and total process memory. Host jobs default to a 20-second deadline including queue time; configuration permits at most 25 seconds, inside the browser's 30-second request deadline.

Both sizes simulate a fixed 512 × 256 crust field. The projection selects an ocean cut, discards approximately 1% of donor rows at each side and fades the outer 3% of atlas latitude to polar oceans. A separate interpolated land/water mask preserves straits independently of adjacent mountain height. Deterministic local relief, an explicit dimensionless-crust-to-metres conversion, and coastal grading feed the existing climate pipeline. This is an artistic tectonic approximation on a projected toroidal donor, not spherical or calibrated geological simulation. Narrow donor cuts and polar transitions can still modify geography near the poles.

Generator version **3** intentionally revises old seed layouts. Generated-world protocol **2** is unchanged. The worker supplies a validated immutable manifest, the full-resolution biome/elevation surface and pre-encoded 128 × 128 tiles. Manifest, tile and full-bundle limits remain 3 MiB, 512 KiB and 20 MiB. The host retains at most two bundles and shares in-flight work; the browser requests at most four tiles concurrently and caches sixteen. Cancellation, stale-response protection, explicit retries and preservation of the last valid map remain required.

Climate retains latitude temperature, elevation cooling, smooth regional variation, circulation moisture bands, ocean-to-land winds, rain shadows and local crosswind moisture mixing. Moisture is an annual availability index, not measured rainfall. Every biome is derived from the climate/terrain fields; there are no per-island quotas. Resource sites remain sparse climate/terrain-dependent potential deposits, with all eleven classes then defined reachable in the default world. Rivers and drainage followed in Hydrology 01; ocean currents, seasons and a fuller resource-geology model were then possible follow-ups. VISION.md keeps geography annual and read-only except its slice G1 (failing-seed fix, tin and oil sites).

The browser/renderer/shared/core/HTTP/worker boundaries remain enforced by Biome and negative import scenarios, including access to the vendored engine. `npm run check:tectonics` detects drift between the committed source, build settings and artifact. The authored `vendor/platec/runtime.ts` is linted; generated glue and C++ source retain their own build/integrity checks. Climate-only and vendor-runtime-only live edits are tested through isolated copies of the actual application, workers, HTTP and proxy.

## Regression criteria and corrections

The previous delivery retained full-resolution texture and climate tests but still used an ellipse/ridge landmass template. Those tests and its full-detail rendering remain; this correction replaces the generator completely.

Geography checks retain reproducibility, seed differences, three substantial default continents, at least two continents in representative multi-seed cases, smaller islands, coastal concavity, varied continental proportions, mountain belts in different orientations, and broad lowlands occupying more than 45% of land. The representative suite includes Chronicle, Elsewhere, Harbors and Sundown. Sundown adds two similarly sized major continents; the existing dominant-versus-comparable mass-ratio requirement is retained without changing its bounds. These named scenarios demonstrate supported arrangements, not a guarantee that every seed contains the same number of continents.

Two old numeric definitions required correction for this real-world direction. The old continent cutoff represented about 9.7 million km², excluding [Australia's 7.69 million km²](https://www.ga.gov.au/scientific-topics/national-location-information/dimensions/australias-size-compared). A resolution-independent 1% of the planet (5.1 million km²) includes a small continent while preserving the three-continent default requirement. The old component helper also discarded islands below 155,000 km² at standard resolution; island diagnostics now retain components from ten cells. Neither change inserts terrain to satisfy a count.

A blanket maximum of four biomes on every island up to 1.95 million km² was also inconsistent with the no-quota design. Real elevated islands can contain [lowland forest, rainforest, subalpine and alpine ecosystems](https://www.usgs.gov/geology-and-ecology-of-national-parks/ecology-hawaii-volcanoes-national-park). Diagnostic islands with additional categories have varying elevation and moisture, including a 670,000 km² subtropical island with five lowland categories. The final scenario checks warm equatorial lowlands and cold high-latitude lowlands on several islands in both hemispheres, plus substantially cooler mountains on an island spanning less than three degrees of latitude. Every island cell must still match its actual climate classifier. This protects geographic differences and altitude-related ecosystems without a biome-count quota.

New failing-then-passing regressions cover seed-byte repetition, WASM memory/lifecycle errors, invalid output, source/artifact drift, a narrow sea strait beside high crust, and islands lost by an overly broad donor crop. Real worker cancellation followed by successful generation protects recovery; isolated vendor edits protect reload/cache invalidation. An old API assertion that a fixed equatorial cell must be warm was replaced with exact agreement between transported temperature, moisture and elevation and its source tile, since an equatorial mountain is legitimately cold. Separate climate tests retain warm tropical lowlands and cold poles.

## Verification and review

The final `npm run check` exited successfully on Node 24.20.0/Linux: architecture across **45 runtime files**, source/compiler/artifact integrity, TypeScript, **115 headless tests** (46.3 seconds; zero failures, skips or cancellations), production build, and **83 Chromium scenarios** (43 development, 40 production; 1.1 minutes). All final runtime and test edits preceded this run. Verification exercised the working tree based on `1879fd1`; only handoff documentation and Git checkout attributes changed afterward. An isolated checkout with `core.autocrlf=true` also passed artifact integrity; the pinned source and build script retain LF bytes across checkout settings. `git diff --check` passed. These are local results; no remote CI execution is claimed.

Independent reviewers examined the pinned library/runtime, seed and destruction fixes, async worker integration, request limits, module boundaries and final geographic adapter. No material findings remain. The final five projection tests passed independently, including straits and donor-island preservation at three resolutions. The reviewers also assessed the geographic acceptance corrections instead of accepting changed expectations merely to obtain a pass.

The final vendored source passed seven native ASan/UBSan probes, including formerly failing uint32 seeds at production base resolution, with finite outputs and no sanitizer diagnostics. Two Emscripten rebuilds reproduced the final artifact and manifest byte for byte. The pinned production WASM and a native build with matching final source/optimization settings produced identical Chronicle base heights across all 131,072 cells. These are bounded probes, not a comprehensive upstream audit or a guarantee across arbitrary compilers. See `vendor/platec/README.md` for rebuild steps, licenses and detailed evidence.

The exact running review URL **http://127.0.0.1:5173/** was inspected with generator 3. Chronicle, Elsewhere, Harbors and Sundown have different visible coastlines and range arrangements. Sundown also demonstrates two similarly sized major continents. Overview, temperature and close-zoom screenshots were inspected; land, water and resource glyph textures remain visible. The default reports 124,247 land cells and 1,934 resource sites. The browser probe reported no page errors. Observed draw times were 0.7–1.1 ms at overview and 7.9 ms at detail scale 9.03 with eight loaded tiles; these are observations, not an FPS guarantee.

### Measurements

`npm run bench:world`, Node 24.20.0/Linux, AMD Ryzen 7 7800X3D (16 logical processors), 30.5 GiB host memory; default Chronicle large world:

| Measurement | Observed result |
|---|---:|
| First generation and manifest delivery | 6,236.1 ms |
| Cached manifest delivery | 7.2 ms |
| Full terrain and climate overview response | 2,672,375 bytes |
| All 32 detail tiles combined | 9,200,123 bytes |
| Largest detail tile | 295,086 bytes |
| Slowest cached tile response | 1.3 ms |
| Process RSS including workers and diagnostic reads | 453.9 MiB |
| RSS increase during measurement | 231.5 MiB |
| Sampled event-loop maximum delay | 10.3 ms |

This measures one immutable world, not simultaneous-world or simulation capacity. Tectonic generation takes several seconds and is more expensive than the previous shape-based generator. Standard resolution uses fewer output cells and tiles but performs the same base tectonic simulation. Generation stays off the browser and HTTP event loop; cached views remain inexpensive.

## User review and handoff

Keep `npm start` running and refresh **http://127.0.0.1:5173/**. Inspect Chronicle at fit and close zoom, switch Temperature/Moisture, select a resource site, and compare Elsewhere, Harbors and Sundown using **World seed → Regenerate world**. Changing between Standard and Large preserves the underlying geography while adding cell detail.

The local checkpoint `ee7f7d3` on `feat/atlas-01` is titled **Replace world landmasses with pinned Platec generation**, based on `1879fd1`; it contains the verified runtime/tests and final handoff documentation. No known functional or review issue remains. User visual review is complete and positive. Next action at the time: agree on the next small slice of the then specification's M1 ("World and atlas", unrelated to VISION.md's M1). That specification's §4 placed drainage/freshwater and fertility before viable founding sites, capitals and country-created provinces. Rivers and freshwater were the proposed immediate slice, a recommendation rather than implementation approval; Hydrology 01 and Fertility 01 followed. This acceptance update changes documentation only; the recorded implementation checks above remain the last full gate.

Climate references: [NOAA regional climate ingredients](https://sos.noaa.gov/catalog/live-programs/wind-water-mountains-ingredients-of-regional-climate/) and [subtropical dry regions](https://oceanservice.noaa.gov/facts/horse-latitudes.html). Numeric parameters remain game-model approximations.
