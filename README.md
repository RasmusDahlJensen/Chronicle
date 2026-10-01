# Chronicle

A living-world atlas, built one small, reviewable slice at a time.

Chronicle is intended to grow into a substantial simulation project. Features arrive gradually, with shared modules, established infrastructure packages, and automated checks protecting the architecture as it grows.

The React + TypeScript + Vite browser lab opens a **seeded world preview** with varied continent sizes and coastlines, mixed island groups, localized mountain ranges, cold northern and southern poles, and warmer tropical regions. The large preset has **1,024 × 512 cells (524,288)**; standard has 512 × 256. Biomes follow annual temperature and moisture, with elevation cooling and mountain rain shadows. Inspect the biome, temperature, moisture and fertility layers and exact cell data.

A local Node/Fastify backend generates and validates geography in a bounded worker pool. The browser first receives full-resolution terrain for the overview, then requests climate and resource detail tiles as needed. Most cells have no special resource site. Scattered sites have terrain-appropriate locations and extraction requirements; mining, research and production are not running. Deterministic rivers, tributaries, inland lakes and frozen lakes add surface water to the geography. Seasonal weather is not modeled.

The page shows geography only. It has no civilizations, countries, provinces, simulation clock or saved games yet; [docs/VISION.md](docs/VISION.md) describes the planned game and its civilizations.

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

The development backend chooses its own local port automatically. No extra terminal, port configuration, account, API key, Docker, or database installation is needed. Both servers listen on this PC only.

The default seed is **Chronicle**, at **Large · 1,024 × 512** resolution. Enter another **World seed** and choose **Regenerate world** to try different geography. The same seed, resolution and generator version reproduce the same world. Generator 5 uses a bundled plate-tectonics generator for continental structure and collision-shaped relief. Both presets refine the same fixed 512 × 256 tectonic base, so changing resolution preserves the continental layout. Standard resolution reduces the number of final cells and detail tiles; both perform the same tectonic simulation. Both presets cover 510 million km² including oceans; large cells cover about 973 km² each. These are equal-area map cells, with stretched polar shapes; screen distances are not uniform ground distances.

Choose **Biomes**, **Temperature**, or **Moisture** to inspect the climate. The temperature layer shows annual mean °C. Moisture is a relative annual availability index, not measured rainfall. The preview models latitude, elevation cooling, broad wind/moisture regions and mountain rain shadows; it does not simulate seasons or weather.

Choose **Fertility** for natural growing potential on a 0–100 scale. Brown indicates low potential, green higher potential; blue water is excluded. Click land to see the exact score and its warmth, moisture, estimated soil, regional slope and drainage factors. These are terrain-based game estimates, not measured soil chemistry or crop yields. Nearby rivers can indicate estimated alluvial soil; freshwater proximity does not provide automatic irrigation. Farming, fertilizers and crop-specific suitability are not implemented. Like climate, fertility uses a sampled overview and exact detail tiles.

Drag to pan, scroll or use **+ / −** to zoom, and choose **Fit map** to return to the overview. The world wraps east–west and stops at the poles. Zoom in to see terrain textures and reveal **Resource sites**. Click any cell for its exact latitude, elevation, temperature, moisture, biome, resource site and extraction requirement. Most cells have no special site. The biome overview preserves every terrain cell; climate overview values are sampled. Inspection always loads the exact cell's detail tile.

**Rivers** are enabled by default on the Biomes layer; toggle them to compare the underlying terrain. The overview emphasizes larger rivers; zoom in to reveal smaller streams and follow tributaries and lake outlets. Rounded paths follow the same underlying river cells. Click river or lake cells to inspect freshwater access, relative river flow, or lake area, surface level and depth. Elevation on a lake cell is its bed elevation. Closed lakes are inland water whose salinity is not modeled; they are not automatically labeled freshwater. Weak streams can end in dry basins. Flow is a moisture-based relative index, not measured discharge; seasonal availability is not simulated. Lakes and rivers remain visible without fetching detail tiles.

For keyboard exploration, focus the map with Tab: arrows inspect neighboring cells, Enter selects the focused location, Shift + arrows pan, + / − zoom, Home fits the map, and Escape clears selection.

If generation fails, **Retry generation** retries the requested seed while retaining any previous map. If a detail request fails, the overview remains visible and **Retry detail** retries it. A rendering error offers **Retry canvas**.

### Development updates

Frontend component and style edits update through Vite. `npm start` also watches the backend, workers, shared contracts, world modules under `src/world`, the vendored runtime and rebuilt artifact, and launch configuration: relevant changes restart the combined application and its worker pool, then Vite reloads the open browser tab. You keep the same browser address. Map selection and camera state reset after a restart.

If an edit contains an error, the terminal reports it and the watcher waits for a correction. Save the corrected file to restart automatically. After dependency installation, Node upgrades, or changes to the watch configuration itself, stop the terminal with Ctrl+C and run `npm start` again. Built serving with `npm run serve` or `npm run preview` requires an explicit rebuild/restart when code changes.

