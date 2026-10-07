import assert from 'node:assert/strict';
import { test } from 'node:test';
import { encodeGeneratedWorld } from '../src/world/generation/encode.ts';
import { generateWorld } from '../src/world/generation/generate.ts';
import { farmingPotential } from '../src/simulation/food.ts';
import { decodeGeography } from '../src/simulation/geography.ts';
import { checkInvariants, InvariantError } from '../src/simulation/invariants.ts';
import { catchUp, learn, shareSpeed } from '../src/simulation/knowledge.ts';
import { partitionRegions } from '../src/simulation/regions.ts';
import { createSimulation, stepSimulation, worldPopulation } from '../src/simulation/simulation.ts';
import { ERAS, TECH_INDEX, TECHS } from '../src/simulation/techs.ts';
import { admission, expand, unite } from '../src/simulation/expansion.ts';
import { budgetView, decisionView } from '../src/simulation/perception.ts';
import { assess } from '../src/simulation/stability.ts';
import { edgeKm } from '../src/simulation/perception.ts';
import { BUDGET_TUNING, STABILITY_TUNING, UNITE_TUNING } from '../src/simulation/tunables.ts';
import { refreshRemoteness } from '../src/simulation/budget.ts';
import { wealthFlows } from '../src/simulation/economy.ts';
import { createRng, type Rng } from '../src/simulation/rng.ts';
import { polityPopulation, refuge, removeGroup, settle } from '../src/simulation/bands.ts';
import { edgeBetween, roadKey, roadUpkeep } from '../src/simulation/roads.ts';
import { WONDERS } from '../src/simulation/wonders.ts';
import { fieldLand } from '../src/simulation/fields.ts';

async function chronicleWorld() {
  const bundle = encodeGeneratedWorld(await generateWorld({ seed: 'Chronicle', size: 'large' }));
  const geography = decodeGeography(bundle.manifest, bundle.tiles);
  return { geography, partition: partitionRegions(geography) };
}

const AGRICULTURE = TECH_INDEX.get('Agriculture')!;

