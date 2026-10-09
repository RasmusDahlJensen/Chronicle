import { RESOURCE_IDS } from '../../shared/atlas.ts';
import type { ChronicleEvent } from '../../shared/simulation.ts';
import { setArmy } from './army.ts';
import { endPolity, learnFrom, rehome, removeGroup } from './bands.ts';
import { causes } from './causes.ts';
import { endTreaty } from './diplomacy.ts';
import { transferWealth, wealthFlows } from './economy.ts';
import { absorbMap, arrive, budgetView, capitalTravel, lookAgain } from './perception.ts';
import { remember } from './relations.ts';
import { house, livingSettlements, setCapital } from './settlements.ts';
import { soldiersOf, strengthOf } from './soldiers.ts';
import { assess } from './stability.ts';
import type { Polity, SimulationState, TickContext, War, WarFraming, WarOutcome } from './state.ts';
import { endTrade } from './trade.ts';
import { WAR_TUNING } from './tunables.ts';
import { chooseGoal, claimWeight, defenseOf, ownLandValue, warBetween, wearinessOf } from './claims.ts';

export { chooseGoal, claimWeight, crossingOf, defenseOf, frontierGain, goalWorth, inTruce, medianEdge, ownLandValue, warBetween, wearinessOf } from './claims.ts';
import { effectiveValues } from './values.ts';

/**
 * War and peace (VISION.md "Diplomacy and war"; M6.2). A civilization declares war at its decision step on a neighbour
 * (`decisions/choose.ts`: the dominant factor frames it), for the border regions of theirs it values most. Each month
 * of war (the war system) each side's strength meets the other's: soldiers × military multiplier × supply (less far
 * from its capital), the defender's ground and walls helping it. The war score moves toward the stronger side with
 * chance; both sides lose soldiers (war deaths), the weaker more; a side ahead occupies the regions it fights for, one
 * by one; each side tires. Peace comes when a side is exhausted, when the attacker has held its goal a year, or when a
 * side seeks it and the other accepts; its terms follow the score (white peace, tribute, cession, annexation of a small
 * loser). The loser claims the land it lost; both remember the war; a truce follows.
 */

const peopleOf = (state: SimulationState, polity: Polity) => polity.groups.reduce((sum, id) => sum + state.groups[id].size, 0);
const sideOf = (war: War, polity: number) => war.attacker === polity ? 0 : war.defender === polity ? 1 : -1;

const ORDINALS = ['', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];
const ORDINAL = new RegExp(`^the (${ORDINALS.slice(1).join('|')}|\\d+th) `);

/** The war's name, from what it is fought for (VISION.md "Naming": goal plus place); a war fought again under the same
 *  name is the Second, the Third… ("the Second Tin War"). */
function warName(state: SimulationState, attacker: Polity, defender: Polity, framing: WarFraming, resource: number, goal: number[]) {
  const base = baseName(state, attacker, defender, framing, resource, goal);
  let fought = 0;
  for (const war of state.wars) if (war.name.replace(ORDINAL, 'the ') === base) fought++;
  return (fought === 0 ? base : `the ${ORDINALS[fought] ?? `${fought + 1}th`} ${base.slice(4)}`).slice(0, 40);
}

function baseName(state: SimulationState, attacker: Polity, defender: Polity, framing: WarFraming, resource: number, goal: number[]) {
  const place = goal.length ? (livingSettlements(state, goal[0])[0]?.name ?? `region ${goal[0]}`) : defender.name;
  const resourceName = resource >= 0 ? RESOURCE_IDS[resource] : '';
  const title = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
  const name = framing === 'resource' && resourceName ? `the ${title(resourceName)} War`
    : framing === 'holy' ? `the Holy War on the ${defender.name}`
    : framing === 'reclamation' ? `the War to Retake ${place}`
    : framing === 'farmland' ? `the War for ${place}`
    : framing === 'preemptive' ? `the ${attacker.name} War on the ${defender.name}`
    : framing === 'frontier' ? `the ${place} Frontier War`
    : `the War of ${place}`;
  return name.slice(0, 40);
}

