import type { ChronicleEvent, EventType } from '../../shared/simulation.ts';

/**
 * Observer presentation data for chronicle events (VISION.md "Text rendering"): one template per event type,
 * filled from the event's data and actors. `{key}` reads `event.data[key]`, `{@role}` the actor with that role,
 * `{region}` the event's region, and `{?key|text}` adds the text (which may hold placeholders) when `event.data[key]`
 * is true. The simulation never writes prose.
 */
export const EVENT_TEMPLATES: Record<EventType, string> = {
  bandSpawned: 'The {name} band of {population} people ({culture} culture) appears in region {region}.',
  bandMoved: 'The {name} band of {population} people moves from region {from} to region {region}.',
  bandSplit: 'A group of {population} breaks away from the {parentName} and becomes the {name} tribe in region {region}.',
  bandAbsorbed: 'The {civ} take in the {name} band of {population} people in region {region}{?ended|, the last of its tribe}{?learned|, and learn {techs} arts from them}.',
  bandJoined: 'The {name} tribe of {population} people joins the {civ}, bringing {regions} regions{?kin|: they are kin}{?learned| and {techs} arts the {civ} did not know}.',
  settled: 'The {name} tribe settles and becomes a civilization of {regions} regions, with its capital at {capital} in region {region}.',
  expansion: 'The {name} expand from region {from} into region {region} with {population} settlers.',
  settlementFounded: 'The village of {name} is founded in region {region} by the {civ}.',
  settlementTierChanged: '{name} of the {civ} {?rising|grows into}{?falling|shrinks to} a {tier}, with {urban} townspeople.',
  capitalMoved: 'The {civ} move their capital to {name}.',
  buildingCompleted: 'The {civ} complete {one} at {name}.',
  wonderBegun: 'The {civ} begin {wonder} at {name}.',
  wonderCompleted: 'The {civ} complete {wonder} at {name}, after {years} years of work.',
  wonderDestroyed: 'The {civ} {?standing|lose {wonder}}{?unfinished|abandon the work on {wonder}} at {name}{?abandoned|, as the city falls to ruin}{?neglected|, which they could no longer keep up}{?shrank|, as the city has long been too small for it}.',
  roadBuilt: 'The {civ} build {road} from {from} to {to}{?oneBridge|, with a bridge}{?manyBridges|, with {bridges} bridges}.',
  roadAgreement: '{@a} and {@b} agree to build a road between them.',
  settlementLooted: '{@attacker} loots {name}.',
  settlementBurned: '{@attacker} burns {name}.',
  settlementRazed: '{@attacker} razes {name}, leaving ruins.',
  ruinsResettled: 'The ruins of {name} are resettled by the {civ}{?renamed|, who call it {newName}}.',
  infrastructureDestroyed: '{?unpaid|The {civ} can no longer keep up their roads: }{?unkept|Roads no one keeps crumble away: }{?one|a stretch near region {region} is lost.}{?many|{roads} stretches, from region {region} on, are lost.}',
  techDiscovered: 'The {name} learn {tech} ({era} era){?taught|, helped by the {teacher}}{?first|, the first people in the world to do so}.',
  expedition: 'An expedition of the {name} sets out from region {region} and maps {regions} regions{?metPeoples|, meeting new peoples}.',
  voyageLost: 'A voyage from {@civ} is lost at sea.',
  newLandsDiscovered: '{@civ} discovers new lands at region {region}.',
  firstContact: 'The {name} and the {other} meet for the first time in region {region}{?sea|, across the sea}.',
  buildingDecayed: 'The {civ} can no longer keep up {the} at {name}, and it is lost.',
  taxes: '{?raised|The {civ} raise their taxes to {rate}% of what their people produce, to pay for running their realm.}{?eased|The {civ} ease their taxes to {rate}% of what their people produce.}',
  famineRelief: 'The {civ} send stored food to {?moreRegions|{regions} of their regions}{?one|region {region}} going hungry, {people} people, from {donors} of their regions with food to spare.',
  assimilation: '{?one|In region {region}}{?more|In {regions} regions} of the {civ}, {population} people of the {culture} have taken up the ways of the {ruling}.',
  traitEarned: 'The {culture} are now known as {trait}, for the life most of them have led for {years} years.',
  neglect: '{?begun|The {civ} can no longer keep up all their realm: the buildings and roads of {regions} of their far regions go unkept.}{?ended|The {civ} keep up all their buildings and roads again.}',
  arrears: '{?begun|The {civ} can no longer pay for running their realm: their buildings and roads go unkept, and their far provinces grow restless.}{?ended|The {civ} pay their way again.}',
  knowledgeShared: 'The {name} and the {other} agree to share what they know for {years} years.',
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
  cultureSplit: 'In {regions} regions of the {polity}{?others| and beyond}, {population} people have grown apart from the {parent} and become the {culture}{?both|, with more {more} and less {less} than their forebears}{?onlyMore|, with more {more} than their forebears}{?onlyLess|, with less {less} than their forebears}.',
  hybridCulture: 'In the realm of the {civ}, the {first} and the {second} have become one people, the {culture} ({firstShare}% {first}, {secondShare}% {second}).',
  religionFounded: '{religion} is founded in region {region}.',
  schism: '{religion} splits from {parent}.',
  stateReligionChanged: '{@civ} adopts {religion} as its state religion.',
  drought: 'Drought strikes region {region}{?oneMore| and a region beside it}{?moreRegions| and {more} regions around it}{?oneYear| for a year}{?severalYears| for {years} years}, hitting the {name}{?others| and their neighbours}.',
  climateShock: 'A climate shock lowers harvests worldwide.',
  famine: 'Famine strikes the {name} in region {region}{?moreRegions| and {more} more of their regions}: {deaths} of {population} people die of hunger within a year.',
  plague: 'Plague breaks out in region {region}.',
  migrationWave: 'A wave of migrants leaves region {region}.',
  refugees: 'Refugees flee region {region}.',
  knowledgeLost: '{@civ} loses the knowledge of {tech}.',
  industrialization: '{@civ} industrializes.',
  nuclearUse: '{@attacker} uses nuclear weapons on region {region}.',
  spaceMilestone: '{@civ} achieves {milestone}.',
  bandSpread: 'A group of {population} of the {name} moves on to region {region} and stays with its tribe, now {bands} bands.',
  unification: 'The {name} join the {civ}{?kin|, their kin}: {regions} regions and {population} people unite under one rule{?learned|, and the {civ} learn {techs} arts they did not know}.',
  independenceMovement: 'A movement for independence rises in region {region} of the {civ}.',
  referendum: 'Region {region} votes on independence from the {civ}.',
  dissolution: 'The {civ} dissolves, and its parts go their own ways.',
};

/** Fill an event's template; missing values show as "?" so gaps stay visible instead of silently vanishing. */
export function describeEvent(event: ChronicleEvent, names: (id: number) => string = id => `#${id}`) {
  const optional = EVENT_TEMPLATES[event.type].replace(/\{\?(\w+)\|((?:[^{}]|\{@?\w+\})*)\}/g, (_match, key: string, text: string) => event.data[key] === true ? text : '');
  return optional.replace(/\{(@?)(\w+)\}/g, (_match, actor: string, key: string) => {
    if (actor) { const found = event.actors.find(entry => entry.role === key); return found ? names(found.id) : '?'; }
    if (key === 'region') return event.region === null ? '?' : String(event.region);
    const value = event.data[key];
    return value === undefined ? '?' : typeof value === 'number' ? value.toLocaleString('en') : String(value);
  });
}

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
