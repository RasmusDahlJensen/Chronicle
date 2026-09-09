# Chronicle

A living-world atlas, built one small, reviewable slice at a time.

Chronicle is intended to grow into a substantial simulation project. Features arrive gradually, with shared modules, established infrastructure packages, and automated checks protecting the architecture as it grows.

The React + TypeScript + Vite browser lab opens **Verdant Reach**, an authored regional atlas with several landmasses, an archipelago, textured biomes, and scattered resources. Its bounded 320 × 200 map contains **64,000 square cells at 4 km² each**, eleven biome types, **329 resource sites** across eleven resource types, and **77 connected, unclaimed provinces**. Pan, zoom, and inspect the actual geography and cell → province → country relationship.

A local Node/Fastify backend constructs, validates, and encodes the atlas in a bounded worker pool, then sends it to the browser. Most cells have no special resource site. Scattered mineral deposits and renewable resource concentrations have terrain-appropriate locations and a required extraction technology. The atlas preview shows all sites for inspection; research, extraction, stockpiles, and country knowledge are not running yet. Ordinary land and sea retain their biomes without a special resource marker. User-seeded planet generation, simulation, saves, accounts, and persistent worlds for separate users remain future slices.

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

## Start the lab

From the Chronicle folder, run:

```sh
npm start
```

Open **http://127.0.0.1:5173/** in your browser after the terminal prints **Chronicle ready**. The first start includes worker warmup. This one command starts the terrain backend and frontend together. Keep the terminal running while you use the lab; press **Ctrl+C** in that terminal to stop both and their workers. `npm run dev` starts the same setup.

The development backend chooses its own local port automatically. No extra terminal, port configuration, account, API key, database, Docker, or separate service installation is needed. Both servers listen on this PC only.

Drag the map to pan, scroll or use **+ / −** to zoom, and choose **Fit map** to return to the overview. Click a cell to inspect its biome, elevation, resource site or absence, province, and unclaimed country status. **Province resources** shows the site counts across that cell's whole province, even if the clicked cell has no site. These are site counts, not quantities or yields. Select a site to see its required extraction technology. Toggle **Resources**, **Provinces**, or **Cell grid**, and use **Resource filter** to locate a particular resource; display filters do not change province totals.

Choose **Reset atlas** to fetch a freshly constructed copy of Verdant Reach. Loading failures offer **Retry atlas**; a failed reload retains the last displayed map. The atlas is a fixed regional study, so reset reproduces the same geography and resources.

For keyboard exploration, focus the map with Tab: arrow keys select neighboring cells, Shift + arrows pan, + / − zoom, and Home fits the map.

The original **Aster Island** study remains available through the header link or **http://127.0.0.1:5173/?scenario=aster**. It retains its water/plains/hills map and **Reset terrain** control.

Frontend component and style edits update through Vite. `npm start` also watches the backend, workers, shared contracts, world/fixture modules, and launch configuration: relevant changes restart the combined application and its worker pool, then Vite reloads the open browser tab. You keep the same browser address. The development study is reconstructed after a restart, so map selection and camera state reset.

If an edit contains an error, the terminal reports it and the watcher waits for a correction. Save the corrected file to restart automatically. After dependency installation, Node upgrades, or changes to the watch configuration itself, stop the terminal with Ctrl+C and run `npm start` again. Built serving with `npm run serve` or `npm run preview` requires an explicit rebuild/restart when code changes.

## Verify

```sh
npm run check
```

This is the required check before handing off each implementation iteration. It runs architecture checks, TypeScript, headless world/backend/process tests, a production build, and Chromium scenarios against both development and built serving. Live-edit regressions run isolated copies of the real application; they never edit the map you are reviewing. Install Chromium using the command below before the first complete check.

The architecture checks use Biome to detect import cycles, undeclared dependencies, development packages in runtime code, and imports that cross the browser/core/backend boundaries. For focused work, use `npm run check:architecture`, `npm run typecheck`, or `npm test`; finish the iteration with the complete `npm run check`.

Install Chromium once (and again after a Playwright update). To run just the build and browser scenarios:

```sh
npx playwright install chromium
npm run test:browser
```

Browser checks need ports **4173 and 4174** free; the normal lab can continue on 5173. Failures retain traces/screenshots under `test-results/` and an HTML report under `playwright-report/`. A browser regression checks that generating reports preserves the open map and selection. The GitHub workflow in `.github/workflows/check.yml` installs the pinned Node/dependencies/Chromium and runs the same `npm run check` on pushes and pull requests once the workflow is pushed.

