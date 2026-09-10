# Chronicle — A Living World
## Product specification and local development playbook

Version 1.2 · 10 September 2026 · Seeded worlds and regional climate

This document defines intended behavior, not a claim that the existing Site implements it. Use it as the source of truth for planning, implementation, and acceptance checks. Preserve the existing prototype before replacing anything.

## 1. Evidence, precedence, and scope

The baseline combines the full design conversation available here, retrieved excerpts of the original brief and consolidation discussion, and the supplied recent-conversation summaries. Full transcripts of every recent chat were not available. No current source-code audit has been performed.

Evidence register:

| Source | Decisions carried forward |
|---|---|
| Original design conversation and creation brief, 8 September | Fictional Earth-scale atlas; observer-only; tribes merge; resource-dependent economies; technology; government and religion; empires rise and fall; ancient-to-medieval first release |
| Border/population edits, 8 September, recent-chat summaries | More visible national borders; starting populations substantially smaller than the reported approximately 9,000 |
| Consolidation discussion and edit brief, 8 September | Viability, capitulation, subjects, annexation, coherent territory, demographic decline, disease, dissolution, historical persistence |
| Dynamic Territory Expansion, 8 September, recent-chat summary | Countries contain provinces containing cells; conquest transfers provinces; cells support local resources and movement; more evenly spread founding tribes; faster early conquest; Fantasy Map Simulator named as a visual reference |
| Edit Country Relations, 8 September, recent-chat summary | Country → province → cell click selection; visible alliances, wars, occupation and subject relationships; faster early expansion; correct land-coverage reporting |
| Local-development discussion, 9 September | Develop with Codex locally in manageable stages; executable simulation independent of renderer; repository documentation; reproducible testing |
| Local hosting decision, 9 September | Each person has a separate world; world generation and simulation run on the user's PC; worlds pause and save when the person leaves, then resume on return |
| Frontend choice, 9 September | React + TypeScript + Vite for the browser interface; atlas rendering and hosted simulation remain separate |
| Atlas visual correction, 9 September | Prioritize a larger map with several landmasses, richer textures and distinct biomes; display a primary natural resource on every cell and preserve cell → province → country relationships. Include uranium as resource potential; no extraction or nuclear mechanics implied. |
| Resource distribution correction, later on 9 September | Replace resources on every cell with scattered resource sites that require appropriate technology to exploit, inspired by Civilization. Most cells have no special site; preserve ordinary biome productivity as a separate concept. |
| Province and settlement discussion, 10 September | Countries create provinces around settlement centers. The founding capital also centers the first province; other provincial capitals and ordinary towns follow. Capturing a provincial capital immediately transfers province ownership, while individual cells can remain under opposing military control. |

Precedence: newer explicit user choices override older choices. In particular:

1. Evenly dispersed viable starts replace the earlier strong clustering around fertile regions. Geography still constrains habitability.
2. Cells and provinces are distinct. The earlier target of tens of thousands of “provinces” must not become an accidental requirement for tens of thousands of province groups each containing thousands of cells.
3. Early expansion should be lively and competitive, replacing the prototype’s frustratingly slow consolidation. Population and travel accounting still apply.
4. Local development replaces Sites as the primary workflow. Separate worlds will be hosted on the user's PC; access and deployment details remain to be defined.
5. Scattered resource sites replace the earlier request to attach a resource to every cell. Technology determines exploitation; presence, knowledge, productivity, extraction, and stockpiles are distinct.
6. Country-created provinces replace geographically fixed provinces generated before tribes. Successful capture of a provincial capital transfers sovereignty immediately; a peace agreement is not required for that transfer. The existing authored atlas still uses its earlier fixed groups as a test fixture.

Requirement labels: **Required** means a recorded product direction. **Proposed default** means a concrete engineering or balance choice introduced here, changeable after measurement. **Deferred** means outside the first release.

## 2. Product contract

**Required:** An autonomous civilization simulation on a vast, procedurally generated fictional planet, presented as a flat, zoomable, horizontally wrapping atlas. The observer watches and investigates history; they do not manage a country.

Core experience: founding tribes establish settlements, spread, unite or fight, develop institutions and technology, trade, grow into empires, acquire dependencies, face crises, and sometimes fragment or disappear. Each important outcome has inspectable causes.

First-release scope: tribal beginnings through medieval development. Build actual interacting systems with modest detail before broadening eras.

Success means:

- Geography and resource access matter.
- Countries have understandable identities, interests, and weaknesses.
- Meaningful expansion and consolidation are visible at accelerated speed.
- Both survival and disappearance are possible for small states.
- Strong empires can endure, but expansion is not free.
- Borders are legible and generally coherent without cosmetic territorial reassignment.
- The observer can answer “what happened, who benefited, and why?”

Excluded from v1: player commands, god tools, multiplayer, runtime language-model calls, modern industry, modern weapons, full globe rendering, exact historical reenactment, individual-person simulation. No predetermined world winner or mandatory empire lifespan.

Future god tools should enter through explicit simulation commands; do not build a general modding framework in anticipation.

## 3. World hierarchy and ownership

### 3.1 Geography, settlements, and administrative provinces

**Required:** Geography supplies cells and continents/regions. Countries create connected administrative provinces around settlements as they establish and expand their territory. Initially unclaimed land has no political provinces. Once formed, a province preserves its identity through a whole-province ownership transfer; conquest does not regenerate its cells or erase its history.