test('M2 acceptance on Chronicle: Agriculture on fertile river land by 600, a farming boom, settled villages and causes', async () => {
  const { geography, partition } = await chronicleWorld();
  const state = createSimulation(geography, partition, 'Chronicle');
  // Every tick runs the invariants, including the rule that no polity holds another landmass before Sailing.
  const population = [worldPopulation(state)];
  let taughtDiscoveries = 0;
  let exercised = false;
  while (state.tick < 12 * 900) {
    // Once civilizations and tribes live side by side, carry out expansions into tribes' land directly (between months,
    // so the next month's accounting starts from the result): a band the settlers could not replace is taken in, and
    // one with land to go to that will not join moves on and the settlers found a village.
    if (!exercised && state.tick >= 12 * 560) exercised = exerciseExpansion(state);
    // No automatic learning (VISION.md "Paths, not a timeline"): a tech is researched faster only when a people with an
    // exchange in force knows it, and otherwise only by the catch-up for its era. Each polity's progress on its target
    // this month must be its own research × exactly those speed-ups (polities due for their yearly reconsideration,
    // which may switch target or refresh the frontier, are skipped that month).
    const tick = state.tick;
    const before = new Map<number, { tech: number; progress: number; taught: number; caught: number; frontier: number; openness: number; partners: number[]; helped: boolean; all: Float64Array }>();
    for (const id of state.living) {
      const polity = state.polities[id], tech = polity.knowledge.target;
      const partners = [...polity.exchanges].filter(([other, until]) => until > tick && state.polities[other].deathTick === null).map(([other]) => other);
      before.set(id, {
        tech, progress: tech < 0 ? 0 : polity.knowledge.progress[tech], taught: tech < 0 ? 0 : polity.knowledge.taught[tech], caught: tech < 0 ? 0 : polity.knowledge.caught[tech],
        frontier: polity.frontierEra, openness: state.cultures[polity.culture].values.openness, partners,
        helped: tech >= 0 && partners.some(other => state.polities[other].knowledge.known[tech] === 1), all: polity.knowledge.taught.slice(),
      });
    }
    const from = state.chronicle.events.length;
    stepSimulation(state);
    const discovered = new Set<string>();
    for (const event of state.chronicle.events.slice(from)) if (event.type === 'techDiscovered') discovered.add(`${event.actors[0].id}:${event.data.tech}`);
    for (const [id, entry] of before) {
      const polity = state.polities[id], knowledge = polity.knowledge;
      // A partner may also know the tech by a tribe joining it earlier this month (merging, in the population system);
      // never by its own discovery this month.
      const helper = (tech: number) => entry.partners.some(other => state.polities[other].knowledge.known[tech] === 1 && !discovered.has(`${other}:${TECHS[tech].name}`));
      for (let tech = 0; tech < knowledge.taught.length; tech++) if (knowledge.taught[tech] > entry.all[tech]) assert.ok(helper(tech), `polity ${id} was helped with tech ${tech} in month ${tick} by no people sharing it`);
      // Frontier: never beyond what it knows of (eras only grow until M7, so the eras now bound those it saw).
      let known = knowledge.era;
      for (const [other] of polity.met) known = Math.max(known, state.polities[other].knowledge.era);
      assert.ok(polity.frontierEra <= known, `polity ${id}'s frontier era ${polity.frontierEra} is beyond any people it knows (${known})`);
      if (entry.tech < 0 || knowledge.target !== entry.tech || ((tick - id) % 12 + 12) % 12 === 0 || polity.deathTick !== null) continue;
      const tech = entry.tech, gained = knowledge.progress[tech] - entry.progress;
      if (!(gained > 0)) continue;
      const taught = knowledge.taught[tech] - entry.taught, caught = knowledge.caught[tech] - entry.caught, own = gained - taught - caught;
      const share = taught > 0 ? shareSpeed(entry.openness) : 1, era = catchUp(ERAS.indexOf(TECHS[tech].era), entry.frontier);
      if (taught > 0) assert.ok(entry.helped || helper(tech), `polity ${id} was helped with tech ${tech} by no people sharing it`);
      // (Floating-point error grows with the size of the accumulated progress, not with this month's gain.)
      const tolerance = 1e-9 * Math.max(gained, knowledge.progress[tech]);
      assert.ok(own > 0 && Math.abs(gained - own * share * era) <= tolerance && Math.abs(caught - own * (era - 1)) <= tolerance,
        `polity ${id}, month ${tick}: progress ${gained} from own research ${own} is not ×${share} sharing × ${era} catch-up`);
    }
    for (const event of state.chronicle.events.slice(from)) {
      // Peoples that become one keep what either knew.
      if (event.type === 'bandJoined' || event.type === 'unification' || event.type === 'bandAbsorbed') {
        const ended = state.polities[event.actors[0].id], into = state.polities[event.actors[1].id];
        assert.ok(ended.knowledge.known.every((known, tech) => !known || into.knowledge.known[tech] === 1), `the ${into.name} learned what the ${ended.name} knew`);
      }
      if (event.type !== 'techDiscovered') continue;
      const helped = event.causes.find(cause => cause.factor === 'sharedKnowledge'), teacher = event.actors.find(actor => actor.role === 'teacher');
      // A discovery helped by a partner names it when the exchange still runs; one never helped names none.
      if (teacher) { assert.ok(helped && event.data.taught === true); assert.ok(state.polities[event.actors[0].id].exchanges.has(teacher.id)); taughtDiscoveries++; }
      if (!helped) assert.ok(!teacher && event.data.taught === false);
    }
    if (state.tick % 12 === 0) population.push(worldPopulation(state));
  }
  // Sharing is chosen, not automatic, so it is rare; but it happens, every exchange is an event with its causes, and
  // some discoveries are helped by it.
  assert.ok(taughtDiscoveries > 0, `${taughtDiscoveries} discoveries helped by a sharing partner`);
  const exchanges = state.chronicle.events.filter(event => event.type === 'knowledgeShared');
  assert.ok(exchanges.length > 0 && exchanges.length === state.metrics.exchanges && exchanges.length <= state.metrics.exchangeOffers, `${exchanges.length} exchanges`);
  assert.ok(exchanges.every(event => event.causes.length > 0 && state.polities[event.actors[0].id].kind === 'civ'), 'a civilization offered each exchange, for reasons');
  const first = state.firsts.find(entry => entry.tech === AGRICULTURE);
  assert.ok(first, 'Agriculture is discovered');
  assert.ok(first.tick <= 600 * 12, `Agriculture by year 600 (year ${first.tick / 12})`);
  const region = partition.regions[first.region];
  const potentials = partition.regions.map(entry => farmingPotential(state.food, entry.id)).sort((a, b) => a - b);
  assert.ok(farmingPotential(state.food, region.id) >= potentials[Math.floor(potentials.length * 0.75)], 'first in a top-quartile farming region');
  assert.ok(region.riverTier >= 2 || region.openLake, 'by a river or with open-lake access');
  // Growth after a quarter of the world's people live in polities that know Agriculture is at least 3× the growth before
  // (VISION.md M2, changed after the M3 review: it counted polities, which are mostly forager tribes once peoples
  // follow their own paths).
  const quarter = Math.floor(state.agricultureQuarterYear);
  assert.ok(quarter > 0 && quarter + 300 <= 900, `a quarter of the world's people know Agriculture in year ${quarter}`);
  const rate = (from: number, to: number) => (population[to] / population[from]) ** (1 / (to - from)) - 1;
  const before = rate(Math.max(0, quarter - 300), quarter), after = rate(quarter, quarter + 300);
  const grows = before <= 0 ? after >= 0.001 : after > 0 && after >= 3 * before;
  assert.ok(grows, `growth ${(before * 100).toFixed(2)}%/yr before, ${(after * 100).toFixed(2)}%/yr after`);
  // M1's rules still hold through the farming era.
  assert.equal(state.metrics.silentBandYears, 0, 'every band of 50 or more has births and deaths every year');
  assert.ok(state.metrics.maxOverCapacityMonths <= 24, `no region above 1.1× capacity for more than 24 months (${state.metrics.maxOverCapacityMonths})`);
  // Farmers settled into civilizations with village capitals; discoveries record why.
  // (Since peoples follow their own paths, many small forager tribes remain that never farmed; it is the farmers who
  // settle, and they hold almost everyone.)
  const civs = state.living.filter(id => state.polities[id].kind === 'civ');
  const farming = state.living.filter(id => state.polities[id].knowledge.methods.farm || state.polities[id].knowledge.methods.herd);
  const settledFarmers = farming.filter(id => state.polities[id].kind === 'civ').length;
  assert.ok(settledFarmers * 2 > farming.length, `${settledFarmers} of ${farming.length} farming or herding polities settled`);
  const inCivs = civs.reduce((sum, id) => sum + polityPopulation(state, state.polities[id]), 0);
  assert.ok(inCivs * 2 > worldPopulation(state), `${inCivs} of ${worldPopulation(state)} people live in civilizations`);
  for (const id of civs) assert.equal(state.settlements[state.polities[id].capital!].owner, id);
  const discoveries = state.chronicle.events.filter(event => event.type === 'techDiscovered');
  assert.equal(discoveries.length, state.metrics.discoveries);
  // Every discovery says how it was reached; the first Agriculture also says why it was chosen there.
  // How it was reached: shares of its progress from its own research, a sharing partner's help and catching up.
  for (const event of discoveries) {
    const share = (factor: string) => event.causes.find(cause => cause.factor === factor)?.weight ?? 0;
    assert.ok(share('ownResearch') > 0 && Math.abs(share('ownResearch') + share('sharedKnowledge') + share('catchUp') - 1) < 0.005, JSON.stringify(event.causes));
  }
  // Peoples follow their own paths: Agriculture is invented, with no sharing partner's help, in several places over
  // centuries (VISION.md M3, added after the M3 review).
  const inventions = discoveries.filter(event => event.data.tech === 'Agriculture' && !event.causes.some(cause => cause.factor === 'sharedKnowledge'));
  assert.equal(inventions.length, state.metrics.agricultureInventions);
  assert.ok(inventions.length >= 3 && inventions.at(-1)!.tick - inventions[0].tick >= 200 * 12, `Agriculture invented ${inventions.length} times, in years ${inventions.map(event => Math.round(event.tick / 12)).join(', ')}`);
  const invention = discoveries.find(event => event.data.tech === 'Agriculture' && event.data.first === true)!;
  // The record of firsts and the event name the same place: where the inventors live on the land that drew them to it.
  assert.equal(invention.region, first.region);
  assert.ok(state.affinity[first.region].has('fertileRiver') || state.affinity[first.region].has('riverOrLake') || state.affinity[first.region].has('grainSite'));
  assert.ok(invention.causes.some(cause => cause.factor === 'fertileRiver'), `the first Agriculture cites fertile river land: ${JSON.stringify(invention.causes)}`);
  const settled = state.chronicle.events.filter(event => event.type === 'settled');
  assert.equal(settled.length, state.metrics.settled);
  const farmingSettlers = settled.filter(event => event.causes.some(cause => cause.factor === 'farming' && cause.weight >= 0.05)).length;
  assert.ok(farmingSettlers * 2 > settled.length, `most settlers already live mostly by farming or herding (${farmingSettlers} of ${settled.length})`);
  // Specialists work in settlements only.
  assert.ok(state.living.every(id => state.polities[id].kind === 'civ' || state.polities[id].groups.every(group => state.groups[group].specialists === 0)));
  assert.ok(civs.some(id => state.polities[id].groups.some(group => state.groups[group].specialists > 0)), 'surplus frees specialists');
  assert.ok(exercised, 'a civilization next to a tribe was found to exercise expansion');
  // Tribes join civilizations as they settle (M3.3): each join is an event with its causes, and the tribe ends.
  const joins = state.chronicle.events.filter(event => event.type === 'bandJoined');
  assert.ok(joins.length > 0 && joins.length === state.metrics.joined, `${joins.length} tribes joined`);
  assert.ok(joins.every(event => event.causes.length > 0 && state.polities[event.actors[0].id].deathTick !== null));
  // Civilizations unite with larger neighbours (M3.4): each union is an event with its causes, always into a larger one.
  const unions = state.chronicle.events.filter(event => event.type === 'unification');
  assert.ok(unions.length > 0 && unions.length === state.metrics.unions, `${unions.length} unions`);
  assert.ok(unions.every(event => event.causes.length > 0 && (event.data.into as number) > (event.data.regions as number)), 'every union cites causes and goes into a larger civilization');
  assert.ok(unions.every(event => state.polities[event.actors[0].id].deathTick !== null));
  const unrest = state.chronicle.events.filter(event => event.type === 'unrest');
  assert.equal(unrest.length, state.metrics.unrestOutbreaks);
  // Civilizations decide every six months (M3): each step is logged; expanding takes in tribes' bands or sends settlers,
  // and every such change is an event with its causes.
  const m = state.metrics;
  assert.ok(m.chosen.expand > 0 && m.chosen.nothing > 0, JSON.stringify(m.chosen));
  for (const [type, count] of [['expansion', m.expansions], ['bandAbsorbed', m.absorbed], ['expedition', m.expeditions]] as const) {
    const events = state.chronicle.events.filter(event => event.type === type);
    assert.equal(events.length, count, `${type} events`);
    assert.ok(events.every(event => event.causes.length > 0), `${type} events cite causes`);
  }
  assert.ok(m.absorbed > 0, 'expanding civilizations take in tribes\' bands');
  // Civilizations remember land beyond their sight, from their own travels and from their neighbours (M3).
  assert.ok(civs.filter(id => state.polities[id].map.snapshots.size > 0).length * 2 > civs.length, 'most civilizations know land they cannot see');
  // Whole tribes settled: civilizations of many regions, a settlement in each (the invariants check at least one living
  // settlement per region they hold and the capital in the heartland every month).
  assert.ok(settled.some(event => (event.data.regions as number) >= 10), 'tribes of ten or more regions settled as one');
  assert.ok(civs.some(id => state.polities[id].groups.length >= 10));
  // A civilization that loses its capital village moves the capital to its new heartland; one that loses every village
  // in the same month ends at once, without moving its capital on the way.
  const civ = state.polities[civs.find(id => state.polities[id].groups.length >= 5)!];
  const dying = (groupId: number) => Object.assign(state.groups[groupId], { size: 1, famineCarry: 0.999, naturalCarry: 0.999, birthCarry: 0, foodSecurity: 0 });
  const oldCapital = state.settlements[civ.capital!], oldCore = civ.core;
  dying(oldCore);
  let from = state.chronicle.events.length;
  stepSimulation(state);
  const moved = state.chronicle.events.slice(from).filter(event => event.type === 'capitalMoved' && event.actors[0].id === civ.id);
  assert.equal(moved.length, 1, 'the capital moved once');
  // Its old capital fell to ruin; expansion may resettle the ruins the same month, as an ordinary village.
  assert.ok(oldCapital.status === 'ruined' || (!oldCapital.capital && state.chronicle.events.slice(from).some(event => event.type === 'ruinsResettled' && event.settlement === oldCapital.id)),
    `the old capital is in ruins or resettled: ${oldCapital.status}, owner ${oldCapital.owner}, capital ${oldCapital.capital}`);
  assert.ok(civ.core !== oldCore && state.settlements[civ.capital!].region === state.groups[civ.core].region, 'the new capital is in the new heartland');
  const villages = civ.groups.length;
  for (const groupId of civ.groups) dying(groupId);
  from = state.chronicle.events.length;
  stepSimulation(state);
  const ending = state.chronicle.events.slice(from).filter(event => event.actors[0]?.id === civ.id);
  assert.notEqual(civ.deathTick, null);
  assert.deepEqual(ending.map(event => event.type), ['civDestroyed'], `all ${villages} villages died in one month: one event`);
  assert.ok(state.settlements.every(settlement => settlement.owner !== civ.id || settlement.status === 'ruined'));
  // Unions and stability, carried out directly on the same world (after the counts above, which they would change).
  exerciseUnion(state);
  exerciseStability(state);
});

