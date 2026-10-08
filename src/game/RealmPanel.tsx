import { ERA_NAMES, SETTLEMENT_TIERS, simulationDate, VALUE_NAMES, type ObserverFrame } from '../../shared/simulation.ts';
import type { RegionSummary } from '../../shared/simulation.ts';
import { describeEvent } from '../observer/events.ts';
import {
  ACTION_NAMES, AGREEMENT_NAMES, BELIEF_NAMES, causeText, COST_KINDS, COST_NAMES, DECISION_LABELS, decisionTarget, factorName, NEED_LABELS, STATUS_NAMES, totalCost, units,
  type InspectedPolity,
} from '../observer/labels.ts';
import { cssColor, polityColor } from '../observer/palettes.ts';
import type { ReactNode } from 'react';
import { Tabs } from './Tabs.tsx';

const number = new Intl.NumberFormat('en');
/** People (or wealth) in millions or thousands. */
export const people = (count: number) => count >= 1e6 ? `${(count / 1e6).toFixed(1)} M` : count >= 1e4 ? `${Math.round(count / 1e3)} k` : number.format(Math.round(count));
const year = (tick: number) => number.format(simulationDate(tick).year);
const percent = (share: number) => `${Math.round(share * 100)}%`;
const signed = (value: number) => `${value >= 0 ? '+' : '−'}${number.format(Math.abs(Math.round(value)))}`;
const plural = (count: number, one: string, many: string) => `${number.format(count)} ${count === 1 ? one : many}`;
const TIER_PLURALS = ['villages', 'towns', 'cities', 'metropolises'] as const;

type Inspected = NonNullable<ObserverFrame['inspect']>;
export const REALM_TABS = ['overview', 'diplomacy', 'economy', 'knowledge', 'history', 'region'] as const;
export type RealmTab = typeof REALM_TABS[number];
const TAB_LABELS: Record<RealmTab, string> = { overview: 'Overview', diplomacy: 'Diplomacy', economy: 'Economy', knowledge: 'Knowledge', history: 'History', region: 'Region' };
/** A tribe has no realm to keep, treaties or treasury: its panel leaves out Diplomacy and Economy. */
export const tabsFor = (polity: InspectedPolity | null) => polity ? REALM_TABS.filter(tab => polity.kind === 'civ' || (tab !== 'diplomacy' && tab !== 'economy')) : [];

interface Props {
  inspected: Inspected;
  /** True while the newly chosen land is being read: the panel still shows the land chosen before. */
  stale?: boolean;
  region: RegionSummary;
  biome: string | null;
  tab: RealmTab;
  onTab: (tab: RealmTab) => void;
  names: (id: number) => string;
  /** Whether the map shows the world as this people knows it (U.6), and the switch for it. */
  viewing?: boolean;
  onViewAs?: (people: { id: number; name: string }) => void;
}

/**
 * The realm panel (U.2; VISION.md "Civ panel"): the realm living in the selected land, with tabs for why it acts and its
 * realm at a glance, its diplomacy, its economy, its knowledge, its own history, and the region itself. Every figure is
 * the simulation's state as the frame carries it.
 */