| Entity | Owns or represents |
|---|---|
| Cell | Terrain, area, resource deposits, local settlement/population groups, local improvements, army position, current military control |
| Province | Persistent connected group of land cells formed around a designated provincial capital; sovereignty; integration and autonomy; aggregate local statistics |
| Country/state | National capital, government, treasury, policy, diplomacy, armies, provincial holdings, identity and historical lineage |
| Culture/religion | Identities shared across populations and borders; not one-to-one with countries |
| Settlement | Inhabited location and local capacity within a cell; may serve as a national capital, provincial capital, or ordinary town, and may survive the state governing it |

The founding settlement becomes the country's national capital and the center of its first province. Further provincial capitals organize additional provinces. A province can contain several ordinary towns; founding a town does not automatically create another province. Towns can support nearby farms, mines, and other extraction sites. Resource access influences settlement placement alongside food, water, transport, and security; technology, workers, and access determine actual production.

**Proposed formation rules:** Expand through reachable, connected claims around existing centers or a supplied founding expedition. Attach newly claimed cells to an appropriate province, or establish a province around a new provincial capital. Distance, population, and administrative workload can justify promoting a town and splitting a province. Terrain and travel access influence boundaries. Define initial claim extent, growth costs, promotion thresholds, and split/merge rules in their implementation slices; there is no pre-generated quota of political provinces.

Each land cell belongs to at most one active province. Keep sovereignty in one authority: derive member-cell ownership from the province's owner, while military control remains a cell-level state. Membership changes must preserve people, resources, and history. Capital relocation takes time and resources and cannot undo an already completed capture. Future province abandonment, splits, and mergers need explicit lifecycle rules, not a routine map-wide regeneration.

### 3.2 Sovereignty versus control

Keep separate:

- Sovereign owner of a province.
- Military controller of individual cells during war.
- Effective administrative reach and local autonomy.
- Inhabited cells and population density.
- Overlord–subject relationship between political entities.

Army movement and battles occur on cells. Capturing an ordinary cell changes military control. **Successful hostile capture of the designated provincial capital immediately transfers ownership of the entire province to the capturing country.** Capturing every cell and waiting for peace are unnecessary. Mere movement through a capital is not a successful capture; combat/siege rules must define when its defense has been overcome.

That ownership transfer does not teleport armies, capture remaining towns or forts, or eliminate resistance. Surviving defenders can still control individual cells inside the newly owned province. Preserve local population and resource accounting and begin consolidation with appropriate integration, autonomy, and resistance. Losing the national capital transfers its province; it does not automatically transfer every province or dissolve a country that can continue from elsewhere.

Founding and frontier claims start with limited administrative reach. Populate cells progressively; claiming territory does not populate or develop every cell. Competing expeditions resolve through contact, diplomacy, or conflict, rather than multiple sovereign owners of one province. Capturing an ordinary town may affect military control and production, but only the designated provincial capital triggers the province-wide conquest transfer.

Use direct country holdings and subject-inclusive imperial holdings as distinct totals. Do not count subject population twice in world statistics.

### 3.3 Scale

**Required:** Earth-comparable geographic scale, hundreds of founding tribes, substantial detail, large oceans and continents.

**Approved geography preview targets:** Standard resolution 512 × 256 cells; large resolution 1,024 × 512 cells (524,288), including water. Both represent the same 510 million km² fictional planet. This supersedes the earlier 10,000/60,000-land-cell preview proposals; actual land count depends on generated geography. These are geography benchmarks, not promises about simultaneous simulation capacity. **Proposed later benchmark:** roughly 2,000–5,000 provinces in developed large-world scenarios. Province counts emerge from settlement and growth rather than an initial geographic partition. Support greater detail through measured future contracts.

Do not conflate map dimensions with surface area. Assign real area weights and a consistent travel-distance model. If using an equal-area cylindrical atlas, document its polar distortion and do not treat all rendered horizontal lengths as equal ground distances. A 510 million km² planet includes water; do not assign that total to its land alone.

### 3.4 Current civilization development sequence

The user accepts the geography baseline. Civilization 01's earlier identity preview is superseded by tribal beginnings: a fresh map shows no civilization, and a named group appears only when a tribe begins or an existing tribe is restored. The agreed direction begins with regular tribes adapting to their local environment, not established agricultural states. Seeded geography and separately seeded tribal placement support repeatable worlds; many tribes eventually grow, combine and develop technology, with larger societies becoming civilizations or empires. Develop one tribe's internal behavior deeply before adding other tribes, war, trade, alliances or diplomacy.

**Tribe 01, authorized:** one persistent tribe with a name, color, camp and a scenario default of 250 people; Day 1, Year 1 paused, with a deterministic daily clock and a 360-day calendar. The host saves each completed batch. Population stays fixed until food and demographic systems are implemented; this is not a survival simulation yet. A tribal camp is not a formal national/provincial capital, settlement system or territorial claim. When a tribe establishes a country and its founding settlement, the national-capital/first-province relationship above applies. Food/labor decisions are the next proposed slice, followed by demographics and learning.

## 4. World generation and starts

**Required:** Seeded fictional continents, islands, varied coasts, mountain ranges, rivers, lakes, climate, fertility, forests, deserts, cold regions, and geographically coherent resources. Same seed, settings, and generator version reproduce the initial world.