Extend the suite alongside each change, especially when data crosses a module or process boundary:

| Connection or rule | Regression coverage |
|---|---|
| Cells → provinces → countries; biome/resource data and province site totals | `tests/atlas-world.test.ts`, `tests/atlas-response.test.ts` |
| Workers → validated HTTP responses; admission and shutdown | `tests/compute.test.ts`, `tests/server.test.ts`, `tests/atlas-server.test.ts` |
| Launcher → proxy/built server; live source changes → new workers | `tests/launcher.test.ts`, `tests/dev-reload.test.ts` |
| HTTP → browser validation → visible map, inspection, reset/retry | `tests/browser/`, run against development and production serving |

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
- `/api/atlas` returns Verdant Reach as `{ "protocolVersion": 3, "world": … }`; `cell.resource` is a resource ID or explicit `null` for no site.
- `/api/terrain` retains Aster Island as `{ "protocolVersion": 1, "world": … }`.

Both map payloads are independently bounded to 100,000 cells and 8 MiB of JSON. Their requests share the same worker pool and admission allowance.

For example, open **http://127.0.0.1:5173/api/ready** during development. The terminal includes structured request logs; an `x-request-id` response header connects a request to its log entry. Overload and computation deadlines produce explicit retryable failures while the browser retains its last valid map.

To measure the Verdant Reach fixture pipeline:

```sh
npm run bench:backend -- --atlas
```

The original Aster Island benchmark remains available for comparison with the recorded backend baseline:

```sh
npm run bench:backend
```

Each command starts and stops a temporary loopback server and reports the selected fixture, runtime, hardware, configuration, request outcomes, health latency, event-loop delay, and process memory. These are measurements of fixture delivery and HTTP responsiveness; future simulation throughput needs its own workload. The [Atlas 02 brief](docs/features/atlas-02.md) records atlas results, and [Backend 02](docs/features/backend-02.md) retains the earlier baseline evidence.

The defaults need no configuration. For development measurements, these environment variables are read when the host starts; invalid values stop startup:

| Variable | Default | Allowed values |
|---|---|---|
| `CHRONICLE_WORKERS` | 2, or 1 when only one processor is available | Integers 1–8 |
| `CHRONICLE_QUEUE_LIMIT` | 4 waiting jobs | Integers 0–32 |
| `CHRONICLE_JOB_TIMEOUT_MS` | 8000, including queue time | Integers 100–8000 |
| `CHRONICLE_LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |

Map response admission is also bounded to worker count plus queue allowance until responses finish or close. These conservative limits do not promise a particular user capacity. No `--host` option or network exposure is provided.

## Troubleshooting

- **`node` or `npm` is not found:** install Node 24.20.0, reopen the terminal, and retry. If nvm is already installed, use the commands above.
- **`package.json` cannot be found:** move into the Chronicle repository folder before running npm commands.
- **Port 5173 or 4173 is busy:** stop the existing lab or built-app terminal with Ctrl+C, then retry. The commands above keep their stated ports instead of silently choosing another one.
- **The map cannot load:** choose **Retry atlas**, or **Retry terrain** in the Aster study. If it still fails, check the launch terminal for errors, stop it with Ctrl+C, and run `npm start` again.
- **The new interface appears but the atlas is unavailable after an update:** check the terminal for a failed restart or source error. A lab started before automatic watching was installed needs one Ctrl+C and `npm start`; subsequent host-side source edits restart automatically.
- **Production build is missing:** run `npm run build` before `npm run serve` or `npm run preview`.
- **A `CHRONICLE_...` configuration value is rejected:** correct or remove that environment variable, then restart. Ordinary launches need none of these variables.
- **Canvas rendering fails:** reset is disabled when the browser cannot draw the map. Reload the page or try another browser.

## Project record

- [Active scattered-resource slice and verification](docs/features/resources-01.md)
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
- `src/App.tsx`: selects the default regional atlas or `?scenario=aster` legacy study.
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
- `shared/studies.ts`: fixed authored study identifiers accepted by compute.
- `shared/http.ts`: API error schemas and browser validation.
- `src/world/atlas.ts`: biome/resource catalogs and area/resource summaries; `terrain.ts` retains the original terrain summaries.
- `src/world/resources.ts`: resource site kinds and extraction technology requirements, separate from visual styling.
- `src/fixtures/verdant-reach.ts` and `aster-island.ts`: deterministic authored regional and original island fixtures.
- `src/renderer/biome-atlas.ts`: biome textures, layers, bounded camera, and cell selection, independent of React; `atlas.ts` retains the original renderer.
