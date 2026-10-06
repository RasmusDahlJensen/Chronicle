import { BUILDINGS } from './buildings.ts';
import { WONDERS } from './wonders.ts';
import { bonusOf, housingOf } from './settlements.ts';
import { EVENT_TYPES } from '../../shared/simulation.ts';
import type { RegionPartition } from './regions.ts';
import { cellNeighbors, type SimulationGeography } from './geography.ts';
import { crosses, KNOWN, OBSERVED, seaFrom, UNKNOWN } from './perception.ts';
import { edgeBetween, ROAD_TIERS, roadKey, roadUpkeep } from './roads.ts';
import type { Polity, RoadWork, Settlement, SimulationState } from './state.ts';
import { TECH_INDEX, TECHS } from './techs.ts';
import { REGION_TUNING } from './tunables.ts';

/** Thrown when a tick leaves the world in an impossible state; the scenario and tick are in the message. */
export class InvariantError extends Error {}

const eventTypes = new Set<string>(EVENT_TYPES);
const SAILING = TECH_INDEX.get('Sailing')!;

/** Per-tick invariants (VISION.md "Tests"): no negative or NaN values, valid references, ordered history. */
export function checkInvariants(state: SimulationState) {
  const fail = (message: string) => { throw new InvariantError(`Tick ${state.tick} (${state.seedText}): ${message}`); };
  if (!Number.isInteger(state.tick) || state.tick < 0) fail('the clock must be a non-negative month count');
  const { events } = state.chronicle;
  const regions = state.partition.regions.length;
  for (let at = state.checkedEvents; at < events.length; at++) {
    const event = events[at];
    if (event.id !== at) fail(`event ${at} has id ${event.id}`);
    if (!eventTypes.has(event.type)) fail(`event ${at} has unknown type ${event.type}`);
    if (event.tick > state.tick || (at > 0 && event.tick < events[at - 1].tick)) fail(`event ${at} is out of order`);
    if (event.region !== null && (event.region < 0 || event.region >= regions)) fail(`event ${at} names missing region ${event.region}`);
    if (event.parents.some(parent => parent >= event.id)) fail(`event ${at} names a later parent`);
    if (!(event.importance >= 0 && event.importance <= 1)) fail(`event ${at} has importance ${event.importance}`);
    for (const cause of event.causes) if (!Number.isFinite(cause.weight)) fail(`event ${at} has a non-finite cause weight`);
  }
  state.checkedEvents = events.length;
  for (const [index, value] of state.timing.ms.entries()) if (!(value >= 0)) fail(`system ${index} timing is ${value}`);
  // Exact accounting (VISION.md rule 8): every region's population change is explained by this tick's births,
  // deaths by cause and migration; every band's food store change by production, consumption, spoilage and carrying.
  const { ledger } = state;
  const now = new Int32Array(regions);
  const seen = new Int32Array(regions).fill(-1);
  // Settlements (VISION.md "Settlements"): each living one stands on a land cell of a region its owner holds, listed in
  // that region's index, housing at most its housing; the urban of a region add up to its townspeople (checked below).
  const villages = new Int32Array(regions), urban = new Float64Array(regions), harbors = new Int32Array(regions);
  for (const settlement of state.settlements) {
    if (!state.regionSettlements[settlement.region]?.includes(settlement.id)) fail(`settlement ${settlement.id} is missing from region ${settlement.region}'s list`);
    if (settlement.status !== 'alive') { if (settlement.capital || settlement.urban !== 0 || settlement.buildings.length) fail(`settlement ${settlement.id} in ruins is a capital or has people or buildings`); continue; }
    if (state.owner[settlement.region] !== settlement.owner) fail(`settlement ${settlement.id} stands in region ${settlement.region}, which its owner ${settlement.owner} does not hold`);
    if (state.partition.regionOf[settlement.cell] !== settlement.region) fail(`settlement ${settlement.id} is not on a land cell of its region`);
    if (!Number.isInteger(settlement.urban) || settlement.urban < 0 || settlement.urban > settlement.housing || !(settlement.tier >= 0 && settlement.tier <= 3)) fail(`settlement ${settlement.id} houses ${settlement.urban} of ${settlement.housing} (tier ${settlement.tier})`);
    // Buildings: one of each type, in condition, and the housing and bonus they give (yearly per settlement, staggered).
    if ((state.tick + settlement.id) % 12 === 0) checkBuildings(state, settlement, fail);
    villages[settlement.region]++; urban[settlement.region] += settlement.urban; if (settlement.bonus.harbor) harbors[settlement.region]++;
    if (settlement.capital && state.polities[settlement.owner]?.capital !== settlement.id) fail(`settlement ${settlement.id} is a capital its owner does not name`);
  }
  let indexed = 0;
  for (const list of state.regionSettlements) indexed += list.length;
  for (let region = 0; region < regions; region++) if (state.harbors[region] !== harbors[region] || harbors[region] > 1) fail(`region ${region} counts ${state.harbors[region]} harbors, not its ${harbors[region]} (at most one)`);
  checkRoads(state, fail);
  // What one region needs only one of (granary, shrine, temple, mine, quarry, harbor), standing or under way.
  for (let region = 0; region < regions; region++) {
    const list = state.regionSettlements[region];
    // (Yearly per region, staggered.)
    if (list.length < 2 || (state.tick + region) % 12 !== 0) continue;
    const seen = new Set<number>();
    for (const id of list) {
      const settlement = state.settlements[id];
      if (settlement.status !== 'alive') continue;
      const types = [...settlement.buildings.map(building => building.type), ...state.polities[settlement.owner].projects.filter(project => project.settlement === id).map(project => project.type)];
      for (const type of types) if (BUILDINGS[type].perRegion) { if (seen.has(type)) fail(`region ${region} has two of ${BUILDINGS[type].name}`); seen.add(type); }
    }
  }
  if (indexed !== state.settlements.length) fail(`the region index lists ${indexed} settlements of ${state.settlements.length}`);
  // Wonders (VISION.md "Wonders"): each type unique while it stands or is being built, standing in a living settlement
  // that names it, worn only while its owner mends it.
  const active = new Set<number>();
  for (const wonder of state.wonders) {
    const settlement = state.settlements[wonder.settlement];
    if (!WONDERS[wonder.type] || !settlement || !Number.isInteger(wonder.spent) || wonder.spent < 0 || wonder.spent > wonder.cost) fail(`wonder ${wonder.id} is invalid`);
    if (wonder.status !== 'building' && wonder.status !== 'standing') { if (wonder.endedTick === null || wonder.endCause === null) fail(`wonder ${wonder.id} ended without a date or cause`); continue; }
    if (wonder.endedTick !== null || wonder.endCause !== null) fail(`wonder ${wonder.id} has ended but still ${wonder.status === 'building' ? 'is being built' : 'stands'}`);
    if (active.has(wonder.type)) fail(`two of wonder type ${wonder.type} stand or are being built`);
    active.add(wonder.type);
    if (settlement.status !== 'alive') fail(`wonder ${wonder.id} is in settlement ${settlement.id}, which is not alive`);
    if (wonder.status === 'standing' && (settlement.wonder !== wonder.type || !(wonder.condition > 0 && wonder.condition <= 1) || wonder.spent !== wonder.cost)) fail(`standing wonder ${wonder.id} is not in place`);
    if (wonder.status === 'standing' && wonder.condition < 1 && !state.polities[settlement.owner].repairing) fail(`wonder ${wonder.id} is worn and its owner is not mending it`);
    if (wonder.status === 'building' && wonder.spent >= wonder.cost) fail(`wonder ${wonder.id} is paid for but not standing`);
  }
  for (const settlement of state.settlements) if (settlement.wonder !== null && !state.wonders.some(wonder => wonder.settlement === settlement.id && wonder.type === settlement.wonder && wonder.status === 'standing')) fail(`settlement ${settlement.id} names a wonder that does not stand there`);
  for (const id of state.living) {
    const polity = state.polities[id];
    if (!polity || polity.deathTick !== null) fail(`live polity list names ${id}`);
    if (!polity.groups.length || !polity.groups.includes(polity.core)) fail(`polity ${id} has no bands or its core band ${polity.core} is not one of them`);
    const knowledge = polity.knowledge;
    if (knowledge.known.length !== TECHS.length || knowledge.progress.length !== TECHS.length || knowledge.target >= TECHS.length
      || (knowledge.target >= 0 && (knowledge.known[knowledge.target] || !(knowledge.progress[knowledge.target] >= 0)))) {
      fail(`polity ${id} has inconsistent knowledge (target ${knowledge.target})`);
    }
    for (const groupId of polity.groups) {
      const group = state.groups[groupId], region = group?.region;
      if (!group || group.polity !== id || group.deathTick !== null) fail(`polity ${id} has an inconsistent group ${groupId}`);
      if (!Number.isInteger(group.size) || group.size <= 0) fail(`group ${groupId} of polity ${id} has size ${group.size}`);
      if (!Number.isInteger(group.store) || group.store < 0) fail(`group ${groupId} has food store ${group.store}`);
      if (!Number.isFinite(group.foodSecurity) || group.foodSecurity < 0) fail(`group ${groupId} has food security ${group.foodSecurity}`);
      if (region < 0 || region >= regions) fail(`group ${groupId} is in missing region ${region}`);
      if (seen[region] >= 0) fail(`region ${region} holds bands of polities ${seen[region]} and ${id}`);
      if (state.occupant[region] !== id || state.groupAt[region] !== groupId) fail(`region ${region} does not record its band ${groupId} of polity ${id}`);
      seen[region] = id;
      now[region] += group.size;
      // VISION.md M2: no polity holds or enters a region on another landmass before it knows Sailing. A lineage's home
      // is where its first band began, so daughters carried across the sea count too.
      if (state.partition.regions[region].landmass !== polity.homeLandmass && !knowledge.known[SAILING]) {
        fail(`polity ${id} is on landmass ${state.partition.regions[region].landmass} without Sailing (home ${polity.homeLandmass})`);
      }
      if (!Number.isInteger(group.specialists) || group.specialists < 0 || group.specialists > group.size) fail(`group ${groupId} has ${group.specialists} specialists of ${group.size}`);
      if (polity.kind === 'band' && group.specialists > 0) fail(`band ${groupId} has specialists`);
      if (polity.kind === 'civ' && (state.owner[region] !== id || villages[region] < 1)) fail(`civilization ${id} does not own region ${region}, where its people live, or has no village there`);
      if (polity.kind === 'civ' && urban[region] !== group.specialists) fail(`region ${region}'s settlements house ${urban[region]} townspeople, not its ${group.specialists} specialists`);
      const flows = ledger.food.get(group.id);
      if (!flows) fail(`group ${groupId} has no food flows this tick`);
      else if (group.store !== flows.before + flows.production - flows.consumption - flows.spoilage + flows.carriedIn - flows.carriedOut) {
        fail(`group ${groupId}'s food store ${group.store} is not explained by its flows ${JSON.stringify(flows)}`);
      } else if (!Number.isInteger(group.planted) || group.planted < 0 || group.planted !== flows.plantedBefore + flows.sown - flows.harvested - flows.cropsLost) {
        fail(`group ${groupId}'s crops in the field ${group.planted} are not explained by its flows ${JSON.stringify(flows)}`);
      }
    }
    if (polity.kind === 'civ') {
      const capital = polity.capital === null ? undefined : state.settlements[polity.capital];
      if (!capital || capital.owner !== id || !capital.capital || capital.status !== 'alive' || state.occupant[capital.region] !== id) fail(`civilization ${id} has no living capital in its land`);
      else if (capital.region !== state.groups[polity.core].region) fail(`civilization ${id}'s capital is not in its heartland region ${state.groups[polity.core].region}`);
      else if (state.partition.regionOf[capital.cell] !== capital.region) fail(`settlement ${capital.id} is not on a land cell of its region`);
    } else if (polity.capital !== null) fail(`band ${id} has a capital`);
    checkMap(state, polity, fail);
    checkKnowledge(state, polity, fail);
    // A tribe has no treasury; a civilization's works under construction stand in its own living settlements.
    if (polity.kind === 'band' && (polity.wealth !== 0 || polity.projects.length || polity.roadWorks.length)) fail(`tribe ${id} has wealth or works`);
    if (!(polity.roadsUnpaid >= 0 && polity.roadsUnpaid <= 1)) fail(`polity ${id} left ${polity.roadsUnpaid} of its road upkeep unpaid`);
    for (const work of polity.roadWorks) checkRoadWork(state, id, work, fail);
    if (!(polity.wealthCarry >= 0 && polity.wealthCarry < 1 && polity.upkeepCarry >= 0 && polity.upkeepCarry < 1)) fail(`polity ${id} carries ${polity.wealthCarry} wealth and ${polity.upkeepCarry} upkeep`);
    for (const project of polity.projects) {
      const settlement = state.settlements[project.settlement];
      if (!settlement || !BUILDINGS[project.type] || !Number.isInteger(project.cost) || project.cost <= 0 || project.cost > BUILDINGS[project.type].cost || !Number.isInteger(project.spent) || project.spent < 0 || project.spent >= project.cost) fail(`polity ${id} has an invalid work ${JSON.stringify(project)}`);
    }
    if (polity.kind === 'civ' && !ledger.wealth.has(id) && polity.wealth !== 0) fail(`civilization ${id}'s treasury changed with no flows recorded`);
  }
  // Exact wealth accounting (VISION.md rule 8): every treasury is explained by this tick's flows.
  for (const [id, flows] of ledger.wealth) {
    const polity = state.polities[id];
    const values = [flows.before, flows.produced, flows.construction, flows.upkeep, flows.received, flows.given, flows.lost];
    if (!values.every(value => Number.isInteger(value) && value >= 0)) fail(`civilization ${id} has invalid wealth flows ${JSON.stringify(flows)}`);
    const expected = flows.before + flows.produced + flows.received - flows.construction - flows.upkeep - flows.given - flows.lost;
    if (!Number.isInteger(polity.wealth) || polity.wealth < 0 || polity.wealth !== expected) fail(`civilization ${id}'s treasury ${polity.wealth} is not explained by its flows ${JSON.stringify(flows)}`);
  }
  // Transfers close: everyone who left a region arrived in another, and food carried out was carried in somewhere.
  let migratedIn = 0, migratedOut = 0, carriedIn = 0, carriedOut = 0;
  for (let region = 0; region < regions; region++) { migratedIn += ledger.migrantsIn[region]; migratedOut += ledger.migrantsOut[region]; }
  for (const flows of ledger.food.values()) { carriedIn += flows.carriedIn; carriedOut += flows.carriedOut; }
  if (migratedIn !== migratedOut) fail(`${migratedOut} people left regions but ${migratedIn} arrived`);
  if (carriedIn !== carriedOut) fail(`${carriedOut} food units were carried out but ${carriedIn} carried in`);
  for (let region = 0; region < regions; region++) {
    if (seen[region] !== state.occupant[region] || (seen[region] < 0) !== (state.groupAt[region] < 0)) fail(`region ${region} records a band that is not there`);
    const expected = ledger.before[region] + ledger.births[region] - ledger.naturalDeaths[region] - ledger.famineDeaths[region]
      + ledger.migrantsIn[region] - ledger.migrantsOut[region];
    if (now[region] !== expected) fail(`region ${region} population ${now[region]} differs from its accounted ${expected}`);
    const owner = state.owner[region];
    if (owner >= 0 && (state.polities[owner]?.kind !== 'civ' || state.polities[owner].deathTick !== null || state.occupant[region] !== owner)) fail(`region ${region} is owned by ${owner}, which is not a living civilization there`);
    const stable = state.stability[region];
    if (!(stable >= 0 && stable <= 1) || (owner < 0 && (stable !== 1 || state.unrest[region] !== 0))) fail(`region ${region} has stability ${stable} (unrest ${state.unrest[region]}) under owner ${owner}`);
    const game = state.gameStock[region];
    if (!(game > 0 && game <= 1)) fail(`region ${region} game stock is ${game}`);
  }
}