export function RealmPanel({ inspected, stale = false, region, biome, tab, onTab, names, viewing = false, onViewAs }: Props) {
  const polity = inspected.polity!, civ = polity.kind === 'civ';
  const tabs = tabsFor(polity), shown = tabs.includes(tab) ? tab : 'overview';
  return <>
    <p className="game-place-line" id="game-place-line">{stale ? <span role="status">Region {region.id}{biome ? ` · ${biome.toLowerCase()}` : ''} · reading the land…</span>
      : `Region ${region.id}${biome ? ` · ${biome.toLowerCase()}` : ''} · ${plural(polity.population, 'person', 'people')} of the ${polity.name} here`}</p>
    <section aria-label={civ ? 'Realm' : 'Tribe'} className="game-realm">
      <div className="game-realm-head">
        <span className="game-swatch" style={{ backgroundColor: cssColor(polityColor(polity.id)) }} aria-hidden="true" />
        <h2 id="game-realm-name">The {polity.name}</h2>
      </div>
      <p className="game-muted">{civ ? 'Civilization' : 'Tribe'} · {ERA_NAMES[polity.era]} era{polity.capital ? ` · capital ${polity.capital.name}` : ''} · {polity.stateReligion ? `${polity.stateReligion} faith` : 'folk ways'} · the {polity.culture} people</p>
      <dl className="game-realm-facts">
        <div><dt>people</dt><dd id="game-realm-people">{people(polity.totalPopulation)}</dd></div>
        <div><dt>regions</dt><dd>{number.format(polity.regions)}</dd></div>
        {polity.wealth && <div><dt>treasury</dt><dd>{people(polity.wealth.treasury)}</dd></div>}
      </dl>
      {onViewAs && <button type="button" className="game-view-as" aria-pressed={viewing} onClick={() => onViewAs({ id: polity.id, name: polity.name })}>View as the {polity.name}</button>}
    </section>
    <Tabs id="game-realm" label={civ ? 'About the realm' : 'About the tribe'} tabs={tabs} names={TAB_LABELS} chosen={shown} onChoose={onTab} busy={stale}>
      {({
        overview: () => <Overview polity={polity} />,
        diplomacy: () => <Diplomacy polity={polity} />,
        economy: () => <Economy polity={polity} />,
        knowledge: () => <Knowledge polity={polity} />,
        history: () => <History polity={polity} names={names} />,
        region: () => <RegionDetail inspected={stale ? null : inspected} region={region} biome={biome} names={names} />,
      } satisfies Record<RealmTab, () => ReactNode>)[shown]()}
    </Tabs>
  </>;
}

/** Labelled bars for shares from 0 to 1 (needs, values). */
function Bars({ label, entries }: { label: string; entries: { name: string; value: number }[] }) {
  return <ul className="game-bars" aria-label={label}>{entries.map(entry => <li key={entry.name}>
    <span>{entry.name}</span>
    <span className="game-bar-track" aria-hidden="true"><span style={{ width: `${Math.max(0, Math.min(1, entry.value)) * 100}%` }} /></span>
    <span className="game-bar-value">{entry.value.toFixed(2)}</span>
  </li>)}</ul>;
}

/** Why it acts (its last decision, with what drove it and what held it back, and its needs and values) and its realm
 *  at a glance; a tribe's band and food instead. */