test('a polity on another landmass without Sailing (rail is not Sailing), a civilization without its village, or unexplained crops break the invariants', async () => {
  const { geography, partition } = await chronicleWorld();
  const tamper = (change: (state: ReturnType<typeof createSimulation>) => void, pattern: RegExp) => {
    const state = createSimulation(geography, partition, 'Landmass');
    for (let month = 0; month < 24; month++) stepSimulation(state);
    change(state);
    assert.throws(() => checkInvariants(state), (error: Error) => error instanceof InvariantError && pattern.test(error.message));
  };
  // Carry a tribe's heartland band to a free region of another landmass, with the ledger balanced, as a sea crossing would.
  const carry = (state: ReturnType<typeof createSimulation>, band: ReturnType<typeof createSimulation>['polities'][number]) => {
    const group = state.groups[band.core], from = group.region;
    const target = partition.regions.find(region => region.landmass !== band.homeLandmass && state.occupant[region.id] < 0)!;
    state.ledger.migrantsOut[from] += group.size; state.ledger.migrantsIn[target.id] += group.size;
    state.occupant[from] = -1; state.groupAt[from] = -1; state.occupant[target.id] = band.id; state.groupAt[target.id] = group.id;
    group.region = target.id;
  };
  tamper(state => carry(state, state.polities[state.living[0]]), /without Sailing/);
  tamper(state => {
    // Rail or flight is not Sailing: a polity that knows Railways but not Sailing is still bound to its landmass.
    const band = state.polities[state.living[2]];
    band.knowledge = learn(band.knowledge, TECH_INDEX.get('Railways')!);
    carry(state, band);
  }, /without Sailing/);
  tamper(state => {
    const band = state.polities[state.living[1]];
    band.kind = 'civ'; for (const group of band.groups) state.owner[state.groups[group].region] = band.id;
  }, /has no village there/);
  tamper(state => { state.groups[state.polities[state.living[3]].core].planted += 100; }, /crops in the field/);
  // M4.1: a polity's ruling culture is its heartland people's; a people lives by a living culture, with values in 0–1.
  tamper(state => { const band = state.polities[state.living[3]]; band.culture = state.polities[state.living[4]].culture; }, /ruling culture/);
  tamper(state => { const band = state.polities[state.living[3]]; state.cultures[band.culture].deathTick = state.tick; }, /which is gone/);
  tamper(state => { state.groups[state.polities[state.living[3]].core].values.zeal = 1.2; }, /has zeal 1.2/);
  // M4.3: a polity's state religion is its heartland's faith, and a people follows a living religion or the folk ways.
  tamper(state => { state.polities[state.living[3]].stateReligion = 0; }, /state religion/);
  tamper(state => { state.groups[state.polities[state.living[3]].core].faith = 7; state.polities[state.living[3]].stateReligion = 7; }, /follows religion 7, which is gone/);
  // A civilization's townspeople must all live in its settlements there, within their housing.
  tamper(state => {
    const band = state.polities[state.living[4]];
    settle(state, { tick: state.tick, stream: (entity?: number, salt?: number) => createRng(entity ?? 0, salt ?? 0) }, band, { farming: 1, yearsHere: 1 });
    state.groups[band.core].specialists += 3;
  }, /townspeople, not its/);
  // A treasury changes only through recorded flows.
  tamper(state => {
    const band = state.polities[state.living[5]];
    settle(state, { tick: state.tick, stream: (entity?: number, salt?: number) => createRng(entity ?? 0, salt ?? 0) }, band, { farming: 1, yearsHere: 1 });
    band.wealth += 5;
  }, /treasury changed with no flows recorded/);
  // M3c.2: taxes stay within what a realm may take, every region a civilization holds is measured from its capital,
  // and what it pays to run the realm is a flow like any other.
  const settled = (state: ReturnType<typeof createSimulation>, at: number) => {
    const band = state.polities[state.living[at]];
    settle(state, { tick: state.tick, stream: (entity?: number, salt?: number) => createRng(entity ?? 0, salt ?? 0) }, band, { farming: 1, yearsHere: 1 });
    return band;
  };
  tamper(state => { const civ = settled(state, 6); refreshRemoteness(state, civ, () => 0); civ.taxRate = BUDGET_TUNING.maxRate + 0.1; }, /taxes at/);
  tamper(state => { settled(state, 6); }, /remoteness .* was measured for -1/);
  tamper(state => {
    const civ = settled(state, 7);
    refreshRemoteness(state, civ, () => 0);
    civ.wealth = 100;
    const flows = wealthFlows(state, civ);
    civ.wealth -= 10; flows.administration += 5; flows.services += 3;
  }, /treasury 90 is not explained by its flows/);
  // Famine relief paid for carriage is a flow too (M3c.3).
  tamper(state => {
    const civ = settled(state, 8);
    refreshRemoteness(state, civ, () => 0);
    civ.wealth = 100;
    wealthFlows(state, civ).relief += 7;
  }, /treasury 100 is not explained by its flows/);
  // Knowledge: an exchange held by one side only, an exchange between two tribes, research on a known tech, or more
  // progress from speed-ups than in all. (Knowledge is checked yearly per polity, staggered by id; these tamper with
  // a polity due this month.)
  const due = (state: ReturnType<typeof createSimulation>) => state.polities[state.living.find(id => (state.tick + id) % 12 === 0)!];
  // (Early on every polity is a tribe: an exchange between two of them breaks the rule even when both sides hold it.)
  const tribeExchange = (state: ReturnType<typeof createSimulation>, oneSided: boolean) => {
    const polity = due(state), other = state.polities[state.living.find(id => id !== polity.id)!];
    polity.met.set(other.id, 0); other.met.set(polity.id, 0);
    polity.exchanges.set(other.id, state.tick + 120);
    if (!oneSided) other.exchanges.set(polity.id, state.tick + 120);
  };
  tamper(state => tribeExchange(state, true), /not the other way round/);
  tamper(state => tribeExchange(state, false), /only civilizations offer it/);
  tamper(state => { const knowledge = due(state).knowledge; knowledge.progress[TECH_INDEX.get('Fire')!] = 5; }, /which it knows/);
  tamper(state => { const knowledge = due(state).knowledge, pottery = TECH_INDEX.get('Pottery')!; knowledge.progress[pottery] = 10; knowledge.taught[pottery] = 8; knowledge.caught[pottery] = 4; }, /less than its speed-ups gave/);
  // Roads lie on land edges, bridge only rivers and only on a tier that bridges them, and owe what they cost to keep.
  type State = ReturnType<typeof createSimulation>;
  const lay = (state: State, a: number, b: number, tier: number, bridge: boolean, upkeep?: number) => {
    const edge = edgeBetween(state, a, b);
    state.roads.set(roadKey(state.partition.regions.length, a, b), { a: Math.min(a, b), b: Math.max(a, b), tier, bridge, condition: 1, builder: 0, builtTick: 0, upkeep: upkeep ?? (edge ? roadUpkeep(tier, edge, bridge) : 0) });
  };
  const edgeWhere = (state: State, river: boolean) => {
    for (const region of state.partition.regions) for (const edge of region.neighbors) if (edge.region > region.id && (edge.riverTier >= 1) === river) return { a: region.id, b: edge.region };
    throw new Error('no such edge');
  };
  tamper(state => { const far = state.partition.regions.find(region => region.id > 0 && !state.partition.regions[0].neighbors.some(edge => edge.region === region.id))!; lay(state, 0, far.id, 1, false); }, /does not lie on a land edge/);
  tamper(state => { const { a, b } = edgeWhere(state, false); lay(state, a, b, 2, true); }, /has a bridge with no river or on a/);
  tamper(state => { const { a, b } = edgeWhere(state, true); lay(state, a, b, 1, true); }, /has a bridge with no river or on a road/);
  tamper(state => { const { a, b } = edgeWhere(state, false); lay(state, a, b, 1, false, 1); }, /upkeep 1 is not what it costs/);
  // A wonder is unique in the world while it stands or is being built.
  tamper(state => {
    const band = state.polities[state.living[6]];
    settle(state, { tick: state.tick, stream: (entity?: number, salt?: number) => createRng(entity ?? 0, salt ?? 0) }, band, { farming: 1, yearsHere: 1 });
    for (let copy = 0; copy < 2; copy++) state.wonders.push({ id: copy, type: 0, settlement: band.capital!, builder: band.id, begunTick: state.tick, builtTick: null, status: 'building', spent: 0, cost: WONDERS[0].cost, condition: 1, endedTick: null, endCause: null, causes: [], waited: 0 });
  }, /two of wonder type 0/);
  // A road work's edges lie on its way; unpaid road upkeep is a share; an ended wonder keeps its cause.
  const civilization = (state: State, at: number) => {
    const band = state.polities[state.living[at]];
    settle(state, { tick: state.tick, stream: (entity?: number, salt?: number) => createRng(entity ?? 0, salt ?? 0) }, band, { farming: 1, yearsHere: 1 });
    return band;
  };
  tamper(state => {
    const civ = civilization(state, 7), { a, b } = edgeWhere(state, false);
    civ.roadWorks.push({ from: civ.capital!, to: civ.capital!, path: [a, b], tier: 1, edges: [[a, b + 1]], bridges: 0, spent: 0, cost: 10, months: 2, startedTick: state.tick, causes: [] });
  }, /whose edges are not on its path/);
  tamper(state => { civilization(state, 8).roadsUnpaid = 2; }, /left 2 of its road upkeep unpaid/);
  tamper(state => {
    const civ = civilization(state, 9);
    state.wonders.push({ id: 0, type: 0, settlement: civ.capital!, builder: civ.id, begunTick: state.tick, builtTick: null, status: 'abandoned', spent: 0, cost: WONDERS[0].cost, condition: 1, endedTick: state.tick, endCause: null, causes: [], waited: 0 });
  }, /ended without a date or cause/);
  // Cultivated land lies within the region's farmland.
  tamper(state => { const region = state.partition.regions.find(entry => fieldLand(state.fieldRanking, entry.id) > 0)!; state.fields[region.id] = fieldLand(state.fieldRanking, region.id) + 1; }, /fields on .* of farmland/);
  // A harvest gains or loses to the weather only within what weather and drought allow.
  tamper(state => { const flows = state.ledger.food.get(state.groups[state.polities[state.living[10]].core].id)!; flows.harvested += 100; flows.plantedBefore += 100; flows.weather = 60; flows.production += 60; state.groups[state.polities[state.living[10]].core].store += 60; }, /not what that share gives/);
});