/** Every road lies on a real land edge under its key, with a known tier, a bridge only over a river and only where its
 *  tier bridges rivers, a condition in (0, 1] and the upkeep its tier, length and bridge give. */
function checkRoads(state: SimulationState, fail: (message: string) => never) {
  const n = state.partition.regions.length;
  for (const [key, road] of state.roads) {
    const edge = road.a < road.b && road.b < n ? edgeBetween(state, road.a, road.b) : undefined;
    if (!edge || key !== roadKey(n, road.a, road.b)) fail(`road ${key} does not lie on a land edge (${road.a}–${road.b})`);
    if (!(Number.isInteger(road.tier) && road.tier >= 1 && road.tier <= ROAD_TIERS.length)) fail(`road ${key} has tier ${road.tier}`);
    if (road.bridge && !(edge.riverTier >= 1 && ROAD_TIERS[road.tier - 1].bridges)) fail(`road ${key} has a bridge with no river or on a ${ROAD_TIERS[road.tier - 1].name}`);
    if (!(road.condition > 0 && road.condition <= 1)) fail(`road ${key} has condition ${road.condition}`);
    if (road.upkeep !== roadUpkeep(road.tier, edge, road.bridge)) fail(`road ${key}'s upkeep ${road.upkeep} is not what it costs to keep`);
    if (!state.polities[road.builder]) fail(`road ${key} was built by no polity`);
  }
}