## Verify

```sh
npm run check
```

This is the required check before handing off each implementation iteration. It runs architecture and vendored-artifact integrity checks, TypeScript, headless world/backend/process tests, a production build, and Chromium scenarios against both development and built serving. Live-edit regressions run isolated copies of the real application; they never edit the map you are reviewing. Install Chromium using the command below before the first complete check.

The architecture checks use Biome to detect import cycles, undeclared dependencies, development packages in runtime code, and imports that cross the browser/core/backend boundaries. For focused work, use `npm run check:architecture`, `npm run typecheck`, or `npm test`; finish the iteration with the complete `npm run check`.

Install Chromium once (and again after a Playwright update). To run just the build and browser scenarios:

```sh
npx playwright install chromium
npm run test:browser
```

Headless tests run at most four test files concurrently so generation-heavy scenarios do not overwhelm the workers under test; their deadline and overload assertions remain unchanged. Browser checks use two concurrent scenarios so shared host admission stays bounded. They need ports **4173 and 4174** free; the normal lab can continue on 5173. Failures retain traces/screenshots under `test-results/` and an HTML report under `playwright-report/`. A browser regression checks that writing generated test artifacts preserves the open map and selection. The GitHub workflow in `.github/workflows/check.yml` installs the pinned Node/dependencies/Chromium and runs the same `npm run check` on pushes and pull requests once the workflow is pushed.

Extend the suite alongside each change, especially when data crosses a module or process boundary:

| Connection or rule | Regression coverage |
|---|---|
| WASM runtime → validated owned heights, cleanup, seed repeatability and artifact integrity | `tests/tectonics.test.ts` |
| Toroidal donor → bounded latitude, preserved straits/islands and refinement across resolutions | `tests/tectonic-geography.test.ts` |
| Real tectonic job cancellation → released worker → successful next world | `tests/tectonic-worker.test.ts` |
| Seed/elevation/climate → varied landmasses, coherent islands, sparse resources and exact tiles | `tests/world-generation.test.ts`, `tests/geography.test.ts`, `tests/climate-regions.test.ts` |
| Drainage → river/lake graph → validated water contract and river paths | `tests/hydrology.test.ts`, `tests/hydrology-integration.test.ts`, `tests/world-hydrology.test.ts`, `tests/river-paths.test.ts`, `tests/browser/hydrology.spec.ts` |
| Generated-world workers → bounded cache → HTTP, cancellation and restart | `tests/generated-world-server.test.ts`, `tests/generated-world-store.test.ts`, `tests/generated-world-reload.test.ts` |
| Exact terrain surface → textured overview and stable terrain as detail arrives | `tests/world-surface.test.ts`, `tests/browser/generated-world-texture.spec.ts` |
| Overview/detail HTTP → bounded browser cache → climate layers and cell inspection | `tests/world-client.test.ts`, `tests/browser/generated-world.spec.ts` |
| Terrain/climate/water → fertility factors → validated scores and browser layer | `tests/fertility.test.ts`, `tests/fertility-contract.test.ts`, `tests/browser/fertility.spec.ts` |
| Workers → validated HTTP responses; admission and shutdown | `tests/compute.test.ts`, `tests/server.test.ts` |
| Launcher → proxy/built server; live source changes → new workers | `tests/launcher.test.ts`, `tests/dev-reload.test.ts`, `tests/browser/reload.spec.ts` |
| HTTP → browser validation → visible map, inspection, regenerate/retry | `tests/browser/`, run against development and production serving |

`npm run check:tectonics` verifies that the vendored source, compiler settings and generated artifact match their recorded hashes; it is included in `npm run check`. Maintainers changing the C++ core or compiler settings need Emscripten 6.0.5 and `npm run build:tectonics`; those changes reach the running lab after the artifact is rebuilt. See the vendor instructions.

Every reproduced bug gets a regression that fails for that bug. Preserve existing checks and add tests for new behavior and its connections; passing checks do not replace visual review of the actual running lab.

On Linux, Playwright's installer reports any missing system browser dependencies.

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
- `/api/world?seed=Chronicle&size=large` returns a generated-world protocol-4 manifest with full-resolution elevation/biome surface data, an authoritative river/lake graph, a 256 × 128 climate/fertility overview, units, settings, generator version and biome counts.
- `/api/world/tile?seed=Chronicle&size=large&x=0&y=0` returns the corresponding 128 × 128 detail tile. Coordinates are tile indices. `size` accepts `standard` or `large`; seeds accept 1–64 ASCII letters, numbers, spaces, dots, underscores and hyphens.

These routes accept only GET; other methods return HTTP 405, and other `/api` paths return 404.

Generated-world manifests are bounded to 4 MiB, detail tiles to 512 KiB, and complete worker bundles to 20 MiB. The host retains at most two immutable generation bundles, including jobs in progress, and shares requests for the same seed/settings. A failed job can be retried; disconnecting the last waiting observer cancels unfinished work. All map requests share the same worker pool and response admission allowance. Each tectonic job uses a fresh WASM instance with a 128 MiB heap cap and a 2,500-step limit; the heap cap does not bound total process memory.

