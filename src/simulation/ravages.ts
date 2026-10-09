import type { ChronicleEvent } from '../../shared/simulation.ts';
import { BUILDINGS } from './buildings.ts';
import { causes } from './causes.ts';
import { wealthFlows } from './economy.ts';
import { blendValues } from './culture.ts';
import { roadKey, roadUpkeep } from './roads.ts';
import { bonusOf, endWonder, foundSettlement, house, housingOf, livingSettlements, refreshRegionBonus } from './settlements.ts';
import { lookAgain } from './perception.ts';
import type { Polity, SimulationState, TickContext, War } from './state.ts';
import { RAVAGE_TUNING, WAR_TUNING } from './tunables.ts';
import { warIncomeOf } from './claims.ts';
import { WONDERS } from './wonders.ts';
import { effectiveValues } from './values.ts';

/**
 * The ravages of war (VISION.md "Diplomacy and war", "Destruction"; M6.3), monthly in the war system after the fronts:
 * occupied land is devastated (its harvests cut, its fields burned, its people driven out), and once a year an occupier
 * may loot, burn or raze its settlements and break its roads and bridges. Refugees flee to the nearest land of their
 * own realm that is not occupied. Every person, unit of food and of wealth is accounted for (VISION.md rule 8).
 */

const RAVAGING = 0x52_41_56, REFOUNDING = 0x52_46_44; // the ravages' and the rebuilding's own stream salts

/** Monthly: devastation rises where land is occupied and fades elsewhere; fields burn; people flee; yearly ravages. */
export function ravage(state: SimulationState, context: TickContext) {
  const tuning = RAVAGE_TUNING, fade = 0.5 ** (1 / (12 * tuning.fadeYears));
  for (let region = 0; region < state.devastation.length; region++) {
    if (state.occupiedBy[region] >= 0) {
      state.devastation[region] = Math.min(1, state.devastation[region] + tuning.devastate / 12);
      // Fields burned and trampled: cultivated land lost, cleared again later.
      state.fields[region] *= 1 - tuning.fieldLoss / 12 * state.devastation[region];
      continue;
    }
    if (state.devastation[region] <= 0) continue;
    state.devastation[region] = state.devastation[region] * fade < tuning.gone ? 0 : state.devastation[region] * fade;
    // Land no longer occupied whose last settlement was razed: its people rebuild when they can (each month with chance
    // rebuild ÷ 12 × (1 − devastation), and at the latest when its devastation is gone), on the ruins, or (by chance
    // `fresh`) beside them on a free site, leaving the ruins standing. (Only devastated land can be without one.)
    if (state.owner[region] < 0 || state.groupAt[region] < 0 || state.regionSettlements[region].some(id => state.settlements[id].status === 'alive')) continue;
    const rng = context.stream(region, REFOUNDING);
    if (state.devastation[region] > 0 && !rng.chance(tuning.rebuild / 12 * (1 - state.devastation[region]))) continue;
    foundSettlement(state, rng, state.polities[state.owner[region]], region, false, state.tick, causes({ rebuilt: 1 }), true, rng.chance(tuning.fresh));
  }
  for (const war of state.wars) {
    if (war.endTick !== null) continue;
    for (const entry of war.occupied) {
      const region = entry.region, owner = state.polities[state.owner[region]];
      // Flight from devastated land, month by month (told once a year of the occupation).
      const group = state.groupAt[region] >= 0 ? state.groups[state.groupAt[region]] : null;
      if (group && owner) {
        const fleeing = Math.floor(group.size * tuning.flee / 12 * state.devastation[region]);
        if (fleeing > 0) entry.fled += flee(state, owner, region, fleeing, false, null);
        if ((state.tick - entry.tick) % 12 === 11) {
          tellRefugees(state, owner, region, entry.fled, causes({ devastation: state.devastation[region] }));
          entry.fled = 0;
        }
      }
      // The month's ravages: each settlement's yearly chances, a twelfth at a time.
      if (state.owner[region] >= 0) ravageRegion(state, context, war, region, entry.by);
    }
  }
}

