# Chronicle

A living-world atlas, built one small, reviewable slice at a time.

Chronicle is intended to grow into a substantial simulation project. Features arrive gradually, with shared modules, established infrastructure packages, and automated checks protecting the architecture as it grows.

The React + TypeScript + Vite browser lab opens **Verdant Reach**, an authored regional atlas with several landmasses, an archipelago, textured biomes, and cell resources. Its bounded 320 × 200 map contains **64,000 square cells at 4 km² each**, eleven biome types, eleven resource types, and **77 connected, unclaimed provinces**. Pan, zoom, and inspect the actual geography and cell → province → country relationship.

A local Node/Fastify backend constructs, validates, and encodes the atlas in a bounded worker pool, then sends it to the browser. Every cell has one primary natural resource or potential; resources are not produced stockpiles. Countries are absent in this study. User-seeded planet generation, simulation, saves, accounts, and persistent worlds for separate users remain future slices.

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

Drag the map to pan, scroll or use **+ / −** to zoom, and choose **Fit map** to return to the overview. Click a cell to inspect its biome, elevation, resource, province, and unclaimed country status. Toggle **Resources**, **Provinces**, or **Cell grid**, and use **Resource filter** to locate a particular resource. Overview resource markers are sampled; zoom in for more markers, or select any cell for its exact resource.

Choose **Reset atlas** to fetch a freshly constructed copy of Verdant Reach. Loading failures offer **Retry atlas**; a failed reload retains the last displayed map. The atlas is a fixed regional study, so reset reproduces the same geography and resources.

For keyboard exploration, focus the map with Tab: arrow keys select neighboring cells, Shift + arrows pan, + / − zoom, and Home fits the map.

The original **Aster Island** study remains available through the header link or **http://127.0.0.1:5173/?scenario=aster**. It retains its water/plains/hills map and **Reset terrain** control.

Frontend edits update the browser automatically through Vite. After changing backend files, worker code, shared transport schemas, launch scripts, or terrain fixtures, press **Ctrl+C** in the launch terminal, run `npm start` again, and refresh the browser.

## Verify

```sh
npm run check
```

This runs architecture checks, TypeScript checks, automated tests, and a production build. The architecture checks use Biome to detect import cycles, undeclared dependencies, development packages in runtime code, and imports that cross the browser/core/backend boundaries. To run just those checks, use `npm run check:architecture`. Installation remains part of the normal `npm ci`; no additional global tool is needed.

For browser checks, install Chromium once (and again after a Playwright update), then run:

```sh
npx playwright install chromium
npm run test:browser
```

Browser tests start their own local server on port **4173**; stop any built-app or preview server using that port first. On Linux, Playwright's installer reports any missing system browser dependencies. Browser screenshots are written to `test-results/`.

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
- `/api/atlas` returns Verdant Reach as `{ "protocolVersion": 2, "world": … }`.
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
- **The new interface appears but the atlas is unavailable after an update:** Vite can update the frontend while the previous backend remains running. Stop the lab with Ctrl+C, run `npm start`, and refresh the page to load both from the current code.
- **Production build is missing:** run `npm run build` before `npm run serve` or `npm run preview`.
- **A `CHRONICLE_...` configuration value is rejected:** correct or remove that environment variable, then restart. Ordinary launches need none of these variables.
- **Canvas rendering fails:** reset is disabled when the browser cannot draw the map. Reload the page or try another browser.

## Project record

- [Active atlas slice and review status](docs/features/atlas-02.md)
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
- `server/app.ts`: Fastify API, static serving, request limits, and lifecycle.
- `server/config.ts`: validated backend configuration.
- `server/compute.ts` and `server/workers/`: bounded execution of disposable terrain jobs.
- `shared/atlas.ts`: biome/resource atlas types, protocol-2 schema, hierarchy/connectivity validation, and size limits.
- `shared/terrain.ts`: retained protocol-1 terrain schema and validation.
- `shared/studies.ts`: fixed authored study identifiers accepted by compute.
- `shared/http.ts`: API error schemas and browser validation.
- `src/world/atlas.ts`: biome/resource catalogs and area/resource summaries; `terrain.ts` retains the original terrain summaries.
- `src/fixtures/verdant-reach.ts` and `aster-island.ts`: deterministic authored regional and original island fixtures.
- `src/renderer/biome-atlas.ts`: biome textures, layers, bounded camera, and cell selection, independent of React; `atlas.ts` retains the original renderer.
