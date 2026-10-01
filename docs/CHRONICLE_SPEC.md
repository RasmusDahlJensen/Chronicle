# Chronicle — A Living World
## Geography specification

Version 2.1 · 1 October 2026 · Geography baseline only

This document records the accepted requirements for Chronicle's generated world. It is not a game specification. On 1 October 2026 the user removed the civilization prototype and asked for the civilization design to be thought through again; the earlier product sections on tribes, settlements, countries, provinces, decision-making, economy, diplomacy, warfare, history and pacing were removed from this file. The game and its civilizations are defined by [VISION.md](VISION.md), agreed with the user the same day. Do not infer game rules from earlier versions of this file (available in Git history), from feature briefs written before VISION.md, or from the archived `archive/civilization-v1` branch.

## 1. Evidence and precedence

| Source | Decisions carried forward |
|---|---|
| Local-development discussion, 9 September | Develop with Codex locally in manageable stages; executable simulation independent of renderer; repository documentation; reproducible testing |
| Local hosting decision, 9 September | Each person has a separate world; world generation and simulation run on the user's PC; worlds pause and save when the person leaves, then resume on return |
| Frontend choice, 9 September | React + TypeScript + Vite for the browser interface; atlas rendering and hosted simulation remain separate |
| Atlas visual correction, 9 September | Prioritize a larger map with several landmasses, richer textures and distinct biomes. Include uranium as resource potential; no extraction or nuclear mechanics implied. |
| Resource distribution correction, later on 9 September | Replace resources on every cell with scattered resource sites that require appropriate technology to exploit, inspired by Civilization. Most cells have no special site; preserve ordinary biome productivity as a separate concept. |
| Geography reset, 1 October | Remove all civilization work and the authored regional/terrain studies; the project is the generated-world page. Civilizations will be redesigned from the user's vision document. |
| Vision agreed, 1 October | `VISION.md` defines the game and its civilizations, including technology-gated extraction, industry and nuclear mechanics. Its slice G1 is the only approved geography change: fix seeds that fail to generate, and add tin and oil sites without moving existing sites. |

Precedence: newer explicit user choices override older choices. In particular:

1. Local development replaces Sites as the primary workflow. Separate worlds will be hosted on the user's PC; access and deployment details remain to be defined.
2. Scattered resource sites replace the earlier request to attach a resource to every cell. Technology determines exploitation; presence, knowledge, productivity, extraction, and stockpiles are distinct.

Requirement labels: **Required** means a recorded product direction. **Proposed default** means a concrete engineering or balance choice introduced here, changeable after measurement. **Deferred** means outside the first release.

## 2. Scale

**Required:** Earth-comparable geographic scale, substantial detail, large oceans and continents.

**Approved geography preview targets:** Standard resolution 512 × 256 cells; large resolution 1,024 × 512 cells (524,288), including water. Both represent the same 510 million km² fictional planet. This supersedes the earlier 10,000/60,000-land-cell preview proposals; actual land count depends on generated geography. These are geography benchmarks, not promises about simultaneous simulation capacity. Support greater detail through measured future contracts.

Do not conflate map dimensions with surface area. Assign real area weights and a consistent travel-distance model. If using an equal-area cylindrical atlas, document its polar distortion and do not treat all rendered horizontal lengths as equal ground distances. A 510 million km² planet includes water; do not assign that total to its land alone.

## 3. World generation

**Required:** Seeded fictional continents, islands, varied coasts, mountain ranges, rivers, lakes, climate, fertility, forests, deserts, cold regions, and geographically coherent resources. Same seed, settings, and generator version reproduce the initial world.

**Agreed climate model:** Use global latitude: cold near both poles, gradually warmer average lowland temperatures toward the equator, and cooling with elevation. Regional moisture must depend on broad circulation, ocean exposure and mountain barriers, including wetter windward slopes and drier rain shadows. Derive biomes from temperature, moisture and terrain; do not assign every island a quota of every biome. Small islands commonly contain one or a few related biomes; broad continents can span many. Keep regional variation and coherent transitions without treating biome boundaries as arbitrary random patches. Deserts depend on dryness, not simply proximity to the equator.

**Visual diversity correction:** Continents must vary in proportions, latitude extent and coastline structure, with bays, peninsulas and regional island groups. Mountains form localized ranges of varied orientation; avoid repeating a tall oval and central north–south ridge on every landmass. Preserve broad lowlands and regionally distinct biome mixes. The biome overview must retain fine coastlines, relief and land/water texture when zoomed out.