**Agreed climate model:** Use global latitude: cold near both poles, gradually warmer average lowland temperatures toward the equator, and cooling with elevation. Regional moisture must depend on broad circulation, ocean exposure and mountain barriers, including wetter windward slopes and drier rain shadows. Derive biomes from temperature, moisture and terrain; do not assign every island a quota of every biome. Small islands commonly contain one or a few related biomes; broad continents can span many. Keep regional variation and coherent transitions without treating biome boundaries as arbitrary random patches. Deserts depend on dryness, not simply proximity to the equator.

**Visual diversity correction:** Continents must vary in proportions, latitude extent and coastline structure, with bays, peninsulas and regional island groups. Mountains form localized ranges of varied orientation; avoid repeating a tall oval and central north–south ridge on every landmass. Preserve broad lowlands and regionally distinct biome mixes. The biome overview must retain fine coastlines, relief and land/water texture when zoomed out.

**Worldgen 01 delivery:** A simplified annual climate preview with plate-generated continents/islands/relief, temperature, normalized moisture availability, polar sea ice, biomes and sparse potential resource sites. Moisture is an index, not claimed rainfall in millimetres. Expose biome, temperature and moisture layers plus exact cell inspection. Generate on the host PC and send an overview and bounded detail tiles to the browser. Seed, resolution, generator version, topology and units form the reproducibility contract. Initially unclaimed geography has no political provinces. A pinned tectonic model supplies initial relief; it does not complete geological modelling. Seasonality, ocean currents, fertility, founding settlements and living-world stepping are not completed by this preview; they retain the full milestone requirements below.

**Hydrology 01 delivery:** Deterministic connected rivers, tributaries and inland/frozen lakes augment the accepted terrain without changing its bedrock. Lakes expose area, surface level, depth and an outlet or closed-basin status. Inspection distinguishes mapped river/open-lake freshwater access from closed inland water whose salinity is unmodeled. Conservative, supply-limited retention avoids flooding extensive continental depressions; weak lake outflows may end in explicit dry basins. Runoff is a moisture-weighted area index, not calibrated discharge. The current preview uses the existing annual moisture field to supply drainage, then assigns lake biomes; lake evaporation does not yet feed back into climate. This is static annual geography; seasonal flooding, erosion and groundwater remain later scoped work.

**Fertility 01 delivery and geography acceptance:** The user accepts this first geography baseline. Natural growing potential is generated on the host from climate, estimated soil, regional slope and drainage, with a literal map layer and exact factor inspection. It is not crop yield or measured soil chemistry. Civilization 01 now adds a single initial identity/location snapshot as described in §3.4; settlement, population and province founding remain subsequent slices.

Generate geography and cell data in dependency order: elevation and landmass → water drainage → climate/biomes → resources → viable settlement candidates. Then sample tribal camps on viable land using a separate placement seed. Country formation, capital settlements and their initial provinces develop through later simulation mechanics. Leave remaining unclaimed land without political province membership; additional provinces arise during expansion.

**Required:** Tribes are broadly and more evenly distributed across habitable regions, avoiding the dense local starting clusters seen in the prototype. Evenness does not require tribes in glaciers or deserts.

**Proposed algorithm:** Stratify viable starting candidates across substantial landmasses, then sample with minimum spacing measured using appropriate geographic or land-travel distance. Use environmental suitability to define viable candidates, then seeded sampling; do not always choose the globally most fertile sites. Tribe 01 uses fertility >=25, annual mean >=5°C and habitable non-mountain/non-wetland land as explicit provisional viability thresholds; multi-tribe spacing remains later work. Log when terrain makes desired count and spacing incompatible; relax spacing explicitly and gradually.

Start on Day 1, Year 1, with low populations, few settlements, and much unclaimed land. **Proposed tuning range:** 150–500 people per founding tribe and 200–400 tribes on the large preset. These numbers are not recovered user-approved values. Show the actual start population distribution and count in generation diagnostics. Start paused so day-one values can be inspected before time advances.

Unique generated names should be culturally coherent, with disambiguation where names repeat. No external name-generation API is needed.

Acceptance: all starts are viable; documented spacing distribution; no accidental empty world; initial population equals the sum of founding groups; same seed reproduces placements.

## 5. Time and pacing

**Required:** Calendar, pause/resume, multiple speeds, ongoing years and centuries, observer control of time only.

**Proposed default:** Keep the prototype’s 360-day calendar for simplicity. Use a fixed daily simulation step, monthly economic/government decisions, and slower demographic summaries where appropriate. Disease and population accounting must use consistent time units.

Render separately from the simulation clock. Higher playback speed processes more identical simulation steps, never larger probability jumps or different rules. Pause is acknowledged at a completed step; UI displays the committed simulation date. Cap pending worker batches so controls stay responsive.

**Required:** Early development feels like an expansion and consolidation race. Later development gives trade, treaties, and political relationships more influence while retaining war.

Represent this as a game-design preference rather than a claim of universal historical progress. **Proposed model:** plentiful frontier opportunities and permissive early claims encourage expansion; later institutional obligations, trade dependence, alliances, and occupation costs change incentives. Avoid a global date switch that makes every country peaceful simultaneously. Advanced states may remain expansionist.

Measure perceived pacing through fixed-seed observation checkpoints. Do not hard-code an exact number of surviving countries at each date.

