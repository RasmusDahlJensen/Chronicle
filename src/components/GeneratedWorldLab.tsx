import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { WORLD_BIOMES, type WorldManifest, type WorldSettings } from '../../shared/generated-world.ts';
import { loadGeneratedWorld } from '../api/generated-world.ts';
import type { FertilityFacts } from '../../shared/fertility.ts';
import {
  FERTILITY_GRADIENT, FERTILITY_WATER_COLOR, MOISTURE_GRADIENT, TEMPERATURE_GRADIENT, WORLD_BIOME_STYLE, type WorldLayer,
} from '../renderer/generated-world.ts';
import { RESOURCE_IDS } from '../../shared/atlas.ts';
import { RESOURCES } from '../world/atlas.ts';
import { RESOURCE_RULES } from '../world/resources.ts';
import { ResourceIcon } from './ResourceIcon.tsx';
import { SimulationPanel } from './SimulationPanel.tsx';
import { describeEvent, frameNames } from '../observer/events.ts';
import { ACTION_NAMES, AGREEMENT_NAMES, BELIEF_NAMES, causeText, COST_KINDS, COST_NAMES, DECISION_LABELS, decisionTarget, NEED_LABELS, REASON_NAMES, STATUS_NAMES, totalCost, units } from '../observer/labels.ts';
import { ERA_NAMES, RIVER_TIERS, simulationDate, VALUE_NAMES, type ObserverFrame } from '../../shared/simulation.ts';
import { cssColor, cultureColor, ERA_COLORS, faithColor, lineageColor, polityColor } from '../observer/palettes.ts';
import { useRegionMap, useWorldMap, type PeoplesLens } from '../observer/useWorldMap.ts';
import { chosenWorld, rememberWorld } from '../observer/world-choice.ts';
import './generated-world.css';

const number = new Intl.NumberFormat('en');
const message = (cause: unknown) => cause instanceof Error ? cause.message : 'The world could not be displayed. Try again.';
const layerLabels: Record<WorldLayer, string> = { biomes: 'Biomes', temperature: 'Temperature', moisture: 'Moisture', fertility: 'Fertility' };
const soilLabels: Record<FertilityFacts['soil'], string> = { none: 'None', rocky: 'Rocky', shallow: 'Shallow', sandy: 'Sandy', alluvial: 'Alluvial', waterlogged: 'Waterlogged', cold: 'Cold', loamy: 'Loamy' };
const TIER_LABELS = ['Village', 'Town', 'City', 'Metropolis'] as const;

/** The settlement inspector (VISION.md "Observer views"): the region's settlements, their tier, townspeople and housing, and their history. */
function SettlementList({ settlements, names }: { settlements: NonNullable<ObserverFrame['inspect']>['settlements']; names: (id: number) => string }) {
  return <section className="world-settlements" aria-label="Settlements here">
    <p className="atlas-detail-label">Settlements here</p>
    <ul className="world-settlement-list">{settlements.map(settlement => <li key={settlement.id} data-settlement-tier={settlement.tier} data-settlement-status={settlement.status}>
      <h4>{settlement.capital ? '★ ' : ''}{settlement.name} <span>· {settlement.status === 'alive' ? `${TIER_LABELS[settlement.tier]}${settlement.capital ? ', capital' : ''} of the ${settlement.owner}` : 'ruins'}</span></h4>
      <p className="atlas-panel-note">{settlement.status === 'alive' ? `${number.format(settlement.urban)} townspeople of ${number.format(settlement.housing)} it can house · ` : ''}founded year {simulationDate(settlement.founded).year}{settlement.formerName ? ` · once ${settlement.formerName}` : ''}.</p>
      {settlement.wonder && <p className="atlas-panel-note world-settlement-wonder">{settlement.wonder.standing ? `Home of ${settlement.wonder.name}.` : `${settlement.wonder.name[0].toUpperCase()}${settlement.wonder.name.slice(1)} is being built here (${Math.round(settlement.wonder.progress * 100)}% paid).`}</p>}
      {(settlement.buildings.length > 0 || settlement.building.length > 0) && <p className="atlas-panel-note world-settlement-buildings">{[
        ...settlement.buildings.map(building => building.condition < 0.995 ? `${building.name} (${Math.round(building.condition * 100)}% kept up)` : building.name),
        ...settlement.building.map(work => `${work.name} being built (${Math.round(work.progress * 100)}% paid)`),
      ].join(' · ')}</p>}
      {settlement.account && <p className="atlas-panel-note world-settlement-account">{settlementBalance(settlement.account)}</p>}
      {settlement.events.length > 0 && <ol className="world-settlement-history">{settlement.events.map(event => <li key={event.id}>Year {simulationDate(event.tick).year}: {describeEvent(event, names)}</li>)}</ol>}
    </li>)}</ul>
  </section>;
}

type Inspected = NonNullable<ObserverFrame['inspect']>;

/** What a settlement pays and costs its realm a year (VISION.md "Wealth": not every place pays); the region's seat also
 *  keeps the region's farm taxes, mines and quarries and administration. */
function settlementBalance(account: NonNullable<Inspected['settlements'][number]['account']>) {
  const pays = account.trades + account.farms + account.sites, costs = account.administration + account.services + account.upkeep, balance = pays - costs;
  const income = account.seat ? ` (trades ${number.format(account.trades)}, farm taxes ${number.format(account.farms)}${account.sites ? `, mines and quarries ${number.format(account.sites)}` : ''})` : ' in taxes on its trades';
  const spending = `${account.seat ? `administration ${number.format(account.administration)}, ` : ''}services ${number.format(account.services)}, upkeep ${number.format(account.upkeep)}`;
  return `${account.seat ? 'Seat of the region: pays' : 'Pays'} ${number.format(pays)} a year${income}; costs ${number.format(costs)} (${spending}): ${balance >= 0 ? 'a profit' : 'a loss'} of ${number.format(Math.abs(balance))} a year.`;
}