function Overview({ polity }: { polity: InspectedPolity }) {
  const decision = polity.lastDecision, realm = polity.realm;
  return <>
    {polity.kind === 'civ' && <section aria-label="Why it acts">
      <h3>Why it acts</h3>
      {decision ? <>
        <p id="game-decision"><strong>{DECISION_LABELS[decision.chosen]}{decisionTarget(decision)}</strong> <span className="game-muted">· year {year(decision.tick)} · {decision.outcome}</span></p>
        {decision.causes.length > 0 && <p className="game-muted">{causeText(decision.causes, factorName)}</p>}
        <Bars label="Needs" entries={NEED_LABELS.map(([need, name]) => ({ name, value: decision.needs[need] }))} />
        <Bars label="Values" entries={VALUE_NAMES.map(name => ({ name, value: decision.values[name] }))} />
        <h3>Its strongest options</h3>
        <ol className="game-weighed" aria-label="What it weighed">{decision.options.map((option, at) => <li key={at} className={at === decision.pick ? 'game-weighed-chosen' : undefined}>
          <p className="game-row-head"><strong>{ACTION_NAMES[option.action]}{option.label ? ` · ${option.label}` : option.target !== null && option.action === 'expand' ? ` · region ${option.target}` : ''}</strong>
            {at === decision.pick && <span className="game-standing">chosen</span>}{option.score < 0 ? <span className="game-muted game-bar-value">ruled out</span> : <span className="game-bar-value">{option.score.toFixed(2)}</span>}</p>
          {option.factors.length > 0 && <p className="game-muted">{option.factors.slice(0, 4).map(entry => `${factorName(entry.factor)} ${entry.weight >= 0 ? '+' : '−'}${Math.abs(entry.weight).toFixed(2)}`).join(', ')}</p>}
          {option.beliefs?.map(belief => <p key={`${belief.polity}-${belief.kind}`} className="game-muted">Believed the {belief.name}'s {BELIEF_NAMES[belief.kind]} {belief.kind === 'era' ? ERA_NAMES[Math.round(belief.estimate)] ?? '?' : people(belief.estimate)} (truly {belief.kind === 'era' ? ERA_NAMES[Math.round(belief.truth)] ?? '?' : people(belief.truth)}).</p>)}
        </li>)}</ol>
        <p className="game-muted">The options it weighed highest. It picks among its best three by chance, weighted by score; doing nothing is always weighed, and an option scored below zero is ruled out.</p>
      </> : <p className="game-muted">No decision yet: every six months it weighs expanding, exploring, uniting, sharing knowledge, building, trading, treaties, voyages or doing nothing.</p>}
    </section>}
    {realm ? <section aria-label="At a glance" id="game-realm-glance">
      <h3>The realm</h3>
      <p id="game-realm-settlements">{realm.settlements.map((count, tier) => count ? plural(count, SETTLEMENT_TIERS[tier], TIER_PLURALS[tier]) : '').filter(Boolean).reverse().join(' · ') || 'No settlements'}</p>
      {realm.cities.length > 0 && <ol className="game-list" aria-label="Largest settlements">{realm.cities.map(city => <li key={city.id}>
        {city.capital ? '★ ' : ''}{city.name} <span className="game-muted">{SETTLEMENT_TIERS[city.tier]} · {number.format(city.urban)} townspeople</span>
      </li>)}</ol>}
      {realm.wonders.length > 0 && <p>Wonders: {realm.wonders.map(wonder => `${wonder.name} at ${wonder.city}`).join(', ')}.</p>}
      <dl className="game-facts">
        <div><dt>Stability</dt><dd id="game-realm-stability">{realm.stability.toFixed(2)} mean{realm.unrest ? ` · ${plural(realm.unrest, 'region', 'regions')} in unrest` : ''}</dd></div>
        <div><dt>Unkept land</dt><dd>{realm.neglected ? `${plural(realm.neglected, 'region', 'regions')} let go unkept` : 'none'}</dd></div>
        <div><dt>Roads</dt><dd id="game-realm-roads">{realm.roads ? `${plural(realm.roads, 'stretch', 'stretches')}${realm.roadsUnkept ? `, ${number.format(realm.roadsUnkept)} of them unkept` : ''}` : 'none'}</dd></div>
        <div><dt>Cultures</dt><dd>{realm.cultures.map(entry => `${entry.name} ${percent(entry.share)}`).join(' · ')}</dd></div>
        <div><dt>Faiths</dt><dd>{realm.faiths.map(entry => `${entry.name ?? 'folk ways'} ${percent(entry.share)}`).join(' · ')}</dd></div>
      </dl>
    </section> : <section aria-label="Its band">
      <h3>Its band</h3>
      <p>{plural(polity.totalPopulation, 'person', 'people')} in {plural(polity.regions, 'region', 'regions')}; {percent(polity.farmShare)} of the band's food here is farmed or herded.</p>
      <p className="game-muted">Food security {polity.foodSecurity.toFixed(2)} (below 1, people go hungry) · {polity.foodStoreMonths.toFixed(1)} months of food stored · here since year {year(polity.arrived)}.</p>
    </section>}
  </>;
}

/** The treaty a standing comes from (shown once, as the standing). */
const STANDING_AGREEMENT = { allied: 'alliance', pact: 'nonAggression', trade: 'trade', rival: null, neutral: null } as const;

/** Each people it knows: standing and since when, opinion and its reasons, the treaties and trade between them. */
function Diplomacy({ polity }: { polity: InspectedPolity }) {
  const unmet = polity.unmet.length > 0 && <section aria-label="Not yet met">
    <h3>Not yet met</h3>
    <ul className="game-list game-unmet" id="game-unmet">{polity.unmet.map(entry => <li key={entry.id}>
      The {entry.name} <span>{entry.kind === 'civ' ? 'civilization' : 'tribe'} · {plural(entry.away, 'region', 'regions')} from its land</span>
    </li>)}</ul>
    <p className="game-muted">The nearest peoples it does not know yet (seen by you, not by it): who is about to meet whom.</p>
  </section>;
  if (!polity.diplomacy.length) return <><p className="game-muted">It has met no other people yet.</p>{unmet}</>;
  return <>
    <ol className="game-rows" aria-label="Peoples it knows">{polity.diplomacy.map(row => {
      const trade = polity.treaties.filter(treaty => treaty.partnerId === row.id), also = row.agreements.filter(kind => kind !== STANDING_AGREEMENT[row.status]);
      return <li key={row.id} data-status={row.status}>
        <p className="game-row-head"><strong>The {row.name}</strong> <span className={`game-standing game-standing-${row.status}`}>{STATUS_NAMES[row.status]}</span>
          {row.status !== 'neutral' && row.status !== 'rival' && <span className="game-muted">since year {number.format(row.since)}</span>}
          <span className={row.opinion >= 0 ? 'game-warm' : 'game-cold'}>opinion {signed(row.opinion)}</span></p>
        <p className="game-muted">{row.kind === 'civ' ? 'Civilization' : 'Tribe'} · met in year {number.format(row.met)}{also.length ? ` · also ${also.map(kind => AGREEMENT_NAMES[kind]).join(', ')}` : ''}{row.sharing ? ' · sharing knowledge' : ''}</p>
        <p className="game-muted">{row.reasons.length ? `Because of ${row.reasons.map(reason => `${factorName(reason.factor)} ${signed(reason.weight)}`).join(', ')}` : 'No strong feelings'}.</p>
        {trade.length > 0 && <p className="game-muted">{trade.map(treaty => `${treaty.imports ? 'Buys' : 'Sells'} ${units(treaty.amount)} ${treaty.resource} a year`).join('; ')}.</p>}
      </li>;
    })}</ol>
    <p className="game-muted">Opinion runs from −100 to +100. It comes from faith, likeness, kinship, borders, sharing, trade, pacts, alliances, joint roads and what it remembers.</p>
    {unmet}
  </>;
}

/** Its purse (taxes, revenue, costs, balance and arrears), its resources against what its techs demand, its trade
 *  agreements and what it is building. */
function Economy({ polity }: { polity: InspectedPolity }) {
  const wealth = polity.wealth;
  if (!wealth) return null;
  const { revenue, costs } = wealth;
  const income = revenue.trades + revenue.farms + revenue.sites + wealth.agreements, spending = totalCost(costs);
  const line = (name: string, value: number) => <div key={name}><dt>{name}</dt><dd>{number.format(Math.round(value))}</dd></div>;
  return <>
    <section aria-label="The purse" id="game-economy-purse">
      <h3>The purse · a year</h3>
      <p>Treasury {number.format(wealth.treasury)} · taxes {percent(wealth.taxRate)} of what its people produce.</p>
      <div className="game-ledger">
        <dl aria-label="Revenue"><dt className="game-ledger-head">Revenue</dt><dd className="game-ledger-head">{number.format(Math.round(income))}</dd>
          {line('trades', revenue.trades)}{line('farms', revenue.farms)}{revenue.sites > 0 && line('mines and quarries', revenue.sites)}
          {wealth.agreements !== 0 && <div><dt>trade agreements</dt><dd>{signed(wealth.agreements)}</dd></div>}</dl>
        <dl aria-label="Costs"><dt className="game-ledger-head">Costs</dt><dd className="game-ledger-head">{number.format(Math.round(spending))}</dd>
          {COST_KINDS.map(cost => line(COST_NAMES[cost], costs[cost]))}</dl>
      </div>
      <p id="game-economy-balance" className={income >= spending ? 'game-warm' : 'game-cold'}>{income >= spending ? 'A surplus' : 'A deficit'} of {number.format(Math.round(Math.abs(income - spending)))} a year.</p>
      {wealth.arrears >= 0.005 && <p className="game-cold">In arrears: {percent(wealth.arrears)} of its costs unpaid, so its buildings and roads wear and its far regions grow restless.</p>}
      {(wealth.projects > 0 || wealth.roadWorks > 0) && <p className="game-muted">Under construction: {[wealth.projects ? plural(wealth.projects, 'building', 'buildings') : '', wealth.roadWorks ? plural(wealth.roadWorks, 'road', 'roads') : ''].filter(Boolean).join(' and ')}.</p>}
    </section>
    {polity.resources.length > 0 && <section aria-label="Resources">
      <h3>Resources · a year</h3>
      <ul className="game-list" id="game-resources">{polity.resources.map(entry => {
        const short = entry.demand > 0 && entry.met < 0.9;
        return <li key={entry.resource} className={short ? 'game-short' : undefined}>
          {entry.resource}{short ? ' · short' : ''} <span className="game-muted">{units(entry.supply)}{entry.demand > 0 ? ` of ${units(entry.demand)} needed (${percent(entry.met)})` : ' (not needed)'}</span>
        </li>;
      })}</ul>
      <p className="game-muted">What it has (worked in its land, with imports, less exports) against what its techs demand. A shortfall weakens the techs that need it.</p>
    </section>}
    <section aria-label="Trade agreements">
      <h3>Trade agreements</h3>
      {polity.treaties.length ? <ul className="game-list">{polity.treaties.map(treaty => <li key={`${treaty.partnerId}-${treaty.resource}-${treaty.imports}`}>
        {treaty.imports ? `Imports ${treaty.resource} from` : `Exports ${treaty.resource} to`} the {treaty.partner} <span className="game-muted">{units(treaty.amount)} a year, {treaty.barter ? `for ${units(treaty.barterAmount)} ${treaty.barter}` : `${treaty.imports ? 'paying' : 'paid'} ${number.format(treaty.price)} wealth a year`} · since year {number.format(treaty.since)}</span>
      </li>)}</ul> : <p className="game-muted">None.</p>}
    </section>
  </>;
}

/** Its research now, the techs it knows by era, what it believes of the peoples it knows beside the truth, and how much
 *  of the world it knows. */
function Knowledge({ polity }: { polity: InspectedPolity }) {
  const research = polity.research, share = research && research.cost > 0 ? Math.min(1, research.progress / research.cost) : 0;
  const byEra = ERA_NAMES.map((era, index) => ({ era, techs: polity.known.filter((_, at) => polity.knownEras[at] === index) })).filter(entry => entry.techs.length);
  return <>
    <section aria-label="Research">
      <h3>Research · {polity.researchPerYear.toLocaleString('en', { maximumFractionDigits: 1 })} points a year</h3>
      {polity.contacts > 0 && <p className="game-muted">Quickened by {plural(polity.contacts, 'people', 'peoples')} it has met within two regions of its land.</p>}
      {research ? <>
        <p id="game-research"><strong>{research.tech}</strong> <span className="game-muted">{percent(share)}</span></p>
        <span className="game-bar-track game-progress" aria-hidden="true"><span style={{ width: `${share * 100}%` }} /></span>
        {research.reasons.length > 0 && <p className="game-muted">Chosen for {research.reasons.map(reason => `${factorName(reason.factor)} ${reason.weight >= 0 ? '+' : ''}${reason.weight.toFixed(2)}`).join(', ')}.</p>}
        {research.candidates.length > 0 && <Bars label="Research options" entries={research.candidates.map(option => ({ name: option.tech, value: option.weight / Math.max(1e-9, ...research.candidates.map(entry => entry.weight)) }))} />}
        {research.candidates.length > 0 && <p className="game-muted">The strongest options at its last choice, by weight against the strongest: it picks by chance, weighted, among everything it could research, and keeps its target unless another grows much stronger.</p>}
        {(research.sharedBy || research.catchUp > 1) && <p className="game-muted">Faster{research.sharedBy ? ` ×${research.shareSpeed.toFixed(1)} while the ${research.sharedBy} share what they know` : ''}{research.sharedBy && research.catchUp > 1 ? ' and' : ''}{research.catchUp > 1 ? ` ×${research.catchUp.toFixed(2)} catching up on an older era` : ''}.</p>}
      </> : <p className="game-muted">Nothing left to research.</p>}
      {polity.exchanges.length > 0 && <p className="game-muted">Shares knowledge with {polity.exchanges.map(entry => `the ${entry.name} (until year ${number.format(entry.until)})`).join(', ')}.</p>}
    </section>
    <section aria-label="Known techs">
      <h3>Knows {plural(polity.known.length, 'tech', 'techs')}</h3>
      <dl className="game-facts" id="game-known">{byEra.map(entry => <div key={entry.era}><dt>{entry.era}</dt><dd>{entry.techs.join(', ')}</dd></div>)}</dl>
    </section>
    {polity.diplomacy.length > 0 && <section aria-label="Beliefs about others">
      <h3>What it believes of others</h3>
      <ul className="game-list" id="game-beliefs">{polity.diplomacy.map(row => <li key={row.id}>
        The {row.name} <span className="game-muted">{BELIEF_NAMES.people} {people(row.people)} (truly {people(row.truePeople)}) · {BELIEF_NAMES.strength} {people(row.strength)} (truly {people(row.trueStrength)}) · knows them {percent(row.intimacy)}</span>
      </li>)}</ul>
      <p className="game-muted">Its estimates are off by a misjudgment of its own, smaller the better it knows a people.</p>
    </section>}
    <section aria-label="Its map">
      <h3>Its map</h3>
      <p id="game-map-known">Knows {plural(polity.regionsKnown, 'region', 'regions')} ({number.format(polity.regionsInSight)} in sight{polity.kind === 'civ' ? '; the rest as last seen' : ''}) and {polity.met === 0 ? 'has met no other living people' : polity.met === 1 ? 'has met one other living people' : `has met ${number.format(polity.met)} other living peoples`}.</p>
    </section>
  </>;
}

/** Its origin and its own chronicle, newest first, each event with its strongest causes. */
function History({ polity, names }: { polity: InspectedPolity; names: (id: number) => string }) {
  return <>
    <section aria-label="Origin">
      <h3>Origin</h3>
      <p>{polity.lineage ? `Descended from the ${polity.lineage}, one of the starting peoples` : 'Of unknown descent'}{polity.kind === 'civ' && polity.capital ? `; settled as a civilization by year ${year(polity.capital.settled)}` : `; wandering since year ${year(polity.founded)}`}.</p>
    </section>
    <section aria-label="Its chronicle">
      <h3>Its chronicle</h3>
      {polity.history.length ? <ol className="game-events game-history" id="game-history">{polity.history.map(entry => <HistoryEvent key={entry.event.id} entry={entry} names={names} />)}</ol>
        : <p className="game-muted">Nothing recorded among the latest events.</p>}
    </section>
  </>;
}

/** One entry of its chronicle: the event (the newest of a run of one type, with how many more there were since when). */
function HistoryEvent({ entry, names }: { entry: InspectedPolity['history'][number]; names: (id: number) => string }) {
  const { event, more, from } = entry, first = simulationDate(from).year, last = simulationDate(event.tick).year;
  const causes = [...event.causes].sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight)).slice(0, 2);
  return <li>
    <span className="game-event-year">{first < last ? `${number.format(first)}–${number.format(last)}` : number.format(last)}</span>
    <span>{describeEvent(event, names)}{more > 0 && <span className="game-history-more"> And {number.format(more)} more like it{first < last ? ` since year ${number.format(first)}` : ''}.</span>}
      {causes.length > 0 && <span className="game-event-cause"> · {causes.map(cause => factorName(cause.factor)).join(', ')}</span>}</span>
  </li>;
}