/**
 * A civilization declares war (the decision step): a war is begun for `goal` (regions of theirs), framed by the
 * decision's dominant factor; treaties of trade and roads between them end (relations soured), both remember it, and
 * both set their armies for war at once.
 */
export function declareWar(state: SimulationState, attacker: Polity, defender: Polity, goal: number[], framing: WarFraming, resource: number, cited: ChronicleEvent['causes']): string {
  if (defender.deathTick !== null || defender.kind !== 'civ') return 'the other civilization is gone';
  if (warBetween(state, attacker.id, defender.id)) return `already at war with the ${defender.name}`;
  const own = goal.filter(region => state.owner[region] === defender.id);
  if (!own.length) return `the land it wanted is no longer the ${defender.name}'s`;
  // The attacker's land the defender would take, chosen as a goal is (never the attacker's capital): what it may win.
  const claims = new Map(defender.claims.map(claim => [claim.region, claimWeight(claim.tick, state.tick)]));
  const capital = attacker.capital === null ? -1 : state.settlements[attacker.capital].region;
  const counter = chooseGoal(state, defender.id, attacker.id, claims, ownLandValue(state, defender), region => region !== capital).goal;
  const war: War = {
    id: state.wars.length, name: warName(state, attacker, defender, framing, resource, own), attacker: attacker.id, defender: defender.id, framing, resource,
    goal: own, counter, occupied: [], score: 0, exhaustion: [0, 0], deaths: [0, 0], carry: [0, 0], yearDeaths: [0, 0], held: 0,
    startTick: state.tick, endTick: null, outcome: null, causes: cited, ceded: [], tribute: null,
  };
  state.wars.push(war);
  attacker.wars.push(war.id); defender.wars.push(war.id);
  state.metrics.warsDeclared++;
  remember(state, attacker, defender.id, 'war'); remember(state, defender, attacker.id, 'war');
  // Trade and joint roads between them end: war sours them (M5.4, M5.5). A non-aggression pact is broken: the victim
  // remembers it, and so does every people bound to the breaker by a treaty (VISION.md "broken treaties").
  for (const treaty of state.treaties) {
    if (treaty.endTick !== null) continue;
    const parties = treaty.type === 'trade' ? [treaty.exporter, treaty.importer] : treaty.parties;
    if (!(parties.includes(attacker.id) && parties.includes(defender.id))) continue;
    if (treaty.type === 'trade') { endTrade(state, treaty, 'relationsSoured', state.tick); continue; }
    if (treaty.type !== 'nonAggression') { endTreaty(state, treaty, 'relationsSoured', state.tick); continue; }
    endTreaty(state, treaty, 'broken', state.tick);
    const witnesses = new Set([defender.id, ...attacker.pacts, ...attacker.allies, ...attacker.trading]);
    for (const other of witnesses) if (other !== attacker.id) remember(state, state.polities[other], attacker.id, 'brokeTreaty');
    state.chronicle.emit({
      type: 'treatyBroken', actors: [{ id: attacker.id, role: 'breaker' }, { id: defender.id, role: 'other' }], region: null, importance: 0.25, causes: cited,
      data: { breaker: attacker.name, other: defender.name, pact: true, war: war.name },
    });
  }
  state.chronicle.emit({
    type: 'warDeclared', actors: [{ id: attacker.id, role: 'attacker' }, { id: defender.id, role: 'defender' }], region: own[0], causes: cited, importance: 0.5,
    data: { name: war.name, attacker: attacker.name, defender: defender.name, regions: own.length, war: war.id, warId: war.id, [framing]: true, resource: resource >= 0 ? RESOURCE_IDS[resource] : '' },
  });
  setArmy(state, attacker); setArmy(state, defender);
  return `declared ${war.name} on the ${defender.name}`;
}

/** How far its soldiers reach the front: 1 ÷ (1 + travel-km from its capital to the nearest of its regions ÷ supplyKm);
 *  roads shorten the way (travel is never infinite: land it cannot route is reached as the crow flies, `capitalTravel`). */
