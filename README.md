# Chronicle

A living-world atlas, built one small, reviewable slice at a time.

The React + TypeScript + Vite browser lab displays **Aster Island**: an authored terrain fixture with water, plains, shaded hills, and a reset button. Procedural generation and living systems are future slices. Hosted simulation on the owner's PC is planned but is not implemented; the current lab needs no backend service.

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

Open **http://127.0.0.1:5173/** in your browser. Keep the terminal running while you use the lab; press **Ctrl+C** in that terminal to stop it. Source edits update the browser automatically. `npm run dev` starts the same development server.

Look at the coastline and hill relief, compare the terrain legend, and press **Reset terrain** to reconstruct the original island. Resizing the browser fits the same map into the available space. The server listens on this PC only.

## Verify

```sh
npm run check
```

This runs TypeScript checks, world/fixture tests, and a production build.

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

Open **http://127.0.0.1:4173/**. This serves the built app on this PC only. Rebuild to include later source changes, and press **Ctrl+C** to stop the preview.

## Troubleshooting

- **`node` or `npm` is not found:** install Node 24.20.0, reopen the terminal, and retry. If nvm is already installed, use the commands above.
- **`package.json` cannot be found:** move into the Chronicle repository folder before running npm commands.
- **Port 5173 or 4173 is busy:** stop the existing lab or preview terminal with Ctrl+C, then retry. The commands above keep their stated ports instead of silently choosing another one.

## Project record

- [Active React migration and verification evidence](docs/features/react-01.md)
- [Original terrain slice](docs/features/atlas-01.md)
- [Architecture decisions](docs/ARCHITECTURE.md)
- [Development workflow](docs/WORKFLOW.Md)
- [Product specification](docs/CHRONICLE_SPEC.md)
- [Agent instructions](AGENTS.md)

## Code map

- `src/main.tsx`: React entry point.
- `src/App.tsx`: browser view and UI state.
- `src/components/TerrainMap.tsx`: React adapter for the canvas renderer.
- `src/world/`: shared world types and area calculations.
- `src/fixtures/`: the authored terrain sample.
- `src/renderer/`: atlas rendering, independent of React.
