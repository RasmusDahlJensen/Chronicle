# Chronicle — Civilization Simulation Vision

Agreed 1 October 2026 · Rasmus Dahl Jensen, with Claude

## Purpose and agent instructions

This document defines the civilization layer of Chronicle, an observer-mode civilization simulator in which bands of people appear at year 0 and history unfolds on its own toward an industrial and atomic peak. World generation (tectonics, climate, rivers, lakes, biomes, fertility, resource sites) already exists. It is out of scope except for the one approved change, slice G1.

It is written to be implemented by an autonomous coding agent in this repository, `RasmusDahlJensen/Chronicle`: TypeScript on Node 24.20.0, React and Vite in the browser, a Canvas 2D renderer, a Fastify host with a Piscina pool for geography, TypeBox contracts, Biome architecture checks and Playwright. The simulation runs on the host in a worker; the browser only observes and sends observer controls.

This is the vision document `AGENTS.md` refers to. It defines the game and its civilizations; `docs/CHRONICLE_SPEC.md` stays authoritative for geography, except where this document names an approved change. Rules for the agent:

1. **Process.** Follow `AGENTS.md`, `docs/WORKFLOW.Md` and `docs/ARCHITECTURE.md`, which were updated together with this document to authorize the run below. Deliver each milestone as one or more slices in order (for example M2a: tech graph and research; M2b: resource gating, mobility and settling). Each slice has its own brief in `docs/features/` using the workflow's template, passes the complete `npm run check`, and gets a commit. Record decisions, defaults chosen for ambiguities, results, story-health tables and the next action in the active brief. Do not create separate progress or decision files.
2. **Authorized scope and order:** G1, M0, M1, M2, then **one stop for user review**, then M3, M3b, M3c (added at the M3b review on 6 October 2026), **a stop for user review**, then M4, M5, M6, M7, M8, M9. P (persistence) waits until the user asks for it (user, 6 October 2026); until then every slice keeps the state save-ready, which a test guards: a state copied mid-history continues exactly as the original. Between slices, continue without waiting for user review, except at the stop after M2. For this run, this overrides the workflow's rules against starting the next slice automatically and its per-slice user-review step. Record each verified slice in its brief as "verified, awaiting user review".
   - A milestone is done when its acceptance criteria and the complete `npm run check` pass. After each milestone (and after G1), get an independent agent review and resolve its material findings. From M0 on, run the headless study over the five study seeds and write the story-health table into the brief. Write a review package into the brief: the commands to reproduce, lab screenshots of seed `Chronicle` at years 0, 100, 250, 500 and 1,000 plus the milestone's key years, and the study charts (world population, polity count, largest share) for all five seeds. Save screenshots and charts under `.chronicle/review/<milestone>/` (ignored by Git) and list their paths in the brief; commit only text and tables. Then commit and tag (rule 10) and start the next milestone (after M2, stop instead; see below).
   - **Stop after M2.** After tagging M2, stop and ask the user to review bands, population, band movement, research and settling in the lab, using the review package. Continue only after the user approves or after their requested changes are made and verified.
   - **Stop conditions** at any other point:
     - (a) acceptance criteria still fail after the workflow's return-to-diagnosis step and two further evidence-based attempts;
     - (b) the next step would change accepted geography (beyond G1), an existing contract beyond what this document describes, or anything this document marks as needing user approval;
     - (c) from M7 on, the story-health table shows a degenerate world (as defined under Story health) that tuning within this document cannot fix; from M2 on, a plateau (as defined there) in 3 or more of the 5 study seeds that tuning within this document cannot fix is also a stop. Before M7, a map that stops changing once the land has filled is expected, because war (M6) and fracture (M7) do not exist yet; report it without stopping;
     - (d) the complete check fails for environmental reasons (missing Chromium, ports in use, disk) that the agent cannot fix within the repository.

     On a stop, record the evidence and the exact next action in the brief and end the session.
3. **Geography is read-only.** Derive simulation data (regions, adjacency, food potential, site assignment) in the simulation layer from the validated manifest and tiles. Do not change generation, `WORLD_GENERATOR_VERSION` or the world protocol, except in slice G1.
4. **Code placement.** Simulation rules go in `src/simulation/` (reserved in the Biome rules). Cross-process contracts go in `shared/`. The simulation must not import `src/world/generation` (add that ban and its negative architecture test). Observer presentation data that the browser needs (event text templates, map palettes) lives in a browser-side data module, because the browser may not import `src/simulation`. Extend the architecture rules and their negative tests for every new boundary.
5. **Tunables in data.** Every tunable number lives in typed data modules (simulation numbers under `src/simulation/`), validated at startup, never inline in system code. Numbers in this document are starting values, not requirements, except acceptance thresholds, which must not be loosened to pass.
6. **Ambiguity.** When this document is ambiguous, choose the simplest option consistent with the design pillars, record it in the active brief, and continue. Ask only about consequential scope or contract changes.
7. **The archive.** Do not merge, restore or port code from `archive/civilization-v1`, and never check it out; if needed, inspect it only with `git log` or `git show`. The same removed work and its documents also exist on the remote branch `origin/feat/atlas-01` and in `main`'s history before `6feda3f`; treat them exactly like the archive. Learn from why it was removed. It passed more than 200 tests, yet the user rejected it in the lab, more than once: first because populations had no births or deaths and growth plateaued at three communities; later, after births and deaths existed, because expansion was too slow, stalled at hard thresholds (a fixed food reserve, one shrinking claim party) and did not follow what the land could feed. Passing tests are not acceptance. Each milestone must show the intended behavior in the lab and in the headless story-health output. Prefer graded trade-offs to hard cutoffs.
8. **Exact accounting.** Every change in a region's population is explained by recorded births, deaths (by cause) and migration. Every change in food or wealth is explained by recorded flows. Never widen a tolerance to pass a check.
9. **Scope rule.** If a feature has no effect on events or on what an observer sees, leave it out.
10. **Git.** Work directly on `main`. Do not create branches or worktrees, and never modify, rebase or delete `archive/civilization-v1`. Commit only verified states, ending messages with the attribution lines the agent's harness supplies (in Claude Code, the Co-Authored-By trailer used in `a6c2f6d`). Tag the last commit of each completed milestone with an annotated tag: `civ-g1`, `civ-m0`, `civ-m1`, `civ-m2`, `civ-m3`, `civ-m3b`, `civ-p`, `civ-m4` … `civ-m9`. Never move or delete a tag; a later fix to an earlier milestone is a new commit in the current slice. Never rewrite history (no amending tagged commits, rebase, `reset --hard` or force). Do not push commits or tags; the user pushes after review, so each brief records that CI has not run.

## Design pillars

Chronicle is a story simulator: every system exists to produce causes and consequences an observer can follow. It is not a battle simulator or a trading simulator.

1. **Pressure, not scripts.** Civilizations act because of needs (hunger, land, resources, threat) filtered through their values. No hand-authored historical events.
2. **Geography first.** Rivers, coasts, mountains, climate and deposits decide where civilizations rise, what they lack and whom they fight.
3. **Eras change parameters, not systems.** The same loop runs from the first band to the last nation. Technology changes coefficients and unlocks capabilities, buildings and wonders as data; it does not swap in new systems.
4. **You only know what you know.** A civ cannot use, value or even see things it lacks the knowledge for, and it only knows civs it has contacted.
5. **Every growth force has a counter-force.** Size brings overextension, comfort erodes cohesion, hegemons attract coalitions, wars produce exhaustion. Nothing lasts forever.
6. **Nothing is lost from history.** Collapsed empires leave cultures, religions, names, ruins, roads and grievances that keep influencing the world.
7. **People change the world.** Civilizations build villages, cities, roads, bridges, farmland, harbors and wonders that the observer can see grow, and that war, collapse and neglect can tear down again.

**Scope rule:** if a mechanic cannot change an event in the chronicle or something an observer sees on the map, cut it.

**Non-goals:** player control of a civilization, tactical battles or unit movement, simulating individual citizens, per-good price economies, balance or fairness between civs, scripted history.

## Core loop and time

One loop runs every simulated month, from the first band to the atomic age: land produces food, food grows population, surplus frees specialists, specialists create knowledge, wealth and power, and growth pushes civs outward into new land, building, trade and war.

| Stage | Feeds | Counter-force |
| --- | --- | --- |
| Land produces food | population | game depletion, bad harvests, devastation |
| Food grows population | workers, soldiers, migrants, townspeople | diminishing returns on the land, famine, plague in dense places |
| Surplus frees specialists | research, wealth, administration, building | no surplus, no advance |
| Specialists create knowledge and power | techs, buildings, military strength | new resource demands and shortages (tin, coal, oil) |
| Power pushes outward | new land, roads, contact | governance reach, overextension, cohesion decay |
| Contact brings trade and war | wealth, conquest, diffusion, alliances | war exhaustion, coalitions against hegemons, revolts and fracture |

Every stage that succeeds also feeds a counter-force, which is what produces rise-and-fall cycles instead of one civ swallowing the map.

**Time.** One tick is one month. A full run of roughly 3,000–4,000 years from year 0 to the atomic peak (36,000–48,000 ticks) is paced mainly by tech costs. Each system runs at the cadence listed below. Cadences are defined in months or years in data, never in ticks. Rates and probabilities are stored per year: a step of length t years uses rate × t and probability 1 − (1 − p)^t, so changing a cadence never requires retuning. Seasons come from a simple harvest calendar by latitude: farming food arrives in harvest months and must be stored to last the year. Before Pottery a band can keep only a small perishable store (data, about one month of food); Pottery and later storage techs raise that limit, and Pottery is a prerequisite of Agriculture, so farmers can always store a harvest. Geography itself stays annual.

**System order per monthly tick** (fixed, for determinism):

1. Environment, monthly: harvest calendar, yield variance, droughts, climate shocks
2. Production, monthly: food and resources per region
3. Population, monthly: births, deaths, starvation, plague, migration, band moves and fission
4. Knowledge, monthly: research progress, discoveries, shared knowledge
5. Culture and religion, yearly (staggered by culture id across months): drift, influence, assimilation, spread, splits, hybrids, religion founding and schisms
6. Stability, monthly: happiness, cohesion, unrest
7. Decisions, every 6 months per polity, staggered by polity id: score and pick actions
8. Construction, monthly: progress, completion, upkeep and decay of buildings, wonders and infrastructure
9. Diplomacy and trade, monthly: agreements transfer resources and wealth; proposals arise only from decision steps
10. War, monthly: front resolution at per-year rates, occupation, looting and destruction, exhaustion, peace checks; one battle-year summary event per front per year when notable
11. Fracture, monthly checks: revolts, secession, civil wars, successions
12. Chronicle, monthly: flush events emitted this tick

## Data model

The unit of simulation is the **region**, a cluster of land cells, not the cell or the individual person. Cells stay the source of geographic truth. Regions aggregate them so the simulation stays fast at modern population scales. In this codebase a *tile* is a 128 × 128 transport chunk and a *cell* is one map square; this document always means cells.

**Region generation (one-time, after world generation).** Derive regions deterministically in the simulation layer from the validated manifest and tiles, without changing the geography protocol.