/** A road under construction: a path of land edges from its start, edges on that path, and exact payment. */
function checkRoadWork(state: SimulationState, id: number, work: RoadWork, fail: (message: string) => never) {
  const path = work.path, onPath = new Set<string>();
  for (let at = 1; at < path.length; at++) {
    if (!edgeBetween(state, path[at - 1], path[at])) fail(`civilization ${id}'s road work steps off the land at ${path[at - 1]}–${path[at]}`);
    onPath.add(`${Math.min(path[at - 1], path[at])},${Math.max(path[at - 1], path[at])}`);
  }
  if (path.length < 2 || !work.edges.length || work.edges.some(([a, b]) => a >= b || !onPath.has(`${a},${b}`)) || new Set(work.edges.map(edge => edge.join())).size !== work.edges.length) fail(`civilization ${id} has a road work whose edges are not on its path ${JSON.stringify(work)}`);
  if (!(Number.isInteger(work.tier) && work.tier >= 1 && work.tier <= ROAD_TIERS.length && state.settlements[work.to] && state.settlements[work.from])) fail(`civilization ${id} has an invalid road work ${JSON.stringify(work)}`);
  if (!(Number.isInteger(work.cost) && work.cost > 0 && Number.isInteger(work.spent) && work.spent >= 0 && work.spent < work.cost && Number.isInteger(work.months) && work.months >= 1)) fail(`civilization ${id}'s road work is paid ${work.spent} of ${work.cost} over ${work.months} months`);
}

