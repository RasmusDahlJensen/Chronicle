# Dev 01 — synchronized development and connected checks

Status: implemented and locally verified on 9 September 2026. Atlas 02 remains available for visual user review; this slice addresses the user's reported missing map and request to prevent recurrence through growing integration coverage.

## Outcome and cause

The running Vite frontend picked up Atlas 02 while its long-lived Node backend still used the earlier code. `/api/atlas` returned 404 at the user's actual URL even though fresh-server tests passed. Restarting the old process restored the map. Development must now reload host-side changes automatically and prove that updated data reaches the existing browser session.

## Plan and acceptance

- Preserve `npm ci` and `npm start`. Use pinned development-only nodemon to supervise the existing combined launcher, with explicit Node execution, SIGTERM for normal cleanup, a short debounce, and recursive host/shared/worker/core/fixture/config watch scopes. Browser component/style edits retain Vite hot updates. Production serve/preview stay direct Node processes without a watcher.
- Recreate the entire host and worker pool after relevant changes so worker imports cannot retain old modules. Let Vite reconnect the existing tab once the replacement frontend/API is available. Syntax errors stop the broken application visibly and the watcher resumes after correction.
- Test actual file changes in isolated source copies with only dependencies shared. Cover an added API route, worker/fixture data edits, error and recovery, rapid edits, listener cleanup, and automatic browser refresh on the same origin. Never mutate live source files to run a test.
- Verify that writing generated test reports preserves the open map and its selection.
- Verify the actual default atlas route through the development proxy and built server. Run browser scenarios against both development and production serving, retain failure artifacts, and keep core world/transport/worker/lifecycle/architecture checks.
- Make `npm run check` the complete iteration gate, including the build and browser integration suite. Add CI that installs the locked runtime/dependencies/browser and executes that same command. Expand tests with each new behavior and preserve every reproduced regression; do not weaken assertions or add tests for hypothetical future mechanics.
- Verify the updated launcher at the user's live port 5173 and leave the map usable. Update README, workflow, architecture, and this brief with actual results and limitations. Obtain independent review before handoff.

## Boundary and limitations

This is development tooling for the current stateless lab. It does not introduce production hot reload, persistent simulation, saves, network exposure, or a promise that every possible failure is eliminated. Future meaningful state requires save/recovery before automatic restart can be applied to it. Linux tests establish Linux behavior; additional operating systems need their own runtime evidence.

## Handoff

Starting revision: `c316650`, clean working tree. Prior baseline: 50 headless tests and 22 development browser cases at `80c4faf`. The Dev 01 working tree was verified before committing the implementation and this record together; no unrelated user changes were present. The checkpoint adds nodemon, isolated source-edit regressions, dual-mode browser checks, CI, and the updated workflow/launch documentation. Application runtime and renderer code remain unchanged.

### Verification and review

- `npm ci` passed with Node 24.20.0 and the committed dependency versions; npm reported no vulnerabilities.
- Final `npm run check` passed: architecture checks over 26 files, TypeScript, **55 headless tests** with no failures/skips, production build, and **47 Chromium scenarios** (25 development, 22 production). Headless tests took 19.4 seconds; browser scenarios took 32.9 seconds on this PC.
- `git diff --check` passed. CI configuration was reviewed against the current official action releases and uses pinned commit SHAs. GitHub execution has not run; the workflow takes effect when pushed.
- Before the watcher fix, adding an actual API route to an isolated running application left that route returning 404 until the regression timed out. The same regression now passes at the same public origin and verifies closure of the old backend listener.
- Review exposed a missing watch for a previously absent `src/simulation` directory. The regression reproduced stale worker data on its second, simulation-only edit before the brace-glob fix; it now passes. Fixture edits, rapid saves, shared/core dependency changes, removal/restoration, and SIGINT/SIGTERM cleanup also pass through real processes.
- Browser recovery initially could have accepted retained data. It now requires a distinct recovered name, matching API output, ready status, and no alert on the same open tab. Frontend-only hot updates preserve the page identity, selected cell, and original backend listener. Independent reviewers rechecked the changes and reported no remaining material findings.
- Windows test cleanup now targets the owned process tree while its parent exists; this was reviewed statically. Windows runtime behavior remains unverified.
- Vite's report-file reload logs prompted an additional noninterference scenario. Creating and overwriting reports preserved the atlas page and selection before any fix; the client filters HTML reloads by path. This is added coverage, not a reproduced application defect, and no Vite configuration change was made.
- Replaced the old live launcher with watched `npm start` on **http://127.0.0.1:5173/**. Verified API HTTP 200, protocol 2, 64,000 cells, visible canvas, successful reset (`Original atlas restored · 1`), and no browser page errors. Inspected a 1600-pixel-wide Chromium screenshot. The watched lab is left running for review.

### Next action

No unresolved implementation defect is known from these checks. Keep expanding regressions alongside future behavior and run the complete `npm run check` before every implementation handoff. The next user action is to review the visible Atlas 02 map at port 5173 and assess terrain variety, texture, and resource readability before choosing another feature slice. Setup remains `npm ci`, then `npm start`; no new backend service or extra launch terminal is required.
