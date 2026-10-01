import type { ChronicleEvent, EventType } from '../../shared/simulation.ts';

/**
 * Observer presentation data for chronicle events (VISION.md "Text rendering"): one template per event type,
 * filled from the event's data and actors. `{key}` reads `event.data[key]`, `{@role}` the actor with that role,
 * `{region}` the event's region. The simulation never writes prose.
 */
export const EVENT_TEMPLATES: Record<EventType, string> = {
  bandSpawned: 'The {name} band of {population} people ({culture} culture) appears in region {region}.',
  bandMoved: 'The {name} band of {population} people moves from region {from} to region {region}.',
  bandSplit: 'The {name} band of {population} people splits from the {parentName} band and settles region {region}.',
  bandAbsorbed: '{@band} is absorbed by {@civ} in region {region}.',
  bandJoined: '{@band} joins {@civ} in region {region}.',
  settled: '{@polity} settles in region {region} and becomes a civilization.',
  expansion: '{@civ} expands into region {region}.',
  settlementFounded: '{name} is founded in region {region}.',
  settlementTierChanged: '{name} becomes a {tier}.',
  capitalMoved: '{@civ} moves its capital to {name}.',
  buildingCompleted: '{@civ} completes a {building} at {name}.',
  wonderBegun: '{@civ} begins the {wonder} at {name}.',
  wonderCompleted: '{@civ} completes the {wonder} at {name}.',
  wonderDestroyed: 'The {wonder} at {name} is destroyed.',
  roadBuilt: '{@civ} builds a {kind} in region {region}.',
  roadAgreement: '{@a} and {@b} agree to build a road between them.',
  settlementLooted: '{@attacker} loots {name}.',
  settlementBurned: '{@attacker} burns {name}.',
  settlementRazed: '{@attacker} razes {name}, leaving ruins.',
  ruinsResettled: 'The ruins of {name} are resettled by {@civ}.',
  infrastructureDestroyed: 'A {kind} in region {region} is destroyed.',
  techDiscovered: '{@polity} discovers {tech}.',
  expedition: '{@civ} sends an expedition from region {region}.',
  voyageLost: 'A voyage from {@civ} is lost at sea.',
  newLandsDiscovered: '{@civ} discovers new lands at region {region}.',
  firstContact: '{@a} and {@b} meet for the first time.',
  tradeAgreement: '{@a} and {@b} agree to trade {resource}.',
  nonAggressionPact: '{@a} and {@b} sign a non-aggression pact.',
  alliance: '{@a} and {@b} form an alliance.',
  vassalage: '{@vassal} becomes a vassal of {@overlord}.',
  treatyCancelled: 'The treaty between {@a} and {@b} is cancelled.',
  treatyBroken: '{@breaker} breaks its treaty with {@other}.',
  raid: '{@attacker} raids {@defender} in region {region}.',
  warDeclared: '{@attacker} declares war on {@defender}.',
  battleYear: 'A year of fighting between {@a} and {@b}.',
  regionConquered: '{@attacker} conquers region {region} from {@defender}.',
  peaceSigned: '{@a} and {@b} make peace.',
  rulerSuccession: '{ruler} succeeds to the rule of {@civ}.',
  successionCrisis: 'A succession crisis divides {@civ}.',
  governmentChange: '{@civ} becomes a {government}.',
  unrest: 'Unrest spreads in region {region}.',
  revolt: 'Region {region} revolts against {@civ}.',
  secession: '{@rebels} secedes from {@civ}.',
  civilWar: 'Civil war breaks out in {@civ}.',
  civDestroyed: '{@civ} is destroyed.',
  cultureSplit: 'The {culture} culture splits from {parent}.',
  hybridCulture: 'A new {culture} culture forms from {parents}.',
  religionFounded: '{religion} is founded in region {region}.',
  schism: '{religion} splits from {parent}.',
  stateReligionChanged: '{@civ} adopts {religion} as its state religion.',
  drought: 'Drought strikes region {region}.',
  climateShock: 'A climate shock lowers harvests worldwide.',
  famine: 'Famine strikes region {region}.',
  plague: 'Plague breaks out in region {region}.',
  migrationWave: 'A wave of migrants leaves region {region}.',
  refugees: 'Refugees flee region {region}.',
  knowledgeLost: '{@civ} loses the knowledge of {tech}.',
  industrialization: '{@civ} industrializes.',
  nuclearUse: '{@attacker} uses nuclear weapons on region {region}.',
  spaceMilestone: '{@civ} achieves {milestone}.',
};

/** Fill an event's template; missing values show as "?" so gaps stay visible instead of silently vanishing. */
export function describeEvent(event: ChronicleEvent, names: (id: number) => string = id => `#${id}`) {
  return EVENT_TEMPLATES[event.type].replace(/\{(@?)(\w+)\}/g, (_match, actor: string, key: string) => {
    if (actor) { const found = event.actors.find(entry => entry.role === key); return found ? names(found.id) : '?'; }
    if (key === 'region') return event.region === null ? '?' : String(event.region);
    const value = event.data[key];
    return value === undefined ? '?' : typeof value === 'number' ? value.toLocaleString('en') : String(value);
  });
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