/** A living settlement's buildings: one of each type, in condition, mended while upkeep is paid, and the housing and
 *  bonus they give. */
function checkBuildings(state: SimulationState, settlement: Settlement, fail: (message: string) => never) {
  if (settlement.housing !== housingOf(settlement)) fail(`settlement ${settlement.id}'s housing is not what its buildings give`);
  if (settlement.buildings.length) {
    const bonus = bonusOf(settlement.buildings), held = settlement.bonus;
    if (bonus.research !== held.research || bonus.wealth !== held.wealth || bonus.store !== held.store || bonus.spoilage !== held.spoilage || bonus.stability !== held.stability || bonus.upkeep !== held.upkeep
      || bonus.mine !== held.mine || bonus.quarry !== held.quarry || bonus.harbor !== held.harbor) fail(`settlement ${settlement.id}'s bonus is not what its buildings give`);
    if (!state.polities[settlement.owner].repairing && settlement.buildings.some(building => building.condition < 1)) fail(`settlement ${settlement.id} has worn buildings its owner is not mending`);
  } else if (settlement.bonus.research !== 1 || settlement.bonus.wealth !== 1 || settlement.bonus.store !== 1 || settlement.bonus.spoilage !== 1 || settlement.bonus.stability !== 0 || settlement.bonus.upkeep !== 0
    || settlement.bonus.mine || settlement.bonus.quarry || settlement.bonus.harbor) fail(`settlement ${settlement.id} has a bonus without buildings`);
  if (new Set(settlement.buildings.map(building => building.type)).size !== settlement.buildings.length || settlement.buildings.some(building => !(building.condition > 0 && building.condition <= 1) || !BUILDINGS[building.type])) fail(`settlement ${settlement.id} has invalid buildings`);
}