- Partition land cells into regions of roughly 20,000–60,000 km² (configurable by area, so Standard and Large worlds get comparable regions: about 20–60 cells on Large, 5–15 on Standard). A Large world has 524,288 equal-area cells of about 973 km², of which about a fifth to a quarter are land on the study seeds (roughly 100,000–140,000 cells), giving roughly 2,500–4,000 land regions.
- Place seeds by Poisson-disk sampling biased toward fertile, watered land. Grow regions by flood fill on movement cost using true spherical distances (the equal-area projection distorts horizontal lengths), so mountain ranges and deserts become natural borders. Merge fragments below the minimum area into a neighbor; islands below the minimum stay their own region. Every land cell belongs to exactly one region.
- Precompute per region:
  - **food potential** by method (foraging, hunting, herding, farming, fishing) from the existing fertility score (0–100), temperature, moisture and biome;
  - **water:** best river tier (none, stream, river, great river) from the hydrology graph's runoff, with tier thresholds chosen from the measured runoff distribution and recorded in the M0 brief; open-lake freshwater access; coastal flag;
  - **resource sites:** sites on the region's land cells, plus lake and marine fish sites within 2 cells of its coast or lakeshore, each assigned to its nearest region (ties by region id); fish sites farther offshore are not used;
  - **defensibility** from terrain roughness;
  - **neighbors** with land travel cost and the river tier crossed on that edge, plus a sea-adjacency list with crossing distance;
  - **settlement sites:** a short ranked list of candidate cells (river crossings and mouths, confluences, coasts, lakeshores, resource sites, defensible ground).

| Entity | Key fields |
| --- | --- |
| Region | cells, precomputed geography, owner polity, population groups, settlements, cultivated cells, stability, devastation, game stock |
| Population group | size, culture, religion, occupation shares (foragers, hunters, herders, farmers, fishers, specialists, soldiers, elite), rural or urban, lives in one region |
| Polity | a band (nomadic stage) or a civilization (settled stage); see below |
| Settlement | name, cell, region, owner, tier (village, town, city, metropolis), capital flag, urban population, buildings with condition, founding year, status (alive, ruined, razed) |
| Building | type (from data), settlement, condition, built year, builder polity |
| Wonder | type (from data), settlement, name, builder, built year, condition, destroyed year and cause |
| Infrastructure edge | region edge, kind (road tier, bridge, canal, rail, highway), condition, builder(s), built year |
| Civilization fields | name, color, capital settlement, regions, government, ruler, known techs, research progress, resource supply and demand, wealth, military strength, cohesion, stability, relations, known polities, effective values |
| Ruler and dynasty | name, traits, age, dynasty, epithet, legitimacy |
| Culture | name, values vector, traits, language seed, parent cultures with weights, founding year |
| Religion | name, tenets, founder, holy region, parent religion, founding year |
| War | belligerents, goal, war score, exhaustion per side, start year, contested regions |
| Treaty | type (trade, non-aggression, alliance, road agreement, vassalage, peace terms), parties, terms, start and end year |
| Event | see the Chronicle section |

**Polities.** A band and a civilization are the same entity type, a *polity*, at different stages. A band (a tribe) has the government Band / tribe, its own known techs and research, and one or more regions it roams, one population group (a band of people) in each, but owns none; a civilization owns regions. (Changed at the M2 review, 2 October 2026, at the user's request: a tribe can span several regions.) Every population group belongs to exactly one polity. This lets bands research, decide (Raid, Explore) and carry culture with the same code that civilizations use.

Every entity has a stable integer id assigned in creation order. Entities are never deleted, only marked dead with a death year, so history stays queryable. Population groups in the same region and polity with the same culture, religion and urban/rural status merge; an emptied group is marked dead. This keeps the group count bounded.

## Knowledge and technology

All polities share one technology graph defined in data, but each progresses through it on its own path, shaped by its environment, needs and contacts. There are no per-civ trees; the individuality comes from which techs a polity pursues and when.

**Tech definition (data file):** id, display name, era label, prerequisites, base cost, affinity conditions, effects. Effects are limited to these kinds, so new techs never need new code:

- coefficient modifiers (food yield per method, growth rate, governance reach, military strength, research rate, disease mortality, trade range, storage)
- resource reveal or resource extraction (see gating below)
- mobility level (see below)
- unlocks for government forms, religion founding, actions, treaty types, buildings, wonders and infrastructure kinds

**Research.** Every polity, including bands, earns a small base research per person per year (experience and tinkering), scaled by contact; it grows with a people's size with diminishing returns, so a large people researches faster than a small one, but not in proportion. Base research alone must make Agriculture reachable for well-placed bands within a few centuries. Specialists add research on top once surplus exists, and buildings (libraries, universities) multiply it. Points flow into one active tech at a time, chosen by weighted random among available techs. Weights come from:

- **need:** starving raises food techs, an unmet resource demand raises its extraction tech, war raises military techs
- **environment:** coastal raises sailing; grassland raises herding; fertile river or lake land and wild grain or game sites raise Agriculture and Animal husbandry; known-but-unusable deposits raise their extraction tech
- **shared knowledge:** a tech known by a people that shares its knowledge with the polity (see Sharing knowledge) weighs more
- **culture:** the Tradition value slows research of techs that change the economy; Openness raises the sharing bonus

**Paths, not a timeline.** (Changed after the M3 review, 2 October 2026, at the user's request: contact used to make a neighbour's techs almost free, so every people learned farming within a few decades of its invention.) Each people chooses its research from its own needs, land and culture, and researches at its own speed. Peoples therefore follow different paths through the same graph and reach the eras at different times. A river people may farm centuries before its hill neighbours, who may work stone and metal first. No polity learns a tech automatically from its neighbours, however friendly. Knowledge moves between peoples only in these ways:

- **invention:** a people researches the tech itself
- **inheritance:** a breakaway keeps what its parent knew
- **merging:** a tribe that joins a civilization, a band a civilization takes in, or a civilization that unites with another, brings its knowledge; the united people knows what either knew. (The clause on bands taken in was added after the M3 review as an agent default, because without it herders taken in by farmers who could not herd starved; the user approved it with M3.5 on 6 October 2026. See the M3.5 brief.)
- **catch-up:** a tech of an earlier era than the most advanced era the polity knows of (its own, or that of a people it has met) is researched a little faster: 25% per era behind, at most twice as fast (data). Knowing that something can be done makes it easier, never free.
- **sharing:** while a people it knows shares its knowledge with it, the polity researches the techs that people knows several times faster (Openness raises this) and weighs them more. From M5, trade agreements and alliances also share knowledge.

**Sharing knowledge.** (Added after the M3 review, 2 October 2026, at the user's request.) At its decision step a civilization may offer to share knowledge with a people it is in contact with: a tribe or civilization it has met, within two regions. It weighs:

- what it would learn from them, the main draw;
- its kinship and likeness with them, and its Openness: open, kin peoples also teach for nothing in return;
- against its Tradition and the exchanges it already keeps up.

The other side accepts unless its Tradition and the cultural distance between them make it refuse, and it is readier when it would learn something too; a refusal is remembered for a while. An accepted exchange runs both ways for 40 years (data) and can be renewed. It is a chronicle event (knowledge shared) with its causes. Sharing is always chosen, never automatic. Tribes have no decision step yet, so they share only when a civilization offers.

**Where a discovery happens.** A polity that spans many regions discovers a tech where its people live in the conditions that drew it to that tech: the region with the most people × the strength of the tech's environment affinities there, or its heartland when none apply. For example, farming is invented in its fertile river valley. The record of firsts and the chronicle use the same place. (Added at the M3 review, 2 October 2026, at the user's request.)

**Eras** (Stone, Neolithic, Bronze, Iron, Classical, Medieval, Early modern, Industrial, Modern, Atomic) are labels computed from the techs a polity knows. They are never gates.

**Resource gating.** Each resource type has a `revealedBy` tech and an `extractedBy` tech, and some need a further tech to be useful. Per polity, every deposit is in one of three states: unknown (invisible to that polity), known but unusable (raises research weight for its extraction tech), usable. Examples: iron ore is revealed early, extracted with Mining, and useful only with Iron working; coal and oil are invisible until Geology, coal is extracted with Deep mining and used by Industrialization, oil is extracted with Drilling and used by Combustion engine; uranium is invisible until Nuclear physics and extracted with Advanced mining. Deposits a polity cannot see have no value to it in trade or war decisions.

The extraction requirements already in `RESOURCE_RULES` (`src/world/resources.ts`: Fishing, Agriculture, Forestry, Hunting, Masonry, Mining, Salt harvesting, Deep mining, Advanced mining) must exist as techs with exactly those names (same spelling and capitalization); do not rename them. A test fails if any is missing.

**Mobility.** Reachability is a per-polity graph derived from its mobility level and infrastructure, recomputed when either changes:

| Level | Unlocked by | Reach |
| --- | --- | --- |
| Foot | start | land neighbors; great rivers are costly to cross without a bridge |
| River boats | Boatbuilding | faster travel and trade along rivers and lakes |
| Coastal sailing | Sailing (from a region with a harbor) | sea crossings up to a short distance from a coast |
| Ocean navigation | Navigation (from a region with a harbor) | any coastal region |
| Rail and steam | Railways, Steam power | travel cost reduced along rail lines, governance reach up |
| Flight | Flight (from an airport) | ignores terrain for military strikes and contact |
| Space | Rocketry, Spaceflight (from a rocket site) | satellites boost communication; prestige events |

Until a polity learns Sailing and builds a harbor, islands and other landmasses are unreachable, so isolated cultures develop on their own.

**Knowledge loss.** When a civ fractures or collapses, or loses its last library, successor states inherit known techs, but techs flagged `requiresScale` (for example Administration, Engineering) can be lost if the successor's specialist base or libraries fall below a threshold, producing dark ages.

**Starter tech list** (the agent expands this to roughly 60–80 techs in data):

| Era | Example techs | What they unlock |
| --- | --- | --- |
| Stone | Foraging, Fire, Hunting, Fishing | starting yields |
| Neolithic | Pottery, Agriculture (requires Pottery), Animal husbandry, Boatbuilding, Masonry | food storage, farming and herding yields, river travel, granaries and walls |
| Bronze | Mining, Copper working, Bronze working, Writing, Wheel, Salt harvesting | copper and tin extraction, monarchy, records and libraries, roads, salt |
| Iron | Iron working, Sailing, Currency, Mathematics, Forestry | iron use, coastal reach and harbors, markets and trade range |
| Classical | Engineering, Philosophy, Administration, Organized religion | paved roads, bridges, aqueducts, governance reach, religion founding, republics |
| Medieval | Feudalism, Navigation, Theology, Astronomy | ocean reach, theocracy, observatories |
| Early modern | Gunpowder, Printing, Banking, Geology | coal and oil revealed, universities, democracy unlocked |
| Industrial | Steam power, Railways, Industrialization, Fertilizer, Drilling, Deep mining | coal use, rail, factories, industrial break, escape from the Malthusian limit |
| Modern | Electricity, Combustion engine, Flight, Medicine | oil use, highways, airports, demographic transition |
| Atomic | Nuclear physics, Advanced mining, Nuclear power, Nuclear weapons, Rocketry, Spaceflight | uranium, reactors, warheads, rocket sites, space |

## Food, population and borders

Food is the engine of everything: it caps population, its surplus pays for specialists and building, and its shortage is the strongest motive for migration and war.

**Starting state.** At year 0, spawn a configurable number of bands (default 30, 50–200 people each), placed by weighted random in high-attractiveness regions (fresh water, food potential, mild climate), with a minimum spacing. Each band gets its own culture with randomized values and a language seed. Bands know Foraging, Fire, Hunting and Fishing, which give the foraging, hunting and fishing methods and make game and fish sites usable.

**Production.** Each method's output in a region saturates with labor: output = potential × multipliers × L × (1 − e^(−workers / L)), where L is that method's labor capacity in the region. Workers flow toward the method with the best marginal yield. Foraging and hunting also deplete a regional game stock that regenerates slowly, so bands outgrow their land and must move, split or innovate. Great rivers and lakes multiply farming yields. Food sites (grain, game, fish) add a bonus to their method once extractable.

**Population.** Carrying capacity is not a separate number: it is the population whose saturated output equals its food need, and the inspector shows it that way. Births and deaths are functions of food security (stored plus expected food ÷ annual need), so logistic growth emerges from food rather than from a formula. (Added in M3b.6–7 and approved by the user at the M3b review: farmers keep a reserve of a few months in store, and births slow while it is short. Within what its land lastingly feeds, a people eating its fill from its stores does not die of hunger; above it, hunger follows the land alone, so stores never let people linger above capacity. See the M3b.6 and M3b.7 briefs.) **Famine is mitigable, by wealth and knowledge** (user, M3b review): a rich realm moves stored food to its famine-struck regions and builds and learns better storage (granaries, later silos, refrigeration), so famine devastates poor peoples far more than rich ones. Rates are defined per year and applied monthly. Populations are integers; fractional births and deaths carry over as per-region remainders, so monthly steps stay exact and deterministic. Deaths spike in famine. Medicine techs lower mortality; late techs lower birth rates (the demographic transition), so modern populations level off instead of exploding.

Starting reference values (data; tune with evidence): foraging supports about 0.05–0.2 people per km² of productive land, herding 1–3, farming 10–40, industrial farming 50–150. Unconstrained net growth is about 1% per year for foragers and 1.5% for farmers. Pacing target: an empty fertile region entered by a band or settlers reaches 80% of its capacity within about 150 years.

**Land pressure** is a graded need from 0 to 1 that starts rising well below capacity (data, from about 60% of capacity). It also rises when a known, reachable region offers clearly more food per person (opportunity). Nothing about movement or expansion is gated by a hard threshold.

**Band movement and fission.** Each of a tribe's bands moves as a whole to a better reachable region when its pressure and the opportunity justify it. When a band grows past its split size (data, about 400 people) or its pressure stays high, about 40% of it leaves for the best reachable unoccupied neighbor. Usually the newcomers stay part of their tribe, as a new band of it (event: band spread); sometimes they break away as a new tribe, with the parent's techs and a daughter culture that keeps the language seed and slightly mutates the values (event: band split). Breaking away is graded, never certain: likelier the further the new land lies from the tribe's heartland and the larger the tribe already is, a little likelier for cultures high in Expansionism and less for those high in Tradition, and its causes are recorded. Fission is how people spread across each landmass before farming; expect hundreds of bands by year 500, in fewer, larger tribes. A band with no free neighbor stays and feels the pressure (famine, later raids). (Changed at the M2 review, 2 October 2026, at the user's request: splits mostly stay together, so peoples grow as groups and become civilizations together.)

