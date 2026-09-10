# Civilization 01 — one beginning

Status: historical identity/location slice, superseded in the browser by Tribe 01. User review of 014191c requires removing this automatic preview: tribes begin first and later develop into civilizations. Backend identity contracts remain for compatibility; current browser marker coverage follows real tribes. Baseline `51d3390`, clean at startup. User accepts the geography baseline and wants one civilization with a name and color, then to develop its internal growth/decisions before inter-civilization war, trade or diplomacy.

## Outcome and design

The host creates one reproducible civilization identity and founding location on the generated world. A colored, labeled marker and accessible Locate civilization control expose it in the browser, with exact identity and location inspection. This first identity/location snapshot does not create a settlement, claim land, populate cells or advance time. The agreed national-capital/first-province rule applies when founding settlements are implemented; a starting marker is not a province or inhabited-area claim.

Keep generated geography at generator 5 / protocol 4. The worker composes a separate versioned civilization snapshot beside the existing geography bundle; `GET /api/world/civilization` uses the same bounded cache/admission/cancellation. The host and browser validate the snapshot against its geography identity and land surface. Independent civilization protocol/spawn versions allow future changes without regenerating terrain. This is a repeatable initial preview, not a persistent user world or a running simulation.

Named default placement rules: fertile habitable land (fertility >=25, annual mean >=5°C; exclude water, mountains, snow, tundra, wetland), prefer mapped freshwater and better growing potential, seeded tie-breaking. Generated names and a curated readable color palette are deterministic, with separate identity/placement salts. No candidates returns an explicit no-suitable-land snapshot rather than putting a civilization on water. IDs belong to this preview world, not global user identities.

The browser loads civilization after geography, retains the map on civilization failure and offers a separate retry. Abort/revision guards prevent a late response from putting the previous world's marker on new terrain. Render on Biomes with a label/outline, keep scientific layers literal. Marker picking respects dragging, wrapping and device pixel ratios. Locate/keyboard inspection supplies an accessible alternative.

## Tasks and verification

1. Pure shared contract and core creation, with tests for identity/name/color repeatability, safe location, deterministic variation, zero candidates and nonmutation.
2. Worker composition, bounded cache, HTTP and browser loading; tests for real generation→worker→endpoint, version/identity/location rejection, cancellation and failures.
3. Map marker, identity card, locate and exact inspection; actual development/production browser scenarios for appearance, selection, reload/replacement/retry and mobile.
4. Independent production/UI review, complete `npm run check`, actual 5173 visual review, README/spec/workflow updates and local checkpoint. Next action after verification: user review of the single beginning, not automatic growth implementation.

Current checkpoint: the commit containing this brief, based on `51d3390`, includes only Civilization 01 and its connected documentation/regressions. Complete `npm run check` passes: architecture (52 files), vendored artifact integrity, TypeScript, **147 headless/process tests**, production build and **111 development/production browser scenarios** (3.0 minutes). No failed or skipped checks remain. Independent production review and root UI review are resolved. Full gate log: `/tmp/chronicle-civilization-check.log`.

**Accepted review scenario.** Open **http://127.0.0.1:5173/** (`npm start` if needed). On the default large Chronicle world, Lorin appears with a rust-colored founding marker. Select the marker or choose **Locate civilization**; its name, color and origin appear alongside exact geography. Reset repeats the starting identity. Try another seed to review another beginning. Screenshots are local review artifacts under `/tmp/chronicle-civilization-*.png`. Internal growth/decisions, settlement/province founding and all inter-civilization systems remain future slices.

## Review evidence and capacity

Pure model, actual worker/HTTP, bounded client and cache lifecycle checks pass. Independent review corrected one placement issue: random jitter could select a worse cell despite the specified tie-breaking rule. The reproduced `Tie 6` case (fertility 60 versus 56) now selects 60, with hash ordering used only for equal base suitability. A malformed worker snapshot for another world rejects and releases its cache entry; retry starts a new job and retains its valid result. No material production findings remain.

The first broader browser run exposed an asynchronous composition dependency: the new founding marker could arrive between terrain equality screenshots. Existing Biomes comparisons now wait for the civilization request to settle before capturing their baselines; no pixel equality, terrain, water or selection assertions were weakened. The final focused civilization/terrain run passed 16 development/production scenarios. Desktop, mobile and 1000px tablet views were inspected. The actual watched 5173 lab showed Lorin (`#a34f32`) at cell 226856 on large Chronicle; Locate selected the same origin without page errors.

`npm run bench:world` on Node 24.20.0/Linux, Ryzen 7 7800X3D, 30.5 GiB host RAM: one large world plus its initial civilization generated/delivered in 7,401.5 ms; cached manifest 7.2 ms. Civilization response 193 bytes, manifest 2,931,018 bytes, detail tiles 10,337,335 bytes total, largest 327,868 bytes. Geography payload sizes and identity remain unchanged. All tiles and the civilization snapshot validated; existing 8 KiB civilization / 4 MiB manifest / 512 KiB tile / 20 MiB bundle bounds remain in force. RSS 567.1 MiB including workers; measured event-loop maximum 10.3 ms. This measures one immutable preview, not future concurrent simulation capacity.
