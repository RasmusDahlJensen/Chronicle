# Chronicle

A living-world atlas, built one small, reviewable slice at a time.

Chronicle is intended to grow into a substantial simulation project. Features arrive gradually, with shared modules, established infrastructure packages, and automated checks protecting the architecture as it grows.

The React + TypeScript + Vite browser lab opens a **seeded world preview** with varied continent sizes and coastlines, mixed island groups, localized mountain ranges, cold northern and southern poles, and warmer tropical regions. The large preset has **1,024 × 512 cells (524,288)**; standard has 512 × 256. Biomes follow annual temperature and moisture, with elevation cooling and mountain rain shadows. Inspect the biome, temperature, moisture and fertility layers and exact cell data.

A local Node/Fastify backend generates and validates geography in a bounded worker pool. The browser first receives full-resolution terrain for the overview, then requests climate and resource detail tiles as needed. Most cells have no special resource site. Scattered sites have terrain-appropriate locations and extraction requirements; mining, research and developed production chains are not running yet. The tribal simulation now gathers food using nearby terrain and recognized early food opportunities. Deterministic rivers, tributaries, inland lakes and frozen lakes now add surface water to the geography. Seasonal weather and remote user accounts remain future slices. The lab adds local saved instances, daily food decisions, a founding capital and country-owned territorial claims.

A fresh map starts empty. Click **New game** above the map to create a fresh civilization at a random suitable location. It also replaces an existing civilization: its old towns, territory and history disappear from the active map, and the new game starts paused at Month 1 with one capital of 250 people. Each click uses a fresh history seed and game instance. Refresh resumes that new game. Former host saves are retained but no longer selected by this browser.

For a custom first spawn on an empty map, use **Spawn civilization**, then **Random location** or **Choose on map**. Manual placement requires habitable land, growing potential of at least 25 and annual temperature of at least 5 °C. Invalid locations explain the requirement; **Cancel placement** returns to inspection. The optional **History seed** controls identity, preferences and random placement. Leave it blank for a fresh history, or reuse it with the same geography, starting location and rules to reproduce decisions. A new name, color and starting location are saved with this world session. This slice supports one civilization per active world.

The page-level **Play** button advances the entire active simulation by one 30-day month per second. **Pause** stops it; **Advance 1 month** runs exactly one month while paused. The calendar starts at Month 1, Year 1, with twelve months per year. Each month runs thirty deterministic daily food, population and territory steps, then saves the complete result. Geography stays static.

Use **Locate civilization** to inspect the capital and **Country growth** panel. A new country has one capital and a compact starting claim around it. Colored outlines show national claims; the dashed overlay shows land actually worked by its people. Claimed land costs food and labor to maintain even when it is not worked. No satellite towns are founded in this iteration.

Food support allows births and population growth. Provisional annual birth/death rates are 4%/2% over a 360-day year; hunger can cause additional deaths. Expansion now shares a food and labor budget with paid food-gathering and logistics improvements. A claim assigns six workers; food and logistics projects assign twelve and ten. Two project slots are available initially, with more earned through logistics. The AI checks combined work, supplies and future territorial upkeep before starting projects. It can pause expansion to rebuild reserves, release unsupported outer claims, or collapse if nobody survives. Extra reserves gradually spoil. The panel explains the current decision and exposes cumulative food and population accounting. Expect visible claims over months and population growth over years; a supported population grows roughly 2% annually. Geography and support constrain the eventual footprint.

**Country investment** shows completed improvements and their effects, active project progress, shared food/worker reservations, investment spending and work history. Better gathering uses existing accessible food; logistics lowers support effort and improves travel reach. These are paid improvements with rising costs, not farming or mining technology. **Country decisions** shows seeded preferences, strategic choices, alternatives and reasons. Countries can claim land, improve food gathering, improve logistics or consolidate. Claimed cells and worked cells are distinct; mineral extraction, research, villages and diplomacy are later work. Earlier saves retain their original settlement and AI behavior, including fixed population and additional communities.