/** A civilization's budget (VISION.md "Wealth"). */
function BudgetDetail({ wealth }: { wealth: NonNullable<NonNullable<Inspected['polity']>['wealth']> }) {
  const { revenue, costs } = wealth;
  const income = revenue.trades + revenue.farms + revenue.sites + wealth.agreements, spending = totalCost(costs), balance = income - spending;
  const works = [wealth.projects ? `${number.format(wealth.projects)} ${wealth.projects === 1 ? 'building' : 'buildings'}` : '', wealth.roadWorks ? `${number.format(wealth.roadWorks)} ${wealth.roadWorks === 1 ? 'road' : 'roads'}` : ''].filter(Boolean).join(' and ');
  return <p className="atlas-panel-note" id="polity-wealth">Treasury {number.format(wealth.treasury)} · taxes {Math.round(wealth.taxRate * 100)}% of what its people produce · revenue {number.format(income)} a year (trades {number.format(revenue.trades)}, farms {number.format(revenue.farms)}{revenue.sites ? `, mines and quarries ${number.format(revenue.sites)}` : ''}{wealth.agreements ? `, trade agreements ${wealth.agreements > 0 ? '+' : '−'}${number.format(Math.abs(wealth.agreements))}` : ''}) · costs {number.format(spending)} a year ({COST_KINDS.map(cost => `${COST_NAMES[cost]} ${number.format(costs[cost])}`).join(', ')}) · {balance >= 0 ? 'a surplus' : 'a deficit'} of {number.format(Math.abs(balance))} a year{wealth.arrears >= 0.005 ? ` · in arrears: ${Math.round(wealth.arrears * 100)}% of its costs unpaid, so its buildings and roads wear and its far regions grow restless` : ''}{works ? ` · ${works} under construction` : ''}.</p>;
}

