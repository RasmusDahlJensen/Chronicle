import { nameOf } from './names.ts';
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
  bandAbsorbed: 'The {civ} take in the {name} band of {population} people in region {region}{?ended|, the last of its tribe}{?learned|, and learn {techs|art|arts} from them}.',
  bandJoined: 'The {name} tribe of {population} people joins the {civ}, bringing {regions|region|regions}{?kin|: they are kin}{?learned| and {techs|art|arts} the {civ} did not know}.',
  settled: 'The {name} tribe settles and becomes a civilization of {regions|region|regions}, with its capital at {capital} in region {region}.',
  expansion: 'The {name} expand from region {from} into region {region} with {population} settlers.',
  settlementFounded: 'The village of {name} is founded in region {region} by the {civ}.',
  settlementTierChanged: '{name} of the {civ} {?rising|grows into}{?falling|shrinks to} a {tier}, with {urban} townspeople.',
  capitalMoved: 'The {civ} move their capital to {name}.',
  buildingCompleted: 'The {civ} complete {one} at {name}.',
  wonderBegun: 'The {civ} begin {wonder} at {name}.',
  wonderCompleted: 'The {civ} complete {wonder} at {name}, after {years|year|years} of work.',
  wonderDestroyed: 'The {civ} {?standing|lose {wonder}}{?unfinished|abandon the work on {wonder}} at {name}{?abandoned|, as the city falls to ruin}{?neglected|, which they could no longer keep up}{?shrank|, as the city has long been too small for it}.',
  roadBuilt: 'The {civ} build {road} from {from} {way} {to}{?oneBridge|, with a bridge}{?manyBridges|, with {bridges} bridges}{?half|, their half of the road agreed with the {partner}}{?joint|, completing the road agreed with the {partner}}.',
  roadAgreement: '{@a} and {@b} agree to build a road between {from} and {to}, each its own half.',
  settlementLooted: '{@attacker} loots {name}.',
  settlementBurned: '{@attacker} burns {name}.',
  settlementRazed: '{@attacker} razes {name}, leaving ruins.',
  ruinsResettled: 'The ruins of {name} are resettled by the {civ}{?renamed|, who call it {newName}}.',
  infrastructureDestroyed: '{?unpaid|The {civ} can no longer keep up their roads: }{?unkept|Roads no one keeps crumble away: }{?one|a stretch near region {region} is lost.}{?many|{roads} stretches, from region {region} on, are lost.}',
  techDiscovered: 'The {name} learn {tech} ({era} era){?taught|, helped by the {teacher}}{?first|, the first people in the world to do so}.',
  expedition: 'An expedition of the {name} sets out from region {region} and maps {regions|region|regions}{?metPeoples|, meeting new peoples}.',
  voyageLost: 'The voyage of {explorer} from {from}, of {@civ}, is lost at sea {km} km out.',
  newLandsDiscovered: '{explorer} sails from {from} for {@civ} and reaches {?newLand|new lands}{?farCoast|a far coast} {km} km away at region {region}, mapping {regions|region|regions}{?metOne|, and meets a new people}{?metMany|, and meets {met} new peoples}.',
  firstContact: 'The {name} and the {other} meet for the first time in region {region}{?sea|, across the sea}.',
  buildingDecayed: 'The {civ} can no longer keep up {the} at {name}, and it is lost.',
  taxes: '{?raised|The {civ} raise their taxes to {rate}% of what their people produce, to pay for running their realm.}{?eased|The {civ} ease their taxes to {rate}% of what their people produce.}',
  famineRelief: 'The {civ} send stored food to {?moreRegions|{regions} of their regions}{?one|region {region}} going hungry, {people} people, from {donors} of their regions with food to spare.',
  assimilation: '{?one|In region {region}}{?more|In {regions} regions} of the {civ}, {population} people of the {culture} have taken up the ways of the {ruling}.',
  faithSpread: 'The {religion} faith spreads to {?one|region {region}}{?more|{regions} regions} of the {polity}, {population} people.',
  traitEarned: 'The {culture} are now known as {trait}, for the life most of them have led for {years|year|years}.',
  // Conditionals cannot nest: `unready` is only set with `foundReligion`.
  devScenario: 'Development control (test only): {?drought|a drought is set off in region {region}}{?research|the {polity} are made to finish their research}{?foundReligion|the {polity} are made to found a religion}{?unready|, before they know Organized religion}{?splitCulture|the people of region {region} and their neighbours are made to split off from their culture}.',
  neglect: '{?begun|The {civ} can no longer keep up all their realm: the buildings and roads of {regions} of their far regions go unkept.}{?ended|The {civ} keep up all their buildings and roads again.}',
  mobilization: 'The {civ} raise their army toward {soldiers|soldier|soldiers}{?feared|, fearing the {feared}}.',
  demobilization: 'The {civ} stand down {change|soldier|soldiers}: their army falls toward {soldiers}.',
  arrears: '{?begun|The {civ} can no longer pay for running their realm: their buildings and roads go unkept, and their far provinces grow restless.}{?ended|The {civ} pay their way again.}',
  knowledgeShared: 'The {name} and the {other} agree to share what they know for {years|year|years}.',
  tradeAgreement: 'The {importer} and the {exporter} agree to trade: {resource} from {from} to {to}{?sea|, by sea}{?barter|, for {barterResource}}{?wealth|, for {price} wealth a year}.',
  nonAggressionPact: '{@a} and {@b} sign a non-aggression pact.',
  alliance: '{@a} and {@b} form an alliance{?against| against the {enemy}}.',
  vassalage: '{@vassal} becomes a vassal of {@overlord}.',
  treatyCancelled: 'The {?trade|trade in {resource} between the {exporter} and the {importer}}{?pact|non-aggression pact between {@a} and {@b}}{?alliance|alliance of {@a} and {@b}}{?road|road agreement between {@a} and {@b}}{?generic|treaty between {@a} and {@b}} ends{?needPassed|: the {importer} no longer need it}{?noSurplus|: the {exporter} have none to spare}{?unpaid|: the {importer} could not pay}{?relationsSoured|: relations soured}{?partyGone|: one of them is gone}{?routeLost|: its road can no longer be built}.',
  treatyBroken: '{@breaker} break their non-aggression pact with {@other} to go to war: {war}.',
  raid: '{@attacker} raids {@defender} in region {region}.',
  warDeclared: '{@attacker} declare {name} on {@defender}{?conquest|, a war of conquest}{?farmland|, for their farmland}{?resource|, for their {resource}}{?holy|, a holy war}{?reclamation|, to retake the land they lost}{?preemptive|, before they grow stronger}{?frontier|, to carry their border to a natural frontier}.',
  battleYear: 'A year of {name}: {attackerDead} of the {attacker} and {defenderDead} of the {defender} die; the {ahead} have the upper hand{?holding|, and the {attacker} hold {held|region|regions} of the {defender}}{?losing|, and the {defender} hold {lost|region|regions} of the {attacker}}.',
  regionConquered: '{place} (region {region}) passes from the {from} to the {civ} at the end of {war}.',
  peaceSigned: '{name} ends after {?long|{years|year|years}}{?short|{months|month|months}} and {dead} dead{?white|: a white peace, neither side the winner}{?tribute|: the {loser} pay the {winner} {perYear} a year for {tributeYears|year|years}}{?cession|: the {loser} cede {regions|region|regions} to the {winner}}{?paysTribute| and pay them {perYear} a year for {tributeYears|year|years}}{?annexation|: the {winner} take all the land of the {loser}}{?gone|: a side is no more}.',
  rulerSuccession: '{ruler} succeeds to the rule of {@civ}.',
  successionCrisis: 'A succession crisis divides {@civ}.',
  governmentChange: '{@civ} becomes a {government}.',
  unrest: 'Unrest spreads in region {region} of the {civ} (stability {stability}).',
  revolt: 'Region {region} revolts against {@civ}.',
  secession: '{@rebels} secedes from {@civ}.',
  civilWar: 'Civil war breaks out in {@civ}.',
  civDestroyed: 'The {name} civilization comes to an end{?ruined|, and {capital} is left in ruins}{?annexed|: the {by} take all its land at the end of {war}}.',
  cultureSplit: 'In {regions|region|regions} of the {polity}{?others| and beyond}, {population} people have grown apart from the {parent} and become the {culture}{?both|, with more {more} and less {less} than their forebears}{?onlyMore|, with more {more} than their forebears}{?onlyLess|, with less {less} than their forebears}.',
  hybridCulture: 'In the realm of the {civ}, the {first} and the {second} have become one people, the {culture} ({firstShare}% {first}, {secondShare}% {second}).',
  religionFounded: 'In region {region}, the {civ} found the {religion} faith ({tenets}){?reformed|, in place of the {from} faith}.',
  schism: 'In {regions|region|regions}, the followers of the {parent} faith, long cut off from {?holyLand|its holy land}{?mainBody|its main body}, become the {religion} faith{?swapped|, holding to {taken} in place of {dropped}}{?onlyDropped|, setting {dropped} aside}.',
  stateReligionChanged: '{?adopted|The {civ} take up the {religion} faith as their state religion.}{?changed|The {civ} take up the {religion} faith as their state religion in place of the {from}.}{?folk|The {civ} return to the folk ways of their forebears, leaving the {from} faith.}',
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
  unification: 'The {name} join the {civ}{?kin|, their kin}: {regions|region|regions} and {population} people unite under one rule{?learned|, and the {civ} learn {techs|art|arts} they did not know}.',
  independenceMovement: 'A movement for independence rises in region {region} of the {civ}.',
  referendum: 'Region {region} votes on independence from the {civ}.',
  dissolution: 'The {civ} dissolves, and its parts go their own ways.',
};