function supplyTo(state: SimulationState, polity: Polity, regions: readonly number[]) {
  if (!regions.length || polity.capital === null) return 1;
  const km = capitalTravel(state, polity);
  let nearest = Number.POSITIVE_INFINITY;
  for (const region of regions) nearest = Math.min(nearest, km(region));
  return 1 / (1 + nearest / WAR_TUNING.supplyKm);
}

/** War deaths among a side's soldiers: a whole number, spread over its regions by their soldiers (exact accounting). */
function kill(state: SimulationState, polity: Polity, deaths: number) {
  let soldiers = soldiersOf(state, polity);
  if (deaths <= 0 || soldiers <= 0) return 0;
  let left = Math.min(deaths, soldiers), killed = 0;
  for (const id of polity.groups.slice().sort((a, b) => state.groups[b].soldiers - state.groups[a].soldiers || a - b)) {
    const group = state.groups[id];
    if (!group.soldiers || left <= 0) continue;
    const share = Math.min(group.soldiers, left, Math.ceil(left * group.soldiers / soldiers));
    soldiers -= group.soldiers;
    group.soldiers -= share; group.size -= share; left -= share; killed += share;
    state.ledger.warDeaths[group.region] += share;
    if (group.size <= 0) removeGroup(state, polity, group, state.tick);
  }
  state.metrics.warDeaths += killed;
  return killed;
}

/** Occupation follows the score: a side ahead by occupyStep points per region holds that many of the regions it fights
 *  for (in order; not those another war holds), and gives them back as the score turns. */
function occupy(state: SimulationState, war: War) {
  const tuning = WAR_TUNING, wants: [number, number][] = [];
  for (const [by, regions, lead] of [[war.attacker, war.goal, war.score], [war.defender, war.counter, -war.score]] as const) {
    const owner = by === war.attacker ? war.defender : war.attacker;
    const held = regions.filter(region => state.owner[region] === owner && (state.occupiedBy[region] < 0 || state.occupiedBy[region] === by));
    const count = Math.max(0, Math.min(held.length, Math.floor(lead / tuning.occupyStep)));
    for (const region of held.slice(0, count)) wants.push([region, by]);
  }
  const wanted = new Map(wants);
  const before = war.occupied.length;
  war.occupied = war.occupied.filter(entry => {
    if (wanted.get(entry.region) === entry.by) { wanted.delete(entry.region); return true; }
    if (state.occupiedBy[entry.region] === entry.by) state.occupiedBy[entry.region] = -1;
    return false;
  });
  for (const [region, by] of wanted) { war.occupied.push({ region, by, tick: state.tick }); state.occupiedBy[region] = by; }
  return war.occupied.length !== before || wanted.size > 0;
}

/**
 * War system, M6.2's part (before the levy): each month of every war, the fronts, the dead, occupation and exhaustion;
 * peace when a side is exhausted or the attacker has held its goal for goalMonths; a yearly summary of the fighting
 * when notable; tribute paid month by month.
 */