/** A stand-in for a random stream whose chances always fail (the band never agrees to join). */
const refusing: Rng = { next: () => 0.999, int: () => 0, chance: () => false, weighted: weights => weights.findIndex(weight => weight > 0) };

/** Expand into tribes' land next to a civilization both ways; false while no such pair exists yet. */
function exerciseExpansion(state: ReturnType<typeof createSimulation>) {
  const pairs: { civ: number; from: number; target: number }[] = [];
  for (const id of state.living) {
    const civ = state.polities[id];
    if (civ.kind !== 'civ') continue;
    for (const groupId of civ.groups) {
      const from = state.groups[groupId].region;
      for (const edge of state.partition.regions[from].neighbors) {
        const other = state.occupant[edge.region];
        if (other >= 0 && state.polities[other].kind === 'band') pairs.push({ civ: id, from, target: edge.region });
      }
    }
  }
  const tribeAt = (region: number) => state.polities[state.occupant[region]];
  const movable = (pair: typeof pairs[number]) => refuge(state, tribeAt(pair.target), state.groups[state.groupAt[pair.target]], pair.target) >= 0 && state.groups[state.groupAt[pair.from]].size > 1000;
  let replaceable = pairs.find(movable);
  // The land is usually full by the time civilizations arise, so a band beside one rarely has land to go to: make some.
  // Between months, a band of another tribe beside it (not that tribe's heartland) dies out, leaving its region free.
  if (!replaceable && pairs.length > 1) {
    for (const pair of pairs) {
      if (state.groups[state.groupAt[pair.from]].size <= 1000) continue;
      const tribe = tribeAt(pair.target);
      const beside = state.partition.regions[pair.target].neighbors.map(edge => edge.region).find(region => {
        const other = state.occupant[region];
        return region !== pair.from && other >= 0 && other !== tribe.id && state.polities[other].kind === 'band' && state.polities[other].core !== state.groupAt[region] && state.habitable[region] === 1;
      });
      if (beside === undefined) continue;
      removeGroup(state, state.polities[state.occupant[beside]], state.groups[state.groupAt[beside]], state.tick);
      if (movable(pair)) { replaceable = pair; break; }
    }
  }
  const blocked = pairs.find(pair => pair !== replaceable && pair.target !== replaceable?.target && state.occupant[pair.target] >= 0 && state.polities[state.occupant[pair.target]].kind === 'band');
  if (!replaceable || !blocked) return false;
  // Settlers cannot come (too few people to spare): the band is taken in, not driven out for nothing.
  const source = state.groups[state.groupAt[blocked.from]], kept = source.size;
  source.size = 30;
  const displaced = state.metrics.displaced, band = state.groupAt[blocked.target];
  assert.equal(expand(state, { tick: state.tick }, refusing, state.polities[blocked.civ], blocked.target, blocked.from, [{ factor: 'test', weight: 1 }]), 'took in a band');
  assert.equal(state.metrics.displaced, displaced);
  assert.equal(state.owner[blocked.target], blocked.civ); assert.equal(state.groups[band].polity, blocked.civ);
  source.size = kept;
  // The band will not join and has land to go to: it moves on, and settlers found a village.
  const tribe = tribeAt(replaceable.target), moving = state.groupAt[replaceable.target];
  assert.equal(expand(state, { tick: state.tick }, refusing, state.polities[replaceable.civ], replaceable.target, replaceable.from, [{ factor: 'test', weight: 1 }]), 'expanded');
  assert.equal(state.metrics.displaced, displaced + 1);
  assert.equal(state.groups[moving].polity, tribe.id, 'the band is still its tribe\'s');
  assert.notEqual(state.groups[moving].region, replaceable.target);
  assert.equal(state.owner[replaceable.target], replaceable.civ);
  // One settlement of the civilization now stands there: newly founded, or the region's ruins resettled.
  const living = state.regionSettlements[replaceable.target].map(id => state.settlements[id]).filter(settlement => settlement.status === 'alive');
  assert.ok(living.length === 1 && living[0].owner === replaceable.civ);
  return true;
}