/**
 * Knowledge (VISION.md "Paths, not a timeline"), yearly per polity (staggered by id): what speed-ups gave is part of a
 * tech's progress, nothing known is still being researched, and every exchange in force is held by both sides with
 * the same end, with a living people it has met, and was agreed with a civilization.
 */
function checkKnowledge(state: SimulationState, polity: Polity, fail: (message: string) => never) {
  if ((state.tick + polity.id) % 12 !== 0) return;
  const knowledge = polity.knowledge, id = polity.id;
  for (let tech = 0; tech < knowledge.known.length; tech++) {
    const progress = knowledge.progress[tech], taught = knowledge.taught[tech], caught = knowledge.caught[tech];
    if (!(taught >= 0 && caught >= 0 && taught + caught <= progress * (1 + 1e-9) + 1e-9)) fail(`polity ${id}'s progress on tech ${tech} (${progress}) is less than its speed-ups gave (${taught} + ${caught})`);
    if (knowledge.known[tech] && progress + taught + caught !== 0) fail(`polity ${id} still researches tech ${tech}, which it knows`);
  }
  for (const [other, until] of polity.exchanges) {
    const them = state.polities[other];
    if (until <= state.tick || them.deathTick !== null) continue;
    if (them.exchanges.get(id) !== until) fail(`polity ${id} shares knowledge with ${other} until ${until}, but not the other way round`);
    if (!polity.met.has(other)) fail(`polity ${id} shares knowledge with ${other}, which it has not met`);
    if (polity.kind !== 'civ' && them.kind !== 'civ') fail(`tribes ${id} and ${other} share knowledge, but only civilizations offer it`);
  }
}

