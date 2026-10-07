import { BUILDING_INDEX } from './buildings.ts';
import { causes } from './causes.ts';
import { createName } from './names.ts';
import type { Rng } from './rng.ts';
import { TENETS } from './religions.ts';
import { VALUE_KEYS, type CultureValues, type Polity, type PopulationGroup, type Religion, type SimulationState, type TickContext } from './state.ts';
import { TECH_INDEX } from './techs.ts';
import { FAITH_TUNING } from './tunables.ts';

/**
 * Faiths (VISION.md "Religion", M4): a second, faster-moving identity on a region's people. Before organized religion
 * every people keeps the folk ways of its culture (faith −1), which do not spread. A civilization that knows Organized
 * religion (or Theology) and still keeps the folk ways may found a religion when a crisis or a zealous people moves it:
 * tenets drawn by its people's values, its capital's region the holy land. Religions spread to neighbouring peoples
 * (VISION.md M4: only through same-region and neighbouring-border contact until M5), more readily where the realm's
 * state religion and its shrines and temples support them, and less among traditional peoples and those already of a
 * religion. A realm's state religion is its rulers' faith, the faith of its heartland's people; peoples of other faiths
 * under an organized state religion are less settled (stability).
 */

/** Stream salts for a realm's yearly founding draw and a group's conversion draw. */
export const FOUNDING_STREAM = 0xfa17, CONVERSION_STREAM = 0xfa18;
const ORGANIZED = TECH_INDEX.get('Organized religion')!, THEOLOGY = TECH_INDEX.get('Theology')!;

/** Whether a polity may found a religion: it knows Organized religion or Theology. */
export function canFound(polity: Polity) {
  return polity.knowledge.known[ORGANIZED] === 1 || polity.knowledge.known[THEOLOGY] === 1;
}

/** Two to four tenets drawn by `values` (VISION.md "Tenets"), never two that exclude each other, in tenet order. */
export function drawTenets(rng: Rng, values: CultureValues) {
  const tuning = FAITH_TUNING, count = tuning.minTenets + rng.int(tuning.maxTenets - tuning.minTenets + 1), chosen: number[] = [];
  const weights = TENETS.map(tenet => Math.exp(tuning.tenetFavour * VALUE_KEYS.reduce((sum, key) => sum + (tenet.favour[key] ?? 0) * (values[key] - 0.5), 0)));
  while (chosen.length < count) {
    const open = weights.map((weight, at) => chosen.includes(at) || chosen.some(other => TENETS[other].excludes?.includes(TENETS[at].key) || TENETS[at].excludes?.includes(TENETS[other].key)) ? 0 : weight);
    const pick = rng.weighted(open);
    if (pick < 0) break;
    chosen.push(pick);
  }
  return chosen.sort((a, b) => a - b);
}

/** What moves a realm to found a religion (0–1, VISION.md "Founding"): a crisis (famine deaths over about the last
 *  year in its regions, as a share of its people, × `crisisScale`) or its people's zeal (its heartland's Zeal above
 *  `zealFloor`, scaled to 1); the stronger. A Pious ruler arrives with M7. */
export function foundingTrigger(state: SimulationState, civ: Polity) {
  const tuning = FAITH_TUNING;
  let people = 0, famine = 0;
  for (const id of civ.groups) { const group = state.groups[id]; people += group.size; famine += state.famineRecent[group.region]; }
  const crisis = people > 0 ? Math.min(1, tuning.crisisScale * famine / people) : 0;
  const zeal = state.groups[civ.core].values.zeal, zealous = Math.max(0, (zeal - tuning.zealFloor) / (1 - tuning.zealFloor));
  return { trigger: Math.max(crisis, zealous), crisis, zealous };
}

/**
 * A realm founds a religion (VISION.md "Founding"): named in its ruling culture's language, its tenets drawn by its
 * heartland people's values, its holy land the capital's region (a shrine or temple there is its first pilgrimage
 * site). The heartland's people follow it at once, and it becomes the realm's state religion.
 */
export function foundReligion(state: SimulationState, context: TickContext, rng: Rng, civ: Polity, why: { crisis: number; zealous: number }) {
  const culture = state.cultures[civ.culture], heart = state.groups[civ.core];
  const taken = new Set(state.religions.map(religion => religion.name.toLowerCase()));
  const tenets = drawTenets(rng, heart.values);
  const region = civ.capital !== null ? state.settlements[civ.capital].region : heart.region, from = civ.stateReligion;
  const religion: Religion = {
    id: state.religions.length, name: createName(rng, culture.language, taken), tenets, founder: civ.id, holyRegion: region, parent: null,
    foundedTick: context.tick, hue: rng.next() * 360, people: heart.size, regions: 1, deathTick: null,
  };
  state.religions.push(religion);
  heart.faith = religion.id;
  // Its rulers found it: it is their state religion from the start (the founding event says so, and any faith it
  // replaces).
  civ.stateReligion = religion.id;
  state.metrics.religionsFounded++;
  state.chronicle.emit({
    type: 'religionFounded', actors: [{ id: civ.id, role: 'civ' }], region, causes: causes({ famine: why.crisis, zeal: why.zealous }), importance: 0.45,
    data: { religion: religion.name, civ: civ.name, tenets: tenets.map(tenet => TENETS[tenet].name).join(', '), reformed: from >= 0, from: from >= 0 ? state.religions[from].name : '' },
  });
  return religion;
}