/** Fill an event's template; missing values show as "?" so gaps stay visible instead of silently vanishing. `{@role}`
 *  names the actor in that role (`names`, for example "the Vraye"); the sentence starts with a capital. */
export function describeEvent(event: ChronicleEvent, names: (id: number) => string = id => `#${id}`) {
  return fillTemplate(EVENT_TEMPLATES[event.type], event.data, {
    region: event.region, actor: role => { const found = event.actors.find(entry => entry.role === role); return found ? names(found.id) : '?'; },
  });
}

/** Fill a template from data (shared by events and stories): `{key}` reads `data[key]` (numbers in English digits),
 *  `{key|one|many}` a count with its noun ("1 region", "3 regions"), `{?key|text}` keeps the text when `data[key]` is
 *  true (conditionals do not nest), `{region}` and `{@role}` come from `context`. Missing values show as "?"; the text
 *  starts with a capital. */
export function fillTemplate(template: string, data: Readonly<Record<string, string | number | boolean>>, context: { region?: number | null; actor?: (role: string) => string } = {}) {
  const optional = template.replace(/\{\?(\w+)\|((?:[^{}]|\{@?\w+(?:\|[^{}|]*\|[^{}|]*)?\})*)\}/g, (_match, key: string, text: string) => data[key] === true ? text : '');
  const counted = optional.replace(/\{(\w+)\|([^{}|]*)\|([^{}|]*)\}/g, (_match, key: string, one: string, many: string) => {
    const value = data[key];
    return typeof value === 'number' ? `${value.toLocaleString('en')} ${value === 1 ? one : many}` : '?';
  });
  const text = counted.replace(/\{(@?)(\w+)\}/g, (_match, actor: string, key: string) => {
    if (actor) return context.actor?.(key) ?? '?';
    if (key === 'region' && context.region !== undefined) return context.region === null ? '?' : String(context.region);
    const value = data[key];
    return value === undefined ? '?' : typeof value === 'number' ? value.toLocaleString('en') : String(value);
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Names for `describeEvent` from one frame's `names` ("the Vraye"), "#id" for one it does not carry. */
export const frameNames = (pairs: readonly (readonly [number, string])[]) => nameOf(new Map(pairs));

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