## 6. Population, survival, and disease

**Required:** Population can grow, decline, migrate, and disappear. No immortal minimum population or guaranteed positive growth.

Population_next = population + births − deaths + immigration − emigration.

Population groups contain culture, religion, civilian/military status where needed, and quantities. Group by meaningful attributes; do not create one entity per person.

Food access combines production, imports, reserves, and transport capacity. Sustained deficits draw reserves down, reduce fertility/births, increase mortality, and motivate migration. Recovery must be possible when conditions improve.

Recruitment transfers civilians into military service, reducing civilian labor. Casualties are deaths exactly once. Demobilization returns survivors. Loss of access to a homeland does not duplicate or erase a surviving army.

Migration has a source, reachable destination, capacity, and travel assumptions; removal and addition reconcile. Track displaced people rather than deleting them because a state falls.

**Required:** Disease can cause mortality. **Proposed v1 model:** a small susceptible/infected/recovered population model with local exposure, contact through movement/trade, finite infectious duration, and immunity/recovery rules. Calibrate rates to the daily step. Avoid recalculating all population-pair contacts or dealing arbitrary damage to whole countries.

A depopulated settlement is abandoned. An uninhabited province can lose sovereignty after administrative abandonment. A collapsed government does not imply an empty province: surviving communities may form decentralized local societies or join neighbors.

Acceptance: population ledger reconciles; food shortages can cause decline; migration conserves people except explicit travel deaths; recruitment is not mortality; annexation is not mortality; extinction closes active state references but retains history.

## 7. Economy, resources, and technology

**Required:** Multiple resources per place; labor and technology determine exploitation; trade supplies missing materials; resource access is not a global shared inventory.

**Current atlas slice:** Resources 01 replaces Atlas 02's ubiquitous resources with sparse, terrain-appropriate mineral deposits and renewable concentrations. Cells have either one displayed resource site or no site; absence of a special site does not mean zero fertility, timber, or future base productivity. The atlas preview shows sites and their required extraction technology for review. These requirements are catalog data; there is no running research, extraction, depletion, or stockpile system. Visibility by country knowledge remains a future observer/technology contract. Additional deposits and renewable capacities remain an economy contract to define; the singular display resource does not impose a permanent one-resource limit on a place.

**Proposed resource set:** food, timber, stone, copper, tin, iron, horses, and one or two luxury categories. Introduce additional goods only when a mechanic uses them. Distinguish deposits, extraction rates, finite stockpiles, and renewable productivity.

Minimum production chains: farmland/labor → food; forests/labor → timber; accessible deposit/mining → ore; metallurgy/materials → equipment; materials/labor → improvements. Do not claim a detailed production chain while directly awarding its finished output regardless of inputs.

A country has a treasury and budget; goods reside in explicit provincial markets or stockpiles. **Proposed default:** province-level inventories and cached route capacity are enough for v1; individual merchant agents are unnecessary. Imports subtract from the exporter and arrive according to transport assumptions. Payments, tariffs if included, and costs must reconcile.

Trade requires diplomatic permission and a physical route. War, blockade, infrastructure damage, distance, and vessel capability alter capacity. Evaluate nearby candidates or existing routes; avoid all-country/all-province pair searches every day.

Technology has prerequisites, research/discovery progress, and adoption costs. Contact enables diffusion. Writing, administration, metallurgy, agricultural improvements, roads, shipbuilding, and navigation must change actual capabilities. Knowledge alone does not create the resources needed to deploy it.

Water access progresses from limited river/coastal capability toward more capable regional voyages. Reliable global oceanic expansion belongs to later scope if beyond the medieval model.

Future industrial and nuclear technologies inherit the same resource-plus-capacity rule. No uranium/enrichment or nuclear mechanics in v1.

Acceptance: shortages prevent unsupported production; routes cannot cross inaccessible terrain/water; stockpiles remain valid; technology changes capabilities; countries develop at different rates without fixed global unlock dates.

## 8. State formation, institutions, and identity

**Required:** Tribes can voluntarily merge, form confederations, or be forcibly unified; a successful single tribe can develop into a civilization. Founding identities persist.

Formation depends on settled population, food surplus, organization, and cooperative or coercive authority. Preserve founding and successor links rather than replacing names without history.

Governments: tribal council, confederation, monarchy, republic, theocracy as a manageable initial set. Give each a small number of consequential differences in legitimacy, succession, autonomy, revenue, or administration. Do not implement dozens of decorative policies.

Fictional religions can spread across borders and influence legitimacy, cohesion, and diplomacy. Populations retain beliefs after conquest. Reform and institutional adoption are gradual or event-driven consequences of state conditions, not random monthly government rerolls.

Countries track legitimacy, administrative capacity, integration, regional autonomy, unrest, and war exhaustion. Distance, difficult terrain, low infrastructure, and diverse regional interests increase governance demands. Strong states can invest, decentralize, or negotiate instead of inevitably collapsing.

**Required:** No forced collapse simply because a state is old or large. State size is a source of costs and opportunities, not a deletion trigger.

## 9. Diplomacy, warfare, and imperial control

Diplomatic records must distinguish peaceful relations, alliances, truces, trade access, military access, active wars, tribute, and overlord–subject relationships. Contact limits whom a country can reasonably evaluate, even though the observer sees the whole map.