/** Whether a region has a shrine or temple standing in a living settlement (they serve its realm's state religion). */
function hasShrine(state: SimulationState, region: number) {
  for (const id of state.regionSettlements[region]) {
    const settlement = state.settlements[id];
    if (settlement.status === 'alive' && settlement.buildings.some(building => SHRINES.has(building.type))) return true;
  }
  return false;
}
const SHRINES = new Set([BUILDING_INDEX.get('shrine')!, BUILDING_INDEX.get('temple')!]);

/** How readily others take up a religion: its tenets' spread multipliers together. */
const spreadOf = (religion: Religion) => religion.tenets.reduce((product, tenet) => product * (TENETS[tenet].spread ?? 1), 1);

/** What draws a people to one religion, by kind (they add up to its draw). */
export interface Draw { neighbours: number; stateSupport: number; shrine: number; holyLand: number }

/**
 * What draws a people to each religion (VISION.md "Spread"; until M5 only same-region and neighbouring contact): the
 * share of its neighbouring peoples who follow it (another polity's at `foreignContact`), its realm's state religion
 * (`stateSupport`, `templeSupport` more with a shrine or temple in its region) and the holy land beside or under it
 * (`holyDraw`). Its own faith draws nothing.
 */
export function faithDraws(state: SimulationState, group: PopulationGroup) {
  const tuning = FAITH_TUNING, polity = state.polities[group.polity], region = state.partition.regions[group.region], draws = new Map<number, Draw>();
  const add = (religion: number, kind: keyof Draw, weight: number) => {
    if (religion < 0 || religion === group.faith) return;
    const draw = draws.get(religion) ?? { neighbours: 0, stateSupport: 0, shrine: 0, holyLand: 0 };
    draw[kind] += weight; draws.set(religion, draw);
  };
  let contacts = 0;
  for (const edge of region.neighbors) { if (state.groupAt[edge.region] >= 0) contacts++; }
  for (const edge of region.neighbors) {
    const at = state.groupAt[edge.region];
    if (at < 0) continue;
    const other = state.groups[at];
    add(other.faith, 'neighbours', (other.polity === group.polity ? 1 : tuning.foreignContact) / contacts);
  }
  if (polity.kind === 'civ' && polity.stateReligion >= 0) {
    add(polity.stateReligion, 'stateSupport', tuning.stateSupport);
    if (hasShrine(state, group.region)) add(polity.stateReligion, 'shrine', tuning.templeSupport);
  }
  for (const religion of state.religions) {
    if (religion.deathTick !== null) continue;
    if (religion.holyRegion === group.region || region.neighbors.some(edge => edge.region === religion.holyRegion)) add(religion.id, 'holyLand', tuning.holyDraw);
  }
  return draws;
}

const total = (draw: Draw) => draw.neighbours + draw.stateSupport + draw.shrine + draw.holyLand;

/**
 * A people's year of faith: all that draws it together (at most 1) gives a chance of `conversionRate` × that × the
 * chosen religion's spread tenets × (1 − `traditionHold` × its Tradition) × its attachment to its own faith
 * (`folkAttachment` for the folk ways, `faithAttachment` for another religion, × `stateHold` when it is its realm's state
 * religion) to take one up, chosen in proportion to
 * the draws (a graded choice: the stronger draw is likelier, never certain). Returns the religion taken up and what
 * drew it, or null.
 */
export function faithYear(state: SimulationState, rng: Rng, group: PopulationGroup) {
  const tuning = FAITH_TUNING, draws = [...faithDraws(state, group)].sort((a, b) => a[0] - b[0]);
  if (!draws.length) return null;
  const pick = rng.weighted(draws.map(([, draw]) => total(draw)));
  if (pick < 0) return null;
  const [religion, draw] = draws[pick], all = draws.reduce((sum, [, entry]) => sum + total(entry), 0);
  const polity = state.polities[group.polity];
  const attachment = (group.faith < 0 ? tuning.folkAttachment : tuning.faithAttachment) * (group.faith >= 0 && group.faith === polity.stateReligion ? tuning.stateHold : 1);
  const chance = tuning.conversionRate * Math.min(1, all) * spreadOf(state.religions[religion]) * (1 - tuning.traditionHold * group.values.tradition) * attachment;
  if (!rng.chance(chance)) return null;
  setGroupFaith(state, group, religion);
  return { religion, draw };
}

