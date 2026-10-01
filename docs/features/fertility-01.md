# Fertility 01 — natural growing potential

> Note, 1 October 2026: the authored Verdant/Aster studies, the civilization slices that followed this brief and `npm run bench:backend` were removed at the user's request; the local branch `archive/civilization-v1` keeps them as reference. Statements below about them are historical.

Status: implemented and verified locally, 10 September 2026; visually accepted by the user. Baseline `23cbb3b`; clean at startup. Hydrology is visually accepted and remains closed.

## Outcome and scope

Add a Fertility map layer and exact cell explanations of natural growing potential. Warmth, moisture, estimated soil condition, regional slope and drainage contribute separately. Water is not terrestrial growing land. Warm/wet mountains must not automatically score as excellent farmland; dry/cold/waterlogged locations expose their limitations. This is an annual, crop-independent game index, not measured soil chemistry or agricultural yield. No farming, settlements, irrigation, fertilizers or drainage engineering.

Preserve existing elevation, climate, biomes, water graph, resources and river rendering. Add an authoritative fertility column (0–100) to the existing overview/detail transport; compute it in the worker. One pure shared rule derives the score and explanations from existing terrain/climate/water data and is reused for host validation and exact cell inspection. No independent browser-wide fertility simulation. Generator 5 / protocol 4 identify the new field; authored studies retain their versions. Keep payload bounds and simple launch commands.

## Small tasks and verification

1. Define and test bounded shared soil/slope/drainage assessment and factor combination; include wet mountain versus flat land, drought/cold/waterlogging, freshwater context, water exclusion, seam/polar neighbors and nonmutation.
2. Generate the fertility column on the host, validate overview and every detail score against the authoritative terrain, and retain exact explanations. Round-trip and malformed-score tests; preserve climate/resource/geometry regressions.
3. Add a literal-color Fertility layer, meaningful legend and selected-cell factor explanations. Browser tests for actual data/layer changes, factors, water exclusion, replacement and tiles.
4. Independent review, full `npm run check`, actual browser review and payload/host benchmark. Update README/architecture/workflow and preserve a checkpoint before user review.

## Current evidence and next action

The complete `npm run check` passes: architecture (50 files), vendored artifact integrity, TypeScript, **140 headless/process tests**, production build, and **101 development/production browser scenarios** (2.9 minutes for browsers). No skipped or failed checks remain. Independent production review and root UI review are resolved. This feature's checkpoint is the commit containing this brief, based on `23cbb3b`; it contains fertility and the related regression fixes, with no unrelated work.

The actual watched lab at **http://127.0.0.1:5173/** was inspected in Chromium: generator 5 / protocol 4 identity matched the canvas, Fertility displayed a 95/100 alluvial river cell with exact factor values, and no page errors occurred. Overview, neutral water and the factor panel were visually inspected; automated scenarios also cover water exclusion, exact colors before/after detail tiles, layer changes, malformed replacement preservation and retry. Screenshots are local review artifacts under `/tmp/chronicle-fertility-*.png`; the full gate log is `/tmp/chronicle-fertility-check-verified.log`.

**Review accepted.** The user considers the geography baseline complete. Subsequent work is recorded in Civilization 01. Original review steps: Run `npm start` if needed, open the usual address, choose **Fertility**, and click land to inspect its five factors. Compare flat river lowlands with dry, cold and mountainous regions; zoom for exact cells and click water to confirm it is excluded. No farming, settlements or subsequent geography slice has started.

## Model basis and limits

[FAO land evaluation](https://www.fao.org/4/t0715e/t0715e06.htm) assesses climate, slope and soils against a specified land use; it does not establish a universal agricultural score. [FAO applications](https://www.fao.org/4/u1980e/u1980e05.htm) also distinguish water supply and soil water storage. Chronicle borrows those categories, not a calibrated FAO formula. All thresholds and weights here are explicit game heuristics. Annual climate cannot express growing seasons, crop preferences or actual nutrient chemistry.

The score multiplies the five displayed integer percentages. Warmth favors annual means of 18–32°C and declines outside them; moisture reaches adequacy at 0.65. Soil quality is estimated from rock/altitude/slope, cold, wetness, dryness and flat river proximity. Regional slope uses great-circle neighbor distances and lake surface levels, not lake beds. Wetlands and very wet flat land receive a drainage limitation. Nearby open lakes/rivers are reported as freshwater context but do not supply irrigation; only nearby rivers contribute the alluvial estimate. This first model does not claim actual sediment deposition, permeability or salinity measurements.

## Review and regression findings

Independent production review found one diagonal lakeshore mismatch: water inspection recognized an open lake diagonally while fertility reported no nearby freshwater. A regression first failed, then passed after freshwater vicinity adopted the same eight-neighbor shoreline convention. Physical slope and the alluvial estimate retain edge-sharing neighbors. Model/transport/generation review and separate UI review have no remaining material findings.

The first full gate passed 140 headless/process tests and 100 of 101 browser scenarios. The remaining development scenario received an immediate HTTP 503 `OVERLOADED` before rendering: Playwright defaulted to eight concurrent scenarios against shared hosts with finite response admission. The trace was preserved at `/tmp/chronicle-fertility-overload-trace.zip`. The test configuration now uses two workers; application limits, deadlines, assertions and retry behavior remain unchanged. The final complete gate includes this correction and passes.

The next gate reached 139/140 headless passes but exposed an existing HTTP deadline-test race: its 100 ms limit expired during worker bootstrap under suite load, before the HTTP timeout scenario began. The test now lets real worker startup complete under the normal deadline, then applies 100 ms to the actual 350 ms workload. No production deadline or assertion changed. All six focused server tests pass; root review of the bounded change is complete. Both corrected scenarios pass in the final complete gate.

## Capacity measurement

`npm run bench:world` on Node 24.20.0/Linux, Ryzen 7 7800X3D, 30.5 GiB host RAM: large Chronicle (`climate-5:large:Chronicle`) generated and delivered in 7,368.5 ms; cached manifest 7.5 ms. Manifest 2,931,018 bytes, all 32 detail tiles 10,337,335 bytes, largest tile 327,868 bytes. Every tile validated, and the worker's full bundle passed the existing 20 MiB cap. Manifest 4 MiB and tile 512 KiB caps remain unchanged. RSS 581.4 MiB including workers (increase 358.3 MiB), maximum observed event-loop delay 10.1 ms. There are 121,762 land cells and 1,934 resource sites. This is one local immutable world, not simultaneous simulation capacity.