War decision sequence: perceive reachable opportunity or threat → estimate benefit and cost → identify valid justification → evaluate allies, supply, and military readiness → choose objective → declare or pursue an alternative.

**Required:** Motivation and casus belli are separate. Resource access/security may motivate conflict; claims, reconquest, religious disputes, protected populations, or independence can justify it. Government or religious differences alone do not require war.

Armies are spatial units with manpower, equipment, morale/readiness, supply, and movement state. V1 uses abstract cell-based combat. Terrain, strength, supplies, and fortifications if implemented affect outcomes. Do not resolve all wars through one nation-level dice roll detached from territory.

Cell occupation is military control distinct from sovereignty. Successful capture of a provincial capital commits the province ownership transfer immediately, even while war continues. Peace assesses current ownership, remaining occupation and resistance, war aims, allies, costs, and access. It can negotiate territorial returns or further cessions, full annexation, subject status, independence, or an end to fighting. Ending a war does not silently undo a completed capital-capture transfer.

A campaign deadline triggers reassessment; it must not automatically erase decisive victory. Small defeated states can capitulate before every last cell is captured, while defensible or supported states may resist.

Imperial relationships:

| Relationship | Behavior |
|---|---|
| Integrated province | Direct rule with substantial established administration |
| Newly annexed province | Direct sovereignty with low integration and potential resistance |
| Occupied cells / contested province | Cell military control differs from the current province owner; remaining defenders can persist after the capital and sovereignty change hands |
| Dependent possession | Direct possession administered with separate autonomy/extraction priorities |
| Subject polity | Own government and provinces, constrained independence and possible tribute |

Prevent cycles in the subject graph. Alliances need explicit intervention rules and should not imply unconditional involvement in every conflict. Avoid nesting complexity beyond what the v1 UI can explain.

## 10. Consolidation, fragmentation, and extinction

**Required:** States should not survive forever merely because they own one cell or province. Viable small states remain possible.

Evaluate sustained independence using food, finances, population, administration, security, and external support. **Proposed default:** maintain a distress duration plus interpretable contributing factors; use separate trigger/recovery thresholds to prevent states rapidly switching status. Exact thresholds are balance configuration.

Possible outcomes: reform, autonomous survival, protective submission, compatible merger, annexation after defeat, loss of central government, or demographic abandonment. Recipients assess whether integration or protection is worth its costs.

Rebellions need connected regions, shared grievances/identity, sufficient participants, and a plausible organizer or center. Create successor states with actual transferred territory and assets. An uprising can fail; independence is not guaranteed.

Favor contiguous frontier growth, defensible regional settlements, and supply corridors. Enclaves need meaningful access or autonomy. Do not run a cosmetic border-cleanup pass that silently transfers people and sovereignty.

State extinction transaction must resolve holdings, surviving populations, armies, treasury/stockpiles, treaties, wars, subjects, and references. Preserve archived identity, dates, cause, and successor links. Population death is required only for demographic extinction, not annexation.

## 11. Atlas, selection, and diplomacy visibility

**Required:** Full working atlas with natural terrain, distinguishable countries, readable boundaries, zoom-dependent detail, and smooth pan/zoom. Historical cartography style: parchment land, blue oceans, shaded relief, restrained ornament, readable labels and compact panels.

The Fantasy Map Simulator reference is a stated visual direction for territorial readability; its exact implementation has not been researched or adopted here. Obtain reference screenshots before attempting a close visual comparison.

**Required selection sequence:** first click within a country selects the country; next click within that selected country selects a province; next click within that selected province selects a cell. Clicking another country resets to country level.

**Proposed interaction details:** clicking another province while at province/cell depth selects that province; breadcrumbs and Escape move up a level; drag is not a click; selection is stable during updates. Land in a province without a sovereign owner selects that province directly; land without any political province opens cell details. Explain the drill-down unobtrusively. Country selection highlights all direct holdings and clearly distinguishes its subjects.

**Confirmed for the unclaimed regional study:** first click highlights a province and shows province information; another click inside it highlights a cell and shows cell information. Clicking that selected cell again returns to its province, repeating the province → cell → province cycle. Clicking a different cell in the same province selects that cell. These are separate selection levels. Clicking another province returns to province level; water opens cell details directly. Country-level selection remains a later slice when countries exist in the study.

Country inspector: population, capital, holdings, government, cultures/religions, technology, economy/food, military, administration, legitimacy, unrest, active wars, allies, subjects and overlord, current goals, and timeline.

Province inspector: sovereignty and occupation, integration/autonomy, population composition, terrain summary, production, supply/access, and grievances.

Cell inspector: terrain, area, deposit/extraction, local population/settlement, infrastructure, and armies/control.

**Required:** A selected country makes allies, enemies, subjects, overlord, occupied areas and active conquest understandable immediately. Use a relationship legend, labeled lists with map navigation, and distinct patterns/icons as well as colors. Enemy status and military occupation are different overlays.

Map modes: political, terrain, culture, religion, resources, population, trade, technology, and selected-country relationships. Aggregate minority identities honestly; a dominant-culture map is not proof everyone shares that culture.

Global controls: date/speed, seed/new world, search, follow country, event filtering, selected-event autopause, save/load/export/import. New-world replacement asks before discarding unsaved play state; generation itself is an observer setup action.

## 12. Statistics and historical explanations

The reported mismatch between map takeover and “27% inhabited” must be addressed by defining terms, not inflating a percentage.