/** Where refugees from `region` go: the owner's nearest region (by land through its own) that is not occupied; −1 none. */
function refuge(state: SimulationState, owner: Polity, region: number) {
  const seen = new Set([region]), queue = [region];
  for (let at = 0; at < queue.length; at++) {
    for (const edge of state.partition.regions[queue[at]].neighbors) {
      const next = edge.region;
      if (seen.has(next) || state.owner[next] !== owner.id) continue;
      if (state.occupiedBy[next] < 0 && state.groupAt[next] >= 0) return next;
      seen.add(next); queue.push(next);
    }
  }
  return -1;
}

/** People flee a region for the nearest land of their own realm not occupied (townspeople among them when `urban`);
 *  returns how many went (none when all its land is occupied, or none would be left). */
function flee(state: SimulationState, owner: Polity, region: number, people: number, urban: boolean, _cause: null) {
  const to = refuge(state, owner, region);
  if (to < 0 || people <= 0) return 0;
  const from = state.groups[state.groupAt[region]], there = state.groups[state.groupAt[to]];
  const moving = Math.min(people, from.size - 1);
  if (moving <= 0) return 0;
  blendValues(there, from.values, moving);
  from.size -= moving; there.size += moving;
  if (urban) from.specialists = Math.max(0, from.specialists - moving);
  state.ledger.migrantsOut[region] += moving; state.ledger.migrantsIn[to] += moving;
  state.metrics.refugees += moving;
  return moving;
}

/** A flight of refugees worth telling (refugeeEvent people or more), from a place to where they went. */
function tellRefugees(state: SimulationState, owner: Polity, region: number, people: number, cited: ChronicleEvent['causes'], place = placeName(state, region)) {
  if (people < RAVAGE_TUNING.refugeeEvent) return;
  const to = refuge(state, owner, region);
  state.chronicle.emit({
    type: 'refugees', actors: [{ id: owner.id, role: 'civ' }], region, causes: cited, importance: Math.min(0.2, 0.04 + people / 1_000_000),
    data: { civ: owner.name, people, from: place, to: to >= 0 ? placeName(state, to) : 'their land' },
  });
}

const placeName = (state: SimulationState, region: number) => livingSettlements(state, region)[0]?.name ?? `region ${region}`;
const TIERS = ['village', 'town', 'city', 'metropolis'];

/** Which side of a war a people is (0 attacker, 1 defender), for its dead and its exhaustion. */
const sideIn = (war: War, polity: number) => war.attacker === polity ? 0 : 1;

/**
 * A month of an occupied region's ravages (VISION.md "Destruction"): each settlement but a capital may be razed,
 * burned or looted (one of them), with its yearly chances ÷ 12 × the occupier's intent: (½ + Militarism) × (1 + hatred:
 * a holy war or a rival state religion) × (1 − its walls' defence), razing less where it means to keep the land (its
 * goal); then its roads lose their bridges, and roads without one are broken.
 */