**Settling.** A tribe settles when it knows Agriculture or Animal husbandry and its heartland band has stayed in its region long enough (data, about 20 years). Larger peoples form states first: the chance grows with the tribe's people, with a floor so that small farming tribes settle too in time. Meanwhile they can join a civilization next to them or be taken in by one. (Added at the M3 review, 2 October 2026, at the user's request.) The whole tribe keeps its identity and becomes one civilization: it owns all the regions its bands live in, founds a named village in each, and the village in its heartland becomes its capital. (Changed at the M2 review, 2 October 2026, at the user's request.)

**Joining.** A band that would settle in or next to a civilization's land, within that civ's governance reach, weighs joining it against founding its own civ: joining scores higher with culture similarity, the civ's prestige, food security and stability, and lower with the band's Tradition and Expansionism. The choice and its causes are recorded (event: band joined). Bands beyond every civ's reach found their own civilization. Before war exists, joining and absorption are how early civs grow beyond their first valley instead of the map filling with hundreds of one-region civs.

**Unification.** Civilizations can also become one country peacefully (the Unite action of the decision model). At its decision step, a civilization next to a larger civilization it knows weighs joining it. These make it likelier:
- kinship (the same founding people);
- culture similarity;
- how much larger, better fed and more stable the neighbour looks;
- its own hunger and unrest;
- an easy crossing between them.

These make it less likely:
- its own Tradition and Expansionism;
- its own stability and prosperity;
- mountains, deserts or great rivers between them.

A civilization never unites into a smaller one. The larger civilization accepts only land it can govern (governance reach). On union, the smaller civilization's regions and settlements pass to the larger one, and its capital becomes an ordinary settlement. Its people keep their culture, so distance and rule over another people can make the new regions less stable. The chronicle records the union and its causes (event: unification). Unions are never certain, and they can come apart again (see Independence). (Added at the M3 review, 2 October 2026, at the user's request: countries form peacefully as well as by war.)

**Migration.** Between populated regions, within a civ or across borders, people move in proportion to the difference in pressure between regions, keeping their culture and religion. This is the main source of cultural mixing. Empty land is entered only by band movement and fission or by a civ's Expand action. When a civ expands into a band's region, part of the band may join the civ as a minority group (event: band absorbed); otherwise the band moves on.

**Specialists and townspeople.** The share of population freed from food production is a function of food surplus, storage and tech. Specialists live in settlements and produce research, wealth, military strength, building labor and religious and administrative capacity. A polity without surplus cannot advance; this is the central bottleneck of the early game.

**Expansion.** Expand has no threshold: its score is land pressure × the best candidate's value × Expansionism, minus distance and governance-reach costs. The new region is settled by a population group from the source region, which founds a village there. Expansion range is limited by governance reach, which grows with roads, transport, communication and administration techs.

**New polities** come from the initial bands, band fission (and the settling of those bands) and the fracture of existing civs.

## Settlements and infrastructure

Civilizations change the world they live on. Settlements house their people and hold their knowledge, wealth and power; roads, bridges and farmland tie the land together; and everything built can be destroyed.

**Settlements.** A settlement is a named place on a specific cell, chosen from its region's candidate sites. Tiers (village, town, city, metropolis) follow urban population, changing only when a settlement has stayed past the line for some years, so a place hovering at a threshold is not announced as growing and shrinking again and again. **Capital** is a role, not a tier: the seat of government, where governance reach is measured from and treaties are signed, and a prime target in war. A region's people are rural (food producers on its cultivated land) or urban (specialists, soldiers and the elite); urban people live in its settlements. A settlement's size is capped by its housing (raised by buildings such as aqueducts) and by the food that reaches it from its hinterland and trade. New settlements appear when a civ expands, when a region's urban population outgrows its existing settlement, or when ruins are resettled.

**Buildings** are data entries: tech requirement, cost (wealth, building labor and sometimes a resource), construction time, upkeep, placement conditions (coast, river, resource site, tier) and effects (coefficient modifiers and unlocks). Polities choose what to build through the Build action of the decision model, driven by needs, and the cause is recorded ("built walls at Kesh after two raids"; "built a granary after the famine of 812"). Starting list (the agent expands it in data):

| Era | Buildings | Effects |
| --- | --- | --- |
| Neolithic | granary, walls, shrine | food storage and famine resistance; defense against raids, lower chance of being looted or burned; religion and stability |
| Bronze | temple, library, mine | religion spread; research multiplier and knowledge kept (burning it can cause knowledge loss); needed to extract a mineral site |
| Iron | market, harbor, quarry | trade hub and wealth; sea trade, voyages, and coastal sailing and ocean navigation from that region; stone supply |
| Classical | aqueduct, fortress, monument | larger city limit and less plague; strong defense; prestige and cultural influence |
| Medieval | observatory, shipyard | research; lower loss at sea and naval strength |
| Early modern | university | research and diffusion |
| Industrial | factory, rail station, coal power plant | industrial output; joins the rail network; energy |
| Modern | airport, power grid | flight reach and contact; energy |
| Atomic | nuclear power plant, rocket site | energy from uranium; missiles and space milestones |

**Wonders** are rare, named prestige buildings (a civ knows of a wonder only through contact: it has met the people who hold or build it, or met a people who has; word of great works travels one step further than other news; user, M3b review): for example the great library, pyramids, a cathedral, a grand observatory, a palace, and later a space center. Each wonder type is unique in the world while it stands; if it is destroyed, it can be built again elsewhere. A wonder needs a large surplus and a motive (a pious or ambitious ruler, a high-Zeal or prestige-seeking culture, a golden age of stability and wealth). It gives prestige and cultural influence and a specific effect (the great library raises research and protects against knowledge loss; a cathedral raises religion spread). Its founding, completion and fate are major chronicle events.

**Infrastructure** lives on region edges and in regions:

- **Roads** connect settlements along the cheapest route: the capital to its towns and cities, and cities to each other. Allies and trade partners agree to build joint roads between their nearest cities (a road agreement treaty), each side building its own half; warmer relations make this likelier and sooner. Road tiers rise with technology: dirt track (Wheel), paved road (Engineering), railway (Railways), highway (Combustion engine), and existing routes get upgraded over time. Each tier lowers travel cost and raises trade capacity and governance reach.
- **Bridges** carry a road across a river edge. Before Engineering, river and great-river edges are costly to cross, so big rivers are real barriers and natural borders.
- **Canals** (Engineering, later Industrialization) join river and lake waterways.
- **Mines and quarries** at resource sites are needed before a mineral site yields anything.
- **Irrigation and terraces** raise farming output in a region.
- **Cultivated land.** Each region keeps a set of cultivated cells, chosen from its best farmland nearest its settlements and sized by its farming population. It grows with farming and shrinks after famine, devastation or collapse.

**Destruction.** Everything built has a condition. War loots and burns: when a region is occupied or raided, its settlements can be **looted** (wealth and stored food taken), **burned** (buildings destroyed, people killed or driven out as refugees) or **razed** (wiped out, leaving named **ruins** on the map). The chance depends on the attacker's Militarism, ruler traits (Cruel), religious hatred, the war goal and the settlement's walls. Bridges and roads can be destroyed to stop an advance, and later bombed from the air. Neglect also destroys: unpaid upkeep wears everything down, so the roads of a collapsed empire crumble over decades. Anything can be rebuilt; ruins stay on the map until someone resettles them, sometimes under the old name. Losing a library or wonder can trigger knowledge loss.

**Hubs.** Trade routes run between settlements with markets, harbors or rail stations, and their capacity depends on the infrastructure at both ends and the road or sea route between them. Treaties are signed at capitals. Large cities raise their civ's prestige and cultural influence.

## Resources, scarcity and trade

Demand for a resource comes only from the techs a civ knows, so the strategic map changes every era: tin matters in the Bronze Age, coal in the Industrial era, oil and uranium later.

