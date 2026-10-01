# React 01 — existing terrain lab migration

> Historical: the authored studies this brief describes were removed on 1 October 2026.

Status: implemented, locally verified, and accepted by the user, 9 September 2026.

The subsequently authorized backend slice is recorded in `docs/features/backend-01.md`; see that brief and README for the current host connection and launch behavior.

## Outcome and scope

Run `npm start` in the existing Chronicle repository and see the same Aster Island lab through React + TypeScript + Vite. Preserve the authored terrain, map styling, area legend, accessible reset, responsive layout, shared world/renderer modules, tests, and project documents. The user's request to move the existing work into the selected project setup authorizes this migration and launch documentation.

Relevant decisions: `docs/ARCHITECTURE.md`, specification section 13, and the original acceptance scenarios in `docs/features/atlas-01.md`. There is no separate Chronicle scaffold in the workspace; migrate this repository in place. Hosted generation/simulation, accounts, saves, and new terrain features remain later slices.

## Implementation and acceptance

- [x] Confirm the existing type checks, world tests, build, and browser scenarios pass before changing the app.
- [x] Add pinned React dependencies and Vite integration. Replace the HTML/imperative entry with `src/main.tsx`, `src/App.tsx`, and `src/components/TerrainMap.tsx`. React owns interface state; the canvas adapter owns renderer setup and cleanup. Preserve the fixture and renderer implementations.
- [x] Keep the existing browser acceptance tests. Exercise repeated resets and a browser without a usable canvas; verify the React development lifecycle does not leave duplicate resize observers after resets.
- [x] Provide `npm ci` setup and `npm start` launch at http://127.0.0.1:5173/. Retain `npm run dev`, `npm run check`, and browser checks. Fix preview to port 4173 and fail clearly if either documented port is busy.
- [x] Update README setup, launch, stop, verification, troubleshooting, and project structure. Record a standing rule to update and verify it whenever runtime requirements or commands change.
- [x] Verify locked installation, routine checks, browser behavior, and the production preview. Inspect desktop/mobile screenshots and get independent code review.

Normal scenario: open the app, inspect the island and exact terrain totals, reset repeatedly, resize to a narrow screen and back, and use keyboard reset. Reset must repaint identical terrain and count each click once. Failure scenario: a missing 2D canvas context must show an accessible error and disable reset. Effect cleanup must release old resize observers.

## Results and handoff

Starting revision: `066aa78`, branch `feat/atlas-01`, with architecture decisions already uncommitted in `AGENTS.md`, `docs/WORKFLOW.Md`, `docs/CHRONICLE_SPEC.md`, and `docs/ARCHITECTURE.md`. Preserve these decisions in the migration checkpoint.

- Before migration, `npm run check` and the original three browser tests passed. The expanded five-test browser suite also passed against the original implementation before changing it.
- After a clean `npm ci`, `npm run check` passed TypeScript checking, all four world tests, and the production build. React/React DOM 19.2.8, Vite React plugin 6.1.1, and type dependencies are pinned in the lockfile. The production JavaScript bundle is 200.13 kB (63.64 kB gzip); adopting React increases the original 6.57 kB bundle.
- `npx playwright install chromium` succeeded using Playwright's Linux fallback build. `npm run test:browser` passed all five scenarios, including exact terrain totals, pixel-restoring reset, repeated reset counts, one active canvas resize observer, null-context error handling, live resizing, and mobile keyboard reset.
- Desktop (1440 × 1000 viewport) and mobile (390 × 844 viewport) screenshots were inspected and compared with the pre-migration captures: no changed pixels. Screenshots are in `test-results/` and remain generated artifacts.
- `npm start` served http://127.0.0.1:5173/ and `npm run preview` served http://127.0.0.1:4173/. A Chromium smoke check at both URLs displayed the terrain and completed reset with correct area totals and no page errors.
- Starting a second instance of either server exited with a clear port-in-use error, as documented. Both verification servers were then stopped so the user can launch from their own terminal.
- Independent code review found no material issues. `git diff --check` passed. Browser coverage is Chromium only; Firefox and Safari remain unverified. No new simulation performance claim is made.

User review: the user confirmed that the app runs correctly and the island looks acceptable. This accepts the current authored terrain sample and React migration; it does not establish procedural generation or full-world simulation readiness.

Handoff checkpoint: `54af29f` (`refactor: migrate the terrain lab to React`) on `feat/atlas-01`, including the original architecture documentation changes. Latest runtime evidence remains the checks above; this follow-up updates acceptance records only. Next action: agree a separate host-fixture slice. The backend is not implemented by this migration.

References used for the adapter and build integration: [React effect setup and cleanup](https://react.dev/reference/react/useEffect), [Vite React plugin](https://vite.dev/plugins/#vitejs-plugin-react).
