import { BUILDINGS } from './buildings.ts';
import { WONDERS } from './wonders.ts';
import { bonusOf, housingOf } from './settlements.ts';
import { EVENT_TYPES } from '../../shared/simulation.ts';
import { RESOURCE_IDS } from '../../shared/atlas.ts';
import type { RegionPartition } from './regions.ts';
import { cellNeighbors, type SimulationGeography } from './geography.ts';
import { crosses, KNOWN, OBSERVED, seaFrom, UNKNOWN } from './perception.ts';
import { edgeBetween, ROAD_TIERS, roadKey, roadUpkeep } from './roads.ts';
import { VALUE_KEYS, type Polity, type RoadWork, type Settlement, type SimulationState } from './state.ts';
import { TECH_INDEX, TECHS } from './techs.ts';
import { BUDGET_TUNING, BUILD_TUNING, ENVIRONMENT_TUNING, RAVAGE_TUNING, REGION_TUNING, SETTLEMENT_TUNING, TRAIT_TUNING } from './tunables.ts';
import { TRAITS } from './traits.ts';
import { fieldLand } from './fields.ts';

/** The least share of its crops a harvest can come in at: the worst weather in drought without irrigation. */
// (M6.3: devastated land brings in less again.)
const lowestHarvest = () => ENVIRONMENT_TUNING.harvestMin * (1 - ENVIRONMENT_TUNING.droughtFarmLoss) * (1 - RAVAGE_TUNING.harvestCut);

/** Thrown when a tick leaves the world in an impossible state; the scenario and tick are in the message. */
export class InvariantError extends Error {}

const eventTypes = new Set<string>(EVENT_TYPES);
const SAILING = TECH_INDEX.get('Sailing')!;

/** Per-region scratch for the checks, reused from tick to tick (they run every month: VISION.md "invariants each tick"). */
let scratch = { regions: -1, now: new Int32Array(0), seen: new Int32Array(0), villages: new Int32Array(0), urban: new Float64Array(0), harbors: new Int32Array(0), farm: new Float64Array(0), shield: new Float64Array(0), store: new Float64Array(0), spoilage: new Float64Array(0), listed: new Int32Array(0) };
function scratchFor(regions: number, settlements: number) {
  if (scratch.regions !== regions) scratch = { regions, now: new Int32Array(regions), seen: new Int32Array(regions), villages: new Int32Array(regions), urban: new Float64Array(regions), harbors: new Int32Array(regions), farm: new Float64Array(regions), shield: new Float64Array(regions), store: new Float64Array(regions), spoilage: new Float64Array(regions), listed: scratch.listed };
  if (scratch.listed.length < settlements) scratch.listed = new Int32Array(Math.max(settlements, scratch.listed.length * 2, 1024));
  scratch.now.fill(0); scratch.seen.fill(-1); scratch.villages.fill(0); scratch.urban.fill(0); scratch.harbors.fill(0);
  scratch.farm.fill(1); scratch.shield.fill(0); scratch.store.fill(1); scratch.spoilage.fill(1); scratch.listed.fill(-1, 0, settlements);
  return scratch;
}