export function wageWars(state: SimulationState, context: TickContext) {
  const tuning = WAR_TUNING;
  for (const war of state.wars) {
    if (war.endTick !== null) continue;
    const attacker = state.polities[war.attacker], defender = state.polities[war.defender];
    if (attacker.deathTick !== null || defender.deathTick !== null) { endWar(state, war, 'gone', null, 'partyGone'); continue; }
    const rng = context.stream(war.id);
    // The front lies in the land of the side being pushed back, whose ground helps it (its counter when the score turns);
    // both sides' soldiers march to it.
    const intoDefender = war.score >= 0;
    const front = intoDefender ? war.goal.filter(region => state.owner[region] === defender.id) : war.counter.filter(region => state.owner[region] === attacker.id);
    const where = front.length ? front : intoDefender ? war.goal : war.counter;
    const supplyA = supplyTo(state, attacker, where), supplyD = supplyTo(state, defender, where);
    const ground = defenseOf(state, front, intoDefender ? attacker.id : defender.id);
    const strengthA = strengthOf(state, attacker) * supplyA * (intoDefender ? 1 : ground), strengthD = strengthOf(state, defender) * supplyD * (intoDefender ? ground : 1);
    const odds = strengthA + strengthD > 0 ? strengthA / (strengthA + strengthD) : 0.5;
    war.score = Math.max(-100, Math.min(100, war.score + tuning.scoreRate * (2 * odds - 1) + tuning.noise * (rng.next() + rng.next() - 1)));
    // The dead: engaged soldiers at a yearly rate, the weaker side more.
    const engaged = [soldiersOf(state, attacker) * supplyA, soldiersOf(state, defender) * supplyD];
    const rate = [2 * (1 - odds), 2 * odds], dead: [number, number] = [0, 0];
    for (const side of [0, 1] as const) {
      war.carry[side] += engaged[side] * tuning.casualties / 12 * rate[side];
      const whole = Math.floor(war.carry[side]);
      war.carry[side] -= whole;
      dead[side] = kill(state, side === 0 ? attacker : defender, whole);
      war.deaths[side] += dead[side]; war.yearDeaths[side] += dead[side];
    }
    const changed = occupy(state, war);
    war.held = war.goal.length && war.goal.every(region => state.occupiedBy[region] === war.attacker) ? war.held + 1 : 0;
    // Exhaustion: the war's length, its dead (against its people), its land occupied and its arrears; less for a
    // militaristic people.
    for (const side of [0, 1] as const) {
      const polity = side === 0 ? attacker : defender, people = Math.max(1, peopleOf(state, polity));
      const occupied = war.occupied.filter(entry => entry.by !== polity.id).length / Math.max(1, polity.groups.length);
      const rise = tuning.exhaustion.years / 12 + tuning.exhaustion.dead * dead[side] / people
        + tuning.exhaustion.occupied * occupied / 12 + tuning.exhaustion.arrears * polity.arrears / 12;
      war.exhaustion[side] = Math.min(tuning.exhaustion.max, war.exhaustion[side] + rise * (1 - tuning.calm * effectiveValues(state, polity).militarism));
    }
    // The year's fighting, on the war's anniversary, when notable.
    if ((state.tick - war.startTick) % 12 === 11) {
      const dead = war.yearDeaths[0] + war.yearDeaths[1];
      const held = war.occupied.filter(entry => entry.by === attacker.id).length, lost = war.occupied.filter(entry => entry.by === defender.id).length;
      if (dead >= tuning.notableDead || changed) {
        state.chronicle.emit({
          type: 'battleYear', actors: [{ id: attacker.id, role: 'a' }, { id: defender.id, role: 'b' }], region: war.goal[0] ?? null, importance: Math.min(0.3, 0.05 + dead / 200_000),
          causes: causes({ strength: Math.abs(2 * odds - 1) + 0.001 }),
          data: {
            name: war.name, warId: war.id, attacker: attacker.name, defender: defender.name, attackerDead: war.yearDeaths[0], defenderDead: war.yearDeaths[1], score: Math.round(war.score),
            held, lost, holding: held > 0, losing: lost > 0, ahead: war.score >= 0 ? attacker.name : defender.name,
          },
        });
      }
      war.yearDeaths = [0, 0];
    }
    if (war.exhaustion[0] >= tuning.peaceAt || war.exhaustion[1] >= tuning.peaceAt) makePeace(state, war, 'exhaustion');
    else if (war.held >= tuning.goalMonths) makePeace(state, war, 'goalHeld');
  }
  // What this month's fighting and peaces changed for the other wars: a side annexed or gone ends its wars, and land
  // that changed hands or emptied is no longer held.
  for (const war of state.wars) {
    if (war.endTick !== null) continue;
    if (state.polities[war.attacker].deathTick !== null || state.polities[war.defender].deathTick !== null) { endWar(state, war, 'gone', null, 'partyGone'); continue; }
    war.occupied = war.occupied.filter(entry => {
      if (state.owner[entry.region] === (entry.by === war.attacker ? war.defender : war.attacker)) return true;
      if (state.occupiedBy[entry.region] === entry.by) state.occupiedBy[entry.region] = -1;
      return false;
    });
  }
  payTribute(state);
}