For example, open **http://127.0.0.1:5173/api/ready** during development. The terminal includes structured request logs; an `x-request-id` response header connects a request to its log entry. Overload and computation deadlines produce explicit retryable failures while the browser retains its last valid map.

To measure the large seeded world, overview and detail delivery:

```sh
npm run bench:world
```

This runs the actual application and workers without opening a network listener, validates every returned tile, and reports local timing, payload and memory measurements. It measures one immutable world, not simultaneous-world capacity. [Fertility 01](docs/features/fertility-01.md) records the current results.

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
- **The map cannot load:** choose **Retry generation**. For missing detail, use **Retry detail**. If it still fails, check the launch terminal for errors, stop it with Ctrl+C, and run `npm start` again.
- **One seed always fails with "Hydrology did not converge":** a few seeds currently cannot be generated (for example `Timing` at standard resolution). Generation is deterministic, so retrying or restarting will not help; choose another seed.
- **The new interface appears but the map is unavailable after an update:** check the terminal for a failed restart or source error. A lab started before automatic watching was installed needs one Ctrl+C and `npm start`; subsequent host-side source edits restart automatically.
- **Production build is missing:** run `npm run build` before `npm run serve` or `npm run preview`.
- **A `CHRONICLE_...` configuration value is rejected:** correct or remove that environment variable, then restart. Ordinary launches need none of these variables.
- **Canvas rendering fails:** choose **Retry canvas**. If it still fails, reload the page or try another browser.

## Project record

- [Development workflow and current stage](docs/WORKFLOW.Md)
- [Architecture decisions](docs/ARCHITECTURE.md)
- [Geography specification](docs/CHRONICLE_SPEC.md)
- [Agent instructions](AGENTS.md)
- [Accepted plate-generated world](docs/features/worldgen-01.md)
- [Accepted rivers and lakes](docs/features/hydrology-01.md)
- [Accepted natural fertility layer](docs/features/fertility-01.md)
- [Development reliability and verification](docs/features/dev-01.md)
- [Backend foundation and verification evidence](docs/features/backend-02.md)
- [Backend research and technology decisions](docs/BACKEND_RESEARCH.md)
- Historical briefs for earlier authored studies, since removed: [original terrain slice](docs/features/atlas-01.md), [React migration](docs/features/react-01.md), [original local backend](docs/features/backend-01.md), [regional atlas](docs/features/atlas-02.md), [resource sites](docs/features/resources-01.md)

## Code map

- `src/main.tsx`: React entry point.
- `src/App.tsx`: renders the generated-world page.
- `src/components/GeneratedWorldLab.tsx`, `src/api/generated-world.ts`, and `src/renderer/generated-world.ts`: world preview controls, bounded tile loading, and map rendering.
- `src/components/ResourceIcon.tsx`: legend pictograms drawn with the map's resource icons.
- `scripts/start.ts`: combined development launcher and standalone built-app launcher.
- `nodemon.json`: host-side development watch scopes and graceful restart settings, used by `npm start` and `npm run dev`.
- `server/app.ts`: Fastify API, static serving, request limits, and lifecycle.
- `server/config.ts`: validated backend configuration.
- `server/compute.ts` and `server/workers/`: bounded execution of disposable geography jobs, plus one cheap readiness probe at startup.
- `server/generated-world-store.ts`: bounded immutable generation cache and shared-request cancellation.
- `shared/atlas.ts`: biome and resource ID lists and schemas; their order is the generated world's numeric encoding.
- `shared/studies.ts`: worker jobs accepted by compute (readiness probe or seeded world settings).
- `shared/generated-world.ts`: generated-world identity, settings, compact numeric fields, manifest/tile validation, limits and exact cell inspection.
- `shared/world-hydrology.ts` and `shared/fertility.ts`: river/lake graph validation and the fertility rule shared by generation, validation and inspection.
- `shared/http.ts`: API error schemas and browser validation.
- `src/world/generation/`: seeded geography, donor projection/refinement, climate, hydrology, sparse resources and tile encoding; imported by workers, never the browser or HTTP layer.
- `src/world/atlas.ts`: biome/resource display catalogs (labels, colors and symbols).
- `src/world/resources.ts`: resource site kinds and extraction technology requirements, separate from visual styling.
- `src/renderer/world-terrain-texture.ts`: full-resolution generated terrain shading and world-coordinate land/water textures.
- `src/renderer/river-paths.ts`: smoothed river reaches derived from the validated water graph.
- `src/renderer/biome-atlas.ts`: Canvas drawing helpers for terrain texture marks and resource icons, independent of React.
- `vendor/platec/`: pinned C++ source, bundled WASM/ESM, authored runtime helper and licenses; `scripts/build-platec.ts` rebuilds or verifies the artifact.
- `scripts/bench-world.ts`: the `npm run bench:world` measurement.