/** The selected region: its land and people, settlements with their buildings and latest events, harvest and fields,
 *  and (in a civilization) its stability with what lowers it. */
export function RegionDetail({ inspected, region, biome, names }: { inspected: Inspected | null; region: RegionSummary; biome: string | null; names: (id: number) => string }) {
  const people = inspected?.people, polity = inspected?.polity, stability = polity?.stability;
  const settlements = inspected?.settlements.filter(settlement => settlement.status === 'alive') ?? [], ruins = inspected?.settlements.filter(settlement => settlement.status !== 'alive') ?? [];
  const burdens = stability ? ([['hunger', stability.hunger], ['overextension', stability.overextension], ['foreign rule', stability.foreignRule], ['another faith', stability.faith],
    ['strain of a large, old realm', stability.strain], ['taxes', stability.taxes], ['arrears', stability.arrears]] as const).filter(([, weight]) => weight > 0.005) : [];
  const water = [region.coastal && 'coast', region.openLake && 'lake', region.riverTier === 3 ? 'great river' : region.riverTier === 2 ? 'river' : region.riverTier === 1 ? 'stream' : ''].filter(Boolean).join(', ');
  return <section aria-label="The region" id="game-region">
    <h3>Region {region.id}{biome ? ` · ${biome.toLowerCase()}` : ''}</h3>
    <p className="game-muted">{number.format(Math.round(region.areaKm2))} km²{water ? ` · ${water}` : ''}{region.island ? ' · an island' : ''}</p>
    {inspected ? <>
      {polity ? <p id="game-region-people">{number.format(polity.population)} people live here{people ? `, of the ${people.culture}` : ''}{inspected.weather.famine ? ', in famine' : ''}.</p> : <p>No one lives here.</p>}
      {people && <PeopleHere people={people} />}
      {polity && <FoodHere inspected={inspected} polity={polity} />}
      {stability && <p id="game-region-stability" className={stability.unrest ? 'game-cold' : undefined}>Stability {stability.value.toFixed(2)}{stability.unrest ? ', in unrest' : ''}{burdens.length ? `, lowered by ${burdens.map(([factor, weight]) => `${factor} −${weight.toFixed(2)}`).join(', ')}` : ''}{stability.taxes < -0.005 ? `; light taxes +${(-stability.taxes).toFixed(2)}` : ''}{stability.faith < -0.005 ? `; an ascetic faith +${(-stability.faith).toFixed(2)}` : ''}.</p>}
      {inspected.neglected && <p className="game-cold">Let go unkept by its realm: its buildings and roads wear.</p>}
      {settlements.length > 0 && <ul className="game-settlements" aria-label="Settlements here">{settlements.map(settlement => <li key={settlement.id}>
        <span className="game-settlement-name">{settlement.capital ? '★ ' : ''}{settlement.name}</span> <span>{SETTLEMENT_TIERS[settlement.tier]}{settlement.capital ? ', capital' : ''} · {number.format(settlement.urban)} townspeople of {number.format(settlement.housing)} it can house · founded year {year(settlement.founded)}{settlement.formerName ? ` · once ${settlement.formerName}` : ''}</span>
        {settlement.wonder && <p>{settlement.wonder.standing ? `Home of ${settlement.wonder.name}.` : `${settlement.wonder.name[0].toUpperCase()}${settlement.wonder.name.slice(1)} is being built here (${percent(settlement.wonder.progress)} paid).`}</p>}
        {settlement.account && <p className="game-muted game-account">{accountText(settlement.account)}</p>}
        {(settlement.buildings.length > 0 || settlement.building.length > 0) && <p className="game-muted game-buildings">{[
          ...settlement.buildings.map(building => building.condition < 0.995 ? `${building.name} (${percent(building.condition)} kept up)` : building.name),
          ...settlement.building.map(work => `${work.name} being built (${percent(work.progress)} paid)`)].join(' · ')}</p>}
        {settlement.events.length > 0 && <ol className="game-settlement-history" aria-label={`The history of ${settlement.name}`}>{settlement.events.map(event =>
          <li key={event.id}><span className="game-event-year">{year(event.tick)}</span> {describeEvent(event, names)}</li>)}</ol>}
      </li>)}</ul>}
      {ruins.length > 0 && <ul className="game-settlements game-ruins" aria-label="Ruins here" id="game-region-ruins">{ruins.map(ruin => <li key={ruin.id}>
        <span className="game-settlement-name">{ruin.status === 'razed' ? `${ruin.name}, razed` : `The ruins of ${ruin.name}`}</span> <span>founded year {year(ruin.founded)}{ruin.formerName ? ` · once ${ruin.formerName}` : ''} · {ruin.status === 'razed' ? 'razed to the ground' : 'abandoned'}; a people settling here may build on them</span>
        {ruin.events.length > 0 && <ol className="game-settlement-history" aria-label={`The history of ${ruin.name}`}>{ruin.events.map(event =>
          <li key={event.id}><span className="game-event-year">{year(event.tick)}</span> {describeEvent(event, names)}</li>)}</ol>}
      </li>)}</ul>}
      <p className="game-muted">Last harvest {percent(inspected.weather.harvest)} of the crops{inspected.weather.drought ? ` · drought, ${inspected.weather.drought} months left` : ''}{inspected.weather.famine ? ' · famine' : ''}{inspected.weather.relief ? ' · relief food arriving' : ''}{inspected.weather.irrigation > 1 ? ` · irrigated (farming ×${inspected.weather.irrigation.toFixed(2)})` : ''}{inspected.fields.cells > 0 ? ` · ${percent(inspected.fields.share)} of its farmland cultivated` : ''}.</p>
    </> : <p className="game-muted" role="status">Reading the land…</p>}
  </section>;
}