/** Tribute (a peace's terms): the payer pays a twelfth of the yearly sum each month while it can, until it ends. */
function payTribute(state: SimulationState) {
  for (const war of state.wars) {
    const tribute = war.tribute;
    if (!tribute || state.tick >= tribute.until) continue;
    const payer = state.polities[tribute.payer], payee = state.polities[tribute.payee];
    if (payer.deathTick !== null || payee.deathTick !== null) { tribute.until = state.tick; continue; }
    tribute.carry += tribute.amount / 12;
    const due = Math.floor(tribute.carry), paid = Math.min(due, payer.wealth);
    tribute.carry -= due;
    if (paid <= 0) continue;
    const given = wealthFlows(state, payer), received = wealthFlows(state, payee);
    payer.wealth -= paid; payee.wealth += paid;
    given.given += paid; received.received += paid;
    tribute.paid += paid;
  }
}

/**
 * Peace (VISION.md "Ending wars"): terms by the winner's lead in the war score — below `terms.white` a white peace;
 * below `terms.tribute` tribute; below `terms.annex` the land it holds of theirs ceded (with tribute, or tribute alone
 * if it holds none); above, annexation if the loser is small (few regions, or few people beside the winner), else
 * cession with tribute. Never the loser's capital region but in annexation.
 */
export function makePeace(state: SimulationState, war: War, cause: 'exhaustion' | 'goalHeld' | 'soughtPeace', cited: ChronicleEvent['causes'] = []) {
  const tuning = WAR_TUNING, attacker = state.polities[war.attacker], defender = state.polities[war.defender];
  // A side gone this month (annexed in another war, united, died out): there is no one to make peace with.
  if (attacker.deathTick !== null || defender.deathTick !== null) { endWar(state, war, 'gone', null, 'partyGone'); return; }
  const lead = Math.abs(war.score), winner = war.score >= 0 ? attacker : defender, loser = winner === attacker ? defender : attacker;
  const capital = loser.capital !== null ? state.settlements[loser.capital].region : -1;
  const taken = war.occupied.filter(entry => entry.by === winner.id && state.owner[entry.region] === loser.id && entry.region !== capital).map(entry => entry.region);
  const small = loser.groups.length <= tuning.annexRegions || peopleOf(state, loser) <= tuning.annexPeople * peopleOf(state, winner);
  // Holding a small realm's capital, its whole goal, for a year is decisive: there is nothing left to cede but all.
  const capitalHeld = cause === 'goalHeld' && !taken.length && small && war.occupied.some(entry => entry.region === capital && entry.by === winner.id);
  const outcome: WarOutcome = lead < tuning.terms.white ? 'white' : lead < tuning.terms.tribute ? 'tribute'
    : (lead >= tuning.terms.annex && small) || capitalHeld ? 'annexation' : taken.length ? 'cession' : 'tribute';
  endWar(state, war, outcome, { winner, loser, taken }, cause, cited);
}

