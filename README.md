# Chronicle

A living-world atlas, built one small, reviewable slice at a time.

Chronicle is intended to grow into a substantial simulation project. Features arrive gradually, with shared modules, established infrastructure packages, and automated checks protecting the architecture as it grows.

The React + TypeScript + Vite browser lab displays **Aster Island**: an authored terrain fixture with water, plains, shaded hills, and a reset button. A local Node/Fastify backend constructs, validates, and encodes the sample in a bounded worker pool, then sends it to the browser. Seeded generation, simulation, saves, accounts, and persistent worlds for separate users are future slices.

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

Look at the coastline and hill relief, compare the terrain legend, and press **Reset terrain** to fetch a freshly constructed copy of the island from the backend. Resizing the browser fits the same map into the available space. Loading failures offer **Retry terrain**; if a reset request fails, the last displayed map stays visible.

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
- `/api/terrain` returns the versioned terrain payload, bounded to 100,000 cells and 8 MiB of JSON.

For example, open **http://127.0.0.1:5173/api/ready** during development. The terminal includes structured request logs; an `x-request-id` response header connects a request to its log entry. Overload and computation deadlines produce explicit retryable failures while the browser retains its last valid map.

To measure the current fixture pipeline:

```sh
npm run bench:backend
```

This starts and stops a temporary loopback server and reports the runtime, hardware, configuration, request outcomes, health latency, event-loop delay, and process memory. It measures fixture delivery and HTTP responsiveness, not future simulation throughput. See the [active brief](docs/features/backend-02.md) for recorded results.

The defaults need no configuration. For development measurements, these environment variables are read when the host starts; invalid values stop startup:

| Variable | Default | Allowed values |
|---|---|---|
| `CHRONICLE_WORKERS` | 2, or 1 when only one processor is available | Integers 1–8 |
| `CHRONICLE_QUEUE_LIMIT` | 4 waiting jobs | Integers 0–32 |
| `CHRONICLE_JOB_TIMEOUT_MS` | 8000, including queue time | Integers 100–8000 |
| `CHRONICLE_LOG_LEVEL` | `info` | `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent` |

Terrain admission is also bounded to worker count plus queue allowance until responses finish or close. These conservative limits do not promise a particular user capacity. No `--host` option or network exposure is provided.

## Troubleshooting

- **`node` or `npm` is not found:** install Node 24.20.0, reopen the terminal, and retry. If nvm is already installed, use the commands above.
- **`package.json` cannot be found:** move into the Chronicle repository folder before running npm commands.
- **Port 5173 or 4173 is busy:** stop the existing lab or built-app terminal with Ctrl+C, then retry. The commands above keep their stated ports instead of silently choosing another one.
- **Terrain cannot load:** choose **Retry terrain**. If it still fails, check the launch terminal for errors, stop it with Ctrl+C, and run `npm start` again.
- **Production build is missing:** run `npm run build` before `npm run serve` or `npm run preview`.
- **A `CHRONICLE_...` configuration value is rejected:** correct or remove that environment variable, then restart. Ordinary launches need none of these variables.
- **Canvas rendering fails:** terrain reset is disabled when the browser cannot draw the map. Reload the page or try another browser.

## Project record

- [Active backend slice and verification evidence](docs/features/backend-02.md)
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
- `src/App.tsx`: browser view and UI state.
- `src/components/TerrainMap.tsx`: React adapter for the canvas renderer.
- `src/api/terrain.ts`: browser requests for terrain data.
- `scripts/start.ts`: combined development launcher and standalone built-app launcher.
- `server/app.ts`: Fastify API, static serving, request limits, and lifecycle.
- `server/config.ts`: validated backend configuration.
- `server/compute.ts` and `server/workers/`: bounded execution of disposable terrain jobs.
- `shared/terrain.ts`: transport schemas, types, semantic validation, and size limits.
- `shared/http.ts`: API error schemas and browser validation.
- `src/world/`: shared world types and area calculations.
- `src/fixtures/`: the authored terrain sample.
- `src/renderer/`: atlas rendering, independent of React.