/** The people of the region (U.7; VISION.md "Ancestry query"): how its culture began, its descent from the starting
 *  peoples, its line and traits, its values beside the whole culture's, and its faith. */
function PeopleHere({ people }: { people: NonNullable<Inspected['people']> }) {
  const origin = people.origin === 'founding' ? 'one of the starting peoples' : people.origin === 'breakaway' ? `a band that broke away from the ${people.parent}`
    : people.origin === 'split' ? `grown apart from the ${people.parent}` : `formed from the ${people.parents.map(entry => `${entry.name} (${percent(entry.weight)})`).join(' and ')}`;
  const faith = people.faith;
  return <section aria-label="Its people" id="game-region-culture">
    <h4>The {people.culture} <span className="game-muted">· {origin}, year {year(people.founded)}</span></h4>
    <p className="game-muted">Descent: {people.ancestry.map(entry => `${percent(entry.share)} ${entry.name}`).join(', ')}{people.line.length ? `. Line: ${people.line.map(entry => entry.name).join(' ← ')}` : ''}. The culture lives in {plural(people.regions, 'region', 'regions')} ({plural(people.population, 'person', 'people')}){people.traits.length ? `, known as ${people.traits.join(', ')}` : ''}.</p>
    <p className="game-muted" id="game-region-faith">{faith ? `The ${faith.name} faith (${faith.tenets.join(', ') || 'no tenets'}), founded by the ${faith.founder} in year ${year(faith.founded)}${faith.parent ? `, a sect of the ${faith.parent}` : ''}${faith.holy ? '. This is its holy land' : ''}.` : `The folk ways of the ${people.culture}.`}</p>
    <Bars label="Values here" entries={VALUE_NAMES.map(name => ({ name, value: people.values[name] }))} />
    <p className="game-muted">The whole culture: {VALUE_NAMES.map(name => `${name} ${people.cultureValues[name].toFixed(2)}`).join(' · ')}.</p>
  </section>;
}