/** A war ends (peace, or a party gone): occupation lifted, the terms carried out, both remember, events, armies stand down. */
export function endWar(state: SimulationState, war: War, outcome: WarOutcome, sides: { winner: Polity; loser: Polity; taken: number[] } | null, cause: string, cited: ChronicleEvent['causes'] = []) {
  const tuning = WAR_TUNING, attacker = state.polities[war.attacker], defender = state.polities[war.defender];
  for (const entry of war.occupied) if (state.occupiedBy[entry.region] === entry.by) state.occupiedBy[entry.region] = -1;
  war.occupied = [];
  war.endTick = state.tick; war.outcome = outcome;
  for (const [side, polity] of [attacker, defender].entries()) {
    polity.wars = polity.wars.filter(id => id !== war.id);
    // Its exhaustion lingers as war-weariness, which weighs against the next war.
    polity.weariness = { value: Math.max(wearinessOf(polity, state.tick), war.exhaustion[side]), tick: state.tick };
  }
  state.metrics.warsEnded[outcome]++;
  // Its length, in years (in months when under one), and its dead.
  const months = state.tick - war.startTick, years = Math.round(months / 12), dead = war.deaths[0] + war.deaths[1];
  const length = { years, months, long: years >= 1, short: years < 1 };
  // Claims weighing almost nothing are forgotten.
  for (const polity of [attacker, defender]) polity.claims = polity.claims.filter(claim => claimWeight(claim.tick, state.tick) >= tuning.claimFloor);
  if (!sides) {
    // A side gone: the war ends with it, and the other stands down.
    state.chronicle.emit({
      type: 'peaceSigned', actors: [{ id: attacker.id, role: 'a' }, { id: defender.id, role: 'b' }], region: null, importance: 0.15, causes: [{ factor: cause, weight: 1 }],
      data: { name: war.name, warId: war.id, attacker: attacker.name, defender: defender.name, ...length, attackerDead: war.deaths[0], defenderDead: war.deaths[1], gone: true, dead },
    });
    for (const polity of [attacker, defender]) if (polity.deathTick === null) setArmy(state, polity);
    return;
  }
  const { winner, loser, taken } = sides;
  let ceded = 0, tribute = 0;
  if (outcome === 'tribute' || outcome === 'cession') {
    // Tribute: a share of the loser's revenue a year (at customary taxes), for some years (VISION.md "tribute in wealth").
    tribute = Math.round(tuning.tributeShare * budgetView(state, loser).revenue);
    if (tribute > 0) war.tribute = { payer: loser.id, payee: winner.id, amount: tribute, until: state.tick + tuning.tributeYears * 12, carry: 0, paid: 0 };
  }
  if (outcome === 'cession') for (const region of taken) { cede(state, region, loser, winner, war); ceded++; }
  if (outcome === 'annexation') ceded = annex(state, loser, winner, war);
  if (ceded > 0) { remember(state, loser, winner.id, 'lostLand'); state.metrics.regionsConquered += ceded; }
  state.chronicle.emit({
    type: 'peaceSigned', actors: [{ id: attacker.id, role: 'a' }, { id: defender.id, role: 'b' }], region: null, importance: outcome === 'white' ? 0.2 : 0.35,
    causes: [{ factor: cause, weight: 1 }, ...cited].slice(0, 4),
    data: {
      name: war.name, warId: war.id, attacker: attacker.name, defender: defender.name, winner: winner.name, loser: loser.name, ...length, attackerDead: war.deaths[0], defenderDead: war.deaths[1],
      [outcome]: true, regions: ceded, perYear: tribute, tributeYears: tuning.tributeYears, paysTribute: tribute > 0 && outcome === 'cession', dead,
    },
  });
  for (const polity of [winner, loser]) if (polity.deathTick === null) { assess(state, polity); setArmy(state, polity); }
}

/** A region passes from a loser to a winner (a peace's cession): its people, settlements and what stands there; buildings
 *  the loser had under way there are abandoned (a wonder under way passes with its city, and the winner builds on); the
 *  loser claims it, and a winner that regains its own drops its claim. */