function ravageRegion(state: SimulationState, context: TickContext, war: War, region: number, by: number) {
  const tuning = RAVAGE_TUNING, occupier = state.polities[by], owner = state.polities[state.owner[region]];
  if (!owner || owner.kind !== 'civ') return;
  const rng = context.stream(region, RAVAGING), values = effectiveValues(state, occupier);
  const hatred = war.framing === 'holy' || (occupier.stateReligion >= 0 && owner.stateReligion >= 0 && occupier.stateReligion !== owner.stateReligion) ? 1 : 0;
  const intent = (0.5 + values.militarism) * (1 + tuning.hatred * hatred) / 12;
  const keeps = by === war.attacker && war.goal.includes(region);
  const cited = causes({ militarism: values.militarism + 0.001, hatred: hatred * tuning.hatred, war: 0.1 });
  const settlements = livingSettlements(state, region);
  for (const settlement of settlements) {
    if (settlement.capital) continue;
    let walls = 0;
    for (const building of settlement.buildings) walls = Math.max(walls, (BUILDINGS[building.type].effects.defense ?? 0) * building.condition);
    const guard = Math.max(0, 1 - walls), raze = tuning.raze * intent * guard * (keeps ? tuning.keepRaze : 1), burn = tuning.burn * intent * guard, loot = tuning.loot * intent * guard;
    const draw = rng.next();
    if (draw < raze) razeSettlement(state, settlement.id, occupier, owner, war, cited);
    else if (draw < raze + burn) burnSettlement(state, rng, settlement.id, occupier, owner, war, cited);
    else if (draw < raze + burn + loot) lootSettlement(state, settlement.id, occupier, owner, war, cited, settlements.length);
  }
  breakRoads(state, rng, region, occupier, owner, war);
}

/** Looting: the settlement's share of the owner's treasury (by its townspeople, or the region's people where it has
 *  none) and some of the region's stored food go to the occupier. */
function lootSettlement(state: SimulationState, id: number, occupier: Polity, owner: Polity, war: War, cited: ChronicleEvent['causes'], here: number) {
  const tuning = RAVAGE_TUNING, settlement = state.settlements[id], region = settlement.region;
  const group = state.groups[state.groupAt[region]];
  let people = 0, townspeople = 0;
  for (const own of owner.groups) { people += state.groups[own].size; townspeople += state.groups[own].specialists; }
  const share = Math.max(townspeople > 0 ? settlement.urban / townspeople : 0, group.size / Math.max(1, people) / here);
  const wealth = Math.min(owner.wealth, Math.floor(owner.wealth * tuning.lootShare * share));
  if (wealth > 0) {
    const given = wealthFlows(state, owner), received = wealthFlows(state, occupier);
    owner.wealth -= wealth; occupier.wealth += wealth;
    given.given += wealth; received.received += wealth;
    addWarIncome(state, occupier, wealth);
  }
  // Its share of the region's stored food carried off to the occupier's nearest land (carried out and in: VISION.md rule 8).
  const food = Math.floor(group.store * tuning.lootFood / here), home = nearestOwn(state, occupier, region);
  if (food > 0 && home >= 0) {
    const there = state.groups[state.groupAt[home]];
    group.store -= food; there.store += food;
    state.ledger.food.get(group.id)!.carriedOut += food; state.ledger.food.get(there.id)!.carriedIn += food;
  }
  state.metrics.settlementsLooted++;
  state.chronicle.emit({
    type: 'settlementLooted', actors: [{ id: occupier.id, role: 'occupier' }, { id: owner.id, role: 'owner' }], region, settlement: id, causes: cited, importance: 0.08,
    data: { name: settlement.name, tier: TIERS[settlement.tier], occupier: occupier.name, owner: owner.name, wealth, treasure: wealth > 0, war: war.name, warId: war.id },
  });
}