/** The region's land and its people's food (U.7): what the land can feed, how they live and fare, and the realm's reach. */
function FoodHere({ inspected, polity }: { inspected: Inspected; polity: InspectedPolity }) {
  const food = inspected.food, civ = polity.kind === 'civ';
  return <section aria-label="Food and people" id="game-region-food">
    <dl className="game-facts">
      <div><dt>Capacity</dt><dd>{plural(Math.round(inspected.capacity), 'person', 'people')} at the current game stock ({percent(inspected.gameStock)})</dd></div>
      <div><dt>At capacity</dt><dd>feeds {[['foraging', food.forage], ['hunting', food.hunt], ['fishing', food.fish], ['herding', food.herd], ['farming', food.farm]].filter(([, fed]) => (fed as number) > 0).map(([method, fed]) => `${number.format(Math.round(fed as number))} by ${method}`).join(', ') || 'no one'}</dd></div>
      <div><dt>Births</dt><dd>{number.format(polity.birthsThisYear)} this year (last year {number.format(polity.birthsLastYear)})</dd></div>
      <div><dt>Deaths</dt><dd>{number.format(polity.deathsThisYear)} this year (last year {number.format(polity.deathsLastYear)})</dd></div>
      <div><dt>Food</dt><dd>security {polity.foodSecurity.toFixed(2)} · {polity.foodStoreMonths.toFixed(1)} months stored{polity.cropsMonths > 0 ? ` · ${polity.cropsMonths.toFixed(1)} months in the fields` : ''} · {percent(polity.farmShare)} farmed or herded</dd></div>
      <div><dt>{civ ? 'Townspeople' : 'Specialists'}</dt><dd>{number.format(polity.specialists)}{civ ? `; ${number.format(polity.population - polity.specialists)} rural` : ''}</dd></div>
      {civ && <div><dt>Reach</dt><dd>{number.format(polity.capitalKm ?? 0)} km of travel from the capital; the realm governs within {number.format(polity.reachKm)} km</dd></div>}
      <div><dt>Here since</dt><dd>year {year(polity.arrived)}{civ && polity.capital ? `; the realm settled by year ${year(polity.capital.settled)}` : ''}</dd></div>
    </dl>
    <p className="game-muted">Food security is expected food over need: below 1, or when stores run out before the harvest, people go hungry. Capacity is the people whose food equals their need here.</p>
  </section>;
}

/** What a settlement pays and costs its realm a year (VISION.md "Wealth": not every place pays). */
function accountText(account: NonNullable<Inspected['settlements'][number]['account']>) {
  const pays = account.trades + account.farms + account.sites, costs = account.administration + account.services + account.upkeep, balance = pays - costs;
  return `Pays ${number.format(Math.round(pays))} a year (trades ${number.format(Math.round(account.trades))}${account.seat ? `, farm taxes ${number.format(Math.round(account.farms))}${account.sites ? `, mines and quarries ${number.format(Math.round(account.sites))}` : ''}` : ''}); costs ${number.format(Math.round(costs))} (${account.seat ? `administration ${number.format(Math.round(account.administration))}, ` : ''}services ${number.format(Math.round(account.services))}, upkeep ${number.format(Math.round(account.upkeep))}): ${balance >= 0 ? 'a profit' : 'a loss'} of ${number.format(Math.round(Math.abs(balance)))}${account.seat ? ' (the seat of the region)' : ''}.`;
}