**Resource list.** Use the existing resource sites: fish, grain, timber, game, stone, iron, copper, gold, salt, coal and uranium (`shared/atlas.ts`, with extraction requirements in `src/world/resources.ts`). Sites are sparse special concentrations (for example 27–41 copper sites per Large world, and some worlds have no gold); ordinary farming and foraging come from fertility, not from sites. The user approved adding tin and oil; slice G1 adds them before M0. Bronze working needs copper and tin; Combustion engine needs oil.

**Supply and demand.** Each usable site yields a fixed amount per year (data; one site covers the demand of about 50,000 people), scaled by extraction techs and its mine or quarry. Per civ and resource, supply is the sum of owned usable sites plus imports; demand is defined by known techs and scales with population (Bronze working demands copper and tin; Iron working demands iron; Industrialization demands coal and iron; Combustion engine demands oil; Boatbuilding and Sailing demand timber; Masonry and Engineering demand stone; gold and salt raise wealth). A shortfall scales the dependent coefficients by supply ÷ demand down to a floor; it never blocks a tech or action, because some worlds lack a resource entirely. Tin is rare and clustered, so bronze-age civs must trade or fight for it. Timber and stone are also common: forested regions supply timber and rough or mountainous regions supply stone in proportion to their area, and timber and stone sites add rich concentrations on top (timber sites number under 20 per Large world).

**Wealth.** One abstract currency per civ, produced by specialists, markets and trade. No per-good prices. Wealth pays for building, upkeep and military, and can buy resources in trade deals.

Wealth must matter: running a society costs money, more the larger and older it is, so a realm's wealth goes into keeping it together (user, M3b review, 6 October 2026). Designed for the systems to come:
- **Income comes from what people do where they live.** A settlement earns from its townspeople's trades (more with markets, later trade hubs and industry), from the mines and quarries its region works, and from a tax on the surplus food of the farmers around it. Trade (M5), tribute (M6) and industry (M8) add later.
- **Taxes:** the crown takes a share of what its people produce. Each year a realm sets the rate it needs to cover its costs and keep a reserve. Taxes above the customary rate make its people unhappy (stability), and taxes below it content them. A realm whose costs outrun its people's output must choose between the unrest of heavy taxes and the decay of arrears. Governments (M7) will set the customs and limits.
- **Costs come from running the society:**
  - **administration:** each region costs a base amount, more the farther it lies from the capital in travel and the more regions the realm holds (the burden grows faster than size);
  - **age:** offices, privileges and courts accumulate, so a realm's administration grows costlier as it ages, until reforms (government, M7) cut it back;
  - **settlement services** per townsperson, more per head in larger places;
  - **upkeep** of buildings, roads and wonders; armies (M6), clergy (M4) and courts (M7) join later.
- **Not every place pays.** Each settlement shows what it earns and what it costs. Many villages and frontier towns run at a loss, carried by profitable cities and rich farmland.
- **Deficits and neglect:**
  - **A strained court spends on its core.** A realm whose costs outrun what customary taxes raise lets the buildings, wonders and roads of its farthest regions go unkept, a share as large as half its strain, while it still pays everything else. It builds nothing new there.
  - **Short even at the taxes it sets:** it draws on its savings beyond its reserve, a fifth a year. Then it lets more go, from the outside in. When even that cannot pay its costs, it falls into arrears: upkeep goes unpaid everywhere, and unrest grows, first in the regions farthest from the capital.
  - **The capital is always kept up.** Large old empires feel all this first.
  - **Neglect is visible** (user, M3c review, 7 October 2026): worn roads look worn on the map and are slower, worn settlements look worn, and what stays unkept long enough is lost.
- The Build action and every later action weigh what the realm can afford: its income after costs, not its treasury alone.

**Trade.** Two civs can trade if they have contact and a reachable route under either civ's mobility. At each decision step, civs with a deficit look for partners with a surplus, scored by relations, route distance, hubs and the partner's Openness. A trade agreement transfers a fixed resource amount per year in exchange for another resource or wealth, and lasts until cancelled by war, a relations drop or the need disappearing. Trade agreements are contact edges: they raise relations, share knowledge as an exchange does, carry cultural and religious influence and make road agreements likelier. Store them as edges for the trade-routes lens.

When a civ needs a resource it cannot trade for (no route, hostile owner, or the owner refuses), the shortage becomes a war motive in the decision model. Trade or fight is an emergent choice, not a script.

## Personality and the decision model

A polity's behavior comes from three layers of sliders combined into one set of effective values, which weight a single utility-based decision step. Every chosen action records the factors that drove it, which become the cause in the chronicle.

**Layer 1: culture values (slow, shared by the people).** Five sliders from 0 to 1, stored on the Culture entity and averaged across the polity's population weighted by group size:

| Value | High means |
| --- | --- |
| Militarism | force is an acceptable answer; respects strength |
| Zeal | religion should guide the state and spread |
| Openness | welcomes trade, foreigners and new ideas |
| Tradition | resists change in technology, government and religion |
| Expansionism | land, growth and grand works are the measure of success |

**Layer 2: ruler traits (fast, change at succession).** Each ruler gets one or two traits from data, such as Ambitious, Cautious, Pious, Greedy, Diplomatic, Cruel, Builder, Reformer or Weak. Traits add modifiers to effective values and to specific action scores. Rulers are the main source of short-term variety.

**Layer 3: government (structural).** Each government form modifies effective values and action costs (see Government).

**Needs (computed each decision step, each 0 to 1):** hunger, land pressure, resource shortage (per demanded resource), threat (hostile stronger neighbors), unrest (low stability), ideological friction (religion or government differences with neighbors), opportunity (a weak, rich or divided neighbor, or clearly better land), grievance (claims and past wars), infrastructure need (unconnected towns, raids without walls, famine without granaries, no harbor on a coast with a mobility unlock).

**Decision step.** Every 6 months (data; staggered by polity id) each polity:

1. Enumerates candidate actions: Explore, Expand, Unite (join a larger neighbour), Share knowledge (added after the M3 review), Raid (bands and chiefdoms), Build (a building, wonder or infrastructure item), Declare war, Seek peace, Propose trade, Propose alliance, non-aggression or road agreement, Send missionaries, Reform government, Focus investment (research, military or economy for the next period), Do nothing.
2. Scores each candidate using only the polity's own knowledge and beliefs (see Knowledge of the world). Score = Σ over needs of (need × how much the action addresses it × value weight), all terms normalized to 0–1, then × feasibility (strength ratio, reachability, cost) − risk. Store the decomposition.
3. Picks by weighted random among the top 3 scores above a minimum threshold, using the seeded RNG. Do nothing is always a candidate.
4. Records the step in the decision log (see The Chronicle) and stores the top two or three contributing factors on the resulting event.

The dominant factor names the action. That is how the same mechanic produces different stories:

| Dominant factor | Resulting war framing |
| --- | --- |
| Hunger | desperate war for farmland |
| Resource shortage | war for iron, tin, coal or oil |
| Zeal × religious difference | holy war |
| Expansionism × opportunity | war of conquest |
| Grievance (lost regions) | war of reclamation or revenge |
| Ideological friction | war against a rival government form |
| Threat | pre-emptive war |

**Relations and memory.** Each pair of known polities has an opinion score from −100 to 100, computed from decaying modifiers: shared or rival religion, culture similarity, government similarity, active trade and shared roads, past wars, border tension, broken treaties, razed cities. Claims on lost regions are stored separately and decay slowly (over a century or more), so revanchism can drive wars generations later.

## Culture and lineage

Cultures belong to people, not states: they live on population groups, outlast the civs that carried them, and keep a permanent family tree so a year-500 empire can still be traced in cultures of year 2000. Culture updates run yearly.

**Culture contents.** A values vector (the five sliders), up to four traits, a language seed, and parent links with weights.

**Traits** are discrete flavor tags earned from sustained conditions, defined in data with an acquisition rule and small modifiers. Examples: Seafarers (coastal plus Sailing for 100+ years), Horse lords (grassland herders with a military history), River builders (great-river farmers), Mountain folk, Desert nomads, Merchants (long-running trade hub), Warrior tradition (many wars won), Builders (several wonders or great cities). Traits are inherited by child cultures with high probability, so they are the visible thread of cultural memory.

**Drift.** Each year values shift slightly: toward environmental pulls (harsh land raises Tradition, frontier pressure raises Militarism), toward recent experience (long wars raise Militarism, long prosperous peace raises Openness), plus a small random walk.

**Influence.** Population groups in contact blend values slowly toward each other. Contact means same region, same civ, trade route, shared road or neighboring border. Influence is weighted by the prestige of the source civ (size, wealth, tech, great cities, wonders, military victories), so a dominant empire pulls the cultures around it toward its own, even across borders.

**Assimilation.** A minority culture in a region converts toward the region's dominant culture over generations. The rate depends on the minority's Tradition and the dominant civ's policy (government and Openness).

**Splitting.** When groups of one culture lose contact (separated by distance, borders, or the death of the civ that connected them) and their values diverge past a threshold, the separated part becomes a child culture. Its name is generated from the parent's language seed with small mutations, so names visibly descend.

**Hybrids.** When two cultures share regions for a long time, the mixed groups can form a new culture with two weighted parents.

**Ancestry query.** Because parent weights are stored, any culture's ancestry can be computed as percentages of earlier cultures. The chronicle and inspector should answer "this culture descends 40% from the Vael" even when the Vael empire died 1,500 years earlier.

## Religion

Religion is a second, faster-moving identity layer on population groups: it spreads by contact and missionaries, splits into sects, and gives civs a reason to ally or fight that has nothing to do with land. Religion updates run yearly.

**Folk beliefs.** Before organized religion, each culture has an implicit folk faith named after it. It does not spread on its own.

**Founding.** An organized religion can be founded in a civ that knows Organized religion (or Theology later) when a trigger fires: a crisis (famine, plague, catastrophic defeat), a ruler with the Pious trait, or a high-Zeal culture. The chance per year is low and configurable. The new religion gets two to four tenets from data and a holy region; its first temple or shrine there becomes a pilgrimage site.

**Tenets** modify values and behavior. Examples: Proselytizing (spreads faster, raises missionary action score), Holy war (raises war score against other faiths), Pacifism (lowers Militarism), Tolerance (lowers friction with other faiths), Ancestor veneration (raises Tradition), Asceticism (lowers wealth, raises stability), Mercantile blessing (raises trade score), Monument builders (raises wonder and temple building).

**Spread.** Each year, population groups adopt a religion with a probability driven by exposure: same-region adherents, temples, the civ's state religion, trade routes and roads, missionary actions and conquest. The rate is lowered by the group's Tradition and by attachment to its current faith.

**State religion.** Each civ has one, normally its rulers' faith. Changing it is a government-level event that can trigger unrest among groups of the old faith.

**Schisms.** When a religion spans several civs that are hostile to each other, or its adherents lose contact for a long time, a sect can split off with one tenet changed. Schisms also follow major wars between co-religionists.

**Secular age.** From Early modern techs onward, the weight of Zeal in decisions and of religious difference in relations gradually decreases (configurable), so holy wars become rarer and ideological friction over government forms takes their place.

## Government

Government forms are data entries with tech requirements and modifiers. A civ changes form through reform, revolution, coup, collapse or conquest, and shared or rival forms shape alliances and wars.