**Reset simulation** asks for confirmation and returns to the original chosen location, starting supplies and Month 1. The new browser flow uses a separate saved-session reference: earlier tribal sessions do not automatically appear. Their host saves are preserved for compatibility. Reloading a newly spawned session restores its identity, AI commitments and progress. Earlier saved sessions keep their original settlement rules; resetting an earlier monthly session explicitly enables the current one-capital investment rules at day zero using its original history seed.

**New game** replaces the civilization. **Regenerate world** rebuilds geography; with the same world seed and resolution it retains the current game. To change the map too, regenerate with your chosen world seed/resolution, then click **New game**. **Reset simulation → Confirm reset simulation** in the sidebar replays the same civilization from one starting capital, retaining its name, color and history seed while enabling current investment rules. If new-game creation fails, **Retry simulation** reopens the same pending new game; refreshing also retains its identity.

The host saves each completed batch before reporting it to the browser. Refreshing the page or restarting the host restores the same local instance. Leaving the page stops advancement when its observer release reaches the host; if a browser disappears without sending one, its lease expires within 30 seconds. A previously running world resumes when reopened; a manually paused world stays paused. Time spent offline is never simulated. Browser local storage remembers which saved instance to open, so use the same browser profile and address to return to it. Clearing browser storage loses that shortcut, not the host save.