/**
 * A people's faith changes; a polity's state religion is its rulers' faith, its heartland's people's, so a change there
 * changes the realm's (an event for a civilization: VISION.md "State religion").
 */
export function setGroupFaith(state: SimulationState, group: PopulationGroup, faith: number) {
  group.faith = faith;
  const polity = state.polities[group.polity];
  if (polity.core === group.id) followRulers(state, polity, 'heartlandConverted');
}

/** A polity's state religion follows its heartland's people's faith (when it converts, or the heartland moves). */
export function followRulers(state: SimulationState, polity: Polity, why: 'heartlandConverted' | 'heartlandMoved') {
  const faith = state.groups[polity.core].faith, from = polity.stateReligion;
  if (faith === from) return;
  polity.stateReligion = faith;
  if (polity.kind !== 'civ') return;
  state.metrics.stateReligionChanges++;
  const name = (religion: number) => religion >= 0 ? state.religions[religion].name : '';
  state.chronicle.emit({
    type: 'stateReligionChanged', actors: [{ id: polity.id, role: 'civ' }], region: state.groups[polity.core].region, causes: causes({ [why]: 1 }), importance: 0.3,
    data: { civ: polity.name, religion: name(faith), from: name(from), adopted: faith >= 0 && from < 0, changed: faith >= 0 && from >= 0, folk: faith < 0 },
  });
}

/** The value pulls of a faith's tenets on its followers (none for the folk ways). */
export function tenetPulls(state: SimulationState, faith: number) {
  return faith >= 0 ? state.religions[faith].tenets : [];
}

/**
 * How much a people's faith unsettles or steadies it (VISION.md "State religion"): under an organized state religion, a
 * people of another faith loses `friction` × (½ + its Zeal), times the state religion's friction tenets (Tolerance);
 * an ascetic faith steadies its followers. Positive values unsettle.
 */
export function faithBurden(state: SimulationState, polity: Polity, group: PopulationGroup) {
  let burden = 0;
  if (polity.stateReligion >= 0 && group.faith !== polity.stateReligion) {
    const tolerance = state.religions[polity.stateReligion].tenets.reduce((product, tenet) => product * (TENETS[tenet].friction ?? 1), 1);
    burden += FAITH_TUNING.friction * (FAITH_TUNING.zealFriction + group.values.zeal) * tolerance;
  }
  if (group.faith >= 0) for (const tenet of state.religions[group.faith].tenets) burden -= TENETS[tenet].stability ?? 0;
  return burden;
}

/** A realm's year of faith (VISION.md "Founding"): one that may found a religion may be moved to by a crisis or zeal;
 *  one whose rulers already follow a religion more rarely (a reformation). */
export function realmFaith(state: SimulationState, context: TickContext, civ: Polity) {
  if (!canFound(civ)) return;
  const rng = context.stream(civ.id, FOUNDING_STREAM), why = foundingTrigger(state, civ);
  const attached = civ.stateReligion >= 0 ? FAITH_TUNING.reformation : 1;
  if (rng.chance(FAITH_TUNING.foundingRate * why.trigger * attached)) foundReligion(state, context, rng, civ, why);
}

/** A religion's followers at its yearly refresh; one with none left dies and stays in history. */
export function refreshReligion(context: TickContext, religion: Religion, groups: PopulationGroup[]) {
  religion.people = groups.reduce((sum, group) => sum + group.size, 0); religion.regions = groups.length;
  if (!groups.length) religion.deathTick = context.tick;
}

/**
 * Faith measures for the study: living religions with followers, the share of the world's people who follow one, the
 * most civilizations any one is followed in, and civilizations with a state religion.
 */
export function faithStats(state: SimulationState) {
  const civsOf = new Map<number, Set<number>>();
  let people = 0, faithful = 0, stateReligions = 0;
  for (const id of state.living) {
    const polity = state.polities[id];
    if (polity.kind === 'civ' && polity.stateReligion >= 0) stateReligions++;
    for (const groupId of polity.groups) {
      const group = state.groups[groupId];
      people += group.size;
      if (group.faith < 0) continue;
      faithful += group.size;
      const civs = civsOf.get(group.faith) ?? new Set<number>();
      if (polity.kind === 'civ') civs.add(id);
      civsOf.set(group.faith, civs);
    }
  }
  let most = 0;
  for (const civs of civsOf.values()) most = Math.max(most, civs.size);
  return { religions: civsOf.size, faithShare: people > 0 ? faithful / people : 0, religionMaxCivs: most, stateReligions };
}
