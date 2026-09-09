# Backend 01 — terrain from the local host

Status: implemented and locally verified, 9 September 2026; user review pending.

## Outcome and scope

`npm start` launches the Node.js + TypeScript terrain backend and React/Vite browser lab together. Opening or resetting Aster Island requests the existing authored fixture from the host; the browser validates the response and renders it with the accepted renderer. The user authorized this next step after accepting the terrain and React migration.

Relevant decisions: `docs/ARCHITECTURE.md`, specification section 13, and the accepted Atlas 01 / React 01 scenarios. Keep one repository, the installed Node 24 runtime, and existing dependencies. This first backend handles a stateless fixture. Separate user worlds, accounts, persistence, worker scheduling, simulation, procedural generation, and remote access remain later slices.

## Contracts and acceptance

- `GET /api/terrain` returns `{ protocolVersion: 1, world: TerrainWorld }`, constructed on the host by the shared fixture module for each request. Responses are JSON and uncached. Unsupported methods and unknown routes return explicit errors. `GET /api/health` reports readiness.
- The Node HTTP server listens only on an automatically assigned loopback port. The launcher proxies `/api` through the browser's origin. Each launch owns its backend; development, preview, and tests do not share one accidentally.
- The browser starts with a visible loading state and unavailable area placeholders. Reset requests fresh host data and blocks actions while loading/drawing, retaining keyboard focus. A successful reset repaints the same terrain and increments the reset count once.
- Failed, timed-out (10 seconds), or malformed responses show an accessible error and a retry control. A failed reset retains the last successfully displayed map and totals. Rendering failures retain the existing disabled-reset behavior. Cleanup aborts requests so late responses cannot overwrite newer state or update an unmounted view.
- Versioned payload validation checks dimensions and cell count, finite terrain values, stable cell IDs, province references, and the supported schema before drawing. Limit this initial transport to 100,000 cells; larger world delivery needs a separate contract and measurement.
- `npm start` and `npm run dev` run the combined development process at http://127.0.0.1:5173/. `npm run preview` starts the same backend with the built browser app at http://127.0.0.1:4173/. Ctrl+C stops both; startup failures clean up partial resources. README remains the canonical launch guide.

## Small implementation plan

- [x] Record a passing baseline and preserve the original terrain/renderer/style.
- [x] Add HTTP contract tests and implement the native Node server and combined launcher; test actual HTTP responses and shutdown/startup failure.
- [x] Add failing browser scenarios for delayed loading, backend failure/retry, and malformed data. Add focused response-validation tests. Replace browser fixture construction with cancellable requests and preserve existing acceptance checks.
- [x] Wire the simple scripts, type checking, and browser test server. Update README and durable architecture/workflow records.
- [x] Run locked setup, routine checks, browser scenarios, and a production-preview smoke check; inspect screenshots and obtain independent review.

## Results and handoff

Starting revision: `f36346c` on `feat/atlas-01`, clean working tree. The accepted React baseline passed four world tests and five browser tests before this change.

- Test-first evidence: the new loading scenario failed against browser-side fixture construction; response-validation tests initially failed because the client module was absent. The loading-area assertion caught incorrect zero totals before data was available.
- `npm ci` succeeded with the existing lockfile; this backend adds no dependencies. `npm run check` passed type checking, all 19 automated world/transport/HTTP/launcher tests, and the production build. Backend source uses native Node 24 TypeScript support.
- `npm run test:browser` passed all 12 Chromium scenarios. Coverage includes the original terrain/reset/resize checks, delayed host data, failed initial load and retry, malformed reset data with the last map retained, authoritative host values, dropped connections, the actual 10-second timeout, and repeated keyboard reset.
- Independent review identified an unfinished HTTP connection that could delay shutdown. The held-request regression failed before the fix and passed after closing remaining backend connections during shutdown. Startup failures, absent preview builds, and separate launch instances are also exercised through actual processes and sockets.
- Visual inspection identified lost keyboard focus caused by temporarily disabling the reset button. The new focus regression failed before the fix and passed with an action guard and `aria-disabled` during requests. Native disabling remains for render failure. Follow-up independent review found no remaining material concerns.
- Desktop/mobile screenshots were inspected and compared with the accepted baseline. Terrain and layout are unchanged; the mobile capture matches exactly. The desktop difference is confined to the reset button's hover-transition color. Screenshots remain generated artifacts in `test-results/`.
- The user's previous frontend-only Vite process occupied port 5173. A default `npm start` correctly failed and cleaned up its partial backend. Actual combined development was verified with `npm start -- --port 5174`; browser tests also launch it on 4173. `npm run preview` served the production app on 4173. Both development and preview passed a real Chromium smoke check: health endpoint, host terrain response (27,648 cells), reset, preserved keyboard focus, and no page errors. Verification servers were stopped afterward.
- `git diff --check` passed. Browser coverage is Chromium only; user review, Firefox/Safari, simulation throughput, and remote access remain unverified. Current fixture construction runs synchronously; this slice makes no CPU-capacity promise.

Handoff checkpoint: `feat: serve terrain from a local backend` on `feat/atlas-01`. Next action: stop the previous frontend-only server with Ctrl+C in its terminal, run `npm start`, refresh http://127.0.0.1:5173/, and inspect/reset the island. Choose the next slice after this review. No simulation, persistent worlds, or save lifecycle was added.

Implementation references: [Vite JavaScript server and preview APIs](https://vite.dev/guide/api-javascript.html), [Node 24 TypeScript support](https://nodejs.org/docs/latest-v24.x/api/typescript.html), [combined abort signals](https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal/any_static).
