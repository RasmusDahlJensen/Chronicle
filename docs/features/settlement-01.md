# Settlement 01 — food, camps and supported territory

Status: implemented and fully verified locally on 11 September; awaiting user review. Active slice; the commit containing this brief is based on `0c4115c`.

## Agreed design and delivery

A society begins as one mobile camp. Accessible subsistence supports its people; repeated use establishes a territorial footprint. It can relocate for a sustained worthwhile opportunity, consolidate into an established community and send people and supplies to establish additional centers. The main center persists when other towns form. Total population remains 250 for this slice: founding transfers people and does not introduce births. Food units are person-days; collected, consumed, unmet needs and establishment costs are accounted explicitly. Shortfall stops unsupported expansion; mortality and demographic growth are separate mechanics.

Use existing biome, fertility and early usable food sites to evaluate local opportunities. A deposit provides potential only; iron, coal, uranium and other inaccessible materials do not attract a subsistence camp. Wild grain gathering is not agriculture. Terrain-weighted geographic travel limits reachable work and settlement locations. This is an explicit game model, not a claim of calibrated historical yields. Distances respect horizontal wrapping and geographic scale. Sustained improvement and establishment costs prevent daily camp oscillation. Persistent use adds cells; abandoned working territory is relinquished through an explicit lifecycle.

Town working areas, tribal territorial presence and future province sovereignty are distinct. This slice draws tribal territory. The national outline is the union boundary of actual member cells, preserving unclaimed holes and separate holdings. It never claims land by enclosing scattered towns. Each occupied territorial cell has one center assignment; work ranges can overlap but production and labor must not be duplicated. Selected center details show its working area. No political provinces are created now. Later a country organizes its territory into provinces around designated capitals; ordinary towns do not automatically create provinces. Country ownership then derives from province sovereignty. Research enables capabilities; ages describe development rather than creating towns on a timer.

## Architecture and compatibility

Extend the existing deterministic simulation core and versioned checkpoints. Immutable subsistence geography is stored once per world in the simulation database, never shipped in each observer response. The existing worker remains the single mutation/save authority. Version-1 checkpoints migrate explicitly with validated matching geography and retain identity, elapsed days and the recoverable prior checkpoint. Reset restores original placement and initial subsistence state. Browser observes validated settlements, food ledgers and decisions; it does not calculate simulation outcomes. Renderer caches derived territory edges when state changes, hides overlays on scientific layers and retains actual cell picking.

## Acceptance and verification

- Repeated daily steps equal batches and saved continuation; same geography/placement produces equivalent decisions.
- Food and population accounting reconcile; founding spends actual stores and transfers people; shortfall prevents unsupported growth.
- Useful reachable sites affect decisions; inaccessible minerals do not; water/mountain barriers and longitude wrap are tested.
- Stable center IDs, one main center, no duplicate territorial assignments, bounded requests/checkpoints and validated legacy migration.
- Renderer removes internal country edges while retaining disconnected components, holes and correct seam behavior; center working areas are inspection overlays only.
- Browser exposes food, decisions, centers, picking and visible territorial change through the real worker/HTTP path; reload/reset and climate pixels remain protected.
- Complete `npm run check`, independent review, actual localhost review, updated README and local checkpoint before handoff.

Previous baseline: `0c4115c` passed 170 headless/process and 129 browser scenarios. Current verification is recorded below. Next action: user review using the repeatable scenario; do not begin research, demographics, diplomacy or provincial government automatically.


## Model parameters and repeatable review

Food is integer person-days. Initial reserves are 7,500 (30 days for 250 people). Sixty percent of inhabitants work; one coarse cell supports at most 60 assigned workers in this first subsistence model. Travel reduces output. Gathering uses biome/fertility plus edible wild grain/game and adjacent fish sites. No separate freshwater-consumption model, renewable-stock depletion, spoilage, farming, stone-tool production or mineral extraction is included. Food shortage is measured and limits supported establishment; population mortality remains outside this slice.

Local work has a 180 km terrain-weighted route budget; founding examines up to 360 km. Geography uses spherical neighbor distance with wrapped longitude, bounded poles and relief/vegetation effort. These represent coarse regional access, not literal daily out-and-back pedestrian journeys. Working parties and travel efficiency are abstracted; this is tunable game behavior. Centers establish neighboring worked territory after at least 10 days (longer with distance), and unused territorial cells lapse after 30 days. Center cells remain inhabited. Relocation requires sustained accessible-yield improvement of more than 15 percent, paid travel supplies and seven days of reserves. A camp becomes established after 60 consecutive self-supporting days and 30 days of reserves. A new center needs preparation (30 days plus travel at 20 km/day), 80 transferred people, 30 days of provisions and journey supplies. Population allocation implies at most three centers for the present 250-person scenario. Founding/relocation travel is accounted as preparation delay and provisions; people transfer on completion rather than appearing as an independently simulated expedition.