**Worldgen 01 delivery:** A simplified annual climate preview with plate-generated continents/islands/relief, temperature, normalized moisture availability, polar sea ice, biomes and sparse potential resource sites. Moisture is an index, not claimed rainfall in millimetres. Expose biome, temperature and moisture layers plus exact cell inspection. Generate on the host PC and send an overview and bounded detail tiles to the browser. Seed, resolution, generator version, topology and units form the reproducibility contract. A pinned tectonic model supplies initial relief; it does not complete geological modelling. Seasonality and ocean currents are not modeled.

**Hydrology 01 delivery:** Deterministic connected rivers, tributaries and inland/frozen lakes augment the accepted terrain without changing its bedrock. Lakes expose area, surface level, depth and an outlet or closed-basin status. Inspection distinguishes mapped river/open-lake freshwater access from closed inland water whose salinity is unmodeled. Conservative, supply-limited retention avoids flooding extensive continental depressions; weak lake outflows may end in explicit dry basins. Runoff is a moisture-weighted area index, not calibrated discharge. The current preview uses the existing annual moisture field to supply drainage, then assigns lake biomes; lake evaporation does not yet feed back into climate. This is static annual geography; seasonal flooding, erosion and groundwater remain later scoped work.

**Fertility 01 delivery and geography acceptance:** The user accepts this geography baseline. Natural growing potential is generated on the host from climate, estimated soil, regional slope and drainage, with a literal map layer and exact factor inspection. It is not crop yield or measured soil chemistry.

The current generator derives cell data in this order: elevation and landmass → annual climate and biomes → water drainage and lakes → resources → fertility.

## 4. Resources

**Current geography:** generated worlds contain sparse, terrain-appropriate mineral deposits and renewable concentrations. Cells have either one displayed resource site or no site; absence of a special site does not mean zero fertility, timber, or future base productivity. The map shows sites and their required extraction technology for review. These requirements are catalog data; geography itself runs no research, extraction, depletion or stockpile system. Additional deposits and renewable capacities are not part of VISION.md's run: geography keeps at most one site per cell (G1 places tin and oil only on land cells without a site), and the simulation derives timber and stone supply from forest and rough land.

Geography only places resource sites. How civilizations reveal, extract and use them, including uranium and nuclear mechanics, is defined in [VISION.md](VISION.md). Tin and oil were added by its slice G1 (generator 6): tin in a few rare upland clusters, oil in a few lowland basins, only on land cells that had no site.

## 5. Map presentation

**Required:** Full working atlas with natural terrain, zoom-dependent detail, and smooth pan/zoom. Historical cartography style: parchment land, blue oceans, shaded relief, restrained ornament, readable labels and compact panels.

## 6. Technical decisions

**Hosting update, 9 September 2026:** the user confirmed separate worlds per person, with world generation and simulation hosted on the user's PC. Worlds pause and save when the person leaves and resume on return; VISION.md schedules saving and resuming as slice P, and until then a host restart or a seed change resets the simulation to year 0. This replaces the original browser-worker/no-server proposal. It does not introduce shared-world multiplayer. See `docs/ARCHITECTURE.md` for the decision record and unresolved details.

**Frontend decision, 9 September 2026:** React + TypeScript + Vite is confirmed for the browser interface. Keep one repository and one package initially; split modules without creating unnecessary services or a complex monorepo.

**Backend foundation, 9 September 2026:** the local host uses Node.js + TypeScript, Fastify, shared validated transport, and a bounded Piscina worker pool, which now executes disposable seeded-geography jobs. `npm start` launches it with the browser app; `npm run serve` serves the built app directly. See `docs/BACKEND_RESEARCH.md` and `docs/features/backend-02.md` for decisions, limits, and evidence.

## 7. Performance acceptance

Record hardware, browser/runtime, build mode, seed, cell count and dates for measurements. Proposed interactive target: p95 input feedback below 100 ms and roughly 30+ FPS while panning the default world. Benchmark generation time and heap growth. Tune targets after the first measured baseline; no unmeasured claims.

Browser testing must verify actual interaction when available. Build/headless checks do not establish visual correctness. If browser tooling is blocked, report the gap and provide a short manual checklist; never claim the pass occurred.

## 8. Game and civilization design

Defined in [VISION.md](VISION.md), agreed with the user on 1 October 2026. This file remains authoritative for geography except where VISION.md names an approved change.
