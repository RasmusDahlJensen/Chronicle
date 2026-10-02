import { EVENT_TYPES } from '../../shared/simulation.ts';
import type { RegionPartition } from './regions.ts';
import { cellNeighbors, type SimulationGeography } from './geography.ts';
import type { SimulationState } from './state.ts';
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
  for (const id of state.living) {
    const band = state.polities[id];
    if (!band || band.deathTick !== null) fail(`live polity list names ${id}`);
    const group = state.groups[band.group];
    if (!group || group.polity !== id || group.region !== band.region || group.deathTick !== null) fail(`band ${id} has an inconsistent group`);
    if (!Number.isInteger(group.size) || group.size <= 0) fail(`band ${id} has size ${group.size}`);
    if (!Number.isInteger(group.store) || group.store < 0) fail(`band ${id} has food store ${group.store}`);
    if (!Number.isFinite(group.foodSecurity) || group.foodSecurity < 0) fail(`band ${id} has food security ${group.foodSecurity}`);
    if (band.region < 0 || band.region >= regions) fail(`band ${id} is in missing region ${band.region}`);
    if (seen[band.region] >= 0) fail(`region ${band.region} holds bands ${seen[band.region]} and ${id}`);
    if (state.occupant[band.region] !== id) fail(`region ${band.region} does not record its band ${id}`);
    seen[band.region] = id;
    now[band.region] += group.size;
    // VISION.md M2: no polity holds or enters a region on another landmass before it knows Sailing. A lineage's home
    // is where its first band began, so daughters carried across the sea count too.
    if (state.partition.regions[band.region].landmass !== band.homeLandmass && !band.knowledge.known[SAILING]) {
      fail(`polity ${id} is on landmass ${state.partition.regions[band.region].landmass} without Sailing (home ${band.homeLandmass})`);
    }
    const knowledge = band.knowledge;
    if (knowledge.known.length !== TECHS.length || knowledge.progress.length !== TECHS.length || knowledge.target >= TECHS.length
      || (knowledge.target >= 0 && (knowledge.known[knowledge.target] || !(knowledge.progress[knowledge.target] >= 0)))) {
      fail(`polity ${id} has inconsistent knowledge (target ${knowledge.target})`);
    }
    if (!Number.isInteger(group.specialists) || group.specialists < 0 || group.specialists > group.size) fail(`polity ${id} has ${group.specialists} specialists of ${group.size}`);
    if (band.kind === 'civ') {
      const capital = band.capital === null ? undefined : state.settlements[band.capital];
      if (!capital || capital.owner !== id || !capital.capital || capital.status !== 'alive' || capital.region !== band.region) fail(`civilization ${id} has no living capital in its region`);
      else if (state.partition.regionOf[capital.cell] !== capital.region) fail(`settlement ${capital.id} is not on a land cell of its region`);
      if (state.owner[band.region] !== id) fail(`civilization ${id} does not own its region ${band.region}`);
    } else if (band.capital !== null) fail(`band ${id} has a capital`);
    const flows = ledger.food.get(group.id);
    if (!flows) fail(`band ${id} has no food flows this tick`);
    else if (group.store !== flows.before + flows.production - flows.consumption - flows.spoilage + flows.carriedIn - flows.carriedOut) {
      fail(`band ${id}'s food store ${group.store} is not explained by its flows ${JSON.stringify(flows)}`);
    } else if (!Number.isInteger(group.planted) || group.planted < 0 || group.planted !== flows.plantedBefore + flows.sown - flows.harvested - flows.cropsLost) {
      fail(`polity ${id}'s crops in the field ${group.planted} are not explained by its flows ${JSON.stringify(flows)}`);
    }
  }
  // Transfers close: everyone who left a region arrived in another, and food carried out was carried in somewhere.
  let migratedIn = 0, migratedOut = 0, carriedIn = 0, carriedOut = 0;
  for (let region = 0; region < regions; region++) { migratedIn += ledger.migrantsIn[region]; migratedOut += ledger.migrantsOut[region]; }
  for (const flows of ledger.food.values()) { carriedIn += flows.carriedIn; carriedOut += flows.carriedOut; }
  if (migratedIn !== migratedOut) fail(`${migratedOut} people left regions but ${migratedIn} arrived`);
  if (carriedIn !== carriedOut) fail(`${carriedOut} food units were carried out but ${carriedIn} carried in`);
  for (let region = 0; region < regions; region++) {
    if (state.occupant[region] >= 0 && seen[region] !== state.occupant[region]) fail(`region ${region} records a band that is not there`);
    const expected = ledger.before[region] + ledger.births[region] - ledger.naturalDeaths[region] - ledger.famineDeaths[region]
      + ledger.migrantsIn[region] - ledger.migrantsOut[region];
    if (now[region] !== expected) fail(`region ${region} population ${now[region]} differs from its accounted ${expected}`);
    const owner = state.owner[region];
    if (owner >= 0 && (state.polities[owner]?.kind !== 'civ' || state.polities[owner].deathTick !== null || state.polities[owner].region !== region)) fail(`region ${region} is owned by ${owner}, which is not a living civilization there`);
    const game = state.gameStock[region];
    if (!(game > 0 && game <= 1)) fail(`region ${region} game stock is ${game}`);
  }
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