/** A group's values are each within 0–1: the first that is not, or null. */
function valueOutOfRange(values: SimulationState['groups'][number]['values']) {
  if (values.militarism >= 0 && values.militarism <= 1 && values.zeal >= 0 && values.zeal <= 1 && values.openness >= 0 && values.openness <= 1
    && values.tradition >= 0 && values.tradition <= 1 && values.expansionism >= 0 && values.expansionism <= 1) return null;
  return VALUE_KEYS.find(key => !(values[key] >= 0 && values[key] <= 1)) ?? null;
}

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
  const { ledger } = state, lowest = lowestHarvest();
  const { now, seen, villages, urban, harbors, farm, shield, store, spoilage, listed } = scratchFor(regions, state.settlements.length);
  // The region index: each settlement listed once, in its own region's list (with the count below, nothing else is
  // listed); a settlement's id is its place in the list of all settlements (every lookup by id relies on it).
  for (let region = 0; region < state.regionSettlements.length; region++) for (const id of state.regionSettlements[region]) {
    if (!(Number.isInteger(id) && id >= 0 && id < state.settlements.length) || listed[id] !== -1) fail(`region ${region}'s list names settlement ${id} twice or not at all`);
    listed[id] = region;
  }
  // Settlements (VISION.md "Settlements"): each living one stands on a land cell of a region its owner holds, listed in
  // that region's index, housing at most its housing; the urban of a region add up to its townspeople (checked below).
  for (let index = 0; index < state.settlements.length; index++) {
    const settlement = state.settlements[index];
    if (settlement.id !== index) fail(`settlement ${settlement.id} is at place ${index} in the list of settlements`);
    if (listed[index] !== settlement.region) fail(`settlement ${settlement.id} is missing from region ${settlement.region}'s list`);
    if (settlement.status !== 'alive') { if (settlement.capital || settlement.urban !== 0 || settlement.buildings.length) fail(`settlement ${settlement.id} in ruins is a capital or has people or buildings`); continue; }
    if (state.owner[settlement.region] !== settlement.owner) fail(`settlement ${settlement.id} stands in region ${settlement.region}, which its owner ${settlement.owner} does not hold`);
    if (state.partition.regionOf[settlement.cell] !== settlement.region) fail(`settlement ${settlement.id} is not on a land cell of its region`);
    if (!Number.isInteger(settlement.urban) || settlement.urban < 0 || settlement.urban > settlement.housing || !(settlement.tier >= 0 && settlement.tier <= 3)
      || !Number.isInteger(settlement.tierYears) || settlement.tierYears < 0 || settlement.tierYears >= SETTLEMENT_TUNING.tierYears) fail(`settlement ${settlement.id} houses ${settlement.urban} of ${settlement.housing} (tier ${settlement.tier}, ${settlement.tierYears} years past it)`);
    // Buildings: one of each type, in condition, and the housing and bonus they give (yearly per settlement, staggered).
    if ((state.tick + settlement.id) % 12 === 0) checkBuildings(state, settlement, fail);
    villages[settlement.region]++; urban[settlement.region] += settlement.urban; if (settlement.bonus.harbor) harbors[settlement.region]++;
    const at = settlement.region, bonus = settlement.bonus;
    farm[at] = Math.max(farm[at], bonus.farm); shield[at] = Math.max(shield[at], bonus.drought); store[at] = Math.max(store[at], bonus.store); spoilage[at] = Math.min(spoilage[at], bonus.spoilage);
    if (settlement.capital && state.polities[settlement.owner]?.capital !== settlement.id) fail(`settlement ${settlement.id} is a capital its owner does not name`);
  }
  let indexed = 0;
  for (const list of state.regionSettlements) indexed += list.length;
  for (let region = 0; region < regions; region++) if (state.harbors[region] !== harbors[region] || harbors[region] > 1) fail(`region ${region} counts ${state.harbors[region]} harbors, not its ${harbors[region]} (at most one)`);
  checkRoads(state, fail);
  // Each region's building effects are what its living settlements' buildings give (`refreshRegionBonus`).
  for (let region = 0; region < regions; region++) {
    if (state.farmBonus[region] !== farm[region] || state.droughtShield[region] !== shield[region] || state.storeBonus[region] !== store[region] || state.spoilageBonus[region] !== spoilage[region]) fail(`region ${region}'s building effects are not what its settlements' buildings give`);
  }
  // The environment: weather and harvests within their bounds, droughts no longer than they last, famine as a flag;
  // devastation (M6.3) within 0–1.
  for (let region = 0; region < regions; region++) {
    if (!(state.devastation[region] >= 0 && state.devastation[region] <= 1) || !(state.raided[region] >= 0 && state.raided[region] <= 1)) fail(`region ${region} has devastation ${state.devastation[region]} and raid memory ${state.raided[region]}`);
    if (!(state.weather[region] >= ENVIRONMENT_TUNING.harvestMin && state.weather[region] <= ENVIRONMENT_TUNING.harvestMax && state.harvestFactor[region] >= lowest && state.harvestFactor[region] <= ENVIRONMENT_TUNING.harvestMax)) fail(`region ${region} has weather ${state.weather[region]} and harvest ${state.harvestFactor[region]}`);
    if (state.drought[region] > ENVIRONMENT_TUNING.droughtYears * 12 || state.famine[region] > 1 || !(state.famineRecent[region] >= 0)) fail(`region ${region} has drought ${state.drought[region]}, famine ${state.famine[region]} and recent famine deaths ${state.famineRecent[region]}`);
    // Cultivated land lies within the region's farmland (VISION.md "Cultivated land").
    if (!(state.fields[region] >= 0 && state.fields[region] <= fieldLand(state.fieldRanking, region))) fail(`region ${region} has ${state.fields[region]} fields on ${fieldLand(state.fieldRanking, region)} of farmland`);
  }
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
    if (!WONDERS[wonder.type] || !settlement || !Number.isInteger(wonder.spent) || wonder.spent < 0 || wonder.spent > wonder.cost || !Number.isInteger(wonder.waited) || wonder.waited < 0 || wonder.waited > BUILD_TUNING.waitMonths) fail(`wonder ${wonder.id} is invalid`);
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
  for (const culture of state.cultures) {
    if (culture.parents.length && Math.abs(culture.parents.reduce((sum, parent) => sum + parent.weight, 0) - 1) > 1e-9) fail(`culture ${culture.id}'s parents' weights do not sum to 1`);
    if (culture.parents.some(parent => parent.id >= culture.id)) fail(`culture ${culture.id} names a later parent`);
    if (culture.traits.length > TRAIT_TUNING.max || culture.traitYears.length !== TRAITS.length || culture.traits.some((trait, at) => !TRAITS[trait] || culture.traits.indexOf(trait) !== at)) fail(`culture ${culture.id} has inconsistent traits`);
  }
  for (const id of state.living) {
    const polity = state.polities[id];
    if (!polity || polity.deathTick !== null) fail(`live polity list names ${id}`);
    if (!polity.groups.length || !polity.groups.includes(polity.core)) fail(`polity ${id} has no bands or its core band ${polity.core} is not one of them`);
    if ((polity.together < 0) !== (polity.togetherRuling < 0) || (polity.together < 0) !== (polity.togetherYears === 0) || polity.togetherYears < 0 || polity.together === polity.togetherRuling && polity.together >= 0) fail(`polity ${id} tracks a second people inconsistently`);
    if (polity.stateReligion !== state.groups[polity.core].faith) fail(`polity ${id}'s state religion ${polity.stateReligion} is not its heartland's faith ${state.groups[polity.core].faith}`);
    // Relations (M5.1): only a civilization keeps them, of peoples it has met, within their bounds.
    if (polity.relations.size && polity.kind !== 'civ') fail(`tribe ${id} keeps relations`);
    for (const [other, relation] of polity.relations) {
      if (other === id || !polity.met.has(other) || !(relation.intimacy >= 0 && relation.intimacy <= 1) || !(Math.abs(relation.opinion) <= 100)
        || relation.memories.some(memory => !Number.isFinite(memory.points) || memory.tick > state.tick)) fail(`polity ${id}'s relation with ${other} is out of bounds`);
    }
    // Its ruling culture is its heartland people's (VISION.md "Culture and lineage").
    if (polity.culture !== state.groups[polity.core].culture) fail(`polity ${id}'s ruling culture ${polity.culture} is not its heartland's ${state.groups[polity.core].culture}`);
    const knowledge = polity.knowledge;
    // Resources (M5.3): supply and demand are counts of units; access is 1 for a tribe and where nothing is demanded,
    // otherwise within (0, 1] and never below the share actually met (the floor only raises it; a fork that changes the
    // floor takes effect at each civilization's next yearly assessment). M5.4: nothing sends more than it works.
    for (let resource = 0; resource < knowledge.access.length; resource++) {
      const access = knowledge.access[resource], supply = polity.supply[resource], demand = polity.demand[resource], has = supply + polity.imports[resource] - polity.exports[resource];
      if (!(supply >= 0) || !(demand >= 0) || !(has >= -1e-9) || polity.exports[resource] > supply + 1e-9 || !(access > 0 && access <= 1) || ((polity.kind === 'band' || demand === 0) && access !== 1) || (demand > 0 && access < Math.min(1, has / demand) - 1e-12)) {
        fail(`polity ${id} has resource ${resource} supplied ${supply} of ${demand} at access ${access}`);
      }
    }
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
      const culture = state.cultures[group.culture];
      if (!culture || culture.deathTick !== null) fail(`group ${groupId} lives by culture ${group.culture}, which is gone`);
      if (group.faith !== -1 && (!state.religions[group.faith] || state.religions[group.faith].deathTick !== null)) fail(`group ${groupId} follows religion ${group.faith}, which is gone`);
      if (!Number.isInteger(group.faithApart) || group.faithApart < 0) fail(`group ${groupId} has been cut off from its faith for ${group.faithApart} years`);
      const outside = valueOutOfRange(group.values);
      if (outside) fail(`group ${groupId} has ${outside} ${group.values[outside]}`);
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
      // Soldiers (M6.1) are rural people: never more than its people less its townspeople; a tribe keeps none.
      if (!Number.isInteger(group.soldiers) || group.soldiers < 0 || group.soldiers > group.size - group.specialists) fail(`group ${groupId} has ${group.soldiers} soldiers of ${group.size - group.specialists} rural people`);
      if (polity.kind === 'band' && group.soldiers > 0) fail(`band ${groupId} has soldiers`);
      // (M6.3: a region whose last settlement was razed in war has none while it is occupied, or devastated until its
      // people rebuild.)
      if (polity.kind === 'civ' && (state.owner[region] !== id || (villages[region] < 1 && state.occupiedBy[region] < 0 && !(state.devastation[region] > 0)))) fail(`civilization ${id} does not own region ${region}, where its people live, or has no village there`);
      if (polity.kind === 'civ' && urban[region] !== group.specialists) fail(`region ${region}'s settlements house ${urban[region]} townspeople, not its ${group.specialists} specialists`);
      const flows = ledger.food.get(group.id);
      if (!flows) fail(`group ${groupId} has no food flows this tick`);
      else if (group.store !== flows.before + flows.production - flows.consumption - flows.spoilage + flows.carriedIn - flows.carriedOut) {
        fail(`group ${groupId}'s food store ${group.store} is not explained by its flows ${JSON.stringify(flows)}`);
      } else if (!Number.isInteger(group.planted) || group.planted < 0 || group.planted !== flows.plantedBefore + flows.sown - flows.harvested - flows.cropsLost) {
        fail(`group ${groupId}'s crops in the field ${group.planted} are not explained by its flows ${JSON.stringify(flows)}`);
      } else if (!(flows.factor >= lowest && flows.factor <= ENVIRONMENT_TUNING.harvestMax) || flows.weather !== Math.round(flows.harvested * flows.factor) - flows.harvested) {
        fail(`group ${groupId}'s harvest gained ${flows.weather} from the weather on ${flows.harvested} harvested at ${flows.factor}, not what that share gives`);
      }
    }
    if (polity.kind === 'civ') {
      const capital = polity.capital === null ? undefined : state.settlements[polity.capital];
      if (!capital || capital.owner !== id || !capital.capital || capital.status !== 'alive' || state.occupant[capital.region] !== id) fail(`civilization ${id} has no living capital in its land`);
      else if (capital.region !== state.groups[polity.core].region) fail(`civilization ${id}'s capital is not in its heartland region ${state.groups[polity.core].region}`);
      else if (state.partition.regionOf[capital.cell] !== capital.region) fail(`settlement ${capital.id} is not on a land cell of its region`);
      // A realm always keeps up its capital (`budget.ts` `deferMaintenance`).
      else if (state.neglected[capital.region]) fail(`civilization ${id} lets its capital's region ${capital.region} go unkept`);
    } else if (polity.capital !== null) fail(`band ${id} has a capital`);
    checkMap(state, polity, fail);
    checkKnowledge(state, polity, fail);
    // A tribe has no treasury; a civilization's works under construction stand in its own living settlements.
    if (polity.kind === 'band' && (polity.wealth !== 0 || polity.projects.length || polity.roadWorks.length)) fail(`tribe ${id} has wealth or works`);
    if (!(polity.roadsUnpaid >= 0 && polity.roadsUnpaid <= 1)) fail(`polity ${id} left ${polity.roadsUnpaid} of its road upkeep unpaid`);
    // Taxes stay within what a realm may take; arrears are a share of its costs.
    if (!(polity.taxRate >= BUDGET_TUNING.minRate && polity.taxRate <= BUDGET_TUNING.maxRate && polity.arrears >= 0 && polity.arrears <= 1)) fail(`polity ${id} taxes at ${polity.taxRate} with arrears ${polity.arrears}`);
    for (const work of polity.roadWorks) checkRoadWork(state, id, work, fail);
    if (!(polity.wealthCarry >= 0 && polity.wealthCarry < 1 && polity.upkeepCarry >= 0 && polity.upkeepCarry < 1)) fail(`polity ${id} carries ${polity.wealthCarry} wealth and ${polity.upkeepCarry} upkeep`);
    for (const project of polity.projects) {
      const settlement = state.settlements[project.settlement];
      if (!settlement || !BUILDINGS[project.type] || !Number.isInteger(project.cost) || project.cost <= 0 || project.cost > BUILDINGS[project.type].cost || !Number.isInteger(project.spent) || project.spent < 0 || project.spent >= project.cost
        || !Number.isInteger(project.waited) || project.waited < 0 || project.waited >= BUILD_TUNING.waitMonths) fail(`polity ${id} has an invalid work ${JSON.stringify(project)}`);
    }
    if (polity.kind === 'civ' && !ledger.wealth.has(id) && polity.wealth !== 0) fail(`civilization ${id}'s treasury changed with no flows recorded`);
  }
  // Treaties (M5.4, M5.5): active ones bind two different living civilizations; a trade agreement moves a positive
  // amount, and every civilization's imports, exports and trading partners are exactly the sums over its active trade
  // agreements; its pact, alliance and road partners are exactly those of its active pacts, alliances and road
  // agreements, one of each kind with any other at most.
  const imports = new Map<number, Float64Array>(), exports = new Map<number, Float64Array>();
  const partners = { trade: new Map<number, number[]>(), nonAggression: new Map<number, number[]>(), alliance: new Map<number, number[]>(), road: new Map<number, number[]>() };
  const tally = (map: Map<number, Float64Array>, id: number, resource: number, amount: number) => {
    let list = map.get(id);
    if (!list) { list = new Float64Array(RESOURCE_IDS.length); map.set(id, list); }
    list[resource] += amount;
  };
  const pair = (map: Map<number, number[]>, a: number, b: number) => { map.set(a, [...(map.get(a) ?? []), b]); map.set(b, [...(map.get(b) ?? []), a]); };
  const isCiv = (id: number) => state.polities[id]?.kind === 'civ';
  for (const treaty of state.treaties) {
    if (treaty.endTick !== null) { if (treaty.endCause === null) fail(`treaty ${treaty.id} ended without a cause`); continue; }
    if (treaty.type === 'trade') {
      if (!isCiv(treaty.exporter) || !isCiv(treaty.importer) || treaty.exporter === treaty.importer || !(treaty.amount > 0) || !(treaty.resource >= 0 && treaty.resource < RESOURCE_IDS.length)
        || (treaty.barter >= 0) !== (treaty.barterAmount > 0) || (treaty.barter >= 0) === (treaty.price > 0) || !(treaty.carry >= 0 && treaty.carry < 1)) fail(`treaty ${treaty.id} is invalid ${JSON.stringify(treaty)}`);
      tally(exports, treaty.exporter, treaty.resource, treaty.amount); tally(imports, treaty.importer, treaty.resource, treaty.amount);
      if (treaty.barter >= 0) { tally(exports, treaty.importer, treaty.barter, treaty.barterAmount); tally(imports, treaty.exporter, treaty.barter, treaty.barterAmount); }
      pair(partners.trade, treaty.exporter, treaty.importer);
      continue;
    }
    const [a, b] = treaty.parties;
    if (!isCiv(a) || !isCiv(b) || a === b || (treaty.type === 'road' && !(treaty.path.length >= 2 && treaty.cities.every(city => state.settlements[city])))) fail(`treaty ${treaty.id} is invalid ${JSON.stringify(treaty)}`);
    pair(partners[treaty.type], a, b);
  }
  const sorted = (list: readonly number[] | undefined) => [...(list ?? [])].sort((x, y) => x - y).join();
  for (const id of state.living) {
    const polity = state.polities[id], mine = imports.get(id), theirs = exports.get(id);
    for (let resource = 0; resource < RESOURCE_IDS.length; resource++) {
      if (Math.abs(polity.imports[resource] - (mine?.[resource] ?? 0)) > 1e-9 || Math.abs(polity.exports[resource] - (theirs?.[resource] ?? 0)) > 1e-9) fail(`polity ${id}'s imports or exports of resource ${resource} are not its agreements'`);
    }
    if (sorted(polity.trading) !== sorted(partners.trade.get(id))) fail(`polity ${id}'s trading partners are not its agreements'`);
    for (const [kind, list] of [['nonAggression', polity.pacts], ['alliance', polity.allies], ['road', polity.roadPartners]] as const) {
      if (sorted(list) !== sorted(partners[kind].get(id)) || new Set(list).size !== list.length) fail(`polity ${id}'s ${kind} partners are not its treaties'`);
    }
  }
  // Wars (M6.2): a war now lists two living civilizations that list it; occupied land is held by a side of a war now
  // and owned by the other; ended wars hold nothing.
  const holding = new Map<number, number>();
  for (const war of state.wars) {
    const sides = [state.polities[war.attacker], state.polities[war.defender]];
    if (war.endTick === null) {
      if (sides.some(side => side.deathTick !== null || side.kind !== 'civ' || !side.wars.includes(war.id))) fail(`war ${war.id} is not fought by two living civilizations that know it`);
      for (const entry of war.occupied) {
        const owner = entry.by === war.attacker ? war.defender : war.attacker;
        if ((entry.by !== war.attacker && entry.by !== war.defender) || state.owner[entry.region] !== owner || holding.has(entry.region)) fail(`war ${war.id} holds region ${entry.region} wrongly`);
        holding.set(entry.region, entry.by);
      }
    } else if (war.occupied.length) fail(`war ${war.id} ended but still holds land`);
  }
  for (let region = 0; region < state.occupiedBy.length; region++) if ((holding.get(region) ?? -1) !== state.occupiedBy[region]) fail(`region ${region} is occupied by ${state.occupiedBy[region]}, not by its war`);
  for (const id of state.living) for (const war of state.polities[id].wars) if (state.wars[war]?.endTick !== null) fail(`polity ${id} lists war ${war}, which is over`);
  // Exact wealth accounting (VISION.md rule 8): every treasury is explained by this tick's flows.
  for (const [id, flows] of ledger.wealth) {
    const polity = state.polities[id];
    const values = [flows.before, flows.produced, flows.construction, flows.upkeep, flows.administration, flows.services, flows.army, flows.relief, flows.received, flows.given, flows.lost];
    if (!values.every(value => Number.isInteger(value) && value >= 0)) fail(`civilization ${id} has invalid wealth flows ${JSON.stringify(flows)}`);
    const expected = flows.before + flows.produced + flows.received - flows.construction - flows.upkeep - flows.administration - flows.services - flows.army - flows.relief - flows.given - flows.lost;
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
    const expected = ledger.before[region] + ledger.births[region] - ledger.naturalDeaths[region] - ledger.famineDeaths[region] - ledger.warDeaths[region]
      + ledger.migrantsIn[region] - ledger.migrantsOut[region];
    if (now[region] !== expected) fail(`region ${region} population ${now[region]} differs from its accounted ${expected}`);
    const owner = state.owner[region];
    if (owner >= 0 && (state.polities[owner]?.kind !== 'civ' || state.polities[owner].deathTick !== null || state.occupant[region] !== owner)) fail(`region ${region} is owned by ${owner}, which is not a living civilization there`);
    const stable = state.stability[region];
    if (!(stable >= 0 && stable <= 1) || (owner < 0 && (stable !== 1 || state.unrest[region] !== 0))) fail(`region ${region} has stability ${stable} (unrest ${state.unrest[region]}) under owner ${owner}`);
    // Land nobody holds is calm and has had no relief (both are cleared when its people leave).
    if (!(state.calm[region] >= 0 && state.calm[region] <= 1) || (owner < 0 && (state.calm[region] !== 1 || state.reliefTick[region] !== -1 || state.neglected[region] !== 0)) || state.neglected[region] > 1) fail(`region ${region} has calm ${state.calm[region]}, relief at ${state.reliefTick[region]} and neglect ${state.neglected[region]} under owner ${owner}`);
    // After the construction system, every region a civilization holds is measured from its capital (`budget.ts`). A
    // later system that moves regions between owners (war, fracture: M6–M7) must measure the regions it moves.
    if (owner >= 0 && (state.remoteOwner[region] !== owner || !(state.remoteness[region] >= 0 && Number.isFinite(state.remoteness[region])))) fail(`region ${region}'s remoteness ${state.remoteness[region]} was measured for ${state.remoteOwner[region]}, not its owner ${owner}`);
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
  const bonus = bonusOf(settlement.buildings), held = settlement.bonus;
  if ((Object.keys(bonus) as (keyof typeof bonus)[]).some(key => bonus[key] !== held[key])) fail(`settlement ${settlement.id}'s bonus is not what its buildings give`);
  if (!state.polities[settlement.owner].repairing && settlement.buildings.some(building => building.condition < 1)) fail(`settlement ${settlement.id} has worn buildings its owner is not mending`);
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