| Form | Requires | Character |
| --- | --- | --- |
| Band / tribe | start | consensus of elders; tiny governance reach |
| Chiefdom | Agriculture or Animal husbandry | personal rule; succession crises common |
| Monarchy | Writing | hereditary rulers, dynasties, medium reach |
| Feudal monarchy | Feudalism | large reach but strong regional autonomy; fracture-prone |
| Theocracy | Theology, high Zeal | Zeal weight up, missionary actions and temples cheaper |
| Republic (oligarchic) | Currency, Philosophy | merchant elite; trade score up, high Openness pull |
| Empire | Monarchy plus large size | high reach and military, cohesion decays faster |
| Constitutional monarchy | Printing | stable succession, moderate war weariness |
| Democracy | Printing, Banking | elected leaders every N years, fast war exhaustion, alliance bonus with other democracies |
| Dictatorship | Administration | ruler traits amplified, low legitimacy, coup-prone |
| One-party state | Industrialization | high mobilization and stability under pressure, ideological friction with democracies |

**Modifiers per form:** governance reach, stability baseline, legitimacy source, succession type, war exhaustion rate, research rate, effective value adjustments, action cost adjustments.

**Transitions:**

- **Reform:** peaceful change when a new form is unlocked, stability is decent and the population's values fit it better than the current form. Tradition lowers the chance.
- **Revolution:** when stability is low and the mismatch between values and form is high, a revolution replaces the form; if a large faction opposes it, it becomes a civil war.
- **Coup:** in crises, civs with a high soldier share can fall to a dictatorship.
- **Succession:** monarchies and chiefdoms resolve succession on the ruler's death. Weak heirs, rival claimants or a Weak ruler raise the chance of a succession crisis that can split the realm.
- **Elections:** democracies replace the ruler every few years with new traits, so policy shifts without a regime change.

Government similarity is a relations modifier, and from the Industrial era its weight rises: ideological blocs form naturally.

## Diplomacy and war

Wars are abstract contests of strength and endurance, resolved monthly at per-year rates and summarized yearly. Most end in negotiated peace when one or both sides run out of will, not in annihilation.

**Contact.** Polities only know polities they have met through shared borders, reachable routes, roads, trade or war. First contact is a chronicle event.

**Diplomatic states:** unknown, contact, trade agreement, road agreement, non-aggression pact, defensive alliance, tributary or vassal, war. Proposals come from the decision model; the receiving polity accepts if its own score for the deal is positive.

**Military strength** per civ = soldiers × military tech multiplier × resource supply factor (iron, later coal and oil) × a supply penalty that grows with distance from home regions and falls with roads and rail. Defenders get the region's defensibility bonus plus walls and fortresses.

**War resolution each month:**

1. Each side's strength is projected onto the contested regions (the war goal's regions plus border regions).
2. An outcome per front at per-year rates: the stronger side gains war score with randomness; both sides take casualties proportional to engaged strength. Casualties remove population and are recorded as war deaths.
3. Regions can be occupied when war score on that front passes a threshold. Occupation causes devastation (lower food output for years, cultivated land lost) and may loot, burn or raze settlements, destroy bridges and roads, and create refugees (see Settlements and infrastructure).
4. War exhaustion rises for each side from casualties, duration, occupied home regions, destroyed cities, economic strain and government type.

**Ending wars.** At each decision step, both sides evaluate Seek peace. Peace happens when the war goal is achieved, when exhaustion passes a threshold for either side, or when both sides are exhausted (white peace). Terms scale with war score:

| War score for winner | Typical terms |
| --- | --- |
| Near zero | white peace, status quo |
| Moderate | tribute in wealth or resources for N years |
| High | cession of contested regions, plus tribute |
| Overwhelming | vassalage, or annexation if the loser is small |

Lost regions create claims for the loser, feeding future revanchism.

**Raids.** Before state-level government, conflicts are raids: short actions that steal food or stores, burn buildings and cause casualties, without territorial change.

**Alliances and coalitions.** Defensive allies are called into wars and accept based on their own scores. When one civ's power passes a share of all known power (configurable), polities that know it gain a Threat need against it, so balance-of-power coalitions emerge against would-be hegemons.

## Knowledge of the world (fog of war)

Each polity acts on what it believes, not on what is true: it sees only regions it has explored or been told about, and judges others through estimates that are only as good as its contact with them.

**Map knowledge** is stored per polity, per region, in one of three states. With about 4,000 regions and up to about 3,000 polities (most of them bands, which keep knowledge of only their own and neighboring regions), this stays small; the renderer draws fog per cell by looking up each cell's region.

- **Observed:** the polity's own regions plus regions within sight range of them (neighbors at first; range grows with mobility, roads and tech). Refreshed every tick.
- **Known:** seen before but now out of sight. Stores a snapshot from the last-seen year: owner, settlement tiers, roads, and deposits visible to the polity's techs at that time. The polity treats this stale snapshot as current.
- **Unknown:** never seen. Invisible to all decisions: a polity cannot expand into, trade with, build toward or target what it does not know.

**Exploration.** The Explore action sends a land expedition that reveals regions along the reachable graph within a range set by mobility. Its score rises with Openness, Expansionism, land pressure, resource shortage, and a fresh mobility unlock (a civ that just learned Navigation gets a strong boost).

**Overseas voyages** are the Columbus moments. A civ with Sailing or Navigation and a harbor sends an expedition toward unknown coasts. The chance of loss at sea scales with distance and falls with tech. A successful voyage reveals a strip of coastal regions, can trigger first contact, and is a named chronicle event with a generated explorer name.

**Sharing knowledge.** Map knowledge spreads like technology: trade partners and allies exchange snapshots every few months; a conquered or annexed polity's knowledge is absorbed; neighbors learn of each other's immediate surroundings. When merging, keep the newer snapshot per region.

**Beliefs about other polities.** For each known polity, store estimates of population, military strength, wealth and era, each with a confidence from 0 to 1.

- Estimate = true value × (1 + bias). The bias is drawn once per pair at first contact (seeded, deterministic) and shrinks toward zero as intimacy grows. It is never re-rolled, so a misjudgment is stable and can be recorded as a cause.
- **Intimacy** grows with shared borders, roads, trade, alliances and especially war, and decays with distance and lack of contact. Confidence is derived from intimacy.
- **War is the fastest reality check:** each year of war moves military beliefs sharply toward the truth. A civ that attacked a neighbor it underestimated gains exhaustion fast and tends to seek peace early. The chronicle records the belief (for example that a war was declared on a neighbor believed to be weak).

**Implementation rule.** Decision, diplomacy, trade, building-placement and exploration code must never read another polity's true state or regions it does not know. Route all such access through a query layer, for example `knownRegions(observer)` and `beliefs(observer, target)`. Only physical systems (production, migration, construction, war resolution, plague) read ground truth. A test or Biome rule fails if the decision module imports true-state accessors for other polities.

## Stability, fracture and civil war

Stability is computed per region and decides whether a civ holds together; when regions that share a grievance become unstable together, they break away along cultural and religious fault lines.

