# Chronicle

A living-world atlas, built one small, reviewable slice at a time.

The first browser lab displays **Aster Island**: a fixed terrain study with water, plains, shaded hills, and a reset button. It is an authored fixture, not a seeded world generator. Camera navigation and living systems are later slices.

## Run locally

Use Node **24.20.0** (`nvm use` if you use nvm).

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite, normally **http://127.0.0.1:5173/**. The development server listens on this machine only.

Look at the coastline and hill relief, compare the terrain legend, and press **Reset terrain**. The original island is reconstructed. Resizing the browser fits the same map into the available space.

## Verify

```sh
npm run check
```

This runs TypeScript checks, four world/fixture tests, and a production build.

For actual browser checks, install the test browser once, then run:

```sh
npx playwright install chromium
npm run test:browser
```

On Linux, Playwright may also need system browser dependencies; its installer reports any missing ones. Browser tests use port 4173 and cover rendering, area reconciliation, reset, live resizing, and keyboard use on a narrow screen. Desktop/mobile screenshots are written to `test-results/`.

`npm run preview` serves the built application locally after a build. No deployment, account, API key, or external image/font service is required.

## Project record

- [Active feature and verification evidence](docs/features/atlas-01.md)
- [Development workflow](docs/WORKFLOW.Md)
- [Product specification](docs/CHRONICLE_SPEC.md)
- [Agent instructions](AGENTS.md)

Shared world types and area calculations live in `src/world/`; the authored sample in `src/fixtures/`; read-only rendering in `src/renderer/`. `src/main.ts` connects those parts to the browser view.