The generated world starts without political provinces. Countries will create them around capital settlements, with additional towns supporting production. Capturing a provincial capital will immediately transfer that province's ownership while cell-level resistance can remain. The current founding capital anchors national claims. Formal provincial administration and conquest mechanics are not implemented. The retained Verdant study's 77 provinces are authored test groups. See [the province design](docs/CHRONICLE_SPEC.md#3-world-hierarchy-and-ownership).

## First setup on your PC

Open a terminal in the **Chronicle repository folder**, where `package.json` lives. Use Node **24.20.0**, also recorded in `.nvmrc`. Check your installed version with:

```sh
node --version
```

If you already use [nvm](https://github.com/nvm-sh/nvm#usage) on Linux/macOS or [nvm-windows](https://docs.nvm-windows.com/) on Windows, it can install and select that version:

```sh
nvm install 24.20.0
nvm use 24.20.0
```

Install the project's locked dependencies on first setup and after dependency updates:

```sh
npm ci
```

The plate generator is already bundled for Node 24. You do not need Python, a C++ compiler, or Emscripten to install or run Chronicle. Its pinned source, licenses and rebuild instructions are in [vendor/platec](vendor/platec/README.md).

## Start the lab

From the Chronicle folder, run:

```sh
npm start
```

Open **http://127.0.0.1:5173/** in your browser after the terminal prints **Chronicle ready**. Startup includes worker warmup; the first world takes several seconds to generate. This one command starts the terrain backend and frontend together. Keep the terminal running while you use the lab; press **Ctrl+C** in that terminal to stop both and their workers. `npm run dev` starts the same setup.

The development backend chooses its own local port automatically. No extra terminal, port configuration, account, API key, Docker, or separate database installation is needed. SQLite is included in the supported Node runtime. Both servers listen on this PC only.

The default seed is **Chronicle**, at **Large · 1,024 × 512** resolution. Enter another **World seed** and choose **Regenerate world** to try different geography. The same seed, resolution and generator version reproduce the same world. Generator 5 uses a bundled plate-tectonics generator for continental structure and collision-shaped relief. Both presets refine the same fixed 512 × 256 tectonic base, so changing resolution preserves the continental layout. Standard resolution reduces the number of final cells and detail tiles; both perform the same tectonic simulation. Both presets cover 510 million km² including oceans; large cells cover about 973 km² each. These are equal-area map cells, with stretched polar shapes; screen distances are not uniform ground distances.

Choose **Biomes**, **Temperature**, or **Moisture** to inspect the climate. The temperature layer shows annual mean °C. Moisture is a relative annual availability index, not measured rainfall. The preview models latitude, elevation cooling, broad wind/moisture regions and mountain rain shadows; it does not simulate seasons or weather.

Choose **Fertility** for natural growing potential on a 0–100 scale. Brown indicates low potential, green higher potential; blue water is excluded. Click land to see the exact score and its warmth, moisture, estimated soil, regional slope and drainage factors. These are terrain-based game estimates, not measured soil chemistry or crop yields. Nearby rivers can indicate estimated alluvial soil; freshwater proximity does not provide automatic irrigation. Farming, fertilizers and crop-specific suitability are not implemented. Like climate, fertility uses a sampled overview and exact detail tiles.

Drag to pan, scroll or use **+ / −** to zoom, and choose **Fit map** to return to the overview. The world wraps east–west and stops at the poles. Zoom in to see terrain textures and reveal **Resource sites**. Click any cell for its exact latitude, elevation, temperature, moisture, biome, resource site and extraction requirement. Most cells have no special site. The biome overview preserves every terrain cell; climate overview values are sampled. Inspection always loads the exact cell's detail tile.

**Rivers** are enabled by default on the Biomes layer; toggle them to compare the underlying terrain. The overview emphasizes larger rivers; zoom in to reveal smaller streams and follow tributaries and lake outlets. Rounded paths follow the same underlying river cells. Click river or lake cells to inspect freshwater access, relative river flow, or lake area, surface level and depth. Elevation on a lake cell is its bed elevation. Closed lakes are inland water whose salinity is not modeled; they are not automatically labeled freshwater. Weak streams can end in dry basins. Flow is a moisture-based relative index, not measured discharge; seasonal availability is not simulated. Lakes and rivers remain visible without fetching detail tiles.

For keyboard exploration, focus the map with Tab: arrows inspect neighboring cells, Enter selects the focused location, Shift + arrows pan, + / − zoom, Home fits the map, and Escape clears selection.

If generation fails, **Retry generation** retries the requested seed while retaining any previous map. If a detail request fails, the overview remains visible and **Retry detail** retries it. A rendering error offers **Retry canvas**.

### Local saves

Saved tribal worlds live in **`.chronicle/`** in the repository folder. This directory is ignored by Git and the development watchers and is not served by Vite. Keep it on a local disk. To choose another directory, set **`CHRONICLE_DATA_DIR`** before running the normal command; paths are resolved from the working directory. Directories inside `public/` or `dist/` are rejected because those are published or replaced during builds. Two Chronicle hosts cannot own the same save directory at once. Stop the first host or use a different directory when running a second instance. The automated tests use separate directories and do not touch your saves.

For a backup, stop Chronicle with **Ctrl+C**, wait for it to exit, then copy the entire `.chronicle` directory somewhere safe. Restore with Chronicle stopped: preserve the current directory first, then put the backup directory back at the same path. Copy the entire directory, including any SQLite sidecar files; do not copy only an active database file. A failed or incompatible save produces an explicit error and is retained for recovery. After repairing a temporary storage problem, use **Retry save and pause** to save the retained state and pause the clock; **Retry simulation** rereads state after a connection problem. There is no automatic migration or silent replacement with a new world.

### Retained studies

**Verdant Reach** remains available through **Regional atlas study** or **http://127.0.0.1:5173/?scenario=verdant**. This authored regional map has 64,000 cells at 4 km² each, 329 sites and 77 connected unclaimed province groups. **Click land once to select its province**, highlighting the whole province and showing its area, cell count, country status and resource totals. **Click inside that province again to select a cell**; **click that selected cell again to return to its province**. A different cell inside the province moves cell selection, and a different province starts at province level again. **Back to province** and **Clear selection** are also available. Water opens directly at cell scope.

**Province resources** counts sites, not quantities or yields. Toggle **Resources**, **Provinces**, or **Cell grid**, and use **Resource filter** to locate a particular resource; display filters do not change province totals or selection level.

Choose **Reset atlas** to fetch a freshly constructed copy of Verdant Reach. Loading failures offer **Retry atlas**; a failed reload retains the last displayed map. The atlas is a fixed regional study, so reset reproduces the same geography and resources.

In Verdant, keyboard arrows inspect cells, Enter or Space follows the province → cell → province cycle, and Escape moves back a level. Shift + arrows pan, + / − zoom, and Home fits the map.

The original **Aster Island** study remains available through Verdant's header link or **http://127.0.0.1:5173/?scenario=aster**. It retains its water/plains/hills map and **Reset terrain** control.

### Development updates

Frontend component and style edits update through Vite. `npm start` also watches the backend, workers, shared contracts, world/fixture modules, the vendored runtime and rebuilt artifact, and launch configuration: relevant changes restart the combined application and its worker pool, then Vite reloads the open browser tab. You keep the same browser address. Map selection and camera state reset after a restart; saved tribal progress restores. Writing saves does not trigger a development restart.

If an edit contains an error, the terminal reports it and the watcher waits for a correction. Save the corrected file to restart automatically. After dependency installation, Node upgrades, or changes to the watch configuration itself, stop the terminal with Ctrl+C and run `npm start` again. Built serving with `npm run serve` or `npm run preview` requires an explicit rebuild/restart when code changes.

## Verify

```sh
npm run check
```

This is the required check before handing off each implementation iteration. It runs architecture and vendored-artifact integrity checks, TypeScript, headless world/backend/process tests, a production build, and Chromium scenarios against both development and built serving. Live-edit regressions run isolated copies of the real application; they never edit the map you are reviewing. Install Chromium using the command below before the first complete check.

The architecture checks use Biome to detect import cycles, undeclared dependencies, development packages in runtime code, and imports that cross the browser/core/backend boundaries. For focused work, use `npm run check:architecture`, `npm run typecheck`, or `npm test`; finish the iteration with the complete `npm run check`.

`npm run study:country` runs eight reproducible ten-year development studies on Chronicle/Elsewhere geography at both resolutions and two history seeds. It compares current investment rules with released growth rules on identical starting conditions, printing yearly population, claims and food, paid improvements, concurrency and elapsed time. It uses the same generator/simulation as the host and does not modify your saves. These balance observations complement the regression gate; they are not a many-country capacity benchmark.

`npm run study:planner` runs the isolated country-planner comparison and writes an offline browser report to [docs/research/game-ai/planning/report.html](docs/research/game-ai/planning/report.html). It compares the current policy, an HTN library adapter, and bounded outcome search on the preserved Helara checkpoint and contrasting starts. Allow several minutes; progress is printed per scenario/policy. Open the resulting HTML file in your browser; with the lab running it is also available at **http://127.0.0.1:5173/docs/research/game-ai/planning/report.html**. The report has scenario, policy and metric selectors plus recorded plans and forecasts. This is a development experiment: your live civilization still uses the released policy, and the command does not read or modify your current saves. The pinned planner candidate is a development dependency, not part of the live simulation. See [methodology and limitations](docs/research/game-ai/planning/README.md).

Install Chromium once (and again after a Playwright update). To run just the build and browser scenarios:

```sh
npx playwright install chromium
npm run test:browser
```

Headless tests run at most four test files concurrently so generation-heavy scenarios do not overwhelm the workers under test; their deadline and overload assertions remain unchanged. Browser checks use two concurrent scenarios so shared host admission stays bounded. They need ports **4173 and 4174** free; the normal lab can continue on 5173. Failures retain traces/screenshots under `test-results/` and an HTML report under `playwright-report/`. A browser regression checks that generating reports preserves the open map and selection. The GitHub workflow in `.github/workflows/check.yml` installs the pinned Node/dependencies/Chromium and runs the same `npm run check` on pushes and pull requests once the workflow is pushed.

Extend the suite alongside each change, especially when data crosses a module or process boundary:

| Connection or rule | Regression coverage |
|---|---|
| WASM runtime → validated owned heights, cleanup, seed repeatability and artifact integrity | `tests/tectonics.test.ts` |
| Toroidal donor → bounded latitude, preserved straits/islands and refinement across resolutions | `tests/tectonic-geography.test.ts` |
| Real tectonic job cancellation → released worker → successful next world | `tests/tectonic-worker.test.ts` |
| Seed/elevation/climate → varied landmasses, coherent islands, sparse resources and exact tiles | `tests/world-generation.test.ts`, `tests/geography.test.ts`, `tests/climate-regions.test.ts` |
| Generated-world workers → bounded cache → HTTP, cancellation and restart | `tests/generated-world-server.test.ts`, `tests/generated-world-store.test.ts`, `tests/generated-world-reload.test.ts` |
| Exact terrain surface → textured overview and stable terrain as detail arrives | `tests/world-surface.test.ts`, `tests/browser/generated-world-texture.spec.ts` |
| Overview/detail HTTP → bounded browser cache → climate layers and cell inspection | `tests/world-client.test.ts`, `tests/browser/generated-world.spec.ts` |
| Terrain/climate/water → fertility factors → validated scores and browser layer | `tests/fertility.test.ts`, `tests/fertility-contract.test.ts`, `tests/browser/fertility.spec.ts` |
| Legacy identity initialization → shared worker/cache/HTTP compatibility | `tests/civilization.test.ts`, `tests/civilization-server.test.ts`, `tests/world-client.test.ts` |
| Seeded preferences → committed local decisions → worker saves/reload and browser explanations | `tests/country-ai.test.ts`, `tests/settlement-runtime.test.ts`, `tests/browser/country-ai.spec.ts` |
| New game → fresh civilization → old observer release, saved-reference replacement, retry and refresh | `tests/browser/new-game.spec.ts` |
| Food/settlement decisions → migration and persistence → territorial renderer | `tests/settlement-core.test.ts`, `tests/settlement-runtime.test.ts`, `tests/territory-border.test.ts`, `tests/browser/settlements.spec.ts` |
| Tribe core → storage worker → SQLite → host restart and browser clock | `tests/tribe-core.test.ts`, `tests/simulation-client.test.ts`, `tests/simulation-server.test.ts`, `tests/tribe-launcher.test.ts`, `tests/tribe-recovery.test.ts`, `tests/browser/tribe.spec.ts`, `tests/browser/tribe-marker.spec.ts` |
| Cells → provinces → countries; biome/resource data and province site totals | `tests/atlas-world.test.ts`, `tests/atlas-response.test.ts` |
| Click/back selection → matching province/cell highlight and inspector | `tests/atlas-selection.test.ts`, `tests/browser/biomes.spec.ts` |
| Workers → validated HTTP responses; admission and shutdown | `tests/compute.test.ts`, `tests/server.test.ts`, `tests/atlas-server.test.ts` |
| Launcher → proxy/built server; live source changes → new workers | `tests/launcher.test.ts`, `tests/dev-reload.test.ts` |
| HTTP → browser validation → visible map, inspection, reset/retry | `tests/browser/`, run against development and production serving |

`npm run check:tectonics` verifies that the vendored source, compiler settings and generated artifact match their recorded hashes; it is included in `npm run check`. Maintainers changing the C++ core or compiler settings need Emscripten 6.0.5 and `npm run build:tectonics`; those changes reach the running lab after the artifact is rebuilt. See the vendor instructions.

Every reproduced bug gets a regression that fails for that bug. Preserve existing checks and add tests for new behavior and its connections; passing checks do not replace visual review of the actual running lab.

On Linux, Playwright's installer reports any missing system browser dependencies.

To measure the current tribal checkpoint/RPC workload in an isolated temporary save directory, run `node scripts/bench-tribe.ts`. It reports sixteen authored 250-person states and durable step batches; it does not benchmark future food, population or history systems.

## Run the built application

```sh
npm run build
npm run serve
```

Open **http://127.0.0.1:4173/**. Fastify serves the built frontend and terrain API directly, with no Vite runtime. `npm run preview` is an alias for this same built-app mode. Rebuild and restart to include later source changes. Press **Ctrl+C** to stop the host and workers. This mode still listens on this PC only; remote access and unattended hosting are not configured.

## Backend diagnostics and limits

The local API is available through either running browser URL:

- `/api/health` returns `{ "status": "ok" }` when the HTTP service responds.
- `/api/ready` reports worker activity, admission usage, and configured limits. It returns HTTP 503 when busy or unavailable.
- `/api/atlas` returns Verdant Reach as `{ "protocolVersion": 3, "world": … }`; `cell.resource` is a resource ID or explicit `null` for no site.
- `/api/terrain` retains Aster Island as `{ "protocolVersion": 1, "world": … }`.
- `/api/world?seed=Chronicle&size=large` returns a generated-world protocol-4 manifest with full-resolution elevation/biome surface data, an authoritative river/lake graph, a 256 × 128 climate/fertility overview, units, settings, generator version and biome counts.
- `/api/world/civilization?seed=Chronicle&size=large` retains the legacy identity initialization snapshot for compatibility; the browser no longer requests or displays it. Its response is separately versioned (at most one identity, name, color and founding cell; maximum 8 KiB), tied to the same geography identity.
- `/api/world/tile?seed=Chronicle&size=large&x=0&y=0` returns the corresponding 128 × 128 detail tile. Coordinates are tile indices. `size` accepts `standard` or `large`; seeds accept 1–64 ASCII letters, numbers, spaces, dots, underscores and hyphens.

The authored atlas/terrain payloads retain their 100,000-cell and 8 MiB limits. Generated-world manifests are bounded to 4 MiB, detail tiles to 512 KiB, and complete worker bundles to 20 MiB. The host retains at most two immutable generation bundles, including jobs in progress, and shares requests for the same seed/settings. A failed job can be retried; disconnecting the last waiting observer cancels unfinished work. All map requests share the same worker pool and response admission allowance. Each tectonic job uses a fresh WASM instance with a 128 MiB heap cap and a 2,500-step limit; the heap cap does not bound total process memory.

For example, open **http://127.0.0.1:5173/api/ready** during development. The terminal includes structured request logs; an `x-request-id` response header connects a request to its log entry. Overload and computation deadlines produce explicit retryable failures while the browser retains its last valid map.

To measure the large seeded world, overview and detail delivery:

```sh
npm run bench:world
```

This runs the actual application and workers without opening a network listener, validates every returned tile and the initial civilization snapshot, and reports local timing, payload and memory measurements. It measures one immutable world, not simultaneous simulation capacity. [Civilization 01](docs/features/civilization-01.md) records the current results.

To measure the Verdant Reach fixture pipeline:

```sh
npm run bench:backend -- --atlas
```

The original Aster Island benchmark remains available for comparison with the recorded backend baseline:

```sh
npm run bench:backend
```

The fixture benchmark commands start and stop a temporary loopback server and report the selected fixture, runtime, hardware, configuration, request outcomes, health latency, event-loop delay and process memory. These measure fixture delivery and HTTP responsiveness; future simulation throughput needs its own workload. The [Atlas 02 brief](docs/features/atlas-02.md) records atlas results, and [Backend 02](docs/features/backend-02.md) retains the earlier baseline evidence.

The defaults need no configuration. For development measurements, these environment variables are read when the host starts; invalid values stop startup:

| Variable | Default | Allowed values |
|---|---|---|
| `CHRONICLE_WORKERS` | 2, or 1 when only one processor is available | Integers 1–8 |
| `CHRONICLE_QUEUE_LIMIT` | 4 waiting jobs | Integers 0–32 |
| `CHRONICLE_JOB_TIMEOUT_MS` | 20000, including queue time | Integers 100–25000; clients allow 30 seconds for the full response |
| `CHRONICLE_LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |

Map response admission is also bounded to worker count plus queue allowance until responses finish or close. These conservative limits do not promise a particular user capacity. No `--host` option or network exposure is provided.

## Troubleshooting

- **`node` or `npm` is not found:** install Node 24.20.0, reopen the terminal, and retry. If nvm is already installed, use the commands above.
- **`package.json` cannot be found:** move into the Chronicle repository folder before running npm commands.
- **Port 5173 or 4173 is busy:** stop the existing lab or built-app terminal with Ctrl+C, then retry. The commands above keep their stated ports instead of silently choosing another one.
- **The map cannot load:** choose **Retry generation** in the world preview, **Retry atlas** in Verdant, or **Retry terrain** in Aster. For missing generated-world detail, use **Retry detail**. If it still fails, check the launch terminal for errors, stop it with Ctrl+C, and run `npm start` again.
- **The new interface appears but the atlas is unavailable after an update:** check the terminal for a failed restart or source error. A lab started before automatic watching was installed needs one Ctrl+C and `npm start`; subsequent host-side source edits restart automatically.
- **Production build is missing:** run `npm run build` before `npm run serve` or `npm run preview`.
- **A `CHRONICLE_...` configuration value is rejected:** correct or remove that environment variable, then restart. Ordinary launches need none of these variables.
- **Canvas rendering fails:** the generated world offers **Retry canvas**. If it still fails, reload the page or try another browser. In retained studies, rendering failure disables reset until the page is reloaded.

## Project record

- [Active rivers/lakes slice and verification](docs/features/hydrology-01.md)
- [Accepted plate-generated world](docs/features/worldgen-01.md)
- [Scattered resources and province/cell selection](docs/features/resources-01.md)
- [Development reliability and verification](docs/features/dev-01.md)
- [Atlas slice and visual review status](docs/features/atlas-02.md)
- [Backend foundation and verification evidence](docs/features/backend-02.md)
- [Backend research and technology decisions](docs/BACKEND_RESEARCH.md)
- [Original local backend slice](docs/features/backend-01.md)
- [React migration](docs/features/react-01.md)
- [Original terrain slice](docs/features/atlas-01.md)
- [Architecture decisions](docs/ARCHITECTURE.md)
- [Development workflow](docs/WORKFLOW.Md)
- [Product specification](docs/CHRONICLE_SPEC.md)
- [Agent instructions](AGENTS.md)

## Code map

- `src/main.tsx`: React entry point.
- `src/App.tsx`: selects the default generated world, `?scenario=verdant` regional study, or `?scenario=aster` original study.
- `src/components/GeneratedWorldLab.tsx`, `src/api/generated-world.ts`, and `src/renderer/generated-world.ts`: world preview controls, bounded tile loading, and map rendering.
- `src/components/RegionalAtlas.tsx` and `AtlasCanvas.tsx`: atlas controls, cell inspection, and the React canvas adapter.
- `src/components/LegacyTerrainLab.tsx` and `TerrainMap.tsx`: retained Aster study.
- `src/api/atlas.ts` and `terrain.ts`: browser requests and validation for their respective map contracts.
- `scripts/start.ts`: combined development launcher and standalone built-app launcher.
- `nodemon.json`: host-side development watch scopes and graceful restart settings, used by `npm start` and `npm run dev`.
- `server/app.ts`: Fastify API, static serving, request limits, and lifecycle.
- `server/config.ts`: validated backend configuration.
- `server/compute.ts` and `server/workers/`: bounded execution of disposable terrain jobs.
- `shared/atlas.ts`: biome/resource atlas types, protocol-3 schema with nullable resource sites, hierarchy/connectivity validation, and size limits.
- `shared/terrain.ts`: retained protocol-1 terrain schema and validation.
- `shared/studies.ts`: authored study identifiers and seeded-world jobs accepted by compute.
- `shared/generated-world.ts`: generated-world identity, settings, compact numeric fields, manifest/tile validation, limits and exact cell inspection.
- `src/world/generation/`: seeded geography, donor projection/refinement, climate, sparse resources and tile encoding; imported by workers, never the browser or HTTP layer.
- `vendor/platec/`: pinned C++ source, bundled WASM/ESM, authored runtime helper and licenses; `scripts/build-platec.ts` rebuilds or verifies the artifact.
- `server/generated-world-store.ts`: bounded immutable generation cache and shared-request cancellation.
- `shared/http.ts`: API error schemas and browser validation.
- `src/world/atlas.ts`: biome/resource catalogs and area/resource summaries; `terrain.ts` retains the original terrain summaries.
- `src/world/resources.ts`: resource site kinds and extraction technology requirements, separate from visual styling.
- `src/fixtures/verdant-reach.ts` and `aster-island.ts`: deterministic authored regional and original island fixtures.
- `src/renderer/world-terrain-texture.ts`: full-resolution generated terrain shading and world-coordinate land/water textures.
- `src/renderer/biome-atlas.ts`: biome textures, layers, bounded camera, and cell selection, independent of React; `atlas.ts` retains the original renderer.