**Regional happiness** (0 to 1) = food sufficiency + prosperity (wealth per person, trade) − war exhaustion − devastation − oppression (the group's culture or religion differs from the ruler's, scaled by the government's tolerance) + legitimacy.

**Regional stability** combines happiness with:

- **governance reach:** stability falls with travel cost from the capital beyond the civ's reach; reach grows with roads, transport, communication and administration techs and with government form
- **civ cohesion:** a civ-level value inspired by Ibn Khaldun's asabiyyah. It grows under external pressure, in frontier regions and after shared victories, and decays with size, long peace and wealth. Young hungry states are cohesive; old rich empires are brittle.
- **recent shocks:** famine, plague, defeat, razed cities, succession crisis

**Outcomes, in increasing severity:**

1. **Unrest:** lower output and research in the region; a chronicle event when it starts.
2. **Revolt:** below a threshold for several years, the region rebels. Neighboring unstable regions that share its majority culture or religion join it (connected-component search), forming a rebel faction.
3. **Secession:** a faction breaks away by one of the routes under Independence: by force against a weak or distant center, by a vote its government allows, or as the center dissolves. (Changed at the M3 review, 2 October 2026, at the user's request: breaking away is hard.)
4. **Civil war:** a faction holding a large share of population (configurable, about 25%) becomes a new civ at war with the old one, using the normal war system. A succession crisis can produce a civil war between two claimants.

**Independence.** Breaking away is possible but hard. Think of the breakups of Yugoslavia and the Soviet Union, against Catalonia and Scotland, which remain part of larger states. (Added at the M3 review, 2 October 2026, at the user's request; built in M7.)

Regions that want out share a culture or religion different from the ruler's, the memory of a former state (claims left by a union or a conquest), or a grievance. They have three routes:
- **War:** revolt and civil war (above). These usually fail against a strong, cohesive center.
- **Vote:** a referendum. It is possible only where the government allows votes (democracies and constitutional monarchies, sometimes republics), and only when the separatist majority is large and lasting. Most referendums are refused, never called, or lost.
- **Dissolution:** when the center collapses (a lost war, unrest everywhere, a succession crisis, an empire that comes apart), its parts fall away along cultural and religious fault lines, often several at once.

Most separatist regions stay where they are. Several things hold them in:
- economic dependence on the larger state: trade, markets, roads and wealth per person;
- governments that allow no vote and repress dissent;
- weakness against a strong army;
- mixed populations.

Every movement, attempt, success and failure records its causes (events: independence movement, referendum, secession, civil war, dissolution). Successful breakaways are rare, and more frequent after collapses than in quiet times.

**New civs from fracture** inherit the faction's majority culture and religion, the parent's known techs (subject to knowledge loss), its regions' settlements and infrastructure, a name derived from the culture's language, and a government chosen by the reason for the split (a revolution may pick a new form).

**Plague (shock).** Disease outbreaks start with low probability in dense regions and spread along trade routes, roads and borders, scaled down by aqueducts and Medicine techs. Plagues are a key collapse trigger for large connected empires.

## Late game: industry, nuclear and space

The late game reuses every existing system; it adds one structural break (industrialization), one rare catastrophic action (nuclear use) and a set of prestige milestones (space).

**Industrial break.** When a civ knows Industrialization and has usable coal (or later oil) and factories, its specialist output stops scaling only with food surplus and starts scaling with energy supply. Fertilizer multiplies farm yields, lifting the carrying-capacity ceiling. Railways and later highways reshape travel costs and governance reach. Combined with the demographic transition from Medicine, this produces rapid growth that then levels off. Which civ industrializes first should depend on coal deposits, shared knowledge and stability, not on a script.

**Nuclear power.** Uranium, Nuclear power and a nuclear power plant add a large energy supply, reducing dependence on coal and oil and changing which deposits matter in trade and war.

**Nuclear weapons.** Uranium plus Nuclear weapons gives a civ a stockpile that grows slowly with wealth and uranium supply.

- **Deterrence:** a civ at war with a nuclear power gains a large risk penalty on escalation, so wars between nuclear powers become rare and short, and proxy conflicts (wars against their allies) become more common.
- **Use:** only considered when a nuclear civ faces existential defeat (losing home regions or the capital) and its effective Militarism is high and the ruler is not Cautious. Even then the base chance is low (configurable).
- **Consequences:** target regions lose most of their population and their settlements and infrastructure are destroyed; fallout cuts food potential there for decades; every polity that knows the attacker gets a large negative opinion modifier; the target, if nuclear, may retaliate. If several strikes occur within a short window, apply a global climate shock (reduced food potential worldwide for years). These are story events, not a game over: the simulation continues.

**Rockets.** Rocketry raises military strike strength (missiles, launched from rocket sites) and is a prerequisite for Spaceflight.

**Space milestones** are prestige events in the chronicle: first satellite, first crewed spaceflight, first landing on another body, each launched from a rocket site. Satellites raise communication and governance reach. A prestige boost raises the civ's cultural influence.

**End condition.** The simulation runs to a configurable end: by default it stops 300 years after the first civ completes the tech graph, or at hard cap year 5,000, whichever comes first.

## The Chronicle

The simulation never writes prose; it emits structured events with causes, and a separate chronicle layer stores, ranks and renders them. This layer exists from M0 because every system reports through it.

**Event schema:** id, date (year and month), type, actors (entity ids with roles, such as attacker or founder), location (region id, and settlement id where relevant), causes (list of factor name and weight, taken from the decision step or the triggering condition), parent event ids (what led to this), importance score, and type-specific data.

**Event types (minimum set):** band spawned, band moved, band split, band absorbed, band joined, settled, expansion, settlement founded, settlement grew or shrank a tier, capital moved, building completed, wonder begun, wonder completed, wonder destroyed, road or bridge built, road agreement, settlement looted, settlement burned, settlement razed, ruins resettled, infrastructure destroyed, tech discovered, expedition, voyage lost at sea, discovery of new lands, first contact, knowledge shared, trade agreement, non-aggression pact, alliance, vassalage or tribute, treaty cancelled, treaty broken, raid, war declared, battle-year summary (only when notable), region conquered, peace signed, ruler succession, succession crisis, government change, unrest, revolt, secession, civil war, civ destroyed, unification, independence movement, referendum, dissolution, culture split, hybrid culture formed, religion founded, schism, conversion of state religion, drought, climate shock, famine, plague, migration wave, refugees, knowledge lost, industrialization, nuclear use, space milestone.

**Decision log.** Every decision step also records its candidates, their score decompositions, the effective values used and the chosen action in a separate decision log (queryable and inspectable, not shown on the timeline). Actions that change the world also emit their own events, which carry the decision's top factors as causes.

**Importance score** combines population affected, the actor's size, the rarity of the event type and whether it is a "first" (first civ to discover a tech, first contact between two continents, first wonder of its kind). The observer timeline filters by importance; the full log stays queryable.

**Causality.** Store causes at the moment an event happens; never reconstruct them afterward. A war event should be able to say: dominant factor tin shortage, secondary factor grievance over a region lost 80 years earlier (event id), ruler trait Ambitious. A razed city should say who, why (holy war, Cruel ruler, revenge) and what was lost (buildings, wonder, library).

**Naming.** Each culture has a language seed (a small phoneme set and syllable patterns). Child cultures mutate the parent's set slightly, so names visibly descend. Names are generated for polities, cultures, religions, settlements, wonders, rulers, dynasties, explorers and wars. Rulers get epithets from traits or reign events ("the Cruel", "the Builder"). Wars are named from goal plus place ("the Tin War", "the War of the Salt Lakes").

**Text rendering** (for the observer UI) uses per-event-type templates filled from event data and causes. Keep templates in the browser-side observer data module; a test fails if an event type has no template.

## Observer views

The observer sees the true world by default, can click any polity to inspect its relations and history, and can switch to any civ's perspective to see the world as that civ believes it to be.

**Time controls (from M0):** play, pause, single-month step, speed presets (1 month, 1 year and 10 years per second, and as fast as possible), run to a chosen year, and reset to year 0. The browser polls a compact observer frame (region owners and populations, markers, counters and events since a cursor), shows the newest frame and drops older ones. Target: the first 1,000 years can be watched in under two minutes.

**Map layers built up through the milestones:** region overlay, band markers sized by population, settlement icons by tier with names, capital stars, ruins, cultivated land, roads (by tier), bridges, canals and railways, and at detail zoom harbors, mines, airports and rocket sites and wonders. Lenses: political, culture, religion, population density, trade routes, diplomacy and perspective.

**Civ panel** (click a civ on the map or in a list), with four tabs:

| Tab | Contents |
| --- | --- |
| Overview | name, flag color, government, ruler, culture, religion, era, population, regions, capital, largest cities, wonders, stability, cohesion, effective values |
| Diplomacy | one row per polity it knows: status, opinion score with its top three reasons, active treaties and road agreements, claims in either direction, and the year the status began |
| History | its chronicle events, its origin (founded, split from, or seceded from), civs it annexed or was annexed by, cities founded and lost, with years |
| Knowledge | what it believes about each known civ next to the truth, for example army estimated around 20,000 with low confidence, actual 45,000 |

Panel statuses: at war, allied, non-aggression pact, trade partner, overlord, vassal or tributary, rival (opinion ≤ −50 without war), neutral (contact with no treaty). In the god view, polities it does not know yet are listed greyed out at the bottom, so the observer can see who is about to meet whom.

**Settlement inspector:** tier, population, buildings and their condition, wonder, history (founded, grew, looted, burned, rebuilt).

**Diplomacy lens.** With a civ selected, the map colors every other civ by its relation to the selected one: war, allied, pact, trade partner, vassal, rival, neutral, and unknown in dark grey. Colors come from a data palette.

**Perspective lens (fog of war).** A "view as" toggle on the civ panel renders the map from that civ's knowledge:

- unknown regions are covered in dark fog
- known regions are desaturated and show the stale snapshot (old borders, old owners, old roads), with the last-seen year on hover
- observed regions show full color and current state
- other civs' labels and tooltips show the believed values and confidence, not the truth

With saved snapshots, the observer can step through years in perspective mode and watch a civ's map of the world grow (a later idea, not part of this run).

## Architecture and engineering constraints

The simulation is a deterministic, headless, data-driven module that the renderer only reads from. These constraints are expensive to retrofit, so they apply from the first commit.

- **Host-side simulation.** Each world's simulation runs in a dedicated long-lived `node:worker_threads` worker under `server/workers/`, not in the Piscina geography pool, whose jobs are stateless, deadline-bound and cancellable. Its versioned message and HTTP contracts live in `shared/`. The worker receives its world's validated geography (manifest and tiles, exactly as served) and derives regions from it; it never imports `src/world/generation`. Simulation routes have their own admission limits, separate from the map-response limits. The browser receives observer frames over versioned, validated HTTP contracts and sends only observer controls. React and the renderer never mutate simulation state.
- **Display data.** Region, ownership, settlement, road and cultivation display data use a separate versioned simulation contract (for example a cell-to-region id map), never the geography protocol.
- **World instance identity.** A world instance is identified by geography settings and generator version, region-partition version, simulation seed (defaulting to the world seed) and `SIMULATION_RULES_VERSION` (in `src/simulation/`, bumped by every slice that changes rules or tuning). Until slice P, a host restart (including development reloads) or choosing another seed in the lab resets the simulation to year 0, and the lab says so. Add `src/simulation/**/*` to nodemon's watch list with a source-edit regression.
- **Fixed tick and order.** One tick is one month. Systems run in the fixed order and cadence listed in the core loop section.
- **Determinism.** The same seed, settings and rules version must produce the same history. Use one root seed and derive a separate RNG stream per system per tick (for example a hash of seed, tick and system id), so adding a system does not change the randomness of others. Iterate entities in stable id order; never iterate unordered maps where order affects results. RNG state is part of saved state.
- **Data-driven content.** Techs, resources, buildings, wonders, infrastructure kinds, government forms, ruler traits, culture traits, religious tenets and all tuning numbers live in typed data modules validated at startup; event templates and palettes live in the browser-side observer data module.
- **Simple storage.** Plain arrays or typed arrays indexed by entity id. Do not introduce an ECS framework.
- **Performance budget.** Depth before speed (user, M3b review, 6 October 2026): the lab is meant to be watched at about one month per tick, so each tick may do deep calculations. Keep a 3,000-year headless study of each study seed within about 10 minutes on the user's PC (at about 4,000 regions, up to about 3,000 polities and a few thousand settlements). Measure through the real worker path and record results in the brief.
- **Snapshots.** Built in slice P: save full state every N years (configurable) for debugging and possible future timeline scrubbing.

**Headless study** (built in M0): a script under `scripts/` with an npm command, for example `npm run study:history -- --seed Chronicle --years 3000`. It obtains the world through the same path as the lab (`generateWorld` → `encodeGeneratedWorld` → `parseWorldManifest`/`parseWorldTile` → region derivation), runs the same simulation modules without a browser, and writes the event log, per-century stats (polities and civs alive, total population, largest civ share, active wars, leading era, settlements by tier, wonders standing, road length, cultures and religions alive, and every story-health metric) and a per-system timing report. Never build a second simulation for tests.

**Tests:**

- determinism: the same seed and settings produce identical event-log hashes, also across a save and restore once persistence exists
- exact accounting: every tick, each region's population change equals births − deaths (by cause: natural, famine, war, plague, nuclear, razing) + migrants in − migrants out; each food store change equals production + imports + tribute received + loot taken + stores carried in by moving people − consumption − spoilage − exports − tribute paid − loot lost − stores carried out; each wealth change is explained the same way
- invariants each tick: no negative or NaN values, one owner per owned region, valid entity references, every settlement on a land cell of its region
- unit tests for pure rules (growth, scoring, war resolution, construction) with `node --test`; Playwright scenarios for each lab view
- story-health metrics from the headless study (see below), reported rather than hard failures except where a milestone or stop condition says so
- the complete `npm run check` before every handoff

## Milestones and acceptance criteria

Build in this order; each milestone must leave a runnable, deterministic simulation and ends with an observable outcome in the lab (it may be delivered as several slices). When a milestone needs a system from a later one, it uses the simplest neutral form, and the later milestone extends that form rather than replacing it: M2 treats polities within two regions of each other as in contact; M3 builds the single decision step with only Expand, Explore and Do nothing and the needs land pressure, hunger and opportunity, which later milestones extend with more actions and needs; until M7 every civ has a neutral ruler and the default government for its stage (Band / tribe, then Chiefdom) with no modifiers; until M3b, a settlement is only a named village with a cell, region, owner and capital flag, Sailing and Navigation need no harbor, and mineral sites need no mine; until M3b, specialists produce research but no wealth; until M5, religion spreads only through same-region and neighboring-border contact. A basic name generator from each culture's language seed exists from M1 (bands, cultures, settlements); M4 adds the visible descent of names.

**Study setup.** Acceptance runs and studies use Large resolution and the five study seeds `Chronicle`, `Elsewhere`, `Atlas`, `Verdant` and `Aster`. If one fails to generate, replace it with the next seed that generates and record the replacement in the brief. A criterion must hold in every study seed unless it says otherwise; "most seeds" means at least 3 of 5. Each milestone study runs every seed to year 3,000, or to the end condition once M8 exists; "by year N" criteria are read at that year. Standard resolution must run but is not tuned. "Land share" means a civ's owned land regions divided by all land regions; "habitable" regions are those with nonzero food potential for some method.

**G1 — Generation fixes, tin and oil (approved geography change, before M0).**

- First fix the generation bug that makes some seeds fail with "Hydrology did not converge within 12 drainage passes" (an earlier sweep found 6 of 40 Standard seeds and 1 of 49 Large seeds failing, for example `Timing` at Standard; a higher pass limit alone does not fix it). The fix may change output only for seeds that currently fail.
- Then append `tin` and `oil` to `RESOURCE_IDS` (append only, never reorder), add their display entries and icons, and add `RESOURCE_RULES` entries (tin: Mining; oil: Drilling). Place them with their own seeded stream and only on land cells that had no site, so every existing site stays where it is. Tin is rare and clustered in a few mountain and upland areas, far rarer than copper. Oil sits in clustered lowland basins (desert, steppe and low coastal plain; wetland barely exists on generated worlds), on land only.
- Bump `WORLD_GENERATOR_VERSION` and `WORLD_PROTOCOL_VERSION`, and update README and the geography docs.

Acceptance:

- Before changing code, capture per-column digests for the sweep seeds `g1-0` … `g1-99` at Standard, `g1-0` … `g1-49` at Large, `Timing` at both sizes, and the reference seeds below, recording which seeds fail. For the five study seeds plus `Repeat` and `Third` (Standard), elevation, temperature, moisture, biome, hydrology and fertility are identical to generator 5; the resource column differs only by tin or oil on previously empty land cells.
- Every Large study seed has at least one tin cluster (2 or more tin sites within 8 cells of each other) and one oil basin (3 or more oil sites within 12 cells), all on land, and tin sites number less than half of copper sites.
- Every sweep seed and `Timing` now generates at both sizes; seeds that generated before are byte-identical in every column except the added tin and oil. The sweep must include at least one previously failing seed per size; if it does not, extend it with the next names in the sequence until it does.
- The complete check passes, and the lab legend and cell inspector show both resources.

**M0 — Foundations.** Region partition, entity storage, seeded RNG streams, fixed-order tick loop with empty systems, the chronicle event log, the headless runner and stats output, invariant checks, the dedicated simulation worker with its contracts, and the time controls.

- Lab: region overlay, current year and month, time controls (play, pause, step, speed presets, run to year, reset), and a raw chronicle event list (date, type, causes) that later milestones reuse.
- Every land cell belongs to exactly one region; at least 90% of non-island regions are within the configured area range and none is outside it except islands; no land cell is unassigned.
- Determinism test passes.
- Playwright: Play advances the shown date, Pause stops it, Step advances exactly one month, a speed preset changes the rate, Reset returns to year 0.
- The headless study runs 3,000 empty years for each study seed and reports per-system timing through the real worker path.

**M1 — Bands, food and movement.** Band spawning, foraging, hunting and fishing with game depletion, saturating production, food security, births and deaths, band movement and fission, settling rules (activated in M2).

- Lab: band markers sized by population; inspection shows population, births and deaths this year, capacity, food security and game stock; a world population chart.
- Every band with at least 50 people records births and deaths in every simulated year; world population grows over 500 years in every seed.
- No region stays above 1.1× its capacity (computed at the current game stock) for more than 24 consecutive months.
- In every seed, both the number of bands and the number of occupied regions at year 500 are at least 3× their year-0 values.
- Every band move and split is an event (band moved, band split) with its causes; at least half of moves cite game depletion or land pressure.
- At year 500, the share of band population in regions with a coast, open-lake access or river tier ≥ river is at least 1.25× the share of land regions with those features.

**M2 — Knowledge and resources.** Tech graph in data (full list through Atomic), base and specialist research with need, environment and exposure weights, diffusion (changed after the M3 review, 2 October 2026, at the user's request: exposure and automatic diffusion were replaced by catch-up and agreed sharing; see Knowledge and technology), resource reveal and extraction gating, mobility levels and per-polity reachability, specialists from surplus, settling into civilizations with a named village capital.

- Lab: inspection shows known techs, current research and its weights, and specialists; markers colored by era; settled villages appear.
- In most seeds, Agriculture is first discovered in a region in the top quartile of land regions by farming potential with river tier ≥ river or open-lake access; Agriculture is discovered by year 600 in every seed.
- The mean annual compound growth rate of world population over the 300 years after a quarter of the world's people live in polities that know Agriculture is positive and at least 3× the rate over the 300 years before (that window clipped at year 0; if the earlier rate is zero or negative, the later rate must be at least 0.1% per year). (Changed after the M3 review, 2 October 2026, at the user's decision: it counted a quarter of living polities, which once peoples follow their own paths are mostly forager tribes absorbed before they farm, so the mark fell centuries after the farming boom.)
- No polity ever holds or enters a region on another landmass before it knows Sailing (checked every month).
- A test fails if any `RESOURCE_RULES` technology name is missing from the tech data.
- **Then stop for user review** (rule 2).

**M3 — Civilizations and borders.** Region ownership and the Expand action (decision step skeleton and decision log), band joining, peaceful unification of civilizations (the Unite action; added at the M3 review, 2 October 2026), governance reach, basic stability, per-polity region knowledge (observed, known, unknown) behind the query layer, land exploration, knowledge sharing between neighbors (map knowledge, and the Share knowledge action added after the M3 review), first contact, migration between populated regions.

- Lab: political lens (required), capitals, a civ list with population.
- By year 1,000, every seed has 10–60 settled civs (fixed for acceptance: tune the simulation, not the range).
- Borders follow barriers more than chance: the median land travel cost of edges between regions of different civs exceeds the median of land edges within civ-held land (both regions owned by a civ) in every seed. (Changed at the M3 review, 2 October 2026, at the user's request: the 1.5× target moved to M6, when war shifts borders onto defensible lines. Changed again after the M3 review, 2 October 2026, at the user's decision: it compared with all land edges, but now that farming spreads people by people, at year 1,000 civs hold only the easy farmland, so the empty mountains and deserts in "all land" made borders look easy.)
- Every seed has at least one first-contact event.
- Every unification is an event with its causes, and no civilization unites into a smaller one.
- Knowledge moves only by invention, inheritance, merging, catch-up and agreed sharing: a test fails if any tech is researched faster because a people the polity has no active exchange with knows it, and every exchange is an event with its causes. Peoples follow different paths: in every seed, Agriculture is invented independently in at least three places, and at year 1,000 the settled civs are in at least two different eras. (Added after the M3 review, 2 October 2026, at the user's request.)
- In a labelled test scenario with one settled civ alone on the largest landmass of seed `Chronicle`, the civ keeps expanding while reachable habitable land remains within its governance reach: its longest gap between expansions is under 50 years whenever its land pressure is above 0.5. The study reports every civ's longest gap between expansions.
- A test or Biome rule fails if decision, diplomacy, trade, building-placement or exploration code imports a true-state accessor for other polities or for regions the polity does not know.

**M3b — Settlements and infrastructure.** Settlement placement, tiers and capitals; the rural and urban split and housing; wealth from specialists and markets, with exact accounting; buildings and wonders as data with the Build action; early buildings (granary, walls, shrine, temple, library, market, mine, harbor, quarry); roads and bridges inside civs; mines and quarries gating mineral sites; irrigation; cultivated land; upkeep and decay.

- Lab: settlement icons by tier with names, capital stars, roads and bridges as lines, the cultivated-land overlay, and a settlement inspector with buildings.
- Every settled civ has a capital settlement; at least 80% of settlements sit within 1 cell of a river, lake, coast or resource site.
- By year 1,500, in every seed, at least 80% of the civs that have 5 or more regions, know Wheel and have at least one town or city have a road from the capital to at least half of their towns and cities.
- At least one bridge exists in every seed within 200 years of the first civ learning Engineering.
- Every building, road and wonder event records its causes; at least one wonder is completed by year 2,500 in most seeds.
- In each seed, at least one civ's cultivated land shrinks within 10 years after a recorded famine and later regrows.

**M3c — Economy, famine relief and empire strain** (added at the M3b review, 6 October 2026, from the user's answers). The wealth system above: income by what each place does, administration by size, distance and age, settlement services and upkeep, deficits that wear down buildings and roads and unsettle the edges; famine relief (moving stored food within a realm, at a cost) and better storage; stability strain from size, age and taxes, so large old empires are hard to hold but possible and rewarding to keep (revolts, secession and civil war remain M7's); wonders known only through contact; settlement tiers that change only after lasting growth or decline; the state kept save-ready.

- Health checks across the five study seeds, never quotas: treasuries level off at a few years of income in most civs instead of growing without end; some settlements run at a loss; the costs per person of the largest, oldest realms are clearly higher than those of small young ones; famine kills a smaller share of people in rich realms than in poor ones; no settlement changes tier more than a few times in a century; the largest polity's share of world people stays below story health's 35% in most seeds.
- A civ never sees a wonder whose holder neither it nor a people it has met has met (test).
- A state copied mid-history continues with the same event-log hash as the original (test).
- Then stop for user review (rule 2).
- **The M3c review** (user, 7 October 2026):
  - **Neglect must be visible**, in the look of infrastructure as well as its loss; added as slice M3c.5.
  - **Empires should rise and fall as real ones did** (Rome, the Mongols, the British Empire and the like), with simpler rules. The research is in [EMPIRES_RESEARCH.md](EMPIRES_RESEARCH.md).
  - **Rulers should differ** in how they rule their people and in their aggression, and be replaced as in reality: lifelong rulers die or are overthrown, elected ones lose elections, hereditary ones pass power on, with crises.
  - **The user kept the planned order** (M4, M5, M6, then M7). The findings are recorded as requirements of M6 and M7 ("Grounded in history" under each), so they are built when those milestones come.
  - Famine relief's strength is left as it is for now.

**P — Persistence** (waits until the user asks for it; user, M3b review). Saving and resuming worlds, snapshots, `SAVE_FORMAT_VERSION`.

- Saving and restoring at any month reproduces the event-log hash of an uninterrupted run.
- Closing the last browser tab pauses and saves; reopening restores the same date with a manual pause preserved; no months are simulated while nobody is attached (no offline catch-up).
- A host restart, including a development reload, resumes from the last save.
- During this run, a save from an older save format is refused with a clear message and kept on disk; migrations are required only from the first save format the user accepts.

**M4 — Culture and religion.** Values, traits, drift, influence, assimilation, splitting, hybrids, ancestry query and the descent of names from language seeds; religion founding, tenets, spread, state religion and schisms; yearly updates.

- Lab: culture and religion lenses (dominant per region); ancestry on inspection.
- By year 2,000, every seed has at least one hybrid culture and at least one culture split off from a settled civ's culture.
- Every seed founds an organized religion by year 2,500, and within 500 years of the first founding some religion is followed in 3 or more civs.
- The ancestry query returns percentages that sum to 100% for every living culture; generated child names visibly share syllables with their parent (test).

**M5 — Decision model, diplomacy and trade.** Effective values from culture, ruler and government; all needs; utility scoring with recorded causes; beliefs about other polities with persistent bias and intimacy; overseas voyages; relations and memory; trade agreements through hubs; non-aggression pacts, alliances and road agreements with cross-border roads.

- Lab: trade-route lines; opinion and decision causes on inspection.
- Every decision log entry stores the effective values used and at least two causes whenever two or more factors are nonzero.
- By year 2,000, every seed has trade agreements and at least one alliance or non-aggression pact; in most seeds, allies or trade partners have built at least one cross-border road.
- At least one recorded decision cites a belief more than 50% off the truth.
- In every seed, at least one overseas voyage reveals another landmass, and in every seed where another landmass holds polities unknown to the voyager, a voyage causes first contact.
- The query-layer test from M3 covers beliefs; a pair's belief bias changes only through intimacy.

**M6 — War and peace.** Abstract war resolution, exhaustion, peace terms, claims, raids, coalitions against hegemons, looting, burning and razing of settlements, destruction of infrastructure, ruins, refugees.

- Lab: active wars with contested regions highlighted, occupied and devastated shading, ruins.
- Of all wars that ended in the five seeds, more than half end in white or negotiated peace, not annexation, and this holds in most seeds.
- In most seeds, at least one settlement is razed and later resettled, and at least one bridge or road is destroyed in war.
- The largest civ's land share over time is reported (the hegemony limit becomes acceptance in M7).
- Borders settle onto barriers: by year 3,000 the median land travel cost of edges between regions of different civs is at least 1.5× the median of all land region edges in every seed. (Moved here from M3 at the M3 review, 2 October 2026.)
- **Grounded in history** (the M3c review, 7 October 2026; [EMPIRES_RESEARCH.md](EMPIRES_RESEARCH.md)): M6 also builds:
  - **a military edge that spreads:** the military tech multiplier in war strength (soldiers × military tech × supply) compares the two sides' military knowledge. A large edge raises the drive to conquer and shrinks as rivals learn the techs, so conquests come in waves after a breakthrough;
  - **conquest that pays, then stops paying:** loot and tribute fill the treasury, and army size follows threat and recent war income. When the frontier reaches poor or strong land, the army's upkeep (a cost in the M3c budget) pushes the realm toward arrears. Demobilizing unsettles the soldiers;
  - **threat drives consolidation:** a strong or raiding neighbour raises the pull of unions among those it threatens, and herders beside rich farmers gain from raiding and from confederating.

**M7 — Government, rulers and fracture.** Government forms and transitions, rulers, dynasties, succession crises, elections, cohesion, revolts, secession, civil war, independence (movements, referendums where the government allows them, and dissolution of a collapsing center, held back by economic ties and repression), plague, knowledge loss.

- Lab: government and ruler on inspection; revolts, secessions and civil wars highlighted on the political lens and in the event list.
- No civ's land or population share exceeds 60% for 300 or more consecutive years in any seed.
- In most seeds, some civ (any government form) reaches a land share of at least 20%, then loses at least half of its peak regions through revolt, secession or civil war within 400 years of that peak.
- Independence is hard and varied. Across the five seeds:
  - more independence movements fail or never break away than succeed;
  - successful breakaways happen by more than one route (war, vote, dissolution);
  - every referendum happens under a government that allows votes.
- **Grounded in history** (the user, M3c review, 7 October 2026: empires should rise and fall "closer to how it is in irl but with simpler simulation rules", like the Roman, Mongol and British empires; rulers should differ in how they rule their people and in their aggression, and be replaced as they would be in reality). The findings are in [EMPIRES_RESEARCH.md](EMPIRES_RESEARCH.md). M7 builds them as graded rules, never scripted events:
  - **Rulers** (with "Layer 2: ruler traits"):
    - each civilization has a named ruler with an age, one or two traits and a dynasty;
    - traits shape how they rule: taxes and their weight, building and upkeep, relief, repression, expansion, unions and war;
    - a trait's weight scales with the government's personal power: high in chiefdoms, empires and dictatorships, low in constitutional monarchies and democracies;
    - rulers age and die along a human mortality curve that falls with Medicine.
  - **Succession by government form.**
    - **Forms:**
      - chiefdoms and steppe realms pass power among kin, with frequent contests;
      - hereditary monarchies pass it to the eldest son;
      - elective monarchies let the great families choose, and neighbours back claimants;
      - some cultures divide a realm among sons, leaving kin realms that are drawn to reunite;
      - dictatorships end by coup or an appointed heir;
      - one-party states let the party choose;
      - democracies replace leaders at elections.
    - **Starting values** for the yearly risk of a ruler being removed: about 0.7% under primogeniture, 4% elective and 6% kin succession. The risk is highest early in a reign and after a predecessor was removed, and rises with low legitimacy, powerful elites and a large army. Assemblies (parliaments, republics) lower it.
  - **Legitimacy by performance** (the Mandate of Heaven):
    - it rises with prosperity, wonders, victories and long reigns;
    - it falls with famine deaths, arrears, neglect, defeats and debasement;
    - low legitimacy raises the risk of removal and of regions joining revolts;
    - a successful rebel can found a new dynasty while the state endures.
  - **Crises at the centre:** a disputed succession, a child ruler, a removed ruler, the capital lost, civil war, a lost war or a default raise a crisis value. While it lasts, every region's chance of breaking away is multiplied, and regions that remember a former state, have another culture or have drifted far from the capital go first. Breakups therefore cluster after crises. Strain alone (M3c) keeps costing output and making the edges brittle; it is a shock at the centre that breaks a strained realm.
  - **Governors drifting away:** regions beyond governance reach slowly gain autonomy. Autonomy cuts the tax and troops they send, turns them into nominal vassals, and lets them leave at the next crisis without war.
  - **Elites and sclerosis:**
    - elite power (the share of revenue kept by nobles, governors and commanders) raises reach and mobilization but also depositions and autonomy;
    - long prosperity breeds more elites than positions, and their competition raises unrest and the chance a succession becomes civil war (secular cycles);
    - the M3c age cost becomes a stock of accumulated privilege: it grows in peaceful years and is cut by a reforming ruler, a new dynasty, civil war or conquest. Reform costs elite stability.
  - **A fiscal crisis has several ways out**, chosen by traits and values: heavier taxes and arrears (as now), cutting the army, debasing the coinage (a one-off gain, then lower trade and more unrest), defaulting on debts (with credit from Banking: cheaper under constrained governments), or giving up costly far regions as vassals or independent states (a managed retreat).
  - **Restoration:** whoever holds a fallen empire's capital or core people is drawn to reunite its fragments.
  - **Shocks on strain:** plague and drought cut food and taxes, and the stability damage of any shock scales with a realm's strain and arrears. Drought among herders drives raids and migration onto farmers.
  - **Nationalism:** from Printing on, cultural and language difference weigh more toward independence. Rivals may fund separatists.
  - **Health checks** (never quotas):
    - large realms stay at half their peak size or more for a median of one to two centuries, with a long tail;
    - mean reigns by succession type are near 20, 12 and 9 years (primogeniture, elective, kin);
    - breakups cluster after crises at the centre;
    - the realms that rose fastest tend to break first.

**M8 — Late game.** Industrial break, factories, railways and highways, power plants, demographic transition, airports, nuclear power and weapons with deterrence, rockets, rocket sites and space milestones, end condition.

- Lab: era and industrialization on inspection; railways and highways on the map; harbors, airports and rocket sites at detail zoom.
- In most seeds a civ industrializes; in every such seed, the first industrializer had usable coal (owned or imported) in that year.
- The leading civ reaches the Atomic era between years 2,500 and 4,500 in most seeds.
- Nuclear strikes average at most one per seed; every run stops at the end condition.

**M9 — Observer layer.** Map lenses (including diplomacy and perspective), the civ panel with all four tabs, the settlement inspector, the importance-filtered timeline, text templates and causality display.

- Playwright (development and production serving): selecting a civ opens four tabs whose values match the headless state at the same date.
- The diplomacy lens colors known civs by status and unknown civs dark grey; the perspective lens fogs regions unknown to the civ and shows the stale owner and last-seen year on known ones.
- The timeline hides events below the chosen importance; an event shows its causes and parent events.
- A test fails if any event type lacks a text template.

## Story health

Report per seed and per century in the active brief, as a table and charts; tune toward these ranges. They are hard only where a milestone or stop condition says so, and milestone acceptance ranges are deliberately wider than these targets.

| Metric | Healthy range |
| --- | --- |
| World population | rises in every century of the first 1,000 years except after a recorded famine or plague; at least 20× the start by year 500 |
| Polities (bands and civs) | grow until the habitable land is occupied; after M7, at least 2 civs founded and 1 destroyed per century |
| Settled civs | 10–60 at year 1,000 |
| Occupied habitable regions | at least 50% by year 700 on every landmass that started with bands |
| Largest civ | at most 35% of world population and land, except for up to 200 consecutive years; above 60% for 300 or more years is degenerate |
| Region ownership turnover (after M6) | 2–25% of owned regions per century |
| Wars (after M6) | 2–20 per century, at least 60% ending in negotiated or white peace |
| Fractures (after M7) | at least 1 per 300 years |
| Settlements | cities appear by year 1,500; ruins exist after M6 |
| Roads | network length grows in most centuries after Wheel is known; shrinks visibly after collapses |
| Leading civ's techs and era (±300 years) | Agriculture by 300, Bronze by 1,000, Classical by 2,000, Industrial by 3,300, Atomic by 3,700; hard cap year 5,000 |
| Knowledge divergence | peoples reach farming and the eras at different times: Agriculture invented independently in several places over two centuries or more; settled civs at year 1,000 span two or more eras and differ in what they know |
| Decision mix | share of chosen actions in the decision log per century: no single action other than Do nothing above 60%; Do nothing below 70% |
| Resource access | share of settled civs with usable copper and tin, iron, and coal, per century |

**Degenerate world:** a 500-year window with no region ownership change, no civ founded or destroyed and no war; or a civ's land or population share above 60% for 300 or more consecutive years. **Plateau:** polity count and world population both within ±5% over 300 years during the first 1,000 years.

## Decisions

| Question | Decision |
| --- | --- |
| Engine and language | TypeScript on Node 24, React, Canvas 2D, Fastify, Piscina for geography, a dedicated worker thread for the simulation |
| Simulated length from year 0 to tech peak | about 3,000–4,000 years; tune research costs toward the era targets; hard cap year 5,000 |
| Tick length | one month; culture and religion yearly; decisions every 6 months |
| Region size | 20,000–60,000 km², roughly 2,500–4,000 land regions on Large; tune for the performance budget |
| Number of starting bands | 30 |
| How people spread before farming | band fission |
| Starting techs | Foraging, Fire, Hunting and Fishing; Agriculture requires Pottery |
| Early consolidation | bands settling within a civ's reach weigh joining it; civilizations weigh uniting with larger neighbours (M3, added at the M3 review); war-driven consolidation from M6 |
| Research before surplus | small base research per person for every polity |
| How knowledge spreads | invention, inheritance, merging, a small era catch-up and agreed sharing; never automatically through contact (changed after the M3 review, 2 October 2026) |
| Carrying capacity | emerges from saturating production and food security |
| Expansion and migration | graded pressure and opportunity, no hard thresholds |
| Tin and oil | approved; added in G1 before M0 |
| Failing seeds | fixed in G1, changing output only for seeds that currently fail |
| Scarcity | one site covers about 50,000 people; shortages scale effects down to a floor and never block |
| Settlements and infrastructure | functional settlements, buildings, wonders, roads to highways, bridges, cultivated land; all destructible (M3b, extended in later milestones) |
| User review | one stop after M2; otherwise autonomous through M9 |
| Severity and frequency of nuclear use | rare; global climate shock enabled |
| Save and resume | slice P after M3b; older save formats refused until the user accepts a format |
| UI before M9 | time controls in M0 and the lab view each milestone names; the full observer layer in M9 |
