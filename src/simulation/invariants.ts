import { EVENT_TYPES } from '../../shared/simulation.ts';
import type { RegionPartition } from './regions.ts';
import { cellNeighbors, type SimulationGeography } from './geography.ts';
import { KNOWN, OBSERVED, UNKNOWN } from './perception.ts';
import type { Polity, SimulationState } from './state.ts';
import { TECH_INDEX, TECHS } from './techs.ts';
import { MOBILITY_TUNING, REGION_TUNING } from './tunables.ts';

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
  // Living villages: each stands in a region its owner holds, one per region.
  const villages = new Int32Array(regions);
  for (const settlement of state.settlements) {
    if (settlement.status !== 'alive') continue;
    if (state.owner[settlement.region] !== settlement.owner) fail(`settlement ${settlement.id} stands in region ${settlement.region}, which its owner ${settlement.owner} does not hold`);
    if (++villages[settlement.region] > 1) fail(`region ${settlement.region} has more than one living village`);
    if (settlement.capital && state.polities[settlement.owner]?.capital !== settlement.id) fail(`settlement ${settlement.id} is a capital its owner does not name`);
  }
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
      if (polity.kind === 'civ' && (state.owner[region] !== id || villages[region] !== 1)) fail(`civilization ${id} does not own region ${region}, where its people live, or has no village there`);
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
    const game = state.gameStock[region];
    if (!(game > 0 && game <= 1)) fail(`region ${region} game stock is ${game}`);
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
    const regions = state.partition.regions, sea = polity.knowledge.sea, expected = new Set<number>();
    for (const groupId of polity.groups) {
      const here = regions[state.groups[groupId].region];
      expected.add(here.id);
      for (const edge of here.neighbors) expected.add(edge.region);
      if (sea > 0) for (const link of here.sea) if (sea >= 2 || link.km <= MOBILITY_TUNING.coastalSailingKm) expected.add(link.region);
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