Required metrics with explicit denominators:

- **Claimed land %:** area of land cells in sovereign provinces / total land area × 100.
- **Inhabited land %:** area of land cells with a surviving settled population / total land area × 100. This is settlement-cell coverage, not literally built-up surface area.
- **Habitable land settled % (optional):** inhabited eligible land area / eligible habitable land area × 100; explain the eligibility rule.
- **Occupied land:** military control differing from sovereignty; not a second addition to world land.
- **World population:** every living population counted exactly once, including military and displaced populations.
- **Active independent states / subjects / tribes:** report separate categories or label combined totals clearly.

If most of the political map is claimed, claimed land should be high even when inhabited land is low. Political mode should emphasize claimed land; population mode emphasizes inhabited coverage.

History records actual dated state transitions. Each important decision saves its main evaluated factors at decision time, so explanations remain accurate after circumstances change. Explain shortages, wars, mergers, rebellion, capitulation, and dissolution using those records.

Archive founding, extinction, lineage, major wars and territorial settlements durably. Bound noisy event memory through summaries/compaction; do not erase all meaningful history by limiting the entire chronicle to the last 1,500 events. Full rewind/replay UI is deferred; reproducible saved continuation is required.

## 13. Proposed technical architecture

**Hosting update, 9 September 2026:** the user confirmed separate worlds per person, with world generation and simulation hosted on the user's PC. Worlds pause and save when the person leaves and resume on return. This replaces the original browser-worker/no-server proposal. It does not introduce shared-world multiplayer. See `docs/ARCHITECTURE.md` for the decision record and unresolved details.

**Frontend decision, 9 September 2026:** React + TypeScript + Vite is confirmed for the browser interface. The remaining infrastructure choices below are recommendations. Keep one repository and one package initially; split modules without creating unnecessary services or a complex monorepo.

**Backend foundation, 9 September 2026:** the local host uses Node.js + TypeScript, Fastify, shared validated transport, and a bounded Piscina worker pool to construct the authored terrain fixture. `npm start` launches it with the browser app; `npm run serve` serves the built app directly. See `docs/BACKEND_RESEARCH.md` and `docs/features/backend-02.md` for decisions, limits, and evidence. This pool executes disposable generation jobs. Tribe 01 introduces a separate simulation/storage worker and SQLite checkpoints for independent local instances; remote user accounts and larger simulation workloads remain later work.

- TypeScript simulation and UI integration.
- React components for interface panels and observer controls, built with Vite; atlas rendering remains separate.
- Canvas or WebGL rendering for the atlas; choose after a rendering benchmark, not by fashion.
- A host backend owns each independent world; background compute handles generation and simulation, while browsers handle input and rendering.
- Node-compatible headless runner importing the same simulation core.
- Host-side persistence suitable for independent large saves; JSON or compressed export with explicit schema/version metadata.
- Keep the simulation core independent of its host. Access from other PCs, per-world ownership, scheduling limits, and reconnect behavior require explicit contracts.

Suggested layout:

```text
src/
  simulation/    # state, clock, RNG, update order, systems, transactions
  worldgen/      # terrain, provinces, placement
  renderer/      # layers, labels, picking, camera
  ui/            # controls and inspectors
  persistence/   # serialization, validation, migrations
  worker/        # messages, batching, snapshots/deltas
  config/        # named balance configurations
server/          # host HTTP contracts and world lifecycle as implemented
scripts/         # combined local launch, headless scenarios and benchmarks
tests/           # invariant, scenario, save/load and browser checks
docs/            # design decisions, roadmap, feature briefs
```

Single source of truth: simulation owns all mutable world state. Renderer/UI receive versioned views; UI inspection never advances simulation or modifies totals. Derived caches have clear invalidation rules.

Stable entity IDs survive save/load, mergers, and archival. Province/cell IDs do not change when sovereign ownership changes. Ownership changes use one transaction function, not scattered mutations in warfare and diplomacy modules.

Determinism requires seeded RNG state, fixed update order, stable iteration order, explicit rounding policy, and versioned rules/configuration. Separate subsystem random streams where practical to reduce accidental coupling. No wall-clock time or unseeded randomness in game decisions.

**Proposed daily phases:** apply queued commands/events → local supply/production scheduled for date → demographic/disease updates → military movement/combat, including immediate successful capital-capture transfers → political decisions scheduled for date → settle other transfers/extinctions → refresh derived metrics → emit committed snapshot. Refine order during M0; document it and test that one phase does not spend the same resources twice. Later decisions in the same step must observe the committed capital-capture owner.

Save schema: versions, seed, date/tick, RNG state, rules/config identity, geography, active/archived entities, inventories, in-flight movement/trade, wars, scheduled events, history summaries. Save at a completed step. Loading validates structure before replacing a running world. Handle incompatible versions explicitly.

Performance: neighborhood graphs, spatial indexes, cached routes, incremental border geometry, view culling, level of detail, batched worker messages. Do not clone the whole world every animation frame. Do not parallelize nondeterministic mutations without a demonstrated bottleneck.

## 14. Verification and balance methodology

Separate three questions: is the implementation correct, is the simulation enjoyable, and is it fast enough?

### Correctness invariants