Review: choose **Chronicle**, **Standard · 512 × 256**, regenerate, set **Placement seed** to **Tribes 4**, and Begin tribe. Advance five **Step 30 days** batches. Day 151 has two centers, 170 and 80 people, four territorial cells and conserved total population. Locate either center to inspect its working area and supplies. Other placements can consolidate, relocate or face deficits rather than found towns on this schedule. Clicking territorial land identifies its supporting center. Existing large/Tribes1 scenarios need not match this example.

## Local measurement

Node 24.20.0, Ryzen 7 7800X3D, standard Chronicle / Tribes4, 150 simulated days: geography generation 7,884.94 ms; encode/decode 1,151.79 ms; settlement environment construction 21.67 ms; tribe initialization 28.33 ms. Pure daily stepping total 55.03 ms, slowest 30-day batch 21.21 ms. Serialized environment 1,548,071 bytes; checkpoint 2,155 bytes; final 2 centers / 4 territory cells / 29,515 person-days stored. Concurrent development/browser activity was present. This one local core sample is not a promise about future population, HTTP latency or multiworld throughput. The legacy storage/RPC-only benchmark still runs explicitly against version-1 clock-only fixtures; it does not measure the new economy.


Review progress: independent core/runtime review resolved food-availability forecasts, spherical travel, per-center prosperity, founding delay, upkeep, secondary-center geography validation, atomic migration and response-envelope bounds. Independent renderer review resolved overlapping marker picking and duplicate legacy main-center details. Six focused development/production browser checks passed; actual two-community desktop/mobile screenshots inspected. Locate zoom increased to 16 after inspection so footprints are visible; the final complete gate includes that production build. Recent activity is a bounded 32-entry display, while each current center preserves its identity and founding day in durable state; a comprehensive historical chronicle remains future work.


Crash-harness correction during full verification: the pre-existing recovery fixture retained a child process with an empty timer, allowing V8 to collect its runtime and finalize the SQLite owner lock before the duplicate-owner assertion. A probe reproduced the lost lock after forced GC while the process remained alive. The production worker already retains its runtime through its tick callback. The fixture now matches that callback and forces GC before acknowledging the state; the original ownership/crash/restore assertions remain unchanged. The strengthened test failed with the empty callback and passed after correction; 36 concurrent-repeat runs also passed. No production locking change was necessary. Diagnostic run log: `/tmp/chronicle-settlement-verified.log`; final successful evidence is below.


Test scheduling: a subsequent full run passed recovery but hit the existing 2-second authored compute deadline under concurrent generation and recovery-stress load (the same case passed alone in 752 ms). `npm test` now bounds headless file concurrency to four, analogous to the browser suite’s two-worker bound. Deadlines, overload tests and all behavioral assertions remain unchanged. Final verification passed through the normal command with this schedule; this is not a product performance result.


Browser scheduling correction: the bounded final run passed all 191 headless/process tests and 132 browser scenarios, but the new standard-resolution reload scenario overlapped initial large-world generation with its immediate standard replacement and received the expected busy response. Its retained trace/screenshot show no tribe panel because geography admission was refused, not a lost save. The scenario now waits for initial geography after navigation/reload before changing resolution; its two-center/population/reload/picking assertions are unchanged. Existing dedicated cancellation, overload and replacement regressions remain in the full suite. The final gate passed with this corrected scenario.


## Verified handoff

Complete `npm run check` passed against final application/test sources: architecture **68 files**, vendored artifact integrity, TypeScript, **191 headless/process tests**, production build and **133 development/production browser scenarios** (4.5 minutes). Log: `/tmp/chronicle-settlement-final-gate.log`. Independent core/runtime, renderer and final harness reviews are resolved with no material findings. The actual `http://127.0.0.1:5173/` displayed ready geography, no unsolicited actor and no browser errors; isolated real-host scenarios verified food, founding, saved continuation and desktop/mobile inspection. Final zoom-16 screenshots were inspected. The legacy benchmark command also ran successfully with its explicit clock-only scope. Local evidence does not imply GitHub CI has run.

No unresolved implementation issue within this slice. Population growth, mortality, research, production chains, formal capitals/provinces and a complete historical chronicle remain unimplemented and clearly separated above. User review is the next action. Everyday launch remains `npm start`; no new packages or installation steps are required.