/** The people of the inspected region (VISION.md "Ancestry query"): their culture, how it began, its descent and their values. */
function PeopleDetail({ people }: { people: NonNullable<Inspected['people']> }) {
  const origin = people.origin === 'founding' ? 'one of the starting peoples' : people.origin === 'breakaway' ? `a band that broke away from the ${people.parent}`
    : people.origin === 'split' ? `grew apart from the ${people.parent}` : `formed from the ${people.parents.map(entry => `${entry.name} (${Math.round(entry.weight * 100)}%)`).join(' and ')}`;
  return <div className="world-cell-band" role="group" aria-label="People of this region">
    <p className="atlas-detail-label">People</p><h3 id="people-culture">{people.culture} <span>· {origin}, year {simulationDate(people.founded).year}</span></h3>
    <p className="atlas-panel-note" id="people-ancestry">Descent from the starting peoples: {people.ancestry.map(entry => `${Math.round(entry.share * 100)}% ${entry.name}`).join(', ')}{people.line.length ? `. Line: ${people.line.map(entry => entry.name).join(' ← ')}` : ''}. The culture lives in {number.format(people.regions)} {people.regions === 1 ? 'region' : 'regions'} ({formatPeople(people.population)} people).</p>
    {people.traits.length > 0 && <p className="atlas-panel-note" id="people-traits">Known as: {people.traits.join(', ')}.</p>}
    <p className="atlas-panel-note" id="people-faith">{people.faith ? `Faith: the ${people.faith.name} faith (${people.faith.tenets.join(', ')}), founded by the ${people.faith.founder} in year ${simulationDate(people.faith.founded).year}${people.faith.parent ? `, a sect of the ${people.faith.parent}` : ''}${people.faith.holy ? '. This is its holy land' : ''}.` : `Faith: the folk ways of the ${people.culture}.`}</p>
    <p className="atlas-panel-note" id="people-values">Values here (the whole culture's): {VALUE_NAMES.map(key => `${key} ${people.values[key].toFixed(2)} (${people.cultureValues[key].toFixed(2)})`).join(' · ')}.</p>
  </div>;
}

/** A band or civilization in the inspected region: people, food, specialists and knowledge (VISION.md M2 inspection). */
function PolityDetail({ polity }: { polity: NonNullable<Inspected['polity']> }) {
  const civ = polity.kind === 'civ', research = polity.research;
  const percent = research && research.cost > 0 ? Math.min(100, research.progress / research.cost * 100) : 0;
  return <div className="world-cell-band" aria-label={civ ? 'Civilization in this region' : 'Tribe in this region'} role="group" data-polity-kind={polity.kind}>
    <p className="atlas-detail-label">{civ ? 'Civilization' : 'Tribe'} · {ERA_NAMES[polity.era]} era</p><h3>{polity.name} <span>· {polity.culture} culture</span></h3>
    {civ && <p className="atlas-panel-note" id="polity-religion">{polity.stateReligion ? `State religion: the ${polity.stateReligion} faith.` : 'Its rulers keep the folk ways of their forebears.'}</p>}
    <p className="atlas-panel-note" id="polity-lineage">Descended from the {polity.lineage} people, one of the starting bands.</p>
    <dl className="world-water-facts">
      <div><dt>Regions</dt><dd id="polity-regions">{number.format(polity.regions)}</dd></div>
      <div><dt>People in all its regions</dt><dd id="polity-total">{number.format(polity.totalPopulation)}</dd></div>
    </dl>
    <p className="atlas-detail-label">{civ ? 'Its people here' : 'Its band here'}</p>
    <dl className="world-water-facts">
      <div><dt>Population</dt><dd id="band-population">{number.format(polity.population)}</dd></div>
      <div><dt>Births this year</dt><dd>{polity.birthsThisYear} <span>(last year {polity.birthsLastYear})</span></dd></div>
      <div><dt>Deaths this year</dt><dd>{polity.deathsThisYear} <span>(last year {polity.deathsLastYear})</span></dd></div>
      <div><dt>Food security</dt><dd id="band-food-security">{polity.foodSecurity.toFixed(2)}</dd></div>
      <div><dt>Food store</dt><dd>{polity.foodStoreMonths.toFixed(2)} months</dd></div>
      {polity.cropsMonths > 0 && <div><dt>Crops in the field</dt><dd id="polity-crops">{polity.cropsMonths.toFixed(2)} months</dd></div>}
      <div><dt>Farmed or herded</dt><dd>{Math.round(polity.farmShare * 100)}% of food</dd></div>
      <div><dt>{civ ? 'Townspeople (specialists)' : 'Specialists'}</dt><dd id="polity-specialists">{number.format(polity.specialists)}</dd></div>
      {civ && <div><dt>Rural</dt><dd id="polity-rural">{number.format(polity.population - polity.specialists)}</dd></div>}
      <div><dt>{civ ? 'Settled' : 'Here since'}</dt><dd>year {simulationDate(civ && polity.capital ? polity.capital.settled : polity.arrived).year}</dd></div>
      {polity.capital && <div><dt>Capital</dt><dd id="polity-capital">{polity.capital.name}</dd></div>}
    </dl>
    {polity.wealth && <BudgetDetail wealth={polity.wealth} />}
    <p className="atlas-panel-note">Food security is expected food over need — for farmers, the coming harvest and other food over the harvest cycle; below 1, or when the store runs out before the harvest, people go hungry and famine deaths rise. Crops sown since the last harvest come in at the next one. Surplus frees specialists, who live in settlements and research; bands have none.</p>
    {civ && <section className="world-polity-decision" aria-label="Decisions">
      <p className="atlas-detail-label">Governance · reach {number.format(polity.reachKm)} km of travel{polity.capitalKm !== null ? ` · this region ${number.format(polity.capitalKm)} km from the capital` : ''}</p>
      {polity.stability && <p className="atlas-panel-note" id="polity-stability">Stability here {polity.stability.value.toFixed(2)}{polity.stability.unrest ? ' · in unrest (lower output and research)' : ''}{[['hunger', polity.stability.hunger], ['overextension', polity.stability.overextension], ['foreign rule', polity.stability.foreignRule], ['another faith', polity.stability.faith], ['strain of a large, old realm', polity.stability.strain], ['taxes', polity.stability.taxes], ['arrears', polity.stability.arrears]].filter(([, weight]) => (weight as number) > 0.005).map(([factor, weight]) => ` · ${factor} −${(weight as number).toFixed(2)}`).join('')}{polity.stability.taxes < -0.005 ? ` · light taxes +${(-polity.stability.taxes).toFixed(2)}` : ''}{polity.stability.faith < -0.005 ? ` · ascetic faith +${(-polity.stability.faith).toFixed(2)}` : ''}.</p>}
      {polity.lastDecision ? <>
        <h4 id="polity-decision">{DECISION_LABELS[polity.lastDecision.chosen]}{decisionTarget(polity.lastDecision)} <span>year {simulationDate(polity.lastDecision.tick).year} · {polity.lastDecision.outcome}</span></h4>
        {polity.lastDecision.causes.length > 0 && <p className="atlas-panel-note" id="polity-causes">{causeText(polity.lastDecision.causes)}</p>}
        <p className="atlas-panel-note" id="polity-needs">Needs: {NEED_LABELS.map(([need, label]) => `${label} ${polity.lastDecision!.needs[need].toFixed(2)}`).join(' · ')}.</p>
        <p className="atlas-panel-note" id="polity-values">Decided by all its people's values: {VALUE_NAMES.map(key => `${key} ${polity.lastDecision!.values[key].toFixed(2)}`).join(' · ')}.</p>
        <ol className="world-decision-options" aria-label="Options weighed">{polity.lastDecision.options.map((option, index) => <li key={index}>
          <span>{ACTION_NAMES[option.action]} {option.score.toFixed(2)}</span>
          <span>{option.factors.slice(0, 4).map(entry => `${entry.factor} ${entry.weight >= 0 ? '+' : ''}${entry.weight.toFixed(2)}`).join(', ')}</span>
          {option.beliefs?.map(belief => <span key={`${belief.polity}-${belief.kind}`} className="world-decision-belief">believed {BELIEF_NAMES[belief.kind]} of the {belief.name} {number.format(belief.estimate)} (truly {number.format(belief.truth)})</span>)}
        </li>)}</ol>
      </> : <p className="atlas-panel-note">No decision yet: every six months a civilization weighs expanding, exploring, uniting, sharing knowledge, building, trading, treaties, voyages or doing nothing.</p>}
    </section>}
    {civ && polity.resources.length > 0 && <section className="world-polity-resources" aria-label="Resources">
      <p className="atlas-detail-label">Resources · what it has (worked in its land, with imports, less exports) against what its techs demand, a year</p>
      <ul className="world-resources" id="polity-resources">{polity.resources.map(entry => {
        const short = entry.demand > 0 && entry.met < 0.9;
        return <li key={entry.resource} className={short ? 'world-resource-short' : undefined}>
          <span>{entry.resource}{short ? ' · short' : ''}</span> <span>{units(entry.supply)}{entry.demand > 0 ? ` of ${units(entry.demand)} needed (${Math.round(entry.met * 100)}%)` : ' (not needed)'}</span>
        </li>;
      })}</ul>
      <p className="atlas-panel-note">A shortfall weakens the techs that need the resource (never below a quarter of their effect).</p>
    </section>}
    {civ && polity.treaties.length > 0 && <section className="world-polity-trade" aria-label="Trade">
      <p className="atlas-detail-label">Trade agreements</p>
      <ul className="world-resources" id="polity-trade">{polity.treaties.map((treaty, index) => <li key={index}>
        <span>{treaty.imports ? `imports ${treaty.resource} from` : `exports ${treaty.resource} to`} the {treaty.partner}</span>
        <span>{units(treaty.amount)} a year, {treaty.barter ? `for ${units(treaty.barterAmount)} ${treaty.barter}` : `${treaty.imports ? 'paying' : 'paid'} ${number.format(treaty.price)} wealth a year`} · since {number.format(treaty.since)}</span>
      </li>)}</ul>
    </section>}
    {civ && polity.diplomacy.length > 0 && <section className="world-polity-diplomacy" aria-label="Diplomacy">
      <p className="atlas-detail-label">Diplomacy · the peoples it knows best, with their standing and treaties</p>
      <ol className="world-diplomacy" aria-label="Relations">{polity.diplomacy.map(row => <li key={row.id}>
        <span className="world-diplomacy-name">{row.name} <span>{row.kind === 'civ' ? 'civilization' : 'tribe'} · met in year {number.format(row.met)}{row.sharing ? ' · sharing knowledge' : ''}</span></span>
        <span className="world-diplomacy-status">{STATUS_NAMES[row.status]}{row.status !== 'neutral' && row.status !== 'rival' ? ` since year ${number.format(row.since)}` : ''}{row.agreements.length ? ` · ${row.agreements.map(kind => AGREEMENT_NAMES[kind]).join(', ')}` : ''}</span>
        <span className={row.opinion >= 0 ? 'world-opinion-warm' : 'world-opinion-cold'}>opinion {row.opinion >= 0 ? '+' : ''}{Math.round(row.opinion)}</span>
        <span>{row.reasons.map(reason => `${REASON_NAMES[reason.factor] ?? reason.factor} ${reason.weight >= 0 ? '+' : ''}${Math.round(reason.weight)}`).join(', ') || 'no strong feelings'}</span>
        <span>believed {number.format(row.people)} people, strength {number.format(row.strength)} · intimacy {row.intimacy.toFixed(2)}</span>
      </li>)}</ol>
      <p className="atlas-panel-note">What it believes of others is off by a misjudgment of its own, smaller the better it knows them; opinion comes from faith, likeness, kinship, borders, sharing, trade, pacts, alliances, joint roads and what it remembers.</p>
    </section>}
    <section className="world-polity-knowledge" aria-label="Knowledge">
      <p className="atlas-detail-label">Research · {polity.researchPerYear.toLocaleString('en', { maximumFractionDigits: 1 })} points a year · {polity.contacts} contacts</p>
      <p className="atlas-panel-note" id="polity-map">Knows {number.format(polity.regionsKnown)} regions ({number.format(polity.regionsInSight)} in sight{civ ? '; the rest as last seen' : ''}) and has met {number.format(polity.met)} living {polity.met === 1 ? 'people' : 'peoples'}.</p>
      {research ? <>
        <h4 id="polity-research">{research.tech} <span>{Math.round(percent)}%</span></h4>
        <p className="atlas-panel-note" id="polity-research-speed">{number.format(Math.round(research.progress))} of {number.format(Math.round(research.cost))} points{research.sharedBy ? ` · ×${research.shareSpeed.toFixed(1)} while the ${research.sharedBy} share what they know` : ''}{research.catchUp > 1 ? ` · ×${research.catchUp.toFixed(2)} catching up on an older era` : ''}.{research.reasons.length ? ` Chosen for ${research.reasons.map(reason => `${reason.factor} ${reason.weight >= 0 ? '+' : ''}${reason.weight.toFixed(2)}`).join(', ')}.` : ''}</p>
        {research.candidates.length > 0 && <ol className="world-research-candidates" aria-label="Research options by weight">{research.candidates.map(option => <li key={option.tech}><span>{option.tech}</span> <span>{option.weight.toPrecision(2)}</span></li>)}</ol>}
      </> : <p className="atlas-panel-note">Nothing left to research.</p>}
      {polity.exchanges.length > 0 && <p className="atlas-panel-note" id="polity-exchanges">Shares knowledge with {polity.exchanges.map(entry => `the ${entry.name} (until year ${number.format(entry.until)})`).join(', ')}.</p>}
      <p className="world-known-techs" id="polity-known">Knows {polity.known.join(', ')}.</p>
    </section>
  </div>;
}

const formatPeople = (people: number) => people >= 1e6 ? `${(people / 1e6).toFixed(1)} M` : people >= 1e4 ? `${Math.round(people / 1e3)} k` : number.format(people);

const fertilityFactors = [
  { key: 'warmth', label: 'Warmth', description: 'Annual temperature suitability.' },
  { key: 'moisture', label: 'Moisture', description: 'Moisture available without irrigation.' },
  { key: 'soil', label: 'Soil', description: 'Estimated from terrain, climate, and rivers.' },
  { key: 'slope', label: 'Slope', description: 'Steeper ground limits growing potential.' },
  { key: 'drainage', label: 'Drainage', description: 'Persistent saturation reduces potential.' },
] as const;

function FertilityDetail({ facts, expanded }: { facts: FertilityFacts; expanded: boolean }) {
  return <section className="world-cell-fertility" aria-label="Selected cell fertility">
    <p className="atlas-detail-label">Natural growing potential</p>
    <h3>{facts.applicable ? <span data-fertility-score>{facts.score} / 100</span> : 'Not growing land'}</h3>
    {facts.applicable ? <>
      <p className="atlas-panel-note">A natural estimate before cultivation, not a crop yield or production rate.</p>
      <details open={expanded}>
        <summary>Why this score?</summary>
        <dl className="world-water-facts">
          <div><dt>Estimated soil</dt><dd>{soilLabels[facts.soil]}</dd></div>
          <div><dt>Regional slope</dt><dd>{facts.slopeDegrees.toFixed(1)}°</dd></div>
          <div><dt>Mapped freshwater</dt><dd>{facts.freshwater ? 'Here or adjacent' : 'None nearby'}</dd></div>
        </dl>
        <ul className="world-fertility-factors">{fertilityFactors.map(factor => <li key={factor.key}>
          <div><label htmlFor={`fertility-${factor.key}`}>{factor.label}</label><span>{facts.factors[factor.key]} / 100</span></div>
          <meter id={`fertility-${factor.key}`} min={0} max={100} value={facts.factors[factor.key]} />
          <p>{factor.description}</p>
        </li>)}</ul>
        <p className="atlas-panel-note">Factors combine multiplicatively: one strong limitation can keep the score low. Freshwater access describes the surroundings; it does not assume irrigation. Soil is an estimate, not a soil survey.</p>
      </details>
    </> : <p className="atlas-panel-note">Oceans, lakes, and frozen water have no terrestrial growing score.</p>}
  </section>;
}

export function GeneratedWorldLab() {
  const [world, setWorld] = useState<WorldManifest | null>(null);
  const [seed, setSeed] = useState(() => chosenWorld().seed);
  const [size, setSize] = useState<WorldSettings['size']>(() => chosenWorld().size);
  const [request, setRequest] = useState(() => ({ settings: chosenWorld(), revision: 0 }));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [layer, setLayer] = useState<WorldLayer>('biomes');
  const [resources, setResources] = useState(true);
  const [rivers, setRivers] = useState(true);
  const [showRegions, setShowRegions] = useState(false);
  const [showFields, setShowFields] = useState(true);
  const [showTrade, setShowTrade] = useState(true);
  // Territories of the peoples living on the land, coloured by polity (each tribe or civilization), by descent (which
  // starting band) or by era.
  const [peoples, setPeoples] = useState<PeoplesLens>('polity');
  // Choosing another world in this tab starts that world's history again at year 0 (until saving exists).
  const shown = useRef<{ key: string; fresh: boolean }>({ key: '', fresh: false });
  if (world && shown.current.key !== world.worldKey) shown.current = { key: world.worldKey, fresh: shown.current.key !== '' };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setLoadError(null);
    void loadGeneratedWorld(request.settings, controller.signal).then(manifest => {
      if (controller.signal.aborted) return;
      setWorld(manifest); setLoading(false); rememberWorld(manifest.settings);
    }).catch(cause => {
      if (controller.signal.aborted) return;
      setLoadError(message(cause)); setLoading(false);
    });
    return () => controller.abort();
  }, [request]);

  const { regions, regionError } = useRegionMap(world);
  const [frame, setFrame] = useState<ObserverFrame | null>(null);
  useEffect(() => { setFrame(null); }, [world]);
  const map = useWorldMap({ world, layer, resources, rivers, regions, showRegions, frame, peoples, showTrade, showFields });
  const { canvas, overlay, view, cell, cellRegion, inspecting, tileError, canvasError } = map;
  const names = frameNames(frame?.names ?? []);
  // The largest peoples by descent for the legend: regions held and people.
  const peopleSummary = useMemo(() => {
    if (!frame) return { lineages: [], eras: [] as number[] };
    const byLineage = new Map<number, { regions: number; population: number }>(), eras = new Array<number>(ERA_NAMES.length).fill(0);
    const counted = new Set<number>();
    frame.markers.lineages.forEach((lineage, index) => {
      const entry = byLineage.get(lineage) ?? { regions: 0, population: 0 };
      entry.regions++; entry.population += frame.markers.populations[index]; byLineage.set(lineage, entry);
      // One count per polity, not per band or village.
      if (!counted.has(frame.markers.ids[index])) { counted.add(frame.markers.ids[index]); eras[frame.markers.eras[index]]++; }
    });
    const lineages = [...byLineage].map(([lineage, entry]) => ({ lineage, name: frame.lineages[lineage] ?? '?', ...entry })).sort((a, b) => b.population - a.population || a.lineage - b.lineage);
    return { lineages, eras };
  }, [frame]);
  const inspected = frame?.inspect && cellRegion && frame.inspect.region === cellRegion.id ? frame.inspect : null;

  function generate(event?: FormEvent) {
    event?.preventDefault();
    setRequest(current => ({ settings: { seed, size }, revision: current.revision + 1 }));
  }
  const status = loading ? (world ? 'Generating replacement world…' : 'Generating your world…')
    : loadError ? (world ? 'Previous world retained · Generation failed' : 'World unavailable')
    : canvasError ? 'World canvas unavailable' : 'World ready to explore';
  const landPercent = world ? world.landCells / (world.width * world.height) * 100 : 0;
  const largestRunoff = useMemo(() => world ? world.hydrology.lakes.reduce((largest, lake) => Math.max(largest, lake.outlet?.runoff ?? 0),
    world.hydrology.rivers.runoff.reduce((largest, runoff) => Math.max(largest, runoff), 1)) : 1, [world]);
  const riverPercent = cell ? cell.water.runoff / largestRunoff * 100 : 0;
  const freshwater = cell ? ({ none: 'No mapped freshwater', river: 'Freshwater river', lake: 'Freshwater lake', lakeshore: 'Freshwater lakeshore' } as const)[cell.water.freshwater] : '';
  const climateDescription = cell ? `${cell.water.kind === 'lake' ? 'This lake cell' : cell.water.kind === 'ocean' ? 'This ocean cell' : cell.elevation >= 1500 ? 'This upland cell' : 'This lowland cell'} has ${cell.temperature < 0 ? 'a below-freezing annual mean' : cell.temperature < 10 ? 'cool annual temperatures' : cell.temperature < 20 ? 'mild annual temperatures' : 'warm annual temperatures'} and ${cell.moisture < 0.3 ? 'dry annual conditions' : cell.moisture > 0.7 ? 'plentiful annual moisture' : 'moderate annual moisture'}. ${cell.biome === 'lakeIce' ? 'The cold supports lake ice.' : cell.water.kind === 'lake' ? 'Lake depth is measured from the water surface to the bed.' : cell.biome === 'seaIce' ? 'The cold supports sea ice.' : cell.water.kind === 'ocean' ? 'Water depth distinguishes shallow sea from deep ocean.' : 'Its temperature, moisture, and elevation together determine the biome.'}` : '';

  return <div className="regional-atlas generated-world-lab">
    <header className="atlas-header">
      <a className="atlas-brand" href="/" aria-label="Chronicle home"><svg viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="13" /><path d="M16 2v28M2 16h28M10 22l4-8 8-4-4 8Z" /></svg>Chronicle</a>
      <span className="atlas-header-study">The living world <span aria-hidden="true">/</span> History lab · <a href="/">Back to the game</a></span>
    </header>
    <main>
      <div className="atlas-intro">
        <div><p className="atlas-eyebrow">Seeded geography &amp; annual climate</p><h1>A world taking shape</h1><p className="atlas-description">From frozen poles to tropical forests. Explore the land, waterways, climate, and natural potential of a fictional planet.</p></div>
        <dl className="atlas-overview" aria-label="World totals">
          <div><dt>Planet area</dt><dd>510<span className="atlas-unit"> million km²</span></dd></div>
          <div><dt>Resolution</dt><dd id="world-resolution">{world ? `${number.format(world.width)} × ${number.format(world.height)}` : '—'}</dd></div>
          <div><dt>Land cover</dt><dd>{world ? landPercent.toFixed(1) : '—'}<span className="atlas-unit">%</span></dd></div>
        </dl>
      </div>
      <div className="atlas-workspace">
        <aside className="atlas-sidebar" aria-label="World controls and legend">
          <section className="atlas-panel-section world-generation-controls">
            <p className="atlas-section-index">01 / World</p><h2>Explore a seed</h2>
            <form onSubmit={generate}>
              <label htmlFor="world-seed">World seed</label>
              <input id="world-seed" value={seed} onChange={event => setSeed(event.target.value)} required maxLength={64} pattern="[A-Za-z0-9 _.\-]+" title="1–64 letters, numbers, spaces, dots, underscores or hyphens" autoComplete="off" />
              <label htmlFor="world-size">Resolution</label>
              <select id="world-size" value={size} onChange={event => setSize(event.target.value as WorldSettings['size'])}>
                <option value="large">Large · 1,024 × 512</option><option value="standard">Standard · 512 × 256</option>
              </select>
              <button className="world-generate-button" type="submit">Regenerate world <span aria-hidden="true">↻</span></button>
            </form>
            <p className="atlas-panel-note">The same seed and resolution reproduce this geography. Both resolutions cover the same planet area.</p>
          </section>
          <section className="atlas-panel-section">
            <p className="atlas-section-index">02 / View</p><h2>Map layers</h2>
            <fieldset className="world-layer-options"><legend className="world-sr-only">Map layer</legend>
              {(['biomes', 'temperature', 'moisture', 'fertility'] as const).map(value => <label key={value} className={layer === value ? 'world-layer-selected' : ''}><input type="radio" name="world-layer" value={value} checked={layer === value} onChange={() => setLayer(value)} /><span>{layerLabels[value]}</span></label>)}
            </fieldset>
            <label className="world-resource-toggle"><input type="checkbox" checked={rivers} onChange={event => setRivers(event.target.checked)} /> Rivers</label>
            <p className="atlas-panel-note world-river-note">Larger rivers stand out at world scale. Zoom in to see smaller streams.</p>
            <label className="world-resource-toggle"><input type="checkbox" checked={showRegions} onChange={event => setShowRegions(event.target.checked)} /> Regions</label>
            <p className="atlas-panel-note">{regions ? `${number.format(regions.map.regions.length)} simulation regions of 20,000–60,000 km²; small islands are their own region.` : regionError ?? 'Dividing the land into regions…'}</p>
            <label className="world-resource-toggle"><input type="checkbox" checked={showFields} onChange={event => setShowFields(event.target.checked)} /> Fields</label>
            <p className="atlas-panel-note">Cultivated land, as wheat-coloured furrows: each region's best farmland near its main settlement, as much as its farmers work.</p>
            <label className="world-resource-toggle"><input type="checkbox" checked={showTrade} onChange={event => setShowTrade(event.target.checked)} /> Trade routes</label>
            <p className="atlas-panel-note">Trade agreements in force, between the two hubs: gold over land, blue by sea.</p>
            <label className="world-resource-toggle"><input type="checkbox" checked={resources} onChange={event => setResources(event.target.checked)} /> Resource sites</label>
            <p className="atlas-panel-note">Site markers appear at detail zoom. Every selected cell uses its full-resolution data.</p>
            <ul className="world-resource-legend" aria-label="Resource site legend">{RESOURCE_IDS.map(resource => <li key={resource} title={`Extraction: ${RESOURCE_RULES[resource].extractionTechnology}`}><ResourceIcon resource={resource} />{RESOURCES[resource].label}</li>)}</ul>
            <fieldset className="world-peoples-options"><legend>Peoples</legend>
              {([['polity', 'Political'], ['descent', 'By descent'], ['culture', 'By culture'], ['faith', 'By faith'], ['era', 'By era'], ['off', 'Hidden']] as const).map(([value, label]) => <label key={value}><input type="radio" name="world-peoples" value={value} checked={peoples === value} onChange={() => setPeoples(value)} /> {label}</label>)}
            </fieldset>
            <p className="atlas-panel-note">Every region a tribe's band or a civilization's village lives in is filled: lighter for roaming tribes, stronger for settled civilizations. Political: each civilization or tribe has its own colour, with capitals as stars; by descent, each of the starting peoples and all who broke away from it share one; by culture, each region shows the culture of the people living there; by faith, the religion its people follow (pale where they keep the folk ways of their culture).</p>
          </section>
          {peoples !== 'off' && frame && <section className="atlas-panel-section world-peoples-legend" aria-label="Peoples legend">
            {peoples === 'polity' ? <><div className="atlas-section-heading"><h2>Largest polities</h2><span>regions · people</span></div>
              <ul>{frame.largest.map(entry => <li key={entry.id}><span><span className="atlas-biome-swatch" style={{ backgroundColor: cssColor(polityColor(entry.id)) }} aria-hidden="true" />{entry.name} <span className="world-polity-kind">{entry.kind === 'civ' ? 'civilization' : 'tribe'}</span></span><span>{number.format(entry.regions)} · {formatPeople(entry.population)}</span></li>)}</ul>
              <p className="atlas-panel-note">{number.format(frame.polities - frame.civs)} {frame.polities - frame.civs === 1 ? 'tribe' : 'tribes'} and {number.format(frame.civs)} {frame.civs === 1 ? 'civilization' : 'civilizations'} in all.</p></>
              : peoples === 'descent' ? <><div className="atlas-section-heading"><h2>Peoples</h2><span>regions · people</span></div>
              <ul>{peopleSummary.lineages.slice(0, 10).map(entry => <li key={entry.lineage}><span><span className="atlas-biome-swatch" style={{ backgroundColor: cssColor(lineageColor(entry.lineage)) }} aria-hidden="true" />{entry.name}</span><span>{number.format(entry.regions)} · {formatPeople(entry.population)}</span></li>)}</ul>
              {peopleSummary.lineages.length > 10 && <p className="atlas-panel-note">and {peopleSummary.lineages.length - 10} more {peopleSummary.lineages.length - 10 === 1 ? 'people' : 'peoples'}.</p>}
              <p className="atlas-panel-note">Each is named after the culture of its starting band; daughters keep their founders' colour.</p></>
              : peoples === 'culture' ? <><div className="atlas-section-heading"><h2>Cultures</h2><span>regions · people</span></div>
              <ul id="culture-legend">{frame.cultures.slice(0, 10).map(entry => <li key={entry.id}><span><span className="atlas-biome-swatch" style={{ backgroundColor: cssColor(cultureColor(entry.hue, entry.id)) }} aria-hidden="true" />{entry.name}{entry.parent ? <span className="world-polity-kind">from the {entry.parent}</span> : null}</span><span>{number.format(entry.regions)} · {formatPeople(entry.population)}</span></li>)}</ul>
              {frame.cultures.length > 10 && <p className="atlas-panel-note">and {frame.cultures.length - 10} more {frame.cultures.length - 10 === 1 ? 'culture' : 'cultures'}.</p>}
              <p className="atlas-panel-note">A culture belongs to its people, not to a realm. Where its people grow apart it splits, and the daughter keeps a colour near its parent's.</p></>
              : peoples === 'faith' ? <><div className="atlas-section-heading"><h2>Religions</h2><span>civilizations · regions · people</span></div>
              {frame.religions.length ? <ul id="religion-legend">{frame.religions.slice(0, 10).map(entry => <li key={entry.id}><span><span className="atlas-biome-swatch" style={{ backgroundColor: cssColor(faithColor(entry.hue)) }} aria-hidden="true" />{entry.name}</span><span>{number.format(entry.civs)} · {number.format(entry.regions)} · {formatPeople(entry.population)}</span></li>)}</ul>
                : <p className="atlas-panel-note" id="religion-legend-empty">No religion has been founded yet: every people keeps the folk ways of its culture.</p>}
              <p className="atlas-panel-note">Religions are founded in civilizations that know Organized religion and spread from people to people across borders; pale regions keep the folk ways of their culture.</p></>
              : <><div className="atlas-section-heading"><h2>Eras</h2><span>polities</span></div>
              <ul>{ERA_NAMES.map((era, index) => peopleSummary.eras[index] ? <li key={era}><span><span className="atlas-biome-swatch" style={{ backgroundColor: ERA_COLORS[index] }} aria-hidden="true" />{era}</span><span>{number.format(peopleSummary.eras[index])}</span></li> : null)}</ul></>}
          </section>}
          <section className="atlas-panel-section world-legend" aria-label="Map legend">
            {layer === 'biomes' ? <><div className="atlas-section-heading"><h2>Biomes</h2><span>% of planet</span></div><ul className="atlas-biome-legend">{WORLD_BIOMES.map((biome, index) => <li key={biome}><span className="atlas-biome-name"><span className="atlas-biome-swatch" style={{ backgroundColor: WORLD_BIOME_STYLE[biome].color }} aria-hidden="true" />{WORLD_BIOME_STYLE[biome].label}</span><span>{world ? (world.biomeCounts[index] / (world.width * world.height) * 100).toFixed(1) : '—'}</span></li>)}</ul></>
              : layer === 'fertility' ? <><h2>Natural growing potential</h2><div className="world-climate-gradient" style={{ background: FERTILITY_GRADIENT }} /><div className="world-climate-scale"><span>0 · Low</span><span>50</span><span>100 · High</span></div><p className="world-water-key"><span style={{ backgroundColor: FERTILITY_WATER_COLOR }} aria-hidden="true" />Water · not growing land</p><p className="atlas-panel-note">An estimated 0–100 index combining warmth, moisture, soil, slope, and drainage. It describes natural conditions, not crop yield.</p></>
              : <><h2>{layer === 'temperature' ? 'Annual mean temperature' : 'Annual moisture index'}</h2><div className="world-climate-gradient" style={{ background: layer === 'temperature' ? TEMPERATURE_GRADIENT : MOISTURE_GRADIENT }} /><div className="world-climate-scale"><span>{layer === 'temperature' ? '−40 °C' : '0 · Dry'}</span><span>{layer === 'temperature' ? '0' : '50'}</span><span>{layer === 'temperature' ? '40 °C' : '100 · Wet'}</span></div><p className="atlas-panel-note">{layer === 'temperature' ? 'Latitude, elevation, and regional variation shape the annual temperature. Higher ground is colder.' : 'A relative measure of annual moisture availability shaped by circulation, ocean winds, and mountains. This index is not rainfall in millimetres.'}</p></>}
          </section>
        </aside>
        <section className="atlas-map-stage" aria-label="Generated world map" aria-busy={loading}>
          <div className="atlas-map-card">
            <div className="atlas-map-toolbar"><span className="atlas-map-mode"><span aria-hidden="true" />{layer === 'biomes' ? 'Biome' : layerLabels[layer]} atlas</span><div className="atlas-zoom-controls" role="group" aria-label="Map view">
              <button type="button" aria-label="Zoom out" disabled={!world || !!canvasError} onClick={() => map.zoomBy(1 / 1.6)}>−</button>
              <span className="atlas-zoom-value">{Math.round(view.zoom * 100)}%</span>
              <button type="button" aria-label="Zoom in" disabled={!world || !!canvasError} onClick={() => map.zoomBy(1.6)}>+</button>
              <button type="button" className="atlas-fit-button" disabled={!world || !!canvasError} onClick={map.fit}>Fit map</button>
            </div></div>
            {world ? <div className="atlas-canvas-frame"><canvas ref={canvas} id="generated-world-canvas" tabIndex={0} role="img" aria-label="Generated planet: biomes, rivers, lakes, temperature, moisture, fertility and natural resource sites. Click to inspect a cell." aria-describedby="world-map-help">This world preview requires Canvas 2D support.</canvas><canvas ref={overlay} className="world-map-overlay" aria-hidden="true" /><span className="atlas-north-mark" aria-hidden="true"><span>N</span>↑</span></div>
              : <div className="atlas-loading-map"><span className="atlas-loading-compass" aria-hidden="true">✦</span><p>{loadError ? 'The world is unavailable.' : 'A new geography is forming…'}</p><span>{loadError ? 'Use Retry generation to try again.' : 'Preparing continents, climate, and resource sites on the local host.'}</span></div>}
            <p id="world-map-help" className="atlas-map-help">Click to inspect · Drag to explore · Scroll to zoom. Keyboard: arrows inspect, Enter selects, Shift + arrows pan, + / − zoom, Home fits, Escape clears.</p>
          </div>
          <div className="atlas-map-caption"><span>Equal-area atlas <span aria-hidden="true">·</span> East–west wrapping</span><span>{view.detail ? 'Full-resolution detail' : layer === 'biomes' ? 'Terrain overview' : layer === 'fertility' ? 'Sampled fertility overview' : 'Sampled climate overview'}</span></div>
          <div className="atlas-status-row"><p id="world-status" role="status" aria-live="polite">{status}</p>{loadError && <button className="atlas-reset-button" type="button" onClick={() => setRequest(current => ({ ...current, revision: current.revision + 1 }))}>Retry generation</button>}</div>
          {loadError && <p className="atlas-error" role="alert">{loadError}</p>}
          {tileError && <div className="world-inline-error"><p className="atlas-error" role="alert">{tileError}</p><button className="atlas-reset-button" type="button" onClick={map.retryDetail}>Retry detail</button></div>}
          {canvasError && <div className="world-inline-error"><p className="atlas-error" role="alert">{canvasError}</p><button className="atlas-reset-button" type="button" onClick={map.retryCanvas}>Retry canvas</button></div>}
          <SimulationPanel settings={world?.settings ?? null} startFresh={shown.current.fresh} inspect={cellRegion?.id ?? null} onFrame={setFrame}
            onFocusCell={map.focusCell} />
          <div className="world-climate-note"><span aria-hidden="true">◌</span><p>Rivers connect their catchments to lakes and seas, while weak outflows may end in dry basins. Inland water may have an outlet or lie in a closed basin. The simulation runs on this PC; the page only observes it.</p></div>
        </section>
        <aside className="atlas-inspector" aria-labelledby="world-inspector-title">
          <p className="atlas-section-index">03 / Inspect</p><div className="atlas-section-heading"><h2 id="world-inspector-title">{cell || inspecting ? 'Cell detail' : 'Read the landscape'}</h2>{(cell || inspecting) && <button className="atlas-clear-selection" type="button" aria-label="Clear selection" onClick={map.clearSelection}>×</button>}</div>
          {cell && world ? <div className="world-selected-cell" data-selected-cell={cell.id} aria-live="polite">
            <div className="atlas-cell-biome" style={{ borderColor: WORLD_BIOME_STYLE[cell.biome].color }}><p>Cell {number.format(cell.id)}</p><h3>{WORLD_BIOME_STYLE[cell.biome].label}</h3></div>
            <dl className="atlas-cell-facts world-cell-facts">
              <div><dt>Latitude</dt><dd>{Math.abs(Math.asin(1 - 2 * (cell.y + 0.5) / world.height) * 180 / Math.PI).toFixed(1)}° {cell.y < world.height / 2 ? 'N' : 'S'}</dd></div>
              <div><dt>{cell.water.kind === 'lake' ? 'Bed elevation' : 'Elevation'}</dt><dd>{number.format(cell.elevation)} m</dd></div>
              <div><dt>Annual temperature</dt><dd id="cell-temperature">{cell.temperature.toFixed(1)} °C</dd></div>
              <div><dt>Moisture index</dt><dd id="cell-moisture">{Math.round(cell.moisture * 100)} / 100</dd></div>
              <div><dt>Cell area</dt><dd>{number.format(Math.round(world.areaKm2 / (world.width * world.height)))} km²</dd></div>
              <div><dt>Grid position</dt><dd>{cell.x}, {cell.y}</dd></div>
            </dl>
            <p className="atlas-panel-note world-cell-explanation">{climateDescription}</p>
            {cellRegion && <section className="world-cell-region" aria-label="Selected cell region">
              <p className="atlas-detail-label">Simulation region</p><h3>Region {cellRegion.id}</h3>
              <dl className="world-water-facts">
                <div><dt>Area</dt><dd>{number.format(cellRegion.areaKm2)} km²</dd></div>
                <div><dt>Water</dt><dd>{[cellRegion.coastal && 'coast', cellRegion.openLake && 'open lake', cellRegion.riverTier > 0 && ({ stream: 'stream', river: 'river', greatRiver: 'great river', none: '' } as const)[RIVER_TIERS[cellRegion.riverTier]]].filter(Boolean).join(', ') || 'none'}</dd></div>
                <div><dt>Neighbours</dt><dd>{cellRegion.neighbors.length}{cellRegion.island ? ' · island' : ''}</dd></div>
                {inspected && <div><dt>Capacity</dt><dd id="region-capacity">{number.format(inspected.capacity)} people</dd></div>}
                {inspected && <div><dt>Game stock</dt><dd>{Math.round(inspected.gameStock * 100)}%</dd></div>}
                {inspected?.neglected && <div><dt>Upkeep</dt><dd id="region-neglect">let go unkept by its realm: its buildings and roads wear</dd></div>}
                {inspected && inspected.fields.cells > 0 && <div><dt>Fields</dt><dd id="region-fields">{Math.round(inspected.fields.share * 100)}% of its farmland cultivated ({number.format(inspected.fields.cells)} cells)</dd></div>}
                {inspected && <div><dt>Last harvest</dt><dd id="region-harvest">{Math.round(inspected.weather.harvest * 100)}% of the crops{inspected.weather.drought ? ` · drought, ${inspected.weather.drought} months left` : ''}{inspected.weather.famine ? ' · famine' : ''}{inspected.weather.relief ? ' · relief food arriving' : ''}{inspected.weather.irrigation > 1 ? ` · irrigated (farming ×${inspected.weather.irrigation.toFixed(2)})` : ''}</dd></div>}
              </dl>
              {inspected && <p className="atlas-panel-note">At capacity this land yields about {number.format(inspected.food.forage)} from foraging, {number.format(inspected.food.hunt)} from hunting, {number.format(inspected.food.fish)} from fishing{inspected.food.herd || inspected.food.farm ? `, ${number.format(inspected.food.herd)} from herding and ${number.format(inspected.food.farm)} from farming` : ''} (people fed per year), for the people who live here or, on empty land, for foragers. Capacity is the population whose food equals its need at the current game stock.</p>}
              {inspected?.people && <PeopleDetail people={inspected.people} />}
              {inspected?.polity ? <PolityDetail polity={inspected.polity} /> : inspected && <p className="atlas-panel-note">No one lives here.</p>}
              {inspected && inspected.settlements.length > 0 && <SettlementList settlements={inspected.settlements} names={names} />}
            </section>}
            <FertilityDetail facts={cell.fertility} expanded={layer === 'fertility'} />
            <section className="world-cell-water" aria-label="Selected cell water">
              <p className="atlas-detail-label">Water &amp; freshwater</p>
              <h3>{({ dry: 'Dry land', ocean: 'Ocean', river: 'River', lake: 'Lake' } as const)[cell.water.kind]}</h3>
              <p className="world-freshwater-value">{freshwater}</p>
              {cell.water.kind === 'river' && <><dl className="world-water-facts">
                <div><dt>Relative river size</dt><dd>{riverPercent < 1 ? '<1' : Math.round(riverPercent)}% of largest</dd></div>
                <div><dt>Runoff index</dt><dd>{number.format(cell.water.runoff)}</dd></div>
              </dl><p className="atlas-panel-note">Compared with this world’s largest mapped channel. Annual runoff accumulates from the upstream catchment; the index is not a measured discharge.</p></>}
              {cell.water.kind === 'lake' && cell.water.lake && <><dl className="world-water-facts">
                <div><dt>Lake area</dt><dd>{number.format(Math.round(cell.water.lake.areaKm2))} km²</dd></div>
                <div><dt>Lake level</dt><dd>{number.format(cell.water.lake.level)} m</dd></div>
                <div><dt>Water depth</dt><dd>{number.format(cell.water.lake.depth)} m</dd></div>
                <div><dt>Drainage</dt><dd>{cell.water.lake.closed ? 'Closed basin' : 'One mapped outlet'}</dd></div>
              </dl><p className="atlas-panel-note">{cell.water.lake.closed ? 'Salinity is not modeled. This enclosed lake is not marked as a freshwater source.' : 'This lake drains through a mapped outlet and supplies freshwater along its shore.'}</p></>}
              {cell.water.freshwater === 'lakeshore' && <p className="atlas-panel-note">This cell borders a lake with a mapped outlet.</p>}
            </section>
            <section className="atlas-cell-resource" aria-label="Selected cell resource">{cell.resource ? <><p className="atlas-detail-label">Resource site</p><p className="atlas-resource-value"><span><ResourceIcon resource={cell.resource} /></span>{RESOURCES[cell.resource].label}</p><dl className="atlas-resource-facts"><div><dt>Site type</dt><dd>{RESOURCE_RULES[cell.resource].kind === 'renewable' ? 'Renewable' : 'Mineral'}</dd></div><div><dt>Required extraction technology</dt><dd>{RESOURCE_RULES[cell.resource].extractionTechnology}</dd></div></dl><p className="atlas-panel-note">Natural potential. Extraction and production are not active.</p></> : <><p className="atlas-detail-label">Natural potential</p><p className="atlas-resource-empty">No resource site in this cell</p><p className="atlas-panel-note">Sites are scattered across suitable terrain. Most cells have no special site.</p></>}</section>
          </div> : inspecting ? <p className="atlas-panel-note" role="status">Reading full-resolution cell data…</p> : <div className="atlas-inspector-empty"><svg viewBox="0 0 64 64" aria-hidden="true"><path d="M10 10h44v44H10zM10 25h44M10 39h44M25 10v44M39 10v44" /><path className="atlas-inspector-cell" d="M25 25h14v14H25z" /></svg><h3>A closer look</h3><p>Select any cell to inspect its biome, annual climate, fertility, water access, and resource potential.</p><span>Zoom in to explore terrain textures and individual resource markers.</span></div>}
          <div className="world-identity"><p className="atlas-detail-label">Current world</p><strong id="world-current-seed">{world?.settings.seed ?? 'Preparing…'}</strong><p>{world ? `${number.format(world.resourceSites)} scattered resource sites` : 'Geography is being generated'}</p><span>{world ? `Generator ${world.generatorVersion} · ${number.format(world.width * world.height)} cells` : 'Annual climate preview'}</span></div>
          <p className="atlas-panel-note world-projection-note">Equal-area cells; polar shapes are stretched. Map distances are not uniform ground distances. Regions are the simulation's units of land.</p>
        </aside>
      </div>
    </main>
    <footer className="atlas-footer"><span>Chronicle / World studies</span><span>Seeded geography · Annual climate · Natural potential</span></footer>
  </div>;
}
