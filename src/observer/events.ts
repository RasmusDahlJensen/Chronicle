import type { ChronicleEvent, EventType } from '../../shared/simulation.ts';

/**
 * Observer presentation data for chronicle events (VISION.md "Text rendering"): one template per event type,
 * filled from the event's data and actors. `{key}` reads `event.data[key]`, `{@role}` the actor with that role,
 * `{region}` the event's region, and `{?key|text}` adds the text when `event.data[key]` is true. The simulation never
 * writes prose.
 */
export const EVENT_TEMPLATES: Record<EventType, string> = {
  bandSpawned: 'The {name} band of {population} people ({culture} culture) appears in region {region}.',
  bandMoved: 'The {name} band of {population} people moves from region {from} to region {region}.',
  bandSplit: 'A group of {population} breaks away from the {parentName} and becomes the {name} tribe in region {region}.',
  bandAbsorbed: 'The {civ} take in the {name} band of {population} people in region {region}{?ended|, the last of its tribe}.',
  bandJoined: 'The {name} tribe of {population} people joins the {civ}, bringing {regions} regions{?kin|: they are kin}.',
  settled: 'The {name} tribe settles and becomes a civilization of {regions} regions, with its capital at {capital} in region {region}.',
  expansion: 'The {name} expand from region {from} into region {region} with {population} settlers.',
  settlementFounded: 'The village of {name} is founded in region {region} by the {civ}.',
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
  techDiscovered: 'The {name} learn {tech} ({era} era){?first|, the first people in the world to do so}.',
  expedition: 'An expedition of the {name} sets out from region {region} and maps {regions} regions{?metPeoples|, meeting new peoples}.',
  voyageLost: 'A voyage from {@civ} is lost at sea.',
  newLandsDiscovered: '{@civ} discovers new lands at region {region}.',
  firstContact: 'The {name} and the {other} meet for the first time in region {region}{?sea|, across the sea}.',
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
  unrest: 'Unrest spreads in region {region} of the {civ} (stability {stability}).',
  revolt: 'Region {region} revolts against {@civ}.',
  secession: '{@rebels} secedes from {@civ}.',
  civilWar: 'Civil war breaks out in {@civ}.',
  civDestroyed: 'The {name} civilization comes to an end, and {capital} is left in ruins.',
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
  bandSpread: 'A group of {population} of the {name} moves on to region {region} and stays with its tribe, now {bands} bands.',
  unification: 'The {name} join the {civ}{?kin|, their kin}: {regions} regions and {population} people unite under one rule.',
  independenceMovement: 'A movement for independence rises in region {region} of the {civ}.',
  referendum: 'Region {region} votes on independence from the {civ}.',
  dissolution: 'The {civ} dissolves, and its parts go their own ways.',
};

/** Fill an event's template; missing values show as "?" so gaps stay visible instead of silently vanishing. */
export function describeEvent(event: ChronicleEvent, names: (id: number) => string = id => `#${id}`) {
  const optional = EVENT_TEMPLATES[event.type].replace(/\{\?(\w+)\|([^}]*)\}/g, (_match, key: string, text: string) => event.data[key] === true ? text : '');
  return optional.replace(/\{(@?)(\w+)\}/g, (_match, actor: string, key: string) => {
    if (actor) { const found = event.actors.find(entry => entry.role === key); return found ? names(found.id) : '?'; }
    if (key === 'region') return event.region === null ? '?' : String(event.region);
    const value = event.data[key];
    return value === undefined ? '?' : typeof value === 'number' ? value.toLocaleString('en') : String(value);
  });
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
