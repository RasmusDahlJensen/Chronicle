import type { ChronicleEvent } from '../../shared/simulation.ts';
import { transferGroup } from './bands.ts';
import { BUILDINGS } from './buildings.ts';
import { causes } from './causes.ts';
import { lookAgain } from './perception.ts';
import { bonusOf, house, housingOf, livingSettlements, refreshRegionBonus } from './settlements.ts';
import type { Polity, PopulationGroup, SimulationState, TickContext } from './state.ts';
import { ARMY_TUNING, FOOD_TUNING, RAID_TUNING } from './tunables.ts';

/**
 * Raids and confederations (VISION.md "Raids", M6 "threat drives consolidation"; M6.4). Once a year each tribe's band
 * next to a civilization's land weighs a raid: hunger and herding push it, a rich store pulls it, and the odds of its
 * warriors against the soldiers and walls there decide how likely it is. A raid takes food, burns, kills on both sides
 * and moves no border; the region remembers it (walls answer, its realm feels the threat). Kin tribes beside a raiding
 * one may join it, a confederation.
 */

// Even salts draw for polities, odd ones for groups (as in `bands.ts`).
const RAIDING = 0x52_41_49, CONFEDERATING = 0x43_4f_4e, JOINING = 0x43_4f_4f;

/** The war system's part for raids: each tribe's bands once a year (staggered by band), then confederations. */
export function raid(state: SimulationState, context: TickContext) {
  const fade = 0.5 ** (1 / (12 * RAID_TUNING.memoryYears));
  for (let region = 0; region < state.raided.length; region++) if (state.raided[region] > 0) state.raided[region] = state.raided[region] * fade < 0.01 ? 0 : state.raided[region] * fade;
  for (const id of state.living.slice()) {
    const tribe = state.polities[id];
    if (tribe.kind !== 'band' || tribe.deathTick !== null) continue;
    for (const groupId of tribe.groups.slice()) {
      if ((state.tick + groupId) % 12 !== 0) continue;
      const group = state.groups[groupId];
      if (group.deathTick === null && group.size > 0) weighRaid(state, context, tribe, group);
    }
  }
  if (context.month === 1) confederate(state, context);
}

/** What a band would raid: the civilization region next to it its warriors are likeliest to plunder, and the chance. */
export function raidTarget(state: SimulationState, tribe: Polity, group: PopulationGroup) {
  const tuning = RAID_TUNING, units = FOOD_TUNING.unitsPerPersonMonth;
  const hunger = Math.max(0, Math.min(1, 1 - group.foodSecurity)), herding = group.herdShare;
  const push = tuning.hunger * hunger + tuning.herding * herding;
  if (push <= 0) return null;
  const warriors = group.size * ARMY_TUNING.warriors * tribe.knowledge.multipliers.military;
  let best: { region: number; civ: number; chance: number; riches: number; odds: number; walls: number } | null = null;
  for (const edge of state.partition.regions[group.region].neighbors) {
    const owner = state.owner[edge.region];
    if (owner < 0 || state.groupAt[edge.region] < 0) continue;
    const civ = state.polities[owner], there = state.groups[state.groupAt[edge.region]];
    // A store of months of food a head: riches (the richer, the likelier).
    const riches = Math.min(1, there.store / Math.max(1, there.size) / units / tuning.richMonths);
    let walls = 0;
    for (const settlement of livingSettlements(state, edge.region)) for (const building of settlement.buildings) walls = Math.max(walls, (BUILDINGS[building.type].effects.defense ?? 0) * building.condition);
    const guard = there.soldiers * civ.knowledge.multipliers.military * (1 + tuning.walls * walls) + tuning.watch * there.size * walls;
    const odds = warriors / (warriors + guard + 1);
    const chance = Math.min(tuning.maxChance, tuning.rate * push * riches * odds);
    if (!best || chance > best.chance || (chance === best.chance && edge.region < best.region)) best = { region: edge.region, civ: owner, chance, riches, odds, walls };
  }
  return best && best.chance > 0 ? { ...best, hunger, herding } : null;
}