function cede(state: SimulationState, region: number, from: Polity, to: Polity, war: War) {
  const group = state.groups[state.groupAt[region]];
  from.groups.splice(from.groups.indexOf(group.id), 1);
  to.groups.push(group.id); group.polity = to.id;
  state.occupant[region] = to.id; state.owner[region] = to.id; state.occupiedBy[region] = -1;
  const before = from.projects.length;
  from.projects = from.projects.filter(project => state.settlements[project.settlement].region !== region);
  state.metrics.projectsAbandoned += before - from.projects.length;
  for (const settlement of livingSettlements(state, region)) {
    settlement.owner = to.id; setCapital(settlement, false);
    // Its new owner mends what it took over worn.
    if (settlement.buildings.some(building => building.condition < 1)) to.repairing = true;
  }
  for (const wonder of state.wonders) if (wonder.status === 'standing' && state.settlements[wonder.settlement].region === region && wonder.condition < 1) to.repairing = true;
  group.specialists = house(state, region, group.specialists, false);
  arrive(state, to, region, state.tick);
  lookAgain(from); lookAgain(to);
  from.claims.push({ region, tick: state.tick });
  to.claims = to.claims.filter(claim => claim.region !== region);
  war.ceded.push(region);
  const place = livingSettlements(state, region)[0]?.name ?? `region ${region}`;
  state.chronicle.emit({
    type: 'regionConquered', actors: [{ id: to.id, role: 'attacker' }, { id: from.id, role: 'defender' }], region, importance: 0.2, causes: [{ factor: 'peaceTerms', weight: 1 }],
    data: { place, war: war.name, warId: war.id, civ: to.name, from: from.name, population: group.size },
  });
  rehome(state, from);
}

/** A small loser's whole realm joins the winner (annexation): as a union, but by force; its treasury is the winner's spoils. */
function annex(state: SimulationState, loser: Polity, winner: Polity, war: War) {
  const regions = loser.groups.length, people = peopleOf(state, loser), capital = loser.capital !== null ? state.settlements[loser.capital] : null;
  absorbMap(state, winner, loser, state.tick);
  for (const id of loser.groups.slice()) {
    const group = state.groups[id], region = group.region;
    loser.groups.splice(loser.groups.indexOf(id), 1);
    winner.groups.push(id); group.polity = winner.id;
    state.occupant[region] = winner.id; state.owner[region] = winner.id; state.occupiedBy[region] = -1;
    for (const settlement of livingSettlements(state, region)) { settlement.owner = winner.id; setCapital(settlement, false); }
    group.specialists = house(state, region, group.specialists, false);
    arrive(state, winner, region, state.tick);
    war.ceded.push(region);
  }
  learnFrom(state, winner, loser, state.tick);
  transferWealth(state, loser, winner);
  winner.repairing ||= loser.repairing;
  state.metrics.projectsAbandoned += loser.projects.length; loser.projects = [];
  winner.roadWorks.push(...loser.roadWorks.filter(work => work.agreement === undefined)); loser.roadWorks = [];
  lookAgain(loser);
  endPolity(state, loser, state.tick);
  state.metrics.annexations++;
  state.chronicle.emit({
    type: 'civDestroyed', actors: [{ id: loser.id, role: 'civ' }, { id: winner.id, role: 'by' }], region: capital?.region ?? null, settlement: capital?.id ?? null,
    causes: [{ factor: 'annexed', weight: 1 }], importance: 0.5, data: { name: loser.name, capital: capital?.name ?? '?', annexed: true, by: winner.name, war: war.name, warId: war.id, population: people, regions },
  });
  return regions;
}

/**
 * Seeking peace (the decision step): the other side accepts when it is tired enough (acceptExhaustion), or when the
 * terms the score gives are a white peace or in its favour; then peace is made on them.
 */
export function seekPeace(state: SimulationState, polity: Polity, war: War, cited: ChronicleEvent['causes']): string {
  if (war.endTick !== null) return 'the war is over';
  const side = sideOf(war, polity.id), other = state.polities[side === 0 ? war.defender : war.attacker];
  if (other.deathTick !== null || polity.deathTick !== null) { endWar(state, war, 'gone', null, 'partyGone'); return `the ${other.name} are no more`; }
  const theirLead = side === 0 ? -war.score : war.score;
  const accepts = war.exhaustion[1 - side] >= WAR_TUNING.acceptExhaustion || theirLead >= 0 || Math.abs(war.score) < WAR_TUNING.terms.white;
  if (!accepts) return `the ${other.name} fight on`;
  makePeace(state, war, 'soughtPeace', cited);
  return `made peace with the ${other.name}`;
}