/** Burning: some buildings destroyed; some townspeople killed (war deaths) and some driven out as refugees. */
function burnSettlement(state: SimulationState, rng: { next(): number }, id: number, occupier: Polity, owner: Polity, war: War, cited: ChronicleEvent['causes']) {
  const tuning = RAVAGE_TUNING, settlement = state.settlements[id], region = settlement.region;
  const before = settlement.buildings.length, harbor = settlement.bonus.harbor;
  settlement.buildings = settlement.buildings.filter(() => rng.next() >= tuning.burnBuildings);
  const lost = before - settlement.buildings.length;
  if (lost) {
    settlement.bonus = bonusOf(settlement.buildings); settlement.housing = housingOf(settlement); refreshRegionBonus(state, region); state.metrics.buildingsBurned += lost;
    // A harbor burned closes the sea from here (M3b.3).
    if (harbor && !settlement.bonus.harbor) { state.harbors[region]--; lookAgain(owner); }
  }
  const { killed, fled } = strike(state, war, owner, settlement, tuning.burnKill, tuning.burnFlee);
  // Its townspeople live where housing is left; the rest stay on as rural people.
  const group = state.groups[state.groupAt[region]];
  group.specialists = house(state, region, group.specialists, false);
  state.metrics.settlementsBurned++;
  state.chronicle.emit({
    type: 'settlementBurned', actors: [{ id: occupier.id, role: 'occupier' }, { id: owner.id, role: 'owner' }], region, settlement: id, causes: cited, importance: 0.15,
    data: { name: settlement.name, occupier: occupier.name, owner: owner.name, buildings: lost, lostBuildings: lost > 0, killed, someKilled: killed > 0, fled, someFled: fled > 0, war: war.name, warId: war.id },
  });
  tellRefugees(state, owner, region, fled, cited, settlement.name);
}

/** Townspeople of a settlement killed (war deaths, the war's dead on its owner's side) and driven out (refugees). */
function strike(state: SimulationState, war: War | null, owner: Polity, settlement: { region: number; urban: number }, kill: number, drive: number) {
  const group = state.groups[state.groupAt[settlement.region]];
  const killed = Math.min(Math.floor(settlement.urban * kill), group.size - 1);
  if (killed > 0) {
    group.size -= killed; group.specialists = Math.max(0, group.specialists - killed); settlement.urban -= killed;
    state.ledger.warDeaths[settlement.region] += killed; state.metrics.warDeaths += killed;
    if (war) { const side = sideIn(war, owner.id); war.deaths[side] += killed; war.yearDeaths[side] += killed; }
  }
  const leaving = Math.floor(settlement.urban * drive);
  const fled = leaving > 0 ? flee(state, owner, settlement.region, leaving, true, null) : 0;
  settlement.urban -= fled;
  return { killed, fled };
}

/** Razing: the settlement is wiped out, leaving named ruins; its townspeople killed or driven out; what stood there lost;
 *  its people's realm wearier of the war (VISION.md: destroyed cities). */
function razeSettlement(state: SimulationState, id: number, occupier: Polity | null, owner: Polity, war: War | null, cited: ChronicleEvent['causes']) {
  const tuning = RAVAGE_TUNING, settlement = state.settlements[id], region = settlement.region;
  const { killed, fled } = strike(state, war, owner, settlement, tuning.razeKill, 1);
  // Who could not flee dies with it.
  const group = state.groups[state.groupAt[region]], left = Math.min(settlement.urban, group.size - 1);
  if (left > 0) { group.size -= left; group.specialists = Math.max(0, group.specialists - left); state.ledger.warDeaths[region] += left; state.metrics.warDeaths += left; }
  if (war) {
    const side = sideIn(war, owner.id);
    war.deaths[side] += Math.max(0, left); war.yearDeaths[side] += Math.max(0, left);
    war.exhaustion[side] = Math.min(WAR_TUNING.exhaustion.max, war.exhaustion[side] + tuning.razedExhaustion);
  }
  if (settlement.bonus.harbor) { state.harbors[region]--; lookAgain(owner); }
  const before = owner.projects.length;
  owner.projects = owner.projects.filter(project => project.settlement !== id);
  state.metrics.projectsAbandoned += before - owner.projects.length;
  const wonder = state.wonders.find(entry => entry.settlement === id && (entry.status === 'building' || entry.status === 'standing'));
  if (wonder) endWonder(state, wonder, state.tick, 'abandoned');
  const buildings = settlement.buildings.length, tier = TIERS[settlement.tier];
  Object.assign(settlement, { status: 'razed', capital: false, urban: 0, urbanMean: 0, tierYears: 0, tier: 0, buildings: [], bonus: bonusOf([]), wonder: null, housing: housingOf({ capital: false }), ruinedTick: state.tick });
  refreshRegionBonus(state, region);
  group.specialists = house(state, region, group.specialists, false);
  state.metrics.settlementsRazed++;
  state.chronicle.emit({
    type: 'settlementRazed', actors: [...(occupier ? [{ id: occupier.id, role: 'occupier' }] : []), { id: owner.id, role: 'owner' }], region, settlement: id, causes: cited, importance: 0.35,
    data: {
      name: settlement.name, tier, occupier: occupier?.name ?? 'raiders', owner: owner.name, killed: killed + Math.max(0, left), fled, buildings, wonder: wonder ? WONDERS[wonder.type].name : '', lostWonder: !!wonder,
      war: war?.name ?? '', warId: war?.id ?? -1, inWar: war !== null,
    },
  });
  tellRefugees(state, owner, region, fled, cited, settlement.name);
}