/**
 * Map knowledge (VISION.md "Knowledge of the world"): its own regions are in sight; only civilizations remember;
 * research contacts are polities it has met; and, yearly per polity, the sight list is ascending and marked observed,
 * and (unless due for a rebuild) exactly what its land and sea reach give, with everyone in it met; every remembered
 * region has a snapshot, contact is mutual and no region is marked without a record.
 */
function checkMap(state: SimulationState, polity: Polity, fail: (message: string) => never) {
  const map = polity.map, id = polity.id;
  if (map.status.length !== state.partition.regions.length) fail(`polity ${id} has a map of ${map.status.length} regions`);
  for (const groupId of polity.groups) if (map.status[state.groups[groupId].region] !== OBSERVED) fail(`polity ${id} does not see its own region ${state.groups[groupId].region}`);
  if (polity.kind === 'band' && map.snapshots.size) fail(`tribe ${id} remembers regions out of sight`);
  for (const contact of polity.contacts) if (!polity.met.has(contact)) fail(`polity ${id} is in research contact with ${contact}, which it has not met`);
  // The rest changes only when sight is rebuilt or polities meet: checked once a year per polity, staggered by id.
  if ((state.tick + id) % 12 !== 0) return;
  for (let at = 0; at < map.observed.length; at++) {
    if (map.status[map.observed[at]] !== OBSERVED || (at > 0 && map.observed[at] <= map.observed[at - 1])) fail(`polity ${id}'s sight list is inconsistent at ${map.observed[at]}`);
  }
  map.snapshots.forEach((snapshot, region) => { if (map.status[region] !== KNOWN || snapshot.tick > state.tick) fail(`polity ${id} has a stray snapshot of region ${region}`); });
  for (const other of polity.met.keys()) { const them = state.polities[other]; if (them.deathTick === null && !them.met.has(id)) fail(`polity ${id} has met ${other}, but not the other way round`); }
  // Sight that is not due for a rebuild is exactly what its groups and sea reach give, and it has met everyone in it.
  if (!map.dirty && map.sea === polity.knowledge.sea) {
    const regions = state.partition.regions, expected = new Set<number>();
    for (const groupId of polity.groups) {
      const here = regions[state.groups[groupId].region], sea = seaFrom(state, polity, here.id);
      expected.add(here.id);
      for (const edge of here.neighbors) expected.add(edge.region);
      if (sea > 0) for (const link of here.sea) if (crosses(sea, link.km)) expected.add(link.region);
    }
    if (expected.size !== map.observed.length || map.observed.some(region => !expected.has(region))) fail(`polity ${id}'s sight is not what its land and sea reach give`);
    for (const region of map.observed) {
      const other = state.occupant[region];
      if (other >= 0 && other !== id && !polity.met.has(other)) fail(`polity ${id} sees ${other} in region ${region} but has not met it`);
    }
  }
  let marked = 0;
  const status = map.status;
  for (let region = 0; region < status.length; region++) if (status[region] !== UNKNOWN) marked++;
  if (marked !== map.observed.length + map.snapshots.size) fail(`polity ${id} marks ${marked} regions but records ${map.observed.length + map.snapshots.size}`);
}