/** A stand-in stream whose chances always succeed. */
const accepting: Rng = { next: () => 0, int: () => 0, chance: () => true, weighted: weights => weights.findIndex(weight => weight > 0) };

/**
 * A civilization's view of its neighbours, and a union carried out directly: refused (and remembered), then accepted,
 * with every region, its village and the capital flag passing over and the regions judged under their new rule.
 */
function exerciseUnion(state: ReturnType<typeof createSimulation>) {
  const civs = state.living.filter(id => state.polities[id].kind === 'civ');
  let pair: { small: number; large: number } | null = null;
  for (const id of civs) {
    const view = decisionView(state, state.polities[id]);
    for (const neighbour of view.neighbours) {
      // Neighbours are civilizations it has met whose land touches its own; the crossing is the median of the edges they share.
      assert.ok(state.polities[id].met.has(neighbour.civ));
      const shared: number[] = [];
      for (const groupId of state.polities[id].groups) for (const edge of state.partition.regions[state.groups[groupId].region].neighbors) if (state.owner[edge.region] === neighbour.civ) shared.push(edgeKm(edge.travelKm, edge.riverTier));
      shared.sort((a, b) => a - b);
      assert.ok(shared.length > 0 && neighbour.crossingKm === shared[Math.floor(shared.length / 2)], 'the median crossing between their lands');
      assert.ok(neighbour.knownRegions >= 1);
      if (!pair && state.polities[neighbour.civ].groups.length > state.polities[id].groups.length) pair = { small: id, large: neighbour.civ };
    }
  }
  assert.ok(pair, 'two neighbouring civilizations of different sizes');
  const small = state.polities[pair.small], large = state.polities[pair.large];
  const refused = unite(state, state.tick, refusing, small, large, small.groups.length ? state.groups[small.groups[0]].region : 0, [{ factor: 'test', weight: 1 }]);
  assert.match(refused, /would not take them in/);
  assert.equal(small.deathTick, null);
  assert.ok(!decisionView(state, small).neighbours.some(entry => entry.civ === large.id), 'it does not ask the same civilization again for a while');
  const regions = small.groups.map(id => state.groups[id].region), before = large.groups.length;
  // Its treasury, its works under way and its worn buildings pass to the union, recorded as wealth given and received.
  const treasury = small.wealth + large.wealth, works = small.projects.length + large.projects.length, passed = small.wealth;
  const given = state.ledger.wealth.get(small.id)?.given ?? 0, received = state.ledger.wealth.get(large.id)?.received ?? 0;
  small.repairing = true;
  // A road under way passes too (its target and way are the union's land now).
  small.roadWorks.push({ from: small.capital!, to: small.capital!, path: regions.slice(0, 1).concat(regions.slice(0, 1)), tier: 1, edges: [], bridges: 0, spent: 0, cost: 1, months: 1, startedTick: state.tick, causes: [] });
  const roads = small.roadWorks.length + large.roadWorks.length;
  // M3c.4: a strained realm admits less, by its budget strain; a refusal only the strain made is counted. (Its
  // strain is forced for the test by a huge upkeep in one of its settlements.)
  const seat = state.settlements.find(settlement => settlement.owner === large.id && settlement.status === 'alive')!, upkeep = seat.bonus.upkeep;
  const unstrained = admission(state, small, large);
  seat.bonus.upkeep = 1e12;
  const chance = admission(state, small, large);
  assert.equal(budgetView(state, large).strain, 1);
  assert.ok(unstrained.governed > 0 && chance.governed === unstrained.governed && Math.abs(chance.admit - chance.governed * (1 - UNITE_TUNING.strainRefusal)) < 1e-12);
  const refusedBefore = state.metrics.unionsRefusedForStrain, between: Rng = { ...refusing, next: () => (chance.admit + chance.governed) / 2 };
  assert.match(unite(state, state.tick, between, small, large, regions[0], []), /would not take them in/);
  assert.equal(state.metrics.unionsRefusedForStrain, refusedBefore + 1);
  seat.bonus.upkeep = upkeep; small.rebuffed.delete(large.id);
  // What it had heard of great works abroad passes to the union too.
  const heard = state.wonders.length + 99;
  small.heardWonders.push(heard);
  assert.match(unite(state, state.tick, accepting, small, large, regions[0], [{ factor: 'test', weight: 1 }]), /united/);
  assert.ok(large.heardWonders.includes(heard));
  large.heardWonders.pop();
  assert.equal(large.wealth, treasury); assert.equal(small.wealth, 0); assert.equal(large.projects.length, works); assert.ok(large.repairing);
  assert.deepEqual([large.roadWorks.length, small.roadWorks.length], [roads, 0]);
  large.roadWorks.pop();
  assert.equal(state.ledger.wealth.get(small.id)!.given - given, passed); assert.equal(state.ledger.wealth.get(large.id)!.received - received, passed);
  assert.notEqual(small.deathTick, null);
  assert.equal(large.groups.length, before + regions.length);
  for (const region of regions) {
    assert.equal(state.owner[region], large.id); assert.equal(state.occupant[region], large.id);
    assert.ok(state.settlements.filter(settlement => settlement.region === region && settlement.status === 'alive').every(settlement => settlement.owner === large.id && !settlement.capital));
  }
  assert.ok(state.settlements.filter(settlement => settlement.owner === large.id && settlement.capital).length === 1, 'one capital');
}

/** Hunger lowers a region's stability; unrest begins below the threshold and ends only once well above it. */
function exerciseStability(state: ReturnType<typeof createSimulation>) {
  const civ = state.polities[state.living.find(id => state.polities[id].kind === 'civ' && state.polities[id].groups.length > 1)!];
  const group = state.groups[civ.groups.find(id => id !== civ.core)!], region = group.region, kept = group.foodSecurity;
  const outbreaks = state.metrics.unrestOutbreaks, before = state.unrest[region];
  group.foodSecurity = 0;
  assess(state, civ);
  assert.ok(state.stability[region] < STABILITY_TUNING.unrestBelow && state.unrest[region] === 1, 'a starving region falls into unrest');
  assert.equal(state.metrics.unrestOutbreaks, outbreaks + (before ? 0 : 1), 'an outbreak is counted once');
  // Fed again, it leaves unrest only if its stability clears the threshold by the hysteresis.
  group.foodSecurity = 1.2;
  assess(state, civ);
  assert.equal(state.unrest[region], state.stability[region] >= STABILITY_TUNING.unrestBelow + STABILITY_TUNING.hysteresis ? 0 : 1);
  group.foodSecurity = kept;
}
