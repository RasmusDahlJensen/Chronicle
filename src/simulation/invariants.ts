import { EVENT_TYPES } from '../../shared/simulation.ts';
import type { RegionPartition } from './regions.ts';
import { cellNeighbors, type SimulationGeography } from './geography.ts';
import type { SimulationState } from './state.ts';
import { REGION_TUNING } from './tunables.ts';

/** Thrown when a tick leaves the world in an impossible state; the scenario and tick are in the message. */
export class InvariantError extends Error {}

const eventTypes = new Set<string>(EVENT_TYPES);

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