/**
 * Partition invariants, checked once when a world's simulation starts: every land cell in exactly one region, no water
 * cells, each region contiguous within one landmass, and every region of a multi-region landmass within the area
 * range (islands below the minimum stay single regions).
 */
export function checkPartition(geography: SimulationGeography, partition: RegionPartition) {
  const { regionOf, regions } = partition;
  const seen = new Uint8Array(geography.cells), near = new Int32Array(4);
  for (const region of regions) {
    if (!region.cells.length) throw new InvariantError(`Region ${region.id} is empty.`);
    for (const cell of region.cells) {
      if (!geography.land[cell]) throw new InvariantError(`Region ${region.id} contains water cell ${cell}.`);
      if (seen[cell]) throw new InvariantError(`Cell ${cell} belongs to two regions.`);
      if (regionOf[cell] !== region.id) throw new InvariantError(`Cell ${cell} is indexed to region ${regionOf[cell]}, not ${region.id}.`);
      seen[cell] = 1;
    }
    const reached = new Set([region.cells[0]]), queue = [region.cells[0]];
    for (let at = 0; at < queue.length; at++) for (const other of cellNeighbors(geography, queue[at], near)) {
      if (other >= 0 && regionOf[other] === region.id && !reached.has(other)) { reached.add(other); queue.push(other); }
    }
    if (reached.size !== region.cells.length) throw new InvariantError(`Region ${region.id} is not contiguous.`);
    if (!partition.landmasses[region.landmass]?.regions.includes(region.id)) throw new InvariantError(`Region ${region.id} is missing from landmass ${region.landmass}.`);
    const single = partition.landmasses[region.landmass].regions.length === 1;
    if (!single && (region.areaKm2 < REGION_TUNING.minAreaKm2 || region.areaKm2 > REGION_TUNING.maxAreaKm2)) {
      throw new InvariantError(`Region ${region.id} covers ${Math.round(region.areaKm2)} km², outside the region area range.`);
    }
  }
  for (let cell = 0; cell < geography.cells; cell++) {
    if (geography.land[cell] && !seen[cell]) throw new InvariantError(`Land cell ${cell} has no region.`);
    if (!geography.land[cell] && regionOf[cell] !== -1) throw new InvariantError(`Water cell ${cell} is assigned to a region.`);
  }
}