/** Roads and bridges on an occupied region's edges broken (bridges first, "to stop an advance": a bridged road loses
 *  its bridge; a road without one may be broken). */
function breakRoads(state: SimulationState, rng: { next(): number }, region: number, occupier: Polity, owner: Polity, war: War) {
  const tuning = RAVAGE_TUNING, regions = state.partition.regions.length;
  let roads = 0, bridges = 0;
  for (const edge of state.partition.regions[region].neighbors) {
    const key = roadKey(regions, region, edge.region), road = state.roads.get(key);
    if (!road) continue;
    if (road.bridge) {
      // A bridge torn down leaves a road that costs less to keep (the upkeep follows what stands).
      if (rng.next() < tuning.bridgeRate / 12) { road.bridge = false; road.upkeep = roadUpkeep(road.tier, edge, false); bridges++; }
    } else if (rng.next() < tuning.roadRate / 12) { state.roads.delete(key); roads++; }
  }
  if (!roads && !bridges) return;
  state.metrics.roadsLost += roads; state.metrics.roadsDestroyed += roads; state.metrics.bridgesDestroyed += bridges;
  state.chronicle.emit({
    type: 'infrastructureDestroyed', actors: [{ id: owner.id, role: 'civ' }, { id: occupier.id, role: 'occupier' }], region, settlement: null,
    causes: [{ factor: 'war', weight: 1 }], importance: Math.min(0.3, 0.05 + 0.02 * (roads + bridges)),
    data: { civ: owner.name, roads, bridges, one: roads === 1, many: roads > 1, bridged: bridges > 0, bridgedAndRoads: bridges > 0 && roads > 0, bridgesOnly: bridges > 0 && roads === 0, war: true, by: occupier.name, name: war.name, warId: war.id },
  });
}

/** The occupier's region nearest an occupied one (a neighbour first), −1 none. */
function nearestOwn(state: SimulationState, occupier: Polity, region: number) {
  for (const edge of state.partition.regions[region].neighbors) if (state.owner[edge.region] === occupier.id && state.groupAt[edge.region] >= 0) return edge.region;
  return occupier.capital !== null ? state.settlements[occupier.capital].region : -1;
}

/** War income (M6.3, "conquest that pays"): loot and tribute received, fading by half every incomeYears (`warIncomeOf`). */
export function addWarIncome(state: SimulationState, polity: Polity, amount: number) {
  polity.warIncome = { value: warIncomeOf(polity, state.tick) + amount, tick: state.tick };
}

/** DEVELOPMENT CONTROL (Dev 02's scenario triggers; not a product feature): a settlement razed through the same rule as
 *  in war, its region devastated as war would leave it (so it may stand without a settlement until its people rebuild). */
export function razeInScenario(state: SimulationState, id: number) {
  const settlement = state.settlements[id];
  state.devastation[settlement.region] = Math.max(state.devastation[settlement.region], RAVAGE_TUNING.devastate);
  razeSettlement(state, id, null, state.polities[settlement.owner], null, causes({ developmentControl: 1 }));
}