- Population ledger reconciles births/deaths/movement; annexation and merger conserve living people.
- No negative goods, duplicated trade deliveries, or duplicate army casualties.
- Each land cell has at most one active province; initially unclaimed land may have none. Every active province has one designated capital settlement and at most one sovereign owner.
- A successful provincial-capital capture transfers sovereignty once in the same committed step without changing uncaptured cells' military controllers or duplicating population/resources. Ordinary cell/town captures do not transfer province sovereignty.
- Subject graph has no cycles; extinct entities cannot initiate new actions.
- Movement/trade require accessible routes and appropriate technology.
- Same version/seed/config/steps produces the same result irrespective of playback speed.
- Save/load continuation matches an uninterrupted run.
- UI/world metrics match the underlying area and population definitions.

### Focused scenarios

1. Neighboring compatible tribes can unite; incompatible tribes are not forcibly merged by map cleanup.
2. A prosperous, protected small state survives while a defeated unsupplied state can capitulate.
3. Capturing a provincial capital immediately transfers its province, preserves survivors and identity, and leaves uncaptured defending cells under their actual military control; capturing an ordinary cell alone does not transfer it.
4. Sustained food loss causes depletion, decline, migration and possible abandonment.
5. Disease spreads through permitted contact and eventually recovers or loses susceptible hosts.
6. Rebellion forms a connected viable region; parent/successor history remains linked.
7. Primitive armies cannot cross oceans; appropriate navigation unlocks valid routes.
8. Claimed and inhabited percentages intentionally differ for a sparsely populated large realm.
9. Repeated map clicks and Escape follow the documented selection model.
10. No initial one-tick growth causes a paused new world to display inflated founding populations.
11. A founding national capital centers the first province; an ordinary town inside an existing province does not create a new province, while establishing a new provincial capital forms a connected province without overlapping claims or inventing people/resources.
12. Capturing the national capital transfers only its province; a viable country with other holdings can continue. Slow, costly capital relocation cannot cancel a completed capture.

### Balance evaluation

Establish a small fixed seed suite for routine comparisons and a larger rotating/held-out suite for milestone acceptance. Record baseline and changed results at matched simulation dates. Proposed initial routine suite: 5 seeds; release candidate suite: 20 seeds. These are budget defaults, not requirements to run expensive suites after every CSS edit.

Track country-size distribution, independent/subject counts, formation and extinction causes, annexation/white-peace rates, disconnected holdings, food deficits, population growth/mortality, settled/claimed area, trade dependency, technology spread and tick cost.

Use distributions and observed histories, not exact predetermined outcomes. A seed with enduring fragmented city-states can be valid; every seed degenerating into immortal fragments is not. Neither forced global unification nor a fixed empire-collapse timer is acceptable.

### Performance acceptance

Record hardware, browser/runtime, build mode, seed, cell/province count and dates for measurements. Proposed interactive target: p95 input feedback below 100 ms and roughly 30+ FPS while panning the default world. Report achievable simulation days per second instead of promising an arbitrary “500×” rate. Benchmark generation time, heap growth and ticks over both early and late worlds. Tune targets after the first measured baseline; no unmeasured claims.

Browser testing must verify actual interaction when available. Build/headless checks do not establish visual correctness. If browser tooling is blocked, report the gap and provide a short manual checklist; never claim the pass occurred.

## 15. Milestone roadmap and gates

Do not implement the entire spec in one autonomous task. Each milestone delivers something runnable and reviewable. Maintain a basic atlas from M1 onward.

| Milestone | Deliverable | Exit gate |
|---|---|---|
| M0: Inventory and contracts | Preserve prototype/source if obtainable; feature inventory; definitions; architecture and ownership decision | No unresolved ambiguity about cell/province sovereignty, scale units, population accounting, or first scope; current features marked verified/unverified |
| M1: World and atlas | Seeded geography, spaced founding capitals and initial country-created provinces, pan/zoom/picking, hierarchy selection, area metrics | Reproducible viable starts; correct wrap; readable borders; default-world benchmark |
| M2: Living settlements | Food, labor, births/deaths, reserves, recruitment accounting primitives, migration/abandonment, simple disease | Population conservation and shortage/outbreak scenarios; no immortal floors |
| M3: Formation and expansion | Frontier settlement, provincial capitals and ordinary towns, province growth/splits, organizational development, mergers, identities, administrative reach | Observable competitive early expansion; connected holdings; new countries trace to actual populations |
| M4: War and consolidation | Army movement/supply, cell occupation, immediate capital-capture ownership transfers, peace, capitulation, subjects, extinction | Decisive defeat possible; viable small-state survival; no casualty/transfer duplication; diplomacy UI explains state |
| M5: Economy and knowledge | Production chains, routes, actual exchange, technology/diffusion/navigation | Missing resources constrain action; route disruption matters; technology gates work |
| M6: Institutions and fragmentation | Government/religion, legitimacy/autonomy, succession and coherent rebellion | Meaningful causes and recovery; successful empires and successor states both possible |
| M7: Release foundation | Save migrations, durable history summaries, observer polish, long-run balance and performance | Multi-seed evidence, browser/manual QA, documented limitations, install/run instructions |

Dependencies: M2 has a simple local food economy before the richer M5 market. M4 may use a minimal technology-gated transport model before M5 expands it. M3/M4 include only institutions needed for their decisions; M6 deepens them. Build these as real simple versions that are extended, not fake stub statistics presented as completed features.

