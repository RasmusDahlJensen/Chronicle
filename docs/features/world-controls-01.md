# World controls 01 — explicit civilization spawning and a monthly world clock

Status: implemented and fully verified locally, based on `6de8980`; user review of the controls remains pending. The next country-growth design is under discussion below, not implemented.

## Outcome

The generated map begins empty in the new browser flow. A visible Spawn civilization action offers random suitable placement or selecting a valid land cell on the map. An explicit spawn creates a named, colored civilization at that location. No legacy preview or old browser instance is automatically selected. One civilization is supported per active world in this slice; its communities share the world clock.

Page-level Play/Pause and Advance 1 month controls own time for the active world, not an individual settlement. Play completes one 30-day month per one-second host tick; Pause stops further ticks. An explicit month step performs the same complete 30 daily simulation steps and saves once before publication. All existing food, settlement and territory processes participate. The 360-day calendar displays month and year. Geography is static. There is no independent per-town clock and no wall-time catchup while the world is unobserved.

Manual placement is an explicit mode with a clear prompt and Cancel. Clicking a suitable map cell submits its exact full-resolution ID. Invalid water or unsuitable land gives a recoverable explanation and leaves placement active; the backend repeats validation. Dragging pans and never spawns, ordinary clicks outside placement keep inspection, and stale generation/requests cannot place an actor in a replacement world. Random placement uses a persisted spawn seed sampled once per new instance. Names derive from spawn identity rather than a fixed geography preview.

## Compatibility and architecture

Keep validated daily settlement logic and durable worker ownership. Add explicit versioned world-clock/spawn contracts, preserving legacy checkpoints and tests behind compatibility handling. The new browser session uses a distinct per-geography reference so older scenarios do not silently reappear. New sessions restore their exact identity, location and monthly progress after reload. Requests include expected revision/incarnation; uncertain commands are never replayed automatically. A failed spawn preserves the selected pending identity for safe retry. Reset remains a labeled lab action with confirmation, and preserves the selected original spawn location.

Remove the retired preset name from maintained source, fixtures and documentation, and remove its syllable combination from name generation. Historical Git commits and private archived save files are not rewritten as project source. Everyday startup remains `npm start`.

## Plan and verification

1. Shared/core/runtime: write failing manual-placement, exact-month clock, name reproducibility and restart/identity tests; implement validated versioned contracts. Daily accounting and migration regressions remain.
2. Browser: replace old per-tribe controls with world toolbar, spawn menu and map placement/cancel flow. Keep civilization/settlement inspection in the sidebar and connect one shared state to the renderer. Update existing browser expectations for the intentional new workflow while preserving assertions on pixels, picking, saves and failures.
3. Exercise random/manual spawning, unsuitable land, cancel/drag, late world changes, monthly play/pause/step, reload and all settlement updates through the real host in development and production.
4. Independently review core/runtime and UI; run complete `npm run check`, inspect actual localhost and desktop/mobile screenshots, update README/workflow/architecture and commit a verified checkpoint.

Verified working tree based on `6de8980`: complete `npm run check` passed with architecture (68 files), vendored artifact integrity, types, **195 headless/process tests**, production build and **139 development/production browser scenarios**. Log: `/tmp/chronicle-world-controls-verified.log`; earlier interrupted runs are not complete-gate evidence. Independent backend and UI reviews are resolved. UI review found stale placement during regeneration and a missing placement tile-error retry; both fixes and their development/production regressions pass. The shared-clock regression preserves day-150 two-community checks, then correctly expects the existing third founding after day 174 while verifying all populations and food accounting. Actual localhost 5173 desktop/mobile screenshots were inspected; the toolbar is visible and mobile has no horizontal overflow. No CI run is claimed.

Review: `npm start`, open `http://127.0.0.1:5173/`, choose Spawn civilization → Random location or Choose on map, then Advance 1 month or Play/Pause. Inspect communities and reload to confirm saved progress. Reset simulation retains the original selected location. Implementation and research checkpoint: `14cf6bd`. This subsequent documentation correction records that revision; no unresolved implementation findings. Next action: user review and agreement on the country-owned territory/capital slice described below; do not add demographics, diplomacy or economy rules automatically.

## User observation during verification

The user observes three towns appearing quickly followed by little visible change. This follows the retained Settlement 01 rules: a fixed total of 250 people, 80 transferred per founding, and a parent minimum of 160. Two transfers leave 90/80/80, preventing further founding; no births, deaths or research currently exist. Monthly playback makes the first few simulated months pass in seconds. Food and local territorial work continue. Explained this limit to the user; do not disguise it with cosmetic growth or silently add demographics in this controls slice. The next discussion should address population growth, constraints and settlement pacing.

## Subsequent country-design discussion (research, not implemented)

The user's drawing supersedes the earlier national-outline model for future work. Even a tribal country should begin with a capital and own a connected claimed region expanding from it. Villages are founded inside that region; later development produces cities. Foreign claims and movement are blocked unless a future explicit invitation or war rule permits access. Diplomacy and war remain context only. Expansion requires people and ongoing resource support; useful known resources should motivate it and later village placement. Resource ownership, technological knowledge, extraction and usable stockpiles remain distinct. This requires a new ownership contract, not drawing a larger outline around current working cells.

Research shortlist (11 September 2026):

- [Red Blob Games distance fields](https://www.redblobgames.com/pathfinding/tower-defense/) and [multiple sources](https://www.redblobgames.com/pathfinding/distance-to-any/): use weighted Dijkstra distance for terrain/supply accessibility, plus incremental adjacent-cell region growth. Distance maps alone neither transfer ownership nor charge upkeep.
- [Utility AI considerations, Mike Lewis](https://www.gameaipro.com/GameAIPro3/GameAIPro3_Chapter13_Choosing_Effective_Utility-Based_Considerations.pdf): score legal choices using needs and costs. Proposed Chronicle choices include consolidation, supported frontier claims and founding within owned land. Hard legality/technology/accounting checks precede scoring.
- [TinyQueue](https://github.com/mourner/tinyqueue): ISC-licensed priority queue building block for weighted search; reuse existing shared terrain access and measure any replacement before adoption.
- [Mistreevous](https://github.com/nikkorn/mistreevous): MIT, TypeScript behaviour trees for Node/browser, injected random/time functions and node inspection; candidate for executing persistent multi-step plans. Durable state restoration and monthly/daily determinism need an integration test before adoption.
- [Yuka](https://github.com/Mugen87/yuka): MIT JavaScript game AI, goals/state machines, graphs/navigation and serialization. Broader candidate, with more movement/perception functionality than this first national decision slice needs.
- [Jeff Orkin's GOAP paper](https://www.gamedevs.org/uploads/three-states-plan-ai-of-fear.pdf): later option for planning dependency chains such as acquiring technology and inputs before producing goods. Not a ready-made civilization simulator.

Recommendation under discussion: terrain-aware frontier growth plus a deterministic utility decision layer, explainable decisions and shared accounting. Libraries supply algorithms/execution infrastructure; Chronicle must define ownership, costs, knowledge and production. No new dependency was installed and no country-growth rules were changed by this research. Suggested review scenarios: sustainable growth on fertile plains, expensive mountain expansion, blocked foreign frontier, inaccessible/unknown resources, reserve-driven consolidation, and exact replay after save/reload. Multi-country fixtures can validate exclusivity without introducing diplomatic gameplay.
