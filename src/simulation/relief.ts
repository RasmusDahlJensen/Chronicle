import { causes } from './causes.ts';
import { monthsToHarvest } from './food.ts';
import { wealthFlows } from './economy.ts';
import { CostHeap } from './heap.ts';
import { edgeTravel } from './roads.ts';
import type { Polity, SimulationState } from './state.ts';
import { FOOD_TUNING, POPULATION_TUNING, RELIEF_TUNING } from './tunables.ts';

/**
 * Famine relief (VISION.md "Famine is mitigable, by wealth and knowledge"): each month a civilization moves stored food
 * from its regions with food to spare to its regions going hungry, overland through its own land (roads shorten the
 * way), paying for the carriage from its treasury while it allows. Food carried far spoils on the way, less with better
 * storage. A rich realm carries its people through a famine a poor one cannot. Food and wealth moved are flows.
 */

const UNITS = FOOD_TUNING.unitsPerPersonMonth;

// Reused across relief searches: travel-km by region (by stamp), and a heap of (km, region).
let stamp = new Int32Array(0), mark = 0, km = new Float64Array(0);
const heap = new CostHeap();

/** Travel-km from `origin` to each region of the civilization's own land, through its own land only. */
function overland(state: SimulationState, civ: Polity, origin: number) {
  const regions = state.partition.regions;
  if (stamp.length !== regions.length) { stamp = new Int32Array(regions.length); km = new Float64Array(regions.length); mark = 0; }
  mark++;
  const reach = (region: number, through: number) => {
    if (stamp[region] === mark && km[region] <= through) return;
    stamp[region] = mark; km[region] = through;
    heap.push(through, region);
  };
  heap.clear();
  reach(origin, 0);
  while (heap.size) {
    const [at, region] = heap.pop();
    if (at > km[region]) continue;
    for (const edge of regions[region].neighbors) if (state.owner[edge.region] === civ.id) reach(edge.region, at + edgeTravel(state, region, edge));
  }
}
const travelled = (region: number) => stamp[region] === mark ? km[region] : Number.POSITIVE_INFINITY;

/** What share of food survives a carriage of `distance` travel-km: it spoils month by month on the way as in store. */
export function arriving(civ: Polity, distance: number) {
  const months = distance / RELIEF_TUNING.kmPerMonth, spoilage = Math.min(1, POPULATION_TUNING.storeSpoilage * civ.knowledge.multipliers.spoilage);
  return (1 - spoilage) ** months;
}

/** Wealth to carry `units` of food `distance` travel-km. */
export const carriage = (units: number, distance: number) => units / UNITS * distance / 1_000 * RELIEF_TUNING.costPer1000Km;

/**
 * Production system, after a civilization's people have eaten: its hungry regions are relieved from its regions with
 * food to spare, the hungriest first, each from the nearest. Hungry: food security below 1 with less than a month in
 * store, within what the land lastingly feeds. It wants enough in store for `months` of need. A donor keeps what it
 * needs until its next harvest and its reserve. The treasury pays at most `treasuryShare` of itself a month. Relief
 * reaching regions that had none last month is an event.
 */
export function relieve(state: SimulationState, civ: Polity, month: number) {
  const tuning = RELIEF_TUNING, food = state.food;
  const hungry: { group: number; want: number; was: number }[] = [];
  for (const groupId of civ.groups) {
    const group = state.groups[groupId], need = group.size * UNITS, was = state.relieved[group.region];
    state.relieved[group.region] = 0;
    if (civ.groups.length < 2 || need <= 0 || group.foodSecurity >= 1 || group.store >= need || group.size > state.capacity[group.region]) continue;
    hungry.push({ group: groupId, want: need * tuning.months - group.store, was });
  }
  if (!hungry.length || civ.wealth <= 0) return;
  hungry.sort((a, b) => b.want - a.want || a.group - b.group);
  let budget = Math.floor(civ.wealth * tuning.treasuryShare), begun = 0, people = 0, paid = 0;
  const flows = wealthFlows(state, civ), spared = new Map<number, number>();
  for (const entry of hungry) {
    if (budget <= 0) break;
    const recipient = state.groups[entry.group];
    overland(state, civ, recipient.region);
    // Donors by distance (ties by region): what each holds beyond its own needs until its next harvest and its reserve.
    const donors = civ.groups.map(id => state.groups[id]).filter(group => group.id !== recipient.id && Number.isFinite(travelled(group.region)) && group.foodSecurity >= 1)
      .sort((a, b) => travelled(a.region) - travelled(b.region) || a.region - b.region);
    let want = entry.want, arrived = 0;
    for (const donor of donors) {
      // (Less than a person-month still wanted is not worth a carriage.)
      if (want < UNITS || budget <= 0) break;
      const keep = donor.size * UNITS * (monthsToHarvest(food, donor.region, month % 12 + 1) + POPULATION_TUNING.reserveMonths);
      const spare = donor.store - keep;
      if (spare <= 0) continue;
      const distance = travelled(donor.region), share = arriving(civ, distance);
      if (!(share > 0)) continue;
      // What it sends: enough that what arrives meets the want, as far as its spare food and the treasury go.
      const perUnit = carriage(1, distance);
      const sent = Math.floor(Math.min(spare, want / share, perUnit > 0 ? budget / perUnit : Number.POSITIVE_INFINITY));
      if (sent <= 0) continue;
      const landed = Math.floor(sent * share), cost = Math.ceil(carriage(sent, distance));
      if (cost > budget) continue;
      budget -= cost; civ.wealth -= cost; flows.relief += cost;
      donor.store -= sent; recipient.store += landed;
      spared.set(donor.id, (spared.get(donor.id) ?? 0) + sent);
      const given = state.ledger.food.get(donor.id)!, taken = state.ledger.food.get(recipient.id)!;
      given.carriedOut += landed; given.spoilage += sent - landed; taken.carriedIn += landed;
      state.metrics.reliefUnits += landed; state.metrics.reliefLost += sent - landed; state.metrics.reliefCost += cost;
      want -= landed; arrived += landed; paid += cost;
    }
    if (arrived <= 0) continue;
    state.relieved[recipient.region] = 1;
    if (!entry.was) { begun++; people += recipient.size; }
  }
  if (!begun) return;
  state.metrics.reliefBegun++;
  const regions = hungry.filter(entry => !entry.was && state.relieved[state.groups[entry.group].region]).map(entry => state.groups[entry.group].region);
  state.chronicle.emit({
    type: 'famineRelief', actors: [{ id: civ.id, role: 'civ' }], region: regions[0], importance: 0.05,
    causes: causes({ hunger: 1 }),
    data: { civ: civ.name, regions: begun, one: begun === 1, moreRegions: begun > 1, people, cost: paid, donors: spared.size },
  });
}