After M7, consider richer medieval systems or later eras, improved oceanic expansion, industrial production, modern diplomacy, then god tools. Do not infer approval to implement deferred features.

## 16. Working with Codex locally

Use a local Git repository and small, reversible feature changes. Choose the strongest available model for high-coupling design, simulation changes and review; model availability should be checked in the actual local client. This document does not prescribe a version, subscription, or reasoning-setting guarantee.

Maintain:

- This specification or an equivalent `docs/GAME_DESIGN.md` as the canonical behavior reference.
- `docs/ARCHITECTURE.md` for data contracts and update ordering.
- `docs/ROADMAP.md` for current milestone and known gaps.
- A short `AGENTS.md` directing Codex to those files, actual run/test commands, invariants and scope rules.
- One feature brief for the work currently underway.

Do not copy the entire design into every prompt. Provide the specific goal and point Codex at the relevant sections. Do not assume chat memory transfers to the local repository.

Recommended feature cycle:

1. Choose one behavior and its milestone.
2. Define observable acceptance criteria and a reproducible scenario.
3. Ask Codex to inspect relevant code and propose a bounded implementation.
4. Review consequential changes to mechanics/data contracts.
5. Implement, run focused tests, compare relevant simulation metrics, inspect UI where affected.
6. Review the diff for hidden scope changes and unsupported claims.
7. Update docs, record evidence, commit a working checkpoint.
8. Start the next feature from this committed state.

When something fails, preserve its seed, config, simulation date, last valid save and event trace. Reproduce before changing balance. If a result is correct but undesirable, label it a balance issue. Avoid fixing an accounting bug by adjusting growth coefficients.

Use separate worktrees only when needed for concurrent or risky experiments. Parallel agent work is optional after interfaces are stable; do not initially have several agents independently design economy, war and population against incompatible state models.

### Feature-brief template

```text
Feature:
Spec sections:
Observed problem / intended behavior:
Relevant current code:
Inputs and state owned:
Rules and state transitions:
UI explanation:
Acceptance scenarios:
Correctness invariants:
Relevant performance/balance measurements:
Save compatibility:
Out of scope:
Completion evidence:
```

### Suggested repository instructions for Codex

```text
Read docs/GAME_DESIGN.md, docs/ARCHITECTURE.md and the active feature brief.
Implement only the agreed milestone/feature; flag consequential conflicts.
Keep simulation logic independent of rendering and browser APIs.
Preserve deterministic stepping and explicit population/resource accounting.
Use the canonical transfer operations for ownership and entity lifecycle changes.
Do not replace missing mechanics with decorative numbers or random map changes.
Do not fix balance by silently violating geography, population or resource rules.
Run focused verification; broaden multi-seed runs when balance or core systems change.
Report actual commands/results and any untested browser behavior.
Update relevant docs and preserve a working Git checkpoint.
Do not deploy, discard saves, or undertake a broad rewrite without task authorization.
```

### First local Codex task

```text
Read CHRONICLE_SPEC.md. We are starting M0 only.
Inventory any supplied prototype source and list reusable pieces, broken assumptions,
and missing features against this spec. Treat screenshots as observations, not code proof.
If this is an empty repo, record that and proceed with a proposed architecture.
Write a concise architecture/design decision record and M1 feature brief.
Resolve how provinces, cells, population, sovereignty and occupation will be represented.
List proposed tools/dependencies and the actual commands we will need after setup.
Do not implement the entire game. Present the M1 plan and any consequential decisions
that need review before implementation.
```

## 17. Decisions to track and immediate checklist

The product direction is established; the following proposed defaults should be recorded or revised at M0, not silently treated as historical user approvals:

- Exact starting-population/tribe count ranges.
- Cell counts and developed-world province counts for benchmarking.
- Initial claim extent, frontier growth costs, provincial-capital promotion and province split/merge rules, and low administrative reach semantics.
- Successful capital-capture conditions, relocation time/cost, and abandoned-province lifecycle rules; the immediate ownership-transfer trigger is already agreed.
- Calendar and system update schedule.
- Renderer and local project tooling after benchmarking.
- Mortality, supply, integration, distress and surrender calibration.
- Whether old prototype saves warrant a migration or should remain archived with the prototype.

Implementation should not be blocked on arbitrary tuning constants: start with named defaults and instrument them. Data-ownership contradictions must be resolved before coding dependent systems.

Immediate follow-along checklist:

- [ ] Save the current prototype/source and example screenshots if available.
- [ ] Place this spec in a new local Git repository.
- [ ] Compare any additional private notes against the evidence register; add missing confirmed requirements.
- [ ] Run the M0 task with Codex.
- [ ] Approve or revise the consequential architecture decisions.
- [ ] Implement M1 and inspect a paused day-one world before proceeding.
- [ ] Establish a headless run and performance baseline.
- [ ] Complete M2–M7 in order, committing each verified feature.
- [ ] Keep future-era ideas in the backlog until the ancient-to-medieval foundation meets its gates.

## 18. Documentation references

These official references were checked during the preceding workflow discussion; they concern Codex usage, not evidence about Chronicle implementation:

- Codex IDE extension: https://developers.openai.com/codex/ide/
- Repository instructions with AGENTS.md: https://developers.openai.com/codex/guides/agents-md/

Game algorithms, parameter ranges and milestone gates in this document are engineering proposals for this project, not claims of historical realism or externally validated simulation science.
