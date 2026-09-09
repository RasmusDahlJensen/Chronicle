# Chronicle

A living-world atlas, built one small, reviewable slice at a time.

The React + TypeScript + Vite browser lab displays **Aster Island**: an authored terrain fixture with water, plains, shaded hills, and a reset button. A local Node backend constructs the sample and sends it to the browser. Procedural generation, simulation, worker pools, saves, and persistent worlds for separate users are future slices.

## First setup on your PC

Open a terminal in the **Chronicle repository folder**, where `package.json` lives. Use Node **24.20.0**, also recorded in `.nvmrc`. Check your installed version with:

```sh
node --version
```

If you already use nvm, it can install and select that version:

```sh
nvm install
nvm use
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

Open **http://127.0.0.1:5173/** in your browser. This one command starts the terrain backend and frontend together. Keep the terminal running while you use the lab; press **Ctrl+C** in that terminal to stop both. `npm run dev` starts the same setup.

The backend chooses its own local port automatically. No extra terminal, port configuration, account, API key, database, or separate service installation is needed. Both servers listen on this PC only.

Look at the coastline and hill relief, compare the terrain legend, and press **Reset terrain** to fetch a freshly constructed copy of the island from the backend. Resizing the browser fits the same map into the available space. Loading failures offer **Retry terrain**; if a reset request fails, the last displayed map stays visible.

Frontend edits update the browser automatically through Vite. After changing backend files, launch scripts, or terrain fixtures, press **Ctrl+C** in the launch terminal, run `npm start` again, and refresh the browser.

## Verify

```sh
npm run check
```

This runs TypeScript checks, automated tests, and a production build.

For browser checks, install Chromium once (and again after a Playwright update), then run:

```sh
npx playwright install chromium
npm run test:browser
```

Browser tests start their own local server on port **4173**; stop any preview server using that port first. On Linux, Playwright's installer reports any missing system browser dependencies. Browser screenshots are written to `test-results/`.

## Preview a production build

```sh
npm run build
npm run preview
```

Open **http://127.0.0.1:4173/**. Preview starts the same terrain backend alongside the built frontend, on this PC only. Rebuild and restart the preview to include later source changes. Press **Ctrl+C** to stop both.

The local API is available through either running browser URL at `/api/health` and `/api/terrain`. For example, during development, open **http://127.0.0.1:5173/api/health** to check the backend or **http://127.0.0.1:5173/api/terrain** to inspect the terrain data.

## Troubleshooting

- **`node` or `npm` is not found:** install Node 24.20.0, reopen the terminal, and retry. If nvm is already installed, use the commands above.
- **`package.json` cannot be found:** move into the Chronicle repository folder before running npm commands.
- **Port 5173 or 4173 is busy:** stop the existing lab or preview terminal with Ctrl+C, then retry. The commands above keep their stated ports instead of silently choosing another one.
- **Terrain cannot load:** choose **Retry terrain**. If it still fails, check the launch terminal for errors, stop it with Ctrl+C, and run `npm start` again.
- **Canvas rendering fails:** terrain reset is disabled when the browser cannot draw the map. Reload the page or try another browser.

## Project record

- [Active backend slice and verification evidence](docs/features/backend-01.md)
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
- `scripts/start.ts`: starts the terrain backend and development or preview frontend together.
- `server/terrain-server.ts`: local terrain API.
- `src/world/`: shared world types and area calculations.
- `src/fixtures/`: the authored terrain sample.
- `src/renderer/`: atlas rendering, independent of React.