/** A band weighs a raid and, by chance, makes it: food taken, a building burned, dead on both sides; no border moves. */
function weighRaid(state: SimulationState, context: TickContext, tribe: Polity, group: PopulationGroup) {
  const tuning = RAID_TUNING, target = raidTarget(state, tribe, group);
  if (!target) return;
  const rng = context.stream(group.id, RAIDING);
  if (rng.next() >= target.chance) return;
  const civ = state.polities[target.civ], there = state.groups[state.groupAt[target.region]];
  // The take: a share of their store, at most what the band can carry home (months of food a head).
  const take = Math.min(Math.floor(there.store * tuning.take), group.size * FOOD_TUNING.unitsPerPersonMonth * tuning.carryMonths);
  if (take > 0) {
    there.store -= take; group.store += take;
    state.ledger.food.get(there.id)!.carriedOut += take; state.ledger.food.get(group.id)!.carriedIn += take;
  }
  // The dead: some raiders and, fewer where walls stand, some defenders (war deaths).
  const raiders = Math.min(group.size - 1, Math.floor(group.size * ARMY_TUNING.warriors * tuning.raiderDeaths * (1 - target.odds)));
  if (raiders > 0) { group.size -= raiders; state.ledger.warDeaths[group.region] += raiders; state.metrics.warDeaths += raiders; }
  const fallen = Math.min(there.size - 1, Math.floor(there.size * tuning.defenderDeaths * target.odds * (1 - target.walls)));
  if (fallen > 0) {
    there.size -= fallen; state.ledger.warDeaths[target.region] += fallen; state.metrics.warDeaths += fallen;
    // Fewer people: no more townspeople than people (rehoused), and the soldiers among the rest.
    if (there.specialists > there.size) there.specialists = house(state, target.region, there.size, false);
    there.soldiers = Math.min(there.soldiers, Math.max(0, there.size - there.specialists));
  }
  // A building burned, by chance (one roll a raid; then one of the region's buildings).
  let burned = '';
  const standing = livingSettlements(state, target.region).filter(settlement => settlement.buildings.length);
  if (standing.length && rng.next() < tuning.burn * (1 - target.walls)) {
    const settlement = standing[Math.floor(rng.next() * standing.length)];
    const lost = settlement.buildings.splice(Math.floor(rng.next() * settlement.buildings.length), 1)[0], harbor = settlement.bonus.harbor;
    settlement.bonus = bonusOf(settlement.buildings); settlement.housing = housingOf(settlement); refreshRegionBonus(state, target.region);
    if (harbor && !settlement.bonus.harbor) { state.harbors[target.region]--; lookAgain(civ); }
    there.specialists = house(state, target.region, there.specialists, false);
    burned = BUILDINGS[lost.type].name; state.metrics.buildingsBurned++;
  }
  state.raided[target.region] = Math.min(1, state.raided[target.region] + tuning.memory);
  tribe.raids++; state.metrics.raids++;
  const cited: ChronicleEvent['causes'] = causes({ hunger: tuning.hunger * target.hunger, herding: tuning.herding * target.herding, riches: tuning.richesCause * target.riches });
  state.chronicle.emit({
    type: 'raid', actors: [{ id: tribe.id, role: 'attacker' }, { id: civ.id, role: 'defender' }], region: target.region, causes: cited, importance: Math.min(0.2, 0.04 + (raiders + fallen) / 20_000),
    data: {
      tribe: tribe.name, civ: civ.name, place: livingSettlements(state, target.region)[0]?.name ?? `region ${target.region}`, food: Math.round(take / FOOD_TUNING.unitsPerPersonMonth), killed: fallen, lost: raiders,
      someKilled: fallen > 0, someLost: raiders > 0, burned, burnedOne: burned !== '',
    },
  });
}

/**
 * Confederations (VISION.md M6: "herders beside rich farmers gain from raiding and from confederating"): each January a
 * tribe that raids may draw in a smaller tribe of its lineage next to it, which joins it whole (its bands its own),
 * likelier the more it has raided lately.
 */
function confederate(state: SimulationState, context: TickContext) {
  const tuning = RAID_TUNING;
  for (const id of state.living.slice()) {
    const tribe = state.polities[id];
    if (tribe.kind !== 'band' || tribe.deathTick !== null || tribe.raids <= 0) continue;
    const draw = Math.min(1, tribe.raids / tuning.confederateRaids);
    // Raids are forgotten by half each year ("lately").
    tribe.raids = Math.floor(tribe.raids / 2);
    const people = tribe.groups.reduce((sum, at) => sum + state.groups[at].size, 0);
    // Kin tribes next to it, smaller than it.
    const near = new Set<number>();
    for (const at of tribe.groups) for (const edge of state.partition.regions[state.groups[at].region].neighbors) {
      const other = state.occupant[edge.region];
      if (other >= 0 && other !== tribe.id && state.polities[other].kind === 'band' && state.polities[other].lineage === tribe.lineage) near.add(other);
    }
    // One chance a year, then the largest smaller kin tribe beside it.
    const kin = [...near].map(other => state.polities[other]).filter(them => them.deathTick === null)
      .map(them => ({ them, people: them.groups.reduce((sum, at) => sum + state.groups[at].size, 0) })).filter(entry => entry.people < people)
      .sort((a, b) => b.people - a.people || a.them.id - b.them.id);
    if (!kin.length || !context.stream(tribe.id, CONFEDERATING).chance(tuning.confederate * draw)) continue;
    for (const { them } of kin.slice(0, 1)) {
      const other = them.id;
      const bands = them.groups.length;
      for (const at of them.groups.slice()) transferGroup(state, context.stream(at, JOINING), state.groups[at], them, tribe, state.tick);
      state.metrics.confederations++;
      state.chronicle.emit({
        type: 'confederation', actors: [{ id: other, role: 'joined' }, { id: tribe.id, role: 'tribe' }], region: state.groups[tribe.core].region, importance: 0.12,
        causes: causes({ raiding: draw, kin: tuning.kinCause }), data: { name: them.name, tribe: tribe.name, bands, raiders: true },
      });
      break;
    }
  }
}
